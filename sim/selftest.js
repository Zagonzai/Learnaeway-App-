#!/usr/bin/env node
/* The simulator's own guard. `node sim/selftest.js`
 *
 * The app's Pointæway tests run in a browser against the screen; these run here,
 * against the rules and the scheduler, and they check the things a chart cannot
 * survive being wrong about:
 *
 *   - no result is ever anything but a whole number of points in range. A NaN
 *     Print reached the market once in about a hundred matches before the
 *     Class-D fix in js/pw-rules.js, and a price that has been added to NaN once
 *     is NaN for ever.
 *   - a seed replays exactly, or no result can be audited.
 *   - a bot never plays the same side twice running inside a day.
 *   - results arrive in the order they finished, because that is the only order
 *     candles can be built in.
 *   - the one door turns away anything that is not a bot, for now.
 */
"use strict";

const R = require("../js/pw-rules.js");
const CONFIG = require("./config.js");
const { playMatch } = require("./match.js");
const { STYLE_NAMES } = require("./styles.js");
const { Sim, easternDay } = require("./sim.js");
const { submitResult, onResult } = require("./results.js");
const { rngFrom } = require("./rng.js");
const { Market, priceOf, colourOf, badReason, SAMPLES, CANDLE_MS } = require("./market.js");
const CODEC = require("../js/aeway-codec.js");

let pass = 0, fail = 0;
function ok(cond, what, detail) {
  if (cond) { pass++; console.log(`PASS  ${what}${detail ? "  — " + detail : ""}`); }
  else { fail++; console.log(`FAIL  ${what}${detail ? "  — " + detail : ""}`); }
}

/* ---- the rules, straight ---- */
{
  /* the bug that started this: a Class-D card that reaches the resolver as
     itself must wash, not win with a point value it does not have */
  const five = { kind: "tier", type: "Bullish Marubozu", pts: 5, id: "a" };
  let allWash = true, details = [];
  ["Discipline", "YOLO", "Diamond Hands"].forEach((t) => {
    const bare = Object.assign({}, R.SPEC[t], { kind: "special", id: "b" });
    const r = R.resolveRound(five, bare, "bull", "bear", 0);
    if (r.outcome !== "wash" || r.candleDelta !== 0) { allWash = false; details.push(`${t}: ${r.outcome} ${r.candleDelta}`); }
  });
  ok(allWash, "a bare Class-D card washes the round rather than scoring", details.join(", "));
}

/* ---- every style pairing, every result in range ---- */
{
  let n = 0, worst = null;
  const seen = { bull: 0, bear: 0, draw: 0 };
  for (const a of STYLE_NAMES) for (const b of STYLE_NAMES) {
    for (let s = 1; s <= 400; s++) {
      const m = playMatch({ seed: s * 7919 + 1, bullStyle: a, bearStyle: b });
      n++;
      seen[m.winner]++;
      const good = Number.isInteger(m.points) && m.rounds >= 1 && m.seconds > 0 &&
        (m.winner === "draw" ? m.points === 0 && m.print === 0
                             : m.points >= 1 && m.points <= CONFIG.settings.points);
      if (!good && !worst) worst = m;
    }
  }
  ok(!worst, `${n} matches over all 16 style pairings give a whole 1..25 result`,
     worst ? JSON.stringify(worst) : `bull ${seen.bull} bear ${seen.bear} draw ${seen.draw}`);
  ok(seen.draw > 0 && seen.bull > 0 && seen.bear > 0,
     "all three outcomes occur", `draws ${seen.draw}`);
}

/* ---- a seed is the match ---- */
{
  const opts = { seed: 20260407, bullStyle: "smart", bearStyle: "patient", verbose: true };
  /* Card ids are handed out from one counter for the life of the process, so the
     second playing of a match numbers its cards differently — they are handles,
     compared only with each other and only inside a match, and nothing about the
     game reads them. Everything else has to be identical, so everything else is
     what is compared. */
  const same = (m) => JSON.stringify(m, (k, v) => (k === "id" ? undefined : v));
  const a = playMatch(opts), b = playMatch(opts);
  ok(same(a) === same(b),
     "the same seed replays the same match, cards, Print and log alike",
     `${a.rounds} rounds, ${a.winner} by ${a.points}`);
  /* and a different seed does not, or the seed is not doing anything */
  const c = playMatch(Object.assign({}, opts, { seed: 20260408 }));
  ok(same(c) !== same(a), "a different seed gives a different match");
}

