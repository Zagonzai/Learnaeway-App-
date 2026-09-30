# Create Match — what the backend still has to do

Create Match ships complete on the client. The host picks the match's shape,
gets a code, and sends it; the friend types it in, is shown the settings, and
joins the same private lobby. Everything in this document is the part that
lives in `js/online/`, which this build was asked to flag rather than rewrite.

Nothing below is required for the screens, the settings, the deck sizes, the
starting hands or the code to work — those are done and tested. It is required
for a Create Match **played online** to run under its own settings end to end.

---

## What the client does today, and why

### The code carries the settings

A match code is six characters: four random from a 21-letter alphabet, then two
digits — the point target's index in `PW_POINTS` (1–4 → 10/15/20/25) and how
many specials per colour (0–3).

```
  V Q H G 2 2
  └──┬──┘ │ │
   random │ └── 2 specials of each colour
          └──── index 2 of [10,15,20,25] = 15 points
```

So the settings travel with the code. Two consequences, both deliberate:

* the friend who types a code in is shown the match's shape **before** joining,
  with no lookup and no round trip;
* both clients derive the same deck, the same starting hand and the same finish
  line from the same six characters, so they cannot disagree even though no
  room field carries any of it.

### The code is also the lobby

`quickMatch` filters the lobby on an exact `game` string, so the client enters
the queue as `pointaway#VQHG22` instead of `pointaway`. That makes a lobby of
exactly two: the host and whoever types that code. Nobody else can be matched
into it, and a code with one character wrong is a different empty lobby rather
than a match played under settings the two players disagree about.

This needs no change to `matchmaking.js` and no change to `firestore.rules` —
the rules never look at `game`.

### Where the client reads the settings back

`pwOnSettings(room)` in `js/app.js`:

1. `room.settings`, if the room has it — this is the field that does not exist
   yet, and it wins when it does;
2. otherwise the code parsed out of `room.game`;
3. otherwise the 25-point default.

So the day room creation starts storing settings, the client picks them up with
nothing to change here.

---

## 1. Room creation must store the settings

**Files:** `js/online/matchmaking.js` (`findAndClaimOpponent`), and
`js/online/invites.js` (`acceptInvite`) if invites are ever to carry settings.

Both write the room document, and both write the same shape. Add one field:

```js
tx.set(roomRef, {
  game,                       // stays 'pointaway' — the code moves to its own field
  matchCode: code || null,    // the six characters, for display and for rematch
  settings: {                 // ← the new field
    points: 25,               // 10 | 15 | 20 | 25
    perColour: 3,             // 0 = no specials, else 1 | 2 | 3 of each colour
  },
  ...
});
```

The value has to come from the queue entry, because the room is created by
whichever player wins the transaction — which may be the joiner, not the host.
So `joinQueue` needs to carry it too:

```js
await setDoc(doc(db, 'matchmaking', uid), {
  ..., game, settings, matchCode,
});
```

and `findAndClaimOpponent` should copy the settings off **the queue entry it
claims**, not off the caller — or, more safely, refuse to claim an opponent
whose `settings` differ from its own. With the settings in the code today that
cannot happen; once they are a separate field it can, and the room would be
created under whichever player happened to win the race.

Until this lands the client keeps deriving the settings from the code, so the
two players still agree. The reason to do it anyway is that it makes the room
self-describing: match history, replays and anything server-side can read what
a match was without knowing how to parse a code.

## 2. `pointaway.js` must end the match at the Print, not at five rounds

**File:** `js/online/pointaway.js`, `tryResolveRound`.

```js
// First to 5 round-wins takes the match (tunable).
const champ = [p1, p2].find((u) => (scores[u] || 0) >= 5);
```

This is the one thing the client cannot work around. The board already shows
the Print and the meter is already labelled for the match's own target, but the
match still **ends** when somebody takes five rounds — which at 10 points is
usually late and at 25 points is usually early. The condition has to become:

```js
const close = candle.close - 100;                 // the Print, from the opening 100
const target = room.settings?.points ?? 25;
if (close >= target)        { updates.status = 'finished'; updates.winner = bullUid(room); }
else if (close <= -target)  { updates.status = 'finished'; updates.winner = bearUid(room); }
```

where the bull seat is `room.players[0]` and the bear seat `room.players[1]`,
which is the order the client already reads (`pwOnSide`).

Note this also changes what "winner" means online — today it is who took five
rounds, and it should be whose direction the Print reached. Anything reading
`room.winner` (`recordMatchResult`, the online match history) follows for free.

## 3. A move needs to be able to carry a wild

**File:** `js/online/pointaway.js`, `printCandle` and the `card` shape.

```
 * A move (card): { side: 'bull' | 'bear', power: 1..5 }
```

`printCandle` only sums `power`, so a specialty card sent over the wire would
resolve as a zero and do nothing. That is why online decks are candle cards
only today and the Wild counter reads 0 — which is the truth, not a
placeholder.

The **specialty setting therefore has no effect on an online match yet.** The
host can pick it, the code carries it, both clients agree on it, and the local
engine honours it in full — but a live room has no wilds to apply it to. This
is the largest gap between what Create Match offers and what an online match
currently does, and it is worth knowing before the setting is put in front of
players.

Making it real means teaching the module the wilds: a move shape like
`{ side, kind: 'tier'|'special', power, type }`, and `printCandle` resolving the
ten effects the way `pwResolveRound` does in `js/app.js`. That is a port of the
rules into the module, not a tweak, and it is the honest reason this document
exists rather than a patch.

## 4. The deck is still the client's reading of the room

**File:** `js/app.js`, `pwOnOrder` / `pwOnSeat`.

Unchanged by this batch and noted for completeness: the room has no deck or
hand field, so each client derives both from a hash of `roomId:uid` plus the
settings. It is deterministic, so both sides agree, and it is not anti-cheat —
the anti-cheat is the commit-reveal in `pointaway.js`, which covers the thing
that matters. If the deck ever has to be authoritative it belongs in the room.

---

## Summary

| # | Change | File | Blocks |
|---|---|---|---|
| 1 | Store `settings` (and `matchCode`) on the room; carry them through the queue | `matchmaking.js`, `invites.js` | nothing today — the code carries them |
| 2 | End the match when the Print reaches ±`settings.points` | `pointaway.js` | the point target having any effect online |
| 3 | Let a move carry a wild, and resolve the ten effects | `pointaway.js` | the specialty setting having any effect online |
| 4 | (optional) Make the deck authoritative | `pointaway.js` | nothing; noted for completeness |

Until 2 and 3 land, an online Create Match plays with the deck size and hand
size the host chose — both clients agree on those — and ends on the module's
first-to-five, with no specialty cards. The screens, the code, the join flow and
the local engine are complete and do not depend on any of it.
