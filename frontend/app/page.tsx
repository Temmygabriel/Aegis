"use client";

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import {
  AEGIS_ADDRESS,
  NETWORK_NAME,
  CLAIM_BOND_ATTO,
  VALID_TIERS,
  Tier,
  register,
  getProfile,
  quotePremium,
  issuePolicy,
  submitDeliverable,
  getPolicy,
  deposit,
  withdraw,
  getPoolInfo,
  getLpPosition,
  fileClaim,
  getClaimStatus,
  parseGenToAtto,
  formatAttoToGen,
  RATE_BPS_BY_TIER,
  cleanContractError,
  toBig,
} from "@/lib/aegisClient";
import { useIdentity } from "@/app/providers";
import { IdentityBadge } from "@/components/IdentityBadge";
import type { GenAccount } from "@/lib/identity";

/* ------------------------------------------------------------------ utils */

const NET_LABEL = NETWORK_NAME === "testnetBradbury" ? "Testnet Bradbury" : "StudioNet";

const TIERS: Tier[] = [...VALID_TIERS];

const TIER_NAMES: Record<Tier, string> = {
  unrated: "Unrated",
  bronze: "Bronze",
  silver: "Silver",
  gold: "Gold",
};

/** Format atto-GEN to a tidy GEN string with trailing zeros trimmed. */
function gen(atto: bigint | number, decimals = 4): string {
  const s = formatAttoToGen(toBig(atto), decimals);
  return s.replace(/\.?0+$/, "") || "0";
}

/** Strip GenLayer error-classification prefixes before showing to a human. */
function errText(e: any): string {
  return cleanContractError(e?.message ?? String(e)).trim();
}

/* ------------------------------------------------------ live activity feed */

const FEED_KEY = "aegis.activity.v1";

type FeedEntry = {
  action: "register" | "deposit" | "issue" | "deliverable" | "claim" | "verdict";
  jobId?: string;
  agentId?: string;
  amount?: string; // formatted "X GEN" for the right-hand column
  tier?: string; // human tier name, e.g. "Unrated"
  verdict?: "upheld" | "rejected";
  ts: number;
};

function readFeed(): FeedEntry[] {
  try {
    const raw = localStorage.getItem(FEED_KEY);
    const arr = raw ? (JSON.parse(raw) as FeedEntry[]) : [];
    return Array.isArray(arr) ? arr.slice(0, 20) : [];
  } catch {
    return [];
  }
}

/** Record a confirmed on-chain write so the hero feed can show it. Fire-and-
 * forget: never throws, safe to call from any tab panel. */
function pushFeed(entry: Omit<FeedEntry, "ts">) {
  try {
    const next = [{ ...entry, ts: Date.now() }, ...readFeed()].slice(0, 20);
    localStorage.setItem(FEED_KEY, JSON.stringify(next));
    window.dispatchEvent(new Event("aegis:feed"));
  } catch {
    /* storage can be blocked (private windows) -- the app keeps working */
  }
}

type Notice =
  | { status: "idle" }
  | { status: "pending"; title: string; detail?: string }
  | { status: "ok" | "error"; title: string; detail?: string };

const idleNotice: Notice = { status: "idle" };

function Notice({ n, style }: { n: Notice; style?: CSSProperties }) {
  if (n.status === "idle") return null;
  const icon = n.status === "pending" ? "" : n.status === "ok" ? "✓" : "✕";
  const title =
    n.title ||
    (n.status === "pending"
      ? "Working…"
      : n.status === "ok"
        ? "Done"
        : "Something went wrong");
  return (
    <div className={`notice ${n.status}`} style={style} role="status">
      <span className="notice-icon">{icon}</span>
      <div className="notice-body">
        <div className="notice-title">{title}</div>
        {n.detail ? <div className="notice-detail">{n.detail}</div> : null}
      </div>
    </div>
  );
}

/** Last-N confirmed writes, persisted locally so the board survives reloads. */
function Feed() {
  const [entries, setEntries] = useState<FeedEntry[]>([]);

  useEffect(() => {
    const load = () => setEntries(readFeed());
    load();
    window.addEventListener("aegis:feed", load);
    return () => window.removeEventListener("aegis:feed", load);
  }, []);

  if (entries.length === 0) {
    return (
      <p className="feed-empty">
        Nothing yet. Every confirmed write lands here — register an agent, fund a
        pool, insure a job, file a claim.
      </p>
    );
  }

  return (
    <div className="feed">
      {entries.slice(0, 6).map((e, i) => (
        <div className="feed-item" key={`${e.ts}-${i}`}>
          <span className="feed-dot" style={{ background: feedDotColor(e) }} />
          <div className="feed-action">
            <FeedBody e={e} />
            <div className="feed-time">{timeAgo(e.ts)}</div>
          </div>
          {e.amount && <span className="feed-amount">{e.amount}</span>}
        </div>
      ))}
    </div>
  );
}

function timeAgo(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return `${h}h ago`;
}

function feedDotColor(e: FeedEntry): string {
  if (e.action === "verdict") {
    return e.verdict === "upheld"
      ? "var(--ok)"
      : e.verdict === "rejected"
        ? "var(--err)"
        : "var(--text-faint)";
  }
  switch (e.action) {
    case "register":
      return "var(--unrated)";
    case "deposit":
      return "var(--ok)";
    case "issue":
      return "var(--copper)";
    case "deliverable":
      return "var(--copper-bright)";
    case "claim":
    default:
      return "var(--text-faint)";
  }
}

function FeedBody({ e }: { e: FeedEntry }) {
  switch (e.action) {
    case "register":
      return (
        <span>
          Registered agent <b>{e.agentId}</b>
        </span>
      );
    case "deposit":
      return (
        <span>
          Funded the <b>{e.tier ?? "tier"}</b> pool as an LP
        </span>
      );
    case "issue":
      return (
        <span>
          Insured <b>{e.agentId}</b>&apos;s job <b>{e.jobId}</b>
        </span>
      );
    case "deliverable":
      return (
        <span>
          Deliverable recorded for job <b>{e.jobId}</b>
        </span>
      );
    case "claim":
      return (
        <span>
          Claim filed on job <b>{e.jobId}</b>
        </span>
      );
    case "verdict":
      return e.verdict === "upheld" ? (
        <span>
          Claim on <b>{e.jobId}</b> resolved <b>UPHELD</b> — buyer paid
        </span>
      ) : e.verdict === "rejected" ? (
        <span>
          Claim on <b>{e.jobId}</b> resolved <b>REJECTED</b> — bond forfeited
        </span>
      ) : (
        <span>
          Claim on <b>{e.jobId}</b> still open
        </span>
      );
  }
}

