/* ==================== the ÆWAY chart, drawn ====================
 *
 * A canvas painter and the geometry behind it. It owns no state, takes no
 * events and knows nothing about the app: it is handed a canvas and a view —
 * which timeframe, which bars, where the crosshair is — and it paints that.
 * The screen, the gestures and the state live in app.js, where the rest of the
 * app's screens and gestures live.
 *
 * ---- why a canvas, when every other chart in this app is DOM ----
 *
 * The match replay and the performance chart are divs, and they should be: a
 * few dozen candles, repainted when something is tapped. This one holds up to
 * two hundred candles with a volume bar under each, redraws on every frame of a
 * pan and a pinch, and has to do it on a phone. Two hundred divs re-laid out
 * sixty times a second is not that; one canvas is.
 *
 * ---- the look ----
 *
 * The reference is a TradingView index chart: price scale on the right, time
 * along the bottom, a dotted line at the last price with a tag on the axis,
 * dashed verticals at each new day, volume along the bottom of the plot. The
 * one thing that is ours rather than theirs is the volume: each bar is split
 * into the points Bull winners brought in and the points Bear winners did, so
 * the bar says who was trading and the candle says who won.
 *
 * Which is also why a green candle can carry more Bear volume than Bull. The
 * brief says not to "fix" that, and nothing here tries to: colour comes from
 * the win counts and the bar comes from the points, and they are two different
 * facts about the same five minutes.
 */
