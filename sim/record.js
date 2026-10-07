#!/usr/bin/env node
/* Record the market, offline, so the chart has 90 days to play back.
 *
 *   node sim/record.js --from 0 --to 29 --raw <dir>     one worker, 30 days
 *   node sim/record.js --stitch --raw <dir>             assemble and encode
 *
 * ---- why two passes ----
 *
 * 105 million matches is about seven hours of one core, so the days are split
 * across workers. But price is cumulative — day 40 opens where day 39 closed —
 * so a worker cannot know its own opening price. Each worker therefore records
 * its days with net wins counted from zero, and the stitch pass walks them in
 * order, adds each day's opening offset, and writes the files the phone reads.
 *
 * ---- why a worker's days are contiguous ----
 *
 * Not for speed: because the population is continuous within a worker's run,
 * and the one place that is allowed to be discontinuous is a day boundary. The
 * brief has every bot coin-flip its side for the first match of the day, so the
 * population already starts each day fresh in the only way that matters. A
 * worker boundary placed on a day boundary is therefore not an approximation of
 * anything — it is the same reset the specification asks for.
 *
 * ---- the clock ----
 *
 * The recording is 90 × 288 = 25,920 five-minute candles, numbered 0 upward.
 * Nothing in it is tied to a date: playback maps the real clock onto that
 * sequence (see js/aeway-market.js), so the recording's own timestamps matter
 * only inside the simulator, where they drive the rest timers and the Eastern
 * day boundary. The epoch below is a 90-day window that is entirely inside
 * Eastern daylight time, so the day boundary never moves by an hour partway
 * through the recording.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const CONFIG = require("./config.js");
const { Sim } = require("./sim.js");
const { Market, priceOf, CANDLE_MS, SAMPLES } = require("./market.js");
const { submitResult, onResult } = require("./results.js");
const CODEC = require("../js/aeway-codec.js");

/* 1 May 2026, 00:00 Eastern. May to July is all EDT, so none of the 90 days
   has a day boundary that shifts. */
const EPOCH = Date.UTC(2026, 4, 1, 4, 0, 0);
const DAY_MS = 24 * 60 * 60 * 1000;
const PER_DAY = DAY_MS / CANDLE_MS;              // 288
const WARMUP_MS = 20 * 60 * 1000;
const SEED_BASE = 20260501;

function args(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.slice(0, 2) !== "--") continue;
    const k = a.slice(2), next = argv[i + 1];
    if (next === undefined || next.slice(0, 2) === "--") { o[k] = true; continue; }
    o[k] = isNaN(Number(next)) ? next : Number(next);
    i++;
  }
  return o;
}
const A = args(process.argv.slice(2));
const RAW = A.raw ? path.resolve(A.raw) : path.join(__dirname, "..", ".aeway-raw");
const ROOT = path.join(__dirname, "..");

/* ---------------- one worker: record a contiguous run of days ---------------- */