/** A physical ink stamp for a resolved claim — the one unmistakable element. */
function VerdictStamp({
  v,
  jobId,
  detail,
  amount,
}: {
  v: Verdict;
  jobId: string;
  detail: string;
  amount?: string;
}) {
  const cls = v === "upheld" ? "upheld" : v === "rejected" ? "rejected" : "";
  return (
    <div className={`verdict-card ${cls}`}>
      <div className={`stamp ${cls}`}>
        <div className="stamp-text">
          {v === "upheld" ? (
            <>
              UPHELD
              <br />✓
            </>
          ) : v === "rejected" ? (
            <>
              REJECTED
              <br />✕
            </>
          ) : (
            "OPEN"
          )}
        </div>
      </div>
      <div className="verdict-info">
        <div className="verdict-job mono">{jobId}</div>
        <div className="verdict-headline">{detail}</div>
      </div>
      {amount && (
        <div className="verdict-amount-col">
          <div className={`verdict-amount ${cls}`}>{amount}</div>
          <div className="verdict-amount-label">
            {v === "upheld" ? "paid to buyer" : "bond forfeited"}
          </div>
        </div>
      )}
    </div>
  );
}

/** Hero-left risk bars: each tier's pool balance as a share of TVL, with the
 * locked-exposure region drawn dark inside the fill. */
