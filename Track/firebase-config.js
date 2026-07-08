// Firebase configuration
// Load this AFTER the Firebase SDK <script> tags but BEFORE firebase-helpers.js

const firebaseConfig = {
  apiKey: "AIzaSyCBQt9I_OSoUuTM61F-JXNBkD98f7PCJcA",
  authDomain: "mountainstatemiles-1326f.firebaseapp.com",
  databaseURL: "https://mountainstatemiles-1326f-default-rtdb.firebaseio.com",
  projectId: "mountainstatemiles-1326f",
  storageBucket: "mountainstatemiles-1326f.firebasestorage.app",
  messagingSenderId: "605911511756",
  appId: "1:605911511756:web:0e99071a816f0a39210869",
  measurementId: "G-N3DNFRQNF9"
};

(function () {
  try {
    const app = firebase.apps.length === 0
      ? firebase.initializeApp(firebaseConfig)
      : firebase.app();

    const database = firebase.database();

    // Expose via a getter so firebase-helpers.js always reads the live reference,
    // even if it is evaluated before this script finishes (shouldn't happen with
    // correct script order, but this is a safe guard).
    window.firebaseApp = app;
    window.firebaseDatabase = database;

    // Optional: Analytics (silently skip if unavailable)
    try { if (firebase.analytics) firebase.analytics(); } catch (_) {}

    console.log('[Firebase] Initialized successfully');
  } catch (err) {
    console.error('[Firebase] Initialization failed:', err);
    // Surface a visible error instead of silently swallowing it with a mock.
    // The admin UI's checkSchema() will catch this and show the Offline badge.
    window.firebaseDatabase = null;
    window.firebaseApp = null;
  }
})();