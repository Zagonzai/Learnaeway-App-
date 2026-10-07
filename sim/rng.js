/* Seeded randomness, because every match has to be replayable.
 *
 * One xorshift32 — the same generator the Pointæway regression trace has used
 * since b97, so a seed means the same deal here as it does in the browser
 * harness. Thirty-two bits of state is more than enough for a card game and it
 * is small enough to write into a match record.
 *
 * Nothing here calls Date.now() or Math.random(). A match is a pure function of
 * its seed, and that is the whole point: an auditor hands back a seed and gets
 * the same match, card for card.
 */
"use strict";

/* A stream of floats in [0, 1). Seed 0 is not a state this generator can leave,
   so it is nudged to 1 — which costs one of 4.3 billion seeds. */
function rngFrom(seed) {
  let s = (seed >>> 0) || 1;
  return function () {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;  s >>>= 0;
    return s / 4294967296;
  };
}

/* FNV-1a, for turning a name into a seed. Used to derive one match's seed from
   the run's seed and the match's number, so a run of a million matches needs to
   store one number and a count rather than a million numbers — and any single
   match can still be rebuilt from the seed written on it. */
function hash32(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

const seedFor = (runSeed, n) => hash32(`${runSeed >>> 0}:${n}`);

/* an integer in [lo, hi], and a float in [lo, hi) */
const intIn = (rnd, lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
const numIn = (rnd, lo, hi) => lo + rnd() * (hi - lo);
const pick = (rnd, arr) => arr[Math.floor(rnd() * arr.length)];

module.exports = { rngFrom, hash32, seedFor, intIn, numIn, pick };