/* ---- the injected generator is the only source of randomness ---- */
{
  /* Math.random is replaced with something that throws: if any part of a match
     reaches for it instead of the seeded stream, this test is how we find out */
  const real = Math.random;
  let leaked = false;
  Math.random = () => { leaked = true; return 0.5; };
  try { playMatch({ seed: 99, bullStyle: "random", bearStyle: "smart" }); }
  finally { Math.random = real; }
  ok(!leaked, "a seeded match never touches Math.random");
}

/* ---- the scheduler ---- */
{
  const CANDLE = 5 * 60 * 1000;
  const start = Math.floor(Date.UTC(2026, 3, 7, 14, 0, 0) / CANDLE) * CANDLE;
  const got = [];
  const off = onResult((r) => got.push(r));
  const sim = new Sim({ seed: 4, startMs: start, config: { bots: 1200 }, onResult: submitResult });
  sim.advanceTo(start + 40 * 60 * 1000);
  off();

  ok(got.length > 0, "the scheduler produces finished matches", `${got.length} in 40 minutes`);

  let ordered = true;
  for (let i = 1; i < got.length; i++) if (got[i].at < got[i - 1].at) ordered = false;
  ok(ordered, "results arrive in the order they finished");

  const last = new Map();
  let repeat = 0;
  got.forEach((r) => {
    [["bull", r.bull.id], ["bear", r.bear.id]].forEach(([sd, id]) => {
      if (last.get(id) === sd) repeat++;
      last.set(id, sd);
    });
  });
  ok(repeat === 0, "no bot plays the same side twice running", `${repeat} repeats`);

  /* every match is one bot due Bull against one due Bear, and never a bot
     against itself */
  const selfPlay = got.filter((r) => r.bull.id === r.bear.id).length;
  ok(selfPlay === 0, "no bot is ever matched against itself");

  /* the queues stay balanced for ever, which is what stops matchmaking starving */
  const q = sim.queue.bull.size + sim.queue.bear.size + 2 * sim.flight.size;
  ok(q === sim.bots.length, "every bot is accounted for: queued or in a match",
     `${sim.queue.bull.size} bull + ${sim.queue.bear.size} bear + ${sim.flight.size} in flight`);

  /* skipping time must not change which side a bot is due next */
  const a = new Sim({ seed: 11, startMs: start, config: { bots: 300 } });
  const b = new Sim({ seed: 11, startMs: start, config: { bots: 300 } });
  a.advanceTo(start + 30 * 60 * 1000);
  b.advanceTo(start + 10 * 60 * 1000);
  b.advanceTo(start + 20 * 60 * 1000);
  b.advanceTo(start + 30 * 60 * 1000);
  const sidesOf = (sim) => sim.bots.map((x) => x.side).join("");
  ok(sidesOf(a) === sidesOf(b),
     "advancing in one step or three leaves every bot on the same side");
  ok(a.stats.finished === b.stats.finished && a.stats.bullWins === b.stats.bullWins,
     "and with the same results", `${a.stats.finished} / ${b.stats.finished}`);
}

/* ---- the day boundary ---- */
{
  /* 03:30 UTC is 23:30 Eastern in April, so a window that ends after 04:00 UTC
     has crossed midnight Eastern */
  const before = Date.UTC(2026, 3, 8, 3, 30, 0);
  const after = Date.UTC(2026, 3, 8, 4, 30, 0);
  ok(easternDay(before) !== easternDay(after),
     "the day turns over at midnight Eastern",
     `${new Date(easternDay(before)).toISOString()} -> ${new Date(easternDay(after)).toISOString()}`);
  /* and the cache has to be right going backwards as well as forwards, or a
     result arriving slightly out of order would be filed under the wrong day */
  ok(easternDay(before) === easternDay(before - 3600 * 1000) &&
     easternDay(after) === easternDay(after + 3600 * 1000),
     "the cached day window holds either side of a reading");
  /* the 23-hour day: Eastern clocks go forward at 2am on 8 March 2026 */
  const dstDay = easternDay(Date.UTC(2026, 2, 8, 12, 0, 0));
  const dstNext = easternDay(Date.UTC(2026, 2, 9, 12, 0, 0));
  ok(dstNext - dstDay === 23 * 3600 * 1000,
     "a spring-forward day is 23 hours, not 24",
     `${(dstNext - dstDay) / 3600000} hours`);
}

