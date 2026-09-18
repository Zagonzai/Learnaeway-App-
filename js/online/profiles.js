/**
 * profiles.js — user profiles: display name, photo, bio, trading info.
 *
 * Firestore:  users/{uid}
 * Photos are stored as downscaled data URLs in users/{uid}.photoURL
 * (no Firebase Storage / Blaze billing needed at this stage).
 */
import {
  doc, getDoc, setDoc, updateDoc, serverTimestamp,
  collection, query, where, limit, getDocs,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db } from './aeway-backend.js';

const BLANK_PROFILE = {
  displayName: '',
  displayNameLower: '',
  photoURL: '',
  bio: '',
  tradingLevel: 'beginner', // beginner | intermediate | advanced
  stats: { xp: 0, wins: 0, losses: 0, draws: 0 },
};

// Invite codes: 6 chars, no confusing characters (0/O, 1/I/L).
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Generate a unique 6-char invite code (retries on collision). */
async function generateUniqueInviteCode() {
  for (let i = 0; i < 8; i++) {
    const code = Array.from({ length: 6 },
      () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
    const snap = await getDocs(query(
      collection(db, 'users'), where('inviteCode', '==', code), limit(1)));
    if (snap.empty) return code;
  }
  // Astronomically unlikely fallback: longer code, no collision check.
  return Array.from({ length: 10 },
    () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
}

/** Fetch a profile; creates a blank one (with a unique invite code) on first load.
 *  Older profiles missing an invite code get one lazily on read. */
export async function getProfile(uid) {
  const ref_ = doc(db, 'users', uid);
  const snap = await getDoc(ref_);
  if (snap.exists()) {
    const data = snap.data();
    if (!data.inviteCode) {
      const inviteCode = await generateUniqueInviteCode();
      await updateDoc(ref_, { inviteCode, updatedAt: serverTimestamp() });
      data.inviteCode = inviteCode;
    }
    return { uid, ...data };
  }
  const fresh = { ...BLANK_PROFILE, inviteCode: await generateUniqueInviteCode() };
  await setDoc(ref_, { ...fresh, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  return { uid, ...fresh };
}

/** Look up a single player by their invite code (case-insensitive). */
export async function getPlayerByInviteCode(code) {
  const clean = (code || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{6,10}$/.test(clean)) return null;
  const snap = await getDocs(query(
    collection(db, 'users'), where('inviteCode', '==', clean), limit(1)));
  if (snap.empty) return null;
  const d = snap.docs[0];
  const p = d.data();
  return { uid: d.id, displayName: p.displayName || 'Trader', photoURL: p.photoURL || '' };
}

/** Save editable profile fields (displayName, bio, tradingLevel).
 *  Also maintains displayNameLower for case-insensitive player search. */
export async function saveProfile(uid, { displayName, bio, tradingLevel }) {
  const patch = { updatedAt: serverTimestamp() };
  if (displayName !== undefined) {
    patch.displayName = displayName;
    patch.displayNameLower = displayName.trim().toLowerCase();
  }
  if (bio !== undefined) patch.bio = bio;
  if (tradingLevel !== undefined) patch.tradingLevel = tradingLevel;
  await updateDoc(doc(db, 'users', uid), patch);
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
