/* bridge.js — the one door between the four backend modules and js/app.js.
 *
 * The modules are ES modules on the Firebase modular SDK (v10, from CDN);
 * app.js is a classic script and cannot import them. So this file imports
 * everything the app needs and puts it on window.AEWAY_ONLINE, then announces
 * itself with an `aeway-online-ready` event. app.js waits for that event (with
 * a timeout) and treats its absence as "offline" — a module script that cannot
 * reach the CDN fails as a whole, and nothing here ever runs.
 *
 * Nothing in this file talks to Firestore itself. Every read and write goes
 * through the modules, which is what the deployed security rules expect.
 *
 * ==> INTEGRATION: the app signs in over Firebase's REST API (js/firebase.js)
 * and keeps that session itself. The SDK behind these modules keeps a session
 * of its own and knows nothing about the REST one, so requireUser() would find
 * nobody. signIn / signOut below are the mirror: app.js calls them beside its
 * own sign-in and sign-out, so both sessions belong to the same account.
 * signIn is used for sign-up too — by the time app.js reaches the mirror the
 * REST call has already created the account, so the SDK only has to log into
 * it. */
import { auth, onAuth, requireUser } from './aeway-backend.js';
import {
  signInWithEmailAndPassword, signOut,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getProfile, saveProfile, uploadProfilePhoto, recordMatchResult, getPlayerByInviteCode,
} from './profiles.js';
import {
  lookupPlayer, sendMatchInvite, watchInvite, watchIncomingInvites,
  acceptInvite, declineInvite, cancelInvite, INVITE_TTL_MS,
} from './invites.js';
import { quickMatch } from './matchmaking.js';
import { watchRoom, playRound, forfeitRoom, getMatchHistory } from './pointaway.js';
import { saveJournalEntry, getJournalEntries, deleteJournalEntry } from './journal.js';

window.AEWAY_ONLINE = {
  ready: true,
  /* auth */
  onAuth,
  requireUser,
  currentUser: () => auth.currentUser,
  signIn: (email, password) => signInWithEmailAndPassword(auth, email, password),
  signOut: () => signOut(auth),
  /* profiles.js */
  getProfile,
  saveProfile,
  uploadProfilePhoto,
  recordMatchResult,
  getPlayerByInviteCode,
  /* invites.js — challenge a named player, and the inbox on the other side */
  lookupPlayer,
  sendMatchInvite,
  watchInvite,
  watchIncomingInvites,
  acceptInvite,
  declineInvite,
  cancelInvite,
  INVITE_TTL_MS,
  /* matchmaking.js */
  quickMatch,
  /* pointaway.js */
  watchRoom,
  playRound,
  forfeitRoom,
  getMatchHistory,
  /* journal.js — trade notes with screenshots, synced across devices */
  saveJournalEntry,
  getJournalEntries,
  deleteJournalEntry,
};

window.dispatchEvent(new CustomEvent('aeway-online-ready'));
