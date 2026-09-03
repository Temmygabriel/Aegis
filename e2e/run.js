// Aegis real-network end-to-end harness (StudioNet + Bradbury).
// Mirrors frontend/lib/aegisClient.ts + identity.ts: signs locally with
// genlayer-js accounts created from private keys WE hold (the viem
// private-key trap: persist our own copy, rebuild via createAccount(key)).
//
// Usage:
//   node run.js keys [--force]          create/refresh e2e/keys.json + print addresses
//   node run.js deploy --network <n>    deploy intelligent-contracts/aegis.py via the CLI,
//                                       record the address in results/<n>.address
//   node run.js probe --network <n> [--address <hex>]   minimal register + raw shape
//   node run.js e2e   --network <n> [--address <hex>]   full deterministic scenario
//
// StudioNet does not enforce balances (free value). Bradbury needs the role
// addresses funded with GEN from the 'default' account first (see funding
// amounts printed by `keys`).

import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createAccount, createClient, generatePrivateKey } from "genlayer-js";
import { studionet, testnetBradbury } from "genlayer-js/chains";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KEYS_FILE = path.join(__dirname, "keys.json");
const RESULTS_DIR = path.join(__dirname, "results");
const CONTRACT_PATH = path.join(__dirname, "..", "intelligent-contracts", "aegis.py");

// ---------------------------------------------------------------------------
// Networks (default canonical addresses come from docs/DEPLOYMENT.md)
// ---------------------------------------------------------------------------
const NETS = {
  studionet: {
    label: "StudioNet",
    address: "0x605e5BE4a8013B2B6c70c4BECa3CEbB7BD7918e4",
    chain: studionet,
    needsFunding: false,
  },
  bradbury: {
    label: "Bradbury",
    address: "0x79C15889D5070321176994373C440778a9eC47c1",
    chain: testnetBradbury,
    needsFunding: true,
  },
};

// Fixed amounts (atto GEN) -- mirrors tests/direct/test_aegis.py.
const GEN = 10n ** 18n;
const CLAIM_BOND = 2n * GEN;
const MIN_COVERAGE = 10n ** 16n;
const COVERAGE = GEN; // 1 GEN per policy
const PREMIUM_UNRATED = (COVERAGE * 600n) / 10000n; // 0.06 GEN
const LP_DEPOSIT = 20n * GEN;

const ROLES = ["lp", "agent", "buyer"];
const FUNDING_GEN = { lp: "25", agent: "3", buyer: "15" };

// Numeric coercion: readContract returns u256 values as JS numbers/strings,
// never bigint (so `x === 20n * GEN` always fails). All our amounts are exact
// 10^18-scaled integers, so BigInt(v) is lossless.
const toBig = (v) => (typeof v === "bigint" ? v : BigInt(v));
const EQ = (got, wantBig) => toBig(got) === wantBig;
const genFmt = (v) => (Number(toBig(v)) / 1e18).toFixed(4) + " GEN";

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------
export function loadOrGenKeys(force = false) {
  if (!force && fs.existsSync(KEYS_FILE)) {
    return JSON.parse(fs.readFileSync(KEYS_FILE, "utf8"));
  }
  const out = {};
  for (const role of ROLES) {
    const pk = generatePrivateKey();
    const account = createAccount(pk);
    out[role] = { pk, address: account.address.toLowerCase() };
  }
  fs.writeFileSync(KEYS_FILE, JSON.stringify(out, null, 2));
  return out;
}

export function accountsFromKeys(keys) {
  const accs = {};
  for (const role of ROLES) {
    accs[role] = { address: keys[role].address, account: createAccount(keys[role].pk) };
  }
  return accs;
}

// ---------------------------------------------------------------------------
// Low-level client helpers with retry (StudioNet is flaky; rate-limit aware)
// ---------------------------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function withRetry(fn, { retries = 6, base = 900, label = "" } = {}) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const msg = String(e?.message || e);
      const transient =
        /fetch failed|ECONNRESET|invalid session|socket|network|timeout|429|rate/i.test(msg);
      if (!transient) throw e; // real failure (e.g. consensus revert) -- don't retry
      if (i < retries - 1) {
        await sleep(base * (i + 1));
      }
    }
  }
  throw lastErr;
}

/** Address priority: --address CLI flag > recorded last deploy > canonical. */
function desiredAddress(netName) {
  const flag = argvFlag("--address");
  if (flag) return flag;
  const f = path.join(RESULTS_DIR, `${netName}.address`);
  if (fs.existsSync(f)) return fs.readFileSync(f, "utf8").trim();
  return NETS[netName].address;
}

