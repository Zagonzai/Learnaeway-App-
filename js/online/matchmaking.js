/**
 * matchmaking.js — real-time 1v1 matchmaking on Firestore.
 *
 * Flow:
 *   1. joinQueue(uid, {displayName, photoURL, game})
 *   2. watchQueue(uid, cb) — fires with {status:'matched', roomId} when found
 *   3. Meanwhile, call findAndClaimOpponent(game, me) on an interval —
 *      first player to win the transaction creates the room.
 *   4. leaveQueue(uid) when done / on cancel.
 *
 * Requires no composite index: the lobby query uses a single equality
 * filter (status) and filters by game client-side — plenty fast at
 * founding-launch scale. Add a composite index later if the lobby grows.
 */
import {
  doc, setDoc, deleteDoc, onSnapshot, serverTimestamp,
  collection, query, where, limit, runTransaction,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db } from './aeway-backend.js';

const GAMES = { POINTAWAY: 'pointaway', PICKAWAY: 'pickaway' };

export async function joinQueue(uid, { displayName, photoURL, game = GAMES.POINTAWAY }) {
  await setDoc(doc(db, 'matchmaking', uid), {
    uid,
    displayName: displayName || 'Trader',
    photoURL: photoURL || '',
    game,
    status: 'waiting',
    roomId: null,
    enqueuedAt: serverTimestamp(),
    matchedAt: null,
  });
}

export async function leaveQueue(uid) {
  try {
    await deleteDoc(doc(db, 'matchmaking', uid));
  } catch { /* already gone */ }
}

/** Calls cb(roomId) the moment this player is matched. Returns unsubscribe. */
export function watchQueue(uid, cb) {
  return onSnapshot(doc(db, 'matchmaking', uid), (snap) => {
    const d = snap.data();
    if (d && d.status === 'matched' && d.roomId) cb(d.roomId);
  });
}

/**
 * Try to claim a waiting opponent. Safe to call repeatedly / by both
 * players — the Firestore transaction guarantees only one room is made.
 * Returns the roomId if we created the match, else null.
 */
export async function findAndClaimOpponent(game, me /* {uid, displayName, photoURL} */) {
  const myRef = doc(db, 'matchmaking', me.uid);
  // Single-field query (no composite index needed); filter by game in code.
  const q = query(
    collection(db, 'matchmaking'),
    where('status', '==', 'waiting'),
    limit(25),
  );

  return runTransaction(db, async (tx) => {
    const mySnap = await tx.get(myRef);
    if (!mySnap.exists() || mySnap.data().status !== 'waiting') return null;

    const cands = await tx.get(q);
    const opp = cands.docs
      .map((d) => d.data())
      .filter((d) => d.game === game)
      .sort((a, b) => (a.enqueuedAt?.seconds || 0) - (b.enqueuedAt?.seconds || 0))
      .find((d) => d.uid !== me.uid && d.status === 'waiting');
    if (!opp) return null;

    const oppRef = doc(db, 'matchmaking', opp.uid);
    const oppSnap = await tx.get(oppRef);
    if (!oppSnap.exists() || oppSnap.data().status !== 'waiting') return null;

    const roomRef = doc(collection(db, 'rooms'));
    const now = serverTimestamp();
    tx.set(roomRef, {
      game,
      players: [me.uid, opp.uid],
      playerInfo: {
        [me.uid]: { displayName: me.displayName, photoURL: me.photoURL || '' },
        [opp.uid]: { displayName: opp.displayName, photoURL: opp.photoURL || '' },
      },
      status: 'active',
      round: 1,
      commits: {},
      reveals: {},
      candles: [],
      scores: { [me.uid]: 0, [opp.uid]: 0 },
      winner: null,
      createdAt: now,
      updatedAt: now,
    });

    const matched = { status: 'matched', roomId: roomRef.id, matchedAt: now };
    tx.update(myRef, matched);
    tx.update(oppRef, matched);
    return roomRef.id;
  });
}

/**
 * Convenience: join the queue and poll for an opponent every 2s until
 * matched. Resolves with roomId. Call cancel() to stop.
 */
export function quickMatch(me, { game = GAMES.POINTAWAY, pollMs = 2000 } = {}) {
  let stopped = false;
  let unsub = null;
  const done = (roomId) => {
    stopped = true;
    if (unsub) unsub();
    leaveQueue(me.uid);
  };
  const promise = (async () => {
    await joinQueue(me.uid, { ...me, game });
    return new Promise((resolve) => {
      unsub = watchQueue(me.uid, (roomId) => { done(); resolve(roomId); });
      const tick = async () => {
        if (stopped) return;
        try {
          const roomId = await findAndClaimOpponent(game, me);
          if (roomId) { done(); resolve(roomId); return; }
        } catch { /* transaction contention — retry */ }
        setTimeout(tick, pollMs);
      };
      tick();
    });
  })();
  return { promise, cancel: async () => { done(); await leaveQueue(me.uid); } };
}

export { GAMES };
