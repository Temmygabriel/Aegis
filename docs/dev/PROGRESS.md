# Aegis — Progress Log

Running log of investigation, testing, fixes, and deployment. Newest first
within each section; keep this updated as work happens.

## Status (2026-09-03)

- **Done (Shape A gaming hardening shipped — patch + full redeploy + re-seed):**
  the final proactive review's finding 1 (self-deal auto-breach drain) is
  **patched**, not deferred: `issue_policy` now (a) rejects the agent's own
  owner as buyer, (b) parses deadlines to epoch seconds with a 60 s minimum
  horizon (no ~1-second drain loops), and (c) caps coverage to 10% of the tier
  pool at issue so a policy label is always the most one claim can pay.
  Contract committed (`ba7db2e`), suite **28/28**, `genvm-lint` clean. Both
  contracts **redeployed to fresh canonical addresses** and verified live:
  StudioNet `0x605e5BE4a8013B2B6c70c4BECa3CEbB7BD7918e4` — full e2e **28/28
  PASS** on the new address — and Bradbury `0x79C15889D5070321176994373C440778a9eC47c1`
  (deploy tx `0x14222a…`, read-verified; no full e2e on Bradbury by design).
  Live board **re-seeded** to the §05 numbers on the new StudioNet contract
  (Unrated 10.06 / locked 1.00, Bronze 5, Silver 3, Gold 2; seed ids
  `agent-live-1788435546808` / `job-live-1788435546808`). Frontend seed gate,
  `frontend/.env.example` and `docs/DEPLOYMENT.md` re-pointed (`de3d242`,
  parse gate clean). Remaining disclosed residual (two-wallet drip, bronze
  breach-rate gate) and the judged-path QA gap are recorded in the Final
  review section below. **One user action left:** flip the Vercel
  `NEXT_PUBLIC_AEGIS_CONTRACT_ADDRESS` to `0x605e5B…` and redeploy the project
  (no local CLI token).

- **Done (submission + demo docs rewritten to the final UI; working folder
  cleaned):** `aegis-submission-note.md` rewritten in the Rigor style
  (`genlayer-project-explorer-submission.md` in the same folder): a simple §05
  reviewer path (Steps 1–7) aligned to the shipped war-room labels (Risk pool
  overview, Recent activity, Get quote / Issue policy, Policy status chips
  Awaiting delivery / Auto-breach available / Paid out), §03 Description
  measured 983 chars, §06 outcome measured 469 chars, and inline symbols
  (arrows/checks/backticks/blockquotes) stripped from the body. The feed no
  longer "starts empty": §05 and the demo plan say the Recent activity panel
  opens with the seeded history and the demo's own writes stack above.
  `aegis-demo-plan.md` rebuilt as a plain run-sheet keyed to §05 with a
  copy-paste values block; `aegis-demo-captions.md` cleaned to plain short
  cards. Superseded/implemented docs (old demo-script, submission-draft,
  ui-redesign, ui-ux-recommendations, wallet-integration) moved to `archive/`
  with a README; top level now holds only the live doc set + the mock + the
  official guides.
- **Done (feed backfill on the seeded live board):** "Recent activity" read
  empty on any fresh browser because the feed only logs *this-browser* writes
  and the seeded chain activity came from `seed-live.js`'s Node wallet. On the
  canonical seeded StudioNet deploy only (`AEGIS_ADDRESS` == `0xED90…`),
  `seedFeedOnce()` in `page.tsx` now replays the six REAL seed transactions
  (register `agent-live-1788422271884`, LP 10/5/3/2 GEN into Unrated/Bronze/
  Silver/Gold, 1 GEN cover on `job-live-1788422271884`) into a first-load feed,
  timestamped at the actual seed run (the ids embed `Date.now()`); the browser's
  own confirmed writes then stack above. Any other network/address stays
  local-only. Parse gate clean; pushed for the live build.