function TierBars({ pools, tvl }: { pools: Record<Tier, PoolSnap>; tvl: bigint }) {
  const configs: { tier: Tier; color: string; rate: string }[] = [
    { tier: "unrated", color: "var(--unrated)", rate: "6%" },
    { tier: "bronze", color: "var(--bronze)", rate: "4%" },
    { tier: "silver", color: "var(--silver)", rate: "2.5%" },
    { tier: "gold", color: "var(--gold)", rate: "1.5%" },
  ];

  return (
    <div className="tier-bars">
      {configs.map(({ tier, color, rate }) => {
        const p = pools[tier];
        const pct = tvl > 0n && p ? Number((p.balance * 100n) / tvl) : 0;
        const lockedPct = p && p.balance > 0n ? Number((p.locked * 100n) / p.balance) : 0;
        return (
          <div key={tier} className="tb-row">
            <span className="tb-label" style={{ color }}>
              {TIER_NAMES[tier]}
            </span>
            <div className="tb-track">
              <div className="tb-fill" style={{ width: `${pct}%`, background: color }}>
                {lockedPct > 0 && (
                  <div className="tb-locked" style={{ width: `${lockedPct}%` }} />
                )}
              </div>
            </div>
            <span className="tb-val">{p ? gen(p.balance, 1) : "—"} GEN</span>
            <span className="tb-rate" style={{ color }}>
              {rate}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Ticking elapsed-seconds readout for the long consensus waits. */
function Elapsed({ since }: { since: number }) {
  const [s, setS] = useState(0);
  useEffect(() => {
    if (!since) return;
    const id = setInterval(() => setS(Math.max(0, Math.round((Date.now() - since) / 1000))), 1000);
    return () => clearInterval(id);
  }, [since]);
  return <>{s}s</>;
}

/** One-line hint shown while a claim is waiting on validator consensus. */
function ConsensusPending({ since }: { since: number }) {
  if (!since) return null;
  return (
    <p className="hint" style={{ marginTop: 2 }}>
      Validators are independently re-fetching the spec and deliverable and
      scoring conformance. This typically takes 30–90 seconds. (
      <Elapsed since={since} /> elapsed)
    </p>
  );
}

type EnsureWallet = () => Promise<GenAccount>;

/* ------------------------------------------------ domain shapes from reads */

type Profile = {
  owner: string;
  tier: Tier;
  jobs_insured: number | bigint;
  distinct_buyers: number | bigint;
  claims_filed_against: number | bigint;
  claims_upheld_against: number | bigint;
  registered_at: string;
};

type PolicyInfo = {
  buyer: string;
  agent_id: string;
  coverage_atto: number | bigint;
  spec_hash: string;
  deliverable_hash: string;
  deadline_iso: string;
  pool_tier: Tier;
  status: "active" | "claimed" | "expired";
};

type Verdict = "unresolved" | "upheld" | "rejected";

type PolicyDisplayState = {
  label: string;
  cls: string; // css chip class
  action: string | null; // action-tip text, or null when nothing to do
};

/** Turn raw policy fields into a plain-language statement of where the job
 * stands. The contract only returns "active" until a claim resolves, so the
 * real signal is deliverable_hash + deadline vs now: an empty deliverable
 * past the deadline is an automatic breach the buyer can claim with no risk. */
function derivePolicyState(p: PolicyInfo): PolicyDisplayState {
  const hasDeliv = (p.deliverable_hash ?? "").trim().length > 0;
  const dl = Date.parse(p.deadline_iso);
  const pastDeadline = Number.isNaN(dl) ? false : dl <= Date.now();
  if (p.status === "claimed")
    return {
      label: "Paid out",
      cls: "claimed",
      action: "Verdict is final — the payout already left the pool.",
    };
  if (p.status === "expired")
    return { label: "Expired", cls: "expired", action: null };
  // status === "active":
  if (!hasDeliv && !pastDeadline)
    return { label: "Awaiting delivery", cls: "awaiting", action: null };
  if (!hasDeliv && pastDeadline)
    return {
      label: "Auto-breach available",
      cls: "breach",
      action:
        "No deliverable was submitted before the deadline — the clock has already decided. File a claim to collect; there is no bond risk.",
    };
  if (hasDeliv && !pastDeadline)
    return {
      label: "Deliverable submitted",
      cls: "submitted",
      action:
        "Only file a claim if the deliverable does not conform to the spec — a wrong claim is rejected and the bond is forfeited.",
    };
  return {
    label: "Ready to claim",
    cls: "ready",
    action: "Deadline passed with a deliverable on file. File a claim if it did not meet the spec.",
  };
}

/* ============================================================ AGENTS TAB */

function AgentsPanel({ ensureWallet }: { ensureWallet: EnsureWallet }) {
  const [agentId, setAgentId] = useState("agent-alice");
  const [regN, setRegN] = useState<Notice>(idleNotice);

  const [lookId, setLookId] = useState("agent-alice");
  const [prof, setProf] = useState<Profile | null>(null);
  const [profN, setProfN] = useState<Notice>(idleNotice);

  async function doRegister() {
    setRegN({ status: "pending", title: "Registering agent…" });
    try {
      const addr = await ensureWallet();
      const { hash } = await register(addr, agentId);
      setRegN({ status: "ok", title: "Agent registered", detail: `tx ${hash}` });
      pushFeed({ action: "register", agentId: agentId.trim() });
      setLookId(agentId);
      // Surface their own fresh profile straight away so "now what?" is
      // answerable at a glance instead of requiring another Look up click.
      try {
        const p = await getProfile(agentId);
        setProf(p);
      } catch {
        /* profile read is a bonus -- the registration is already confirmed */
      }
    } catch (e: any) {
      setRegN({ status: "error", title: "Registration failed", detail: errText(e) });
    }
  }

  async function doLookup() {
    setProfN({ status: "pending", title: "Reading profile from the ledger…" });
    try {
      const p = await getProfile(lookId);
      setProf(p);
      setProfN(idleNotice);
    } catch (e: any) {
      setProf(null);
      setProfN({ status: "error", title: "Lookup failed", detail: errText(e) });
    }
  }

  return (
    <div className="grid grid-gap-lg">
      <div className="panel">
        <div className="panel-head">
          <div>
            <h3 className="panel-title">Register an agent</h3>
            <p className="panel-desc">
              Binds your connected wallet to one <code>agent_id</code>, permanently.
              One address, one identity — a track record you can't start over to dodge
              bad claims.
            </p>
          </div>
        </div>
        <div className="field">
          <label htmlFor="agentId">Agent ID</label>
          <input id="agentId" className="input" value={agentId} onChange={(e) => setAgentId(e.target.value)} />
        </div>
        <div className="btn-row">
          <button className="btn btn-primary" disabled={regN.status === "pending"} onClick={doRegister}>
            {regN.status === "pending" ? "Registering…" : "Register agent"}
          </button>
        </div>
        <Notice n={regN} />
        {regN.status === "ok" && (
          <p className="hint" style={{ marginTop: -6 }}>
            Agent <b>{agentId}</b> is live, starting at tier <b>Unrated</b>. Share
            this agent ID with buyers so they can insure jobs against you. Your tier
            improves automatically as insured jobs and a clean claim history
            accumulate — no action required. Your profile is shown below.
          </p>
        )}
        <p className="hint">
          Buying cover for an unregistered agent won't work — a policy always points
          back at a real registered identity.
        </p>
      </div>

      <div className="panel">
        <div className="panel-head">
          <div>
            <h3 className="panel-title">Agent reputation</h3>
            <p className="panel-desc">
              Tier, jobs insured, and claim history. This is exactly what the premium
              engine prices off.
            </p>
          </div>
        </div>
        <div className="field">
          <label htmlFor="profId">Agent ID</label>
          <input id="profId" className="input" value={lookId} onChange={(e) => setLookId(e.target.value)} />
        </div>
        <div className="btn-row">
          <button className="btn btn-ghost" disabled={profN.status === "pending"} onClick={doLookup}>
            {profN.status === "pending" ? "Loading…" : "Look up"}
          </button>
        </div>
        <Notice n={profN} />

        {prof && (
          <div className="kv">
            <div>
              <span className="kv-label">Owner</span>
              <span className="kv-value mono">{prof.owner}</span>
            </div>
            <div>
              <span className="kv-label">Tier</span>
              <span className="kv-value">
                <span className={`tier-badge t-${prof.tier}`}>{TIER_NAMES[prof.tier]}</span>
              </span>
            </div>
            <div>
              <span className="kv-label">Jobs insured</span>
              <span className="kv-value">{toBig(prof.jobs_insured).toString()}</span>
            </div>
            <div>
              <span className="kv-label">Distinct buyers</span>
              <span className="kv-value">{toBig(prof.distinct_buyers).toString()}</span>
            </div>
            <div>
              <span className="kv-label">Claims against</span>
              <span className="kv-value">{toBig(prof.claims_filed_against).toString()}</span>
            </div>
            <div>
              <span className="kv-label">Upheld against</span>
              <span className="kv-value">{toBig(prof.claims_upheld_against).toString()}</span>
            </div>
            <div>
              <span className="kv-label">Registered</span>
              <span className="kv-value mono">{prof.registered_at}</span>
            </div>
          </div>
        )}
        {!prof && profN.status !== "error" && (
          <p className="hint">
            Enter an ID above and hit <b>Look up</b> — try{" "}
            <code>{lookId}</code> if you just registered it.
          </p>
        )}
      </div>
    </div>
  );
}

/* ============================================================== POOLS TAB */

function PoolsPanel({
  ensureWallet,
  refreshPools,
  identityReady,
}: {
  ensureWallet: EnsureWallet;
  refreshPools: () => Promise<void>;
  identityReady: boolean;
}) {
  const [depTier, setDepTier] = useState<Tier>("unrated");
  const [depAmount, setDepAmount] = useState("5");
  const [depN, setDepN] = useState<Notice>(idleNotice);

  const [stakeTier, setStakeTier] = useState<Tier>("unrated");
  const [position, setPosition] = useState<bigint | null>(null);
  const [stakeN, setStakeN] = useState<Notice>(idleNotice);
  const [withdrawN, setWithdrawN] = useState<Notice>(idleNotice);

  async function doDeposit() {
    setDepN({ status: "pending", title: "Depositing into the pool…" });
    try {
      const addr = await ensureWallet();
      const atto = parseGenToAtto(depAmount);
      const { hash } = await deposit(addr, depTier, atto);
      setDepN({ status: "ok", title: `Deposited ${gen(atto)} GEN to ${TIER_NAMES[depTier].toLowerCase()}`, detail: `tx ${hash}` });
      pushFeed({ action: "deposit", amount: `${gen(atto)} GEN`, tier: TIER_NAMES[depTier] });
      void refreshPools();
    } catch (e: any) {
      setDepN({ status: "error", title: "Deposit failed", detail: errText(e) });
    }
  }

  async function doLoadStake() {
    setPosition(null);
    setWithdrawN(idleNotice);
    setStakeN({ status: "pending", title: "Reading your stake…" });
    try {
      const acct = await ensureWallet();
      const shares = toBig(await getLpPosition(stakeTier, acct.address));
      setPosition(shares);
      if (shares === 0n) {
        setStakeN({ status: "ok", title: `No stake in ${TIER_NAMES[stakeTier].toLowerCase()}` });
      } else {
        setStakeN(idleNotice);
      }
    } catch (e: any) {
      setStakeN({ status: "error", title: "Couldn't read your position", detail: errText(e) });
    }
  }

  async function doWithdraw() {
    if (!position || position === 0n) return;
    setWithdrawN({ status: "pending", title: "Withdrawing…" });
    try {
      const addr = await ensureWallet();
      const { hash } = await withdraw(addr, stakeTier, position);
      setPosition(null);
      setWithdrawN({ status: "ok", title: `Withdrew your ${stakeTier} stake`, detail: `tx ${hash}` });
      void refreshPools();
    } catch (e: any) {
      setWithdrawN({ status: "error", title: "Withdrawal failed", detail: errText(e) });
    }
  }

  return (
    <div className="grid grid-gap-lg">
      <div className="panel">
        <div className="panel-head">
          <div>
            <h3 className="panel-title">Add liquidity</h3>
            <p className="panel-desc">
              Deposit GEN into a tier&apos;s pool. Your shares back active coverage and
              earn that tier&apos;s premiums — but they absorb its claims too.
            </p>
          </div>
        </div>
        <div className="form-2col">
          <div className="field">
            <label htmlFor="depTier">Tier</label>
            <select id="depTier" className="input" value={depTier} onChange={(e) => setDepTier(e.target.value as Tier)}>
              {TIERS.map((t) => (
                <option key={t} value={t}>
                  {TIER_NAMES[t]}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="depAmt">Amount (GEN)</label>
            <input id="depAmt" className="input" value={depAmount} onChange={(e) => setDepAmount(e.target.value)} />
          </div>
        </div>
        <div className="btn-row">
          <button className="btn btn-primary" disabled={depN.status === "pending"} onClick={doDeposit}>
            {depN.status === "pending" ? "Depositing…" : "Deposit"}
          </button>
        </div>
        <Notice n={depN} />
        <p className="hint">
          The wallet you connect must actually hold GEN on {NET_LABEL} — premium and
          deposits are real token transfers, not just gas. Amounts are matched to the
          atto (10⁻¹⁸), so what you type is exactly what moves.
        </p>
      </div>

      <div className="panel">
        <div className="panel-head">
          <div>
            <h3 className="panel-title">Your LP stake</h3>
            <p className="panel-desc">
              Shares are minted proportional to the pool at deposit time. See what you
              hold, then pull it back out.
            </p>
          </div>
        </div>
        <div className="form-2col">
          <div className="field">
            <label htmlFor="stakeTier">Tier</label>
            <select id="stakeTier" className="input" value={stakeTier} onChange={(e) => setStakeTier(e.target.value as Tier)}>
              {TIERS.map((t) => (
                <option key={t} value={t}>
                  {TIER_NAMES[t]}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Your shares</label>
            <input
              className="input"
              value={position === null ? (!identityReady ? "identity loading…" : "—") : position.toString()}
              readOnly
            />
          </div>
        </div>
        <div className="btn-row">
          <button
            className="btn btn-ghost"
            disabled={stakeN.status === "pending" || !identityReady}
            onClick={doLoadStake}
          >
            {stakeN.status === "pending"
              ? "Loading…"
              : !identityReady
                ? "Identity loading…"
                : position === null
                  ? "Load my stake"
                  : "Re-check"}
          </button>
          {position !== null && position > 0n && (
            <button className="btn btn-primary" disabled={withdrawN.status === "pending"} onClick={doWithdraw}>
              {withdrawN.status === "pending" ? "Withdrawing…" : "Withdraw all"}
            </button>
          )}
        </div>
        <Notice n={stakeN} />
        <Notice n={withdrawN} />
        {position !== null && position > 0n && (
          <p className="hint">
            Withdrawing converts your {position.toString()} shares back to GEN at the
            pool&apos;s current value and removes the backing they provided.
          </p>
        )}
      </div>
    </div>
  );
}

/* =========================================================== COVERAGE TAB */

function CoveragePanel({
  ensureWallet,
  onGoPools,
}: {
  ensureWallet: EnsureWallet;
  onGoPools: () => void;
}) {
  const [jobId, setJobId] = useState("job-001");
  const [covAgentId, setCovAgentId] = useState("agent-alice");
  const [coverage, setCoverage] = useState("1");
  const [specHash, setSpecHash] = useState("");
  const [deadline, setDeadline] = useState(() => {
    const d = new Date(Date.now() + 30 * 86400000);
    return d.toISOString().slice(0, 19) + "Z";
  });

  const [quote, setQuote] = useState<{ tier: Tier; rate_bps: number; premiumAtto: bigint } | null>(null);
  const [quoteN, setQuoteN] = useState<Notice>(idleNotice);
  const [issueN, setIssueN] = useState<Notice>(idleNotice);

  // Policy the buyer is about to pay for -- held for review before any money
  // moves. Nothing is sent until Confirm is clicked.
  const [review, setReview] = useState<null | {
    jobId: string;
    agentId: string;
    coverageAtto: bigint;
    specHash: string;
    deadline: string;
    premiumAtto: bigint;
    tier: Tier;
  }>(null);
  // Set when the quote succeeded but the agent's tier pool has no LP capital.
  const [needPool, setNeedPool] = useState<Tier | null>(null);

  const [polJob, setPolJob] = useState("job-001");
  const [pol, setPol] = useState<PolicyInfo | null>(null);
  const [polN, setPolN] = useState<Notice>(idleNotice);

  async function doQuote() {
    setQuote(null);
    setNeedPool(null);
    setQuoteN({ status: "pending", title: "Pricing the risk…" });
    try {
      const cov = parseGenToAtto(coverage);
      const q = await quotePremium(covAgentId, cov);
      const premiumAtto = toBig(q.premium_atto);
      setQuote({ tier: q.tier, rate_bps: Number(q.rate_bps), premiumAtto });
      // The quote-box below carries the "quote ready" readout now.
      setQuoteN(idleNotice);
    } catch (e: any) {
      setQuoteN({ status: "error", title: "Couldn't get a quote", detail: errText(e) });
    }
  }

  /** Quote-first + pool-gate, then hold the terms up for review. Nothing is
   * paid until the buyer hits Confirm, so a stale quote can never fire a tx
   * that the chain rejects for a wrong premium. */
  async function doIssue() {
    if (!quote) return;
    setReview(null);
    setNeedPool(null);
    setIssueN(idleNotice);
    try {
      const cov = parseGenToAtto(coverage);
      // Always re-quote at pay time: if the agent's tier just changed, the
      // premium shown for review is the current one, not a stale cache.
      const q = await quotePremium(covAgentId, cov);
      const freshPremium = toBig(q.premium_atto);
      const next = {
        jobId: jobId.trim(),
        agentId: covAgentId.trim(),
        coverageAtto: cov,
        specHash: specHash.trim(),
        deadline,
        premiumAtto: freshPremium,
        tier: q.tier,
      };
      setQuote({ tier: q.tier, rate_bps: Number(q.rate_bps), premiumAtto: freshPremium });
      // Empty-pool gate: issuing needs LP capital in the agent's tier pool.
      const pool = await getPoolInfo(q.tier);
      if (toBig(pool.balance_atto) === 0n) {
        setNeedPool(q.tier);
        setQuoteN(idleNotice);
        setIssueN({
          status: "error",
          title: `No underwriting capital in the ${TIER_NAMES[q.tier]} pool yet`,
          detail: `This policy can't be issued until an LP deposits into the ${TIER_NAMES[q.tier].toLowerCase()} pool.`,
        });
        return;
      }
      setIssueN(idleNotice);
      setReview(next);
    } catch (e: any) {
      setIssueN({ status: "error", title: "Couldn't prepare your policy", detail: errText(e) });
    }
  }

  /** Final, irreversible step -- only reachable from the review panel. */
  async function doConfirmIssue() {
    if (!review) return;
    setIssueN({ status: "pending", title: "Issuing policy on-chain…" });
    try {
      const addr = await ensureWallet();
      const { hash } = await issuePolicy(
        addr,
        review.jobId,
        review.agentId,
        review.coverageAtto,
        review.specHash,
        review.deadline,
        review.premiumAtto
      );
      setReview(null);
      setQuote(null);
      setQuoteN(idleNotice);
      setIssueN({ status: "ok", title: "Policy is live", detail: `tx ${hash}` });
      pushFeed({
        action: "issue",
        jobId: review.jobId,
        agentId: review.agentId,
        amount: `${gen(review.premiumAtto)} GEN`,
        tier: TIER_NAMES[review.tier],
      });
      setPolJob(review.jobId);
    } catch (e: any) {
      setIssueN({ status: "error", title: "Issue failed", detail: errText(e) });
    }
  }

  async function doPolicyLookup() {
    setPolN({ status: "pending", title: "Reading policy…" });
    try {
      const p = await getPolicy(polJob);
      setPol(p);
      setPolN(idleNotice);
    } catch (e: any) {
      setPol(null);
      setPolN({ status: "error", title: "Lookup failed", detail: errText(e) });
    }
  }

  return (
    <div className="grid grid-gap-lg">
      <div className="panel">
        <div className="panel-head">
          <div>
            <h3 className="panel-title">Quote &amp; buy cover</h3>
            <p className="panel-desc">
              A buyer protects a payout against an agent. The premium is set by the
              agent&apos;s tier and must be paid <em>exactly</em> as the transaction value —
              so always quote first, then issue.
            </p>
          </div>
        </div>
        <div className="field">
          <label htmlFor="covJob">Job ID</label>
          <input id="covJob" className="input" value={jobId} onChange={(e) => setJobId(e.target.value)} />
        </div>
        <div className="form-2col">
          <div className="field">
            <label htmlFor="covAgent">Agent ID</label>
            <input id="covAgent" className="input" value={covAgentId} onChange={(e) => setCovAgentId(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="covAmt">Coverage (GEN)</label>
            <input id="covAmt" className="input" value={coverage} onChange={(e) => setCoverage(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="specHash">Spec — IPFS CID of the job</label>
          <input
            id="specHash"
            className="input"
            value={specHash}
            onChange={(e) => setSpecHash(e.target.value)}
            placeholder="Qm…"
          />
          <p className="hint" style={{ marginTop: 2 }}>
            Pin your job spec to IPFS (e.g. via <code>web3.storage</code> or{" "}
            <code>ipfs add</code>) and paste the resulting CID here. It must start
            with <code>Qm</code> (CIDv0) or <code>bafy</code> (CIDv1) — a mutable
            URL is rejected so every validator fetches the same bytes.
          </p>
        </div>
        <div className="field">
          <label htmlFor="deadline">Deadline (ISO, must be in the future)</label>
          <input id="deadline" className="input" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
        </div>
        <div className="btn-row">
          <button className="btn btn-ghost" disabled={quoteN.status === "pending"} onClick={doQuote}>
            {quoteN.status === "pending" ? "Pricing…" : quote ? "Re-quote" : "Get quote"}
          </button>
        </div>
        <Notice n={quoteN} />

        {quote && !review && (
          <div className="quote-box">
            <div className="quote-premium">
              <div className="quote-premium-label">Premium due</div>
              <div className="quote-premium-val">
                {gen(quote.premiumAtto)}
                <span>GEN</span>
              </div>
              <div className="quote-premium-sub">
                {TIER_NAMES[quote.tier]} tier · {quote.rate_bps / 100}% of coverage
              </div>
            </div>
            {!needPool ? (
              <button
                className="btn btn-primary"
                disabled={issueN.status === "pending"}
                onClick={doIssue}
              >
                {issueN.status === "pending"
                  ? "Issuing…"
                  : `Review & pay ${gen(quote.premiumAtto)} GEN`}
              </button>
            ) : (
              <div className="quote-cta">
                <button className="btn btn-ghost btn-sm" onClick={onGoPools}>
                  Fund the {TIER_NAMES[needPool].toLowerCase()} pool as an LP
                </button>
              </div>
            )}
          </div>
        )}
        <Notice n={issueN} />

        {review && (
          <div className="review">
            <div className="review-title">Review your policy</div>
            <div className="kv">
              <div>
                <span className="kv-label">Job ID</span>
                <span className="kv-value mono">{review.jobId}</span>
              </div>
              <div>
                <span className="kv-label">Agent</span>
                <span className="kv-value mono">{review.agentId}</span>
              </div>
              <div>
                <span className="kv-label">Tier / rate</span>
                <span className="kv-value">
                  <span className={`tier-badge t-${review.tier}`}>{TIER_NAMES[review.tier]}</span>{" "}
                  {RATE_BPS_BY_TIER[review.tier] / 100}% of coverage
                </span>
              </div>
              <div>
                <span className="kv-label">Coverage</span>
                <span className="kv-value">{gen(review.coverageAtto)} GEN</span>
              </div>
              <div>
                <span className="kv-label">Premium (paid now)</span>
                <span className="kv-value">{gen(review.premiumAtto)} GEN</span>
              </div>
              <div>
                <span className="kv-label">Deadline</span>
                <span className="kv-value mono">{review.deadline}</span>
              </div>
              <div>
                <span className="kv-label">Spec</span>
                <span className="kv-value mono">{review.specHash || "—"}</span>
              </div>
            </div>
            <div className="btn-row" style={{ marginTop: 4 }}>
              <button
                className="btn btn-primary"
                disabled={issueN.status === "pending"}
                onClick={doConfirmIssue}
              >
                {issueN.status === "pending"
                  ? "Issuing…"
                  : `Confirm & pay ${gen(review.premiumAtto)} GEN`}
              </button>
              <button
                className="btn btn-ghost"
                disabled={issueN.status === "pending"}
                onClick={() => setReview(null)}
              >
                Edit
              </button>
            </div>
            <p className="hint">
              Confirm sends the exact premium shown. A job can only be insured once
              and this can&apos;t be undone — use Edit to change the terms above.
            </p>
          </div>
        )}
      </div>

      <div className="panel">
        <div className="panel-head">
          <div>
            <h3 className="panel-title">Inspect a policy</h3>
            <p className="panel-desc">Coverage, spec, deadline, and current status of any job.</p>
          </div>
        </div>
        <div className="field">
          <label htmlFor="polJob">Job ID</label>
          <input id="polJob" className="input" value={polJob} onChange={(e) => setPolJob(e.target.value)} />
        </div>
        <div className="btn-row">
          <button className="btn btn-ghost" disabled={polN.status === "pending"} onClick={doPolicyLookup}>
            {polN.status === "pending" ? "Loading…" : "Look up"}
          </button>
        </div>
        <Notice n={polN} />

        {pol && (
          <>
            <div className="kv">
            <div>
              <span className="kv-label">Status</span>
              <span className="kv-value">
                <span className={`chip ${derivePolicyState(pol).cls}`}>
                  {derivePolicyState(pol).label}
                </span>
              </span>
            </div>
            <div>
              <span className="kv-label">Agent</span>
              <span className="kv-value mono">{pol.agent_id}</span>
            </div>
            <div>
              <span className="kv-label">Buyer</span>
              <span className="kv-value mono">{pol.buyer}</span>
            </div>
            <div>
              <span className="kv-label">Pool tier</span>
              <span className="kv-value">
                <span className={`tier-badge t-${pol.pool_tier}`}>{TIER_NAMES[pol.pool_tier]}</span>
              </span>
            </div>
            <div>
              <span className="kv-label">Coverage</span>
              <span className="kv-value">{gen(pol.coverage_atto)} GEN</span>
            </div>
            <div>
              <span className="kv-label">Spec hash</span>
              <span className="kv-value mono">{pol.spec_hash || "—"}</span>
            </div>
            <div>
              <span className="kv-label">Deliverable</span>
              <span className="kv-value mono">{pol.deliverable_hash || "not submitted yet"}</span>
            </div>
            <div>
              <span className="kv-label">Deadline</span>
              <span className="kv-value mono">{pol.deadline_iso}</span>
            </div>
          </div>
          {derivePolicyState(pol).action && (
            <p className="action-tip">💡 {derivePolicyState(pol).action}</p>
          )}
          </>
        )}
        {!pol && polN.status !== "error" && (
          <p className="hint">
            Submitted a deliverable? It shows here. A policy with no deliverable and a
            passed deadline is an automatic breach — no AI needed, the clock decides.
          </p>
        )}
      </div>
    </div>
  );
}

/* ============================================================= CLAIMS TAB */

function ClaimsPanel({ ensureWallet }: { ensureWallet: EnsureWallet }) {
  // -- deliverable (agent side)
  const [dJobId, setDJobId] = useState("job-001");
  const [dHash, setDHash] = useState("");
  const [dN, setDN] = useState<Notice>(idleNotice);

  // -- claim (buyer side)
  const [cJobId, setCJobId] = useState("job-001");
  const [cN, setCN] = useState<Notice>(idleNotice);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  // When a claim started waiting on validator consensus (epoch ms) -- drives
  // the ticking "what are the validators doing" hint.
  const [cSince, setCSince] = useState<number | null>(null);

  // -- verdict check
  const [vJobId, setVJobId] = useState("job-001");
  const [vResult, setVResult] = useState<Verdict | null>(null);
  const [vN, setVN] = useState<Notice>(idleNotice);

  async function doDeliver() {
    setDN({ status: "pending", title: "Submitting deliverable…" });
    try {
      const addr = await ensureWallet();
      const { hash } = await submitDeliverable(addr, dJobId, dHash);
      setDN({ status: "ok", title: "Deliverable recorded", detail: `tx ${hash}` });
      pushFeed({ action: "deliverable", jobId: dJobId.trim() });
    } catch (e: any) {
      setDN({ status: "error", title: "Submission failed", detail: errText(e) });
    }
  }

  async function doFileClaim() {
    setVerdict(null);
    setCN({ status: "pending", title: "Filing claim — waiting on validator consensus…" });
    setCSince(Date.now());
    try {
      const addr = await ensureWallet();
      const { hash } = await fileClaim(addr, cJobId);
      setCSince(null);
      setCN({ status: "ok", title: "Claim finalized", detail: `tx ${hash}` });
      pushFeed({ action: "claim", jobId: cJobId.trim() });
      try {
        const v = (await getClaimStatus(cJobId)) as Verdict;
        setVerdict(v);
        setCN(idleNotice); // the verdict stamp below says it all
        if (v !== "unresolved")
          pushFeed({ action: "verdict", jobId: cJobId.trim(), verdict: v });
      } catch {
        /* verdict read is a bonus; the tx result already matters */
      }
    } catch (e: any) {
      setCSince(null);
      setCN({ status: "error", title: "Claim failed", detail: errText(e) });
    }
  }

  async function doCheckVerdict() {
    setVN({ status: "pending", title: "Checking verdict…" });
    try {
      const v = (await getClaimStatus(vJobId)) as Verdict;
      setVResult(v);
      setVN(idleNotice);
    } catch (e: any) {
      setVResult(null);
      setVN({ status: "error", title: "Check failed", detail: errText(e) });
    }
  }

  const verdictText: Record<Verdict, string> = {
    upheld: "Claim upheld — buyer gets paid from the pool",
    rejected: "Claim rejected — bond forfeited to the pool",
    unresolved: "No verdict yet — still open for review",
  };

  return (
    <div className="grid grid-gap-lg">
      <div className="group-label">
        <span>Agent actions</span>
      </div>
      <div className="panel">
        <div className="panel-head">
          <div>
            <h3 className="panel-title">Submit a deliverable</h3>
            <p className="panel-desc">
              <em>Agent only.</em> Only the wallet registered as the insured agent can do
              this. It&apos;s the one thing a claim is judged against — a buyer can never
              write their own &quot;proof&quot; of non-performance.
            </p>
          </div>
        </div>
        <div className="form-2col">
          <div className="field">
            <label htmlFor="dJob">Job ID</label>
            <input id="dJob" className="input" value={dJobId} onChange={(e) => setDJobId(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="dHash">Deliverable — IPFS CID</label>
            <input
              id="dHash"
              className="input"
              value={dHash}
              onChange={(e) => setDHash(e.target.value)}
              placeholder="Qm… or bafy…"
            />
          </div>
        </div>
        <div className="btn-row">
          <button className="btn btn-primary" disabled={dN.status === "pending"} onClick={doDeliver}>
            {dN.status === "pending" ? "Submitting…" : "Submit deliverable"}
          </button>
        </div>
        <Notice n={dN} />
        <p className="hint">
          Must be a real content-addressed CID, not a link — the contract rejects
          anything else so every validator judges the exact same bytes.
        </p>
      </div>

      <div className="group-label">
        <span>Buyer actions</span>
      </div>
      <div className="panel">
        <div className="panel-head">
          <div>
            <h3 className="panel-title">File a claim</h3>
            <p className="panel-desc">
              Needs a fixed {gen(CLAIM_BOND_ATTO)} GEN bond — refunded if you&apos;re right,
              forfeited to the pool if you&apos;re wrong. Validators judge it against the
              submitted deliverable.
            </p>
          </div>
        </div>
        <div className="field">
          <label htmlFor="cJob">Job ID</label>
          <input id="cJob" className="input" value={cJobId} onChange={(e) => setCJobId(e.target.value)} />
        </div>
        <div className="btn-row">
          <button className="btn btn-primary" disabled={cN.status === "pending"} onClick={doFileClaim}>
            {cN.status === "pending" ? "Waiting on consensus…" : `File claim (bond ${gen(CLAIM_BOND_ATTO)} GEN)`}
          </button>
        </div>
        <Notice n={cN} />
        {cN.status === "pending" && cSince && <ConsensusPending since={cSince} />}
        {verdict && (
          <VerdictStamp v={verdict} jobId={cJobId.trim()} detail={verdictText[verdict]} />
        )}
      </div>

      <div className="panel">
        <div className="panel-head">
          <div>
            <h3 className="panel-title">Check any verdict</h3>
            <p className="panel-desc">How did a past claim resolve? No wallet needed for reads.</p>
          </div>
        </div>
        <div className="field">
          <label htmlFor="vJob">Job ID</label>
          <input id="vJob" className="input" value={vJobId} onChange={(e) => setVJobId(e.target.value)} />
        </div>
        <div className="btn-row">
          <button className="btn btn-ghost" disabled={vN.status === "pending"} onClick={doCheckVerdict}>
            {vN.status === "pending" ? "Checking…" : "Check verdict"}
          </button>
        </div>
        <Notice n={vN} />
        {vResult && (
          <VerdictStamp v={vResult} jobId={vJobId.trim()} detail={verdictText[vResult]} />
        )}
      </div>
    </div>
  );
}

/* ================================================================ PAGE === */

type PoolSnap = { balance: bigint; locked: bigint; shares: bigint } | null;
type TabKey = "agents" | "pools" | "coverage" | "claims";

const TABS: { key: TabKey; label: string }[] = [
  { key: "agents", label: "Agents" },
  { key: "pools", label: "Pools" },
  { key: "coverage", label: "Coverage" },
  { key: "claims", label: "Claims" },
];

export default function Home() {
  const { identity, ready } = useIdentity();
  const [tab, setTab] = useState<TabKey>("agents");

  const [pools, setPools] = useState<Record<Tier, PoolSnap>>({
    unrated: null,
    bronze: null,
    silver: null,
    gold: null,
  });
  const [poolsBusy, setPoolsBusy] = useState(true);
  const [poolsError, setPoolsError] = useState<string | null>(null);
  // Epoch ms of the last successful pool load -- drives the "Updated …" stamp
  // next to Refresh (item 19 of the UX review).
  const [lastRefreshed, setLastRefreshed] = useState<number | null>(null);
  // Flips after loadPools has been running >10s, so a flaky network reads as
  // "slow", not as a hung "…" (StudioNet is documented flaky).
  const [poolsSlow, setPoolsSlow] = useState(false);

  const loadPools = useCallback(async () => {
    setPoolsBusy(true);
    setPoolsError(null);
    const next: Record<Tier, PoolSnap> = { unrated: null, bronze: null, silver: null, gold: null };
    for (const t of TIERS) {
      try {
        const i = await getPoolInfo(t);
        next[t] = {
          balance: toBig(i.balance_atto),
          locked: toBig(i.locked_exposure_atto),
          shares: toBig(i.total_shares),
        };
      } catch (e: any) {
        setPoolsError(errText(e));
      }
    }
    setPools(next);
    setLastRefreshed(Date.now());
    setPoolsBusy(false);
  }, []);

  useEffect(() => {
    void loadPools();
  }, [loadPools]);

  // 10s stall guard for the hero stat card.
  useEffect(() => {
    if (!poolsBusy) {
      setPoolsSlow(false);
      return;
    }
    const id = setTimeout(() => setPoolsSlow(true), 10_000);
    return () => clearTimeout(id);
  }, [poolsBusy]);

  const ensureWallet = useCallback(async (): Promise<GenAccount> => {
    if (!ready || !identity) {
      throw new Error("Identity isn't ready yet — give it a second and try again.");
    }
    return identity.account;
  }, [identity, ready]);

  const tvl = TIERS.reduce((acc, t) => {
    const p = pools[t];
    return acc + (p ? p.balance : 0n);
  }, 0n);

  const loaded = TIERS.filter((t) => pools[t] !== null).length;

  return (
    <div className="shell">
      {/* ----------------------------------------------------------- topbar */}
      <header className="topbar">
        <div className="brand">
          <svg className="brand-logo" viewBox="0 0 64 64" aria-hidden="true">
            <defs>
              <linearGradient id="aegisCopper" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#f4b877" />
                <stop offset="1" stopColor="#c8752f" />
              </linearGradient>
            </defs>
            <path
              d="M32 5 L57 12.5 V31 C57 45.5 46.6 55.2 32 59 C17.4 55.2 7 45.5 7 31 V12.5 Z"
              fill="none"
              stroke="url(#aegisCopper)"
              strokeWidth="3"
            />
            <path
              d="M32 13 L51 18.8 V31 C51 42 42.8 49.6 32 53 C21.2 49.6 13 42 13 31 V18.8 Z"
              fill="rgba(217,142,69,0.14)"
            />
            <path
              d="M21.5 33.5 L29 41 L43.5 23.5"
              fill="none"
              stroke="#f4b877"
              strokeWidth="5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <div className="brand-meta">
            <span className="brand-mark">Aegis</span>
          </div>
        </div>
        <div className="top-actions">
          <span className="net-pill">
            <span className="dot" />
            {NET_LABEL}
          </span>
          <IdentityBadge />
        </div>
      </header>

      {!AEGIS_ADDRESS && (
        <div style={{ margin: "18px 0 0" }}>
          <Notice
            n={{
              status: "error",
              title: "Contract address not set",
              detail: "Add NEXT_PUBLIC_AEGIS_CONTRACT_ADDRESS (see .env.example) and redeploy on Vercel.",
            }}
          />
        </div>
      )}

      {/* ------------------------------------------------------------ hero */}
      <section className="hero">
        <div className="hero-lead">
          <p className="eyebrow">GenLayer · autonomous insurance ledger</p>
          <h1>
            Insure the work, <em>not the promise.</em>
          </h1>
          <p className="hero-addr">
            <b>Contract</b> {AEGIS_ADDRESS ?? "not configured"}
            {AEGIS_ADDRESS && <> · {NET_LABEL} · non-performance insurance for agent work</>}
          </p>
        </div>

        <div className="hero-board">
          <div className="panel hero-left">
            <div className="board-head">
              <span className="board-title">Underwriting pools</span>
              <span className="board-tools">
                {lastRefreshed !== null && !poolsBusy && (
                  <span className="ts-note">
                    Updated {new Date(lastRefreshed).toLocaleTimeString()}
                  </span>
                )}
                <button className="btn btn-ghost btn-sm" onClick={loadPools} disabled={poolsBusy}>
                  {poolsBusy ? "Refreshing…" : "Refresh"}
                </button>
              </span>
            </div>

            {poolsError && (
              <Notice
                n={{ status: "error", title: "Some pools are unreachable", detail: poolsError }}
                style={{ marginBottom: 4 }}
              />
            )}

            <TierBars pools={pools} tvl={tvl} />

            <div className="risk-foot">
              <span>
                {poolsSlow
                  ? "Network looks slow — hit Refresh when it settles."
                  : poolsBusy
                    ? "Reading live pool state…"
                    : `${loaded} of 4 tiers live · ${gen(tvl, 2)} GEN pooled`}
              </span>
              {!poolsBusy && loaded === 4 && (
                <span>a breach pays from the tier pool that backed it</span>
              )}
            </div>
          </div>

          <div className="panel hero-right">
            <div className="board-head">
              <span className="board-title">Live activity</span>
            </div>
            <Feed />
          </div>
        </div>
      </section>

      {/* -------------------------------------------- pool tiles removed here
          (the redesign moved pool state into the hero-left TierBars board;
           Pools tab below still owns the deposit/withdraw workflow) */}

      {/* ------------------------------------------------------------ tabs */}
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            className={`tab ${tab === t.key ? "active" : ""}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className={`tabpane ${tab === "agents" ? "active" : ""}`}>
        <AgentsPanel ensureWallet={ensureWallet} />
      </div>
      <div className={`tabpane ${tab === "pools" ? "active" : ""}`}>
        <PoolsPanel ensureWallet={ensureWallet} refreshPools={loadPools} identityReady={ready} />
      </div>
      <div className={`tabpane ${tab === "coverage" ? "active" : ""}`}>
        <CoveragePanel ensureWallet={ensureWallet} onGoPools={() => setTab("pools")} />
      </div>
      <div className={`tabpane ${tab === "claims" ? "active" : ""}`}>
        <ClaimsPanel ensureWallet={ensureWallet} />
      </div>

      {/* --------------------------------------------------------- footnote */}
      <footer className="footnote">
        Premiums, bonds, and coverage are quoted in exact GEN — the contract rejects any
        amount that doesn&apos;t match precisely. Wallet transactions need GEN on this
        network; reads (tiles, lookups, verdicts) work without one.
      </footer>
    </div>
  );
}
