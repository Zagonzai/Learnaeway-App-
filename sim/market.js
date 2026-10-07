/* The ÆWAY market: finished matches in, candles out.
 *
 * One function takes a finished match and that is the only way price ever
 * moves. `results.js` is the door; this is what is behind it.
 *
 * ---- price is a log-space walk ----
 *
 * A Bull win adds ε to the log of the price and a Bear win takes ε off it. So:
 *
 *   - the price is a product of ratios rather than a sum of steps, which means
 *     it can get arbitrarily small but can never reach or cross zero;
 *   - a move is a percentage, so the chart reads the same at 9,000 as at
 *     90,000, and the brief's "never below zero" is a property of the
 *     arithmetic rather than a clamp bolted on afterwards;
 *   - equal wins leave the log price exactly where it started, so an equal
 *     candle is a doji to the last decimal place and not merely close to one.
 *
 * ε is tuned so a typical day moves about one percent. Net wins over a day are
 * a fair coin walk, so their standard deviation is the square root of the
 * number of decided matches, and the day's log move is ε times that:
 *
 *   ε = 0.01 / sqrt(decided matches per day) = 0.01 / sqrt(1,130,000) ≈ 9.4e-6
 *
 * The count comes from Phase 1's measurements: 4,050 matches finish per
 * five-minute candle, 288 candles a day, 96.9% of them decided. It is in
 * config.js as one number, with that arithmetic beside it.
 *
 * ---- colour comes from the wins, not from the price ----
 *
 * A candle is green when Bulls won more matches in it, and because the price is
 * a monotonic function of net wins those two can never disagree. The colour is
 * still taken from the win counts rather than from the rounded close, because a
 * displayed price has been through a rounding step and a win count has not.
 */
"use strict";

const CONFIG = require("./config.js");

const M = CONFIG.market;
const CANDLE_MS = M.candleMs;
const SAMPLE_MS = M.sampleMs;
const SAMPLES = CANDLE_MS / SAMPLE_MS;

if (!Number.isInteger(SAMPLES) || SAMPLES < 1) {
  throw new Error(`market: ${CANDLE_MS}ms does not divide into ${SAMPLE_MS}ms samples`);
}

/* net wins -> price. Exported because the browser needs the identical function
   and there must not be two of them. */
const priceOf = (net) => M.startPrice * Math.exp(M.epsilon * net);

/* A result the market will not price. The brief asks for these to be refused
   and logged rather than clamped, because a result outside 1..25 means the
   engine did something nobody understands yet, and pricing it would bury the
   evidence inside a candle. */
function badReason(r) {
  if (!r || typeof r !== "object") return "not an object";
  if (r.winner !== "bull" && r.winner !== "bear" && r.winner !== "draw") {
    return `winner ${JSON.stringify(r.winner)}`;
  }
  if (!Number.isFinite(r.points)) return `points ${r.points} is not a finite number`;
  if (!Number.isInteger(r.points)) return `points ${r.points} is not a whole number`;
  if (r.winner === "draw") return r.points === 0 ? null : `a draw worth ${r.points} points`;
  if (r.points < 1 || r.points > M.maxPoints) {
    return `points ${r.points} outside 1..${M.maxPoints}`;
  }
  if (!Number.isFinite(r.at)) return `finish time ${r.at} is not a number`;
  return null;
}

class Market {
  /* `onCandle` is handed each five-minute candle as it closes, in order.
     `onReject` is handed every result the market refused, with the reason. */
  constructor(opts) {
    const o = opts || {};
    this.onCandle = o.onCandle || function () {};
    this.onReject = o.onReject || function () {};
    this.net = 0;              // cumulative net wins: the whole of the price
    this.bucket = null;        // which five-minute window is open
    this.cur = null;
    this.rejected = 0;
    this.accepted = 0;
    /* the last candle's close, so a window with no matches in it is a doji at
       the right price rather than a gap */
    this.lastCloseNet = 0;
  }

  _open(bucket) {
    const openNet = this.lastCloseNet;
    this.bucket = bucket;
    this.cur = {
      index: bucket,
      t: bucket * CANDLE_MS,
      openNet, hiNet: openNet, loNet: openNet,
      bullWins: 0, bearWins: 0, draws: 0,
      lastSlot: -1,
      bullPts: 0, bearPts: 0,
      /* One entry per ten seconds, each the state at the END of that slot.
         Sample 29 is therefore the candle's close, and the next candle's open
         is this one's close — no overlap and no gap. Points are the running
         total WITHIN the candle, because that is what settles a prediction:
         "points earned after your entry" is this array read twice. */
      path: new Array(SAMPLES),
    };
    for (let i = 0; i < SAMPLES; i++) this.cur.path[i] = null;
  }

