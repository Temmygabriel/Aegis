# Aegis — Intelligent Contract

Single-file GenLayer intelligent contract:
[`intelligent-contracts/aegis.py`](../intelligent-contracts/aegis.py)

**What it is:** non-performance insurance for the AI-agent marketplace. A buyer
pays a premium to insure a job against a specific agent; if the agent never
delivers, or the deliverable fails to meet the agreed spec, the buyer can file a
claim and (if upheld by GenLayer validator consensus) is paid from the
underwriting pool of that agent's tier.

Only one action is ever AI-judged: **claims**. Premium pricing, identity, LP
shares, and the deadline logic are all deterministic.

## The four moving parts

1. **Agent identity & reputation** — one wallet binds to one `agent_id` at
   registration. A tier (`unrated` / `bronze` / `silver` / `gold`) is derived
   from real history (insured jobs, distinct buyers, tenure) — never requested
   or self-declared.
2. **Policies** — a buyer pays an exact, deterministic premium (coverage × the
   agent's tier rate) to insure one `job_id` against a named agent for a
   deadline.
3. **LP pools** — LPs deposit native tokens into a tier and earn premiums.
   Per-claim payout is capped at **10% of that tier's pool**.
4. **Claims** — the buyer stakes a claim bond and the claim is judged by GenVM
   validator consensus: validators fetch the spec + the agent's submitted
   deliverable from IPFS, score conformance with an LLM, and vote.

## Public interface

### Write methods

| Method | Payable | Description |
|--------|---------|-------------|
| `register(agent_id)` | no | Bind the caller's wallet to `agent_id` (once). |
| `issue_policy(job_id, agent_id, coverage_atto, spec_hash, deadline_iso)` | yes | Pay the exact premium to insure `job_id` against the agent. |
| `submit_deliverable(job_id, deliverable_hash)` | no | The **insured agent** records their deliverable (IPFS CID). |
| `expire_policy(job_id)` | no | Buyer closes an expired policy, releasing locked exposure. |
| `deposit(tier)` | yes | LP adds capital to a tier pool. |
| `withdraw(tier, shares)` | no | LP redeems shares (blocked if it would leave the pool below its locked exposure). |
| `file_claim(job_id)` | yes | Buyer stakes `CLAIM_BOND_ATTO` and triggers judgement. |

### View methods

| Method | Description |
|--------|-------------|
| `get_profile(agent_id)` | Agent's display name, tier, counters, owner, registration time. |
| `agent_id_for_address(address)` | Reverse lookup of an agent by wallet. |
| `quote_premium(agent_id, coverage_atto)` | Exact premium + tier rate for a policy. |
| `get_policy(job_id)` | Status, coverage, deadline, deliverable hash. |
| `get_pool_info(tier)` | Pool balance, total shares, locked exposure. |
| `get_lp_position(tier, address)` | An LP's share count in a tier. |
| `get_claim_status(job_id)` | `none` / `pending` / `upheld` / `rejected`. |

## Key parameters

| Constant | Value | Meaning |
|----------|-------|---------|
| `CLAIM_BOND_ATTO` | 2 GEN | Bond a buyer stakes per claim (forfeited if the claim is rejected). |
| `BREACH_THRESHOLD` | 40 | Conformance score below this = breach. |
| `SCORE_TOLERANCE` | 15 | LLM answer is deterministic-confirmed within this tolerance. |
| `MAX_PAYOUT_BPS_OF_POOL` | 1000 | A single claim pays at most 10% of the tier pool. |
| `MIN_COVERAGE_ATTO` | 0.01 GEN | Minimum coverage per policy (cost floor for tier progress). |
| `RATE_BPS_BY_TIER` | unrated 600 / bronze 400 / silver 250 / gold 150 | Annualized premium basis points. |
| `MIN_DISTINCT_BUYERS_BY_TIER` | bronze 2 / silver 5 / gold 10 | Distinct buyer addresses needed to reach a tier. |
| `MIN_TENURE_DAYS_BY_TIER` | bronze 3 / silver 14 / gold 45 | Days since registration needed to reach a tier. |
| `EVIDENCE_GATEWAY` | `https://w3s.link/ipfs/` | IPFS gateway validators fetch evidence from. |

## Security hardening (why each is there)

Every hardening here was either required by an earlier review pass or discovered
during a direct-mode security review (2026-09-02) and fixed. Each is covered by a
regression test in `tests/direct/test_aegis.py`.

1. **Canonical identity keys.** `agent_id` / `job_id` are user-typed strings with
   no external registry. `_normalize_key()` lowercases + strips them before use as
   TreeMap keys, so a case variant can't squat another identity. As-typed text is
   kept separately for display.

2. **No empty-pool first-depositor exploit.** A policy can only be issued against
   a tier that already has real LP capital, and coverage can't exceed that tier's
   current pool value. Previously a premium could accumulate in a zero-share tier
   and the first LP deposit would mint 100% of the shares against pre-existing
   balance.

3. **LPs can't withdraw from under live coverage.** `tier_locked_exposure` tracks
   total live coverage; `withdraw()` refuses to drop a tier's balance below it.

4. **The buyer can't supply their own evidence.** Only the insured agent can call
   `submit_deliverable`. A buyer can never point a claim at arbitrary content.

5. **Evidence must be content-addressed.** `spec_hash` / `deliverable_hash` must
   look like an IPFS CID (not a mutable URL), so every validator fetches identical
   bytes. A mutable URL could be changed between the leader's fetch and a
   validator's independent re-fetch.

6. **Tier promotion can't be bought by one wallet.** Promotion needs a minimum
   real spend per job, a minimum count of **distinct** buyer addresses, and real
   elapsed tenure since registration. This raises the cost of a sybil scheme from
   minutes to weeks (it doesn't make sybil-proof — no on-chain contract can).

7. **Deadlines must be in the future.** A policy issued with an already-passed
   deadline used to let a buyer instantly claim the "no deliverable submitted"
   auto-breach — the agent had no chance to deliver, so a ~6% premium could buy a
   payout of up to 10% of the pool, repeatable with fresh `job_id`s to drain a tier
   or burn an honest agent's reputation in a single block. Now `issue_policy`
   reverts unless the deadline is strictly after the current block time.

8. **Claims are deterministic before they're AI.** The single-use gate, access
   control, bond, and deadline checks all run before any LLM call; validators
   independently re-derive the score rather than trusting the leader's output.

## Testing

- **Direct mode (fast, in-memory):** `python -m pytest tests/direct/test_aegis.py -v`
  — 26 tests covering every method plus the gaming vectors above.
- **On-chain smoke:** see [DEPLOYMENT.md](DEPLOYMENT.md) for the read/write
  verification run against both networks.
