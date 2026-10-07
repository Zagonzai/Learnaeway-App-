/* Ten thousand bots, playing Pointæway against each other, for ever.
 *
 * The expensive way to do this would be to play the matches in real time: ten
 * thousand matches in flight, each one waking up every fifteen seconds to put a
 * card down. The cheap way, and the one the brief asks for, is to notice that
 * nobody can watch a bot match. So a match is played the instant it starts —
 * whole, to the last card, in about a tenth of a millisecond — and then the only
 * thing left on the clock is *when it would have finished*. The chart reacts to
 * that moment and nothing else.
 *
 * Which turns ten thousand live matches into a sorted list of future timestamps,
 * and a day of market activity into a few seconds of CPU.
 *
 * The shape of it:
 *
 *   - every bot is on exactly one of two queues, the one for bots due to play
 *     Bull and the one for bots due to play Bear, ordered by when they are next
 *     free. A match is the head of each queue.
 *   - a bot switches side every match, so a match takes one bot off each queue
 *     and puts one back on each. The two queues therefore stay the same size for
 *     ever, which is what makes the matchmaking never starve.
 *   - advanceTo(t) walks starts and finishes in time order up to t. Results come
 *     out in the order they finished, because that is the only order the chart
 *     can use.
 */
"use strict";

const CONFIG = require("./config.js");
const { playMatch } = require("./match.js");
const { STYLE_NAMES } = require("./styles.js");
const { rngFrom, seedFor, intIn } = require("./rng.js");

/* ---- a binary heap, because ten thousand of anything wants one ----
   Sorting the queue after every match would be 10,000 log 10,000 per match
   instead of log 10,000, which is the difference between a second of CPU a day
   and an hour of it. */
class Heap {
  constructor(key) { this.a = []; this.key = key; }
  get size() { return this.a.length; }
  peek() { return this.a[0]; }
  push(v) {
    const a = this.a; a.push(v);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.key(a[p]) <= this.key(a[i])) break;
      const t = a[p]; a[p] = a[i]; a[i] = t; i = p;
    }
  }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (!a.length) return top;
    a[0] = last;
    let i = 0;
    for (;;) {
      const l = 2 * i + 1, r = l + 1;
      let m = i;
      if (l < a.length && this.key(a[l]) < this.key(a[m])) m = l;
      if (r < a.length && this.key(a[r]) < this.key(a[m])) m = r;
      if (m === i) break;
      const t = a[m]; a[m] = a[i]; a[i] = t; i = m;
    }
    return top;
  }
  drain() { const out = this.a; this.a = []; return out; }
}

/* ---- which Eastern day a moment falls in ----
   The brief puts the market's day boundary at midnight Eastern, and every bot
   re-flips its side when it crosses one, so this is asked twice per match —
   210 million times over a 90-day recording.

   Asking Intl that many times is not viable: a toLocaleDateString per call made
   the recorder three and a half times slower than the card game it was
   recording, which is to say the simulator spent most of its life formatting
   dates. So the answer is cached as a half-open window of milliseconds and the
   common case is one numeric comparison. Intl is consulted twice per day
   boundary instead — about 180 times for the whole recording.

   The window is found by asking for the next midnight rather than adding 24
   hours, because two days a year are 23 and 25 hours long and a market that
   re-flipped its sides an hour late twice a year would be a bug nobody would
   ever find. The day's key is the millisecond its own midnight falls on, which
   is unique per day and compares as a number. */
const EASTERN = "America/New_York";
const EAST_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: EASTERN, year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
});
/* the Eastern wall clock at `ms`, as numbers */
function easternParts(ms) {
  const p = {};
  for (const { type, value } of EAST_FMT.formatToParts(ms)) {
    if (type !== "literal") p[type] = +value;
  }
  /* 24:00:00 is how some engines render midnight in this format */
  if (p.hour === 24) p.hour = 0;
  return p;
}
/* the moment Eastern midnight last happened at or before `ms` */
function easternMidnight(ms) {
  const p = easternParts(ms);
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const offset = wall - Math.floor(ms / 1000) * 1000;   // + to read UTC as Eastern
  let guess = Date.UTC(p.year, p.month - 1, p.day) - offset;
  /* That applies the offset in force at `ms` to a moment sixteen hours earlier,
     which is right on 363 days a year and an hour out on the two the clocks
     change — the guess lands at 23:00 the evening before, or at 01:00. So it is
     checked rather than trusted: read the Eastern wall clock at the guess and,
     if it is not midnight, move by however far off it is. One extra Intl call
     per day boundary, and the two awkward days come out right. */
  const q = easternParts(guess);
  const off = ((q.hour * 60 + q.minute) * 60 + q.second) * 1000;
  if (off) guess -= off > 12 * 3600 * 1000 ? off - 86400000 : off;
  return guess;
}
let dayFrom = 0, dayTo = -1;
function easternDay(ms) {
  if (ms >= dayFrom && ms < dayTo) return dayFrom;
  dayFrom = easternMidnight(ms);
  /* 36 hours on is certainly inside the next day however long this one was */
  dayTo = easternMidnight(dayFrom + 36 * 3600 * 1000);
  return dayFrom;
}

