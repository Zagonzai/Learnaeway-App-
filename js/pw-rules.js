/* ==================== Pointæway: the rules, on their own ====================

   This file is the game. Nothing in it touches the DOM, localStorage, Firestore
   or any global the app owns; it reads and writes one plain object — the match —
   that is handed to it as `g`, and it asks for the two things it cannot do
   itself through `PWRules.hooks`.

   It exists because the rules now have two readers. The app plays one match at
   a time on a phone; the market simulator plays thousands a minute on a server.
   Those two must not be two games, which is what a second copy of the rules
   would quietly become the first time one of them was corrected and the other
   was not. So there is one copy, here, and both sides call it.

   What moved: everything from the tier tables down to pwFinishRound, verbatim.
   The only changes are mechanical and there are exactly three kinds of them:

     1. Functions that read the match out of a module-level `pw` now take it as
        their first argument, `g`. Nothing else about them is different.
     2. `Math.random()` is called through `rnd()`. The default still calls
        `Math.random()` at the moment it is asked, so a page that replaces
        Math.random — which is how the seeded trace works — still steers every
        draw in here. A simulator that wants its own stream calls
        PWRules.setRandom() instead.
     3. The three places that reached out of the engine — repaint the screen,
        file the finished match, wait for the reveal animation — are hooks. The
        app fills them in with the real thing; left alone they repaint nothing,
        file nothing, and let the reveal finish immediately, which is what a
        headless match wants.

   The app keeps every one of its old call sites by aliasing them onto this
   module, so no caller in app.js moved and the names in the round log, the
   history record and the replay encoding are byte-for-byte what they were. */

