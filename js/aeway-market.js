/* ==================== the ÆWAY market, as the app sees it ====================
 *
 * One interface, two implementations, one switch.
 *
 *     AewayMarket.config.source = "recording"    the 90-day recording (today)
 *                                "live"          a Realtime Database feed (later)
 *
 * ==> THAT LINE IS THE SWITCH. It is the only thing that has to change when
 * there is a server to read from, and it can also be set from js/config.js
 * without touching this file:
 *
 *     window.LEARNAEWAY_CONFIG.aeway = { source: "live" };
 *
 * Everything above this layer — the chart, the crosshair, the predictions —
 * goes through the same six functions whichever source is selected, and none of
 * them knows which one it got.
 *
 * ---- the recording, and the clock ----
 *
 * The recording is 90 × 288 = 25,920 five-minute candles in a numbered
 * sequence. Nothing in it is tied to a date. The real clock is mapped onto it:
 *
 *     absolute candle = floor(now / 5 minutes)        same on every device
 *     position        = (absolute − epoch) mod 25,920
 *     lap             = floor((absolute − epoch) / 25,920)
 *
 * Two phones that agree on the time therefore agree on the chart to the candle,
 * with nothing passing between them — which is the whole reason the market is a
 * recording rather than something each phone generates for itself.
 *
 * Because the five-minute buckets come off the Unix epoch and 300,000 ms
 * divides a day, the buckets land on :00, :05, :10 — clock-aligned for free, and
 * so are the 10, 15, 20 and 30-minute timeframes built out of them.
 *
 * ---- the loop ----
 *
 * When the 90 days run out the sequence starts again, and the price does not.
 * Price is startPrice × e^(ε × cumulative net wins), and the recording's
 * manifest carries `netPerLap` — what one full pass adds to that total. Lap N
 * simply opens N of those above zero, so the price continues through the seam
 * with no step at all, and the candle either side of it is the candle it was.
 *
 * ---- nothing past now ----
 *
 * Today's file holds the rest of today, because a file is a day and a day
 * contains its own afternoon. The chart therefore cannot be allowed to read it
 * freely, and the rule is enforced here rather than in the drawing code:
 *
 *   - `bar5` returns null for any candle that has not opened yet;
 *   - the candle that is forming is returned truncated to the last complete
 *     ten-second sample, with its high and low computed from what has actually
 *     happened rather than from the stored extremes of the whole candle;
 *   - `need` refuses to fetch a day file that begins after now.
 *
 * The scrambling in js/aeway-codec.js is what stops a tester reading the file;
 * this is what stops the app drawing it. Neither is a substitute for a server,
 * and the comment at the top of the codec says why.
 */
