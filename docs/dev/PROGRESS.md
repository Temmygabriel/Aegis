# Aegis — Progress Log

Running log of investigation, testing, fixes, and deployment. Newest first
within each section; keep this updated as work happens.

## Status (2026-09-02)

- **Done:** investigation, toolchain setup, direct-mode test suite (26 tests
  all passing), game-security review — one real exploit found **and fixed**
  (instant auto-breach via past deadline). Contract lints clean.
- **Done (reviewer-proof e2e):** StudioNet **28/28 PASS** on the canonical
  deploy; Bradbury **1 GEN roundtrip 7/7 PASS** (cost-safe). Full report in
  `docs/dev/E2E_REPORT.md`; canonical addresses in
  `intelligent-contracts/README.md`.
- **Done (UI/UX review round):** implemented the `aegis-ui-ux-recommendations.md`
  items that matter — fresh-quote-then-confirm issue flow, empty-pool buyer gate,
  policy review step, derived policy status, consensus elapsed hint, Claims
  role grouping, IdentityBadge type-DELETE confirm, MetaMask mute, tier rates on
  pool tiles, stat-card skeleton + slow-load timeout, refresh timestamp, tab
  relabel, footnote dedupe. (#7 local activity log deferred; #18 zero-display
  convention already consistent.) **Not yet visually confirmed on the Vercel build.**
- **Next:** flip the **live Vercel env** to the canonical StudioNet contract
  (`NEXT_PUBLIC_AEGIS_CONTRACT_ADDRESS=0xED90a97A77cd959bB278cBDfA0f2981dF5b5B843`)
  + rebuild, then visually verify the UX round; draft of the GenLayer Project
  Explorer submission in progress.

## What's been done

### UI/UX review round — 19-item recommendations, implemented (2026-09-02)
- Worked from `aegis-ui-ux-recommendations.md` against the live frontend
  (`app/page.tsx`, `app/globals.css`, `components/IdentityBadge.tsx`,
  `lib/aegisClient.ts`). No on-chain behavior changed — all edits are UX/flow.
- **Critical fixes:** `doIssue()` re-quotes at pay time (a stale tier can never
  fire a wrong-premium revert); empty-pool is pre-checked via `get_pool_info`
  → targeted "Fund the {tier} pool" notice + button that jumps to the Pools
  tab; claims show a ticking "validators are re-fetching…" hint; Pools "Load
  my stake" is disabled until the identity hydrates.
