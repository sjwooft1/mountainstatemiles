// ============================================================
//  portal-auth.js  —  Username/password accounts stored in RTDB
//  Mountain State Miles / wvruns
//
//  NO Firebase Auth. Accounts live in a new Realtime Database folder:
//    portal_accounts/{usernameKey} = {
//      username, passHash, role, displayName,
//      athleteName, schoolSlug, gender,
//      follows:{athletes:[],schools:[]}, createdAt, updatedAt
//    }
//  usernameKey = lowercased username with RTDB-illegal chars stripped.
//
//  Passwords are hashed client-side with SHA-256 before storage, so raw
//  passwords never touch the database. This is NOT production-grade auth
//  (no per-user salt, no server-side rate limiting). It's a lightweight
//  login for a static site. See portal-firebase-rules.json for rules that
//  keep portal_accounts private (not world-readable).
//
//  The signed-in session is kept in localStorage so a refresh stays logged
//  in. "Sign out" clears it.
// ============================================================

(function () {
  "use strict";

  const ACCOUNTS_PATH = "portal_accounts";
  const SESSION_KEY = "msm_portal_session"; // stores { username } only

  const listeners = [];
  let currentUser = null;      // { username, displayName }
  let currentProfile = null;   // full account record (minus passHash)
  let booted = false;

  function onChange(fn) { listeners.push(fn); if (booted) fn(currentUser, currentProfile); }
  function emit() { listeners.forEach((fn) => { try { fn(currentUser, currentProfile); } catch (e) { console.error(e); } }); }

  function db() {
    if (!window.firebaseDatabase) throw new Error("Firebase database not ready");
    return window.firebaseDatabase;
  }
  // RTDB keys can't contain . # $ [ ] / — normalize username to a safe key.
  function userKey(username) {
    return (username || "").trim().toLowerCase().replace(/[.#$/\[\]]/g, "_");
  }
  function accountRef(username) { return db().ref(`${ACCOUNTS_PATH}/${userKey(username)}`); }

  async function waitForDb() {
    let i = 0;
    while (!window.firebaseDatabase && i < 80) { await new Promise((r) => setTimeout(r, 100)); i++; }
    if (!window.firebaseDatabase) throw new Error("Firebase database not ready");
  }

  // ---- password hashing (SHA-256) ------------------------------------
  // Uses the native Web Crypto API when available (HTTPS / localhost). Falls
  // back to a pure-JS SHA-256 for insecure contexts (file:// or plain http://)
  // where crypto.subtle is undefined. Both produce the same 64-char hex digest,
  // so accounts stay compatible however the page is served.
  async function hashPassword(pw) {
    const input = "msm::" + pw; // app-wide pepper (not a per-user salt)
    if (typeof crypto !== "undefined" && crypto.subtle && crypto.subtle.digest) {
      try {
        const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
        return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
      } catch (e) { /* fall through to JS implementation */ }
    }
    return sha256js(input);
  }

  // Minimal, dependency-free SHA-256 (returns lowercase hex). Used only when
  // Web Crypto is unavailable.
  function sha256js(ascii) {
    function rr(n, x) { return (x >>> n) | (x << (32 - n)); }
    const K = [
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
      0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
      0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
      0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
      0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
      0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
    let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a,
        h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
    // UTF-8 encode
    const utf8 = unescape(encodeURIComponent(ascii));
    const bytes = [];
    for (let i = 0; i < utf8.length; i++) bytes.push(utf8.charCodeAt(i) & 0xff);
    const bitLen = bytes.length * 8;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    for (let i = 7; i >= 0; i--) bytes.push((bitLen / Math.pow(2, i * 8)) & 0xff);
    const w = new Array(64);
    for (let j = 0; j < bytes.length; j += 64) {
      for (let i = 0; i < 16; i++) {
        w[i] = (bytes[j + i * 4] << 24) | (bytes[j + i * 4 + 1] << 16) | (bytes[j + i * 4 + 2] << 8) | (bytes[j + i * 4 + 3]);
      }
      for (let i = 16; i < 64; i++) {
        const s0 = rr(7, w[i - 15]) ^ rr(18, w[i - 15]) ^ (w[i - 15] >>> 3);
        const s1 = rr(17, w[i - 2]) ^ rr(19, w[i - 2]) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      }
      let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, hh = h7;
      for (let i = 0; i < 64; i++) {
        const S1 = rr(6, e) ^ rr(11, e) ^ rr(25, e);
        const ch = (e & f) ^ (~e & g);
        const t1 = (hh + S1 + ch + K[i] + w[i]) | 0;
        const S0 = rr(2, a) ^ rr(13, a) ^ rr(22, a);
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const t2 = (S0 + maj) | 0;
        hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
      h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + hh) | 0;
    }
    const toHex = (n) => ("00000000" + (n >>> 0).toString(16)).slice(-8);
    return toHex(h0) + toHex(h1) + toHex(h2) + toHex(h3) + toHex(h4) + toHex(h5) + toHex(h6) + toHex(h7);
  }

  function stripSecret(acct) {
    if (!acct) return null;
    const { passHash, ...rest } = acct;
    return rest;
  }
  function persistSession(username) {
    try { localStorage.setItem(SESSION_KEY, JSON.stringify({ username })); } catch (e) { /* ignore */ }
  }
  function clearSession() {
    try { localStorage.removeItem(SESSION_KEY); } catch (e) { /* ignore */ }
  }

  async function loadAccount(username) {
    const snap = await accountRef(username).once("value");
    return snap.exists() ? snap.val() : null;
  }

  function setSignedIn(acct) {
    currentUser = { username: acct.username, displayName: acct.displayName || acct.username };
    currentProfile = stripSecret(acct);
    persistSession(acct.username);
    emit();
  }

  // ---- public auth actions -------------------------------------------
  async function signUp(username, password, displayName) {
    await waitForDb();
    const uname = (username || "").trim();
    if (!uname) throw new Error("Enter a username.");
    if ((password || "").length < 4) throw new Error("Password must be at least 4 characters.");
    const existing = await loadAccount(uname);
    if (existing) throw new Error("That username is taken — sign in instead.");
    const now = new Date().toISOString();
    const acct = {
      username: uname,
      passHash: await hashPassword(password),
      displayName: (displayName || uname).trim(),
      role: null,
      follows: { athletes: [], schools: [] },
      createdAt: now,
      updatedAt: now,
    };
    // Write to Firebase, surfacing permission errors instead of hiding them.
    try {
      await accountRef(uname).set(acct);
    } catch (e) {
      throw new Error("Couldn't save your account to the database (" + (e && e.code || e.message || "write failed") + "). Your database rules likely block writes to portal_accounts — deploy the portal rules and try again.");
    }
    // Read it straight back to confirm it actually persisted (a blocked write
    // can resolve without error under some rule configs).
    const verify = await loadAccount(uname);
    if (!verify) {
      throw new Error("Account did not persist to the database. Deploy the portal security rules so portal_accounts is writable, then try again.");
    }
    setSignedIn(acct);
    return currentUser;
  }

  async function signIn(username, password) {
    await waitForDb();
    let acct;
    try {
      acct = await loadAccount(username);
    } catch (e) {
      throw new Error("Couldn't reach the accounts database (" + (e && e.code || e.message || "read failed") + "). Check your connection and that the portal rules allow reading portal_accounts.");
    }
    if (!acct) throw new Error("No account with that username on this database. Make sure you created it here, and that the account was saved to Firebase (not just this browser).");
    const hash = await hashPassword(password);
    if (hash !== acct.passHash) throw new Error("Incorrect username or password.");
    setSignedIn(acct);
    return currentUser;
  }

  function signOut() {
    currentUser = null;
    currentProfile = null;
    clearSession();
    emit();
  }

  // Save/patch the signed-in user's own profile fields (never touches passHash).
  async function saveProfile(patch) {
    if (!currentUser) throw new Error("Not signed in");
    await waitForDb();
    const now = new Date().toISOString();
    // Only write allowed profile fields.
    const allowed = ["role", "displayName", "athleteName", "schoolSlug", "gender", "follows", "heroImage", "avatar"];
    const updates = { updatedAt: now };
    allowed.forEach((k) => { if (k in patch) updates[k] = patch[k]; });
    await accountRef(currentUser.username).update(updates);
    currentProfile = { ...currentProfile, ...updates };
    if (updates.displayName) currentUser.displayName = updates.displayName;
    emit();
    return currentProfile;
  }

  // ---- follows helpers (fan role) ------------------------------------
  async function toggleFollowAthlete(name) {
    const follows = (currentProfile && currentProfile.follows) || { athletes: [], schools: [] };
    const set = new Set(follows.athletes || []);
    if (set.has(name)) set.delete(name); else set.add(name);
    return saveProfile({ follows: { athletes: [...set], schools: follows.schools || [] } });
  }
  async function toggleFollowSchool(slug) {
    const follows = (currentProfile && currentProfile.follows) || { athletes: [], schools: [] };
    const set = new Set(follows.schools || []);
    if (set.has(slug)) set.delete(slug); else set.add(slug);
    return saveProfile({ follows: { athletes: follows.athletes || [], schools: [...set] } });
  }

  // ---- boot: restore session from localStorage -----------------------
  async function init() {
    try {
      await waitForDb();
      let saved = null;
      try { saved = JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); } catch (e) { saved = null; }
      if (saved && saved.username) {
        const acct = await loadAccount(saved.username);
        if (acct) { currentUser = { username: acct.username, displayName: acct.displayName || acct.username }; currentProfile = stripSecret(acct); }
        else clearSession();
      }
    } catch (e) {
      console.warn("Portal auth init:", e.message);
    } finally {
      booted = true;
      emit();
    }
  }

  window.MSMAuth = {
    onChange, init,
    get user() { return currentUser; },
    get profile() { return currentProfile; },
    // primary actions
    signUp, signIn, signOut, saveProfile,
    toggleFollowAthlete, toggleFollowSchool,
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
