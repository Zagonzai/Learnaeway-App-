#!/usr/bin/env node
/* The simulator, from a terminal.
 *
 *   node sim/run.js                       one hour of market time, 10,000 bots
 *   node sim/run.js --minutes 180         three hours
 *   node sim/run.js --bots 2000           a smaller population
 *   node sim/run.js --seed 7              a different run (same seed, same run)
 *   node sim/run.js --replay <seed>       one match, played back card by card
 *   node sim/run.js --live                against the real clock, for ever
 *
 * The default run is the measurement: it prints how many matches finish per
 * five-minute candle, how long matches take, how the four styles do against each
 * other and how the two sides balance out. Those are the numbers the chart's
 * behaviour depends on, so they are checked rather than assumed.
 */
"use strict";

const CONFIG = require("./config.js");
const { Sim } = require("./sim.js");
const { playMatch } = require("./match.js");
const { STYLE_NAMES } = require("./styles.js");
const { onResult, submitResult } = require("./results.js");

/* ---- the command line ---- */
function args(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.slice(0, 2) !== "--") continue;
    const k = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.slice(0, 2) === "--") { o[k] = true; continue; }
    o[k] = isNaN(Number(next)) ? next : Number(next);
    i++;
  }
  return o;
}
const A = args(process.argv.slice(2));

/* Minutes of market time played before anybody is told about a result, so the
   first candle out is a steady-state candle rather than a cold start. */
const WARMUP_MIN = 20;

const pct = (n, of) => (of ? ((100 * n) / of).toFixed(1) + "%" : "—");
const mmss = (s) => `${Math.floor(s / 60)}m${String(Math.round(s % 60)).padStart(2, "0")}s`;
function quantiles(sorted, qs) {
  return qs.map((q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]);
}

/* ---- one match, replayed ---- */
if (A.replay !== undefined && A.replay !== true) {
  const m = playMatch({
    seed: Number(A.replay) >>> 0,
    bullStyle: A.bull || "smart",
    bearStyle: A.bear || "random",
    verbose: true,
  });
  console.log(`seed ${m.seed} — ${m.bullStyle} (Bull) v ${m.bearStyle} (Bear), ` +
              `${m.seat} in the player seat`);
  console.log(`${m.rounds} rounds, ${mmss(m.seconds)} of play`);
  m.chart.forEach((c) => {
    const d = c.close - c.open;
    console.log(`  r${String(c.round).padStart(2)}  ${String(c.open).padStart(4)} → ` +
                `${String(c.close).padStart(4)}  ${d > 0 ? "+" + d : d}` +
                `   ${c.you.type} v ${c.opp.type}`);
  });
  console.log("");
  m.log.forEach((l) => console.log("  " + l));
  console.log("");
  console.log(`==> ${m.winner === "draw" ? "a draw" : m.winner + " wins"}` +
              `, final Print ${m.print}, ${m.points} point${m.points === 1 ? "" : "s"} to the winner`);
  process.exit(0);
}

/* ---- the live service ----
   What the server runs: wake up, play the market forward to now, hand every
   finished match to the one door, sleep. The tick is a second because the chart
   wants the forming candle fresh to within a second or two; the work inside it
   is the same work however often it is called, so a longer tick is cheaper and a
   shorter one is not more accurate. */
if (A.live) {
  const warmup = A.warmup === undefined ? WARMUP_MIN : A.warmup;
  const now = Date.now();
  const sim = new Sim({
    seed: (A.seed >>> 0) || 1,
    startMs: now - warmup * 60 * 1000,
    config: { bots: A.bots || CONFIG.bots },
  });
  /* The warm-up, and it matters. A cold population is ten thousand bots all
     free at the same instant, so they all start at once and all finish within
     the same few minutes: the first candle would be empty and the second one
     five thousand matches tall. Starting the clock in the past and fast-
     forwarding to now scatters them, and the first candle the chart sees is a
     steady-state candle. Twenty minutes of market time is about forty thousand
     matches, which is a few seconds of CPU, paid once per restart. */
  const t0 = process.hrtime.bigint();
  sim.advanceTo(now);
  const warmSecs = Number(process.hrtime.bigint() - t0) / 1e9;
  console.log(`live: ${sim.bots.length} bots, seed ${sim.seed}, tick 1s.`);
  console.log(`warmed up over ${warmup} minutes of market time ` +
              `(${sim.stats.finished} matches, ${warmSecs.toFixed(1)}s of CPU). Ctrl-C to stop.`);
  const base = sim.stats.finished;
  sim.onResult = submitResult;      // from here on, the market hears about them
  const tick = () => {
    const t = process.hrtime.bigint();
    sim.advanceTo(Date.now());
    const us = Number(process.hrtime.bigint() - t) / 1000;
    process.stdout.write(`\r${new Date().toISOString().slice(11, 19)}  ` +
      `live finishes ${sim.stats.finished - base}  in flight ${sim.flight.size}  ` +
      `bull ${sim.stats.bullWins} bear ${sim.stats.bearWins} draw ${sim.stats.draws}  ` +
      `tick ${us.toFixed(0)}µs    `);
  };
  setInterval(tick, 1000);
  tick();
  return;
}

