/* The one door a finished match comes through.
 *
 * Every result the market ever reacts to arrives here, and there is deliberately
 * only one of these functions. Bot matches come through it now; real 1v1 matches
 * between people will come through the same one when they are switched on, and
 * the market will not need to know which it is looking at — a result is a result,
 * and the chart's arithmetic is the same either way.
 *
 * Until then the door is shut to anything but bots, and it says so rather than
 * dropping it quietly: a human result arriving before the market is ready for one
 * is a bug somewhere, and a silent discard is the worst way to find out.
 */
"use strict";

const CONFIG = require("./config.js");

const sinks = [];

/* Whoever wants to hear about finished matches. The candle builder will be one
   of these; a counter in a test is another. */
function onResult(fn) {
  sinks.push(fn);
  return () => {
    const i = sinks.indexOf(fn);
    if (i >= 0) sinks.splice(i, 1);
  };
}

/* A finished match. `at` is when it finished, in epoch milliseconds — not when it
   was played, which for a bot is much earlier and is nobody's business but the
   simulator's. `source` is "bot" or "human". */
function submitResult(result) {
  const source = result.source || "bot";
  if (CONFIG.acceptFrom.indexOf(source) < 0) {
    throw new Error(`result from "${source}" refused: the market accepts ${CONFIG.acceptFrom.join(", ")}`);
  }
  if (result.winner !== "bull" && result.winner !== "bear" && result.winner !== "draw") {
    throw new Error(`result with no winner: ${JSON.stringify(result.winner)}`);
  }
  for (let i = 0; i < sinks.length; i++) sinks[i](result);
}

module.exports = { onResult, submitResult };