(function () {
  "use strict";

  const CODEC = window.AewayCodec;

  const DEFAULTS = {
    /* ---- the switch ---- */
    source: "recording",

    /* where the recording lives, and how far back it may be panned */
    dir: "data/aeway/",
    historyDays: 90,
    /* how many day files to keep decoded. Each is about 150 KB of typed
       arrays, so this is a quarter of a megabyte per week of panning. */
    cacheDays: 16,

    /* The moment the recording's first candle is pinned to. Fixed, in the past,
       and the same for everyone: it is what makes two phones agree, and moving
       it moves every chart. Far enough back that a tester on day one already
       has months of history to pan through. */
    epochMs: Date.UTC(2026, 0, 1, 0, 0, 0),

    /* Where the market's clock comes from. With no server there is nothing to
       check the device against, so the device is the clock — a tester who moves
       their phone's clock moves their own chart. That is survivable for play
       points and is not survivable for anything else, which is the third reason
       predictions have to move server-side before Æway points are worth
       anything. A server time source drops in here as a millisecond offset. */
    skewMs: 0,
  };

  const config = Object.assign({}, DEFAULTS,
    (window.LEARNAEWAY_CONFIG && window.LEARNAEWAY_CONFIG.aeway) || {});

  /* the timeframes the chart offers, as multiples of the base candle */
  const TFS = [
    { id: "5m", label: "5m", min: 5, k: 1 },
    { id: "10m", label: "10m", min: 10, k: 2 },
    { id: "15m", label: "15m", min: 15, k: 3 },
    { id: "20m", label: "20m", min: 20, k: 4 },
    { id: "30m", label: "30m", min: 30, k: 6 },
  ];
  const tfOf = (id) => TFS.find((t) => t.id === id) || TFS[0];

  let man = null;             // the manifest
  let CANDLE_MS = 300000, SAMPLE_MS = 10000, SAMPLES = 30, PER_DAY = 288, TOTAL = 25920;

  /* ---------------- the clock ---------------- */

  const nowMs = () => Date.now() + config.skewMs;
  const idxAt = (ms) => Math.floor(ms / CANDLE_MS);
  const startOf = (idx) => idx * CANDLE_MS;
  /* the newest candle that has opened */
  const liveIdx = () => idxAt(nowMs());
  /* the first candle the chart will ever show */
  const firstIdx = () => Math.max(
    idxAt(config.epochMs),
    liveIdx() - config.historyDays * PER_DAY + 1);

  /* where an absolute candle sits in the recording, and how many laps in */
  function place(idx) {
    const n = idx - idxAt(config.epochMs);
    const lap = Math.floor(n / TOTAL);
    const rec = n - lap * TOTAL;
    return { lap, rec, day: Math.floor(rec / PER_DAY), slot: rec % PER_DAY };
  }

  const priceOf = (net) => man.startPrice * Math.exp(man.epsilon * net);

  /* ---------------- the recording source ---------------- */

  /* Bumped whenever a day is decoded. The chart repaints on a fetch only when
     this has moved, so a pan over days that are already in memory costs one
     paint a frame instead of two. */
  let version = 0;

  const days = new Map();      // day number -> decoded day
  const order = [];            // least recently used first
  const pending = new Map();   // day number -> Promise

  function touch(day) {
    const i = order.indexOf(day);
    if (i >= 0) order.splice(i, 1);
    order.push(day);
    while (order.length > config.cacheDays) days.delete(order.shift());
  }

  function fetchDay(day) {
    if (days.has(day)) { touch(day); return Promise.resolve(days.get(day)); }
    if (pending.has(day)) return pending.get(day);
    const name = `${config.dir}day-${String(day).padStart(3, "0")}.txt`;
    const p = fetch(name, { cache: "force-cache" })
      .then((r) => { if (!r.ok) throw new Error(`${name}: ${r.status}`); return r.text(); })
      .then((txt) => {
        const d = CODEC.decodeDay(txt.trim(), { day, samples: SAMPLES, key: man.key });
        days.set(day, d);
        version++;
        touch(day);
        pending.delete(day);
        return d;
      })
      .catch((e) => { pending.delete(day); throw e; });
    pending.set(day, p);
    return p;
  }

  /* Make sure every candle in [from, to] can be read. Anything after the candle
     that is forming is dropped rather than fetched: a file that begins in the
     future is the one thing this must never pull down. */
  function need(from, to) {
    const hi = Math.min(to, liveIdx());
    const lo = Math.max(from, firstIdx());
    if (hi < lo) return Promise.resolve();
    const want = new Set();
    for (let i = lo; i <= hi; i += PER_DAY) want.add(place(i).day);
    want.add(place(hi).day);
    return Promise.all([...want].map(fetchDay)).then(() => undefined);
  }

  /* a decoded day, if it is already in memory */
  function dayOf(idx) {
    const p = place(idx);
    const d = days.get(p.day);
    return d ? { d, p } : null;
  }

  /* ---------------- reading candles ---------------- */

  /* How many ten-second samples of the forming candle have completed. 0 means
     the candle has only just opened and nothing inside it is known yet, which
     is why the live price is its open until the first sample lands. */
  function samplesDone(idx) {
    const el = nowMs() - startOf(idx);
    if (el >= CANDLE_MS) return SAMPLES;
    return Math.max(0, Math.min(SAMPLES, Math.floor(el / SAMPLE_MS)));
  }

  /* One base candle, prices and all, or null if it is not available — either it
     has not opened, it is older than the chart goes, or its day is not loaded.

     A candle that is still forming comes back with `forming: true` and with
     everything in it truncated to the last complete sample. Its high and low
     are taken from the samples that have happened and NOT from the stored
     extremes, because the stored extremes are the whole candle's and the whole
     candle has not happened yet. */
  function bar5(idx) {
    if (idx > liveIdx() || idx < firstIdx()) return null;
    const got = dayOf(idx);
    if (!got) return null;
    const { d, p } = got;
    const c = d.candles[p.slot];
    if (!c) return null;
    const off = p.lap * man.netPerLap;
    const openNet = c.openNet + off;

    const done = idx === liveIdx() ? samplesDone(idx) : SAMPLES;
    if (done >= SAMPLES) {
      return {
        idx, t: startOf(idx), forming: false,
        openNet, closeNet: c.closeNet + off,
        open: priceOf(openNet), high: priceOf(c.hiNet + off),
        low: priceOf(c.loNet + off), close: priceOf(c.closeNet + off),
        bullWins: c.bullWins, bearWins: c.bearWins, draws: c.draws,
        bullPts: c.bullPts, bearPts: c.bearPts, matches: c.matches,
        up: c.bullWins > c.bearWins ? 1 : c.bullWins < c.bearWins ? -1 : 0,
        samples: SAMPLES,
      };
    }

    /* the forming candle: walk the samples that exist */
    let net = c.openNet, hi = c.openNet, lo = c.openNet;
    let bp = 0, bq = 0;
    for (let s = 0; s < done; s++) {
      const k = c.from + s;
      net = c.openNet + d.pathNet[k];
      if (net > hi) hi = net;
      if (net < lo) lo = net;
      bp = d.pathBull[k];
      bq = d.pathBear[k];
    }
    /* ---- the win counts of a candle that has not finished ----
       Wins are not sampled. The path carries the net (which IS bull wins minus
       bear wins, exactly) and the two point totals, and a point total does not
       divide into a win count: a win is worth anywhere from 1 to 25.

       So the counts are estimated, from the recording's own average Print per
       win and nothing else. Reading this candle's eventual average would be
       more accurate and is not allowed: it is a number from the future, however
       small a number it is.

       The estimate is then made consistent with what IS exact — the difference
       between the two counts is the net, to the match — so the readout can
       never show a green candle with more Bear wins in it. It is accurate to
       about one percent on two thousand wins, it is only ever shown for the
       candle that is forming, and nothing settles against it: a prediction
       settles on the points, and the history of a settled prediction quotes the
       closed candle's exact counts. */
    const netWins = net - c.openNet;
    const mean = man.meanPrint || 13.5;
    const decided = Math.max(Math.abs(netWins), Math.round((bp + bq) / mean));
    const bullWins = Math.round((decided + netWins) / 2);
    return {
      idx, t: startOf(idx), forming: true,
      openNet, closeNet: net + off,
      open: priceOf(openNet), high: priceOf(hi + off),
      low: priceOf(lo + off), close: priceOf(net + off),
      bullWins, bearWins: decided - bullWins,
      draws: Math.round(decided * (man.drawRate || 0.031) / (1 - (man.drawRate || 0.031))),
      bullPts: bp, bearPts: bq,
      matches: decided + Math.round(decided * (man.drawRate || 0.031) / (1 - (man.drawRate || 0.031))),
      estimated: true,
      up: netWins > 0 ? 1 : netWins < 0 ? -1 : 0,
      samples: done,
    };
  }

  /* The running points inside one candle at a given sample, which is what a
     prediction settles against. `s` is a sample index, 0..29, and the answer is
     the total at the END of that ten seconds. −1 means the candle's open, where
     nothing has happened yet. */
  function runningAt(idx, s) {
    const got = dayOf(idx);
    if (!got) return null;
    const { d, p } = got;
    const c = d.candles[p.slot];
    if (s < 0) return { bull: 0, bear: 0, net: 0 };
    const k = c.from + Math.min(SAMPLES - 1, s);
    return { bull: d.pathBull[k], bear: d.pathBear[k], net: d.pathNet[k] };
  }

  /* Which sample a prediction entered at. The brief: the entry counts from the
     next ten-second sample after the tap, so nobody is credited with a move
     that had already happened when they tapped. floor() is exactly that — a tap
     at +37s gets sample 3, which closes at +40s. */
  const entrySample = (idx, ms) =>
    Math.max(0, Math.min(SAMPLES - 1, Math.floor((ms - startOf(idx)) / SAMPLE_MS)));

  /* ---------------- timeframes ---------------- */

  /* A bar on a timeframe is `k` base candles, and its index is floor(base / k),
     which is clock-aligned because the base index is. A bar is returned only as
     far as it has happened: the last one is the forming bar. */
  function bar(tfId, barIdx) {
    const k = tfOf(tfId).k;
    if (k === 1) return bar5(barIdx);
    const first = barIdx * k;
    let out = null;
    for (let i = 0; i < k; i++) {
      const c = bar5(first + i);
      if (!c) break;
      if (!out) {
        out = Object.assign({}, c, { idx: barIdx, t: startOf(first), tf: tfId });
      } else {
        out.close = c.close; out.closeNet = c.closeNet;
        if (c.high > out.high) out.high = c.high;
        if (c.low < out.low) out.low = c.low;
        out.bullWins += c.bullWins; out.bearWins += c.bearWins; out.draws += c.draws;
        out.bullPts += c.bullPts; out.bearPts += c.bearPts; out.matches += c.matches;
        out.forming = c.forming;
      }
    }
    if (out) out.up = out.bullWins > out.bearWins ? 1 : out.bullWins < out.bearWins ? -1 : 0;
    return out;
  }

  const liveBar = (tfId) => Math.floor(liveIdx() / tfOf(tfId).k);
  const firstBar = (tfId) => Math.ceil(firstIdx() / tfOf(tfId).k);
  const barStart = (tfId, barIdx) => startOf(barIdx * tfOf(tfId).k);
  const barEnd = (tfId, barIdx) => barStart(tfId, barIdx) + tfOf(tfId).min * 60000;

  /* every bar from `from` to the newest, as far as they are loaded */
  function bars(tfId, from, count) {
    const out = [];
    const last = liveBar(tfId);
    for (let i = from; i < from + count && i <= last; i++) {
      const b = bar(tfId, i);
      if (b) out.push(b);
    }
    return out;
  }

  function needBars(tfId, from, count) {
    const k = tfOf(tfId).k;
    return need(from * k, (from + count) * k - 1);
  }

  /* ---------------- the live source, for later ---------------- */

  /* Deliberately a stub that says what it is rather than a half-finished
     client. When there is a Realtime Database to read, this is the only thing
     that has to be written, and the chart above it does not change. */
  const LIVE = {
    name: "live",
    ready() {
      return Promise.reject(new Error(
        "AewayMarket: the live source is not built yet. " +
        "Set config.source to \"recording\", or write the feed here."));
    },
  };

  const RECORDING = {
    name: "recording",
    ready() {
      return fetch(`${config.dir}manifest.json`, { cache: "no-cache" })
        .then((r) => { if (!r.ok) throw new Error(`manifest: ${r.status}`); return r.json(); })
        .then((m) => {
          man = m;
          CANDLE_MS = m.candleMs; SAMPLE_MS = m.sampleMs; SAMPLES = m.samples;
          PER_DAY = m.candlesPerDay; TOTAL = m.totalCandles;
          /* the file is on gh-pages and the app is in a browser: if these do not
             line up, every price on the chart is wrong by a factor, so it is
             worth one check at startup */
          if (!(m.epsilon > 0) || !(m.startPrice > 0) || !TOTAL) {
            throw new Error("the ÆWAY manifest is missing its price settings");
          }
          /* warm the day that is on screen before anything tries to draw it */
          return need(liveIdx() - 2 * PER_DAY, liveIdx()).then(() => m);
        });
    },
  };

  const SOURCES = { recording: RECORDING, live: LIVE };

  let readyP = null;
  function ready() {
    if (!readyP) {
      const src = SOURCES[config.source];
      readyP = src ? src.ready() : Promise.reject(new Error(`AewayMarket: no source "${config.source}"`));
      readyP = readyP.catch((e) => { readyP = null; throw e; });
    }
    return readyP;
  }

  window.AewayMarket = {
    config, TFS, tfOf,
    ready, loaded: () => !!man, manifest: () => man, version: () => version,
    source: () => config.source,
    simulated: () => config.source === "recording",
    nowMs, idxAt, startOf,
    liveIdx, firstIdx, place, priceOf, samplesDone,
    need, needBars, bar5, bar, bars,
    liveBar, firstBar, barStart, barEnd,
    runningAt, entrySample,
    get CANDLE_MS() { return CANDLE_MS; },
    get SAMPLE_MS() { return SAMPLE_MS; },
    get SAMPLES() { return SAMPLES; },
  };
})();
