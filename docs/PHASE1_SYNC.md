# Phase 1 — Profiles & sync

## Already in the app (this branch)

- Firebase Auth via `js/firebase.js` (`FB.signIn` / `signUp` / `signOut`).
- On every `save()`, when signed in, the app debounces a write to Firestore `users/{uid}`.
- After login (and on reload if a session exists), `pullCloudAndMerge()` unions cloud maps into local `learnaeway.v1`.

## What this drop-in finishes

1. **`firestore.rules`** — users can only read/write their own `users/{uid}` doc.
2. **Richer cloud payload + merge** — includes bookmarks/`saved`, Pickæway stats, watchlist, journal extras; merges profile fields instead of only filling an empty profile.
3. **`FB.saveUserDoc` updateMask** — PATCH merges named fields instead of risking a full-doc overwrite oddity.
4. **Profile photo** — stays **local only** for now (data URLs can blow past Firestore’s 1MB doc limit). Storage upload is a follow-up.

## Enable rules in Firebase

1. Open [Firebase Console](https://console.firebase.google.com/) → project **aeway-60d9a**.
2. Firestore → **Rules** → paste `firestore.rules` → Publish.
3. Confirm Authentication → Email/Password is enabled.
4. Smoke test: sign up on browser A, like a screen / edit profile, sign in on browser B (or another device), confirm progress + profile name appear after a few seconds.

## Files to copy into the repo

```
firestore.rules                 → repo root
docs/PHASE1_SYNC.md             → docs/
js/firebase.js                  → js/firebase.js  (replace)
js/app.js                       → js/app.js       (replace) — or only swap the sync block using app-sync-snippet.js
```
