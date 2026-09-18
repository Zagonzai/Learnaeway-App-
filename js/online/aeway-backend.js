/**
 * aeway-backend.js — Firebase init + auth helpers for the Aeway app.
 *
 * Add via <script type="module"> and import what you need:
 *   import { auth, db, storage, requireUser, onAuth } from './aeway-backend.js';
 *
 * Uses the Firebase modular SDK (v9+) from CDN. If your app already
 * initializes Firebase elsewhere, keep one init and reuse the instances.
 */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { getStorage } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js';

const firebaseConfig = {
  apiKey: 'AIzaSyCFcG423QUQ6frPvl7HMJO8vYcWzPzOD8c',
  authDomain: 'aeway-60d9a.firebaseapp.com',
  projectId: 'aeway-60d9a',
  storageBucket: 'aeway-60d9a.appspot.com',
  appId: '1:40107408520:web:af7d563db1c7f8351f333d',
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

/** Resolves with the signed-in user, or null if signed out. */
export function onAuth() {
  return new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, (user) => {
      unsub();
      resolve(user);
    });
  });
}

/** Throws / redirects unless a user is signed in. Returns the user. */
export async function requireUser({ redirectTo = null } = {}) {
  const user = await onAuth();
  if (!user && redirectTo) window.location.href = redirectTo;
  if (!user) throw new Error('Sign-in required.');
  return user;
}
