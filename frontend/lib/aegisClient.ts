"use client";

import { createClient } from "genlayer-js";
import { studionet, testnetBradbury } from "genlayer-js/chains";
import { TransactionStatus, ExecutionResult } from "genlayer-js/types";
import type { GenAccount } from "./identity";

// ---------------------------------------------------------------------------
// Network selection
// ---------------------------------------------------------------------------
// Point the frontend at whichever network your contract is deployed on via
// NEXT_PUBLIC_AEGIS_NETWORK. Accepts the CLI-style dashed name or the
// genlayer-js Network string; anything else falls back to studionet.
const NETWORK_RAW = (process.env.NEXT_PUBLIC_AEGIS_NETWORK ?? "studionet").trim();
export const NETWORK_NAME: "studionet" | "testnetBradbury" =
  NETWORK_RAW === "testnet-bradbury" || NETWORK_RAW === "testnetBradbury"
    ? "testnetBradbury"
    : "studionet";
const CHAIN = NETWORK_NAME === "testnetBradbury" ? testnetBradbury : studionet;

// Contract address comes from Vercel env at build/runtime -- see .env.example.
// This is the one thing you change per deployment; nothing else in this file
// should need to change to point at a different Aegis deployment.
export const AEGIS_ADDRESS = process.env
  .NEXT_PUBLIC_AEGIS_CONTRACT_ADDRESS as `0x${string}` | undefined;

// Fixed contract constants (mirrors aegis.py -- keep these two in sync if the
// contract's constants ever change).
export const CLAIM_BOND_ATTO = 2n * 10n ** 18n;
export const VALID_TIERS = ["unrated", "bronze", "silver", "gold"] as const;
export type Tier = (typeof VALID_TIERS)[number];

/** Read-only client -- talks directly to the network's RPC, no wallet needed. */
export function getReadClient() {
  return createClient({ chain: CHAIN });
}

// Write client. The "account" here is a genlayer-js / viem *Account object*
// created in the browser from our own private key (see lib/identity.ts), NOT a
// MetaMask address -- GenLayer studionet transactions are signed locally and
// MetaMask cannot sign them. With the account passed into createClient there is
// no provider and no .connect() call: viem signs with the account's key and
// sends straight to the RPC.
export function getWriteClient(account: GenAccount) {
  return createClient({ chain: CHAIN, account });
}

function requireAddress(): `0x${string}` {
  if (!AEGIS_ADDRESS) {
    throw new Error(
      "NEXT_PUBLIC_AEGIS_CONTRACT_ADDRESS is not set. Add it as an environment " +
        "variable (see .env.example) and redeploy."
    );
  }
  return AEGIS_ADDRESS;
}

async function read<T = any>(functionName: string, args: any[] = []): Promise<T> {
  const client = getReadClient();
  return client.readContract({
    address: requireAddress(),
    functionName,
    args,
  }) as Promise<T>;
}

async function write(
  account: GenAccount,
  functionName: string,
  args: any[],
  value: bigint = 0n
): Promise<{ hash: `0x${string}`; result: any }> {
  const client = getWriteClient(account);
  const hash = await client.writeContract({
    address: requireAddress(),
    functionName,
    args,
    // genlayer-js requires `value` in writeContract's args type. Its own
    // implementation defaults it to 0n and signs value-0 transactions fine on
    // the local-account path (viem account, no MetaMask), so always pass it.
    value,
  });

  const receipt = await client.waitForTransactionReceipt({
    hash,
    status: TransactionStatus.FINALIZED,
  });

  if (receipt.txExecutionResultName === ExecutionResult.FINISHED_WITH_ERROR) {
    // Lifecycle status (FINALIZED) is not proof of success -- see
    // genlayer-cli.md. Surface the real failure instead of pretending it
    // worked.
    throw new Error(
      `Transaction finalized but execution failed. Check the receipt for ${hash} for details.`
    );
  }

  return { hash, result: receipt };
}

// ---------------------------------------------------------------------------
// Agent identity & reputation
// ---------------------------------------------------------------------------

export function register(account: GenAccount, agentId: string) {
  return write(account, "register", [agentId]);
}

