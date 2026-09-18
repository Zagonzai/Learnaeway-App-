/**
 * invites.js — direct 1v1 match invites (challenge a specific player,
 * rather than random matchmaking). Sits alongside matchmaking.js — it
 * does not touch or replace quickMatch(); this is a second path to the
 * same room shape used by pointaway.js.
 *
 * Firestore: matchInvites/{inviteId}
 *   { fromUid, fromName, fromPhoto, toUid, toName, toPhoto, game,
 *     status: 'pending' | 'accepted' | 'declined' | 'cancelled',
 *     roomId, createdAt, updatedAt, expiresAt }
 *
 * Flow:
 *   1. lookupPlayer(input, myUid) with an invite code or exact display name.
 *   2. sendMatchInvite(me, target, {game}) creates the invite (expires in 5 min).
 *   3. Both sides watch it: watchInvite(inviteId, cb) for the sender,
 *      watchIncomingInvites(myUid, cb) for the recipient (expired ones hidden).
 *   4. Recipient calls acceptInvite(inviteId, me) or declineInvite(inviteId).
 *      Accepting creates the room (same shape quickMatch creates) and
 *      writes its id onto the invite so the sender's listener picks it up.
 *   5. Sender can cancelInvite(inviteId) while still pending.
 */
import {
  doc, setDoc, updateDoc, onSnapshot, getDocs, getDoc, serverTimestamp,
  collection, query, where, limit, runTransaction, Timestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db } from './aeway-backend.js';
import { getPlayerByInviteCode } from './profiles.js';

/** Invites expire after 5 minutes — stale ones vanish from the inbox. */
export const INVITE_TTL_MS = 5 * 60 * 1000;
const isFresh = (inv) => !inv.expiresAt || inv.expiresAt.toMillis() > Date.now();

/**
 * Intentional player lookup — no browsing, no prefix enumeration.
 * Accepts an invite code (e.g. "KQ7Z2M") or an EXACT display name
 * (case-insensitive). Returns [{uid, displayName, photoURL}] — usually one.
 * If several players share a name, the UI should show profile cards with
 * photos so the challenger picks the right one.
 */
export async function lookupPlayer(input, selfUid) {
  const text = (input || '').trim();
  if (!text) return [];
  if (/^[A-Z0-9]{6,10}$/i.test(text)) {
    const p = await getPlayerByInviteCode(text);
    return p && p.uid !== selfUid ? [p] : [];
  }
  const snap = await getDocs(query(
    collection(db, 'users'),
    where('displayNameLower', '==', text.toLowerCase()),
    limit(5),
  ));
  return snap.docs
    .map((d) => {
      const p = d.data();
      return { uid: d.id, displayName: p.displayName || 'Trader', photoURL: p.photoURL || '' };
    })
    .filter((p) => p.uid !== selfUid);
}

export async function sendMatchInvite(me /* {uid, displayName, photoURL} */, target /* {uid, displayName, photoURL} */, { game = 'pointaway' } = {}) {
  if (target.uid === me.uid) throw new Error("You can't invite yourself.");
  const ref = doc(collection(db, 'matchInvites'));
  await setDoc(ref, {
    fromUid: me.uid,
    fromName: me.displayName || 'Trader',
    fromPhoto: me.photoURL || '',
    toUid: target.uid,
    toName: target.displayName || 'Trader',
    toPhoto: target.photoURL || '',
    game,
    status: 'pending',
    roomId: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    expiresAt: Timestamp.fromMillis(Date.now() + INVITE_TTL_MS),
  });
  return ref.id;
}

/** Sender-side: watch one invite for a status change (accepted/declined/cancelled). */
export function watchInvite(inviteId, cb) {
  return onSnapshot(doc(db, 'matchInvites', inviteId), (snap) => {
    if (snap.exists()) cb({ id: snap.id, ...snap.data() });
  });
}

/** Recipient-side: watch all fresh pending invites sent to this player. */
export function watchIncomingInvites(uid, cb) {
  return onSnapshot(
    query(
      collection(db, 'matchInvites'),
      where('toUid', '==', uid),
      where('status', '==', 'pending'),
    ),
    (snap) => cb(snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter(isFresh)),
  );
}

/**
 * Recipient accepts: creates the room (same shape matchmaking.js creates
 * for quickMatch) and marks the invite accepted with the new roomId.
 * Returns the roomId.
 */
export async function acceptInvite(inviteId, me /* {uid, displayName, photoURL} */) {
  const inviteRef = doc(db, 'matchInvites', inviteId);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(inviteRef);
    if (!snap.exists() || snap.data().status !== 'pending') {
      throw new Error('This invite is no longer available.');
    }
    if (!isFresh(snap.data())) {
      throw new Error('This invite expired.');
    }
    const invite = snap.data();
    const roomRef = doc(collection(db, 'rooms'));
    const now = serverTimestamp();
    tx.set(roomRef, {
      game: invite.game,
      players: [invite.fromUid, invite.toUid],
      playerInfo: {
        [invite.fromUid]: { displayName: invite.fromName, photoURL: invite.fromPhoto || '' },
        [invite.toUid]: { displayName: me.displayName || invite.toName, photoURL: me.photoURL || invite.toPhoto || '' },
      },
      status: 'active',
      round: 1,
      commits: {},
      reveals: {},
      candles: [],
      scores: { [invite.fromUid]: 0, [invite.toUid]: 0 },
      winner: null,
      createdAt: now,
      updatedAt: now,
    });
    tx.update(inviteRef, { status: 'accepted', roomId: roomRef.id, updatedAt: now });
    return roomRef.id;
  });
}

export async function declineInvite(inviteId) {
  await updateDoc(doc(db, 'matchInvites', inviteId), { status: 'declined', updatedAt: serverTimestamp() });
}

/** Sender cancels a still-pending invite. */
export async function cancelInvite(inviteId) {
  const ref = doc(db, 'matchInvites', inviteId);
  const snap = await getDoc(ref);
  if (snap.exists() && snap.data().status === 'pending') {
    await updateDoc(ref, { status: 'cancelled', updatedAt: serverTimestamp() });
  }
}