function recordDays(from, to) {
  fs.mkdirSync(RAW, { recursive: true });
  const t0 = Date.now();
  const startMs = EPOCH + from * DAY_MS;

  const days = [];                  // the day currently being filled, then flushed
  let cur = [];
  let curDay = from;

  const rejects = [];
  const market = new Market({
    onCandle: (c) => {
      cur.push(c);
      if (cur.length === PER_DAY) { flushDay(curDay, cur); cur = []; curDay++; }
    },
    onReject: (x) => { if (rejects.length < 50) rejects.push(x); },
  });

  /* what the admin report's balance section needs, tallied as it goes rather
     than kept: 35 million matches cannot be held in memory */
  const tally = {
    matches: 0, bull: 0, bear: 0, draw: 0,
    rounds: 0, seconds: 0, onTrack: 0,
    yoloNewsRounds: 0, yoloNewsDeciders: 0,
    pointsBull: 0, pointsBear: 0,
    roundHist: new Array(80).fill(0),       // rounds per match, capped
    pointHist: new Array(26).fill(0),       // the winner's Print, 1..25
    durHist: new Array(40).fill(0),         // half-minute buckets
  };

  const off = onResult((r) => {
    market.submit(r);
    tally.matches++;
    if (r.winner === "bull") { tally.bull++; tally.pointsBull += r.points; }
    else if (r.winner === "bear") { tally.bear++; tally.pointsBear += r.points; }
    else tally.draw++;
    tally.rounds += r.rounds;
    tally.seconds += r.seconds;
    if (r.onTrack) tally.onTrack++;
    if (r.yoloNews) tally.yoloNewsRounds += r.yoloNews;
    if (r.yoloNewsDecider) tally.yoloNewsDeciders++;
    tally.roundHist[Math.min(79, r.rounds)]++;
    if (r.winner !== "draw") tally.pointHist[r.points]++;
    tally.durHist[Math.min(39, Math.floor(r.seconds / 30))]++;
  });

  function flushDay(day, candles) {
    /* Positional numbering: the recording is a sequence, not a calendar. */
    candles.forEach((c, i) => { c.index = day * PER_DAY + i; });
    const raw = {
      day,
      startIndex: day * PER_DAY,
      n: candles.length,
      firstOpenNet: candles[0].openNet,
      bullWins: candles.map((c) => c.bullWins),
      bearWins: candles.map((c) => c.bearWins),
      draws: candles.map((c) => c.draws),
      bullPts: candles.map((c) => c.bullPts),
      bearPts: candles.map((c) => c.bearPts),
      hiUp: candles.map((c) => c.hiNet - c.openNet),
      loDown: candles.map((c) => c.openNet - c.loNet),
      pathNet: [].concat(...candles.map((c) => c.path.map((p) => p.dn))),
      pathBull: [].concat(...candles.map((c) => c.path.map((p) => p.bp))),
      pathBear: [].concat(...candles.map((c) => c.path.map((p) => p.bq))),
    };
    fs.writeFileSync(path.join(RAW, `raw-${String(day).padStart(3, "0")}.json`), JSON.stringify(raw));
    days.push(day);
    const el = (Date.now() - t0) / 1000;
    console.log(`day ${day}  ${candles.length} candles  net ${raw.firstOpenNet} -> ` +
      `${candles[candles.length - 1].closeNet}  ${tally.matches.toLocaleString()} matches  ` +
      `${el.toFixed(0)}s  (${(el / (days.length)).toFixed(0)}s/day)`);
  }

  const sim = new Sim({
    seed: SEED_BASE + from,
    startMs: startMs - WARMUP_MS,
    config: { bots: A.bots || CONFIG.bots },
    settings: CONFIG.settings,
  });
  /* the warm-up is played but not recorded: a cold population is ten thousand
     bots free at the same instant, and its first candles are not a market */
  sim.advanceTo(startMs);
  sim.onResult = submitResult;
  sim.advanceTo(EPOCH + (to + 1) * DAY_MS);
  market.flush();
  off();

  if (cur.length) {
    console.log(`warning: ${cur.length} candles left over, not a whole day — dropped`);
  }
  fs.writeFileSync(path.join(RAW, `tally-${String(from).padStart(3, "0")}.json`),
    JSON.stringify({ from, to, bots: A.bots || CONFIG.bots, tally, rejects,
      rejected: market.rejected, accepted: market.accepted }));
  console.log(`\ndays ${from}..${to} done in ${((Date.now() - t0) / 60000).toFixed(1)} min — ` +
    `${tally.matches.toLocaleString()} matches, ${market.rejected} rejected`);
}

/* ---------------- the stitch pass: offset, encode, write ---------------- */

