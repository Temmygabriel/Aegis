# Aegis — Progress Log

Running log of investigation, testing, fixes, and deployment. Newest first
within each section; keep this updated as work happens.

## Status (2026-09-02)

- **Done:** investigation, toolchain setup, direct-mode test suite (26 tests
  all passing), game-security review — one real exploit found **and fixed**
  (instant auto-breach via past deadline). Contract lints clean.
- **Next:** real deploy + e2e on StudioNet, then Bradbury; then frontend
  network-awareness + GitHub push.

## What's been done

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
1. ~~Run direct test suite; fix any contract bugs it surfaces.~~ **Done** (26/26 pass).
2. ~~Deploy `aegis.py` to StudioNet; record address; run CLI e2e.~~ **Done** — `0x4870…1eB`.
3. ~~Deploy `aegis.py` to Bradbury; record address; run CLI e2e.~~ **Done** — `0x1ad8…1f54`.
4. ~~Make frontend network-aware + remove duplicate files.~~ **Done** — network via
   `NEXT_PUBLIC_AEGIS_NETWORK`; Vercel cloud build will verify.
5. ~~Push repo to github.com/Temmygabriel/Aegis.~~ **Done** — remote `main` at
   `c63abc5` matches local (pushed via Windows Git Credential Manager, no gh
   needed).
6. Help import into Vercel (user action) — Root Directory `frontend/`, env vars
   from docs/DEPLOYMENT.md.