/* ---- the one door ---- */
{
  let threw = null;
  try { submitResult({ source: "human", winner: "bull", points: 5 }); }
  catch (e) { threw = e.message; }
  ok(!!threw, "a human result is refused while the market only accepts bots", threw);

  threw = null;
  try { submitResult({ source: "bot", winner: "sideways", points: 5 }); }
  catch (e) { threw = e.message; }
  ok(!!threw, "a result with no winner is refused", threw);
}

/* ---- the generator itself ---- */
{
  const r = rngFrom(12345);
  const xs = []; for (let i = 0; i < 200000; i++) xs.push(r());
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const inRange = xs.every((x) => x >= 0 && x < 1);
  ok(inRange && Math.abs(mean - 0.5) < 0.01,
     "the seeded generator is uniform on [0,1)", `mean ${mean.toFixed(4)}`);
  ok(rngFrom(0)() === rngFrom(1)(), "seed 0 is nudged to 1 rather than sticking at zero");
}

/* ---- the market refuses what it cannot price ---- */
{
  const bad = [];
  const m = new Market({ onReject: (x) => bad.push(x.reason) });
  const t = Date.UTC(2026, 4, 1, 12, 0, 0);
  const takes = [
    [{ source: "bot", at: t, winner: "bull", points: 7 }, true, "a normal win"],
    [{ source: "bot", at: t, winner: "draw", points: 0 }, true, "a draw"],
    [{ source: "bot", at: t, winner: "bull", points: NaN }, false, "a NaN Print"],
    [{ source: "bot", at: t, winner: "bull", points: Infinity }, false, "an infinite Print"],
    [{ source: "bot", at: t, winner: "bull", points: 0 }, false, "a win worth nothing"],
    [{ source: "bot", at: t, winner: "bull", points: 26 }, false, "a win worth more than 25"],
    [{ source: "bot", at: t, winner: "bull", points: 7.5 }, false, "half a point"],
    [{ source: "bot", at: t, winner: "draw", points: 4 }, false, "a draw worth something"],
    [{ source: "bot", at: t, winner: "sideways", points: 4 }, false, "no winner"],
    [{ source: "bot", at: NaN, winner: "bull", points: 4 }, false, "no finish time"],
  ];
  let wrong = null;
  for (const [r, want, what] of takes) {
    if (m.submit(r) !== want) wrong = what;
  }
  ok(!wrong, "the market prices only a finite whole 1..25 result and refuses the rest",
     wrong ? `it got ${wrong} wrong` : `${m.accepted} taken, ${m.rejected} refused`);
  ok(bad.length === m.rejected && bad.every((x) => typeof x === "string" && x.length),
     "and every refusal is logged with a reason", bad[2]);
  ok(badReason({ source: "bot", at: t, winner: "bull", points: NaN }) !== null,
     "NaN does not slip through a range test, which is how the last one hid");
}

