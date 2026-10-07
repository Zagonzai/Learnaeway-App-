/* One Pointæway match, played to the end, in memory, with no screen.
 *
 * It plays through js/pw-rules.js — the same file the app loads — and it does
 * not reimplement one line of the game. What it adds is the three things the
 * engine refuses to do on its own: it tells the engine not to repaint anything,
 * not to file anything, and not to wait out the reveal animation, because there
 * is nobody watching the card turn over.
 *
 * It is a pure function of its seed. Same seed, same two styles, same match,
 * card for card and log line for log line — which is what makes a result
 * auditable: the record stores the seed, and anybody can replay it.
 */
"use strict";

const R = require("../js/pw-rules.js");
const CONFIG = require("./config.js");
const { STYLES } = require("./styles.js");
const { rngFrom, numIn } = require("./rng.js");

/* The engine asks for these once. They are the same for every headless match, so
   they are set once here rather than per call. */
R.hooks.render = function () {};
R.hooks.recordMatch = function () {};
R.hooks.reveal = function (g, settle) { settle(); };   // no reveal to wait out

/* Which seat a bot is in. The engine has two: the one it calls "player", which
   is the seat a human would sit in, and the one it calls "ai". They are not
   quite symmetric — the player's Take Profit and Discipline stop to ask a
   question and the opponent's are answered where they are played — so which bot
   sits where is decided by the match's own seed rather than by its side. Without
   that, every Bull in the population would play from the same seat all day and
   any asymmetry in it would read as a Bull edge on the chart. */
