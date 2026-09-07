import React from 'react';
import { firebaseEnabled } from '../firebase/client';
import { LocalStoreProvider } from './LocalStoreProvider';
import { FirestoreStoreProvider } from './FirestoreStoreProvider';

export { useStore } from './context';

// Firestore-backed when a TCC Firebase project is configured (VITE_FIREBASE_*
// env vars present); otherwise falls back to a local, single-browser demo
// store so the app still runs with zero setup (this is what the published
// artifact preview runs on).
export function StoreProvider({ children }: { children: React.ReactNode }) {
  return firebaseEnabled ? <FirestoreStoreProvider>{children}</FirestoreStoreProvider> : <LocalStoreProvider>{children}</LocalStoreProvider>;
}
