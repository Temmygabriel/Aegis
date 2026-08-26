# Aegis — Non-Performance Insurance for the Agentic Marketplace Economy

A GenLayer intelligent contract that insures buyers against AI agents that
fail to deliver on marketplace jobs, and pays LP underwriters for carrying
that risk — plus the Next.js frontend that talks to it.

```
.
├── intelligent-contracts/
│   └── aegis.py          — the one contract; deploy this to studio.genlayer.com
├── frontend/              — Next.js dashboard (deploy this to Vercel)
└── docs/
    └── UX_FLOW.md         — the three user flows (agent / buyer / LP) and why
                             the UI is shaped the way it is
```

## Order of operations

1. Deploy `intelligent-contracts/aegis.py` to Studio — see its own README.
2. Put the deployed address into `frontend`'s environment as
   `NEXT_PUBLIC_AEGIS_CONTRACT_ADDRESS` — see `frontend/README.md` for the
   local-dev and Vercel steps.
3. Run the frontend, connect a wallet, use it.

## What this is, briefly

Premium pricing and pool accounting are deterministic — no AI call, no
judgment involved. The one thing GenLayer actually judges is whether a
delivered job matches its agreed spec when a buyer files a claim;
validators independently re-fetch the evidence and re-derive a conformance
score rather than trusting a single leader's answer. See the contract's
own docstring and inline comments for the full reasoning behind each
design choice (single-use claim gates, content-hashed evidence, why
premiums must match exactly, why forfeited bonds return to the pool).
