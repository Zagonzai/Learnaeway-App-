/* ==================== the ÆWAY recording's file format ====================
 *
 * One file, one day, 288 five-minute candles. This is the only place that knows
 * how to write one or read one, and it is loaded by both the offline recorder
 * and the phone — the same reason js/pw-rules.js is one file and not two.
 *
 * ---- everything is an integer ----
 *
 * A candle's prices are not stored. Price is startPrice × e^(ε × net wins), so
 * the whole price series is one integer per point in time, and that integer is
 * exact where a rounded float would drift. The browser recomputes the prices
 * from the same formula the recorder used, and the numbers agree to the last
 * bit because neither of them stored a price.
 *
 * ---- the layout ----
 *
 * Columnar across the whole day rather than one candle at a time, because a
 * column of 288 similar numbers packs into small varints and then compresses
 * far better than 288 interleaved rows of mixed magnitudes.
 *
 *   "AEW1"                       4 bytes of magic
 *   varint   day                 which day of the recording this is
 *   varint   startIndex          the absolute five-minute bucket of candle 0
 *   varint   n                   how many candles follow
 *   zigzag   firstOpenNet        cumulative net wins at the first candle's open
 *   varint × n   bullWins
 *   varint × n   bearWins
 *   varint × n   draws
 *   varint × n   bullPts
 *   varint × n   bearPts
 *   varint × n   hiUp            highest net wins in the candle, above its open
 *   varint × n   loDown          lowest net wins in the candle, below its open
 *   zigzag × n×S pathNet         per candle: the step in net wins each sample
 *   varint × n×S pathBull        per candle: the Bull points added each sample
 *   varint × n×S pathBear        per candle: the Bear points added each sample
 *
 * S is the number of samples in a candle — 30, one every ten seconds. Each
 * sample is the state at the END of its ten seconds, so the last sample of a
 * candle IS its close and the next candle's open is this one's close. Nothing
 * overlaps and nothing is missing.
 *
 * A candle's open is the previous candle's close, so only the first open is
 * stored and the rest chain: open[i+1] = open[i] + bullWins[i] − bearWins[i].
 * That identity is also the file's integrity check — decode asserts that the
 * path's own totals come out to the stored win and point counts, so a file that
 * was truncated, mangled or descrambled with the wrong key fails loudly instead
 * of drawing a plausible wrong chart.
 *
 * ---- the scrambling ----
 *
 * The bytes are XORed with a keystream and base64'd. This is obfuscation and
 * nothing more: the key is in the source, and anybody who reads this comment
 * can decode a file and see what the price does for the rest of the day. It is
 * there so that a tester with the network tab open sees noise rather than a
 * spoiler, and it is accepted for a beta where points are play points.
 *
 * ==> It is also the reason predictions must move to a live server before Æway
 * points are ever worth anything. A client that holds the future cannot be
 * trusted to settle a bet on it, however well the bytes are shuffled.
 */
