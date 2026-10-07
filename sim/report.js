#!/usr/bin/env node
/* The admin report, generated offline from the whole 90-day recording.
 *
 *   node sim/report.js [--raw <dir>] [--es data/aeway/es-5m.csv]
 *
 * Writes data/aeway/report.json, which the admin page reads.
 *
 * ==> AGGREGATES ONLY, and that is a rule rather than a style. The recording is
 * scrambled so that a tester cannot read the afternoon's prices out of the
 * network tab; a report carrying 90 days of closes beside it would hand them
 * over in plaintext and make the scrambling pointless. So nothing here is a
 * series: everything is a distribution, a correlation or a count, and anything
 * the admin page needs the actual shape for — the CSV export, the wins-against-
 * points comparison — it builds for itself out of days that have already played.
 *
 * ---- what is measured ----
 *
 * Returns are the log change per five-minute candle, which in this market is
 * exactly ε × (Bull wins − Bear wins). No price is reconstructed to get them and
 * none has to be: the whole price series is a running total of integers.
 *
 * The ES column is empty until Mattia's Tradovate export is in the repository.
 * Drop it in as data/aeway/es-5m.csv with a header row naming at least
 * timestamp/date, open, high, low and close, and re-run this; the same functions
 * measure both, so the two columns are comparable by construction rather than by
 * assertion.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const CONFIG = require("./config.js");
const { priceOf } = require("./market.js");

function args(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.slice(0, 2) !== "--") continue;
    const k = a.slice(2), n = argv[i + 1];
    if (n === undefined || n.slice(0, 2) === "--") { o[k] = true; continue; }
    o[k] = n; i++;
  }
  return o;
}
const A = args(process.argv.slice(2));
const ROOT = path.join(__dirname, "..");
const RAW = A.raw ? path.resolve(A.raw) : path.join(ROOT, ".aeway-raw");
const OUT = path.join(ROOT, CONFIG.record.dir);
const ES = A.es ? path.resolve(A.es) : path.join(OUT, "es-5m.csv");

/* ---------------- the statistics ---------------- */

const mean = (a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
function moments(a) {
  const m = mean(a);
  let v = 0, k = 0;
  for (const x of a) { const d = x - m; v += d * d; k += d * d * d * d; }
  v /= Math.max(1, a.length); k /= Math.max(1, a.length);
  return { mean: m, sd: Math.sqrt(v), kurtosis: v > 0 ? k / (v * v) : 0 };
}
/* autocorrelation at a lag: does one candle's direction say anything about the
   next one's? A random walk answers no at every lag. */
function acf(a, lag) {
  const m = mean(a);
  let num = 0, den = 0;
  for (let i = 0; i < a.length; i++) {
    den += (a[i] - m) * (a[i] - m);
    if (i >= lag) num += (a[i] - m) * (a[i - lag] - m);
  }
  return den > 0 ? num / den : 0;
}
function quant(a, q) {
  const s = a.slice().sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * s.length)))];
}
/* how long the market keeps going the same way */
function streaks(dirs) {
  let best = 0, run = 0, prev = 0, total = 0, n = 0;
  for (const d of dirs) {
    if (d === 0) continue;
    if (d === prev) run++;
    else { if (run) { total += run; n++; best = Math.max(best, run); } run = 1; prev = d; }
  }
  if (run) { total += run; n++; best = Math.max(best, run); }
  return { meanStreak: n ? total / n : 0, maxStreak: best };
}
function correlation(a, b) {
  const ma = mean(a), mb = mean(b);
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < a.length; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) * (a[i] - ma);
    db += (b[i] - mb) * (b[i] - mb);
  }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0;
}

/* Everything the market-likeness section reports, from one series of candles.
   The same function measures ÆWAY and ES, so the two columns mean the same. */