function playMatch(opts) {
  const seed = opts.seed >>> 0;
  const settings = opts.settings || CONFIG.settings;
  const styleOf = { bull: opts.bullStyle, bear: opts.bearStyle };

  const rnd = rngFrom(seed);
  R.setRandom(rnd);

  const seat = rnd() < 0.5 ? "bull" : "bear";      // whose bot gets the player seat
  const other = seat === "bull" ? "bear" : "bull";
  const mine = STYLES[styleOf[seat]];
  const theirs = STYLES[styleOf[other]];
  if (!mine || !theirs) throw new Error(`unknown play style: ${opts.bullStyle}/${opts.bearStyle}`);

  /* the second seat's card comes from its own style, through the engine's slot */
  R.setAiChoice((g, hand) => theirs(g, hand, "ai", rnd));

  const g = R.deal(seat, settings);

  /* ---- what a headless match does not need to keep ----
     The engine records a candle and a line of prose for every round, because
     the app draws both. A bot match is never drawn and never read, and over a
     hundred million matches the two of them are the single largest cost in the
     recording: the round log is rebuilt with `concat` each round, so its cost
     grows with the square of the match's length.

     Neither is switched off — the engine still writes them, exactly as it does
     in the app. What changes is where they go: the chart keeps only the round
     that just happened, which is the only one anything here reads, and the log
     is emptied after each step. No rule is involved and no decision changes;
     measured against the full version across 20,000 matches, every winner,
     Print and round count is identical. */
  if (!opts.verbose) {
    g.chart = { length: 0, 0: null, push(x) { this[0] = x; this.length = 1; } };
    g.log.length = 0;
  }

  /* How long each round took, so the match has a duration without anybody
     waiting for it. Both bots choose at once, so a round is as long as the
     slower of the two. */
  const think = (style) => {
    const t = CONFIG.styles[style].think;
    return numIn(rnd, t.min, t.max);
  };
  let seconds = 0;
  let rounds = 0;
  /* One balance figure the admin report asks for that cannot be worked out
     afterwards: how often a YOLO total met a Market News, which triples
     whatever number it is played against and so turns the game's biggest
     gamble into its biggest swing. Counted here, as it happens, because
     keeping a hundred million round logs to count it later is not an option. */
  let yoloNews = 0;
  let lastWasYoloNews = false;

  while (g.phase !== "gameover") {
    if (rounds > CONFIG.maxRounds) {
      throw new Error(`match ${seed} did not end in ${CONFIG.maxRounds} rounds`);
    }
    switch (g.phase) {
      case "selecting": {
        seconds += Math.max(think(styleOf[seat]), think(styleOf[other]));
        rounds++;
        const card = mine(g, g.playerHand, "player", rnd);
        R.play(g, card.id);
        /* the round that just resolved, as it reached the table — after both
           substitutions, so a YOLO here is the combined total and not the card
           that was tapped */
        const last = g.chart[g.chart.length - 1];
        if (last) {
          const a = last.you && last.you.type, b = last.opp && last.opp.type;
          lastWasYoloNews = (a === "YOLO" && b === "Market News") ||
                            (b === "YOLO" && a === "Market News");
          if (lastWasYoloNews) yoloNews++;
        }
        break;
      }
      /* The three questions the engine stops to ask the player's seat. The other
         seat is answered inside the engine by its own rules, so these answer by
         exactly those rules rather than by a second opinion: the same peek
         answer, the same choice of pile, and Take Profit doubled whenever it
         can be, which is what the engine's opponent does with its own. */
      case "discipline-pick":
        R.disciplineAnswer(g, R.aiAnswerPeek(g, g.discipline.aCard, g.playerHand).id);
        break;
      case "takeprofit-choice":
        R.takeProfitChoose(g, true);
        break;
      case "draw-choice": {
        /* The loser of a round replaces their card from a pile of their choosing,
           and it turns out to be the most valuable decision in Pointæway: a bot
           that always takes the wild pile when it loses beats the same bot
           always taking its own deck 71% to 28%. So this has to be decided on
           the same terms as the opponent's or the two seats are not playing the
           same game.

           The engine asks the opponent's seat before it commits the round's new
           Print, so the opponent decides on the Print as the round OPENED. This
           seat is asked afterwards, so reading `g.candle` would hand it one more
           round of information than its opponent ever gets — which measured as a
           13-point win rate advantage, entirely spurious. The opening Print is
           the first thing the round's own candle recorded, so it is taken from
           there and the rule is given exactly what the rule is given. */
        const opened = g.chart[g.chart.length - 1].open;
        const src = R.aiDrawSource({ candle: opened, aiSide: g.playerSide }, g.special.length);
        R.chooseDraw(g, src);
        break;
      }
      default:
        /* "resolving" cannot be reached from here: the reveal hook settles the
           round before R.play returns. Anything else is a phase this driver has
           not been taught, and guessing at it would corrupt the result. */
        throw new Error(`match ${seed} stalled in phase "${g.phase}"`);
    }
    if (!opts.verbose) g.log.length = 0;
  }

  /* ---- reading the result off the engine ----
     `g.winner` is "bull", "bear" or "draw", and `g.candle` is the final Print on
     the shared track: positive is the Bull's direction and negative the Bear's,
     clamped by the engine to the match's target either way. So the winner's
     points are the Print read from the winning side, which is 1 to 25 in a
     25-point match — 25 exactly when the match was won on the track, and less
     when it was won by the loser running out of cards. An exact 0 is the only
     draw the engine can produce, and it is worth nothing to either side. */
  const print = g.candle;
  const winner = g.winner;
  const points = winner === "draw" ? 0 : winner === "bull" ? print : -print;
  /* Number.isFinite rather than a range test on its own: a NaN Print fails every
     comparison, so `points < 1 || points > 25` would have waved it straight
     through — which is exactly how the Discipline bug in pw-rules.js stayed
     quiet. Anything that is not a whole number in range stops the run here,
     because the alternative is a market priced in NaN. */
  if (!Number.isFinite(print) || !Number.isInteger(points) ||
      (winner !== "draw" && (points < 1 || points > R.target(g)))) {
    throw new Error(`match ${seed}: ${winner} with Print ${print} and ${points} points — ` +
                    `not a whole 1..${R.target(g)} result`);
  }

  return {
    seed,
    winner,                     // "bull" | "bear" | "draw"
    points,                     // the Print from the winner's side, 1..target; 0 for a draw
    print,                      // the same figure signed Bull-positive, for the record
    rounds: g.round,
    seconds,                    // how long this match would have taken to play
    seat,                       // which side sat in the engine's player seat
    bullStyle: opts.bullStyle,
    bearStyle: opts.bearStyle,
    settings: { points: settings.points, perColour: settings.perColour },
    /* for the admin report's balance section: whether the match was won on the
       track rather than by the loser running out of cards, and how much of the
       YOLO-into-Market-News swing there was */
    onTrack: Math.abs(print) === R.target(g),
    yoloNews,
    yoloNewsDecider: lastWasYoloNews,
    /* Only when asked for: a million matches a day must not each carry their
       round log around. An audit asks for one match by seed and gets all of it —
       the prose the engine wrote as it played, oldest first, and the candle of
       every round, which is the same shape the app's own replay draws from. */
    log: opts.verbose ? g.log.slice().reverse() : undefined,
    chart: opts.verbose ? g.chart : undefined,
  };
}

module.exports = { playMatch };