export function makeNetwork(netName) {
  const net = NETS[netName];
  if (!net) throw new Error(`unknown network ${netName} (use studionet|bradbury)`);
  const address = desiredAddress(netName);
  const readClient = createClient({ chain: net.chain });
  const writeClients = {}; // per-account, so nonces stay per-account

  async function read(fnName, args = []) {
    return withRetry(
      () =>
        readClient.readContract({
          address,
          functionName: fnName,
          args,
        }),
      { label: `read ${fnName}` }
    );
  }

  function writeClientFor(account) {
    const key = account.address.toLowerCase();
    if (!writeClients[key]) {
      writeClients[key] = createClient({ chain: net.chain, account });
    }
    return writeClients[key];
  }

  /**
   * Submit + wait until the tx reaches a decided status. Never throws on a
   * consensus revert -- returns { ok, reverted, receipt, status }.
   *
   * Outcome rule (validated against ground-truth receipts on StudioNet):
   * a reverted call STILL finalizes as ACCEPTED/FINALIZED with result_name
   * "MAJORITY_AGREE". The truth is per-validator: `consensus_data.validators[]`
   * (or the genlayer-js `leader_receipt[]` when validators[] is absent), each
   * with execution_result + vote. Only entries that voted **agree** decide the
   * committed outcome: reverted <=> an agreeing validator's execution_result
   * is "ERROR". Idle validators routinely report execution_result "ERROR" (they
   * timed out / failed to run) and must be ignored -- scanning "any ERROR"
   * mislabels successful submits as reverted.
   */
  async function submitAndWait(account, fnName, args, value = 0n) {
    const client = writeClientFor(account);
    const hash = await withRetry(
      () =>
        client.writeContract({
          address,
          functionName: fnName,
          args,
          value,
        }),
      { retries: 4, label: `write ${fnName}` }
    );
    // Manual poll: getTransaction until the outcome is decided.
    let receipt;
    let decided = false;
    for (let i = 0; i < 180; i++) {
      let tx;
      try {
        tx = await client.getTransaction({ hash });
      } catch (e) {
        if (!/fetch failed|ECONNRESET|socket/i.test(String(e?.message || e))) throw e;
        await sleep(1500);
        continue;
      }
      receipt = tx;
      const st = String(tx?.status ?? "");
      const stName = String(tx?.statusName ?? "");
      if (/FINALIZED|DECIDED/.test(stName) || /FINALIZED|DECIDED/.test(st)) break;
      if (/ACCEPTED/.test(stName) || /ACCEPTED/.test(st)) {
        // Agree-votes are set once consensus commits; don't wait forever on a
        // slow StudioNet finalization, but prefer a settled view.
        if (i >= 10) break;
      }
      if (/ERROR|CANCELED|TIMEOUT|UNDETERMINED|UNINITIALIZED/.test(stName) && i > 5) break;
      await sleep(2000);
    }
    if (!decided && !receipt) throw new Error(`Timed out waiting for ${fnName} (${hash})`);

    let cd = receipt?.consensus_data;
    if (typeof cd === "string") {
      try {
        cd = JSON.parse(cd);
      } catch {
        cd = null;
      }
    }
    const raw = Array.isArray(cd?.validators)
      ? cd.validators
      : Array.isArray(cd?.leader_receipt)
        ? cd.leader_receipt
        : [];
    const seen = raw.map((e) => ({
      result: e?.execution_result ?? e?.genvm_result?.execution_result ?? null,
      vote: e?.vote ?? null,
      mode: e?.mode ?? null,
    }));
    const agreeing = seen.filter((e) => e?.vote === "agree");
    // Bradbury carries no consensus_data: numeric txExecutionResult tells all.
    // 1=FINISHED_WITH_RETURN (success), 2=FINISHED_WITH_ERROR (revert),
    // 0=NOT_VOTED. A LEADER_TIMEOUT / IDLE / NOT_VOTED tx reached NO verdict.
    const execNum = receipt?.txExecutionResult;
    const execNm = String(receipt?.txExecutionResultName ?? "");
    const stName = String(receipt?.statusName ?? "");
    const rName = String(receipt?.resultName ?? "");
    const leaderErr = seen.some((e) => e?.mode === "leader" && e?.result === "ERROR");
    let reverted, undetermined;
    if (agreeing.length) {
      // StudioNet: only the agreeing validators decide the committed outcome.
      reverted = agreeing.some((e) => e?.result === "ERROR");
      undetermined = false;
    } else if (execNum === 2 || /FINISHED_WITH_ERROR/.test(execNm) || leaderErr) {
      reverted = true;
      undetermined = false;
    } else if (execNum === 1 && /AGREE/.test(rName)) {
      reverted = false;
      undetermined = false; // Bradbury success
    } else if (/LEADER_TIMEOUT|TIMEOUT/.test(stName) || /IDLE|NOT_VOTED/.test(rName) || execNum === 0) {
      reverted = false;
      undetermined = true; // no verdict reached -- never report as ok
    } else {
      reverted = leaderErr;
      undetermined = false;
    }
    const execName = reverted
      ? "FINISHED_WITH_ERROR"
      : undetermined
        ? `UNDETERMINED(${stName}/${rName})`
        : agreeing.length
          ? `AGREE[${agreeing.map((e) => e?.result).join(",")}]`
          : "OK";
    return {
      ok: !reverted && !undetermined,
      reverted,
      undetermined,
      execName,
      status: stName,
      hash,
      receipt,
    };
  }

  return { net, address, read, submitAndWait };
}

