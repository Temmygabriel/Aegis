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

- **StudioNet:** `0x48707ab234AB929fc786c3CBaB95248E088Da1eB` (deployed 2026-09-02)
  - e2e verified: `get_pool_info("unrated")` returns fresh pool; `register("agent-e2e")`
    write accepted (consensus) and `get_profile("agent-e2e")` reads back the profile.
  - StudioNet does NOT support `genlayer schema` ("not supported on this network").
  - StudioNet RPC is flaky: read/call sometimes fail with ECONNRESET / SSL session-id
    errors. Just retry — they succeed on the next attempt.
  - `registered_at` observed on StudioNet includes fractional seconds
    (`2026-09-02T04:22:05.627206Z`). The deadline guard compares ISO strings
    lexicographically, so sub-second slop is possible but not exploitable
    (the window is about days, not milliseconds).
- **Bradbury:** `0x1ad8bbaC717EBDaFB250c5c845f245d0f9dE1f54` (deployed 2026-09-02)
  - e2e verified: `get_pool_info("unrated")` returns fresh pool; `register("agent-bradbury")`
    write accepted and profile reads back. Account "default" spent a little GEN.
  - Bradbury `registered_at` is whole seconds (`2026-09-02T04:26:37Z`, no fraction).

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