- **Done (mock-exact war-room UI, aligning `aegis_redesign_mockup.html`):**
  implemented on `app/page.tsx` + `app/globals.css`. The marketing
  hero-lead/headline block is gone — the page now opens on the two-panel war
  room (`1fr 340px` grid): **left** = "Risk pool overview" eyebrow + Refresh /
  "Updated …" tools, the conic **capital-utilisation ring** (copper arc =
  live `sum(locked)/sum(balance)`, honest stand-in for the mock's illustrative
  45%) around a small shield, big **TVL** number + "N% · X GEN locked on
  active cover" sub-line, the four tier tension bars, and a dim contract-
  address footline; **right** = "Recent activity" feed (real localStorage
  writes, same empty state). Tabs reordered **Agents · Coverage · Pools ·
  Claims**, **Coverage active on load**. Coverage tab rebuilt to the mock's
  three-part composition: **Quote & issue cover** panel (Agent/Coverage row →
  Job → Spec → Deadline fields; after Get quote a quote-box with a tier
  badge + "Premium due" + one-click **Issue policy →** that re-quotes at pay
  time — a drift just refreshes the box; empty-pool gate jumps to Pools),
  **Policy status** panel (Look up renders a visualized card: status chip,
  2×2 Agent/Pool tier/Coverage/Payout grid reading `get_claim_status` for
  resolved claims, and an honest conformance track — 40 threshold tick + 0–100
  legend, **no fabricated fill** since the contract stores no score), and a
  full-width **verdict strip** that only renders for a real resolved
  inspection. `VerdictStamp` gained an optional detail note. `RATE_BPS_BY_TIER`
  import dropped. esbuild TSX parse gate passes. **Not yet visually confirmed
  on the Vercel build.**
- **Next:** confirm the live build reads like the mock (war-room hero, TVL ring
  + bars + feed, Coverage default, quote-box + policy card, verdict strip) and
  the feed now shows the seeded history on a fresh profile; then the demo-docs
  sync (`aegis-demo-plan.md`, `aegis-submission-note.md`, captions) against the
  final on-screen labels — note the demo plan's "feed starts empty" pre-flight
  line flips to "feed opens with the seeded history, your actions stack above"
  — and the folder cleanup of the similar working docs.
- **Done (war-room redesign):** implemented `aegis-ui-redesign.md` on
  `layout.tsx` (Space Grotesk + Space Mono replace Fraunces/IBM Plex),
  `globals.css` (darker `#07090f` bg + tighter radial glows, new copper
  `#e07820` + cold-green `#38e89a` verdict tokens, 8/6/6 px radii, then the
  new component layer: hero board, tier bars, live-activity feed, quote-box,
  verdict stamp, hero-left shield watermark, net-pill pulse), and
  `page.tsx` (hero is now a hero-lead statement + two-column board —
  **hero-left TierBars** risk display replacing the stat-card + tiles, and a
  **hero-right live feed** fed by the real last-N confirmed writes in
  `localStorage`; `VerdictBox` → `VerdictStamp` ink-stamp; Coverage quote +
  issue collapsed into a `.quote-box`). UX-round logic preserved
  (review/confirm flow, derived policy chips + action tips, Claims role
  grouping). **Not yet visually confirmed on the Vercel build.** Conformance
  score bar **deferred**: the contract exposes no 0–100 score read, so there
  is nothing honest to draw.
- **Done (build fix `105b6f5`):** wrapped the Inspect-a-policy kv + action-tip
  siblings in a fragment — the Vercel JSX compile error from `0804ebb` is
  fixed. Preventive gate added: `esbuild` TSX parse before pushes
  (`.esbuild-check/` gitignored); no local `next build`/`tsc` possible here
  (no node_modules, 8 GB rule).
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
  convention already consistent.)
- **Done (2026-09-02):** live Vercel env flipped to the canonical StudioNet
  contract (`0xED90a97A77cd959bB278cBDfA0f2981dF5b5B843`) + redeployed — site
  and repo now point at the same tested deployment.
- **Next:** confirm the redesign visually on the live Vercel build; then
  finish the Project Explorer submission upload (primary tag/sub-tags + logo)
  and link the demo video; optionally expose a conformance-score contract
  read if the Inspect score bar is wanted.

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
  (`NEXT_PUBLIC_AEGIS_NETWORK`, `NEXT_PUBLIC_AEGIS_CONTRACT_ADDRESS`). Live
  Vercel env points at StudioNet; after the 2026-09-03 Shape A redeploy the
  env must be **flipped to `0x605e5BE4a8013B2B6c70c4BECa3CEbB7BD7918e4`** and
  the project redeployed (no local CLI token — dashboard action).

