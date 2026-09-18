/**
 * messages.js — minimal 1:1 text messaging, connections only.
 *
 * This is intentionally simple: text only, no media, no group threads.
 * Meant to be sent from a connection's row on the Connections page.
 *
 * ⚠️ This module does not itself check that two players are connected —
 * that MUST be enforced by a Firestore security rule (reject writes to a
 * conversation unless both uids in its id are members of a `connections`
 * doc for that pair). Write that rule alongside wiring this in; without
 * it, messaging isn't actually restricted to connections, just hidden by
 * the UI, which isn't real enforcement.
 *
 * Firestore:
 *   conversations/{conversationId}
 *     { members: [uidA, uidB], lastMessage, lastAt, updatedAt }
 *   conversations/{conversationId}/messages/{messageId}
 *     { senderUid, text, createdAt }
 *
 * conversationId is the two uids sorted and joined with "_", same
 * pattern as connections.js's pairId — so a pair only ever has one thread.
 */
import {
  doc, setDoc, addDoc, onSnapshot, serverTimestamp,
  collection, query, orderBy, limit, where,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db } from './aeway-backend.js';

const conversationId = (a, b) => [a, b].sort().join('_');

/** Send a text message. Creates the conversation doc on first use. */
export async function sendMessage(me /* {uid, displayName} */, otherUid, text) {
  const clean = (text || '').trim();
  if (!clean) return;
  const convoId = conversationId(me.uid, otherUid);
  const convoRef = doc(db, 'conversations', convoId);
  const now = serverTimestamp();
  await setDoc(convoRef, {
    members: [me.uid, otherUid],
    lastMessage: clean,
    lastAt: now,
    updatedAt: now,
  }, { merge: true });
  await addDoc(collection(convoRef, 'messages'), {
    senderUid: me.uid,
    text: clean,
    createdAt: now,
  });
}

/** Live-subscribe to a thread's messages, oldest first. */
export function watchMessages(myUid, otherUid, cb, maxN = 200) {
  const convoId = conversationId(myUid, otherUid);
  return onSnapshot(
    query(collection(db, 'conversations', convoId, 'messages'), orderBy('createdAt', 'asc'), limit(maxN)),
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
  );
}

/** All of this player's conversations, for a simple inbox list if wanted. */
export function watchMyConversations(uid, cb) {
  return onSnapshot(
    query(collection(db, 'conversations'), where('members', 'array-contains', uid), orderBy('updatedAt', 'desc')),
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
  );
}

export { conversationId };