// ---------------------------------------------------------------------------
// Step bookkeeping
// ---------------------------------------------------------------------------
const results = [];
function step(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  const mark = ok ? "PASS" : "FAIL";
  console.log(`[${mark}] ${name}${detail !== undefined ? ` -- ${detail}` : ""}`);
}

// ---------------------------------------------------------------------------
// Scenario helpers
// ---------------------------------------------------------------------------
function futureIso(secondsFromNow) {
  return new Date(Date.now() + secondsFromNow * 1000)
    .toISOString()
    .replace(/\.\d{3}Z$/, ".000Z");
}

const CID_OK = "Qm" + "b".repeat(44); // deliverable-shaped CID (see test file)
const CID_SPEC = "Qm" + "a".repeat(44);

async function runProbe(netName, keys) {
  const m = makeNetwork(netName);
  const accs = accountsFromKeys(keys);
  const agentId = `probe-${netName}-${Date.now()}`;
  const r = await m.submitAndWait(accs.agent.account, "register", [agentId], 0n);
  console.log("register submitAndWait =>", JSON.stringify(r, (k, v) => (typeof v === "bigint" ? v.toString() : v), 2));
  const p = await m.read("get_profile", [agentId]);
  console.log("profile =>", JSON.stringify(p, null, 2));
}