  /* Fill every sample slot from `upto` backwards that has not been written yet.
     A slot with no match in it is not empty — it is the same state as the slot
     before it, because nothing happened — and writing that down explicitly is
     what makes the path exact rather than interpolated. */
  _fill(upto) {
    const c = this.cur;
    /* `this.net` and not a field on the candle: the running total lives on the
       market, and reading it off the candle filled every quiet slot with NaN
       because the candle only learns its own net at the close. With four
       thousand matches a candle there is never a quiet slot, so the recording
       was right and the bug sat there invisibly — it would have surfaced the
       first time the simulator ran with a smaller population, or after a
       restart, and by then it would have been in a file. */
    const dn = this.net - c.openNet, bp = c.bullPts, bq = c.bearPts;
    for (let i = 0; i <= upto; i++) {
      if (c.path[i] === null) c.path[i] = { dn, bp, bq };
    }
  }

  _close() {
    const c = this.cur;
    if (!c) return;
    this._fill(SAMPLES - 1);
    c.closeNet = this.net;
    this.lastCloseNet = this.net;
    c.matches = c.bullWins + c.bearWins + c.draws;
    this.onCandle(c);
    this.cur = null;
    this.bucket = null;
  }

  /* Every window between two matches, so the chart has a candle for a quiet
     stretch instead of a hole. With ten thousand bots there are no quiet
     stretches, but a smaller population or a restart can leave one. */
  _advanceTo(bucket) {
    if (this.bucket === null) { this._open(bucket); return; }
    while (this.bucket < bucket) {
      const next = this.bucket + 1;
      this._close();
      this._open(next);
    }
  }

  /* THE door. One finished match, bot or human, priced or refused. */
  submit(r) {
    const bad = badReason(r);
    if (bad) {
      this.rejected++;
      this.onReject({ reason: bad, result: r });
      return false;
    }
    const bucket = Math.floor(r.at / CANDLE_MS);
    if (this.bucket !== null && bucket < this.bucket) {
      /* Out of order. The simulator emits strictly by finish time, so this is
         a caller bug rather than a data condition, and pricing it into the open
         candle would put a past match in the wrong one. */
      this.rejected++;
      this.onReject({ reason: `finished at ${r.at}, before the open candle ${this.bucket}`, result: r });
      return false;
    }
    this._advanceTo(bucket);

    const c = this.cur;
    /* the slot this match lands in, and everything before it frozen first, so a
       sample always holds the state as it stood at the end of its ten seconds */
    const slot = Math.min(SAMPLES - 1, Math.floor((r.at - c.t) / SAMPLE_MS));
    /* ==> and the same rule one level down. A sample already written is a sample
       that has already been published — a prediction may have settled against
       it — so a result arriving for an earlier ten seconds cannot be folded in
       without rewriting history. It is refused for exactly the reason a result
       from an earlier candle is.
       The simulator hands results over strictly in finish order, so this never
       fires in practice. It is here because the alternative is a path whose
       running totals go backwards, and the only thing that would have noticed
       is the encoder refusing to write a negative delta — a long way from the
       mistake, and only if anybody happened to record that run. */
    if (slot < c.lastSlot) {
      this.rejected++;
      this.onReject({ reason: `finished in sample ${slot}, behind sample ${c.lastSlot}`, result: r });
      return false;
    }
    this._fill(slot - 1);

    if (r.winner === "bull") {
      this.net++;
      c.bullWins++;
      c.bullPts += r.points;
    } else if (r.winner === "bear") {
      this.net--;
      c.bearWins++;
      c.bearPts += r.points;
    } else {
      /* a draw moves nothing and adds no volume. It is counted because the
         candle reports how many matches it held, and a draw was a match. */
      c.draws++;
    }
    if (this.net > c.hiNet) c.hiNet = this.net;
    if (this.net < c.loNet) c.loNet = this.net;
    /* The slot is rewritten rather than only filled: several matches land in the
       same ten seconds, and the sample has to be the last of them. */
    c.path[slot] = { dn: this.net - c.openNet, bp: c.bullPts, bq: c.bearPts };
    c.lastSlot = slot;
    this.accepted++;
    return true;
  }

  /* Close the window that is still open. Anything after this would belong to a
     later candle, so a recorder calls it when it stops. */
  flush() { this._close(); }
}

/* A candle's prices, from its integers. Kept here rather than in the candle so
   that what is stored and shipped is the integers — exact, tiny, and the same
   numbers the browser recomputes the prices from. */
function pricesOf(c) {
  return {
    open: priceOf(c.openNet),
    high: priceOf(c.hiNet),
    low: priceOf(c.loNet),
    close: priceOf(c.closeNet),
  };
}

/* Green when Bulls won more matches, red when Bears did, grey when they tied.
   Not a function of the price, on purpose — see the note at the top. */
const colourOf = (c) => (c.bullWins > c.bearWins ? "up" : c.bullWins < c.bearWins ? "down" : "flat");

module.exports = {
  Market, priceOf, pricesOf, colourOf, badReason,
  CANDLE_MS, SAMPLE_MS, SAMPLES,
};