function likeness(rets, ranges, perDay) {
  const m = moments(rets);
  const tail4 = rets.filter((r) => Math.abs(r) > 4 * m.sd).length / Math.max(1, rets.length);
  const abs = rets.map(Math.abs);
  const dirs = rets.map((r) => (r > 0 ? 1 : r < 0 ? -1 : 0));
  const st = streaks(dirs);
  /* daily moves, from the candles rather than from a second series */
  const days = [];
  for (let i = 0; i + perDay <= rets.length; i += perDay) {
    let s = 0;
    for (let k = 0; k < perDay; k++) s += rets[i + k];
    days.push(s);
  }
  return {
    candles: rets.length,
    sd: m.sd,
    kurtosis: m.kurtosis,
    tail4,
    acf: [1, 2, 3, 4, 5].map((l) => acf(rets, l)),
    volAcf: acf(abs, 1),
    meanStreak: st.meanStreak,
    maxStreak: st.maxStreak,
    medRange: quant(ranges, 0.5),
    p95Range: quant(ranges, 0.95),
    dailySd: moments(days).sd,
    days: days.length,
  };
}

/* The plain-English line the brief asks for. It is a reading of the three
   numbers that separate a random walk from a market: whether one candle
   predicts the next, whether big moves come in clusters, and whether the tails
   are fatter than a bell curve's. */
function summarise(m, es) {
  const trend = Math.abs(m.acf[0]) > 0.05;
  const cluster = m.volAcf > 0.08;
  const fat = m.kurtosis > 4;
  let line;
  if (!trend && !cluster && !fat) {
    line = "Behaves like a random walk: one candle says nothing about the next, " +
      "quiet and busy stretches do not clump, and the tails are no fatter than a bell curve's.";
  } else if (!trend && cluster) {
    line = "Shows volatility clustering: direction is still unpredictable candle to " +
      "candle, but busy stretches arrive together the way a real market's do.";
  } else if (trend && m.acf[0] > 0) {
    line = "Shows trends: a candle's direction carries into the next one, which a " +
      "pure coin-flip market would not do.";
  } else if (trend) {
    /* Worth naming rather than just reporting. Bots alternate sides every match,
       and the four play styles are not equally strong — Random wins 62% of its
       matches and Aggressive 32%. So a strong bot wins as Bull, rests, and wins
       again as Bear, contributing +1 and then −1 to the price. Strict
       alternation and unequal styles together are what pushes one candle to
       lean against the one before it.
       It is small, and short-horizon mean reversion is a thing real index
       futures do as well, so it is not obviously wrong — but it is an artefact
       of the matchmaking rather than anything anybody designed, and it would go
       away if the styles were levelled or the sides were drawn at random
       instead of alternated. */
    line = "Shows mild mean reversion: a candle leans against the one before it " +
      `(lag 1 = ${m.acf[0].toFixed(3)}), which comes from bots alternating sides ` +
      "while the play styles win at different rates — a strong bot wins as Bull, " +
      "then wins again as Bear.";
  } else {
    line = "Behaves like a random walk with fatter tails than a bell curve.";
  }
  if (es) {
    const near = (a, b2, tol) => Math.abs(a - b2) <= tol;
    line += near(m.kurtosis, es.kurtosis, 2) && near(m.volAcf, es.volAcf, 0.08)
      ? " On these measures it is close to real ES five-minute data."
      : " It is further from real ES five-minute data on tails and clustering — " +
        "a bot market has a constant number of players, and a real one does not.";
  } else {
    line += " No ES data to compare against yet.";
  }
  return line;
}

/* ---------------- the ÆWAY side ---------------- */

