/* ==================== the four play styles ====================
 *
 * A style is not a rule. It never decides what a card does, what a round is
 * worth or when a match ends — all of that is js/pw-rules.js and there is one
 * copy of it. A style decides only which card out of a hand goes down, which is
 * the one thing a player actually chooses, and it is why two bots with the same
 * deal play different matches.
 *
 * Each one is handed the match, the hand, which seat it is sitting in, and the
 * match's seeded generator. It must return a card from that hand and it must
 * never return one the engine would refuse: the engine's own `playable` is what
 * decides that, so no style has its own idea of what is legal.
 *
 * All four see only what a player at the table can see — their own hand, the
 * print, the round number and what they themselves played last. None of them
 * reads the opponent's hand or the deck order.
 *
 * ---- why this is beside pw-rules.js rather than inside sim/ ----
 *
 * It started in the simulator, because the simulator was the only thing that
 * needed more than one opponent. The app needs them too now: a match against
 * the computer has an Easy, a Normal and a Hard, and Easy and Hard are two of
 * these. So it moved up here for the same reason the rules did — one copy, two
 * readers — and the simulator imports it from here rather than owning it.
 *
 * Normal is deliberately NOT one of these: it is the engine's own
 * pwAiChooseCard, untouched, so that the computer match this app has always
 * played stays exactly the match it has always played.
 */