## Deployments
- **StudioNet (canonical, Shape A):** `0x605e5BE4a8013B2B6c70c4BECa3CEbB7BD7918e4`
  (deployed 2026-09-03, tx `0xf8e416dc…c6373d8fe`; full e2e **28/28 PASS** on
  this address, pool drained to 0 then re-seeded — see Live seeded state).
- **Bradbury (canonical, Shape A):** `0x79C15889D5070321176994373C440778a9eC47c1`
  (deployed 2026-09-03, tx `0x14222a14…3832350a`; read-verified live).
- Superseded (2026-09-02 unpatched generation, do not use): StudioNet
  `0xED90a97A77cd959bB278cBDfA0f2981dF5b5B843` (28/28 e2e on old source);
  Bradbury `0xcBF48A444242919EEA65Ff5bB6BD9d2CB82506e2` (1 GEN roundtrip 7/7).
- Older still (do not use): StudioNet `0x4870…`; Bradbury `0x1ad8…` (first),
  `0xcE82…` (holds an orphaned 20.06 GEN ledger from the LEADER_TIMEOUT burn —
  left as-is, no recovery path exists).

## Live seeded state (2026-09-03, re-seeded on the Shape A deploy)
- **Purpose:** after each e2e drains the pools, `e2e/seed-live.js` re-seeds real
  activity on the canonical StudioNet contract so the live UI displays funded
  pools + a locked-exposure sliver (the §05 board numbers).
- **Re-seeded via `e2e/seed-live.js`** after the 2026-09-03 redeploy: fresh
  agent `agent-live-1788435546808` (wallet key in `e2e/live-keys.json`,
  git-ignored), LP deposited 10/5/3/2 GEN into unrated/bronze/silver/gold, then
  the buyer role issued 1 GEN of cover (`job-live-1788435546808`, active,
  deadline ~1 h out).
- **Live board now reads:** Unrated `10.06 GEN` (locked sliver `1.00 GEN`),
  Bronze `5`, Silver `3`, Gold `2`. Seed tx hashes: register `0x121e62b3…`,
  deposits `0x3d8f686c…` (unrated 10) / `0xbd5ff4f2…` (bronze 5) /
  `0xcc25f7d7…` (silver 3) / `0x82ca7662…` (gold 2), issue `0xd41dab57…`.
- The seeded policy's 1 GEN stays locked until claimed/expired — residue,
  noted; the demo take can run its own register→deposit→issue→claim loop on
  top (Unrated ≥ 10 GEN, so a 1 GEN payout still clears the 10% cap).

## Final proactive review (2026-09-03) + Shape A patch + redeploy

Adversarial re-read of `aegis.py` for every "reviewer could reject this" angle
(sybil, gamed logic, economic drain, honest-claims accuracy), plus a test-suite
reconfirmation. Finding 1 below (self-deal auto-breach drain) was **patched the
same day — Shape A** (see `docs/CONTRACT.md` items 7/9/10) — and both contracts
were **redeployed to fresh canonical addresses** (`docs/DEPLOYMENT.md`): StudioNet
`0x605e5BE4a8013B2B6c70c4BECa3CEbB7BD7918e4` (e2e **28/28 PASS**) and Bradbury
`0x79C15889D5070321176994373C440778a9eC47c1` (read-verified). The live board was
re-seeded to the §05 numbers. Suite: `python -m pytest tests/direct/test_aegis.py
-q` → **28 passed**; `genvm-lint` clean.

### Confirmed present (each has a regression test or a code-level trace)
- Past **and** too-soon (< 60 s) deadlines blocked
  (`test_issue_policy_rejects_past_and_too_soon_deadlines`); a 90 s boundary
  still issues.
- Self-buy rejected — the agent's own owner cannot insure its job
  (`test_issue_policy_rejects_self_buy`).
- Coverage capped to the single-claim pool share at issue
  (`test_issue_policy_coverage_capped_to_single_claim_share`); payout still
  capped at 10% of the pool at claim time even when an earlier payout shrank the
  pool (`test_claim_payout_capped_at_10pct_pool`).
- Empty-pool first-depositor closed: `issue_policy` requires pool_value > 0 and
  coverage ≤ 10% of pool; `deposit` hard-aborts on any unattributed balance with
  no shares.
- LPs cannot withdraw under live coverage (locked-exposure gate,
  `test_withdraw_blocks_under_locked_exposure`).
