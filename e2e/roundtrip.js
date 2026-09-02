// Cost-safe Bradbury roundtrip (user-approved, 1 GEN):
// fresh deploy -> LP deposit 1 GEN -> pool/position read back ->
// LP withdraw 1 GEN -> pool drained to 0. Proves value moves IN and
// RETURNS on a successful payable pair, with only 1 GEN at risk.
//
//   node roundtrip.js --network bradbury
//
// Reuses run.js helpers so outcome detection (numeric txExecutionResult
// on Bradbury) is identical to the main harness.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadOrGenKeys, accountsFromKeys, makeNetwork } from "./run.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = path.join(__dirname, "results");

const GEN = 10n ** 18n;
const toBig = (v) => (typeof v === "bigint" ? v : BigInt(v));
const EQ = (got, wantBig) => toBig(got) === wantBig;
const genFmt = (v) => (Number(toBig(v)) / 1e18).toFixed(4) + " GEN";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function step(name, ok, detail) {
  results.push({ name, ok: !!ok });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name}${detail !== undefined ? ` -- ${detail}` : ""}`);
}

async function runRoundtrip(netName, keys) {
  const m = makeNetwork(netName);
  const lp = accountsFromKeys(keys).lp;
  const ADDR = m.address;
  const DEP = 1n * GEN;

  console.log(`\n=== ${m.net.label} value roundtrip on ${ADDR} (LP ${lp.address}) ===`);

  // 1. Deposit 1 GEN (the only value at risk). Expect success: numeric
  //    txExecutionResult=1 / FINALIZED / AGREE on Bradbury.
  const dep = await m.submitAndWait(lp.account, "deposit", ["unrated"], DEP);
  step(
    "deposit 1 GEN succeeds",
    dep.ok,
    `${dep.reverted ? "reverted" : dep.undetermined ? "undetermined" : "ok"} (${dep.execName}/${dep.status}) ${dep.hash}`
  );

  // If the deposit did not land, stop -- do not withdraw on unknown state.
  if (!dep.ok) {
    console.log(`\nABORT: deposit did not land (${dep.execName}). Stopping; no withdraw attempted.`);
    fs.writeFileSync(path.join(RESULTS_DIR, `${netName}-roundtrip.log`), results.map((r) => `[${r.ok ? "PASS" : "FAIL"}] ${r.name}`).join("\n") + "\n");
    return false;
  }

  // 2. Read back pool + position.
  const poolIn = await m.read("get_pool_info", ["unrated"]);
  step(
    "pool balance = 1 GEN",
    EQ(poolIn?.balance_atto, DEP),
    `balance=${genFmt(poolIn?.balance_atto)}`
  );
  step(
    "pool shares = 1 GEN",
    EQ(poolIn?.total_shares, DEP),
    `shares=${genFmt(poolIn?.total_shares)}`
  );
  const pos = await m.read("get_lp_position", ["unrated", lp.address]);
  step("lp position = 1 GEN", EQ(pos, DEP), `pos=${genFmt(pos)}`);

  // 3. Withdraw everything back. Value returns to LP on success.
  const wd = await m.submitAndWait(lp.account, "withdraw", ["unrated", DEP], 0n);
  step(
    "withdraw 1 GEN succeeds",
    wd.ok,
    `${wd.reverted ? "reverted" : wd.undetermined ? "undetermined" : "ok"} (${wd.execName}/${wd.status}) ${wd.hash}`
  );

  // 4. Pool drained back to 0.
  const poolOut = await m.read("get_pool_info", ["unrated"]);
  step(
    "pool drained to 0",
    EQ(poolOut?.balance_atto, 0n) && EQ(poolOut?.total_shares, 0n),
    `balance=${genFmt(poolOut?.balance_atto)} shares=${genFmt(poolOut?.total_shares)}`
  );
  const posOut = await m.read("get_lp_position", ["unrated", lp.address]);
  step("lp position back to 0", EQ(posOut, 0n), `pos=${genFmt(posOut)}`);

  const failed = results.filter((r) => !r.ok);
  fs.writeFileSync(
    path.join(RESULTS_DIR, `${netName}-roundtrip.log`),
    results.map((r) => `[${r.ok ? "PASS" : "FAIL"}] ${r.name}`).join("\n") + "\n"
  );
  const verdict = failed.length === 0 ? "PASS" : "FAIL";
  console.log(`\n=== ${m.net.label} ROUNDTRIP on ${ADDR}: ${results.length - failed.length}/${results.length} steps passed ===`);
  return failed.length === 0;
}

// CLI
function argvFlag(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const network = argvFlag("--network") || "bradbury";

const keys = loadOrGenKeys(false);
runRoundtrip(network, keys)
  .then((ok) => process.exit(ok ? 0 : 1))
  .catch((e) => {
    console.error("FATAL:", e?.message || e);
    process.exit(1);
  });
