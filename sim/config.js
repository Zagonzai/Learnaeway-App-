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
  /* Only the population split and the thinking time are here. How each style
     CHOOSES a card is js/pw-styles.js, beside the rules rather than inside
     sim/, because the app plays two of these styles too now — Easy and Hard
     are the aggressive and the smart bot. */
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
     Every finished match reaches the market through one function, and it carries
     where it came from. Three sources exist:

       "bot"       the simulator's own matches. The market runs on these.
       "human"     a real 1v1 between two people. Not switched on yet.
       "computer"  a player against the app's computer opponent.

     ==> "computer" is not on this list and must never be. A player picking Easy
     and a ten-point target can win a match every two minutes; if those reached
     the chart, the market would be whatever one determined person decided it
     should be. It is refused at the door rather than filtered later, so there is
     one place to read and one place to get wrong. */
  acceptFrom: ["bot"],

  /* ---- the market the matches move ----
     Price is a log-space walk: a Bull win adds `epsilon` to the log price and a
     Bear win takes it off. See the note at the top of market.js for why.

     `epsilon` is tuned so a typical day moves about 1%, like ES. Net wins over
     a day are a fair coin walk, so their standard deviation is the square root
     of the number of decided matches, and the day's log move is epsilon times
     that:

         epsilon = 0.01 / sqrt(decided matches per day)
                 = 0.01 / sqrt(4,050 × 288 × 0.969)
                 = 0.01 / sqrt(1,130,242)
                 = 0.01 / 1,063.1
                 = 9.4e-6

     The three numbers in that are Phase 1's measurements: 4,050 matches finish
     per five-minute candle, there are 288 candles in a day, and 96.9% of
     matches are decided rather than drawn. Change the population and this
     number has to move with it, or the chart gets quieter or wilder. */
  market: {
    startPrice: 10000,
    epsilon: 9.4e-6,
    targetDailyMove: 0.01,      // what epsilon was fitted to, for the record
    candleMs: 5 * 60 * 1000,
    sampleMs: 10 * 1000,
    maxPoints: 25,              // the match target: a winner's Print is 1..25
  },

  /* ---- the recording ----
     The chart runs off a pre-recorded market until there is a server to run a
     live one. 90 days, one file per day. */
  record: {
    days: 90,
    dir: "data/aeway",
    /* The scrambling key. This is not a secret and is not treated as one — it
       is there so a tester poking at the network tab sees bytes rather than
       tomorrow's prices. A determined developer can read this file and decode
       the recording, which is exactly why predictions have to move to a server
       before points are ever worth anything. */
    key: "aeway-recording-v1",
  },
};
