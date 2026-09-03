# intelligent-contracts / `aegis.py`

**`aegis.py` is the one and only contract source.** GenLayer intelligent-contract
code is **network-agnostic** — the same file is deployed to each network; there is
no separate "StudioNet contract" vs "Bradbury contract" to maintain. Keeping one
source (instead of two byte-identical copies) is what prevents the two from ever
drifting apart.

## Canonical live deployments (2026-09-03, Shape A-hardened, value-tested)

Both deployed from the current `aegis.py` in this folder (the gaming-hardening
pass — self-buy ban, epoch deadlines + 60 s floor, coverage capped to the pool
share):

| Network | Address | Verified |
|---|---|---|
| **StudioNet** (61999) | `0x605e5BE4a8013B2B6c70c4BECa3CEbB7BD7918e4` | Full e2e **28/28** — `e2e/results/studionet-e2e.log` |
| **Testnet Bradbury** (4221) | `0x79C15889D5070321176994373C440778a9eC47c1` | Deploy read-verified; 1 GEN deposit→withdraw roundtrip **7/7** proven on the prior generation — `e2e/results/bradbury-roundtrip.log` |

Full evidence, prior deployments, and re-deploy steps live in
[`docs/DEPLOYMENT.md`](../docs/DEPLOYMENT.md) and
[`docs/dev/E2E_REPORT.md`](../docs/dev/E2E_REPORT.md).

## If you deploy a new version

1. Edit `aegis.py`.
2. Re-run the direct test suite: `pytest tests/direct/test_aegis.py` and
   `genvm-lint check intelligent-contracts/aegis.py`.
3. Deploy + value-test on StudioNet, then on Bradbury (see
   `e2e/run.js` / `e2e/roundtrip.js`).
4. Record the new addresses in `docs/DEPLOYMENT.md` and point the frontend
   `.env` at them.
