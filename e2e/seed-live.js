// Aegis — seed live activity on StudioNet so the war-room board reads real data.
//
// Registers a fresh agent, funds every tier pool (underwriting), then issues a
// 1 GEN policy on the agent so the hero shows a locked-exposure sliver + live
// cover. Reuses the low-level client from run.js (same signing/retry model).
//
// Usage (from the repo root):  node e2e/seed-live.js
//
// StudioNet is gasless; all value here is free test GEN. Writes are sequential
// and polled to completion, so we stay inside the ~60 req/min rate limit.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createAccount, generatePrivateKey } from "genlayer-js";
import { loadOrGenKeys, accountsFromKeys, makeNetwork } from "./run.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Fixed amounts (atto GEN) — mirrors run.js.
const GEN = 10n ** 18n;
const COVERAGE = GEN; // 1 GEN
const SPEC_CID = "Qm" + "a".repeat(44); // content never fetched (auto-breach path)
const DEPOSITS = {
  unrated: 10n * GEN,
  bronze: 5n * GEN,
  silver: 3n * GEN,
  gold: 2n * GEN,
};
const DEADLINE_S = 3600; // strictly future; breach only matters if left unclaimed for an hour

const genFmt = (v) => (Number(typeof v === "bigint" ? v : BigInt(v)) / 1e18).toFixed(4) + " GEN";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const keys = loadOrGenKeys(false);
  const accs = accountsFromKeys(keys);
  const m = makeNetwork("studionet");
  const suffix = `live-${Date.now()}`;

  // A fresh agent wallet — accs.agent is already permanently bound to an
  // e2e agent id (one address → one agent forever), so this key is separate.
  const livePk = generatePrivateKey();
  const liveAcc = createAccount(livePk);
  const liveWallet = { address: liveAcc.address, account: liveAcc }; // same shape as keys.json roles
  const agentId = `agent-${suffix}`;
  fs.writeFileSync(
    path.join(__dirname, "live-keys.json"),
    JSON.stringify({ role: "live", pk: livePk, address: liveAcc.address.toLowerCase(), agentId }, null, 2)
  );

  const write = async (acc, fn, args, value, label) => {
    const r = await m.submitAndWait(acc.account, fn, args, value);
    console.log(`[${r.ok ? "PASS" : r.undetermined ? "UNDETERMINED" : "REVERTED"}] ${label} -- ${r.hash}`);
    return r;
  };

  console.log(`contract: ${m.address}`);
  console.log(`agentId:  ${agentId}  (wallet ${liveAcc.address})`);
  console.log(`LP/buyer roles from e2e/keys.json`);

  // 1) Register the agent (fresh wallet → fresh agent id).
  await write(liveWallet, "register", [agentId], 0n, "register live agent");
  let profile = await m.read("get_profile", [agentId]);
  console.log(`profile tier = ${profile?.tier}\n`);

  // 2) Fund every tier pool (underwriting) from the LP wallet.
  for (const [tier, amount] of Object.entries(DEPOSITS)) {
    await write(accs.lp, "deposit", [tier], amount, `LP deposit ${genFmt(amount)} into ${tier}`);
    await sleep(1500); // keep reads/writes under the rate limit
  }

  // 3) Board read-back after underwritings.
  console.log("\n--- tier pools after underwriting ---");
  for (const tier of Object.keys(DEPOSITS)) {
    const p = await m.read("get_pool_info", [tier]);
    console.log(`${tier.padEnd(7)} balance=${genFmt(p?.balance_atto)}  locked=${genFmt(p?.locked_exposure_atto)}`);
  }

  // 4) Quote, then issue 1 GEN of cover on the new agent (a real payable policy).
  const quote = await m.read("quote_premium", [agentId, COVERAGE]);
  console.log(`\nquote: tier=${quote?.tier} rate_bps=${quote?.rate_bps} premium=${genFmt(quote?.premium_atto)}`);
  const jobId = `job-${suffix}`;
  const deadline = new Date(Date.now() + DEADLINE_S * 1000).toISOString().replace(/\.\d{3}Z$/, ".000Z");
  await write(
    accs.buyer,
    "issue_policy",
    [jobId, agentId, COVERAGE, SPEC_CID, deadline],
    quote?.premium_atto ?? 0n,
    `issue ${jobId} (payable ${genFmt(quote?.premium_atto)} premium)`
  );

  // 5) Final board state: Unrated now carries the locked-exposure sliver.
  const pol = await m.read("get_policy", [jobId]);
  const unrated = await m.read("get_pool_info", ["unrated"]);
  console.log("\n--- final board state ---");
  console.log(`policy ${jobId}: status=${pol?.status} agent_id=${pol?.agent_id} deadline=${pol?.deadline}`);
  console.log(
    `unrated balance=${genFmt(unrated?.balance_atto)} locked=${genFmt(unrated?.locked_exposure_atto)}`
  );
  console.log("\nLive board should now read:");
  console.log(`  Unrated  10.0000 GEN   (locked sliver 1.0000 GEN)`);
  console.log(`  Bronze    5.0000 GEN`);
  console.log(`  Silver    3.0000 GEN`);
  console.log(`  Gold      2.0000 GEN`);
  console.log(`\nagentId: ${agentId}`);
  console.log(`jobId:   ${jobId}   <- the live policy (deadline ~1h out)`);
}

main().catch((e) => {
  console.error("FATAL:", e?.message || e);
  console.error(e?.stack || "");
  process.exit(1);
});
