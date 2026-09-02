# Aegis Frontend

Next.js dashboard for the single-file `aegis.py` intelligent contract:
register agents, quote and issue policies, underwrite pools as an LP, file
claims, and watch consensus verdicts resolve — all read/write calls go
straight from the browser to the configured GenLayer network via
`genlayer-js` (StudioNet by default, Testnet Bradbury with
`NEXT_PUBLIC_AEGIS_NETWORK=testnet-bradbury`).

## Local development

```bash
npm install
cp .env.example .env.local
# edit .env.local -> paste your deployed contract address
npm run dev
```

Open `http://localhost:3000`. You'll need MetaMask installed — the app adds
Studio as a network on first connect if it isn't already there.

## Your workflow: GitHub → Vercel

1. **Push this folder to a new GitHub repo:**

   ```bash
   git init
   git add .
   git commit -m "Aegis frontend"
   git branch -M main
   git remote add origin https://github.com/<you>/<repo>.git
   git push -u origin main
   ```

2. **Import it in Vercel:**
   - vercel.com → *Add New* → *Project* → import the GitHub repo.
   - Framework preset: Vercel auto-detects Next.js, no changes needed.

3. **Add the contract address + network as environment variables:**
   - In the Vercel project → *Settings* → *Environment Variables*.
   - `NEXT_PUBLIC_AEGIS_CONTRACT_ADDRESS` — the address from
     `genlayer deploy --contract intelligent-contracts/aegis.py`.
   - `NEXT_PUBLIC_AEGIS_NETWORK` — `studionet` or `testnet-bradbury`
     (see the live addresses in `docs/DEPLOYMENT.md`).
   - Apply to Production (and Preview if you want preview deploys to work
     against the same contract).
   - **Redeploy** after adding them — Next.js inlines `NEXT_PUBLIC_*` vars at
     build time, so a running deployment won't pick up a newly-added one
     until it rebuilds.

4. Every subsequent `git push` to `main` triggers a new Vercel deployment
   automatically.

## If you redeploy the contract later

Contract addresses are per-deployment and per-network. If you redeploy
`aegis.py` (fresh state, new address), update the Vercel env vars and redeploy
the frontend — nothing else in this app needs to change, since the address and
network are the only things that are environment-specific.

## Notes on what's deliberately not built yet

- **Withdraw as an LP** is wired in `lib/aegisClient.ts` (`withdraw(account,
  tier, shares)`) but has no dedicated UI panel in this first pass — the
  deposit/pool-status panels were the priority to get you testing end to
  end. Adding a withdraw form is a small addition to `app/page.tsx` whenever
  you want it.
- **Evidence hashes** (`spec_hash` / `deliverable_hash`) are passed through
  as plain strings to the contract, which appends them to a fixed IPFS
  gateway. If you're testing with plain HTTPS URLs instead (see
  `STUDIO_TESTING.md` from the contract package), that's fine — the
  frontend doesn't validate the format, it just passes through whatever the
  contract expects.
