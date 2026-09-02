# Aegis — Project Memory

Local working notes. This file holds facts that are easy to lose between
sessions: deployed addresses, network quirks, tooling gotchas, and the
reasoning behind decisions. Update it whenever something notable changes.

## What the project is

Aegis = non-performance insurance for the AI-agent marketplace, on GenLayer.

- `intelligent-contracts/aegis.py` — single GenLayer intelligent contract.
- `frontend/` — Next.js dashboard (deploy to Vercel).
- `docs/UX_FLOW.md` — the three user flows (agent / buyer / LP).

Four moving parts in the contract:
1. **Agent identity & reputation** — one wallet binds to one `agent_id` at
   registration; tier (`unrated/bronze/silver/gold`) is derived from real
   history, never requested.
2. **Policies** — buyer pays an exact, deterministic premium (coverage × tier
   rate) to insure a job against a specific agent.
3. **LP pools** — LPs fund a tier and earn premiums; per-claim payout is capped
   at 10% of the tier pool.
4. **Claims** — the only AI-judged action. GenLayer validators fetch the spec
   + the agent-submitted deliverable from IPFS and score conformance.

## Networks

| Alias | CLI network | genlayer-js chain | Gas |
|-------|-------------|-------------------|-----|
| StudioNet | `studionet` | `studionet` | gasless (0 GEN fine) |
| Bradbury | `testnet-bradbury` | `testnetBradbury` | needs GEN (faucet) |
| Asimov | `testnet-asimov` | `testnetAsimov` | needs GEN |

- studio.genlayer.com rate limits: **60 req/min, 1000 req/hr, 10000 req/day**.
  Pending-queue cap ~32 in-flight txs per sender. Throttle + wait for receipts.
- `gltest` networks are named with underscores: `studionet`, `testnet_bradbury`.

## Deployed contract addresses

- **StudioNet (canonical):** `0xED90a97A77cd959bB278cBDfA0f2981dF5b5B843` (deployed 2026-09-02)
  - **Full e2e 28/28 PASS** (`e2e/results/studionet-e2e.log`): register, LP deposit,
    2× payable issue, deliverable, negative gates, expire, auto-breach claim +
    payout, counters, LP withdraw to pool 0.
  - StudioNet does NOT support `genlayer schema` ("not supported on this network").
  - StudioNet RPC is flaky: read/call sometimes fail with ECONNRESET / SSL session-id
    errors. Just retry — they succeed on the next attempt.
  - `registered_at` observed on StudioNet includes fractional seconds
    (`2026-09-02T04:22:05.627206Z`). The deadline guard compares ISO strings
    lexicographically, so sub-second slop is possible but not exploitable
    (the window is about days, not milliseconds).
- **Bradbury (canonical):** `0xcBF48A444242919EEA65Ff5bB6BD9d2CB82506e2` (deployed 2026-09-02)
  - **1 GEN deposit→withdraw roundtrip 7/7 PASS** (`e2e/results/bradbury-roundtrip.log`):
    deposit 1 GEN → pool 1 → withdraw 1 GEN → pool 0. Value returns on success.
  - Bradbury `registered_at` is whole seconds (`2026-09-02T04:26:37Z`, no fraction).
  - Bradbury receipts have NO `consensus_data` — outcome is numeric
    `txExecutionResult` (1=return/ok, 2=error/revert, 0=NOT_VOTED); a
    `LEADER_TIMEOUT`/`IDLE` tx is undetermined, never ok.
- **Superseded (do not use):** StudioNet `0x4870…`; Bradbury `0x1ad8…` (first)
  and `0xcE82…` (holds orphaned 20.06 GEN from a LEADER_TIMEOUT deposit burn;
  no recovery path — see PROGRESS.md).

The frontend needs the address via `NEXT_PUBLIC_AEGIS_CONTRACT_ADDRESS` (and
`NEXT_PUBLIC_AEGIS_NETWORK` for which network) — see `frontend/.env.example`.

## Tooling gotchas (this machine)