(function () {
  "use strict";

  /* ---- where randomness comes from ----
     Indirect on purpose: `Math.random` is looked up when a card is drawn, not
     when this file loads, so overriding the global still works. */
  let rnd = function () { return Math.random(); };

  /* ---- what the engine cannot do itself ----
     Three things, and the match flow needs all three to be callable whether or
     not anybody filled them in. `reveal` is the reveal animation: the app holds
     the round for PW_REVEAL_MS so the turning card can be seen, and a headless
     match has nothing to see, so it settles at once. */
  const hooks = {
    render: function () {},
    recordMatch: function () {},
    reveal: function (g, settle) { settle(); },
  };

  /* Six ranks a side, five down to nought, and the two sides mirror each
     other rank for rank — the names on the faces are these names, so what the
     round log and the Seen panel say is what the card says.

     A Null scores nothing. It is a card like any other, not a discard: it can
     only ever tie the other side's Null, because any rank above it wins, and
     an equal score is already a wash that spends both cards. Nothing else in
     the engine needed a word changing for it.

     The bear's 4 and 1 read the other way round for a while — the previous
     art printed Hanging Man on the 4 — and this set settles it: Shooting Star
     is the 4 again and the 1 is Weak Rejection, matching the bull's. There is
     no Hanging Man in the deck now.

     Shapes are not carried here any more. They drove a drawn candle icon that
     the illustrated faces replaced; the faces are the shapes. */
  const PW_TIERS_BY_SIDE = {
    bull: [
      { type: "Bullish Marubozu",       pts: 5 },
      { type: "Bullish Hammer",         pts: 4 },
      { type: "Bullish Standard",       pts: 3 },
      { type: "Bullish Spinning Top",   pts: 2 },
      { type: "Bullish Weak Rejection", pts: 1 },
      { type: "Bullish Null",           pts: 0 },
    ],
    bear: [
      { type: "Bearish Marubozu",       pts: 5 },
      { type: "Bearish Shooting Star",  pts: 4 },
      { type: "Bearish Standard",       pts: 3 },
      { type: "Bearish Spinning Top",   pts: 2 },
      { type: "Bearish Weak Rejection", pts: 1 },
      { type: "Bearish Null",           pts: 0 },
    ],
  };
  const pwTiers = (side) => PW_TIERS_BY_SIDE[side] || PW_TIERS_BY_SIDE.bull;

  /* The twelve wilds. `effect` is what the engine switches on; `cls` is only
     what the card shows. Three of them read the opponent's revealed card and
     score off it in the player's own direction, at rising multiples — Stop
     Loss at its value, Momentum at double, Market News at triple — so they
     are resolved with both cards in hand rather than as standalone effects.
     One `absorb` effect covers all three; only `mult` separates them.
     Discipline is not resolved here at all: it is a peek, and the card that
     scores is the one chosen after it. */
  const PW_SPECIALS = [
    { type: "Volatility Spike", cls: "A", effect: "zero", keepsOther: true,
      desc: "The candle snaps back to 0. Nobody scores." },
    { type: "Canceled Order",   cls: "A", effect: "cancel",
      desc: "Cancels their card — but scores nothing itself. Total wash, both discarded." },
    { type: "Liquidated",       cls: "A", effect: "liquidate", swing: 5,
      desc: "Destroys their card. You take the round, +5 your way." },
    { type: "FOMO",             cls: "A", effect: "fomo", extra: 2, keepsOther: true,
      desc: "Draw 2 more cards from your deck. The round is a wash." },
    { type: "Stop Loss",        cls: "A", effect: "absorb", mult: 1,
      desc: "Their card scores for YOU instead, at its own value. Their attack, your protection." },
    { type: "Market News",      cls: "A", effect: "absorb", mult: 3,
      desc: "Their card scores for YOU instead, at triple its value." },
    { type: "Reversal",         cls: "A", effect: "flip", keepsOther: true,
      desc: "Flips the candle to the same distance the other side of 0." },
    { type: "Take Profit",      cls: "A", effect: "absorb", mult: 1, doubleUp: true,
      desc: "Take their profit: their card scores for YOU at its value. Hold its match and you can double it." },
    { type: "Momentum",         cls: "A", effect: "absorb", mult: 2,
      desc: "Their card scores DOUBLE for YOU instead of its value for them." },
    { type: "Discipline",       cls: "D", effect: "peek",
      desc: "See their card first, then pick a numbered card from your hand to answer it." },
    /* The last two are a different kind of card again. Neither has an effect
       the resolver can switch on: each one stands aside and puts a different
       card on the table in its place, and that card is what the round is
       fought with. Class D, like Discipline, which does the same thing by
       asking rather than by flipping — none of the three ever reaches
       pwResolveRound as itself. */
    { type: "YOLO",             cls: "D", effect: "flip",
      desc: "Take the top two cards from your deck. Combine their points. Play the total against your opponent's card." },
    { type: "Diamond Hands",    cls: "D", effect: "replay",
      desc: "Replay the Power or effect of the card you played last round." },
  ];
  /* the three that are spent putting something else on the table */
  const PW_SUBSTITUTES = ["YOLO", "Diamond Hands"];

  const PW_CLASS_A = PW_SPECIALS.filter((s) => s.cls === "A").map((s) => s.type);
  /* The other three. A Class-A card has an effect the resolver switches on; a
     Class-D card has none, because every one of them is spent putting something
     else on the table — a flipped total, a replayed card, an answer to a peek.
     None of them can fight as itself, and the resolver needs to know that as a
     group rather than one card at a time. */
  const PW_CLASS_D = PW_SPECIALS.filter((s) => s.cls === "D").map((s) => s.type);
  const PW_SPEC = {};
  PW_SPECIALS.forEach((s) => { PW_SPEC[s.type] = s; });
  /* ---- match settings ----
     A match is not one shape any more. The host of a Create Match picks how
     many points it runs to, and that one number sets the whole size of the
     game: how many copies of every candle are in each deck, and how many
     cards a player opens holding. A shorter target with a full-size deck
     would be over before either player had drawn anything interesting, which
     is why the three move together rather than separately.

     25 is the default and is exactly today's game, so Start Match against the
     computer is untouched by any of this. */
  const PW_POINTS = [10, 15, 20, 25];
  const PW_POINT_RULES = {
    10: { copies: 2, hand: 3 },
    15: { copies: 3, hand: 4 },
    20: { copies: 4, hand: 5 },
    25: { copies: 5, hand: 6 },
  };

  /* The specials, by the colour they are actually printed in — read off the
     delivered faces rather than invented here, so the groups are the ones a
     player sees: the border of each card is one saturated hue, and the four
     of them fall out cleanly (yellow ~54°, blue ~196°, purple ~287°, and
     Volatility Spike, which is the only card whose border is unsaturated).

     White is short two cards on purpose. The brief says two more are coming
     with their own mechanics and not to stand placeholders in for them, so
     this group contributes whatever exists — one card today, three when they
     land, with nothing here to change when they do. */
  const PW_SPEC_COLOURS = [
    { k: "white",  name: "White",  cards: ["Volatility Spike", "YOLO", "Diamond Hands"] },
    { k: "purple", name: "Purple", cards: ["Liquidated", "Reversal", "Discipline"] },
    { k: "blue",   name: "Blue",   cards: ["Stop Loss", "Market News", "Momentum"] },
    { k: "yellow", name: "Yellow", cards: ["Canceled Order", "FOMO", "Take Profit"] },
  ];
  /* ---- and the order the twelve are shown in ----
     The grid is four columns of three, one colour per column, so the order to
     read them in is down each column: the table above, flattened. It is this
     array and not PW_SPECIALS that the Library's grid, its swipe and its dots
     follow, and the reference sheet with them.

     PW_SPECIALS itself is deliberately left where it is. A finished match
     stores each wild as its index in that array, so reordering it would make
     every replay already on a player's phone name the wrong cards. The order
     cards are shown in is a different thing from the order they are numbered
     in, and this is the one that may move. */
  const PW_SPECIALS_SHOWN = PW_SPEC_COLOURS
    .reduce((all, c) => all.concat(c.cards), [])
    .map((t) => PW_SPEC[t])
    .filter(Boolean);
  const PW_SPEC_PER_COLOUR = [0, 1, 2, 3];   // 0 is "not playable"
  const PW_DEFAULT_SETTINGS = { points: 25, perColour: 3 };

  /* Whatever the settings say, resolved and made safe. Anything unrecognised
     falls back to the default match rather than to a broken one — these
     numbers can arrive from a match code somebody typed in. */
  function pwSettings(s) {
    const raw = s || PW_DEFAULT_SETTINGS;
    const points = PW_POINT_RULES[raw.points] ? raw.points : PW_DEFAULT_SETTINGS.points;
    const per = PW_SPEC_PER_COLOUR.indexOf(raw.perColour) >= 0
      ? raw.perColour : PW_DEFAULT_SETTINGS.perColour;
    return Object.assign({ points, perColour: per }, PW_POINT_RULES[points]);
  }
  /* the settings this match is running under */
  const pwRules = (g) => pwSettings(g && g.settings);
  const pwTarget = (g) => pwRules(g).points;
  const pwCopies = (g) => pwRules(g).copies;

  const PW_TARGET = 25;          // the default, and what an unstarted screen shows
  const PW_TIER_COPIES = 5;      // likewise: one deck's worth at the default size

  /* Card ids are per-process and only ever compared with each other, so one
     counter for every match this module deals is right — and a simulator that
     plays a million matches wants them unique across all of them. */
  let pwUid = 0;
  const pwId = () => `pw${pwUid++}`;

  function pwBuildTierDeck(side, copies) {
    const n = copies || PW_TIER_COPIES;
    const cards = [];
    pwTiers(side).forEach((t) => {
      for (let i = 0; i < n; i++) {
        cards.push({ id: pwId(), side, kind: "tier", type: t.type, pts: t.pts });
      }
    });
    return cards;
  }
  /* Which specials are in this match: `perColour` of each colour, drawn at
     random from that colour for this match only, so two matches on the same
     setting are not the same deck. 0 means the match has no specials at all.
     A colour short of that many contributes everything it has — which is what
     white does until its other two cards arrive. */
  function pwPickSpecialTypes(perColour) {
    if (!perColour) return [];
    /* All of them is all of them: taken in the sheet's own order, and without
       drawing a single random number. That matters more than it looks. The
       default match is specified as today's game exactly, and "exactly" has to
       survive a seeded replay — choosing at random costs six draws off
       Math.random, which would move the wild deck's shuffle and every match
       recorded against a seed with it. Nothing to choose, nothing drawn, and
       the default deal is bit-for-bit the one it has always been.

       (The test is on the colours rather than on the number, so it stays true
       when white grows to three cards.) */
    if (PW_SPEC_COLOURS.every((c) => c.cards.length <= perColour)) {
      return PW_SPECIALS.map((x) => x.type);
    }
    const picked = [];
    PW_SPEC_COLOURS.forEach((c) => {
      pwShuffle(c.cards).slice(0, perColour).forEach((t) => { if (PW_SPEC[t]) picked.push(t); });
    });
    return picked;
  }
  /* the engine's own `kind` is written last on purpose — see the note in app.js */
  function pwBuildSpecialDeck(types) {
    const want = types || PW_SPECIALS.map((s) => s.type);
    return want
      .map((t) => PW_SPEC[t])
      .filter(Boolean)
      .map((s) => Object.assign({}, s, { id: pwId(), side: "special", kind: "special" }));
  }

  function pwShuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  const pwSign = (side) => (side === "bull" ? 1 : -1);
  /* the print never reads past the finish line either side of it */
  const pwClamp = (g, v, target) => {
    const t = target || pwTarget(g);
    return Math.max(-t, Math.min(t, v));
  };
  const pwSigned = (n) => (n > 0 ? `+${n}` : String(n));
  // keyed by the tier names of one side, since the two decks no longer share any
  function pwEmptyCounts(side) {
    const c = {};
    pwTiers(side).forEach((t) => { c[t.type] = 0; });
    return c;
  }
  /* What a card is worth in a plain comparison. Nothing alters the other
     card's value any more — Fear was the only card that did, and Take Profit
     replaced it. */
  function pwEffPts(card) {
    return card.pts;
  }

  /* ---- the pure part: what the round does, without doing any of it ---- */
  function pwResolveRound(pCard, aCard, playerSide, aiSide, candle) {
    const log = [];
    const r = {
      candleDelta: 0, outcome: "wash",
      pDrawOwn: 1, aDrawOwn: 1, pExtraOwn: 0, aExtraOwn: 0,
      pReturnCard: false, aReturnCard: false,
      pDiscard: false, aDiscard: false,
      loserNeedsChoice: null, log,
    };

    const pIsA = pCard.kind === "special" && PW_CLASS_A.indexOf(pCard.type) >= 0;
    const aIsA = aCard.kind === "special" && PW_CLASS_A.indexOf(aCard.type) >= 0;

    /* Discipline never reaches here as a played card — it is a peek, and the
       card chosen after it is what arrives. The one exception is both players
       playing it at once, which cancels out: neither gets to answer the other. */
    if (pCard.type === "Discipline" && aCard.type === "Discipline") {
      r.outcome = "wash";
      r.pDiscard = true;
      r.aDiscard = true;
      log.push("Both hold their discipline — neither commits. The round is a wash.");
      return r;
    }

    /* A Class-D card that reached here as itself. It should not: the hand dims
       YOLO and Diamond Hands in exactly the states where they cannot
       substitute, and a Discipline is answered where it is played. But a hand
       holding nothing else has to play something, so rather than hand the
       comparison below a card with no power at all, the round is a wash and the
       card is spent.

       ==> This used to name only YOLO and Diamond Hands, and that was a bug
       with a sharp edge on it. An opponent who played Discipline while holding
       no numbered card to answer with kept the Discipline on the table, and the
       Discipline fell through to the plain comparison below — where its missing
       `pts` made every comparison against it false, so it "won" the round and
       dragged the Print to NaN. About one match in a hundred ended with a Print
       that was not a number. The screen showed it; nothing crashed; it was
       quiet, and it would have poisoned the ÆWAY chart permanently the first
       time one of those matches reached it, because a price that has been added
       to NaN once is NaN for ever. Found by the simulator, which plays enough
       matches for one in a hundred to be unmissable.

       Naming the class rather than the two cards closes it for good: after this
       test, both cards here are numbered cards, and the comparison below cannot
       be handed anything without a number. */
    const dud = (c) => c.kind === "special" && PW_CLASS_D.indexOf(c.type) >= 0;
    if (dud(pCard) || dud(aCard)) {
      r.outcome = "wash";
      if (dud(pCard)) { r.pDiscard = true; log.push(`${pCard.type} has nothing to play — the card is spent for nothing.`); }
      if (dud(aCard)) { r.aDiscard = true; log.push(`Their ${aCard.type} has nothing to play — the card is spent for nothing.`); }
      return r;
    }

    /* What one Class-A does, given the card it was played against. Three of
       them score off that card, so the opponent's card is an input here rather
       than something resolved separately. Returns the candle delta from the
       owner's point of view plus who, if anyone, took the round. */
    function classAEffect(card, owner, ownerSide, otherCard, otherSide) {
      const spec = PW_SPEC[card.type] || {};
      const otherPts = otherCard && otherCard.kind === "tier" ? otherCard.pts : null;
      switch (spec.effect) {
        case "zero":
          return { delta: -candle, extra: 0, outcome: "wash" };
        case "flip":
          return { delta: -2 * candle, extra: 0, outcome: "wash" };
        case "fomo":
          return { delta: 0, extra: spec.extra, outcome: "wash" };
        case "cancel":
          // voids their card and scores nothing of its own: a total wash
          return { delta: 0, extra: 0, outcome: "wash" };
        case "liquidate":
          return { delta: pwSign(ownerSide) * spec.swing, extra: 0, outcome: owner };
        case "absorb":
          /* Stop Loss at face value, Momentum at double, Market News at
             triple: their numbered card scores in the owner's direction
             instead of their own. Against anything without a number there is
             nothing to absorb. */
          if (otherPts == null) return { delta: 0, extra: 0, outcome: "wash" };
          return { delta: pwSign(ownerSide) * otherPts * spec.mult, extra: 0, outcome: owner };
        default:
          return { delta: 0, extra: 0, outcome: "wash" };
      }
    }

    // one Class-A special against the other player's card
    function oneClassA(card, owner, ownerSide, otherCard, otherSide) {
      const eff = classAEffect(card, owner, ownerSide, otherCard, otherSide);
      const spec = PW_SPEC[card.type] || {};
      log.push(`${owner === "player" ? "You play" : "Opponent plays"} ${card.type} — ${card.desc}`);
      r.candleDelta = eff.delta;
      r.outcome = eff.outcome;
      if (owner === "player") r.pExtraOwn = eff.extra; else r.aExtraOwn = eff.extra;

      /* Only the effects that leave the other card alone give it back. A card
         that was destroyed, cancelled or scored off has been spent. */
      if (spec.keepsOther && otherCard.kind === "tier") {
        if (owner === "player") r.aReturnCard = true; else r.pReturnCard = true;
      }
      // whoever lost the round replaces their card from a pile of their choosing
      if (eff.outcome === "player") { r.aDrawOwn = 0; r.loserNeedsChoice = "ai"; }
      else if (eff.outcome === "ai") { r.pDrawOwn = 0; r.loserNeedsChoice = "player"; }
      return r;
    }

    if (pIsA && !aIsA) return oneClassA(pCard, "player", playerSide, aCard, aiSide);
    if (aIsA && !pIsA) return oneClassA(aCard, "ai", aiSide, pCard, playerSide);

    /* Both played a Class-A. Neither has a number for the other to read, so
       any effect that scores off the opponent's card finds nothing; what is
       left is the candle effects, which stack. */
    if (pIsA && aIsA) {
      const e1 = classAEffect(pCard, "player", playerSide, aCard, aiSide);
      const e2 = classAEffect(aCard, "ai", aiSide, pCard, playerSide);
      r.candleDelta = e1.delta + e2.delta;
      r.pExtraOwn = e1.extra; r.aExtraOwn = e2.extra;
      r.outcome = "wash";
      log.push(`You play ${pCard.type} — ${pCard.desc}`);
      log.push(`Opponent plays ${aCard.type} — ${aCard.desc}`);
      return r;
    }

    // plain comparison
    const pPts = pwEffPts(pCard);
    const aPts = pwEffPts(aCard);
    const pLabel = `${pCard.type} (${pPts})`;
    const aLabel = `${aCard.type} (${aPts})`;

    if (pPts === aPts) {
      /* Equal points is a wash and both cards are spent — discarded outright,
         not returned to a hand and not put back under either deck. Any equal
         total ties, whether or not the two cards share a name. */
      r.outcome = "wash";
      r.pDiscard = true;
      r.aDiscard = true;
      log.push(`You play ${pLabel}, opponent plays ${aLabel} — a wash. Both cards are discarded.`);
    } else if (pPts > aPts) {
      r.outcome = "player";
      r.candleDelta = pwSign(playerSide) * pPts;
      r.loserNeedsChoice = "ai";
      log.push(`You play ${pLabel}, opponent plays ${aLabel} — you win the round, ${pwSigned(r.candleDelta)}.`);
    } else {
      r.outcome = "ai";
      r.candleDelta = pwSign(aiSide) * aPts;
      r.loserNeedsChoice = "player";
      log.push(`Opponent plays ${aLabel}, you play ${pLabel} — opponent wins the round, ${pwSigned(r.candleDelta)}.`);
    }
    return r;
  }

  /* ---- the AI ---- */
  /* A card worth replaying: a big candle, or one of the three wilds that score
     off whatever the other side put down. */
  const PW_STRONG_REPLAY = ["Liquidated", "Momentum", "Market News"];
  const pwWorthReplaying = (c) =>
    !!c && (c.kind === "tier" ? c.pts >= 4 : PW_STRONG_REPLAY.indexOf(c.type) >= 0);

  function pwAiChooseCard(g, hand) {
    /* Nothing it cannot actually play. A hand of nothing BUT those is the one
       case this cannot honour, and the resolver washes that round rather than
       trying to fight with a card that has no power. */
    const open = hand.filter((c) => !pwBlocked(g, c, "ai"));
    const live = open.length ? open : hand;
    const specials = live.filter((c) => c.kind === "special");
    const behind = pwSign(g.aiSide) * g.candle < -6;

    /* The two new wilds are played on a read of the board rather than at
       random, which is the whole of their strategy: YOLO is a gamble, so it
       comes out when the hand has nothing worth playing and the round is going
       badly anyway; Diamond Hands is only worth a card when there is something
       worth replaying. */
    const weakHand = !live.some((c) => c.kind === "tier" && c.pts >= 4);
    const yolo = specials.find((c) => c.type === "YOLO");
    if (yolo && behind && weakHand && rnd() < 0.6) return yolo;
    const diamond = specials.find((c) => c.type === "Diamond Hands");
    if (diamond && pwWorthReplaying(g.lastA) && rnd() < 0.55) return diamond;

    if (specials.length && (behind || rnd() < 0.2)) {
      return specials[Math.floor(rnd() * specials.length)];
    }
    const normals = live.filter((c) => c.kind === "tier");
    const pool = normals.length ? normals : live;
    if (rnd() < 0.4) {
      return pool.reduce((best, c) => (c.pts > best.pts ? c : best), pool[0]);
    }
    return pool[Math.floor(rnd() * pool.length)];
  }
  /* A card in hand that matches the one just revealed. The spec asks for the
     same tier NAME and the same point value — but the two decks stopped
     sharing names when the tiers were split per side, so a name match can only
     ever be Standard against Standard and the option would almost never
     appear. Matching on value keeps the rule playable and means the same
     thing: equal points is the equal rank. Tighten `pwCardsMatch` to compare
     type as well if the literal reading is wanted. */
  function pwCardsMatch(a, b) {
    return a.kind === "tier" && b.kind === "tier" && a.pts === b.pts;
  }
  function pwTakeProfitMatch(hand, theirCard) {
    if (!theirCard || theirCard.kind !== "tier") return null;
    return hand.find((c) => pwCardsMatch(c, theirCard)) || null;
  }

  /* Cheapest card that beats what the peek showed, else the weakest held.
     `hand` and `side` are for the other seat: in the app only the computer ever
     answers a peek or picks a pile by rule, but in a bot-against-bot match both
     seats do, and they must do it by the same rule rather than by a second copy
     of it. Left out, they read the computer's seat and nothing is different. */
  function pwAiAnswerPeek(g, playerCard, hand) {
    const numbered = (hand || g.aiHand).filter((c) => c.kind === "tier");
    if (!numbered.length) return null;
    const target = playerCard.kind === "tier" ? playerCard.pts : 0;
    const winners = numbered.filter((c) => c.pts > target).sort((x, y) => x.pts - y.pts);
    if (winners.length) return winners[0];
    return numbered.slice().sort((x, y) => x.pts - y.pts)[0];
  }

  function pwAiDrawSource(g, specialCount, side) {
    if (specialCount === 0) return "own";
    const behind = pwSign(side || g.aiSide) * g.candle < -3;
    return behind || rnd() < 0.35 ? "special" : "own";
  }

  /* ---- who decides the computer's card ----
     The rules say what a card does; they do not say which card a player picks,
     and that is the one thing a bot's play style changes. So the choice is a
     slot rather than a call: left alone it is the app's own opponent, exactly as
     it was, and the simulator swaps in the style the bot in that seat was given.
     Nothing downstream of the choice knows the difference. */
  let aiPick = pwAiChooseCard;

  /* ---- state ----
     One match, in one object. Some of these fields are the screen's rather
     than the game's — which page of How to Play is open, whether the chart is
     showing — and they stay here because the app's match object is this
     object, and a simulator carrying a few unread booleans costs nothing. */
  function pwNewGame() {
    return {
      phase: "hub", playerSide: null, aiSide: null, candle: 0,
      bull: [], bear: [], special: [],
      playerHand: [], aiHand: [], playerPlayed: null, aiPlayed: null,
      round: 1, log: [], winner: null, pendingCandle: 0, pending: null,
      /* Which set the card library is showing, or null for the three tiles on
         their own. The library is a screen of its own now rather than a list
         that unrolled under the picker, so the picker's own state went with
         it. */
      libSet: "bull", seen: {},
      /* which match off the record the replay screen is showing, by the
         timestamp it was filed under */
      savedT: null,
      /* one entry per resolved round: where the print stood when the round
         opened and where it stood when the round closed. That is a candle,
         and the run of them is the match as a chart — which is what View
         Match draws. Recorded as it happens because nothing else keeps it:
         pw.log is prose, and the track only ever holds the latest figure. */
      chart: [],
      showMatch: false,     // the chart, in the result screen's own slot
      showRound: null,      // which round's reveal is open under the row
      hubAll: false,        // the whole match history rather than the last three
      /* the performance chart, in the Match History box. `head` is what the
         video header and the title bars were doing before it opened, so that
         closing it puts them back the way they were rather than the way the
         chart left them. */
      perf: { on: false, side: "all", opp: "all", from: 0, count: 0, sel: null,
              menu: null },   // which of the two filter menus is open
      online: null,         // the live 1v1, when one is being found or played
      discipline: null,     // a peek in progress: the Discipline card and theirs
      tp: null,             // a Take Profit waiting on the double-up answer
      aiDoubledUp: null,    // the card the AI spent doubling its own Take Profit
      flipAnim: null,       // their card, on the render that reveals it
      showSeen: false,      // the opponent's per-tier breakdown, on demand
      showSpecials: false,  // the wilds and what they do, on demand
      showChart: false,     // the live print, above the board
      libCard: null,        // the Card Library card opened full size, by index
      libFrom: "setup",     // where its back arrow goes
      htPage: 0,            // which page of How to Play is showing
      settings: null,       // this match's shape; null reads as the default
      specialTypes: null,   // the wilds this match drew; null is "all of them"
      /* What each side actually fought with last round — the flipped card for
         a YOLO, the answer for a Discipline, the copy for a Diamond Hands.
         Diamond Hands replays it, so it is the card that resolved and never
         the card that was tapped. Null until the first round resolves, which
         is what makes Diamond Hands unplayable in round one. */
      lastP: null,
      lastA: null,
      sub: null,            // this round's substitutions, for the slots and the log
    };
  }

  /* A dealt match, ready to play its first round. It returns the fields rather
     than assigning them, so the app can fold them onto the match object it
     already has and the simulator can take the object whole. */
  function pwDeal(side, settings) {
    const other = side === "bull" ? "bear" : "bull";
    const set = pwSettings(settings);
    const bull = pwShuffle(pwBuildTierDeck("bull", set.copies));
    const bear = pwShuffle(pwBuildTierDeck("bear", set.copies));
    const specialTypes = pwPickSpecialTypes(set.perColour);
    const special = pwShuffle(pwBuildSpecialDeck(specialTypes));
    const mine = side === "bull" ? bull : bear;
    const theirs = side === "bull" ? bear : bull;
    return Object.assign(pwNewGame(), {
      settings: set,
      specialTypes,
      playerSide: side, aiSide: other,
      bull, bear, special,
      playerHand: mine.splice(0, set.hand),
      aiHand: theirs.splice(0, set.hand),
      seen: pwEmptyCounts(other),      // the opponent's tiers, by their own names
      log: [`Sides set — you are ${side === "bull" ? "Bull" : "Bear"}. Decks shuffled. Opening print: 0.`],
      phase: "selecting",
    });
  }

  const pwOwnDeck = (g, side) => (side === "bull" ? g.bull : g.bear);

  /* ---- the two cards that play something else ----

     YOLO and Diamond Hands never fight. Each one steps aside and puts another
     card on the table in its place, and that card is what the round resolves —
     through the same pwResolveRound every other round goes through, with no
     second copy of the rules anywhere. YOLO takes the top of its owner's deck;
     Diamond Hands takes a copy of whatever that player last fought with.

     Both have a state in which they cannot be played at all, and both the hand
     and the AI ask the same function about it. */
  function pwBlocked(g, card, who) {
    if (!card || card.kind !== "special") return null;
    if (card.type === "YOLO") {
      const side = who === "ai" ? g.aiSide : g.playerSide;
      return pwOwnDeck(g, side).length ? null : "Your deck is empty.";
    }
    if (card.type === "Diamond Hands") {
      return (who === "ai" ? g.lastA : g.lastP) ? null : "Nothing to replay yet.";
    }
    return null;
  }

  /* What actually goes on the table, and a note for the slot and the log.
     The deck is shifted here rather than in pwApplyResult on purpose: a
     flipped card has left the deck the moment it is flipped, which is what
     makes it count toward depletion, and the bags pwApplyResult copies are
     taken afterwards. */
  function pwSubstitute(g, card, who) {
    if (!card || card.kind !== "special") return { card, note: null };
    if (card.type === "YOLO") {
      const side = who === "ai" ? g.aiSide : g.playerSide;
      const deck = pwOwnDeck(g, side);
      /* two off the top, or one if that is all there is. Both leave the deck
         here rather than at the end of the round, which is what makes them
         count toward depletion — and a YOLO ending a match sooner is the
         point of the card. */
      const flips = [];
      while (flips.length < 2 && deck.length) flips.push(deck.shift());
      if (!flips.length) return { card, note: null };   // pwBlocked should have stopped this
      const pts = flips.reduce((n, c) => n + (c.kind === "tier" ? c.pts : 0), 0);
      /* One card with the combined Power, so the resolver compares it, their
         Stop Loss absorbs it and their Momentum doubles it exactly as they
         would any other number — there is no second set of rules for this.
         It carries the two cards it was made of so the slot can fan them and
         the tally can count them both. */
      const combined = {
        id: pwId(), side, kind: "tier", type: "YOLO", pts,
        art: PW_SPECIAL_ART["YOLO"], yolo: flips,
      };
      return { card: combined, note: { kind: "yolo", who, from: card, to: combined, flips } };
    }
    if (card.type === "Diamond Hands") {
      const last = who === "ai" ? g.lastA : g.lastP;
      if (!last) return { card, note: null };
      /* a copy, and marked as one: it never came out of a deck, so it must not
         be handed to a hand by a wash that returns the card it was played
         against, and it must not count against the tier tally either */
      const copy = Object.assign({}, last, { id: pwId(), ghost: true });
      return { card: copy, note: { kind: "dh", who, from: card, to: copy } };
    }
    return { card, note: null };
  }

  const pwCardLabel = (c) => (c.kind === "tier" ? `${c.type} (Power ${c.pts})` : c.type);

  function pwSubLog(note) {
    if (!note) return null;
    const me = note.who === "ai" ? "Opponent's " : "";
    if (note.kind === "yolo") {
      const parts = (note.flips || []).map((c) => `${c.type} (${c.pts})`).join(" + ");
      return `${me}YOLO → ${parts} = ${note.to.pts}`;
    }
    return `${me}Diamond Hands → replaying ${pwCardLabel(note.to)}`;
  }

  /* One round, from the tap to the reveal. Everything the app's pwPlay did,
     with the reveal delay asked for through the hook rather than taken here. */
  function pwPlay(g, cardId) {
    if (g.phase !== "selecting") return;
    const tapped = g.playerHand.find((c) => c.id === cardId);
    if (!tapped) return;
    if (pwBlocked(g, tapped, "player")) return;     // dimmed in hand; nothing to do here
    let aCard = aiPick(g, g.aiHand);
    g.playerHand = g.playerHand.filter((c) => c.id !== tapped.id);
    g.aiHand = g.aiHand.filter((c) => c.id !== aCard.id);

    /* Both substitutions happen before either card is looked at, so two YOLOs
       in one round each flip their own deck and the two flipped cards fight
       each other — and so the AI's Discipline and Take Profit below read the
       card that is really on the table rather than the one that was tapped. */
    const pSub = pwSubstitute(g, tapped, "player");
    const aSub = pwSubstitute(g, aCard, "ai");
    let card = pSub.card;
    aCard = aSub.card;
    g.sub = { player: pSub.note, ai: aSub.note };
    [pSub.note, aSub.note].forEach((n) => {
      const line = pwSubLog(n);
      if (line) g.log = [line].concat(g.log);
    });

    /* The AI's Discipline resolves here and now: the player's card is already
       chosen, so the peek has nothing to wait for. It answers with the cheapest
       card that beats what it sees, and with its weakest if nothing does —
       spending no more than the round is worth. */
    /* The AI's Take Profit doubles itself when it can: more points its way is
       a straight gain, and the card it spends was going to be spent anyway. */
    if (aCard.type === "Take Profit") {
      const m = pwTakeProfitMatch(g.aiHand, card);
      if (m) {
        g.aiHand = g.aiHand.filter((c) => c.id !== m.id);
        g.aiDoubledUp = m;
      }
    }
    if (aCard.type === "Discipline") {
      const answer = pwAiAnswerPeek(g, card);
      if (answer) {
        g.aiHand = g.aiHand.filter((c) => c.id !== answer.id);
        g.log = [`Opponent plays Discipline, reads your card, and answers with ${answer.type}.`].concat(g.log);
        aCard = answer;
      } else {
        g.log = ["Opponent plays Discipline but holds nothing numbered to answer with."].concat(g.log);
      }
    }
    g.playerPlayed = card;
    g.aiPlayed = aCard;
    /* their slot held a card back until this moment, so the face turns over
       as it arrives — one render, then renderPointaeway clears the mark */
    g.flipAnim = aCard.id;
    /* Discipline is a peek, not a play. Their card is revealed now and the
       real answer is chosen against it — which means this one case genuinely
       breaks simultaneous reveal, deliberately. */
    if (card.type === "Discipline") {
      g.playerPlayed = null;            // Discipline itself never reaches the table
      g.aiPlayed = aCard;
      g.discipline = { card, aCard };
      if (!g.playerHand.some((c) => c.kind === "tier")) {
        // nothing numbered left to answer with: the peek is spent for nothing
        g.log = ["You play Discipline, but hold no numbered card to answer with — the round is a wash."].concat(g.log);
        g.discipline = null;
        g.phase = "resolving";
        hooks.render(g);
        hooks.reveal(g, () => pwApplyResult(g, pwDisciplineWash(card, aCard), card, aCard));
        return;
      }
      g.phase = "discipline-pick";
      hooks.render(g);
      return;
    }

    g.phase = "resolving";
    /* The round is decided the moment both cards are down; the delay is only
       so the reveal can be seen. Holding the outcome here rather than in the
       timer's closure means leaving the screen mid-reveal can still settle the
       round instead of stranding the match in "resolving" with nothing
       clickable on it. */
    g.pending = { result: pwResolveRound(card, aCard, g.playerSide, g.aiSide, g.candle), card, aCard };
    hooks.render(g);
    hooks.reveal(g, () => pwCommitPending(g, false));
  }

  /* The card each side fought with, kept for Diamond Hands. Discipline is the
     only card that can still reach here as itself — the unanswerable wash —
     and a peek nobody answered is not a card that fought, so it is skipped and
     the previous round's record stands. */
  function pwRecordLast(g, pCard, aCard) {
    const keep = (c) => c && !(c.kind === "special" && c.type === "Discipline");
    /* The two cards a YOLO flipped are dropped from the record and only the
       combined Power is kept: Diamond Hands copies that total, it does not
       flip two more cards — and a copy that still carried them would have the
       tally count the same two reveals twice. */
    const copy = (c) => { const o = Object.assign({}, c, { id: pwId(), ghost: true });
      delete o.yolo; return o; };
    if (keep(pCard)) g.lastP = copy(pCard);
    if (keep(aCard)) g.lastA = copy(aCard);
  }

  /* A Discipline that cannot be answered: both cards are spent, nobody scores. */
  function pwDisciplineWash(pCard, aCard) {
    return {
      candleDelta: 0, outcome: "wash",
      pDrawOwn: 1, aDrawOwn: 1, pExtraOwn: 0, aExtraOwn: 0,
      pReturnCard: false, aReturnCard: false,
      pDiscard: true, aDiscard: true,
      loserNeedsChoice: null, log: [],
    };
  }

  /* The answer to a peeked card. Discipline is discarded and the chosen card is
     what actually plays, resolved as any normal round would be. */
  function pwDisciplineAnswer(g, cardId) {
    if (g.phase !== "discipline-pick" || !g.discipline) return;
    const card = g.playerHand.find((c) => c.id === cardId);
    if (!card || card.kind !== "tier") return;      // wilds cannot answer a peek
    const aCard = g.discipline.aCard;
    g.discipline = null;
    g.playerHand = g.playerHand.filter((c) => c.id !== card.id);
    g.playerPlayed = card;
    g.phase = "resolving";
    g.pending = { result: pwResolveRound(card, aCard, g.playerSide, g.aiSide, g.candle), card, aCard };
    hooks.render(g);
    hooks.reveal(g, () => pwCommitPending(g, false));
  }

  function pwCommitPending(g, silent) {
    if (!g || !g.pending) return;
    const { result, card, aCard } = g.pending;
    g.pending = null;

    // the AI's double-up was decided when it played; fold it in now
    if (g.aiDoubledUp) {
      result.candleDelta *= 2;
      g.log = [`Opponent doubles up with a matching ${g.aiDoubledUp.type}.`].concat(g.log);
      g.aiDoubledUp = null;
    }

    /* The player's Take Profit stops here to ask. Leaving the screen settles
       the round instead, which passes — the safe half of the choice, since it
       keeps the card in hand. */
    if (card.type === "Take Profit" && !silent) {
      const match = pwTakeProfitMatch(g.playerHand, aCard);
      if (match) {
        g.tp = { result, card, aCard, match };
        g.phase = "takeprofit-choice";
        hooks.render(g);
        return;
      }
    }
    pwApplyResult(g, result, card, aCard, silent);
  }

  function pwTakeProfitChoose(g, doubleUp) {
    if (g.phase !== "takeprofit-choice" || !g.tp) return;
    const { result, card, aCard, match } = g.tp;
    g.tp = null;
    if (doubleUp) {
      result.candleDelta *= 2;
      // the matching card is spent: discarded, not returned and not recycled
      g.playerHand = g.playerHand.filter((c) => c.id !== match.id);
      g.log = [`You double up with your matching ${match.type} — ${pwSigned(result.candleDelta)}.`].concat(g.log);
    } else {
      g.log = ["You pass on doubling up — your matching card stays in hand."].concat(g.log);
    }
    g.phase = "resolving";
    pwApplyResult(g, result, card, aCard, false);
  }

  /* Local bags, one commit. Everything that draws does so against these
     copies; the match's own decks are only replaced once, at the end. */
  function pwApplyResult(g, result, pCard, aCard, silent) {
    const newCandle = pwClamp(g, g.candle + result.candleDelta);
    /* The round's candle, recorded once, here — this function runs exactly
       once per round on every path, including the two that stop to ask a
       question and come back (the draw choice and the Take Profit double-up).
       A wash opens and closes at the same figure, which is a doji, and that is
       the right thing for the chart to show. */
    g.chart.push({
      round: g.round, open: g.candle, close: newCandle,
      /* Copied, not referenced: a Class-A wash hands the untouched card back
         to its owner to be played again, so the same object can turn up in a
         later round. The replay has to show what was on the table in THIS
         one. */
      you: Object.assign({}, pCard), opp: Object.assign({}, aCard),
    });
    g.log = result.log.concat(g.log);

    /* An opponent tier card, once seen, is known for the rest of the match —
       but only five of each exist, so the tally stops there. A card can still
       be revealed more than once: a Class-A wash hands the untouched card back
       to its owner's hand to be played again. Counting those repeats is what
       pushed the tally past five into 6/5 and 7/5. Past five the tier is fully
       accounted for and another reveal carries no new information. */
    /* A YOLO total is two real cards, so both of them are what the tally
       counts — the total itself is not a card anybody holds. A Diamond Hands
       copy is the other way round and counts for nothing: it never came out of
       a deck, and counting it would have the tally claim a sixth Marubozu off
       a deck that only ever held five. */
    const revealed = aCard.yolo ? aCard.yolo : [aCard];
    if (!aCard.ghost) {
      revealed.forEach((c) => {
        if (c.kind !== "tier" || !g.seen.hasOwnProperty(c.type)) return;
        g.seen[c.type] = Math.min(pwCopies(g), (g.seen[c.type] || 0) + 1);
      });
    }

    /* What Diamond Hands will replay next round: the card that actually fought,
       which is the flipped card after a YOLO and the answer after a Discipline
       — both of those arrive here already substituted, so this needs to know
       nothing about either. A Discipline nobody could answer is the one round
       where no card fought, and it leaves the record alone rather than
       overwriting it with the peek itself. */
    pwRecordLast(g, pCard, aCard);

    const bags = { bull: g.bull.slice(), bear: g.bear.slice(), special: g.special.slice() };
    const draw = (source, side) => {
      const deck = bags[source === "special" ? "special" : side];
      return deck && deck.length ? deck.shift() : null;
    };

    let pHand = g.playerHand.slice();
    let aHand = g.aiHand.slice();

    /* Ghosts are never handed back. A wash that returns the card it was played
       against would otherwise turn a Diamond Hands copy into a real card in a
       real hand — a sixth copy of something there are only five of. */
    /* Ghosts and YOLO totals are never handed back. A wash that returns the
       card it was played against would otherwise turn a Diamond Hands copy
       into a real card in a real hand, or hand back one card where two were
       spent — YOLO and both flipped cards are discarded whatever the round
       did. */
    if (result.pReturnCard && !pCard.ghost && !pCard.yolo) pHand.push(pCard);
    if (result.aReturnCard && !aCard.ghost && !aCard.yolo) aHand.push(aCard);
    /* Discarded cards leave play. They were already out of their owner's hand
       when they were played, so there is nothing to do but not put them back —
       which is exactly what a tie now means. */

    for (let i = 0; i < result.aExtraOwn; i++) { const c = draw("own", g.aiSide); if (c) aHand.push(c); }
    for (let i = 0; i < result.pExtraOwn; i++) { const c = draw("own", g.playerSide); if (c) pHand.push(c); }

    // the winner's replacement is automatic; the loser gets the choice
    if (result.loserNeedsChoice !== "ai" && result.aDrawOwn > 0) {
      const c = draw("own", g.aiSide); if (c) aHand.push(c);
    }
    if (result.loserNeedsChoice === "ai") {
      const src = pwAiDrawSource(g, bags.special.length);
      const c = draw(src, g.aiSide);
      if (c) {
        aHand.push(c);
        g.log = [`Opponent draws from ${src === "special" ? "the wild pile" : "their own deck"}.`].concat(g.log);
      }
    }

    /* Nothing to choose between when both piles are empty: skip the screen and
       let the round finish with no replacement drawn, which is what either
       button would have done. The depletion check downstream is unchanged. */
    const nothingToDraw = bags[g.playerSide].length === 0 && bags.special.length === 0;
    if (result.loserNeedsChoice === "player" && !nothingToDraw) {
      // commit what is settled and stop for the player's choice of pile
      g.candle = newCandle;
      g.bull = bags.bull; g.bear = bags.bear; g.special = bags.special;
      g.playerHand = pHand; g.aiHand = aHand;
      g.pendingCandle = newCandle;
      g.phase = "draw-choice";
      if (!silent) hooks.render(g);
      return;
    }

    if (result.pDrawOwn > 0) { const c = draw("own", g.playerSide); if (c) pHand.push(c); }

    g.candle = newCandle;
    g.bull = bags.bull; g.bear = bags.bear; g.special = bags.special;
    g.playerHand = pHand; g.aiHand = aHand;
    pwFinishRound(g, newCandle, silent);
  }

  function pwChooseDraw(g, source) {
    if (g.phase !== "draw-choice") return;
    const bags = { bull: g.bull.slice(), bear: g.bear.slice(), special: g.special.slice() };
    const deck = bags[source === "special" ? "special" : g.playerSide];
    const c = deck && deck.length ? deck.shift() : null;
    if (c) {
      g.playerHand = g.playerHand.concat([c]);
      g.log = [`You draw from ${source === "special" ? "the wild pile" : "your own deck"}.`].concat(g.log);
    } else {
      g.log = ["Nothing left in that pile."].concat(g.log);
    }
    g.bull = bags.bull; g.bear = bags.bear; g.special = bags.special;
    pwFinishRound(g, g.pendingCandle);
  }

  /* Out of POINT cards: none in hand and none left in the deck. Leftover
     specials do not keep a player in the match.

     ==> RULES CHANGE, and a deliberate one. This used to need the shared wild
     pile to be empty as well, on the reasoning that a player with nothing but
     wilds can still draw and play. The brief for the How to Play screen states
     the rule the other way — "the match ends when a player has no point cards
     left in hand or deck, leftover specials don't count" — and writes it into
     page 8's copy, so the screen would otherwise describe a game this does not
     play. Matches now end sooner, and a YOLO that spends two cards off a thin
     deck can end one sooner still, which the brief calls intentional. */
  /* "Nothing to play" is not the same as "no cards", now that two of them can
     be in a hand and unplayable. A YOLO with an empty deck behind it is a card
     you are holding and cannot put down, and the first version of this read it
     as a hand with something in it — so a player left holding one sat in
     `selecting` with nothing on screen to click and the match never ended.
     Caught by the seeded run: seed 2 went to the harness's step cap at round
     32 holding exactly that. What counts here is what can actually be played. */
  const pwPlayable = (g, hand, who) => hand.filter((c) => !pwBlocked(g, c, who));

  const pwFullyOut = (g, hand, side) =>
    !hand.some((c) => c.kind === "tier") && pwOwnDeck(g, side).length === 0;

  /* An empty hand now has to be refilled rather than ending the match, which
     is new: under the old two-part rule an empty hand and an empty deck WAS
     the end, so no round could ever begin with nothing to play. Now the wild
     pile keeps that player in the game, and a card has to actually reach their
     hand or the next round asks them to play one they do not have — the AI
     reads .type straight off its choice and throws on nothing.

     Own deck first, wild pile second. It runs before the depletion check, so
     a hand is only still empty afterwards when every pile is empty too, which
     is exactly the case that ends the match. */
  function pwTopUp(g, hand, side, who) {
    /* the same test: a hand of cards that cannot be played is a hand that
       needs one, or the next round asks for a card nobody can put down */
    if (pwPlayable(g, hand, who).length) return;
    const own = pwOwnDeck(g, side);
    const c = own.length ? own.shift() : (g.special.length ? g.special.shift() : null);
    if (c) hand.push(c);
  }

  /* Win checks, in the documented order: the track first, then depletion.
     Depletion is asymmetric on purpose — one player hitting it ends the match
     even with the other holding a full hand, because the depleted player can
     never play or draw again and there is no game left to play against them.
     An exact 0 at depletion is a Doji, and a draw. */
  function pwFinishRound(g, finalCandle, silent) {
    const done = (w) => {
      if (g.phase === "gameover") return;   // a match ends once
      g.winner = w; g.phase = "gameover";
      hooks.recordMatch(g, w);
      if (!silent) hooks.render(g);
    };
    if (finalCandle >= pwTarget(g)) return done("bull");
    if (finalCandle <= -pwTarget(g)) return done("bear");
    // draw before judging: a hand that can be refilled is not a depleted one
    pwTopUp(g, g.playerHand, g.playerSide, "player");
    pwTopUp(g, g.aiHand, g.aiSide, "ai");
    const playerOut = pwFullyOut(g, g.playerHand, g.playerSide);
    const aiOut = pwFullyOut(g, g.aiHand, g.aiSide);
    if (playerOut || aiOut) return done(finalCandle === 0 ? "draw" : finalCandle > 0 ? "bull" : "bear");
    /* The played cards stay where they are — win, loss or wash alike. They are
       the round that just happened, and clearing them the instant it resolves
       leaves nothing to read in the gap before the next one. The next play
       replaces them. */
    g.round++;
    g.phase = "selecting";
    if (!silent) hooks.render(g);
  }

  /* The illustrated deck's wild faces. The tier faces and the folder they all
     live in are the app's business, but this one map is the engine's: a YOLO
     total is a card this module builds, and it has to carry its own face. */
  const PW_SPECIAL_ART = {
    "Volatility Spike": "special-volatility-spike",
    "Canceled Order": "special-canceled-order",
    "Liquidated": "special-liquidated",
    "FOMO": "special-fomo",
    "Stop Loss": "special-stop-loss",
    "Market News": "special-market-news",
    "Reversal": "special-reversal",
    "Take Profit": "special-take-profit",
    "Momentum": "special-momentum",
    "Discipline": "special-discipline",
    "YOLO": "special-yolo",
    "Diamond Hands": "special-diamond-hands",
  };

  const PWRules = {
    /* the hooks object itself, so a caller can fill in one and leave the rest */
    hooks,
    setRandom(fn) { rnd = typeof fn === "function" ? fn : function () { return Math.random(); }; },
    random() { return rnd(); },
    /* the card the second seat plays; left unset it is the app's own opponent */
    setAiChoice(fn) { aiPick = typeof fn === "function" ? fn : pwAiChooseCard; },

    // tables
    TIERS_BY_SIDE: PW_TIERS_BY_SIDE,
    SPECIALS: PW_SPECIALS,
    SPECIALS_SHOWN: PW_SPECIALS_SHOWN,
    SUBSTITUTES: PW_SUBSTITUTES,
    CLASS_A: PW_CLASS_A,
    SPEC: PW_SPEC,
    POINTS: PW_POINTS,
    POINT_RULES: PW_POINT_RULES,
    SPEC_COLOURS: PW_SPEC_COLOURS,
    SPEC_PER_COLOUR: PW_SPEC_PER_COLOUR,
    DEFAULT_SETTINGS: PW_DEFAULT_SETTINGS,
    STRONG_REPLAY: PW_STRONG_REPLAY,
    SPECIAL_ART: PW_SPECIAL_ART,
    TARGET: PW_TARGET,
    TIER_COPIES: PW_TIER_COPIES,

    // pure helpers
    tiers: pwTiers,
    settings: pwSettings,
    rules: pwRules,
    target: pwTarget,
    copies: pwCopies,
    id: pwId,
    buildTierDeck: pwBuildTierDeck,
    pickSpecialTypes: pwPickSpecialTypes,
    buildSpecialDeck: pwBuildSpecialDeck,
    shuffle: pwShuffle,
    sign: pwSign,
    clamp: pwClamp,
    signed: pwSigned,
    emptyCounts: pwEmptyCounts,
    effPts: pwEffPts,
    cardLabel: pwCardLabel,
    cardsMatch: pwCardsMatch,
    takeProfitMatch: pwTakeProfitMatch,
    worthReplaying: pwWorthReplaying,
    resolveRound: pwResolveRound,
    disciplineWash: pwDisciplineWash,
    subLog: pwSubLog,

    // the AI
    aiChooseCard: pwAiChooseCard,
    aiAnswerPeek: pwAiAnswerPeek,
    aiDrawSource: pwAiDrawSource,

    // the match
    newGame: pwNewGame,
    deal: pwDeal,
    ownDeck: pwOwnDeck,
    blocked: pwBlocked,
    substitute: pwSubstitute,
    play: pwPlay,
    disciplineAnswer: pwDisciplineAnswer,
    commitPending: pwCommitPending,
    takeProfitChoose: pwTakeProfitChoose,
    applyResult: pwApplyResult,
    chooseDraw: pwChooseDraw,
    recordLast: pwRecordLast,
    playable: pwPlayable,
    fullyOut: pwFullyOut,
    topUp: pwTopUp,
    finishRound: pwFinishRound,
  };

  /* Both ways out, because there are two readers: a classic script tag in the
     app and a require/import on the server. */
  if (typeof globalThis !== "undefined") globalThis.PWRules = PWRules;
  if (typeof module !== "undefined" && module.exports) module.exports = PWRules;
})();