(function () {
  "use strict";

  const C = {
    bull: "#1FCBA0", bear: "#E5484D", flat: "#8FA9C4",
    bullDim: "rgba(31,203,160,.34)", bearDim: "rgba(229,72,77,.34)",
    grid: "rgba(143,169,196,.13)",
    day: "rgba(143,169,196,.30)",
    axis: "#7E9CBB",
    cyan: "#3DDFFF",
    cross: "rgba(242,251,255,.72)",
    ink: "#F2FBFF",
    panel: "rgba(5,9,22,.92)",
  };

  /* room for the axes. The right gutter has to hold a five-figure price with
     two decimals, which is the widest thing on the chart. */
  const PAD = { l: 1, r: 54, t: 4, b: 15 };
  /* A tenth of the plot, and no more. The bars are all but the same height in
   this market — ten thousand bots finish four thousand matches every candle,
   whatever the price is doing — so volume here is a texture under the price
   rather than a second chart. That flatness is real and is left alone: it is
   what a market with a constant number of players looks like, and it is the
   thing that will start varying the day actual people are playing. */
  const VOL_SHARE = 0.17;
  const MIN_BODY = 1;            // a candle is never thinner than this

  /* ---- the geometry ----
     Everything that converts between a bar, a price and a pixel. The gesture
     handler and the painter both read it, so there is one of it. */
  function geom(canvas, view) {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    /* the readout floats over the top of the plot, and the screen measures it
       and passes its height down so that no candle is ever drawn behind it */
    const top = PAD.t + Math.max(0, view.padTop || 0);
    const plot = {
      x: PAD.l, y: top,
      w: Math.max(10, w - PAD.l - PAD.r),
      h: Math.max(20, h - top - PAD.b),
    };
    const volH = Math.round(plot.h * VOL_SHARE);
    const price = { x: plot.x, y: plot.y, w: plot.w, h: plot.h - volH - 4 };
    const vol = { x: plot.x, y: plot.y + price.h + 4, w: plot.w, h: volH };

    const bars = view.bars || [];
    const span = Math.max(1, view.span);
    const slot = plot.w / span;
    const bodyW = Math.max(MIN_BODY, Math.min(14, Math.floor(slot * 0.68)));

    let lo = Infinity, hi = -Infinity, maxVol = 0;
    for (const b of bars) {
      if (b.low < lo) lo = b.low;
      if (b.high > hi) hi = b.high;
      const v = b.bullPts + b.bearPts;
      if (v > maxVol) maxVol = v;
    }
    if (!(hi > lo)) { const m = Number.isFinite(hi) ? hi : 10000; lo = m * 0.999; hi = m * 1.001; }
    const pad = (hi - lo) * 0.08;
    lo -= pad; hi += pad;

    /* a bar's index -> the centre of its slot */
    const xOf = (i) => plot.x + (i - view.from + 0.5) * slot;
    const barAt = (x) => view.from + Math.floor((x - plot.x) / slot);
    const yOf = (p) => price.y + price.h - ((p - lo) / (hi - lo)) * price.h;
    const priceAt = (y) => lo + ((price.y + price.h - y) / price.h) * (hi - lo);
    const volOf = (v) => (maxVol > 0 ? (v / maxVol) * vol.h : 0);

    return { w, h, plot, price, vol, slot, bodyW, lo, hi, maxVol, xOf, barAt, yOf, priceAt, volOf };
  }

  /* ---- "nice" price levels ----
     Four or five round numbers inside the visible range, chosen from the 1-2-5
     ladder so the labels read as prices rather than as whatever the pixels
     happened to divide into. */
  function levels(lo, hi, want) {
    const raw = (hi - lo) / Math.max(2, want);
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || 10 * mag;
    const out = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) out.push(v);
    return { out, step };
  }

  const fmtPrice = (p) => p.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fmtPriceShort = (p) =>
    (Math.abs(p) >= 1000 ? Math.round(p).toLocaleString("en-US") : p.toFixed(2));
  const fmtVol = (v) =>
    v >= 1e6 ? (v / 1e6).toFixed(1) + "M" : v >= 1000 ? (v / 1000).toFixed(0) + "k" : String(v);

  /* ---- one clock, and it is the market's ----
     The ÆWAY day runs midnight to midnight Eastern, which is where the brief
     puts it and where the simulator's own day boundary already is. So the chart
     is drawn on that clock rather than on each device's: a day separator is the
     market's day turning over, not the viewer's, and two phones in two time
     zones show the same line in the same place. The readout says ET so nobody
     has to guess which it is. It is also how every futures chart behaves. */
  const TZ = "America/New_York";

  /* The formatters are built once and the day is cached, and both of those are
     the difference between a chart that pans and one that does not.
     `toLocaleDateString(…, { timeZone })` constructs a formatter on every call,
     and the day-separator loop asks which day a candle is in once per candle —
     sixty-four times a frame. Doing it the obvious way took the repaint from
     0.4ms to 7ms, which is most of a 60fps frame spent deciding what today is.

     The cache is a half-open window of milliseconds, so the common case is two
     numeric comparisons. Bars are walked in time order, so it misses once per
     day drawn and hits every other time. */
  const F_TIME = new Intl.DateTimeFormat("en-US",
    { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });
  const F_DAY = new Intl.DateTimeFormat("en-US",
    { timeZone: TZ, month: "short", day: "numeric" });
  const F_KEY = new Intl.DateTimeFormat("en-CA", { timeZone: TZ });

  const hhmm = (ms) => F_TIME.format(ms);
  const dayLabel = (ms) => F_DAY.format(ms);

  let kFrom = 0, kTo = -1, kVal = "";
  function dayKey(ms) {
    if (ms >= kFrom && ms < kTo) return kVal;
    kVal = F_KEY.format(ms);
    /* the window, found by walking out to the edges of this calendar day. A day
       is 24 hours except the two a year it is 23 or 25, so the ends are probed
       rather than assumed. */
    const noon = Math.floor(ms / 3600000) * 3600000;
    let lo = noon, hi = noon;
    while (lo > ms - 36 * 3600000 && F_KEY.format(lo - 3600000) === kVal) lo -= 3600000;
    while (hi < ms + 36 * 3600000 && F_KEY.format(hi + 3600000) === kVal) hi += 3600000;
    kFrom = lo; kTo = hi + 3600000;
    return kVal;
  }

  /* ---- the paint ---- */
  function paint(canvas, view) {
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return null;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const g = geom(canvas, view);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.textBaseline = "middle";

    const bars = view.bars || [];
    const scale = view.scale || 1;      // the admin's ×100 projection
    const fs = view.fontScale || 1;
    const F = (n) => `${(n * fs).toFixed(1)}px ui-sans-serif, -apple-system, system-ui, sans-serif`;

    /* ---- price gridlines and the right scale ---- */
    /* fewer gridlines on a short plot: five of them in a hundred pixels is a
       ladder rather than a scale */
    const lv = levels(g.lo, g.hi, Math.max(2, Math.min(5, Math.round(g.price.h / 38))));
    ctx.font = F(9);
    ctx.lineWidth = 1;
    for (const v of lv.out) {
      const y = Math.round(g.yOf(v)) + 0.5;
      if (y < g.price.y || y > g.price.y + g.price.h) continue;
      ctx.strokeStyle = C.grid;
      ctx.beginPath(); ctx.moveTo(g.plot.x, y); ctx.lineTo(g.plot.x + g.plot.w, y); ctx.stroke();
      ctx.fillStyle = C.axis;
      ctx.textAlign = "left";
      ctx.fillText(fmtPriceShort(v), g.plot.x + g.plot.w + 5, y);
    }

    /* ---- day separators, dashed, with the date under them ---- */
    ctx.save();
    ctx.setLineDash([3, 4]);
    let prevKey = bars.length ? dayKey(bars[0].t) : null;
    const dayTicks = [];
    for (let i = 1; i < bars.length; i++) {
      const k = dayKey(bars[i].t);
      if (k !== prevKey) {
        const x = Math.round(g.xOf(bars[i].idx) - g.slot / 2) + 0.5;
        if (x > g.plot.x + 2 && x < g.plot.x + g.plot.w - 2) {
          ctx.strokeStyle = C.day;
          ctx.beginPath(); ctx.moveTo(x, g.plot.y); ctx.lineTo(x, g.plot.y + g.plot.h); ctx.stroke();
          dayTicks.push({ x, t: bars[i].t });
        }
        prevKey = k;
      }
    }
    ctx.restore();

    /* ---- the volume band, split Bull over Bear ---- */
    for (const b of bars) {
      const x = g.xOf(b.idx);
      const bw = g.bodyW;
      const bullH = g.volOf(b.bullPts);
      const bearH = g.volOf(b.bearPts);
      const base = g.vol.y + g.vol.h;
      ctx.fillStyle = C.bearDim;
      ctx.fillRect(x - bw / 2, base - bearH, bw, bearH);
      ctx.fillStyle = C.bullDim;
      ctx.fillRect(x - bw / 2, base - bearH - bullH, bw, bullH);
    }
    /* the volume band's own ceiling label, so the bars have a magnitude */
    if (g.maxVol > 0) {
      ctx.font = F(8);
      ctx.fillStyle = C.axis;
      ctx.textAlign = "left";
      ctx.fillText(fmtVol(Math.round(g.maxVol * scale)), g.plot.x + g.plot.w + 5, g.vol.y + 5);
    }

    /* ---- the candles ---- */
    for (const b of bars) {
      const col = b.up > 0 ? C.bull : b.up < 0 ? C.bear : C.flat;
      const x = Math.round(g.xOf(b.idx)) + 0.5;
      const yH = g.yOf(b.high), yL = g.yOf(b.low);
      ctx.strokeStyle = col;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, yH); ctx.lineTo(x, yL); ctx.stroke();
      const yO = g.yOf(b.open), yC = g.yOf(b.close);
      const top = Math.min(yO, yC), bot = Math.max(yO, yC);
      const bw = g.bodyW;
      ctx.fillStyle = col;
      ctx.fillRect(Math.round(x - bw / 2), Math.round(top), bw, Math.max(1, Math.round(bot - top)));
    }

    /* ---- the time scale ----
       One label per day boundary, and otherwise whatever round times fit. */
    ctx.font = F(8.5);
    ctx.fillStyle = C.axis;
    ctx.textAlign = "center";
    const ty = g.plot.y + g.plot.h + 8;
    const placed = [];
    /* a label needs room from its neighbours AND from the edges: half of one
       hanging off the left of the plot reads as a glitch */
    const room = (x, wide) =>
      x - wide / 2 >= g.plot.x - 2 && x + wide / 2 <= g.plot.x + g.plot.w + 2 &&
      !placed.some((p) => Math.abs(p - x) < wide);
    for (const d of dayTicks) {
      if (!room(d.x, 46)) continue;
      ctx.fillStyle = C.ink;
      ctx.fillText(dayLabel(d.t), d.x, ty);
      placed.push(d.x);
    }
    ctx.fillStyle = C.axis;
    const everyN = Math.max(1, Math.round(44 / g.slot));
    for (let i = 0; i < bars.length; i += everyN) {
      const b = bars[i];
      const dt = new Date(b.t);
      if (dt.getMinutes() % 30 !== 0) continue;
      const x = g.xOf(b.idx);
      if (!room(x, 40)) continue;
      ctx.fillText(hhmm(b.t), x, ty);
      placed.push(x);
    }

    /* ---- the last price: a dotted line across and a tag on the axis ---- */
    const last = bars[bars.length - 1];
    if (last) {
      const y = Math.round(g.yOf(last.close)) + 0.5;
      const col = last.up > 0 ? C.bull : last.up < 0 ? C.bear : C.flat;
      ctx.save();
      ctx.setLineDash([2, 3]);
      ctx.strokeStyle = col;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(g.plot.x, y); ctx.lineTo(g.plot.x + g.plot.w, y); ctx.stroke();
      ctx.restore();
      tag(ctx, g.plot.x + g.plot.w + 2, y, fmtPrice(last.close), col, "#04121A", F(9.5), fs);
    }

    /* ---- the crosshair ---- */
    if (view.cross) {
      const b = view.cross.bar;
      const x = b ? Math.round(g.xOf(b.idx)) + 0.5 : null;
      const y = Math.round(view.cross.y) + 0.5;
      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = C.cross;
      ctx.lineWidth = 1;
      if (x !== null) { ctx.beginPath(); ctx.moveTo(x, g.plot.y); ctx.lineTo(x, g.plot.y + g.plot.h); ctx.stroke(); }
      if (y >= g.price.y && y <= g.price.y + g.price.h) {
        ctx.beginPath(); ctx.moveTo(g.plot.x, y); ctx.lineTo(g.plot.x + g.plot.w, y); ctx.stroke();
      }
      ctx.restore();
      if (y >= g.price.y && y <= g.price.y + g.price.h) {
        tag(ctx, g.plot.x + g.plot.w + 2, y, fmtPrice(g.priceAt(y)), C.ink, "#04121A", F(9.5), fs);
      }
      if (x !== null && b) {
        ctx.font = F(9);
        const label = hhmm(b.t);
        const tw = ctx.measureText(label).width + 10;
        const tx = Math.max(g.plot.x, Math.min(g.plot.x + g.plot.w - tw, x - tw / 2));
        ctx.fillStyle = C.ink;
        rrect(ctx, tx, g.plot.y + g.plot.h + 1, tw, 13 * fs, 3);
        ctx.fill();
        ctx.fillStyle = "#04121A";
        ctx.textAlign = "center";
        ctx.fillText(label, tx + tw / 2, g.plot.y + g.plot.h + 1 + 6.5 * fs);
      }
    }

    return g;
  }

  function rrect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function tag(ctx, x, y, text, bg, fg, font, fs) {
    ctx.font = font;
    const h = 14 * fs;
    const w = ctx.measureText(text).width + 8;
    ctx.fillStyle = bg;
    rrect(ctx, x, y - h / 2, w, h, 3);
    ctx.fill();
    ctx.fillStyle = fg;
    ctx.textAlign = "left";
    ctx.fillText(text, x + 4, y);
  }

  window.AewayChart = { paint, geom, levels, fmtPrice, fmtVol, hhmm, dayLabel, dayKey,
    TZ, PAD, VOL_SHARE, COLOURS: C };
})();
