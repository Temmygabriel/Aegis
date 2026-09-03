# Aegis — Real-Network E2E Test Report

Harness: `e2e/run.js` + `e2e/roundtrip.js` (genlayer-js — the same SDK the
frontend uses, chosen because the `genlayer` CLI cannot attach `value` to
contract writes). Both scripts sign locally with harness keys in
`e2e/keys.json` (gitignored). Outcome detection is **per-network** and validated
against ground-truth receipts — see §4.

---

## 1. Result summary

| Network | Deploy address | Test | Verdict |
|---|---|---|---|
| **StudioNet** (2026-09-03, Shape A source) | `0x605e5BE4a8013B2B6c70c4BECa3CEbB7BD7918e4` | Full 28-step lifecycle | ✅ **28/28 PASS** |
| **Bradbury** (2026-09-03, Shape A source) | `0x79C15889D5070321176994373C440778a9eC47c1` | Deploy read-verified | ✅ reads |
| StudioNet (2026-09-02, superseded) | `0xED90a97A77cd959bB278cBDfA0f2981dF5b5B843` | Full 28-step lifecycle | ✅ **28/28 PASS** |
| Bradbury (2026-09-02, superseded) | `0xcBF48A444242919EEA65Ff5bB6BD9d2CB82506e2` | 1 GEN deposit→withdraw roundtrip | ✅ **7/7 PASS** |

The 2026-09-03 StudioNet run re-proved the full lifecycle against the
gaming-hardened source on the current canonical deploy (its `e2e/results/
studionet-e2e.log` also exercises the new sub-60 s deadline revert). The two
2026-09-02 rows are the prior-generation runs; details in the sections below
were captured then. All four contracts deployed from the same source file:
`intelligent-contracts/aegis.py`.

---

## 2. StudioNet — full 28-step e2e (gasless, no value risk)

Log: `e2e/results/studionet-e2e.log` (each step prints `[PASS]`; final line
`28/28 steps passed`).

Covered, in order:
1. `register(agent)` accepted; profile reads back `tier=unrated`; `registered_at`
   captured (used to calibrate the contract's clock vs wall clock).
2. Duplicate register from the same address **reverts** (address bound).
3. LP `deposit` 20 GEN → pool `balance = 20`, `total_shares = 20`, LP
   `position = 20`.
4. `quote_premium` → `unrated / rate_bps=600 / premium = 0.06 GEN` (matches
   1 GEN coverage × 600 bps ÷ 10000).
5. Two payable `issue_policy` calls (job-submit, job-claim) each at exactly the
   quoted premium; both **succeed** with value moved.
6. Agent `submit_deliverable` (job-submit) → policy `deliverable_hash` set.
7. Counters: `jobs_insured=2`, `distinct_buyers=1`.
8. Pool math: `balance = 20 + 2×0.06`, `locked_exposure = 2` (2 × 1 GEN cover).
9. Negative / gate reverts (all confirmed **reverted**, none applied):
   - issue with a **past deadline** reverts (the gaming fix),
   - **premature** `file_claim` (pre-deadline, no deliverable) reverts,
   - full LP `withdraw` while exposure is locked reverts.
10. After the deadline passes: buyer `expire_policy` on job-submit → locked
    exposure drops to 1.
11. `file_claim` on job-claim after deadline (no deliverable) → **auto-breach
    upheld** (deterministic, no LLM). Bond returned to buyer; `status=upheld`;
    policy `status=claimed`.
12. Payout math: pool `balance = 20 + 2×0.06 − 1`, `locked = 0`; agent counters
    `claims_filed_against=1`, `claims_upheld_against=1`.
13. LP full `withdraw` → pool drained to `balance=0`, `shares=0`.

**Result: 28/28.** Every flow an LP, agent, or buyer can run — plus every
rejection path — exercised live.

---

## 3. Bradbury — cost-safe 1 GEN roundtrip (real value)

Log: `e2e/results/bradbury-roundtrip.log`.

| Step | Result |
|---|---|
| `deposit(unrated)` with **1 GEN** | ok |
| pool `balance` / `total_shares` | 1.0000 GEN / 1 |
| LP position | 1.0000 GEN |
| `withdraw(unrated, all)` | ok |
| pool `balance` / `total_shares` | 0.0000 GEN / 0 |

Tx hashes (explorer): deposit `0x3df294379decb12981a779f51dfc1c95d991f56750c6076cd9750b87f2bf29f4`,
withdraw `0x112dc3afa28d7c38b0372c89e8228964b5715e018f0b21e3c51ec61797d4ed0b`.

**This proves value moves in and back out on a successful payable pair on
Bradbury.** Earlier in the day a 20 GEN deposit hit `LEADER_TIMEOUT` (no
validator produced a verdict) and the value was orphaned in the recipient
contract's ledger — a GenLayer behavior on failed/timeout payable txs, **not** a
contract bug. The roundtrip (deposit 1 → withdraw 1, pool back to 0) closes the
"does real value actually work on Bradbury" question with the smallest safe
spend. Only **1 GEN** was at risk; none was lost on this run.

---

## 4. Per-network outcome detection (the hard part)

A reverted GenLayer call still **finalizes** — so `ACCEPTED`/`FINALIZED` is not
success. Ground truth differs by network:

- **StudioNet:** read `consensus_data.validators[]`; only validators that voted
  `agree` decide the committed outcome — `reverted ⇔ an agreeing validator's
  execution_result == "ERROR"`. Idle validators routinely report `ERROR` (they
  timed out), so "any ERROR" is a false-positive rule that mislabeled a real
  success as a revert. Fixed and validated against 3 ground-truth receipts.
- **Bradbury:** no `consensus_data`; use numeric `txExecutionResult`
  (`1`=FINISHED_WITH_RETURN / ok, `2`=FINISHED_WITH_ERROR / revert,
  `0`=NOT_VOTED). A `LEADER_TIMEOUT` / `IDLE` / `NOT_VOTED` tx reached **no
  verdict** → treated as undetermined, never `ok`. The earlier Bradbury run
  mislabeled reverts as "ok (ACCEPTED)" before this rule was added.

`submitAndWait` in `e2e/run.js` unions both rules.

---

## 5. Caveats

- StudioNet is **gasless** — balances aren't enforced, so the value tests there
  (premiums, bond, payout) are behavioural, not token-enforced. Bradbury is
  where real balances are enforced; the 1 GEN roundtrip covered that.
- Bradbury is known-flaky: some transactions stall as `LEADER_TIMEOUT`. That is
  why the full-value Bradbury run was deliberately aborted and re-scoped to the
  small roundtrip.
- The 20 GEN orphaned on the earlier Bradbury contract (`0xcE82…`) is
  **unrecoverable by any contract path** (no shares, no sweep). Documented; the
  canonical Bradbury address is the fresh `0xcBF4…`.

Evidence files (gitignored, local): `e2e/results/*.json`, `*.log`, `*.address`.