/* ---- the measured run ---- */
const minutes = A.minutes || 60;
const bots = A.bots || CONFIG.bots;
const seed = (A.seed >>> 0) || 1;

/* The clock starts on a five-minute boundary so the candle buckets line up with
   the wall clock the way the chart's do. */
const CANDLE_MS = 5 * 60 * 1000;
const start = Math.floor(Date.now() / CANDLE_MS) * CANDLE_MS;

const warmup = A.warmup === undefined ? WARMUP_MIN : A.warmup;
const results = [];
onResult((r) => results.push(r));

const sim = new Sim({
  seed, startMs: start - warmup * 60 * 1000,
  config: { bots },
});

console.log(`${bots} bots, ${minutes} minutes of market time, seed ${seed}`);
console.log(`(after ${warmup} minutes of warm-up, which is not counted)`);
console.log(`match: ${CONFIG.settings.points}-point target, ` +
            `${CONFIG.settings.perColour} of each wild colour`);
const styleCount = {};
sim.bots.forEach((b) => { styleCount[b.style] = (styleCount[b.style] || 0) + 1; });
console.log("styles: " + STYLE_NAMES.map((n) => `${n} ${styleCount[n] || 0}`).join(", "));
console.log("");

const w0 = process.hrtime.bigint();
sim.advanceTo(start);
const warmWall = Number(process.hrtime.bigint() - w0) / 1e9;
const warmStarted = sim.stats.started, warmFinished = sim.stats.finished;
sim.onResult = submitResult;      // only now does anything downstream hear about it

const t0 = process.hrtime.bigint();
sim.advanceTo(start + minutes * 60 * 1000);
const wall = Number(process.hrtime.bigint() - t0) / 1e9;

/* ---- what came out ---- */
const s = sim.stats;
console.log(`warm-up: ${warmStarted} matches in ${warmWall.toFixed(1)}s of CPU`);
console.log(`measured: ${s.started - warmStarted} matches played, ` +
            `${s.finished - warmFinished} finished inside the window`);
const played2 = Math.max(1, s.started - warmStarted);
console.log(`cpu ${wall.toFixed(2)}s  (${(played2 / wall / 1000).toFixed(1)}k matches/s, ` +
            `${(1e6 * wall / played2).toFixed(0)}µs each)`);
console.log(`  at this rate a 24-hour day costs ` +
            `${(wall * (24 * 60) / minutes / 60).toFixed(1)} minutes of CPU`);
console.log(`rss ${(process.memoryUsage().rss / 1048576).toFixed(0)} MB ` +
            `(this run keeps every result in memory to measure it; the live service does not)`);
console.log("");

/* finishes per five-minute candle: the number the chart lives or dies by */
const buckets = new Map();
results.forEach((r) => {
  const k = Math.floor(r.at / CANDLE_MS);
  buckets.set(k, (buckets.get(k) || 0) + 1);
});
const keys = [...buckets.keys()].sort((a, b) => a - b);
/* the last bucket is cut off by the end of the window, so it is shown and not
   counted; the first is whole, because the warm-up already happened */
const steady = keys.slice(0, -1).map((k) => buckets.get(k));
const mean = steady.length ? steady.reduce((a, b) => a + b, 0) / steady.length : 0;
console.log("finishes per 5-minute candle");
keys.forEach((k, i) => {
  const n = buckets.get(k);
  const mark = i === keys.length - 1 ? " (cut off by the end of the window)" : "";
  console.log(`  ${new Date(k * CANDLE_MS).toISOString().slice(11, 16)}  ` +
              `${String(n).padStart(5)}${mark}`);
});
console.log(`  mean ${mean.toFixed(0)} per candle over ${steady.length} whole candles ` +
            `(the brief expects about 4,000)`);
console.log("");

/* how long a match takes */
const secs = results.map((r) => r.seconds).sort((a, b) => a - b);
const [p5, p25, p50, p75, p95] = quantiles(secs, [0.05, 0.25, 0.5, 0.75, 0.95]);
const inBand = secs.filter((x) => x >= 120 && x <= 600).length;
console.log("match duration");
console.log(`  min ${mmss(secs[0])}   p5 ${mmss(p5)}   p25 ${mmss(p25)}   ` +
            `median ${mmss(p50)}   p75 ${mmss(p75)}   p95 ${mmss(p95)}   max ${mmss(secs[secs.length - 1])}`);