export function getProfile(agentId: string) {
  return read<{
    owner: string;
    tier: Tier;
    jobs_insured: number | bigint;
    distinct_buyers: number | bigint;
    claims_filed_against: number | bigint;
    claims_upheld_against: number | bigint;
    registered_at: string;
  }>("get_profile", [agentId]);
}

export function agentIdForAddress(address: string) {
  return read<string>("agent_id_for_address", [address]);
}

// ---------------------------------------------------------------------------
// Policies
// ---------------------------------------------------------------------------

export function quotePremium(agentId: string, coverageAtto: bigint) {
  return read<{ tier: Tier; rate_bps: number; premium_atto: number | bigint }>(
    "quote_premium",
    [agentId, coverageAtto]
  );
}

export function issuePolicy(
  account: GenAccount,
  jobId: string,
  agentId: string,
  coverageAtto: bigint,
  specHash: string,
  deadlineIso: string,
  premiumAtto: bigint
) {
  return write(
    account,
    "issue_policy",
    [jobId, agentId, coverageAtto, specHash, deadlineIso],
    premiumAtto
  );
}

export function submitDeliverable(
  account: GenAccount,
  jobId: string,
  deliverableHash: string
) {
  return write(account, "submit_deliverable", [jobId, deliverableHash]);
}

export function expirePolicy(account: GenAccount, jobId: string) {
  return write(account, "expire_policy", [jobId]);
}

export function getPolicy(jobId: string) {
  return read<{
    buyer: string;
    agent_id: string;
    coverage_atto: number | bigint;
    spec_hash: string;
    deliverable_hash: string;
    deadline_iso: string;
    pool_tier: Tier;
    status: "active" | "claimed" | "expired";
  }>("get_policy", [jobId]);
}

// ---------------------------------------------------------------------------
// LP pools
// ---------------------------------------------------------------------------

export function deposit(account: GenAccount, tier: Tier, amountAtto: bigint) {
  return write(account, "deposit", [tier], amountAtto);
}

export function withdraw(account: GenAccount, tier: Tier, shares: bigint) {
  return write(account, "withdraw", [tier, shares]);
}

export function getPoolInfo(tier: Tier) {
  return read<{
    tier: Tier;
    balance_atto: number | bigint;
    total_shares: number | bigint;
    locked_exposure_atto: number | bigint;
  }>("get_pool_info", [tier]);
}

export function getLpPosition(tier: Tier, address: string) {
  return read<number | bigint>("get_lp_position", [tier, address]);
}

// ---------------------------------------------------------------------------
// Claims -- the one call that triggers GenLayer consensus
// ---------------------------------------------------------------------------

export function fileClaim(account: GenAccount, jobId: string) {
  return write(account, "file_claim", [jobId], CLAIM_BOND_ATTO);
}

export function getClaimStatus(jobId: string) {
  return read<"unresolved" | "upheld" | "rejected">("get_claim_status", [jobId]);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** The SDK may decode on-chain u256 values as either `number` or `bigint`
 * depending on size -- normalize to bigint before doing any math on them. */
export function toBig(value: number | bigint): bigint {
  return typeof value === "bigint" ? value : BigInt(Math.trunc(value));
}

/** Parses a decimal GEN string ("1.5") into exact atto (10^18) as a bigint,
 * without going through floating point. */
export function parseGenToAtto(input: string): bigint {
  const trimmed = input.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error(`Invalid amount: ${input}`);
  }
  const [whole, frac = ""] = trimmed.split(".");
  const paddedFrac = (frac + "0".repeat(18)).slice(0, 18);
  return BigInt(whole) * 10n ** 18n + BigInt(paddedFrac || "0");
}

/** Formats atto (bigint or number) back to a human GEN string for display. */
export function formatAttoToGen(atto: bigint | number, decimals = 6): string {
  const value = typeof atto === "bigint" ? atto : BigInt(Math.trunc(atto));
  const whole = value / 10n ** 18n;
  const frac = value % 10n ** 18n;
  const fracStr = frac.toString().padStart(18, "0").slice(0, decimals);
  return `${whole}.${fracStr}`;
}
