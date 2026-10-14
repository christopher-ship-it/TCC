import { deleteApp, initializeApp } from 'firebase/app';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from 'firebase/auth';

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

// `npm run emulators` + VITE_FIREBASE_EMULATOR=true: sign-in and data on this machine, nothing real touched.
const useEmulator = firebaseEnabled && import.meta.env.VITE_FIREBASE_EMULATOR === 'true';
if (useEmulator && db && auth) {
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
}

// Every person signs in with their own Firebase Auth account (email + password). Who they are inside TCC
// (role, apps, queues) comes from the `agents` record that `authLinks/{uid}` points at — see firestore.rules.

export function watchAuth(cb: (user: User | null) => void): () => void {
  if (!auth) {
    cb(null);
    return () => undefined;
  }
  return onAuthStateChanged(auth, cb);
}

/** A readable reason for a failed sign-in. Wrong email and wrong password share one message on purpose. */
export function authMessage(e: unknown): string {
  const code = (e as { code?: string })?.code ?? '';
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
    case 'auth/invalid-email':
      return 'Email or password is not right.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Wait a few minutes, or use “Forgot password”.';
    case 'auth/user-disabled':
      return 'This account has been disabled. Ask your admin.';
    case 'auth/network-request-failed':
      return 'No connection to the server. Check your internet and try again.';
    case 'auth/email-already-in-use':
      return 'That email already has a login. Use a different one, or ask them to reset their password.';
    default:
      return 'Could not sign in. Try again.';
  }
}

export async function signInWithPassword(email: string, password: string): Promise<void> {
  if (!auth) throw new Error('Firebase is not configured');
  await signInWithEmailAndPassword(auth, email.trim(), password);
}

export async function signOutOfFirebase(): Promise<void> {
  if (auth) await signOut(auth);
}

export async function sendReset(email: string): Promise<void> {
  if (!auth) throw new Error('Firebase is not configured');
  await sendPasswordResetEmail(auth, email.trim());
}

/**
 * Creates a login for a new person without signing the admin out: the account is made on a second, throw-away
 * Firebase app instance. Nobody (including the admin) ever sees a password — the person gets a reset email and
 * chooses their own. Returns the new account's uid; the caller links it to an agent record.
 */
export async function createLogin(email: string): Promise<string> {
  const secondary = initializeApp(firebaseConfig, `provision-${Date.now()}`);
  try {
    const sAuth = getAuth(secondary);
    if (useEmulator) connectAuthEmulator(sAuth, 'http://127.0.0.1:9099', { disableWarnings: true });
    const throwaway = crypto.getRandomValues(new Uint32Array(6)).join('-');
    const { user } = await createUserWithEmailAndPassword(sAuth, email.trim(), throwaway);
    await sendPasswordResetEmail(sAuth, email.trim());
    await signOut(sAuth);
    return user.uid;
  } finally {
    await deleteApp(secondary);
  }
}
