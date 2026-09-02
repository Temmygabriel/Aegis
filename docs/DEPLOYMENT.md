# Aegis — Deployment Guide

Where the contract is deployed, how to deploy it again, and how to verify a
deployment actually succeeded.

## Live deployments

| Network | Chain ID | Contract address | Deployed | E2E verified |
|---------|----------|------------------|----------|--------------|
| StudioNet | 61999 | `0x48707ab234AB929fc786c3CBaB95248E088Da1eB` | 2026-09-02 | ✅ deploy → read → register write → read-back |
| Testnet Bradbury | 4221 | `0x1ad8bbaC717EBDaFB250c5c845f245d0f9dE1f54` | 2026-09-02 | ✅ deploy → read → register write → read-back |

- Deploy account (`default`): `0xa881365a99d77be904e414ae610e22938bb0466d`
- Both deployed instances were smoke-tested the same way:
  1. `get_pool_info("unrated")` returns a fresh pool (all zeros).
  2. `register("<agent>")` write is accepted by consensus.
  3. `get_profile("<agent>")` reads back the profile (owner, tier, timestamps).

### Explorer links

- Bradbury explorer:
  `https://explorer-bradbury.genlayer.com/address/0x1ad8bbaC717EBDaFB250c5c845f245d0f9dE1f54`
- StudioNet is hosted at studio.genlayer.com; contract views are queryable via
  the `genlayer call` CLI (see below).

## Frontend environment variables

The Next.js frontend reads these at build time (set them in Vercel). The live
Vercel deployment points at **StudioNet** (gasless):

```env
NEXT_PUBLIC_AEGIS_CONTRACT_ADDRESS=0x48707ab234AB929fc786c3CBaB95248E088Da1eB
NEXT_PUBLIC_AEGIS_NETWORK=studionet
```

If you'd rather run the frontend against **Bradbury** (no rate limits), swap in
its deployment instead — both are verified live:

```env
NEXT_PUBLIC_AEGIS_CONTRACT_ADDRESS=0x1ad8bbaC717EBDaFB250c5c845f245d0f9dE1f54
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
