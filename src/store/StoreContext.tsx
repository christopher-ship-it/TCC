import React from 'react';
import { firebaseEnabled } from '../firebase/client';
import { LocalStoreProvider } from './LocalStoreProvider';
import { FirestoreStoreProvider } from './FirestoreStoreProvider';
import { ServerStoreProvider, serverStoreEnabled } from './ServerStoreProvider';

export { useStore } from './context';

// VITE_STORE=server: TCC's own server and database (sign-in with username + password, shared records).
// Otherwise Firestore-backed when a TCC Firebase project is configured (VITE_FIREBASE_* env vars present);
// otherwise a local, single-browser demo store so the app still runs with zero setup (this is what the
// published artifact preview runs on).
export function StoreProvider({ children }: { children: React.ReactNode }) {
  if (serverStoreEnabled) return <ServerStoreProvider>{children}</ServerStoreProvider>;
  return firebaseEnabled ? <FirestoreStoreProvider>{children}</FirestoreStoreProvider> : <LocalStoreProvider>{children}</LocalStoreProvider>;
}
