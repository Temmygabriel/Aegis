# intelligent-contracts / `aegis.py`

**`aegis.py` is the one and only contract source.** GenLayer intelligent-contract
code is **network-agnostic** — the same file is deployed to each network; there is
no separate "StudioNet contract" vs "Bradbury contract" to maintain. Keeping one
source (instead of two byte-identical copies) is what prevents the two from ever
drifting apart.

## Canonical live deployments (2026-09-02, value-tested)

Both deployed from the current `aegis.py` in this folder:

| Network | Address | Verified |
|---|---|---|
| **StudioNet** (61999) | `0xED90a97A77cd959bB278cBDfA0f2981dF5b5B843` | Full e2e **28/28** — `e2e/results/studionet-e2e.log` |
| **Testnet Bradbury** (4221) | `0xcBF48A444242919EEA65Ff5bB6BD9d2CB82506e2` | 1 GEN deposit→withdraw roundtrip **7/7** — `e2e/results/bradbury-roundtrip.log` |

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
