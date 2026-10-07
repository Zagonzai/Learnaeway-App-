# The ÆWAY market

The ÆWAY chart is a live market moved only by Pointæway match results. A Bull
winning a match takes the price up, a Bear winning takes it down, and nothing
else touches it. Predictions read the price; they never move it.

Until there is a server to run the market on, the chart plays back a **90-day
recording** of the 10,000-bot simulator against the real clock. Every phone maps
the same clock onto the same recording, so every phone shows the same chart at
the same moment, with nothing passing between them.

## The files

| file | what it is |
| --- | --- |
| `sim/market.js` | finished matches in, five-minute candles out. The log-space price lives here. |
| `sim/record.js` | the offline recorder: 90 days, one file per day, plus the stitch pass |
| `sim/report.js` | the admin report, from the whole recording, as aggregates only |
| `js/aeway-codec.js` | the recording's file format — **shared** by the recorder and the phone |
| `js/aeway-market.js` | the data source behind one switch, and the playback clock |
| `js/aeway-chart.js` | the canvas painter and its geometry |
| `js/app.js` | the screen: markup, state, gestures, predictions, the admin page |
| `data/aeway/` | `manifest.json`, `day-000.txt` … `day-089.txt`, `report.json` |

## Price moves by percentage

A Bull win adds ε to the **log** of the price and a Bear win takes ε off it:

```
price = 10,000 × e^(ε × (Bull wins − Bear wins))
```

Three things follow, and all three are why it is done this way rather than ±1 a
win:

- a move is a percentage, so the chart reads the same at 9,000 as at 90,000;
- the price can get arbitrarily small and can never reach or cross zero, so
  "never below zero" is a property of the arithmetic and not a clamp;
- **equal wins leave the price exactly where it started.** An equal candle is a
  doji to the last decimal place, and a candle is green exactly when Bulls won
  more matches in it — the two cannot disagree, because the price is a monotonic
  function of the net wins.

Colour is still read off the win counts rather than off the rounded close, since
a displayed price has been through a rounding step and a win count has not.

ε is in `sim/config.js` with its derivation beside it. See **Tuning ε** below.

## Candles

Each five-minute candle stores: open, high, low, close, Bull wins, Bear wins,
Bull points, Bear points, matches, draws, **and a 30-step path** — the price and
the running Bull/Bear points at every ten seconds inside it. Predictions settle
off that path, so it is exact rather than interpolated: a sample is the state at
the end of its ten seconds, the last sample of a candle *is* its close, and the
next candle's open is this one's close.

The 10, 15, 20 and 30-minute timeframes are built by combining five-minute
candles. Everything is clock-aligned for free, because the five-minute bucket
index comes off the Unix epoch and 300,000 ms divides a day.

Open is the previous candle's close, so the recording stores one opening number
and the rest chain. That identity is also the file's integrity check.

## Nothing is a price on disk

A candle's prices are not stored. The whole price series is one integer per point
in time — the running total of net wins — and the browser recomputes the prices
with the same formula the recorder used. Exact, tiny, and no float drift between
the two sides.

## The recording

```
node sim/record.js --from 0  --to 29       # three workers, contiguous days
node sim/record.js --from 30 --to 59
node sim/record.js --from 60 --to 89
node sim/record.js --stitch                # offset, encode, write data/aeway/
node sim/report.js                         # data/aeway/report.json
```

Two passes because price is cumulative: a worker cannot know its own opening
price, so each records its days counting from zero and the stitch pass walks them
in order and adds the offset.

A worker's days are contiguous **not** for speed but because the population is
continuous within a run, and the one place it is allowed to be discontinuous is a
day boundary — where every bot re-flips its side anyway. A worker boundary on a
day boundary is therefore the same reset the specification already asks for.

105 million matches is about seven hours of one core, so it is split three ways
and takes about two and a half hours.

**Size:** about 62 KB per day on disk, 47 KB on the wire (GitHub Pages compresses
it), 5.5 MB for all 90 days. A phone fetches the day it is looking at and nothing
else.

## Playback

```
absolute candle = floor(now / 5 minutes)
position        = (absolute − epoch) mod 25,920
lap             = floor((absolute − epoch) / 25,920)
```

When the 90 days run out the sequence starts again and **the price does not**.
The manifest carries `netPerLap` — what one full pass adds to the cumulative net
wins — so lap N opens N of those above zero. The price continues through the seam
with no step at all.

