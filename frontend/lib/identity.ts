"use client";

import { createAccount, generatePrivateKey } from "genlayer-js";

// Aegis uses a browser-stored identity, not a real wallet. GenLayer studionet
// transactions are signed by a genlayer-js account (an in-browser keypair) —
// MetaMask cannot sign them directly. This is honest and clearly labeled in the
// UI as a browser identity.
//
// THE VIEM PRIVATE-KEY TRAP (learned from the Rigor frontend, earned the hard
// way): createAccount() returns a viem account created via privateKeyToAccount().
// That object does NOT expose `.privateKey`. If you try to persist
// `account.privateKey` you store the string "undefined" and a brand-new address
// regenerates on every reload. The fix: WE generate the key with
// generatePrivateKey(), persist OUR copy, and restore the account by passing
// that key back into createAccount(key).

const PK_KEY = "aegis.identity.pk.v1";

export type GenAccount = ReturnType<typeof createAccount>;

export interface Identity {
  privateKey: `0x${string}`;
  address: `0x${string}`;
  account: GenAccount;
}

export function isValidPk(pk: string | null | undefined): pk is `0x${string}` {
  return !!pk && /^0x[0-9a-fA-F]{64}$/.test(pk);
}

/** Build an identity from a key WITHOUT persisting it (for live "Recovers: 0x…" previews). */
export function identityFromPk(pk: string): Identity {
  const account = createAccount(pk as `0x${string}`);
  return { privateKey: pk as `0x${string}`, address: account.address as `0x${string}`, account };
}

/** Preview the address a key would recover, or null if the key is malformed. */
export function addressFromPk(pk: string): string | null {
  try {
    return isValidPk(pk) ? identityFromPk(pk).address : null;
  } catch {
    return null;
  }
}

// Call only from the browser (inside useEffect) — never during render/SSR.
export function loadOrCreateIdentity(): Identity {
  const stored =
    typeof window !== "undefined" ? window.localStorage.getItem(PK_KEY) : null;
  if (isValidPk(stored)) {
    return identityFromPk(stored);
  }
  const fresh = generatePrivateKey();
  if (typeof window !== "undefined") window.localStorage.setItem(PK_KEY, fresh);
  return identityFromPk(fresh);
}

/** Persist an imported key and swap the active signer to it. */
export function importIdentity(pk: string): Identity {
  if (!isValidPk(pk)) {
    throw new Error("That doesn't look like a private key (needs 0x + 64 hex chars).");
  }
  if (typeof window !== "undefined") window.localStorage.setItem(PK_KEY, pk);
  return identityFromPk(pk);
}

/** Generate + persist a brand-new identity. The old address stays on-chain. */
export function resetIdentity(): Identity {
  const fresh = generatePrivateKey();
  if (typeof window !== "undefined") window.localStorage.setItem(PK_KEY, fresh);
  return identityFromPk(fresh);
}
