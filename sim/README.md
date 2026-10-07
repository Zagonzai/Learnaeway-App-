# The ÆWAY match simulator

Ten thousand bots playing real Pointæway matches against each other, so the ÆWAY
chart has something to move it before there are enough real players to move it.

Nobody can watch a bot match. Only the results leave this directory.

```
node sim/run.js                          90 minutes of market time, measured
node sim/run.js --bots 10000 --minutes 240
node sim/run.js --replay <seed>          one match, card by card, for auditing
node sim/run.js --live                   against the real clock, for ever
node sim/selftest.js                     the invariants a chart cannot survive losing
```

## The files

| file | what it is |
| --- | --- |
| `../js/pw-rules.js` | **the game.** The same file the app loads in the browser. Not a copy of it. |
| `rng.js` | one seeded xorshift32, so a match is a pure function of its seed |
| `styles.js` | the four play styles. They choose cards. They do not know any rules. |
| `match.js` | one match, played whole, in memory, with no screen |
| `sim.js` | the population, the matchmaking, and the clock |
| `results.js` | the one door every finished match comes through |
| `market.js` | and what is behind it: finished matches in, five-minute candles out |
| `record.js` | the offline recorder — 90 days, one file a day, and the stitch pass |
| `report.js` | the admin report, from the whole recording, as aggregates only |
| `../js/aeway-codec.js` | the recording's file format, shared with the phone |
| `config.js` | every number somebody might want to change |
| `run.js` | the command line, and the measurements |
| `selftest.js` | `node sim/selftest.js` |

The market, the recording and the chart that plays it back have their own
write-up in [`docs/aeway-market.md`](../docs/aeway-market.md).

## Why it is cheap

A match is not played in real time. The moment it starts it is played to the last
card — about six hundred microseconds — and the only thing left on the clock is
*when it would have finished*. That turns ten thousand live matches into a sorted
list of future timestamps.

Measured, 10,000 bots, 90 minutes of market time, one core of a cloud container:

```
4,050 matches finished per 5-minute candle
median match 5m53s, 94.1% between 2 and 10 minutes, longest 8m28s
48.6% Bull wins, 48.3% Bear, 3.1% draws
48 seconds of CPU  ==>  12.9 minutes of CPU per 24-hour day
```

So the simulator uses about **1% of one CPU core**, continuously, and around
250 MB of memory. That is the whole compute cost of the market.

## How the duration is tuned

`config.styles[*].think` is how long one bot takes over one card. A round takes as
long as the slower of the two bots, because they choose at the same time, and a
match is its rounds — which the decks hold to a median of 32.

The two numbers in the brief turn out to be the same number. A bot cycles every
`match + rest` seconds and each match uses two bots, so

```
matches per 5-minute candle = 300 × bots / (2 × (mean match + mean rest))
```

With 10,000 bots and a 35-second mean rest, 4,000 matches per candle needs a mean
match of 340 seconds — 5m40s, which is exactly the "typical match around 5–6
minutes" the brief asks for. The think ranges in `config.js` were fitted to land
there and are deliberately narrow: a wide range puts the long tail past ten
minutes without moving the median.

To change the candle rate, move `bots`. To change how long a match feels, move
`think`. They are not independent, and the formula above says how they trade.

## Where it runs

It needs **one small always-on process**. Not a browser: the chart is shared, and
a price every client computes for itself is a price every client can disagree
about. Not a scheduled function either — Cloud Scheduler's floor is one minute and
the brief wants the forming candle refreshed every one to two seconds, so the
process has to stay up between ticks.

Given it needs 1% of a core:

- **Cloud Run**, one service, `min-instances=1` and `max-instances=1`, 0.25–0.5
  vCPU, 512 MiB, CPU always allocated. The always-allocated vCPU is essentially
  the entire bill: on the order of **$10–25 a month**.
- **A GCE `e2-micro`**, which is ample for this and is in the always-free tier in
  some US regions, otherwise around **$7 a month**.

Either way this needs the **Blaze** plan; Spark will not run a process.

`max-instances=1` is not a cost control, it is correctness: two instances would
play two separate populations into one chart and double every candle. The
simulator must be a single writer.

> The dollar figures are the right order of magnitude and the right shape — the
> cost is one small always-on instance and nothing else — but they should be
> checked against the current price list for the region before anybody commits to
> them.

## How clients get live updates

Two separate things, because they have very different costs.

**Closed candles** are immutable once their five minutes are up. One document per
candle, 288 a day, written once. A client reads the history it needs on first
paint and then never re-reads it. That is cheap at any number of users.

**The forming candle and the current price** are one small document, rewritten
every two seconds, which every client holds a snapshot listener on. This is the
part that can get expensive, and the expense is **client reads, not the
simulator**: a per-second document watched by a thousand clients is a thousand
reads a second whatever the simulator costs.

So:

- throttle the live document to one write every two seconds and no faster — the
  brief's own figure, and it is a cost ceiling as much as a refresh rate;
- keep it small, and keep the closed candles out of it;
- if the live document turns out to dominate the bill, move **only** that one node
  to the Realtime Database, which charges for bandwidth rather than per read. The
  closed candles stay in Firestore.

The app already talks to Firestore through `window.FB` and `js/online/`, so the
chart reads through the bridge that is already there rather than a new one.

One thing to get right when Phase 2 lands: **the price must be read back from the
last closed candle on startup.** The simulator is deterministic from its seed but
the price is not a function of the seed alone — it is the running total of every
match that ever finished — so a restart that began at 10,000 again would erase the
market's history.

## What is deliberately not here

- **Candles.** That is Phase 2. Everything a candle needs comes out of
  `results.js`, and the candle builder hangs off `onResult`.
- **Human matches.** They will arrive through `submitResult` like everything else;
  `config.acceptFrom` lists who may post one, and today it lists only `"bot"`, so
  a human result raises rather than being silently dropped.
