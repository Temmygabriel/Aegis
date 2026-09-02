# Aegis — Progress Log

Running log of investigation, testing, fixes, and deployment. Newest first
within each section; keep this updated as work happens.

## Status (2026-09-02)

- **Done:** investigation, toolchain setup, direct-mode test suite (26 tests
  all passing), game-security review — one real exploit found **and fixed**
  (instant auto-breach via past deadline). Contract lints clean.
- **Next:** confirm the wallet-integration deploy on the live Vercel site —
  top-right identity chip should replace "Connect wallet", and a register/
  deposit/issue tx should sign locally with the browser key.

## What's been done

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
- Frontend still hardcodes `studionet` and has stale root-level duplicates
  (`frontend/aegisClient.ts`, `frontend/page.tsx`) to remove before push.

## Deployments
- StudioNet address: `0x48707ab234AB929fc786c3CBaB95248E088Da1eB`
  (deployed 2026-09-02; e2e verified: deploy → read → register write → read-back)
- Bradbury address: `0x1ad8bbaC717EBDaFB250c5c845f245d0f9dE1f54`
  (deployed 2026-09-02; e2e verified: deploy → read → register write → read-back)

## Documentation (created 2026-09-02)
- `docs/DEPLOYMENT.md` — per-network addresses, redeploy + verify steps, network quirks.
- `docs/CONTRACT.md` — contract overview, public interface, parameters, security hardening.
- `docs/dev/` — internal working notes (PROGRESS.md, PROJECT_MEMORY.md).

## Next steps
1. Review the redesigned dashboard on the Vercel build; check logo/favicon,
   pool tile reads, and each tab. Watch for browser CORS to studio.genlayer.com.
2. ~~Push repo to github.com/Temmygabriel/Aegis.~~ **Done** — remote `main`
   matches local.
3. Keep StudioNet as the live frontend target (Bradbury stays documented only).
