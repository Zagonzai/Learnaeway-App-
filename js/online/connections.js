/**
 * connections.js — mutual player connections (replaces the old
 * "connect code" feature entirely — see build prompt for what's removed).
 *
 * Finding someone to connect with reuses the same intentional lookup
 * already used for match challenges: exact display name or a player's
 * match invite code (from invites.js's lookupPlayer / profiles.js's
 * getPlayerByInviteCode). No directory, no browsing — same rule as
 * challenges, kept consistent.
 *
 * Firestore:
 *   connectionRequests/{id}
 *     { fromUid, fromName, fromPhoto, toUid, toName, toPhoto,
 *       status: 'pending' | 'approved' | 'denied' | 'cancelled',
 *       createdAt, updatedAt }
 *   connections/{id}   — one doc per mutual connection, id is the two
 *     uids sorted and joined with "_" so it's naturally unique per pair
 *     { members: [uidA, uidB], createdAt }
 */
import {
  doc, setDoc, updateDoc, deleteDoc, getDoc, getDocs, onSnapshot, serverTimestamp,
  collection, query, where, runTransaction,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db } from './aeway-backend.js';

const pairId = (a, b) => [a, b].sort().join('_');

export async function sendConnectionRequest(me /* {uid, displayName, photoURL} */, target /* {uid, displayName, photoURL} */) {
  if (target.uid === me.uid) throw new Error("You can't connect with yourself.");
  const already = await getDoc(doc(db, 'connections', pairId(me.uid, target.uid)));
  if (already.exists()) throw new Error('Already connected.');
  const ref = doc(collection(db, 'connectionRequests'));
  await setDoc(ref, {
    fromUid: me.uid,
    fromName: me.displayName || 'Trader',
    fromPhoto: me.photoURL || '',
    toUid: target.uid,
    toName: target.displayName || 'Trader',
    toPhoto: target.photoURL || '',
    status: 'pending',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

/** Requests sent TO this player, still pending. */
export function watchIncomingConnectionRequests(uid, cb) {
  return onSnapshot(
    query(collection(db, 'connectionRequests'), where('toUid', '==', uid), where('status', '==', 'pending')),
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
  );
}

/** Requests this player sent, still pending (so the UI can show "Requested"). */
export function watchOutgoingConnectionRequests(uid, cb) {
  return onSnapshot(
    query(collection(db, 'connectionRequests'), where('fromUid', '==', uid), where('status', '==', 'pending')),
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
  );
}

/**
 * Approve: marks the request approved and creates the mutual connection
 * in one transaction. Once approved, both players are connected — there
 * is no separate one-way "follow" state.
 */
export async function approveConnectionRequest(requestId) {
  const reqRef = doc(db, 'connectionRequests', requestId);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(reqRef);
    if (!snap.exists() || snap.data().status !== 'pending') {
      throw new Error('This request is no longer available.');
    }
    const req = snap.data();
    const connRef = doc(db, 'connections', pairId(req.fromUid, req.toUid));
    const now = serverTimestamp();
    tx.set(connRef, { members: [req.fromUid, req.toUid], createdAt: now });
    tx.update(reqRef, { status: 'approved', updatedAt: now });
  });
}

export async function denyConnectionRequest(requestId) {
  await updateDoc(doc(db, 'connectionRequests', requestId), { status: 'denied', updatedAt: serverTimestamp() });
}

export async function cancelConnectionRequest(requestId) {
  await updateDoc(doc(db, 'connectionRequests', requestId), { status: 'cancelled', updatedAt: serverTimestamp() });
}

/**
 * All of this player's mutual connections, with the other person's info.
 * (Firestore doesn't do "the other array item" server-side, so this reads
 * both members and resolves the other uid's profile client-side.)
 */
export async function getMyConnections(uid) {
  const snap = await getDocs(query(collection(db, 'connections'), where('members', 'array-contains', uid)));
  const out = [];
  for (const d of snap.docs) {
    const { members } = d.data();
    const otherUid = members.find((m) => m !== uid);
    const otherSnap = await getDoc(doc(db, 'users', otherUid));
    const other = otherSnap.exists() ? otherSnap.data() : {};
    out.push({
      connectionId: d.id,
      uid: otherUid,
      displayName: other.displayName || 'Trader',
      photoURL: other.photoURL || '',
    });
  }
  return out;
}

/** Live count for the profile page ("N Connections") without loading the full list. */
export function watchConnectionCount(uid, cb) {
  return onSnapshot(
    query(collection(db, 'connections'), where('members', 'array-contains', uid)),
    (snap) => cb(snap.size),
  );
}

/** Check the connection state between two players: 'none' | 'pending-sent' | 'pending-received' | 'connected'. */
export async function getConnectionState(myUid, otherUid) {
  const conn = await getDoc(doc(db, 'connections', pairId(myUid, otherUid)));
  if (conn.exists()) return 'connected';
  const sentSnap = await getDocs(query(
    collection(db, 'connectionRequests'),
    where('fromUid', '==', myUid), where('toUid', '==', otherUid), where('status', '==', 'pending'),
  ));
  if (!sentSnap.empty) return 'pending-sent';
  const receivedSnap = await getDocs(query(
    collection(db, 'connectionRequests'),
    where('fromUid', '==', otherUid), where('toUid', '==', myUid), where('status', '==', 'pending'),
  ));
  if (!receivedSnap.empty) return 'pending-received';
  return 'none';
}

export { pairId };