class Sim {
  /* `seed` makes the whole run reproducible: the population, the sides, the rest
     times and every match's own seed are derived from it, so a run can be
     repeated exactly and any single match inside it pulled out and replayed. */
  constructor(opts) {
    const o = opts || {};
    this.config = Object.assign({}, CONFIG, o.config);
    this.seed = (o.seed >>> 0) || 1;
    this.now = o.startMs || Date.now();
    this.settings = o.settings || this.config.settings;
    this.onResult = o.onResult || function () {};
    this.rnd = rngFrom(this.seed);

    this.matchNo = 0;
    this.day = easternDay(this.now);

    /* the two queues, and the matches in flight */
    this.queue = { bull: new Heap((b) => b.readyAt), bear: new Heap((b) => b.readyAt) };
    this.flight = new Heap((m) => m.finishAt);

    this.bots = new Array(this.config.bots);
    const styles = [];
    STYLE_NAMES.forEach((n) => {
      const share = (this.config.styles[n] && this.config.styles[n].share) || 0;
      for (let i = 0; i < share; i++) styles.push(n);
    });
    for (let i = 0; i < this.bots.length; i++) {
      /* A style per bot, drawn at random so the shares are the configured ones
         without the population being a repeating pattern of four. */
      const bot = {
        id: i,
        style: styles[Math.floor(this.rnd() * styles.length)],
        /* the coin flip for the first match of the day */
        side: this.rnd() < 0.5 ? "bull" : "bear",
        day: this.day,
        readyAt: this.now,
        played: 0,
      };
      this.bots[i] = bot;
      this.queue[bot.side].push(bot);
    }

    this.stats = {
      started: 0, finished: 0,
      bullWins: 0, bearWins: 0, draws: 0,
      bullPoints: 0, bearPoints: 0,
      rounds: 0, seconds: 0,
    };
  }

  /* Where a bot goes after a match. The side it plays next follows the bot and
     not the clock: strict alternation, so skipping a week of market time changes
     nothing about which side it is due. A new day is the one thing that resets
     it, and then only to another coin flip. */
  _requeue(bot, finishedAt) {
    const day = easternDay(finishedAt);
    if (day !== bot.day) {
      bot.day = day;
      bot.side = this.rnd() < 0.5 ? "bull" : "bear";
    } else {
      bot.side = bot.side === "bull" ? "bear" : "bull";
    }
    const rest = intIn(this.rnd, this.config.rest.min, this.config.rest.max);
    bot.readyAt = finishedAt + rest * 1000;
    bot.played++;
    this.queue[bot.side].push(bot);
  }

  /* Everybody on a queue whose day has turned over. A bot already in a match
     keeps its stamp and is dealt with in _requeue; this is for the ones sitting
     and waiting when midnight passes. */
  _rollDay(day) {
    this.day = day;
    ["bull", "bear"].forEach((side) => {
      const waiting = this.queue[side].drain();
      waiting.forEach((bot) => {
        bot.day = day;
        bot.side = this.rnd() < 0.5 ? "bull" : "bear";
        this.queue[bot.side].push(bot);
      });
    });
  }

  _nextStart() {
    const b = this.queue.bull.peek(), r = this.queue.bear.peek();
    if (!b || !r) return Infinity;
    return Math.max(b.readyAt, r.readyAt);
  }

  _start(at) {
    const bull = this.queue.bull.pop();
    const bear = this.queue.bear.pop();
    this.matchNo++;
    const seed = seedFor(this.seed, this.matchNo);
    const res = playMatch({
      seed, settings: this.settings,
      bullStyle: bull.style, bearStyle: bear.style,
    });
    const finishAt = at + Math.round(res.seconds * 1000);
    this.flight.push({ finishAt, startedAt: at, res, bull, bear, no: this.matchNo });
    this.stats.started++;
  }

  _finish(m) {
    const { res } = m;
    const s = this.stats;
    s.finished++;
    s.rounds += res.rounds;
    s.seconds += res.seconds;
    if (res.winner === "bull") { s.bullWins++; s.bullPoints += res.points; }
    else if (res.winner === "bear") { s.bearWins++; s.bearPoints += res.points; }
    else s.draws++;

    this.onResult({
      source: "bot",
      at: m.finishAt,
      startedAt: m.startedAt,
      no: m.no,
      seed: res.seed,
      winner: res.winner,
      points: res.points,
      print: res.print,
      rounds: res.rounds,
      seconds: res.seconds,
      seat: res.seat,
      /* carried through for the admin report's balance section */
      onTrack: res.onTrack,
      yoloNews: res.yoloNews,
      yoloNewsDecider: res.yoloNewsDecider,
      /* enough to replay it and nothing more: the seed plus the two styles is the
         whole match, and the two bot ids are who to credit it to */
      bull: { id: m.bull.id, style: res.bullStyle },
      bear: { id: m.bear.id, style: res.bearStyle },
    });

    this._requeue(m.bull, m.finishAt);
    this._requeue(m.bear, m.finishAt);
  }

  /* Walk the market forward to `to`, in the order things actually happened.
     A finish is always taken before a start at the same instant, because a bot
     has to finish before it can rest, and resting is what puts it back in a
     queue that a start reads from. */
  advanceTo(to) {
    for (;;) {
      const nextFinish = this.flight.size ? this.flight.peek().finishAt : Infinity;
      const nextStart = this._nextStart();
      const t = Math.min(nextFinish, nextStart);
      if (t > to || t === Infinity) break;

      /* midnight, Eastern: the bots waiting at that moment re-flip their side */
      const day = easternDay(t);
      if (day !== this.day) this._rollDay(day);

      if (nextFinish <= nextStart) this._finish(this.flight.pop());
      else this._start(nextStart);
    }
    this.now = to;
  }
}

module.exports = { Sim, Heap, easternDay };
