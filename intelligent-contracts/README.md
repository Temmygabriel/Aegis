# Intelligent Contracts

`aegis.py` — the single GenLayer intelligent contract for Aegis. Deploy it
as-is to `studio.genlayer.com` (StudioNet):

```bash
genlayer network set studionet
genlayer deploy --contract intelligent-contracts/aegis.py
```

No constructor arguments. The deployed address is the only thing the
frontend needs — set it as `NEXT_PUBLIC_AEGIS_CONTRACT_ADDRESS` in
`frontend/.env.example` (locally) or as a Vercel environment variable
(deployed).