function readRecording() {
  const rets = [], ranges = [], netWins = [], netPts = [];
  let candles = 0, bullWins = 0, bearWins = 0, draws = 0, bullPts = 0, bearPts = 0;
  const eps = CONFIG.market.epsilon;
  const DAYS = Number(A.days) || CONFIG.record.days;
  for (let day = 0; day < DAYS; day++) {
    const f = path.join(RAW, `raw-${String(day).padStart(3, "0")}.json`);
    if (!fs.existsSync(f)) throw new Error(`missing ${f} — run sim/record.js first`);
    const r = JSON.parse(fs.readFileSync(f, "utf8"));
    for (let i = 0; i < r.n; i++) {
      const net = r.bullWins[i] - r.bearWins[i];
      /* the candle's return IS epsilon times its net wins — no price is
         reconstructed, because none was ever stored */
      rets.push(eps * net);
      ranges.push(eps * (r.hiUp[i] + r.loDown[i]));
      netWins.push(net);
      netPts.push(r.bullPts[i] - r.bearPts[i]);
      bullWins += r.bullWins[i]; bearWins += r.bearWins[i]; draws += r.draws[i];
      bullPts += r.bullPts[i]; bearPts += r.bearPts[i];
      candles++;
    }
  }
  return { rets, ranges, netWins, netPts, candles,
           bullWins, bearWins, draws, bullPts, bearPts };
}

function readTallies() {
  const files = fs.readdirSync(RAW).filter((f) => f.startsWith("tally-")).sort();
  if (!files.length) throw new Error(`no tally files in ${RAW}`);
  const t = { matches: 0, bull: 0, bear: 0, draw: 0, rounds: 0, seconds: 0,
    onTrack: 0, yoloNewsRounds: 0, yoloNewsDeciders: 0,
    pointsBull: 0, pointsBear: 0 };
  let rejected = 0;
  const rejects = [];
  for (const f of files) {
    const j = JSON.parse(fs.readFileSync(path.join(RAW, f), "utf8"));
    for (const k of Object.keys(t)) t[k] += j.tally[k] || 0;
    rejected += j.rejected || 0;
    (j.rejects || []).slice(0, 3).forEach((x) => rejects.push(x));
  }
  return { t, rejected, rejects };
}

/* ---------------- the ES side ---------------- */

function readEs(file) {
  if (!fs.existsSync(file)) return null;
  const text = fs.readFileSync(file, "utf8");
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 50) return null;
  const sep = lines[0].indexOf("\t") >= 0 ? "\t" : ",";
  const head = lines[0].toLowerCase().split(sep).map((h) => h.trim().replace(/^"|"$/g, ""));
  const find = (...names) => head.findIndex((h) => names.some((n) => h === n || h.includes(n)));
  const iO = find("open"), iH = find("high"), iL = find("low"), iC = find("close", "last");
  if (iO < 0 || iH < 0 || iL < 0 || iC < 0) {
    console.log(`  ${path.basename(file)}: could not find open/high/low/close in "${lines[0]}"`);
    return null;
  }
  const num = (s) => Number(String(s).replace(/[",$\s]/g, ""));
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(sep);
    const o = num(c[iO]), h = num(c[iH]), l = num(c[iL]), cl = num(c[iC]);
    if (![o, h, l, cl].every(Number.isFinite) || o <= 0) continue;
    rows.push({ o, h, l, c: cl });
  }
  if (rows.length < 50) return null;
  const rets = [], ranges = [];
  for (let i = 1; i < rows.length; i++) {
    const r = Math.log(rows[i].c / rows[i - 1].c);
    /* an overnight gap is not a five-minute move; the session breaks are
       dropped so the two columns are measuring the same kind of thing */
    if (Math.abs(r) > 0.05) continue;
    rets.push(r);
    ranges.push((rows[i].h - rows[i].l) / rows[i].o);
  }
  console.log(`  ES: ${rows.length} rows, ${rets.length} five-minute returns`);
  /* ES trades about 23 hours a day, so a day is roughly 276 five-minute bars */
  return likeness(rets, ranges, 276);
}

/* ---------------- put it together ---------------- */

const rec = readRecording();
const { t, rejected, rejects } = readTallies();
const es = readEs(ES);
const mine = likeness(rec.rets, rec.ranges, 288);
mine.es = es;
mine.summary = summarise(mine, es);
/* how closely the two ways of moving the price agree, candle by candle */
mine.winsVsPoints = correlation(rec.netWins, rec.netPts);

const decided = t.bull + t.bear;
const report = {
  version: 1,
  generated: new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC",
  days: Number(A.days) || CONFIG.record.days,
  candles: rec.candles,
  matches: t.matches,
  epsilon: CONFIG.market.epsilon,
  startPrice: CONFIG.market.startPrice,
  rejected,
  rejects: rejects.slice(0, 5),
  throughput: {
    matchesPerCandle: t.matches / Math.max(1, rec.candles),
    pointsPerCandle: (t.pointsBull + t.pointsBear) / Math.max(1, rec.candles),
    pointsPerWin: (t.pointsBull + t.pointsBear) / Math.max(1, decided),
  },
  balance: {
    bullRate: t.bull / Math.max(1, t.matches),
    bearRate: t.bear / Math.max(1, t.matches),
    drawRate: t.draw / Math.max(1, t.matches),
    meanRounds: t.rounds / Math.max(1, t.matches),
    meanSeconds: t.seconds / Math.max(1, t.matches),
    onTrackRate: t.onTrack / Math.max(1, t.matches),
    yoloNewsPerMatch: t.yoloNewsRounds / Math.max(1, t.matches),
    yoloNewsDeciderRate: t.yoloNewsDeciders / Math.max(1, t.matches),
    pointsBull: t.pointsBull,
    pointsBear: t.pointsBear,
  },
  likeness: mine,
};

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 1));