(function () {
  "use strict";

  const R = (typeof require === "function" && typeof module !== "undefined")
    ? require("./pw-rules.js") : globalThis.PWRules;

  /* How long Patient holds its good cards before it starts spending them. It
     was a line in the simulator's config; it is a property of the style, so it
     lives with the style. */
  const PATIENT_HOLD = 6;

  const seatSide = (g, who) => (who === "ai" ? g.aiSide : g.playerSide);
  /* the print from this seat's point of view: positive is winning */
  const lead = (g, who) => R.sign(seatSide(g, who)) * g.candle;
  const lastOwn = (g, who) => (who === "ai" ? g.lastA : g.lastP);

  /* What the engine will actually accept. A hand with nothing playable in it is a
     real state — a YOLO held over an empty deck — and the engine washes that round
     rather than refusing the play, so the whole hand is the fallback, exactly as
     the app's own opponent does it. */
  function legal(g, hand, who) {
    const open = R.playable(g, hand, who);
    return open.length ? open : hand;
  }

  const tiers = (cards) => cards.filter((c) => c.kind === "tier");
  const wilds = (cards) => cards.filter((c) => c.kind === "special");
  const strongest = (cards) => cards.reduce((b, c) => (c.pts > b.pts ? c : b), cards[0]);
  const weakest = (cards) => cards.reduce((b, c) => (c.pts < b.pts ? c : b), cards[0]);

  /* How much a wild is worth to a bot that cannot see what it is up against.
     Liquidated takes the round outright, the three absorbs turn the opponent's own
     card around, and the rest are situational — so this is a preference order and
     not a score of anything. */
  const WILD_VALUE = {
    "Liquidated": 6, "Market News": 5, "Momentum": 4, "Take Profit": 3,
    "Stop Loss": 3, "Reversal": 2, "Volatility Spike": 2, "Canceled Order": 1,
    "FOMO": 1, "Discipline": 2, "YOLO": 1, "Diamond Hands": 1,
  };
  const bestWild = (cards) =>
    cards.reduce((b, c) => ((WILD_VALUE[c.type] || 0) > (WILD_VALUE[b.type] || 0) ? c : b), cards[0]);

  /* ---- Random ----
     Any legal card, with no thought at all. It is the control group: whatever the
     other three do, they have to beat this. */
  function random(g, hand, who, rnd) {
    const live = legal(g, hand, who);
    return live[Math.floor(rnd() * live.length)];
  }

  /* ---- Aggressive ----
     Leads with its strongest. It spends its Marubozu in round one and is holding
     Nulls by round six, which loses it a lot of late rounds and wins it a lot of
     early ones. Wilds only when it has no number left to lead with — a wild is not
     a strong card to this bot, it is the absence of one. */
  function aggressive(g, hand, who, rnd) {
    const live = legal(g, hand, who);
    const num = tiers(live);
    if (num.length) return strongest(num);
    const w = wilds(live);
    return w.length ? bestWild(w) : live[0];
  }

  /* ---- Patient ----
     The mirror of Aggressive: it pays for the early rounds with its weakest cards
     and keeps its fives and its wilds for when the print is close enough to the
     finish line to be worth them. Being badly behind counts as late, whatever the
     round number says — a bot holding a hand of fives at −20 has saved them for
     nothing. */
  function patient(g, hand, who, rnd) {
    const live = legal(g, hand, who);
    const late = g.round > PATIENT_HOLD ||
                 lead(g, who) <= -Math.round(R.target(g) / 3);
    const num = tiers(live);
    if (!late) return num.length ? weakest(num) : live[0];
    const w = wilds(live);
    /* late, and a wild is now worth more than a number: it plays the best one it
       holds about half the time and otherwise leads its strongest card */
    if (w.length && rnd() < 0.5) return bestWild(w);
    return num.length ? strongest(num) : bestWild(w.length ? w : live);
  }

  /* ---- Smart ----
     The brief's own sketch: the lowest card likely to win the round, with wilds
     saved for high-value moments.

     "Likely to win" has to be judged without seeing the other hand, so it is
     judged against the deck: six ranks, nought to five, mean 2.5. A 3 beats more
     than half of what can come back, so 3 is the cheapest card that is worth
     playing to win, and anything below that is what you spend on a round you have
     already decided to lose.
     "High value" is three things: a round that can finish the match, a round that
     can lose it, and a card worth replaying. */
  function smart(g, hand, who, rnd) {
    const live = legal(g, hand, who);
    const num = tiers(live);
    const w = wilds(live);
    const me = lead(g, who);
    const target = R.target(g);

    /* 1. Can this round end it? Nothing is worth more than that. */
    if (num.length) {
      const kill = num.filter((c) => me + c.pts >= target).sort((a, b) => a.pts - b.pts)[0];
      if (kill) return kill;
    }
    /* 2. Can this round lose it? A big swing against is survivable only by a wild
       that stops one — the absorbs turn their card around, Volatility Spike and
       Reversal move the print itself. */
    if (w.length && me - 5 <= -target) return bestWild(w);

    /* 3. A card worth replaying is worth a Diamond Hands. */
    const diamond = w.find((c) => c.type === "Diamond Hands");
    if (diamond && R.worthReplaying(lastOwn(g, who)) && rnd() < 0.7) return diamond;

    /* 4. Losing badly, with nothing in hand that fights: gamble. */
    const yolo = w.find((c) => c.type === "YOLO");
    const weakHand = !num.some((c) => c.pts >= 4);
    if (yolo && me < -6 && weakHand && rnd() < 0.6) return yolo;

    /* 5. Behind, and holding something that scores off their card. */
    if (w.length && me <= -4 && rnd() < 0.5) return bestWild(w);

    /* 6. Otherwise: the cheapest card that is likely to take the round, and the
       weakest card held if there is none — a round you cannot win is a round to
       spend a Null on. */
    if (num.length) {
      const win = num.filter((c) => c.pts >= 3).sort((a, b) => a.pts - b.pts)[0];
      if (win) return win;
      return weakest(num);
    }
    return w.length ? bestWild(w) : live[0];
  }

  const STYLES = { random, aggressive, patient, smart };
  const STYLE_NAMES = Object.keys(STYLES);

  /* ---- what the app asks for ----
     A difficulty is a style plus, for Hard, one extra piece of information the
     engine's own opponent does not get. The mapping lives here rather than in
     app.js so that "Easy is the aggressive style" is written down once, beside
     the style it names.

     Normal maps to null on purpose: null means "leave the engine's own
     opponent alone", which is what unchanged has to mean. */
  const DIFFICULTIES = [
    { id: "easy",   label: "Easy",   style: "aggressive", hardPile: false,
      blurb: "Leads with its strongest card every round — and runs out of them." },
    { id: "normal", label: "Normal", style: null,         hardPile: false,
      blurb: "The opponent Pointæway has always had." },
    { id: "hard",   label: "Hard",   style: "smart",      hardPile: true,
      blurb: "Spends the cheapest card that wins, and reads the Print you read." },
  ];
  const difficultyOf = (id) => DIFFICULTIES.find((d) => d.id === id) || DIFFICULTIES[1];

  const PWStyles = { STYLES, STYLE_NAMES, DIFFICULTIES, difficultyOf, PATIENT_HOLD };
  if (typeof globalThis !== "undefined") globalThis.PWStyles = PWStyles;
  if (typeof module !== "undefined" && module.exports) module.exports = PWStyles;
})();
