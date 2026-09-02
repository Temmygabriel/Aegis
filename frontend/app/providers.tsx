"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  loadOrCreateIdentity,
  resetIdentity,
  importIdentity,
  type Identity,
} from "@/lib/identity";

interface IdentityCtx {
  identity: Identity | null;
  ready: boolean;
  reset: () => void;
  /** Swap the whole signer to an imported private key. Throws on a bad key. */
  importKey: (pk: string) => void;
}

const Ctx = createContext<IdentityCtx>({
  identity: null,
  ready: false,
  reset: () => {},
  importKey: () => {},
});

export function Providers({ children }: { children: ReactNode }) {
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [ready, setReady] = useState(false);

  // localStorage + key derivation happen only in the browser, never during SSR.
  useEffect(() => {
    try {
      setIdentity(loadOrCreateIdentity());
    } finally {
      setReady(true);
    }
  }, []);

  const reset = () => setIdentity(resetIdentity());

  const importKey = (pk: string) => setIdentity(importIdentity(pk));

  return <Ctx.Provider value={{ identity, ready, reset, importKey }}>{children}</Ctx.Provider>;
}

export function useIdentity() {
  return useContext(Ctx);
}
