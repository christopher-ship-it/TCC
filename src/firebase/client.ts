import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const firebaseEnabled = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);

const app = firebaseEnabled ? initializeApp(firebaseConfig) : null;
export const db = app ? getFirestore(app) : null;
const auth = app ? getAuth(app) : null;

// TCC has no per-agent Firebase Auth yet (logins are TCC's own username-based
// accounts stored in Firestore, matched client-side on the login screen).
// Anonymous auth just gives the browser a request.auth != null so Firestore
// security rules can require auth without needing real per-agent credentials.
let readySignal: Promise<void> | null = null;
export function ensureFirebaseAuth(): Promise<void> {
  if (!auth) return Promise.resolve();
  if (readySignal) return readySignal;
  readySignal = new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (user) {
        unsub();
        resolve();
      } else {
        signInAnonymously(auth).catch((err) => {
          console.error('Firebase anonymous sign-in failed', err);
          resolve();
        });
      }
    });
  });
  return readySignal;
}