- Evidence is content-addressed only (CIDv0/v1 shape rejects mutable URLs) and
  is agent-submitted only (a buyer can never attach their own deliverable).
- Exact-premium enforcement, exact 2 GEN claim bond (refunded on upheld,
  forfeited to pool on rejected), one wallet binds one agent forever,
  `_normalize_key` blocks case-variant identity squatting.
- Sybil ladder: min distinct buyer addresses + tenure days + min real spend per
  tier. Honest limit (a chain cannot prove one wallet is one person) is stated
  in the contract docstring and the §03 submission text.

### Finding 1 — self-deal auto-breach drain: PATCHED (Shape A, shipped)
Original finding: a buyer plus its own never-delivering agent (two wallets) can
drain a tier pool that holds third-party LP capital — issue cover up to ~10% of
pool (premium 0.06·C at unrated), let the deadline pass, file the deterministic
auto-breach claim, collect ≈ coverage − premium. The **one-wallet** version (buy
on your own agent) is now **impossible** (item 9, self-buy revert), the deadline
can't be a ~1-second loop anymore (item 7, 60 s floor), and per-policy coverage
is capped to what a single claim pays (item 10). Remaining residual, disclosed
in the contract and `docs/CONTRACT.md`: a controller using **two separate
wallets** can still run a slow drip (~coverage − premium per round, bounded to
10% of the pool per round). Insurance that pays out more than its premium is the
mechanism's point — an honest claim is economically identical — so no contract
rule can allow the demo and forbid that drain; the real defence is off-chain.
2. **Bronze promotion still has no breach-rate gate (minor, unpatched):**
   silver/gold require breach_rate ≤ 8%/2%, but bronze only needs 3 insured jobs
   + 2 distinct buyers + 3 days of tenure. A chronic breacher can become cheaper
   to insure (600 → 400 bps). No live path can reach bronze today, so it has
   zero review visibility; one gate line for v1.1.

### QA gap — judged consensus claim never proven on a live network
StudioNet e2e and Bradbury exercised only the **deterministic auto-breach**
claim (no deliverable + passed deadline). The **judged** path (agent submits a
deliverable → validators re-fetch both CIDs and score conformance) has only
ever run in direct-mode tests with web+LLM stubbed. The UI's "Submit a
deliverable" panel makes it reachable by a curious reviewer. Mechanism is
standard GenLayer nondet, so risk is low — but if we want it proven on-chain it
must be smoked **after** the demo take, because a judged payout draws from a
pool and would shift the §05 board numbers mid-filming.

## Documentation (created 2026-09-02)
- `docs/DEPLOYMENT.md` — per-network addresses, redeploy + verify steps, network quirks.
- `docs/CONTRACT.md` — contract overview, public interface, parameters, security hardening.
- `docs/dev/` — internal working notes (PROGRESS.md, PROJECT_MEMORY.md).

## Next steps
0. **Flip the Vercel env** to `NEXT_PUBLIC_AEGIS_CONTRACT_ADDRESS =
   0x605e5BE4a8013B2B6c70c4BECa3CEbB7BD7918e4` and redeploy the project (the
   only outstanding action; no local CLI token). Then verify the live site reads
   the new contract (page foot + board numbers Unrated 10.06 / locked 1.00 /
   Bronze 5 / Silver 3 / Gold 2 + seeded feed).
1. Dry-run the rewritten §05 path live against the final UI on a fresh profile
   (pools are seeded; feed opens with the seeded history), then record the demo
   from `aegis-demo-plan.md` / `aegis-demo-captions.md`: ~2-min-deadline claim
   leaves the planted example on-chain. Then fill the remaining `[YOU: …]`
   blanks in `aegis-submission-note.md` (logo, dropdown tags, YouTube link, the
   planted job id for §05 Step 2 — deploy tx hashes are now recorded in
   `docs/DEPLOYMENT.md`) and submit.
2. Keep StudioNet as the live frontend target (Bradbury stays documented only).
3. Optional, AFTER the demo take: live-judged-path smoke on StudioNet (register
   a fresh agent, submit a real deliverable CID, file a claim through consensus)
   so the on-chain history also proves the judged path, not just the auto-breach
   path. Re-verify the §05 board numbers afterwards if its payout shifted them.
