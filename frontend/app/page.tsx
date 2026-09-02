"use client";

import { useState } from "react";
import {
  AEGIS_ADDRESS,
  NETWORK_NAME,
  CLAIM_BOND_ATTO,
  VALID_TIERS,
  Tier,
  connectWallet,
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
  toBig,
} from "@/lib/aegisClient";

function short(addr?: string) {
  if (!addr) return "";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/** A single-panel result box: shows a pending state, then the outcome or
 * error, so every action gets visible feedback without a global toast system. */
function ResultBox({
  state,
}: {
  state: { status: "idle" | "pending" | "done" | "error"; text?: string };
}) {
  if (state.status === "idle") return null;
  if (state.status === "pending") {
    return <div className="result">Submitting to network…</div>;
  }
  return (
    <div className={`result ${state.status === "error" ? "error" : ""}`}>
      {state.text}
    </div>
  );
}

type Result = { status: "idle" | "pending" | "done" | "error"; text?: string };
const idle: Result = { status: "idle" };

export default function Home() {
  const [address, setAddress] = useState<`0x${string}` | null>(null);
  const [connecting, setConnecting] = useState(false);

  // ---- Agent registry ----
  const [agentId, setAgentId] = useState("agent-alice");
  const [registerResult, setRegisterResult] = useState<Result>(idle);
  const [profileLookupId, setProfileLookupId] = useState("agent-alice");
  const [profileResult, setProfileResult] = useState<Result>(idle);

  // ---- LP pool ----
  const [depositTier, setDepositTier] = useState<Tier>("unrated");
  const [depositAmount, setDepositAmount] = useState("5");
  const [depositResult, setDepositResult] = useState<Result>(idle);
  const [poolLookupTier, setPoolLookupTier] = useState<Tier>("unrated");
  const [poolResult, setPoolResult] = useState<Result>(idle);

  // ---- Policy ----
  const [jobId, setJobId] = useState("job-001");
  const [policyAgentId, setPolicyAgentId] = useState("agent-alice");
  const [coverage, setCoverage] = useState("1");
  const [specHash, setSpecHash] = useState("");
  const [deadline, setDeadline] = useState("2026-12-31T00:00:00Z");
  const [quote, setQuote] = useState<{ tier: Tier; rate_bps: number; premium_atto: bigint } | null>(
    null
  );
  const [quoteResult, setQuoteResult] = useState<Result>(idle);
  const [issueResult, setIssueResult] = useState<Result>(idle);
  const [policyLookupId, setPolicyLookupId] = useState("job-001");
  const [policyResult, setPolicyResult] = useState<Result>(idle);

  // ---- Claim ----
  const [claimJobId, setClaimJobId] = useState("job-001");
  const [claimResult, setClaimResult] = useState<Result>(idle);
  const [claimStatusLookupId, setClaimStatusLookupId] = useState("job-001");
  const [claimStatus, setClaimStatus] = useState<string | null>(null);
  const [claimStatusResult, setClaimStatusResult] = useState<Result>(idle);

  // ---- Deliverable (agent-only) ----
  const [deliverJobId, setDeliverJobId] = useState("job-001");
  const [deliverableHash, setDeliverableHash] = useState("");
  const [deliverResult, setDeliverResult] = useState<Result>(idle);

  async function handleConnect() {
    setConnecting(true);
    try {
      const addr = await connectWallet();
      setAddress(addr);
    } catch (e: any) {
      alert(e.message ?? String(e));
    } finally {
      setConnecting(false);
    }
  }

  function requireWallet(): `0x${string}` {
    if (!address) throw new Error("Connect a wallet first.");
    return address;
  }

  return (
    <div className="shell">
      <div className="topbar">
        <div className="brand">
          <svg className="brand-logo" viewBox="0 0 64 64" aria-hidden="true">
            <rect width="64" height="64" rx="13" fill="#171c25" />
            <path
              d="M32 7.5 L55 14.5 V32.5 C55 45 46 53.8 32 57 C18 53.8 9 45 9 32.5 V14.5 Z"
              fill="#b9803f"
              stroke="#ede6d6"
              strokeWidth="1.5"
            />
            <path
              d="M21.5 33.5 L29 41 L43 24.5"
              fill="none"
              stroke="#10141b"
              strokeWidth="6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="brand-mark">Aegis</span>
          <span className="brand-sub">Agent Non-Performance Insurance</span>
        </div>
        <button
          className={`wallet-pill ${address ? "connected" : ""}`}
          onClick={address ? undefined : handleConnect}
          disabled={connecting}
        >
          {address ? short(address) : connecting ? "Connecting…" : "Connect Wallet"}
        </button>
      </div>

      {!AEGIS_ADDRESS && (
        <div className="result error" style={{ marginBottom: 32 }}>
          NEXT_PUBLIC_AEGIS_CONTRACT_ADDRESS is not set. Add it in your Vercel
          project's Environment Variables (or .env.local for local dev) and
          redeploy.
        </div>
      )}

      {/* ------------------------------------------------------------ Agents */}
      <div className="section-title">Agent Registry</div>
      <div className="grid">
        <div className="card">
          <h3 className="card-title">Register as an agent</h3>
          <p className="card-desc">
            Binds your connected wallet to one agent_id, permanently. One
            address, one identity — no reusing someone else's track record.
          </p>
          <div className="field">
            <label>Agent ID</label>
            <input value={agentId} onChange={(e) => setAgentId(e.target.value)} />
          </div>
          <button
            className="btn"
            disabled={registerResult.status === "pending"}
            onClick={async () => {
              try {
                setRegisterResult({ status: "pending" });
                const addr = requireWallet();
                const { hash } = await register(addr, agentId);
                setRegisterResult({ status: "done", text: `Registered.\ntx: ${hash}` });
              } catch (e: any) {
                setRegisterResult({ status: "error", text: e.message ?? String(e) });
              }
            }}
          >
            Register
          </button>
          <ResultBox state={registerResult} />
        </div>

        <div className="card">
          <h3 className="card-title">Look up a profile</h3>
          <p className="card-desc">
            Reputation tier, jobs insured, and claim history for any agent_id.
          </p>
          <div className="field">
            <label>Agent ID</label>
            <input
              value={profileLookupId}
              onChange={(e) => setProfileLookupId(e.target.value)}
            />
          </div>
          <button
            className="btn btn-quiet"
            onClick={async () => {
              try {
                setProfileResult({ status: "pending" });
                const p = await getProfile(profileLookupId);
                setProfileResult({
                  status: "done",
                  text: JSON.stringify(
                    p,
                    (_, v) => (typeof v === "bigint" ? v.toString() : v),
                    2
                  ),
                });
              } catch (e: any) {
                setProfileResult({ status: "error", text: e.message ?? String(e) });
              }
            }}
          >
            Look up
          </button>
          <ResultBox state={profileResult} />
        </div>
      </div>

      {/* --------------------------------------------------------- LP pools */}
      <div className="section-title">Underwriting Pools</div>
      <div className="grid">
        <div className="card">
          <h3 className="card-title">Deposit as an LP</h3>
          <p className="card-desc">
            Fund a tier's pool, earn premium yield, absorb its claims. Shares
            mint proportionally to that tier's current pool value.
          </p>
          <div className="row-2">
            <div className="field">
              <label>Tier</label>
              <select
                value={depositTier}
                onChange={(e) => setDepositTier(e.target.value as Tier)}
              >
                {VALID_TIERS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Amount (GEN)</label>
              <input value={depositAmount} onChange={(e) => setDepositAmount(e.target.value)} />
            </div>
          </div>
          <button
            className="btn"
            disabled={depositResult.status === "pending"}
            onClick={async () => {
              try {
                setDepositResult({ status: "pending" });
                const addr = requireWallet();
                const atto = parseGenToAtto(depositAmount);
                const { hash } = await deposit(addr, depositTier, atto);
                setDepositResult({ status: "done", text: `Deposited.\ntx: ${hash}` });
              } catch (e: any) {
                setDepositResult({ status: "error", text: e.message ?? String(e) });
              }
            }}
          >
            Deposit
          </button>
          <ResultBox state={depositResult} />
          <p className="hint">
            Withdraw with the same tier + a share amount from{" "}
            <code>get_lp_position</code> — not wired to a button here to keep
            this panel simple; call <code>withdraw(tier, shares)</code>{" "}
            directly via the contract if you need it back out.
          </p>
        </div>

        <div className="card">
          <h3 className="card-title">Pool status</h3>
          <p className="card-desc">A tier's current ledger balance and outstanding LP shares.</p>
          <div className="field">
            <label>Tier</label>
            <select
              value={poolLookupTier}
              onChange={(e) => setPoolLookupTier(e.target.value as Tier)}
            >
              {VALID_TIERS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <button
            className="btn btn-quiet"
            onClick={async () => {
              try {
                setPoolResult({ status: "pending" });
                const info = await getPoolInfo(poolLookupTier);
                setPoolResult({
                  status: "done",
                  text: `balance: ${formatAttoToGen(toBig(info.balance_atto))} GEN\nlocked (backing active coverage): ${formatAttoToGen(
                    toBig(info.locked_exposure_atto)
                  )} GEN\nshares: ${toBig(info.total_shares)}`,
                });
              } catch (e: any) {
                setPoolResult({ status: "error", text: e.message ?? String(e) });
              }
            }}
          >
            Check pool
          </button>
          <ResultBox state={poolResult} />
        </div>
      </div>

      {/* ---------------------------------------------------------- Policies */}
      <div className="section-title">Coverage</div>
      <div className="grid">
        <div className="card">
          <h3 className="card-title">Quote &amp; issue a policy</h3>
          <p className="card-desc">
            Premium is priced off the agent's current tier. Quote first — the
            contract requires the exact premium as the transaction value.
          </p>
          <div className="field">
            <label>Job ID</label>
            <input value={jobId} onChange={(e) => setJobId(e.target.value)} />
          </div>
          <div className="row-2">
            <div className="field">
              <label>Agent ID</label>
              <input
                value={policyAgentId}
                onChange={(e) => setPolicyAgentId(e.target.value)}
              />
            </div>
            <div className="field">
              <label>Coverage (GEN)</label>
              <input value={coverage} onChange={(e) => setCoverage(e.target.value)} />
            </div>
          </div>
          <div className="field">
            <label>Spec hash / URL (fetchable evidence for a future claim)</label>
            <input value={specHash} onChange={(e) => setSpecHash(e.target.value)} />
          </div>
          <div className="field">
            <label>Deadline (ISO)</label>
            <input value={deadline} onChange={(e) => setDeadline(e.target.value)} />
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            <button
              className="btn btn-quiet"
              onClick={async () => {
                try {
                  setQuoteResult({ status: "pending" });
                  const coverageAtto = parseGenToAtto(coverage);
                  const q = await quotePremium(policyAgentId, coverageAtto);
                  const premium = toBig(q.premium_atto);
                  setQuote({ tier: q.tier, rate_bps: q.rate_bps, premium_atto: premium });
                  setQuoteResult({
                    status: "done",
                    text: `tier: ${q.tier}\nrate: ${q.rate_bps} bps\npremium: ${formatAttoToGen(
                      premium
                    )} GEN`,
                  });
                } catch (e: any) {
                  setQuoteResult({ status: "error", text: e.message ?? String(e) });
                }
              }}
            >
              Get quote
            </button>
            <button
              className="btn"
              disabled={!quote || issueResult.status === "pending"}
              onClick={async () => {
                if (!quote) return;
                try {
                  setIssueResult({ status: "pending" });
                  const addr = requireWallet();
                  const coverageAtto = parseGenToAtto(coverage);
                  const { hash } = await issuePolicy(
                    addr,
                    jobId,
                    policyAgentId,
                    coverageAtto,
                    specHash,
                    deadline,
                    quote.premium_atto
                  );
                  setIssueResult({ status: "done", text: `Policy issued.\ntx: ${hash}` });
                } catch (e: any) {
                  setIssueResult({ status: "error", text: e.message ?? String(e) });
                }
              }}
            >
              Issue policy
            </button>
          </div>
          <ResultBox state={quoteResult} />
          <ResultBox state={issueResult} />
        </div>

        <div className="card">
          <h3 className="card-title">Look up a policy</h3>
          <p className="card-desc">Coverage, spec hash, tier, and status for a job_id.</p>
          <div className="field">
            <label>Job ID</label>
            <input value={policyLookupId} onChange={(e) => setPolicyLookupId(e.target.value)} />
          </div>
          <button
            className="btn btn-quiet"
            onClick={async () => {
              try {
                setPolicyResult({ status: "pending" });
                const p = await getPolicy(policyLookupId);
                setPolicyResult({
                  status: "done",
                  text: JSON.stringify(
                    { ...p, coverage_atto: formatAttoToGen(toBig(p.coverage_atto)) + " GEN" },
                    null,
                    2
                  ),
                });
              } catch (e: any) {
                setPolicyResult({ status: "error", text: e.message ?? String(e) });
              }
            }}
          >
            Look up
          </button>
          <ResultBox state={policyResult} />
        </div>
      </div>

      {/* -------------------------------------------------------------- Claims */}
      <div className="section-title">Claims</div>
      <div className="grid">
        <div className="card">
          <h3 className="card-title">Submit a deliverable (agent only)</h3>
          <p className="card-desc">
            Only the wallet registered as the insured agent can do this. This
            is the one thing a claim actually gets judged against — a buyer
            can never supply their own "evidence" of non-performance.
          </p>
          <div className="field">
            <label>Job ID</label>
            <input value={deliverJobId} onChange={(e) => setDeliverJobId(e.target.value)} />
          </div>
          <div className="field">
            <label>Deliverable — IPFS CID</label>
            <input
              value={deliverableHash}
              onChange={(e) => setDeliverableHash(e.target.value)}
              placeholder="Qm... or bafy..."
            />
          </div>
          <button
            className="btn"
            disabled={deliverResult.status === "pending"}
            onClick={async () => {
              try {
                setDeliverResult({ status: "pending" });
                const addr = requireWallet();
                const { hash } = await submitDeliverable(addr, deliverJobId, deliverableHash);
                setDeliverResult({ status: "done", text: `Submitted.\ntx: ${hash}` });
              } catch (e: any) {
                setDeliverResult({ status: "error", text: e.message ?? String(e) });
              }
            }}
          >
            Submit deliverable
          </button>
          <ResultBox state={deliverResult} />
          <p className="hint">
            Must be a real content-addressed CID, not a link — the contract
            rejects anything else so every validator judges the exact same
            bytes.
          </p>
        </div>

        <div className="card">
          <h3 className="card-title">File a claim</h3>
          <p className="card-desc">
            Requires a fixed bond of {formatAttoToGen(CLAIM_BOND_ATTO)} GEN,
            refunded if the claim is upheld, forfeited to the pool if
            rejected. Judged against whatever the agent submitted above — if
            nothing was submitted and the deadline has passed, that's an
            automatic breach with no AI call needed.
          </p>
          <div className="field">
            <label>Job ID</label>
            <input value={claimJobId} onChange={(e) => setClaimJobId(e.target.value)} />
          </div>
          <button
            className="btn"
            disabled={claimResult.status === "pending"}
            onClick={async () => {
              try {
                setClaimResult({ status: "pending", text: "Waiting on validator consensus — this can take longer than a normal transaction…" });
                const addr = requireWallet();
                const { hash } = await fileClaim(addr, claimJobId);
                setClaimResult({ status: "done", text: `Claim resolved.\ntx: ${hash}` });
              } catch (e: any) {
                setClaimResult({ status: "error", text: e.message ?? String(e) });
              }
            }}
          >
            File claim
          </button>
          <ResultBox state={claimResult} />
        </div>
      </div>

      <div className="grid" style={{ marginTop: 20 }}>
        <div className="card">
          <h3 className="card-title">Check a verdict</h3>
          <p className="card-desc">Look up how a filed claim resolved.</p>
          <div className="field">
            <label>Job ID</label>
            <input
              value={claimStatusLookupId}
              onChange={(e) => setClaimStatusLookupId(e.target.value)}
            />
          </div>
          <button
            className="btn btn-quiet"
            onClick={async () => {
              try {
                setClaimStatusResult({ status: "pending" });
                const status = await getClaimStatus(claimStatusLookupId);
                setClaimStatus(status);
                setClaimStatusResult({ status: "done" });
              } catch (e: any) {
                setClaimStatusResult({ status: "error", text: e.message ?? String(e) });
              }
            }}
          >
            Check status
          </button>
          {claimStatusResult.status === "error" && <ResultBox state={claimStatusResult} />}
          {claimStatus && (
            <div className="stamp-wrap">
              <span className={`stamp ${claimStatus}`}>
                {claimStatus === "unresolved" ? "No verdict yet" : claimStatus}
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="footnote">
        Contract: {AEGIS_ADDRESS ?? "not configured"} · Network: {NETWORK_NAME} ·
        Premiums, bonds, and coverage are quoted in exact GEN — the contract
        rejects any amount that doesn't match precisely.
      </div>
    </div>
  );
}