- `genvm-lint` exe lives at
  `%APPDATA%\Python\Python314\Scripts\genvm-lint.exe` (not on PATH). Must set
  `PYTHONIOENCODING=utf-8` on Windows or it crashes printing `✓`.
- `genvm-lint validate` currently fails: it tries to fetch GenVM SDK
  `v0.3.0-rc7` which 404s. Cached: v0.2.12 / v0.2.16. Lint (AST) still passes;
  real deployment is the authoritative validation.
- `genlayer-test` 0.29.2 has a Windows bug in `gltest/direct/loader.py`: it
  tries to `os.unlink` a temp file still open as stdin. Patched in-place to
  swallow `PermissionError`. If genlayer-test is upgraded, re-apply the patch.
- Node builds are NOT run locally (8GB RAM). Vercel does the cloud build.
- `gh` CLI not installed — GitHub repo creation/check must be done in the
  browser or via API with a token.

## Contract design decisions worth remembering

- `_normalize_key()` lowercases+strips every user-typed id before touching a
  TreeMap key (prevents case-variant squatting). As-typed text kept for display.
- `issue_policy` only allows a policy against a tier with real LP capital, and
  coverage ≤ current pool value (closes empty-pool first-depositor exploit).
- `withdraw()` refuses to drop a tier's balance below `tier_locked_exposure`.
- The deliverable being judged is submitted by the **agent** only — a buyer can
  never supply their own "evidence."
- `spec_hash` / `deliverable_hash` must look like an IPFS CID (CIDv0/v1 shape),
  not a mutable URL — so every validator fetches identical bytes.
- Tier promotion needs a minimum real spend + distinct buyers + elapsed tenure
  (sybil mitigation; documented as raising cost, not making it impossible).
- Premiums must match exactly (no rounding slack).
- `issue_policy` requires the deadline to be strictly in the future. Without
  that, a buyer could issue with an already-passed deadline and instantly
  claim the no-deliverable auto-breach (drain pool / burn agent reputation in
  one block). Guard added 2026-09-02; regression test
  `test_issue_policy_rejects_past_deadline`.

## GenLayer signing model (frontend, learned the hard way)

- MetaMask **cannot sign** GenLayer tx. The app signs with a genlayer-js
  keypair created/stored in the browser (localStorage `aegis.identity.pk.v1`)
  and labels it honestly as a "browser identity." Modeled on the Rigor
  frontend (`identity.ts` / `IdentityBadge.tsx` / `providers.tsx` on disk).
- **viem private-key trap:** `createAccount(pk)` returns an Account object
  whose `.privateKey` is `undefined`. Persist YOUR OWN copy of the key
  (from `generatePrivateKey()`) and rebuild with `createAccount(key)`.
- Write client = `createClient({ chain, account })` with the Account object —
  no provider, no `.connect()`. MetaMask-style `{ account: address, provider,
  connect() }` is the WRONG model here.
- **genlayer-js `writeContract` types require `value: bigint`** (always present).
  Its implementation defaults to `0n` and signs value-0 transactions normally
  on the local-account path (verified in genlayer-js 1.2.0 `dist/index.js`,
  `_sendTransaction`). The older Rigor note "never send an explicit value:0 —
  GenLayer's RPC rejects it" applies to the MetaMask/`eth_sendTransaction`
  provider path, NOT to local-account signing. Aegis uses local accounts, so it
  passes `value` unconditionally (0n when nothing moves).
- Identity hydration must run in a client-only `useEffect` (never during SSR),
  or the page server-renders a fresh random key every request.

## Frontend preferences (user is opinionated about the UI)

- The first paper/ledger look was called "total bullshit." The approved
  direction is **bold modern**: dark navy console (`#0a0e19` family) with a
  copper (`#d98e45`/`#f4b877`) glow, glassy translucent panels, big tabular
  numbers, and a tabbed workbench (Agents / Pools / Coverage / Claims). No raw
  JSON dumps — actions show structured notices, lookups show key/value rows.
- Keep the Vercel deployment pointed at **StudioNet**; Bradbury stays in docs.
- Do not surprise the user with a light theme again without asking.

## Related

- `docs/dev/PROGRESS.md` — running log of work, status, and next steps.