## Nothing past the current time

Today's file holds the rest of today, because a file is a day and a day contains
its own afternoon. So the rule is enforced in `js/aeway-market.js`, not in the
drawing code:

- `bar5` returns `null` for any candle that has not opened;
- the candle that is forming comes back truncated to the last complete
  ten-second sample, with its high and low computed from what has actually
  happened rather than from the stored extremes of the whole candle;
- `need` refuses to fetch a day file that begins after now;
- a forming candle's **win counts are estimated** from the recording's overall
  average Print per win, never from the candle's own eventual average — that
  would be a number from the future, however small. Points are exact; the
  estimate is marked `forming` in the readout, and nothing settles against it.

The day files are scrambled (`js/aeway-codec.js`) so that a tester with the
network tab open sees noise rather than a spoiler. **That is obfuscation and
nothing more** — the key is in the source. It is accepted for a beta where points
are play points, and it is the reason predictions must move to a server before
Æway points are worth anything.

## The one switch

```js
// js/config.js
window.LEARNAEWAY_CONFIG.aeway = { source: "recording" };   // or "live"
```

`js/aeway-market.js` holds two implementations behind one interface, and nothing
above that layer knows which one it got. When there is a Realtime Database feed,
the `LIVE` object in that file is the only thing that has to be written.

## Predictions

Play points, on the device. BULL and BEAR with the countdown between them,
one prediction per timeframe per candle, entries closing in the last 15 seconds.

- the entry counts from the **next ten-second sample** after the tap, so nothing
  already banked can be claimed;
- at the close: your side won the candle and you gain your own side's post-entry
  points; your side lost and you lose the other side's; a tied candle pays
  nothing;
- raw points are converted at a rate set from the average total volume of the
  last 12 candles of that timeframe and **locked at the candle's open**:
  `rate = 200 ÷ (average ÷ 2)`, so a full-candle prediction pays about 200 on a
  normal candle and more on a big one;
- the balance starts at 10,000, never goes below zero, and resets from Settings.

**The balance is kept on the device and never reaches Firestore.** Spark allows
20,000 document writes a day across the whole project; a tester holding
predictions on all five timeframes settles five of them every five minutes, which
is 1,400 writes a day each before the course, the journal and the notes have
written anything. That could not be guaranteed to stay inside the free tier, so
predictions use a local save that does not trigger the cloud push at all. The fix
is the same move the brief already requires: settle on a server.

**The clock is the device's**, because there is no server to check it against.
A tester who moves their phone's clock moves their own chart and their own
entries with it.

## Admin

Hidden from testers. Either the signed-in account's email is in
`LEARNAEWAY_CONFIG.adminEmails`, or `adminPasscode` is typed into the box behind
a **long press on the "Simulated market" tag**. Both are client-side, so both are
distribution keys rather than secrets — the same footing as the beta access
passcode. The page shows the simulator's own report, a 10,000 / 1,000,000-player
switch, and no money, pricing or user data of any kind.

The report is generated offline and shipped as **aggregates only**. A report
carrying 90 days of closes would hand over in plaintext exactly what the
scrambling exists to withhold, so anything needing the real shape of the market —
the CSV export, the wins-against-points comparison — is built in the browser out
of days that have already played.

## Tuning ε

Net wins over a day are a fair coin walk, so

```
ε = target daily move ÷ sqrt(decided matches per day)
  = 0.01 ÷ sqrt(4,050 × 288 × 0.969) = 9.4e-6
```

That is an estimate, and it comes out slightly high because the market is not
quite a pure random walk: the recording shows a lag-1 autocorrelation of about
−0.07, which *reduces* the daily variance below the square-root rule. So ε is
calibrated against the finished recording rather than left at the formula's
value — `node sim/report.js` prints the realised typical day, and ε is scaled by
`0.01 / realised` and the recording re-stitched. Re-stitching is about a minute:
the day files store integers, and ε only turns integers into prices.

That lag-1 figure is itself worth knowing about. It comes from bots alternating
sides while the four play styles win at different rates — a strong bot wins as
Bull, rests, and wins again as Bear, contributing +1 and then −1. It is small,
real index futures do something similar at short horizons, and it would go away
if the styles were levelled or the sides drawn at random instead of alternated.
It is an artefact of the matchmaking rather than anything anybody designed.
