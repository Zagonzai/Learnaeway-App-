/* Firebase client for the Learnæway PWA — implemented over Firebase's REST
 * APIs (Identity Toolkit + Firestore) instead of the JS SDK, so the app keeps
 * zero external script dependencies and still loads instantly offline.
 *
 * Exposes window.FB:
 *   signIn(email, pw)        -> {uid, email}         (throws friendly Error)
 *   signUp(email, pw)        -> {uid, email}
 *   signOut()
 *   user()                   -> {uid, email} | null
 *   logGateAttempt(obj)      -> fire-and-forget write to access-attempts
 *   loadUserDoc()            -> plain object | null   (users/{uid})
 *   saveUserDoc(obj)         -> PATCH users/{uid}
 */
(function () {
  "use strict";

  const cfg = (window.LEARNAEWAY_CONFIG || {}).firebase || {};
  const KEY = cfg.apiKey;
  const PROJECT = cfg.projectId;
  const AUTH_KEY = "learnaeway.fbauth";
  const FS_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

  let session = null;
  try { session = JSON.parse(localStorage.getItem(AUTH_KEY)) || null; } catch (e) { /* fresh */ }

  function persist() {
    try {
      if (session) localStorage.setItem(AUTH_KEY, JSON.stringify(session));
      else localStorage.removeItem(AUTH_KEY);
    } catch (e) { /* quota */ }
  }

  const FRIENDLY = {
    EMAIL_NOT_FOUND: "No account found with that email.",
    INVALID_PASSWORD: "Incorrect email or password.",
    INVALID_LOGIN_CREDENTIALS: "Incorrect email or password.",
    EMAIL_EXISTS: "An account with that email already exists — try logging in.",
    INVALID_EMAIL: "That email address doesn't look valid.",
    WEAK_PASSWORD: "Password must be at least 6 characters.",
    MISSING_PASSWORD: "Please enter a password.",
    MISSING_EMAIL: "Please enter your email.",
    TOO_MANY_ATTEMPTS_TRY_LATER: "Too many attempts — please wait a moment and try again.",
    USER_DISABLED: "This account has been disabled.",
  };

  async function idpCall(endpoint, body) {
    let res;
    try {
      res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:${endpoint}?key=${KEY}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (e) {
      throw new Error("Can't reach the sign-in service — check your connection and try again.");
    }
    const data = await res.json();
    if (!res.ok) {
      const code = (((data || {}).error || {}).message || "").split(" ")[0].split(":")[0];
      throw new Error(FRIENDLY[code] || "Sign-in failed — please try again.");
    }
    return data;
  }

  function setSession(d) {
    session = {
      uid: d.localId,
      email: d.email,
      idToken: d.idToken,
      refreshToken: d.refreshToken,
      expiresAt: Date.now() + (parseInt(d.expiresIn || "3600", 10) - 120) * 1000,
    };
    persist();
    return { uid: session.uid, email: session.email };
  }

  async function freshToken() {
    if (!session) return null;
    if (Date.now() < session.expiresAt) return session.idToken;
    try {
      const res = await fetch(`https://securetoken.googleapis.com/v1/token?key=${KEY}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(session.refreshToken)}`,
      });
      const d = await res.json();
      if (!res.ok) throw new Error("refresh failed");
      session.idToken = d.id_token;
      session.refreshToken = d.refresh_token;
      session.uid = d.user_id;
      session.expiresAt = Date.now() + (parseInt(d.expires_in || "3600", 10) - 120) * 1000;
      persist();
      return session.idToken;
    } catch (e) {
      return null;   // token unusable — data calls will no-op until next sign-in
    }
  }

  /* ---- Firestore value encoding/decoding (subset: the types we store) ---- */

  function enc(v) {
    if (v === null || v === undefined) return { nullValue: null };
    if (typeof v === "boolean") return { booleanValue: v };
    if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
    if (typeof v === "string") return { stringValue: v };
    if (Array.isArray(v)) return { arrayValue: { values: v.map(enc) } };
    const fields = {};
    for (const k of Object.keys(v)) fields[k] = enc(v[k]);
    return { mapValue: { fields } };
  }

  function dec(v) {
    if (!v) return null;
    if ("nullValue" in v) return null;
    if ("booleanValue" in v) return v.booleanValue;
    if ("integerValue" in v) return parseInt(v.integerValue, 10);
    if ("doubleValue" in v) return v.doubleValue;
    if ("stringValue" in v) return v.stringValue;
    if ("timestampValue" in v) return v.timestampValue;
    if ("arrayValue" in v) return (v.arrayValue.values || []).map(dec);
    if ("mapValue" in v) {
      const out = {};
      const f = v.mapValue.fields || {};
      for (const k of Object.keys(f)) out[k] = dec(f[k]);
      return out;
    }
    return null;
  }

  function toFields(obj) {
    const fields = {};
    for (const k of Object.keys(obj)) fields[k] = enc(obj[k]);
    return fields;
  }

  window.FB = {
    user() {
      return session ? { uid: session.uid, email: session.email } : null;
    },

    async signIn(email, password) {
      return setSession(await idpCall("signInWithPassword", { email, password, returnSecureToken: true }));
    },

    async signUp(email, password) {
      return setSession(await idpCall("signUp", { email, password, returnSecureToken: true }));
    },

    signOut() {
      session = null;
      persist();
    },

    /* access-gate attempt -> access-attempts collection (createDocument) */
    logGateAttempt(attempt) {
      try {
        fetch(`${FS_BASE}/access-attempts?key=${KEY}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fields: toFields(attempt) }),
        }).catch(() => {});
      } catch (e) { /* offline — attempt is still in localStorage */ }
    },

    async loadUserDoc() {
      const token = await freshToken();
      if (!token) return null;
      try {
        const res = await fetch(`${FS_BASE}/users/${session.uid}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.status === 404) return null;
        if (!res.ok) return null;
        const doc = await res.json();
        return dec({ mapValue: { fields: doc.fields || {} } });
      } catch (e) {
        return null;
      }
    },

    async saveUserDoc(obj) {
      const token = await freshToken();
      if (!token) return false;
      try {
        const res = await fetch(`${FS_BASE}/users/${session.uid}`, {
          method: "PATCH",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ fields: toFields(obj) }),
        });
        return res.ok;
      } catch (e) {
        return false;
      }
    },
  };
})();
