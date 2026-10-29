import React, { useCallback, useContext, useMemo, useState } from 'react';
import { firebaseEnabled } from '../firebase/client';
import { APPS } from '../data/seed';
import type { AppId } from '../data/types';
import { inProduct, mayEnter, readProduct, writeProduct } from '../lib/product';
import { LocalStoreProvider } from './LocalStoreProvider';
import { FirestoreStoreProvider } from './FirestoreStoreProvider';
import { ServerStoreProvider, serverStoreEnabled } from './ServerStoreProvider';
import { BaseStoreContext, StoreContext, type Action, type StoreValue } from './context';

export { useStore } from './context';

/** A build with one product (a white label, or VITE_APPS with one id) needs no picking. */
const ONLY_PRODUCT: AppId | null = APPS.length === 1 ? APPS[0].id : null;

/**
 * The product this session works in (src/lib/product.ts). The signed-in person is narrowed to it here, once, so every
 * screen follows; their stored account keeps all of its products. A product they no longer have counts as none picked.
 */
function ProductGate({ children }: { children: React.ReactNode }) {
  const base = useContext(BaseStoreContext);
  if (!base) throw new Error('ProductGate must be inside a store provider');
  const [picked, setPicked] = useState<AppId | null>(() => ONLY_PRODUCT ?? readProduct());

  const chooseProduct = useCallback((app: AppId | null) => {
    if (ONLY_PRODUCT) return;
    writeProduct(app);
    setPicked(app);
  }, []);

  const { currentAgent: account, dispatch: baseDispatch } = base;
  const product = picked && APPS.some((a) => a.id === picked) && (!account || mayEnter(account, picked)) ? picked : null;
  const currentAgent = useMemo(() => (account && product && !ONLY_PRODUCT ? inProduct(account, product) : account), [account, product]);

  // Signing out also leaves the product: the next person picks their own.
  const dispatch = useCallback(
    (action: Action) => {
      if (action.type === 'LOGOUT') chooseProduct(null);
      baseDispatch(action);
    },
    [baseDispatch, chooseProduct],
  ) as React.Dispatch<Action>;

  const value = useMemo<StoreValue>(() => ({ ...base, dispatch, currentAgent, account, product, chooseProduct }), [base, dispatch, currentAgent, account, product, chooseProduct]);
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

// VITE_STORE=server: TCC's own server and database (sign-in with username + password, shared records).
// Otherwise Firestore-backed when a TCC Firebase project is configured (VITE_FIREBASE_* env vars present);
// otherwise a local, single-browser demo store so the app still runs with zero setup (this is what the
// published artifact preview runs on).
export function StoreProvider({ children }: { children: React.ReactNode }) {
  const gated = <ProductGate>{children}</ProductGate>;
  if (serverStoreEnabled) return <ServerStoreProvider>{gated}</ServerStoreProvider>;
  return firebaseEnabled ? <FirestoreStoreProvider>{gated}</FirestoreStoreProvider> : <LocalStoreProvider>{gated}</LocalStoreProvider>;
}
