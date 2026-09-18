/**
 * profiles.js — user profiles: display name, photo, bio, trading info.
 *
 * Firestore:  users/{uid}
 * Photos are stored as downscaled data URLs in users/{uid}.photoURL
 * (no Firebase Storage / Blaze billing needed at this stage).
 */
import {
  doc, getDoc, setDoc, updateDoc, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db } from './aeway-backend.js';

const BLANK_PROFILE = {
  displayName: '',
  photoURL: '',
  bio: '',
  tradingLevel: 'beginner', // beginner | intermediate | advanced
  stats: { xp: 0, wins: 0, losses: 0, draws: 0 },
};

/** Fetch a profile; creates a blank one on first load. */
export async function getProfile(uid) {
  const snap = await getDoc(doc(db, 'users', uid));
  if (snap.exists()) return { uid, ...snap.data() };
  const fresh = {
    ...BLANK_PROFILE,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  await setDoc(doc(db, 'users', uid), fresh);
  return { uid, ...BLANK_PROFILE };
}

/** Save editable profile fields (displayName, bio, tradingLevel). */
export async function saveProfile(uid, { displayName, bio, tradingLevel }) {
  await updateDoc(doc(db, 'users', uid), {
    ...(displayName !== undefined && { displayName }),
    ...(bio !== undefined && { bio }),
    ...(tradingLevel !== undefined && { tradingLevel }),
    updatedAt: serverTimestamp(),
  });
}

/**
 * Save a profile photo. The image is downscaled in the browser to a small
 * JPEG thumbnail (~256px, tens of KB) and stored directly on the user's
 * Firestore profile as a data URL — no Storage bucket or billing needed.
 * Returns the data URL.
 */
export async function uploadProfilePhoto(uid, file, { size = 256, quality = 0.8 } = {}) {
  if (!file.type.startsWith('image/')) throw new Error('Please choose an image file.');
  const dataUrl = await downscaleToDataURL(file, size, quality);
  await updateDoc(doc(db, 'users', uid), { photoURL: dataUrl, updatedAt: serverTimestamp() });
  return dataUrl;
}

export function downscaleToDataURL(file, size, quality) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, size / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read that image.'));
    };
    img.src = url;
  });
}

/** Record a finished match on both players' lifetime stats. */
export async function recordMatchResult(uid, outcome /* 'win' | 'loss' | 'draw' */, xpGained = 0) {
  const ref_ = doc(db, 'users', uid);
  const snap = await getDoc(ref_);
  const stats = { xp: 0, wins: 0, losses: 0, draws: 0, ...(snap.data()?.stats || {}) };
  stats.xp += xpGained;
  if (outcome === 'win') stats.wins += 1;
  else if (outcome === 'loss') stats.losses += 1;
  else stats.draws += 1;
  await updateDoc(ref_, { stats, updatedAt: serverTimestamp() });
}