- **High impact:** every policy goes through a **Review & pay** confirm panel
  (Job/Agent/tier·rate/Coverage/Premium/Deadline/Spec + Edit) before any value
  moves; Inspect-a-policy derives a real status from `deliverable_hash +
  deadline` ("Awaiting delivery" / "Auto-breach available" / "Deliverable
  submitted" / "Ready to claim" / paid-out / expired) with an action tip; spec
  input explains the CID requirement; post-register guidance shows what happens
  next; pool tiles show each tier's premium rate; IdentityBadge's "Generate new
  identity" now needs the word DELETE typed inline instead of a one-click
  `window.confirm`.
- **Polish:** stat card uses a shimmer skeleton + 10s "network may be slow"
  fallback; Refresh shows an "Updated hh:mm:ss" stamp; tab relabelled "Pools"
  and wraps on narrow screens; footnote no longer repeats the hero contract
  address; MetaMask (display-only) section visually muted/italic; contract
  error prefixes `[EXPECTED]` etc. are stripped before display.
- **Deferred deliberately:** #7 (client-side "recent activity" log) — extra
  localStorage surface for little reviewer value and real edge-case risk;
  #18 (zero-display) already reads consistently as `0 GEN` / `—`.
- Files: `frontend/app/page.tsx`, `frontend/app/globals.css`,
  `frontend/components/IdentityBadge.tsx`, `frontend/lib/aegisClient.ts`.
  **Pending visual confirmation on the Vercel build** (no local `next build`
  on this 8 GB machine).

### Bradbury value roundtrip PASS — cost-safe 1 GEN (2026-09-02)
- After the 20 GEN deposit burn (below), redesigned the Bradbury check to a
  **1 GEN deposit → withdraw roundtrip** (user-approved budget) on a **fresh**
  deploy `0xcBF4…` so reviewer-facing evidence is clean. `e2e/roundtrip.js`
  reuses the main harness so outcome detection matches.
- **Result: 7/7 PASS.** Deposit 1 GEN ok → pool balance 1 / shares 1 / LP
  position 1 → withdraw 1 GEN ok → pool drained to 0 / position 0
  (`e2e/results/bradbury-roundtrip.log`). This proves value moves **in and back
  out** on a *successful* payable pair on Bradbury — the earlier loss was a
  `LEADER_TIMEOUT` no-verdict, not a contract bug.
- **Harness fix for Bradbury receipts:** they carry **no `consensus_data`** —
  the truth is numeric `txExecutionResult`: `1`=FINISHED_WITH_RETURN
  (success), `2`=FINISHED_WITH_ERROR (revert), `0`=NOT_VOTED. A
  `LEADER_TIMEOUT`/`IDLE`/`NOT_VOTED` tx reached no verdict → reported
  `undetermined`, never `ok`. The old run had mislabeled Bradbury reverts as
  "ok (ACCEPTED)". `submitAndWait` now unions StudioNet (agree-vote rule) and
  Bradbury (numeric) detection.

### Full real-network E2E harness (2026-09-02)
- Built `e2e/run.js` on **genlayer-js** (the same lib the frontend uses) because
  the `genlayer` CLI cannot attach `value` to contract writes, so payable calls
  (deposit / issue_policy / file_claim) need an SDK path. Subcommands:
  `keys | deploy | probe | e2e [--network …] [--address …]`. Deterministic 28-step
  scenario mirroring `tests/direct/test_aegis.py`, with **unique policy keys per
  run** and amounts asserted in GEN.
- **Revert detection fixed (was a false-positive bug):** a reverted StudioNet
  call still finalizes ACCEPTED/FINALIZED with `result_name=MAJORITY_AGREE`. The
  truth is per-validator (`consensus_data.validators[]`): only validators that
  voted `agree` decide the committed outcome — `reverted ⇔ an agreeing
  validator's execution_result == "ERROR"`. Idle validators routinely report
  `execution_result=ERROR` (they timed out / failed to run), so the earlier
  "any ERROR ⇒ revert" rule mislabeled successful `submit_deliverable` as
  reverted. Validated against ground-truth receipts (success submit, dup-register
  revert, fresh register).
- **Numeric reads fixed:** `readContract` returns u256 as number/string, never
  bigint — added `toBig`/`EQ` coercion for all balance/share/position/premium
  asserts.
- **StudioNet result: 28/28 PASS** on a fresh deployment
  (`0xED90…`, deploy → register → deposit math → quote → 2× payable issue →
  deliverable → negative gates → expire → auto-breach claim upheld → payout →
  counters → full LP withdraw → pool drained to 0).
- **Bradbury result (2026-09-02):** deploy succeeded (fresh `0xcE82…`, roles
  funded lp 25 / agent 3 / buyer 15 GEN) but the **full value e2e was aborted**
  — the 20 GEN LP deposit hit `LEADER_TIMEOUT` (every validator `NOT_VOTED`,
  `result_name=IDLE`) and the GEN is **orphaned in the contract ledger (20.06)**
  with pool state 0. Investigation proved a hard GenLayer behavior on BOTH
  networks: **value on a payable call moves at submission and is NOT refunded if
  the execution reverts or never commits** (StudioNet residue 2.06 = a
  past-deadline-issue premium 0.06 + a premature-claim bond 2; the *successful*
  claim's bond WAS returned). No contract path can recover it (no shares, no
  sweep). Bradbury receipts are a different shape (no `consensus_data`): use
  numeric `txExecutionResult` (2 = FINISHED_WITH_ERROR). **Lesson:** never attach
  value to an expected-revert call; cap live value spends (~1 GEN); get user OK
  before spending faucet GEN. Cost-safe Bradbury plan in task #6.

### Wallet integration — honest browser identity (2026-09-02)
- Implemented `aegis-wallet-integration.md` (design distilled from the Rigor
  frontend). Replaced the MetaMask "Connect wallet" flow with a browser
  **identity chip** — because GenLayer studionet tx are signed locally by a
  genlayer-js keypair, and MetaMask can't sign them. The UI says so plainly.
- New `frontend/lib/identity.ts` (`aegis.identity.pk.v1` key in localStorage;
  generate/import/reset helpers; works around the viem private-key trap by
  persisting our own copy of the key, not `account.privateKey` which is
  `undefined`), `frontend/app/providers.tsx` (identity context, client-only
  hydration), `frontend/components/IdentityBadge.tsx` (chip + dropdown: address
  + copy, honesty notice, show/copy private key, import-from-key with live
  "Recovers: 0x…" preview, MetaMask display-only, generate-new danger).
- `frontend/lib/aegisClient.ts`: write client now signs with the Account object
  (`createClient({ chain, account })`, no provider, no `.connect()`); dropped
  `connectWallet`. `writeContract` always passes `value` (0n when nothing
  moves) because genlayer-js 1.2.0 types require it and its local-account path
  signs value-0 fine — the old "never send value:0" rule only applied to the
  MetaMask provider path.
- `frontend/app/page.tsx`: topbar shows `<IdentityBadge />`; write flows take
  the account from context; LP stake lookup passes `acct.address`.
- Pushed as `13ce1bf`; Vercel rebuild pending. **Not yet visually confirmed.**

### Frontend UI redesign — "bold modern" (2026-09-02)
- User rejected the first UI ("total bullshit") and picked a **bold modern**
  direction: dark navy console + copper glow, glassy panels, big numbers,
  tabbed workbench instead of a wall of cards.
- Rewrote `frontend/app/globals.css` (new token set + components) and
  `frontend/app/page.tsx` (hero + live pool tiles + Agents/Pools/Coverage/
  Claims tabs). Contract calls are **unchanged** — same functions, same args —
  so no new on-chain behavior was introduced.
- Feedback is now structured notices (pending spinner / green ok / red error)
  instead of raw `JSON.stringify` dumps; lookups render as key/value rows with
  tier badges and status chips; pool tiles + TVL load live on mount; pool tiles
  refresh after deposits/withdraws; claims auto-show their verdict after filing.
- Wallet connect lives in the topbar and is shared by every tab.

### Investigation
- Read the whole repo: contract (`aegis.py`), frontend (`app/page.tsx`,
  `lib/aegisClient.ts`), `README.md`, `docs/UX_FLOW.md`.
- Identified duplicate stale files: `frontend/aegisClient.ts` and
  `frontend/page.tsx` are exact copies of `frontend/lib/aegisClient.ts` and
  `frontend/app/page.tsx` — dead code, to be removed before pushing.
- Frontend hardcodes `studionet`; needs to be network-aware for Bradbury.

### Toolchain setup (Windows 8GB machine)
- genlayer CLI 0.37.1 present; current network = testnet-bradbury, account
  "default" unlocked with ~73.9 GEN.
- Patched `gltest/direct/loader.py` Windows temp-file bug so direct tests run
  (see PROJECT_MEMORY.md).
- `genvm-lint check` → **lint passed**; validate blocked by SDK 404 (env issue).
- Confirmed pytest 9.1.1 + genlayer-test 0.29.2 work. Smoke test passed.

### Tests
- Wrote `tests/direct/test_aegis.py` covering registration, LP deposit/withdraw,
  policy issuance, deliverable submission, claims (deterministic + judged), and
  tier promotion / gaming vectors.
- **Result:** 26 passed in ~2.8s (after the deadline-guard fix), including the
  new regression test `test_issue_policy_rejects_past_deadline`. Contract
  passes `genvm-lint lint`.

### Game-security review
- Reviewed every "can this be gamed" angle the contract documents (sybil tiers,
  empty-pool first depositor, locked-exposure withdrawal, mutable-URL evidence,
  exact-premium enforcement, buyer-supplied evidence).
- **Found & fixed one real exploit:** `issue_policy` never checked that the
  deadline was in the future. A buyer could set an already-passed deadline and
  instantly claim the "no deliverable submitted" auto-breach — no chance for
  the agent to deliver, repeatable with fresh job_ids to drain a tier pool or
  burn an honest agent's reputation in one block. Fixed with a
  "deadline must be a future timestamp" guard in `issue_policy`; documented in
  the contract docstring's gaming-audit section.

## Known issues found
- **Fixed:** past-deadline policy issuance (instant auto-breach exploit).
- `genvm-lint validate` still blocked by SDK 404 (environment, not the
  contract) — deployment + tests are the authoritative validation.
- Frontend is network- and address-driven by env vars
  (`NEXT_PUBLIC_AEGIS_NETWORK`, `NEXT_PUBLIC_AEGIS_CONTRACT_ADDRESS`); the
  **live Vercel site still points at the old StudioNet deploy `0x4870…`** and
  must be flipped to the canonical `0xED90…` before the submission walkthrough.

## Deployments
- **StudioNet (canonical):** `0xED90a97A77cd959bB278cBDfA0f2981dF5b5B843`
  (deployed 2026-09-02; full e2e **28/28 PASS**, pool drained to 0)
- **Bradbury (canonical):** `0xcBF48A444242919EEA65Ff5bB6BD9d2CB82506e2`
  (deployed 2026-09-02; **1 GEN roundtrip 7/7 PASS**)
- Superseded (older deploys, do not use): StudioNet `0x4870…`;
  Bradbury `0x1ad8…` (first), `0xcE82…` (holds an orphaned 20.06 GEN ledger
  from the LEADER_TIMEOUT burn — left as-is, no recovery path exists).

## Documentation (created 2026-09-02)
- `docs/DEPLOYMENT.md` — per-network addresses, redeploy + verify steps, network quirks.
- `docs/CONTRACT.md` — contract overview, public interface, parameters, security hardening.
- `docs/dev/` — internal working notes (PROGRESS.md, PROJECT_MEMORY.md).

## Next steps
1. Flip the live Vercel env to the canonical StudioNet deploy
   (`0xED90a97A77cd959bB278cBDfA0f2981dF5b5B843`) and rebuild; then visually
   confirm the UX-review round on the live site (review/confirm flow, claims
   grouping, identity menu, tiles).
2. Draft the GenLayer Project Explorer submission from
   `genlayer-submission-playbook.md` (Studio + Bradbury explorer URLs, live
   website `https://aegis-insurance-project.vercel.app/`, GitHub
   `https://github.com/Temmygabriel/Aegis`).
3. Keep StudioNet as the live frontend target (Bradbury stays documented only).