const pc = (x) => (100 * x).toFixed(2) + "%";
console.log(`\nreport.json written — ${rec.candles.toLocaleString()} candles, ` +
  `${t.matches.toLocaleString()} matches`);
console.log(`  Bull ${pc(report.balance.bullRate)} · Bear ${pc(report.balance.bearRate)} · ` +
  `draws ${pc(report.balance.drawRate)}` +
  (Math.max(report.balance.bullRate, report.balance.bearRate) > 0.52 ? "   <== over 52%" : ""));
console.log(`  typical day ${pc(mine.dailySd)} · 5-minute sd ${pc(mine.sd)} · ` +
  `kurtosis ${mine.kurtosis.toFixed(2)} (3 is a bell curve)`);
console.log(`  autocorrelation lag 1 ${mine.acf[0].toFixed(4)} · ` +
  `volatility clustering ${mine.volAcf.toFixed(4)}`);
console.log(`  wins and points agree candle to candle at r = ${mine.winsVsPoints.toFixed(3)}`);
console.log(`  price ${CONFIG.market.startPrice} -> ` +
  `${priceOf(rec.bullWins - rec.bearWins).toFixed(2)} over the recording`);
/* ---- what ε should be ----
   The formula in config.js assumes the daily move is the square root of the
   number of decided matches, which assumes one candle says nothing about the
   next. This market very nearly obeys that and not quite — the lag-1
   autocorrelation is small but not zero, and a market that leans against itself
   moves less in a day than the square root says. So the number is checked
   against the recording and corrected, which is one line in config.js followed
   by `node sim/record.js --stitch`: the day files hold integers and ε only
   turns integers into prices, so nothing has to be simulated again. */
const want = CONFIG.market.targetDailyMove;
const suggested = CONFIG.market.epsilon * (want / Math.max(1e-9, mine.dailySd));
const off = Math.abs(mine.dailySd - want) / want;
console.log(`  typical day is ${(100 * mine.dailySd).toFixed(3)}% against a target of ` +
  `${(100 * want).toFixed(2)}%` + (off < 0.05 ? " — within 5%, leave epsilon alone"
    : `\n  ==> set market.epsilon to ${suggested.toPrecision(4)} in sim/config.js ` +
      `(it is ${CONFIG.market.epsilon}) and re-run --stitch`));
console.log(`  ${mine.summary}`);
if (rejected) console.log(`  ${rejected} results were REFUSED by the market — see report.json`);