/* ---- candles ---- */
{
  const candles = [];
  const m = new Market({ onCandle: (c) => candles.push(c) });
  const t0 = Math.floor(Date.UTC(2026, 4, 1, 12, 0, 0) / CANDLE_MS) * CANDLE_MS;
  /* one candle with more Bull wins, one dead level, one with more Bear */
  /* in finish order, which is the order the market is given them in */
  const feed = [];
  const add = (off, w, p) => feed.push({ source: "bot", at: t0 + off, winner: w, points: p });
  for (let i = 0; i < 7; i++) add(1000 + i * 9000, "bull", 5);
  for (let i = 0; i < 4; i++) add(2000 + i * 9000, "bear", 9);
  for (let i = 0; i < 3; i++) add(CANDLE_MS + 1000 + i * 9000, "bull", 4);
  for (let i = 0; i < 3; i++) add(CANDLE_MS + 2000 + i * 9000, "bear", 20);
  for (let i = 0; i < 5; i++) add(2 * CANDLE_MS + 1000 + i * 9000, "bear", 6);
  add(2 * CANDLE_MS + 60000, "draw", 0);
  feed.sort((x, y) => x.at - y.at).forEach((r) => m.submit(r));
  m.flush();

  ok(candles.length === 3, "one candle per five minutes", `${candles.length}`);
  const [a, b, c] = candles;
  ok(colourOf(a) === "up" && colourOf(b) === "flat" && colourOf(c) === "down",
     "colour follows the win counts", `${colourOf(a)} ${colourOf(b)} ${colourOf(c)}`);
  ok(priceOf(b.closeNet) === priceOf(b.openNet),
     "equal wins leave the price exactly where it started — a doji to the last bit",
     `${priceOf(b.openNet)} -> ${priceOf(b.closeNet)}`);
  ok(b.bullPts === 12 && b.bearPts === 60,
     "and a level candle can still carry very different volume each way",
     `bull ${b.bullPts} v bear ${b.bearPts} points`);
  ok(a.closeNet === b.openNet && b.closeNet === c.openNet,
     "each candle opens where the last one closed");
  ok(candles.every((x) => x.path.length === SAMPLES &&
       x.path[SAMPLES - 1].dn === x.bullWins - x.bearWins &&
       x.path[SAMPLES - 1].bp === x.bullPts && x.path[SAMPLES - 1].bq === x.bearPts),
     "the last sample of a candle is its close");
  ok(candles.every((x) => {
       for (let i = 1; i < SAMPLES; i++) {
         if (x.path[i].bp < x.path[i - 1].bp || x.path[i].bq < x.path[i - 1].bq) return false;
       }
       return true;
     }), "and the running points never go backwards");
  ok(c.draws === 1 && c.matches === 6, "a draw counts as a match and moves nothing",
     `${c.matches} matches, ${c.draws} drawn, net ${c.closeNet - c.openNet}`);

  /* a result that arrives for a ten seconds already published is refused */
  const late = [];
  const m2 = new Market({ onReject: (x) => late.push(x.reason) });
  m2.submit({ source: "bot", at: t0 + 100000, winner: "bull", points: 5 });
  const took = m2.submit({ source: "bot", at: t0 + 20000, winner: "bear", points: 5 });
  ok(!took && late.length === 1, "a result that arrives behind the samples already written is refused",
     late[0]);

  /* ---- and it survives a round trip through the file format ---- */
  const pad = [];
  for (let i = 0; i < 288; i++) pad.push(candles[i % 3]);
  const fixed = pad.map((x, i) => Object.assign({}, x, { index: i }));
  let open = 0;
  for (const x of fixed) {
    x.openNet = open; x.closeNet = open + x.bullWins - x.bearWins;
    x.hiNet = Math.max(x.openNet, x.closeNet); x.loNet = Math.min(x.openNet, x.closeNet);
    open = x.closeNet;
  }
  const enc = CODEC.encodeDay({ day: 3, candles: fixed, samples: SAMPLES, key: "k" });
  const back = CODEC.decodeDay(enc.text, { day: 3, samples: SAMPLES, key: "k" });
  ok(back.n === 288 && back.endNet === open &&
     back.candles.every((x, i) => x.bullWins === fixed[i].bullWins &&
       x.bearWins === fixed[i].bearWins && x.bullPts === fixed[i].bullPts &&
       x.bearPts === fixed[i].bearPts && x.draws === fixed[i].draws &&
       x.openNet === fixed[i].openNet),
     "a day survives being written and read back", `${enc.bytes.length} bytes`);
  let threw = null;
  try { CODEC.decodeDay(enc.text, { day: 4, samples: SAMPLES, key: "k" }); }
  catch (e) { threw = e.message; }
  ok(!!threw, "and a file read as the wrong day is refused rather than drawn", threw);
  threw = null;
  try { CODEC.decodeDay(enc.text, { day: 3, samples: SAMPLES, key: "wrong" }); }
  catch (e) { threw = e.message; }
  ok(!!threw, "as is one descrambled with the wrong key", threw);
}

console.log("");
console.log(fail ? `${fail} FAILED, ${pass} passed` : `ALL PASS (${pass})`);
process.exit(fail ? 1 : 0);
