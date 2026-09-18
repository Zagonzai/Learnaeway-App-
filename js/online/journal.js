/**
 * journal.js — trade journal with cloud sync across all user devices.
 *
 * Firestore:  journal/{uid}/entries/{entryId}
 *   { text, tradeImage (data URL thumbnail, optional), createdAt, updatedAt }
 *
 * Trade screenshots are downscaled in the browser before saving (no
 * Storage/Blaze billing needed). Entries are private to the owner.
 */
import {
  doc, collection, setDoc, getDocs, deleteDoc, updateDoc,
  serverTimestamp, query, limit,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db } from './aeway-backend.js';
import { downscaleToDataURL } from './profiles.js';

/**
 * Create or update a journal entry. Pass imageFile (from a file picker)
 * to attach a trade screenshot; omit to keep the existing image.
 * Returns the entry id.
 */
export async function saveJournalEntry(uid, { text = '', imageFile = null, entryId = null }) {
  const tradeImage = imageFile ? await downscaleToDataURL(imageFile, 1024, 0.82) : undefined;
  if (entryId) {
    const patch = { text, updatedAt: serverTimestamp() };
    if (tradeImage !== undefined) patch.tradeImage = tradeImage;
    await updateDoc(doc(db, 'journal', uid, 'entries', entryId), patch);
    return entryId;
  }
  const ref_ = doc(collection(db, 'journal', uid, 'entries'));
  await setDoc(ref_, {
    text,
    ...(tradeImage !== undefined && { tradeImage }),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref_.id;
}

/** All entries for a user, newest first. Same on every device. */
export async function getJournalEntries(uid, maxN = 50) {
  const snap = await getDocs(query(collection(db, 'journal', uid, 'entries'), limit(maxN)));
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
}

export async function deleteJournalEntry(uid, entryId) {
  await deleteDoc(doc(db, 'journal', uid, 'entries', entryId));
}
