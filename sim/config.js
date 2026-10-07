/* Everything about the simulator that is a number somebody might want to change.
 *
 * The brief marks most of these "(default — Mattia can change)", so they are all
 * in one file rather than spread through the code. Nothing here is a rule of
 * Pointæway; the rules are in js/pw-rules.js and none of them are configurable.
 */
"use strict";

module.exports = {
  /* ---- the population ---- */
  bots: 10000,

  /* The match every bot plays: the app's standard online settings. 25 points is
     the default target, which the engine turns into 5 copies of each candle per
     side and a hand of 6; `perColour: 3` is every wild that exists, which is
     what "all 3 of each colour" means on the Create Match screen. */
  settings: { points: 25, perColour: 3 },

  /* ---- rest between matches, in seconds ---- */
  rest: { min: 10, max: 60 },

  /* ---- the four play styles ----
     `share` is how the population is split; they are equal by default and only
     have to be positive, not to add to anything.

     `think` is how long a bot takes over one card, in seconds. A round takes as
     long as the slower of the two bots, since they choose at the same time, so
     these numbers are per bot and not per round. They are what sets how long a
     match lasts, and they are tuned — see sim/README.md — so that most matches
     land between 2 and 10 minutes with the middle of the distribution at 5–6. */
  styles: {
    random:     { share: 1, think: { min: 5, max: 12 } },
    aggressive: { share: 1, think: { min: 4, max: 13 } },
    patient:    { share: 1, think: { min: 8, max: 16 } },
    smart:      { share: 1, think: { min: 7, max: 15 } },
  },

  /* A match that will not end is a bug, not a long game. The longest honest
     match is bounded by the decks — 60 numbered cards and 12 wilds, at least one
     card spent a round — so anything past this is a loop and throws. */
  maxRounds: 400,

  /* ---- who may post a result ----
     Every finished match, bot or human, reaches the market through one function.
     Human matches are not switched on yet, so the door only accepts bots and
     says so out loud rather than silently dropping anything else. */
  acceptFrom: ["bot"],

  /* Patient holds its good cards for this many rounds before it starts spending
     them, and nobody but Smart and the engine's own opponent plays a wild on a
     read of the board. */
  patientHoldRounds: 6,
};