(function () {
  "use strict";

  const MAGIC = [65, 69, 87, 49];      // "AEW1"

  /* ---- varints ----
     Seven bits of payload per byte, low group first, high bit set while more
     follow. The standard scheme, and the reason the columns above are cheap:
     a number under 128 costs one byte and one under 16,384 costs two. */
  function putVar(out, n) {
    if (!Number.isInteger(n) || n < 0) throw new Error(`varint: ${n}`);
    while (n > 127) { out.push((n & 127) | 128); n = Math.floor(n / 128); }
    out.push(n);
  }
  /* Signed, by folding the sign into the low bit, so −1 costs one byte rather
     than ten. */
  const zig = (n) => (n < 0 ? -2 * n - 1 : 2 * n);
  const unzig = (n) => (n & 1 ? -(n + 1) / 2 : n / 2);
  const putSig = (out, n) => putVar(out, zig(n));

  function Reader(bytes) {
    this.b = bytes; this.i = 0;
  }
  Reader.prototype.varint = function () {
    let n = 0, shift = 1;
    for (;;) {
      if (this.i >= this.b.length) throw new Error("varint ran off the end of the file");
      const c = this.b[this.i++];
      n += (c & 127) * shift;
      if (!(c & 128)) return n;
      shift *= 128;
      if (shift > 72057594037927936) throw new Error("varint too long");
    }
  };
  Reader.prototype.sig = function () { return unzig(this.varint()); };

  /* ---- the keystream ----
     xorshift32 off a hash of the key and the day, so every day's file is
     shuffled differently and a file descrambled against the wrong day fails the
     integrity check rather than half-working. */
  function hash32(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }
  function scramble(bytes, key, day) {
    let s = (hash32(`${key}:${day}`) || 1) >>> 0;
    const out = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) {
      s ^= s << 13; s >>>= 0;
      s ^= s >>> 17;
      s ^= s << 5;  s >>>= 0;
      out[i] = bytes[i] ^ (s & 255);
    }
    return out;
  }

  /* ---- base64, without needing btoa or Buffer ----
     The recorder runs in Node and the decoder in a browser, and this file is
     the same file in both, so it carries its own. */
  const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const B64I = (() => { const m = new Int16Array(128).fill(-1);
    for (let i = 0; i < 64; i++) m[B64.charCodeAt(i)] = i; return m; })();

  function toB64(bytes) {
    let s = "";
    for (let i = 0; i < bytes.length; i += 3) {
      const a = bytes[i], b = bytes[i + 1], c = bytes[i + 2];
      s += B64[a >> 2];
      s += B64[((a & 3) << 4) | (b === undefined ? 0 : b >> 4)];
      s += b === undefined ? "=" : B64[((b & 15) << 2) | (c === undefined ? 0 : c >> 6)];
      s += c === undefined ? "=" : B64[c & 63];
    }
    return s;
  }
  function fromB64(str) {
    const s = str.replace(/[^A-Za-z0-9+/]/g, "");
    const n = Math.floor(s.length * 3 / 4);
    const out = new Uint8Array(n);
    let o = 0, acc = 0, bits = 0;
    for (let i = 0; i < s.length; i++) {
      const v = B64I[s.charCodeAt(i)];
      if (v < 0) continue;
      acc = (acc << 6) | v; bits += 6;
      if (bits >= 8) { bits -= 8; out[o++] = (acc >> bits) & 255; }
    }
    return o === n ? out : out.subarray(0, o);
  }

  /* ---- writing a day ----
     `candles` are the objects market.js emits, in order, all from one day. */
  function encodeDay(opts) {
    const { day, candles, samples, key } = opts;
    const n = candles.length;
    const out = [];
    MAGIC.forEach((c) => out.push(c));
    putVar(out, day);
    putVar(out, candles[0].index);
    putVar(out, n);
    putSig(out, candles[0].openNet);

    const col = (fn) => { for (let i = 0; i < n; i++) putVar(out, fn(candles[i])); };
    col((c) => c.bullWins);
    col((c) => c.bearWins);
    col((c) => c.draws);
    col((c) => c.bullPts);
    col((c) => c.bearPts);
    col((c) => c.hiNet - c.openNet);
    col((c) => c.openNet - c.loNet);

    /* The three paths, as steps rather than running totals: a step is a small
       number where a total is a large one, and there are 8,640 of each a day. */
    for (let i = 0; i < n; i++) {
      let prev = 0;
      const p = candles[i].path;
      for (let s = 0; s < samples; s++) { putSig(out, p[s].dn - prev); prev = p[s].dn; }
    }
    for (let i = 0; i < n; i++) {
      let prev = 0;
      const p = candles[i].path;
      for (let s = 0; s < samples; s++) { putVar(out, p[s].bp - prev); prev = p[s].bp; }
    }
    for (let i = 0; i < n; i++) {
      let prev = 0;
      const p = candles[i].path;
      for (let s = 0; s < samples; s++) { putVar(out, p[s].bq - prev); prev = p[s].bq; }
    }

    const bytes = new Uint8Array(out);
    return { bytes, text: toB64(scramble(bytes, key, day)) };
  }

  /* ---- reading a day ----
     Returns candles with their integers restored and their prices left to the
     caller, which computes them with the same ε the recorder used. */
  function decodeDay(text, opts) {
    const { day, samples, key } = opts;
    const bytes = scramble(fromB64(text), key, day);
    for (let i = 0; i < 4; i++) {
      if (bytes[i] !== MAGIC[i]) throw new Error("not an ÆWAY day file, or the wrong key");
    }
    const r = new Reader(bytes);
    r.i = 4;
    const fileDay = r.varint();
    if (fileDay !== day) throw new Error(`day ${fileDay} in a file asked for as day ${day}`);
    const startIndex = r.varint();
    const n = r.varint();
    const firstOpenNet = r.sig();

    const read = () => { const a = new Int32Array(n); for (let i = 0; i < n; i++) a[i] = r.varint(); return a; };
    const bullWins = read(), bearWins = read(), draws = read();
    const bullPts = read(), bearPts = read();
    const hiUp = read(), loDown = read();

    const total = n * samples;
    const pathNet = new Int32Array(total);
    const pathBull = new Int32Array(total);
    const pathBear = new Int32Array(total);
    for (let i = 0; i < n; i++) {
      let prev = 0;
      for (let s = 0; s < samples; s++) { prev += r.sig(); pathNet[i * samples + s] = prev; }
    }
    for (let i = 0; i < n; i++) {
      let prev = 0;
      for (let s = 0; s < samples; s++) { prev += r.varint(); pathBull[i * samples + s] = prev; }
    }
    for (let i = 0; i < n; i++) {
      let prev = 0;
      for (let s = 0; s < samples; s++) { prev += r.varint(); pathBear[i * samples + s] = prev; }
    }

    /* The integrity check, and it is cheap enough to always run. The path was
       written independently of the totals, so if the two agree on all 288
       candles the file is the file. If they do not, something is wrong with the
       bytes and the right thing is to refuse rather than draw it. */
    const opens = new Int32Array(n);
    let open = firstOpenNet;
    for (let i = 0; i < n; i++) {
      opens[i] = open;
      const last = i * samples + samples - 1;
      if (pathNet[last] !== bullWins[i] - bearWins[i] ||
          pathBull[last] !== bullPts[i] || pathBear[last] !== bearPts[i]) {
        throw new Error(`day ${day} candle ${i}: the path and the totals disagree`);
      }
      open += bullWins[i] - bearWins[i];
    }

    const candles = new Array(n);
    for (let i = 0; i < n; i++) {
      candles[i] = {
        index: startIndex + i,
        openNet: opens[i],
        closeNet: opens[i] + bullWins[i] - bearWins[i],
        hiNet: opens[i] + hiUp[i],
        loNet: opens[i] - loDown[i],
        bullWins: bullWins[i], bearWins: bearWins[i], draws: draws[i],
        bullPts: bullPts[i], bearPts: bearPts[i],
        matches: bullWins[i] + bearWins[i] + draws[i],
        /* the three sample arrays, as views rather than copies: 8,640 numbers a
           day each, and the chart reads them by index */
        from: i * samples,
      };
    }
    return { day, startIndex, n, samples, candles, pathNet, pathBull, pathBear,
             endNet: opens[n - 1] + bullWins[n - 1] - bearWins[n - 1] };
  }

  const AewayCodec = { encodeDay, decodeDay, toB64, fromB64, hash32, MAGIC };
  if (typeof globalThis !== "undefined") globalThis.AewayCodec = AewayCodec;
  if (typeof module !== "undefined" && module.exports) module.exports = AewayCodec;
})();