console.log(`  inside the 2–10 minute band: ${inBand} of ${secs.length} (${pct(inBand, secs.length)})`);
const rounds = results.map((r) => r.rounds).sort((a, b) => a - b);
console.log(`  rounds: median ${quantiles(rounds, [0.5])[0]}, ` +
            `p5 ${quantiles(rounds, [0.05])[0]}, p95 ${quantiles(rounds, [0.95])[0]}`);
console.log("");

/* the two sides, over the measured window only */
const side = { bull: 0, bear: 0, draw: 0, bullPts: 0, bearPts: 0 };
results.forEach((r) => {
  side[r.winner]++;
  if (r.winner === "bull") side.bullPts += r.points;
  else if (r.winner === "bear") side.bearPts += r.points;
});
const decided = side.bull + side.bear;
console.log("sides");
console.log(`  bull wins ${side.bull} (${pct(side.bull, results.length)})   ` +
            `bear wins ${side.bear} (${pct(side.bear, results.length)})   ` +
            `draws ${side.draw} (${pct(side.draw, results.length)})`);
console.log(`  points   bull ${side.bullPts}   bear ${side.bearPts}   ` +
            `mean per win ${(side.bullPts / Math.max(1, side.bull)).toFixed(1)} / ` +
            `${(side.bearPts / Math.max(1, side.bear)).toFixed(1)}`);
/* Price in Phase 2 is net wins, so this difference IS the price move over the
   window — and because the two sides are a coin flip it is a random walk, not a
   drift. One standard deviation of the walk over N decided matches is sqrt(N),
   which is the number to compare the observed gap against before calling it a
   bias. */
console.log(`  net bull−bear ${side.bull - side.bear} over ${decided} decided matches ` +
            `(one sd of an unbiased walk is ±${Math.sqrt(decided).toFixed(0)})`);
/* a bot on the player seat and a bot on the opponent seat are not handed quite
   the same game, so which seat won is worth watching: it has to be a coin flip,
   or the seat would show up on the chart as a side bias */
const seatWins = { player: 0, ai: 0 };
results.forEach((r) => {
  if (r.winner === "draw") return;
  /* r.seat names the side that sat in the engine's player seat, so the player
     seat took the match exactly when the winner is that side */
  seatWins[r.winner === r.seat ? "player" : "ai"]++;
});
console.log(`  player seat ${seatWins.player} (${pct(seatWins.player, seatWins.player + seatWins.ai)})` +
            `   opponent seat ${seatWins.ai}`);
console.log("");

/* alternation: no bot may play one side all day */
const runs = { ok: 0, bad: 0 };
const perBot = new Map();
results.forEach((r) => {
  [["bull", r.bull.id], ["bear", r.bear.id]].forEach(([side, id]) => {
    const prev = perBot.get(id);
    if (prev === side) runs.bad++; else runs.ok++;
    perBot.set(id, side);
  });
});
console.log("alternation");
console.log(`  consecutive matches on the same side: ${runs.bad} of ${runs.ok + runs.bad}` +
            `${runs.bad ? "  <== should be 0 inside a day" : "  (strict, as specified)"}`);
const played = sim.bots.map((b) => b.played).sort((a, b) => a - b);
console.log(`  matches per bot: median ${quantiles(played, [0.5])[0]}, ` +
            `min ${played[0]}, max ${played[played.length - 1]}`);
console.log("");

/* the four styles, against each other */
console.log("styles, by how often each wins the match it is in");
const tally = {};
STYLE_NAMES.forEach((n) => { tally[n] = { played: 0, won: 0, pts: 0 }; });
results.forEach((r) => {
  tally[r.bull.style].played++;
  tally[r.bear.style].played++;
  if (r.winner === "bull") { tally[r.bull.style].won++; tally[r.bull.style].pts += r.points; }
  else if (r.winner === "bear") { tally[r.bear.style].won++; tally[r.bear.style].pts += r.points; }
});
STYLE_NAMES.forEach((n) => {
  const t = tally[n];
  console.log(`  ${n.padEnd(11)} ${String(t.played).padStart(6)} played   ` +
              `${pct(t.won, t.played).padStart(6)} won   ` +
              `${(t.pts / Math.max(1, t.won)).toFixed(1)} points per win`);
});
console.log("");

/* reproducibility: pull one finished match back out by its seed alone */
const sample = results[Math.floor(results.length / 2)];
if (sample) {
  const again = playMatch({
    seed: sample.seed, bullStyle: sample.bull.style, bearStyle: sample.bear.style,
  });
  const same = again.winner === sample.winner && again.points === sample.points &&
               again.rounds === sample.rounds && again.seconds === sample.seconds;
  console.log(`replay of match #${sample.no} from seed ${sample.seed}: ` +
              (same ? "identical" : "DIFFERENT — the match is not reproducible"));
  console.log(`  ${sample.winner} by ${sample.points}, ${sample.rounds} rounds, ${mmss(sample.seconds)}`);
}