function stitch() {
  /* --days is for rehearsing the pipeline on three days rather than ninety; the
     recording itself always uses the configured count */
  const DAYS = A.days || CONFIG.record.days;
  const total = DAYS * PER_DAY;
  const outDir = A.out ? path.resolve(A.out) : path.join(ROOT, CONFIG.record.dir);
  fs.mkdirSync(outDir, { recursive: true });

  let net = 0;                 // cumulative net wins at the open of the next day
  let bytes = 0, chars = 0;
  let totalPoints = 0, totalDecided = 0, totalDraws = 0, totalMatches = 0;
  const dayStats = [];

  for (let day = 0; day < DAYS; day++) {
    const file = path.join(RAW, `raw-${String(day).padStart(3, "0")}.json`);
    if (!fs.existsSync(file)) throw new Error(`missing ${file} — a worker did not finish`);
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    if (raw.n !== PER_DAY) throw new Error(`day ${day} has ${raw.n} candles, expected ${PER_DAY}`);

    /* Re-base: the worker counted net wins from zero inside its own run, so the
       whole day shifts by what the market stood at when the day opened. */
    const shift = net - raw.firstOpenNet;
    const candles = new Array(PER_DAY);
    let open = raw.firstOpenNet + shift;
    for (let i = 0; i < PER_DAY; i++) {
      const path_ = new Array(SAMPLES);
      for (let s = 0; s < SAMPLES; s++) {
        const k = i * SAMPLES + s;
        path_[s] = { dn: raw.pathNet[k], bp: raw.pathBull[k], bq: raw.pathBear[k] };
      }
      candles[i] = {
        index: day * PER_DAY + i,
        openNet: open,
        closeNet: open + raw.bullWins[i] - raw.bearWins[i],
        hiNet: open + raw.hiUp[i],
        loNet: open - raw.loDown[i],
        bullWins: raw.bullWins[i], bearWins: raw.bearWins[i], draws: raw.draws[i],
        bullPts: raw.bullPts[i], bearPts: raw.bearPts[i],
        matches: raw.bullWins[i] + raw.bearWins[i] + raw.draws[i],
        path: path_,
      };
      open = candles[i].closeNet;
    }
    net = open;

    const enc = CODEC.encodeDay({ day, candles, samples: SAMPLES, key: CONFIG.record.key });
    const name = `day-${String(day).padStart(3, "0")}.txt`;
    fs.writeFileSync(path.join(outDir, name), enc.text);
    bytes += enc.bytes.length; chars += enc.text.length;

    /* read it straight back, every day, because a recording that decodes wrong
       is worse than no recording and this costs milliseconds */
    const back = CODEC.decodeDay(enc.text, { day, samples: SAMPLES, key: CONFIG.record.key });
    if (back.n !== PER_DAY || back.candles[0].openNet !== candles[0].openNet ||
        back.endNet !== net) {
      throw new Error(`day ${day} did not survive a round trip`);
    }

    const o = priceOf(candles[0].openNet), c = priceOf(net);
    const dBull = raw.bullWins.reduce((a, b) => a + b, 0);
    const dBear = raw.bearWins.reduce((a, b) => a + b, 0);
    const dDraw = raw.draws.reduce((a, b) => a + b, 0);
    totalDecided += dBull + dBear;
    totalDraws += dDraw;
    totalMatches += dBull + dBear + dDraw;
    totalPoints += raw.bullPts.reduce((a, b) => a + b, 0) + raw.bearPts.reduce((a, b) => a + b, 0);
    dayStats.push({
      day, openNet: candles[0].openNet, closeNet: net,
      open: o, close: c, move: (c - o) / o,
      bullWins: dBull, bearWins: dBear, draws: dDraw,
      bullPts: raw.bullPts.reduce((a, b) => a + b, 0),
      bearPts: raw.bearPts.reduce((a, b) => a + b, 0),
      bytes: enc.bytes.length, chars: enc.text.length,
    });
    if (day % 10 === 0 || day === DAYS - 1) {
      console.log(`day ${day}: ${(enc.text.length / 1024).toFixed(1)} KB  ` +
        `close ${c.toFixed(2)}  move ${(100 * (c - o) / o).toFixed(2)}%`);
    }
  }

  /* the tallies know how many bots actually played; the flag on this command
     line does not, and a manifest that says 10,000 about a 300-bot rehearsal is
     worse than no manifest */
  const tallies = fs.readdirSync(RAW).filter((f) => f.startsWith("tally-")).sort()
    .map((f) => JSON.parse(fs.readFileSync(path.join(RAW, f), "utf8")));

  const manifest = {
    version: 1,
    generated: new Date().toISOString(),
    bots: (tallies[0] && tallies[0].bots) || CONFIG.bots,
    settings: CONFIG.settings,
    epsilon: CONFIG.market.epsilon,
    startPrice: CONFIG.market.startPrice,
    candleMs: CANDLE_MS,
    sampleMs: CONFIG.market.sampleMs,
    samples: SAMPLES,
    candlesPerDay: PER_DAY,
    days: DAYS,
    totalCandles: total,
    /* what one full pass through the recording adds to the cumulative net wins.
       The loop is seamless because lap N simply opens N of these above zero —
       the price continues rather than snapping back to 10,000. */
    netPerLap: net,
    /* Two rates the phone needs and cannot work out for itself. A candle that
       is still forming knows its running points exactly and its win counts not
       at all — a point total does not divide into wins, because a win is worth
       1 to 25 — so the readout estimates them from the recording's own
       averages. Reading the candle's own eventual average would be more
       accurate and would be reading the future, which is the one thing the
       chart may never do. */
    meanPrint: totalPoints / Math.max(1, totalDecided),
    drawRate: totalDraws / Math.max(1, totalMatches),
    key: CONFIG.record.key,
  };
  fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 1));

  /* the raw material for the admin report, which is generated separately */
  fs.writeFileSync(path.join(RAW, "days.json"), JSON.stringify({ dayStats, tallies, manifest }));

  const moves = dayStats.map((d) => d.move);
  const mean = moves.reduce((a, b) => a + b, 0) / moves.length;
  const sd = Math.sqrt(moves.reduce((a, b) => a + (b - mean) * (b - mean), 0) / moves.length);
  const absSorted = moves.map(Math.abs).sort((a, b) => a - b);
  console.log("");
  console.log(`${DAYS} days written to ${A.out || CONFIG.record.dir}`);
  console.log(`  ${(bytes / DAYS / 1024).toFixed(1)} KB of packed bytes per day, ` +
    `${(chars / DAYS / 1024).toFixed(1)} KB per file on disk, ` +
    `${(chars / 1024 / 1024).toFixed(1)} MB for all ${DAYS}`);
  console.log(`  daily move: sd ${(100 * sd).toFixed(2)}%, ` +
    `median |move| ${(100 * absSorted[Math.floor(absSorted.length / 2)]).toFixed(2)}%, ` +
    `largest ${(100 * absSorted[absSorted.length - 1]).toFixed(2)}%`);
  console.log(`  price ${CONFIG.market.startPrice} -> ${priceOf(net).toFixed(2)} ` +
    `over the ${DAYS} days (net ${net} wins)`);
}

if (A.stitch) stitch();
else if (A.from !== undefined) recordDays(A.from, A.to === undefined ? A.from : A.to);
else {
  console.log("usage: --from N --to M --raw <dir>   |   --stitch --raw <dir>");
  process.exit(1);
}
