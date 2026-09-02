# Aegis — Deployment Guide

Where the contract is deployed, how to deploy it again, and how to verify a
deployment actually succeeded.

## Live deployments

| Network | Chain ID | Contract address | Deployed | E2E verified |
|---------|----------|------------------|----------|--------------|
| StudioNet | 61999 | `0xED90a97A77cd959bB278cBDfA0f2981dF5b5B843` | 2026-09-02 | ✅ **28/28 steps** — full lifecycle (`e2e/results/studionet-e2e.log`) |
| Testnet Bradbury | 4221 | `0xcBF48A444242919EEA65Ff5bB6BD9d2CB82506e2` | 2026-09-02 | ✅ **7/7 steps** — 1 GEN deposit→withdraw roundtrip (`e2e/results/bradbury-roundtrip.log`) |

> These are the **canonical, latest** addresses — both deployed from the same
> repo `intelligent-contracts/aegis.py` and value-tested live. Earlier superseded
> deployments (`0x4870…` StudioNet, `0x1ad8…` / `0xcE82…` Bradbury) are archived
> in git history / `docs/dev/PROGRESS.md` and should **not** be used.

- Deploy account (`default`): `0xa881365a99d77be904e414ae610e22938bb0466d`
- The full 28-step StudioNet run exercised register, LP deposit, quoting,
  2× payable policy issuance, deliverable submit, all negative/gate reverts,
  expire, auto-breach claim + payout, counters, and LP withdraw to pool 0.
- The Bradbury roundtrip proved value moves **in and back out** on a successful
  payable pair (deposit 1 GEN → pool 1 GEN → withdraw 1 GEN → pool 0).

### Explorer links

- StudioNet: `https://explorer-studio.genlayer.com/address/0xED90a97A77cd959bB278cBDfA0f2981dF5b5B843`
- Bradbury:
  `https://explorer-bradbury.genlayer.com/address/0xcBF48A444242919EEA65Ff5bB6BD9d2CB82506e2`

## Frontend environment variables

The Next.js frontend reads these at build time (set them in Vercel). The live
Vercel deployment points at **StudioNet** (gasless):

```env
NEXT_PUBLIC_AEGIS_CONTRACT_ADDRESS=0xED90a97A77cd959bB278cBDfA0f2981dF5b5B843
NEXT_PUBLIC_AEGIS_NETWORK=studionet
```

If you'd rather run the frontend against **Bradbury** (no rate limits), swap in
its deployment instead — both are verified live:

```env
NEXT_PUBLIC_AEGIS_CONTRACT_ADDRESS=0xcBF48A444242919EEA65Ff5bB6BD9d2CB82506e2
NEXT_PUBLIC_AEGIS_NETWORK=testnet-bradbury
```

Network values follow the `genlayer-js/chains` names: `studionet`,
`testnetBradbury`, `testnetAsimov`. Note StudioNet is rate-limited (60 req/min
per IP) — fine for a demo dashboard, but batch scripts should use Bradbury.

## How to deploy again

Prerequisite: `genlayer` CLI installed and `genlayer account unlock` run for the
deploying account.

```bash
# 1. Pick the network
genlayer network set studionet            # gasless, but rate-limited
genlayer network set testnet-bradbury     # needs GEN in the account

# 2. Deploy from the repo root
genlayer deploy --contract intelligent-contracts/aegis.py

# 3. Record the returned Contract Address + Transaction Hash
```

StudioNet is gasless (0 GEN balance is fine). Bradbury needs GEN — claim from
the faucet if the account is empty: https://testnet-faucet.genlayer.foundation/

## How to verify a deployment (do not skip)

`ACCEPTED` / `FINALIZED` transaction status does **not** mean the contract code
executed. A failed execution still finalizes, but no contract is created. Verify
with reads and a write, not just the deploy banner:

```bash
# Read: should return a fresh pool
genlayer call <ADDRESS> get_pool_info --args "unrated"

# Write: should be accepted by consensus
genlayer write <ADDRESS> register --args "agent-smoke"

# Read back: profile should exist with your account as owner
genlayer call <ADDRESS> get_profile --args "agent-smoke"
```

On StudioNet, `genlayer schema` and `genlayer code` are **not supported** — the
network rejects those RPCs. The receipt plus working view/write calls are the
proof. The receipt can be checked with:

```bash
genlayer receipt <TX_HASH> --stdout --stderr
```

## Network quirks learned on this machine

- **StudioNet RPC is flaky.** Reads/writes sometimes fail with `ECONNRESET` or
  an SSL `invalid session id` error. Retry — they succeed on the next attempt.
- **StudioNet rate limits:** 60 req/min, 1000 req/hr per IP. Throttle batch
  scripts and wait for receipts between writes.
- **Bradbury receipt polling** can take a while to reach `FINALIZED`; reads and
  writes work immediately after deployment anyway.
