# Aegis — UX Flow

Three people use this product, each with one job to do. The frontend is
built as one dashboard rather than three separate apps because a real
marketplace buyer is often also an LP, and an agent operator is often also
a buyer for other agents — but each flow below is independent and doesn't
require the others.

## 1. Agent — get insurable

```
Connect wallet
      │
      ▼
Register (agent_id)  ──────────►  Bound permanently to this wallet.
                                    One address, one identity — cannot
                                    be re-registered under a second
                                    wallet, and cannot borrow another
                                    agent's track record.
      │
      ▼
Tier starts at "unrated"  ──────►  Improves automatically as jobs get
                                    insured and claims resolve cleanly.
                                    Nothing for the agent to do here —
                                    it's read off history, not requested.
```

There is deliberately no "apply for a higher tier" action. Tier is a
consequence of activity, not a request — this closes off gaming the
reputation system by asking for status rather than earning it.

## 1b. Agent — submit proof of delivery

```
Job finished
      │
      ▼
Submit deliverable (job_id, deliverable_hash)  ──►  Only the wallet bound
                                                       to this agent_id can
                                                       do this. Recorded
                                                       on-chain as what
                                                       this job's claim (if
                                                       any) will be judged
                                                       against.
```

This step exists because of a real bug an earlier version of this contract
had: letting the *buyer* supply the deliverable evidence when filing a
claim meant a dishonest buyer could point at unrelated content and
manufacture a breach verdict against an agent who delivered exactly what
was promised. Moving submission to the agent (the only party who can
truthfully attest to what they built) closes that off. If the agent never
submits anything and the deadline passes, the claim resolves as an
automatic breach — no evidence to fetch, nothing to judge.

## 2. Buyer — insure a job, and claim if it goes wrong

```
Connect wallet
      │
      ▼
Get a quote (agent_id, coverage amount)
      │   Premium is deterministic: coverage × tier rate. No negotiation,
      │   no waiting on a judgment call. Buyer sees the exact number
      │   before committing to anything.
      ▼
Issue policy (job_id, agent_id, coverage, spec_hash, deadline)
      │   Pays the exact quoted premium as the transaction value.
      │   The spec_hash pins down "what was promised" at issuance time —
      │   later immutable, so nobody can argue about it after the fact.
      ▼
   ┌──┴──┐
   │     │
  job   job
  goes  fails
  fine  spec
   │     │
   │     ▼
   │  (Meanwhile, on the agent's side: the agent submits their deliverable
   │   as a content-addressed hash — see flow 1b below. A claim can only
   │   ever be judged against what the agent themselves attested to
   │   delivering — the buyer cannot supply their own "evidence.")
   │     │
   │     ▼
   │  File a claim (job_id) + bond
   │     │   This is the one action that triggers GenLayer consensus.
   │     │   Validators fetch the spec and the agent-submitted deliverable
   │     │   and judge conformance independently — the UI shows a
   │     │   "waiting on validator consensus" state because this takes
   │     │   longer than an ordinary transaction, and a spinner alone
   │     │   would be misleading about what's actually happening. If the
   │     │   agent never submitted anything and the deadline has passed,
   │     │   there's nothing to judge — it's an automatic breach, no AI
   │     │   call needed.
   │     ▼
   │  Verdict renders as a stamp, not a status pill
   │     │   UPHELD  → payout sent, bond refunded, done.
   │     │   REJECTED → bond forfeited into the pool, done.
   │     │   The stamp visual exists because a claim outcome is a real,
   │     │   consequential decision — it should read like one, not like
   │     │   a toast notification that happens to carry money with it.
   │     ▼
   ▼   policy closed either way (single-use, no re-filing)
 policy expires unused, nothing to do
```

The buyer never sees or interacts with pool mechanics. Coverage is a
promise the buyer holds against the pool; which pool, how funded, that's
underwriting's problem, not the buyer's.

## 3. LP — underwrite a tier

```
Connect wallet
      │
      ▼
Check pool status (tier)  ──────►  Balance and outstanding shares,
                                    before committing capital.
      │
      ▼
Deposit (tier, amount)  ────────►  Mints shares proportional to the
                                    tier's current pool value. Depositing
                                    into an empty pool mints 1:1 — no
                                    guessing at a starting price.
      │
      ▼
Capital sits in the pool, earning premium yield passively as buyers
issue policies against agents in that tier, and absorbing payouts (capped
per claim) when claims are upheld.
      │
      ▼
Withdraw (tier, shares) ────────►  Redeems proportionally at current
                                    pool value — reflects any premiums
                                    earned or claims paid since deposit.
```

LPs choose *which tier* to fund, not which specific agent — this is
intentional. It keeps the underwriting decision at the right grain (risk
class, not individual reputation gambling) and matches how the premium
pricing itself works (tier-rate, not agent-specific negotiation).

## Why the interface is shaped like a dashboard of cards, not a wizard

None of these three flows are linear multi-step processes with required
ordering beyond what's structurally necessary (you must register before
you can be insured; you must issue a policy before you can claim against
it). Forcing all three into one guided wizard would mean an LP wades
through agent-registration copy to get to the one card they need. Instead:
one page, one card per action, grouped under the section that names who
it's for (Agent Registry / Underwriting Pools / Coverage / Claims) — anyone
can find their one action without narrative in the way.

## The one deliberately "raw" surface: evidence hashes

`spec_hash` and `deliverable_hash` are plain text inputs, not a file
upload or a guided pinning flow. This is an honest reflection of where the
product actually is: evidence sourcing (real IPFS pinning vs. a
demo-only HTTPS URL) is a decision the person filing has to make
correctly for the claim to resolve meaningfully, and hiding that behind a
polished upload button would create false confidence that the product has
solved a problem it hasn't yet. See the deploy/testing notes for the two
real options here.