async function runE2E(netName, keys) {
  const m = makeNetwork(netName);
  const accs = accountsFromKeys(keys);
  const suffix = `${netName}-${Date.now()}`;
  const agentId = `e2e-agent-${suffix}`;
  const runId = suffix;
  const AGENT = accs.agent.address;
  const BUYER = accs.buyer.address;
  const LP = accs.lp.address;
  // Unique policy keys so repeated runs never collide on a shared address.
  const P = (k) => `${k}-${netName}-${Date.now()}`;

  const write = (acc, fn, args, value = 0n, expectRevert = false, label) =>
    m.submitAndWait(acc.account, fn, args, value).then((r) => {
      const ok = expectRevert ? r.reverted : r.ok;
      const why = r.reverted
        ? `reverted (${r.execName || r.status})`
        : `ok (${r.status})`;
      step(label || `${fn}`, ok, `${why} ${r.hash}`);
      return r;
    });

  // ---- Registration + network-time calibration ----
  await write(accs.agent, "register", [agentId], 0n, false, "register(agent)");
  let profile = await m.read("get_profile", [agentId]);
  step("profile reads unrated", profile?.tier === "unrated", `tier=${profile?.tier}`);
  const regAt = profile?.registered_at;
  const netOffsetMs = regAt ? Date.parse(regAt) - Date.now() : 0;
  step("registered_at captured", !!regAt, regAt);
  const calNow = () => Date.now() + netOffsetMs;

  // Duplicate register from the same address -> revert (address already bound).
  await write(accs.agent, "register", [`e2e-agent2-${suffix}`], 0n, true, "register(2nd id) reverts (address bound)");

  // ---- LP deposit ----
  await write(accs.lp, "deposit", ["unrated"], LP_DEPOSIT, false, "lp deposit 20 GEN");
  let pool = await m.read("get_pool_info", ["unrated"]);
  step("pool balance = 20 GEN", EQ(pool?.balance_atto, LP_DEPOSIT), `balance=${genFmt(pool?.balance_atto)}`);
  step("pool shares = 20 GEN", EQ(pool?.total_shares, LP_DEPOSIT), `shares=${genFmt(pool?.total_shares)}`);
  const lpPos = await m.read("get_lp_position", ["unrated", LP]);
  step("lp position = 20 GEN", EQ(lpPos, LP_DEPOSIT), `pos=${genFmt(lpPos)}`);

  // ---- Quote ----
  const quote = await m.read("quote_premium", [agentId, COVERAGE]);
  step(
    "quote = unrated/600 bps/0.06 GEN",
    quote?.tier === "unrated" && EQ(quote?.rate_bps, 600n) && EQ(quote?.premium_atto, PREMIUM_UNRATED),
    `tier=${quote?.tier} rate=${quote?.rate_bps} premium=${genFmt(quote?.premium_atto)}`
  );

  // ---- Policies (short deadlines so the whole run settles in one wait) ----
  // Deadline must comfortably outlive the pre-wait write block (slow StudioNet),
  // yet be short enough that one sleep finishes the run. 240s balances both.
  const DEADLINE_S = 240;
  const dl = (s) => {
    const ms = Date.now() + s * 1000;
    lastDeadlineMs = Math.max(lastDeadlineMs, ms);
    return new Date(ms).toISOString().replace(/\.\d{3}Z$/, ".000Z");
  };
  let lastDeadlineMs = 0;
  const deadlineShort = dl(DEADLINE_S);
  const pSubmit = P("job-submit");
  const pClaim = P("job-claim");
  const pPast = P("job-past");

  await write(
    accs.buyer,
    "issue_policy",
    [pSubmit, agentId, COVERAGE, CID_SPEC, deadlineShort],
    PREMIUM_UNRATED,
    false,
    "issue job-submit (payable)"
  );
  await write(accs.agent, "submit_deliverable", [pSubmit, CID_OK], 0n, false, "agent submits deliverable");
  const polSubmit = await m.read("get_policy", [pSubmit]);
  step(
    "job-submit policy fields",
    polSubmit?.status === "active" && polSubmit?.deliverable_hash === CID_OK && polSubmit?.agent_id === agentId.toLowerCase(),
    `status=${polSubmit?.status} deliv=${polSubmit?.deliverable_hash}`
  );

  await write(
    accs.buyer,
    "issue_policy",
    [pClaim, agentId, COVERAGE, CID_SPEC, deadlineShort],
    PREMIUM_UNRATED,
    false,
    "issue job-claim (payable)"
  );

  let profile2 = await m.read("get_profile", [agentId]);
  step("jobs_insured = 2", EQ(profile2?.jobs_insured, 2n), `jobs=${profile2?.jobs_insured}`);
  step("distinct_buyers = 1", EQ(profile2?.distinct_buyers, 1n), `buyers=${profile2?.distinct_buyers}`);

  pool = await m.read("get_pool_info", ["unrated"]);
  step(
    "pool = 20 + 2 premiums, locked = 2",
    EQ(pool?.balance_atto, LP_DEPOSIT + PREMIUM_UNRATED * 2n) && EQ(pool?.locked_exposure_atto, COVERAGE * 2n),
    `balance=${genFmt(pool?.balance_atto)} locked=${genFmt(pool?.locked_exposure_atto)}`
  );

  // ---- Negative / gate checks (expect reverts) ----
  await write(
    accs.buyer,
    "issue_policy",
    [pPast, agentId, COVERAGE, CID_SPEC, futureIso(-3600)],
    PREMIUM_UNRATED,
    true,
    "issue with past deadline reverts"
  );
  await write(accs.buyer, "file_claim", [pClaim], CLAIM_BOND, true, "premature claim (pre-deadline, no deliverable) reverts");
  await write(accs.lp, "withdraw", ["unrated", LP_DEPOSIT], 0n, true, "full LP withdraw under locked exposure reverts");

  // ---- Wait until every issued policy is strictly past its deadline ----
  // Buffer for the contract's own clock: if it lags wall clock (negative
  // netOffset) the on-chain deadline arrives later, so wait that much extra.
  const waitMs = Math.max(0, lastDeadlineMs + Math.max(0, -netOffsetMs) - Date.now()) + 30000;
  console.log(`\n[wait] sleeping ~${Math.round(waitMs / 1000)}s for policy deadlines to pass...`);
  await sleep(waitMs);

  // ---- Expire path: buyer closes job-submit after deadline (exposure released) ----
  await write(accs.buyer, "expire_policy", [pSubmit], 0n, false, "buyer expires job-submit (deadline passed)");
  pool = await m.read("get_pool_info", ["unrated"]);
  step("locked exposure = 1 (only job-claim left)", EQ(pool?.locked_exposure_atto, COVERAGE), `locked=${genFmt(pool?.locked_exposure_atto)}`);

  // ---- Deterministic auto-breach claim (no deliverable, deadline passed) ----
  await write(accs.buyer, "file_claim", [pClaim], CLAIM_BOND, false, "file_claim after deadline -> auto-breach");
  const status = await m.read("get_claim_status", [pClaim]);
  step("claim status = upheld", status === "upheld", `status=${status}`);
  const polClaim = await m.read("get_policy", [pClaim]);
  step("policy status = claimed", polClaim?.status === "claimed", `status=${polClaim?.status}`);
  pool = await m.read("get_pool_info", ["unrated"]);
  // After payout (1 GEN, within 10% cap) + expire of job-submit (no transfer):
  // balance = 20 + 2*premium - coverage
  const expectedBal = LP_DEPOSIT + PREMIUM_UNRATED * 2n - COVERAGE;
  step(
    "pool paid coverage, exposure released",
    EQ(pool?.balance_atto, expectedBal) && EQ(pool?.locked_exposure_atto, 0n),
    `balance=${genFmt(pool?.balance_atto)} (want ${genFmt(expectedBal)}) locked=${genFmt(pool?.locked_exposure_atto)}`
  );

  let profile3 = await m.read("get_profile", [agentId]);
  step(
    "agent claim counters",
    EQ(profile3?.claims_filed_against, 1n) && EQ(profile3?.claims_upheld_against, 1n),
    `filed=${profile3?.claims_filed_against} upheld=${profile3?.claims_upheld_against}`
  );

  // ---- LP full withdraw (all exposure now released) ----
  await write(accs.lp, "withdraw", ["unrated", LP_DEPOSIT], 0n, false, "LP withdraws everything");
  pool = await m.read("get_pool_info", ["unrated"]);
  step(
    "pool drained to 0",
    EQ(pool?.balance_atto, 0n) && EQ(pool?.total_shares, 0n),
    `balance=${genFmt(pool?.balance_atto)} shares=${genFmt(pool?.total_shares)}`
  );

  // ---- Report ----
  const failed = results.filter((r) => !r.ok);
  console.log(`\n=== ${netName.toUpperCase()} E2E on ${m.address}: ${results.length - failed.length}/${results.length} steps passed ===`);
  if (failed.length) console.log("FAILED:", failed.map((f) => f.name).join(", "));
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(RESULTS_DIR, `${netName}.json`),
    JSON.stringify(
      { network: netName, contract: m.address, agent: agentId, account: { lp: LP, agent: AGENT, buyer: BUYER }, results },
      null,
      2
    )
  );
  return failed.length === 0;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function argvFlag(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function runGenlayer(args) {
  return new Promise((resolve, reject) => {
    execFile("genlayer", args, { maxBuffer: 20 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(new Error((stderr || stdout || err.message).trim().slice(0, 2000)));
      resolve(stdout);
    });
  });
}

const isMain =
  process.argv[1] &&
  path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);
