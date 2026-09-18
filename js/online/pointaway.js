/**
 * pointaway.js — Pointæway 1v1 room logic on Firestore.
 *
 * Anti-cheat: commit-reveal. Each round both players submit a SHA-256 hash
 * of their move first; once both hashes are in, moves are revealed and the
 * round resolves. Nobody can copy or front-run the opponent's card.
 *
 * A move (card): { side: 'bull' | 'bear', power: 1..5 }
 * Each resolved round "prints" one candle from the two cards played.
 */
import {
  doc, updateDoc, onSnapshot, getDoc, getDocs, serverTimestamp, arrayUnion, increment,
  collection, query, where, limit,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db } from './aeway-backend.js';

/** Live-subscribe to a room. cb(room) on every change. Returns unsubscribe. */
export function watchRoom(roomId, cb) {
  return onSnapshot(doc(db, 'rooms', roomId), (snap) => {
    if (snap.exists()) cb({ id: snap.id, ...snap.data() });
  });
}

export async function getRoom(roomId) {
  const snap = await getDoc(doc(db, 'rooms', roomId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const randHex = (n = 16) =>
  [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, '0')).join('');

/**
 * Step 1 — lock in a move secretly.
 * Returns { card, nonce, round } — keep it; you need it to reveal.
 */
export async function commitMove(roomId, uid, card) {
  const room = await getRoom(roomId);
  if (!room || room.status !== 'active') throw new Error('Room is not active.');
  if (room.commits?.[uid]?.round === room.round) return { card, nonce: null, round: room.round, already: true };
  const nonce = randHex();
  const hash = await sha256(JSON.stringify({ round: room.round, card, nonce }));
  await updateDoc(doc(db, 'rooms', roomId), {
    [`commits.${uid}`]: { hash, round: room.round },
    updatedAt: serverTimestamp(),
  });
  return { card, nonce, round: room.round };
}

/**
 * Step 2 — reveal the move. Call once the opponent's commit is visible
 * (watchRoom shows room.commits has both players for the current round).
 */
export async function revealMove(roomId, uid, card, nonce, round) {
  await updateDoc(doc(db, 'rooms', roomId), {
    [`reveals.${uid}`]: { card, nonce, round },
    updatedAt: serverTimestamp(),
  });
  await tryResolveRound(roomId);
}

/**
 * Step 3 — resolve the round once both reveals are in. Safe for both
 * players to call: the transaction-like guard (round check + verified
 * hashes) means only the first call takes effect.
 */
export async function tryResolveRound(roomId) {
  const room = await getRoom(roomId);
  if (!room || room.status !== 'active') return null;
  const [p1, p2] = room.players;
  const r1 = room.reveals?.[p1];
  const r2 = room.reveals?.[p2];
  if (!r1 || !r2 || r1.round !== room.round || r2.round !== room.round) return null;

  // Verify commits match reveals (anti-cheat).
  for (const [uid, rev] of [[p1, r1], [p2, r2]]) {
    const c = room.commits?.[uid];
    if (!c) return null;
    const expect = await sha256(JSON.stringify({ round: rev.round, card: rev.card, nonce: rev.nonce }));
    if (expect !== c.hash) throw new Error('Move verification failed — possible tampering.');
  }

  const candle = printCandle(room, r1.card, r2.card, p1, p2);
  const updates = {
    candles: arrayUnion(candle),
    commits: {},
    reveals: {},
    round: room.round + 1,
    updatedAt: serverTimestamp(),
  };
  if (candle.winnerUid) updates[`scores.${candle.winnerUid}`] = increment(1);

  // First to 5 round-wins takes the match (tunable).
  const scores = { ...room.scores };
  if (candle.winnerUid) scores[candle.winnerUid] = (scores[candle.winnerUid] || 0) + 1;
  const champ = [p1, p2].find((u) => (scores[u] || 0) >= 5);
  if (champ) {
    updates.status = 'finished';
    updates.winner = champ;
  }
  await updateDoc(doc(db, 'rooms', roomId), updates);
  return candle;
}

/**
 * Turn the two cards of a round into a persistent, explainable candle.
 * Bull power pushes price up, bear power pushes it down.
 */
function printCandle(room, card1, card2, uid1, uid2) {
  const prev = room.candles?.length ? room.candles[room.candles.length - 1].close : 100;
  const bull = [ [card1, uid1], [card2, uid2] ]
    .filter(([c]) => c.side === 'bull').reduce((s, [c]) => s + c.power, 0);
  const bear = [ [card1, uid1], [card2, uid2] ]
    .filter(([c]) => c.side === 'bear').reduce((s, [c]) => s + c.power, 0);
  const net = bull - bear;
  const open = prev;
  const close = prev + net * 2;
  const wick = Math.max(1, Math.abs(net));
  const high = Math.max(open, close) + wick * 0.5;
  const low = Math.min(open, close) - wick * 0.5;
  let winnerUid = null;
  if (bull > bear) winnerUid = [ [card1, uid1], [card2, uid2] ].find(([c]) => c.side === 'bull')[1];
  else if (bear > bull) winnerUid = [ [card1, uid1], [card2, uid2] ].find(([c]) => c.side === 'bear')[1];
  return {
    round: room.round, open, high, low, close,
    bullPower: bull, bearPower: bear,
    cards: { [uid1]: card1, [uid2]: card2 },
    winnerUid, // null = draw
  };
}

/**
 * Convenience: play a full round — commit, wait for the opponent's commit,
 * reveal, wait for resolution. Resolves with the printed candle.
 */
export function playRound(roomId, uid, card, { timeoutMs = 60000 } = {}) {
  return (async () => {
    const { card: c, nonce, round, already } = await commitMove(roomId, uid, card);
    if (already) throw new Error('Already committed this round.');
    const candle = await new Promise((resolve, reject) => {
      const t0 = Date.now();
      const unsub = watchRoom(roomId, async (room) => {
        try {
          if (Date.now() - t0 > timeoutMs) { unsub(); reject(new Error('Round timed out.')); return; }
          const [p1, p2] = room.players;
          const opp = p1 === uid ? p2 : p1;
          // Once both committed, reveal ours.
          if (room.commits?.[uid]?.round === round && room.commits?.[opp]?.round === round
              && !room.reveals?.[uid]) {
            await revealMove(roomId, uid, c, nonce, round);
          }
          // Once the candle for our round is printed, we're done.
          const done = room.candles?.find((k) => k.round === round);
          if (done || room.round > round || room.status === 'finished') {
            unsub();
            resolve(done || room.candles?.[room.candles.length - 1] || null);
          }
        } catch (e) { unsub(); reject(e); }
      });
    });
    return candle;
  })();
}

/** Leave / forfeit a room. The remaining player wins by default. */
export async function forfeitRoom(roomId, uid) {
  const room = await getRoom(roomId);
  if (!room || room.status !== 'active') return;
  const winner = room.players.find((p) => p !== uid);
  await updateDoc(doc(db, 'rooms', roomId), {
    status: 'finished', winner, updatedAt: serverTimestamp(),
  });
}

/**
 * Past matches for a player, newest first. Rooms are never deleted, so
 * history follows the account across every device. Each entry has the full
 * room: candles, scores, winner, playerInfo.
 */
export async function getMatchHistory(uid, maxN = 25) {
  const snap = await getDocs(query(
    collection(db, 'rooms'),
    where('players', 'array-contains', uid),
    limit(maxN),
  ));
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
}