const cmd = process.argv[2];
const network = argvFlag("--network") || "studionet";

async function deployTo(netName) {
  const net = NETS[netName];
  const out = await runGenlayer(["network", "set", netName === "bradbury" ? "testnet-bradbury" : "studionet"]);
  const deployOut = await runGenlayer(["deploy", "--contract", CONTRACT_PATH]);
  const m = deployOut.match(/'Contract Address':\s*'(0x[0-9a-fA-F]{40})'/i);
  if (!m) throw new Error(`could not parse contract address from deploy output:\n${deployOut}`);
  const addr = m[1];
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.writeFileSync(path.join(RESULTS_DIR, `${netName}.address`), addr);
  console.log(`Deployed ${net.label} aegis.py -> ${addr}`);
  return addr;
}

async function main() {
  if (cmd === "keys") {
    const keys = loadOrGenKeys(process.argv.includes("--force"));
    console.log("Addresses (keys.json):");
    for (const role of ROLES) {
      console.log(`  ${role}: ${keys[role].address}`);
    }
    if (NETS[network].needsFunding) {
      console.log(`\nFund these on Bradbury from 'default' (network set to testnet-bradbury):`);
      for (const role of ROLES) {
        console.log(`  genlayer account send ${keys[role].address} ${FUNDING_GEN[role]}`);
      }
    }
    return;
  }
  if (cmd === "deploy") {
    await deployTo(network);
    return;
  }
  if (cmd === "probe") {
    const keys = loadOrGenKeys(false);
    await runProbe(network, keys);
    return;
  }
  if (cmd === "e2e") {
    const keys = loadOrGenKeys(false);
    const ok = await runE2E(network, keys);
    process.exit(ok ? 0 : 1);
  }
  console.error("usage: node run.js keys|deploy|probe|e2e [--network studionet|bradbury] [--address <hex>] [--force]");
  process.exit(2);
}

if (isMain) {
  main().catch((e) => {
    console.error("FATAL:", e?.message || e);
    process.exit(1);
  });
}
