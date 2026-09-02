"""Direct-mode (in-memory, leader-only) tests for intelligent-contracts/aegis.py.

Covers every public method plus the gaming/security vectors the contract
documents it defends against. Claim judgement is mocked: web fetches (spec /
deliverable from the IPFS gateway) and the LLM score are stubbed, so the
deterministic gate + payout logic are exercised without real consensus.

Fixture roles used throughout:
  direct_alice  -- LP (underwrites a tier)
  direct_bob    -- the insured agent
  direct_charlie-- the main buyer
  direct_owner  -- a second buyer / extra account

Run:  python -m pytest tests/direct/test_aegis.py -v
"""

import json

# ---------------------------------------------------------------------------
# Constants + helpers
# ---------------------------------------------------------------------------

CLAIM_BOND = 2 * 10**18
MIN_COVERAGE = 10**16

# Content-addressed CIDs (valid CIDv0 shape: 46 chars, base58, starts "Qm").
SPEC = "Qm" + "a" * 44
DELIV_OK = "Qm" + "b" * 44
DELIV_BAD = "Qm" + "c" * 44
# A mutable URL -- must be rejected by _looks_like_content_hash.
MUTABLE_URL = "https://gist.github.com/someone/edit"

T0 = "2026-01-01T00:00:00Z"
T_PLUS_4 = "2026-01-05T00:00:00Z"
DEADLINE = "2026-03-01T00:00:00Z"
PAST_DEADLINE = "2025-12-01T00:00:00Z"

RATE_BPS = {"unrated": 600, "bronze": 400, "silver": 250, "gold": 150}


def premium_for(coverage_atto: int, tier: str) -> int:
    return (coverage_atto * RATE_BPS[tier]) // 10000


def addr_str(b: bytes) -> str:
    """Canonical lowercase address string (the contract lowercases it anyway
    via _normalize_key before using it as a storage key)."""
    return "0x" + b.hex()


def register(direct_vm, contract, account, agent_id):
    direct_vm.sender = account
    contract.register(agent_id)


def deposit(direct_vm, contract, account, tier, amount_atto):
    direct_vm.sender = account
    direct_vm.value = amount_atto
    contract.deposit(tier)


def issue_policy(direct_vm, contract, buyer, job_id, agent_id, coverage_atto,
                 spec, deadline, premium_atto):
    direct_vm.sender = buyer
    direct_vm.value = premium_atto
    contract.issue_policy(job_id, agent_id, coverage_atto, spec, deadline)


def fund_accounts(direct_vm, *accounts, amount=1000 * 10**18):
    for acc in accounts:
        direct_vm.deal(acc, amount)


def setUpPoolAndAgent(direct_vm, contract, lp, agent_acct, buyer_acct):
    """Common happy-path setup: LP funds 'unrated', agent registers."""
    fund_accounts(direct_vm, lp, agent_acct, buyer_acct)
    direct_vm.warp(T0)
    deposit(direct_vm, contract, lp, "unrated", 20 * 10**18)
    register(direct_vm, contract, agent_acct, "agent-a")


# ---------------------------------------------------------------------------
# Registration
# ---------------------------------------------------------------------------

def test_register_and_get_profile(direct_vm, direct_deploy, direct_bob):
    contract = direct_deploy("intelligent-contracts/aegis.py")
    direct_vm.warp(T0)
    register(direct_vm, contract, direct_bob, "Agent-Bob")

    p = contract.get_profile("agent-bob")  # normalized lookup works
    assert p["display_name"] == "Agent-Bob"  # as-typed kept for display
    assert p["tier"] == "unrated"
    assert p["jobs_insured"] == 0
    assert p["registered_at"] == T0

    # agent_id_for_address round-trips (uses the checksummed form from owner)
    assert contract.agent_id_for_address(p["owner"]) == "agent-bob"


def test_register_rejects_duplicate_and_bound_address(
    direct_vm, direct_deploy, direct_bob, direct_charlie
):
    contract = direct_deploy("intelligent-contracts/aegis.py")
    register(direct_vm, contract, direct_bob, "agent-a")

    with direct_vm.expect_revert("already registered"):
        register(direct_vm, contract, direct_charlie, "agent-a")

    with direct_vm.expect_revert("address already bound"):
        register(direct_vm, contract, direct_bob, "agent-b")


def test_register_case_variant_is_same_identity(
    direct_vm, direct_deploy, direct_bob
):
    """Case-variant squatting must be closed: 'Agent-A' == 'agent-a'."""
    contract = direct_deploy("intelligent-contracts/aegis.py")
    register(direct_vm, contract, direct_bob, "Agent-A")
    with direct_vm.expect_revert("already registered"):
        register(direct_vm, contract, direct_bob, "agent-a")


def test_register_empty_id_rejected(direct_vm, direct_deploy, direct_bob):
    contract = direct_deploy("intelligent-contracts/aegis.py")
    with direct_vm.expect_revert("cannot be empty"):
        register(direct_vm, contract, direct_bob, "   ")


# ---------------------------------------------------------------------------
# LP pools
# ---------------------------------------------------------------------------

def test_deposit_bootstrap_and_proportional_shares(
    direct_vm, direct_deploy, direct_alice, direct_charlie
):
    contract = direct_deploy("intelligent-contracts/aegis.py")
    fund_accounts(direct_vm, direct_alice, direct_charlie)

    deposit(direct_vm, contract, direct_alice, "unrated", 5 * 10**18)
    info = contract.get_pool_info("unrated")
    assert info["balance_atto"] == 5 * 10**18
    assert info["total_shares"] == 5 * 10**18  # 1:1 bootstrap
    assert contract.get_lp_position("unrated", addr_str(direct_alice)) == 5 * 10**18

    # Second LP buys in; shares mint proportionally.
    deposit(direct_vm, contract, direct_charlie, "unrated", 5 * 10**18)
    info = contract.get_pool_info("unrated")
    assert info["balance_atto"] == 10 * 10**18
    assert info["total_shares"] == 10 * 10**18


def test_deposit_invalid_tier_and_zero_value(
    direct_vm, direct_deploy, direct_alice
):
    contract = direct_deploy("intelligent-contracts/aegis.py")
    with direct_vm.expect_revert("unknown tier"):
        deposit(direct_vm, contract, direct_alice, "platinum", 5 * 10**18)

    direct_vm.sender = direct_alice
    direct_vm.value = 0
    with direct_vm.expect_revert("deposit must be > 0"):
        contract.deposit("unrated")


def test_withdraw_blocks_under_locked_exposure(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
):
    """LP cannot pull capital out from under live coverage."""
    contract = direct_deploy("intelligent-contracts/aegis.py")
    setUpPoolAndAgent(direct_vm, contract, direct_alice, direct_bob, direct_charlie)

    coverage = 10**18  # 1 GEN
    prem = premium_for(coverage, "unrated")
    issue_policy(direct_vm, contract, direct_charlie, "job-1", "agent-a",
                 coverage, SPEC, DEADLINE, prem)

    info = contract.get_pool_info("unrated")
    assert info["locked_exposure_atto"] == coverage
    assert info["balance_atto"] == 20 * 10**18 + prem

    # Withdrawing the full 20e18 shares would drop balance to 0 < locked.
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("withdrawal blocked"):
        contract.withdraw("unrated", 20 * 10**18)

    # Partial withdraw that keeps balance >= locked is fine.
    direct_vm.sender = direct_alice
    contract.withdraw("unrated", 5 * 10**18)
    info = contract.get_pool_info("unrated")
    assert info["total_shares"] == 15 * 10**18


def test_withdraw_release_after_policy_expires(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
):
    """Once the buyer expires the policy (deadline passed), exposure is
    released and the LP can fully withdraw."""
    contract = direct_deploy("intelligent-contracts/aegis.py")
    setUpPoolAndAgent(direct_vm, contract, direct_alice, direct_bob, direct_charlie)

    coverage = 10**18
    prem = premium_for(coverage, "unrated")
    issue_policy(direct_vm, contract, direct_charlie, "job-1", "agent-a",
                 coverage, SPEC, DEADLINE, prem)

    direct_vm.warp("2026-03-02T00:00:00Z")  # after deadline
    direct_vm.sender = direct_charlie
    contract.expire_policy("job-1")

    info = contract.get_pool_info("unrated")
    assert info["locked_exposure_atto"] == 0
    assert contract.get_policy("job-1")["status"] == "expired"

    # Now the LP can take everything out.
    direct_vm.sender = direct_alice
    contract.withdraw("unrated", 20 * 10**18)
    info = contract.get_pool_info("unrated")
    assert info["total_shares"] == 0


def test_expire_policy_requires_buyer_and_passed_deadline(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie, direct_owner
):
    contract = direct_deploy("intelligent-contracts/aegis.py")
    setUpPoolAndAgent(direct_vm, contract, direct_alice, direct_bob, direct_charlie)

    coverage = 10**18
    prem = premium_for(coverage, "unrated")
    issue_policy(direct_vm, contract, direct_charlie, "job-1", "agent-a",
                 coverage, SPEC, DEADLINE, prem)

    # Before the deadline -> not allowed.
    direct_vm.sender = direct_charlie
    with direct_vm.expect_revert("deadline has not passed"):
        contract.expire_policy("job-1")

    # After the deadline but from a non-buyer -> not allowed.
    direct_vm.warp("2026-03-02T00:00:00Z")
    direct_vm.sender = direct_owner
    with direct_vm.expect_revert("only the buyer"):
        contract.expire_policy("job-1")


# ---------------------------------------------------------------------------
# Policy issuance
# ---------------------------------------------------------------------------

def test_issue_policy_requires_pool_capital(
    direct_vm, direct_deploy, direct_bob, direct_charlie
):
    """Empty-pool first-depositor exploit must be closed: no capital, no policy."""
    contract = direct_deploy("intelligent-contracts/aegis.py")
    direct_vm.warp(T0)  # so DEADLINE reads as future; the pool check is the target
    fund_accounts(direct_vm, direct_bob, direct_charlie)
    register(direct_vm, contract, direct_bob, "agent-a")

    direct_vm.sender = direct_charlie
    direct_vm.value = premium_for(10**18, "unrated")
    with direct_vm.expect_revert("no underwriting capital"):
        contract.issue_policy("job-1", "agent-a", 10**18, SPEC, DEADLINE)


def test_issue_policy_rejects_url_and_min_coverage(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
):
    contract = direct_deploy("intelligent-contracts/aegis.py")
    setUpPoolAndAgent(direct_vm, contract, direct_alice, direct_bob, direct_charlie)

    # spec_hash must be a CID, not a mutable URL.
    with direct_vm.expect_revert("must be a content-addressed"):
        issue_policy(direct_vm, contract, direct_charlie, "job-1", "agent-a",
                     10**18, MUTABLE_URL, DEADLINE, premium_for(10**18, "unrated"))

    # Coverage below MIN_COVERAGE_ATTO.
    with direct_vm.expect_revert("at least"):
        issue_policy(direct_vm, contract, direct_charlie, "job-1", "agent-a",
                     MIN_COVERAGE - 1, SPEC, DEADLINE, 1)


def test_issue_policy_requires_exact_premium(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
):
    contract = direct_deploy("intelligent-contracts/aegis.py")
    setUpPoolAndAgent(direct_vm, contract, direct_alice, direct_bob, direct_charlie)

    coverage = 10**18
    exact = premium_for(coverage, "unrated")
    with direct_vm.expect_revert("premium must be exactly"):
        issue_policy(direct_vm, contract, direct_charlie, "job-1", "agent-a",
                     coverage, SPEC, DEADLINE, exact + 1)


def test_issue_policy_rejects_past_deadline(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
):
    """Gaming fix: an already-passed deadline must be rejected at issuance so
    a buyer can't instantly trigger the no-deliverable auto-breach."""
    contract = direct_deploy("intelligent-contracts/aegis.py")
    setUpPoolAndAgent(direct_vm, contract, direct_alice, direct_bob, direct_charlie)

    with direct_vm.expect_revert("deadline must be a future timestamp"):
        issue_policy(direct_vm, contract, direct_charlie, "job-1", "agent-a",
                     10**18, SPEC, PAST_DEADLINE, premium_for(10**18, "unrated"))


def test_issue_policy_locks_exposure_and_counts_buyer_once(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
):
    """Same buyer across multiple jobs counts as ONE distinct buyer, and
    exposure locks pool capital behind live coverage."""
    contract = direct_deploy("intelligent-contracts/aegis.py")
    setUpPoolAndAgent(direct_vm, contract, direct_alice, direct_bob, direct_charlie)

    coverage = 10**18
    prem = premium_for(coverage, "unrated")
    issue_policy(direct_vm, contract, direct_charlie, "job-1", "agent-a",
                 coverage, SPEC, DEADLINE, prem)
    issue_policy(direct_vm, contract, direct_charlie, "job-2", "agent-a",
                 coverage, SPEC, DEADLINE, prem)

    p = contract.get_profile("agent-a")
    assert p["jobs_insured"] == 2
    assert p["distinct_buyers"] == 1  # same address counted once
    assert contract.get_pool_info("unrated")["locked_exposure_atto"] == 2 * coverage


def test_policy_idempotency_and_unknown_agent(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
):
    contract = direct_deploy("intelligent-contracts/aegis.py")
    setUpPoolAndAgent(direct_vm, contract, direct_alice, direct_bob, direct_charlie)

    with direct_vm.expect_revert("unknown agent_id"):
        issue_policy(direct_vm, contract, direct_charlie, "job-1", "ghost",
                     10**18, SPEC, DEADLINE, premium_for(10**18, "unrated"))

    coverage = 10**18
    prem = premium_for(coverage, "unrated")
    issue_policy(direct_vm, contract, direct_charlie, "job-1", "agent-a",
                 coverage, SPEC, DEADLINE, prem)
    with direct_vm.expect_revert("already exists"):
        issue_policy(direct_vm, contract, direct_charlie, "Job-1", "agent-a",
                     coverage, SPEC, DEADLINE, prem)  # case variant = same key


# ---------------------------------------------------------------------------
# Deliverable submission
# ---------------------------------------------------------------------------

def test_submit_deliverable_access_and_shape(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
):
    contract = direct_deploy("intelligent-contracts/aegis.py")
    setUpPoolAndAgent(direct_vm, contract, direct_alice, direct_bob, direct_charlie)

    coverage = 10**18
    prem = premium_for(coverage, "unrated")
    issue_policy(direct_vm, contract, direct_charlie, "job-1", "agent-a",
                 coverage, SPEC, DEADLINE, prem)

    # Only the insured agent may submit.
    direct_vm.sender = direct_charlie
    with direct_vm.expect_revert("only the insured agent"):
        contract.submit_deliverable("job-1", DELIV_OK)

    # Must be a CID, not a URL.
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("must be a content-addressed"):
        contract.submit_deliverable("job-1", MUTABLE_URL)

    # Agent submits, and can overwrite before the claim is judged.
    direct_vm.sender = direct_bob
    contract.submit_deliverable("job-1", DELIV_BAD)
    contract.submit_deliverable("job-1", DELIV_OK)
    assert contract.get_policy("job-1")["deliverable_hash"] == DELIV_OK


def test_submit_deliverable_unknown_job(direct_vm, direct_deploy, direct_bob):
    contract = direct_deploy("intelligent-contracts/aegis.py")
    register(direct_vm, contract, direct_bob, "agent-a")
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("unknown job_id"):
        contract.submit_deliverable("job-nope", DELIV_OK)


# ---------------------------------------------------------------------------
# Claims
# ---------------------------------------------------------------------------

def test_claim_premature_without_deliverable(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
):
    contract = direct_deploy("intelligent-contracts/aegis.py")
    setUpPoolAndAgent(direct_vm, contract, direct_alice, direct_bob, direct_charlie)

    coverage = 10**18
    prem = premium_for(coverage, "unrated")
    issue_policy(direct_vm, contract, direct_charlie, "job-1", "agent-a",
                 coverage, SPEC, DEADLINE, prem)

    # Before the deadline and no deliverable -> premature.
    direct_vm.sender = direct_charlie
    direct_vm.value = CLAIM_BOND
    with direct_vm.expect_revert("deadline has not passed"):
        contract.file_claim("job-1")


def test_claim_auto_breach_when_no_deliverable_after_deadline(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
):
    """Agent never submitted anything + deadline passed = deterministic breach,
    full payout up to the pool cap, bond refunded, exposure released."""
    contract = direct_deploy("intelligent-contracts/aegis.py")
    setUpPoolAndAgent(direct_vm, contract, direct_alice, direct_bob, direct_charlie)

    coverage = 10**18
    prem = premium_for(coverage, "unrated")
    issue_policy(direct_vm, contract, direct_charlie, "job-1", "agent-a",
                 coverage, SPEC, DEADLINE, prem)

    direct_vm.warp("2026-03-02T00:00:00Z")  # after deadline, no deliverable
    direct_vm.sender = direct_charlie
    direct_vm.value = CLAIM_BOND
    contract.file_claim("job-1")

    assert contract.get_claim_status("job-1") == "upheld"
    assert contract.get_policy("job-1")["status"] == "claimed"
    assert contract.get_pool_info("unrated")["locked_exposure_atto"] == 0

    # Payout = full coverage (20e18 pool, 10% cap = 2e18 >= 1e18 coverage).
    info = contract.get_pool_info("unrated")
    assert info["balance_atto"] == 20 * 10**18 + prem - coverage


def test_claim_judged_upheld(direct_vm, direct_deploy, direct_alice, direct_bob,
                             direct_charlie):
    """Judged path: agent submitted a deliverable that DOES NOT meet spec ->
    LLM score below threshold -> breach upheld, payout + bond refund."""
    contract = direct_deploy("intelligent-contracts/aegis.py")
    setUpPoolAndAgent(direct_vm, contract, direct_alice, direct_bob, direct_charlie)

    coverage = 10**18
    prem = premium_for(coverage, "unrated")
    issue_policy(direct_vm, contract, direct_charlie, "job-1", "agent-a",
                 coverage, SPEC, DEADLINE, prem)

    direct_vm.sender = direct_bob
    contract.submit_deliverable("job-1", DELIV_BAD)

    # Mock the two IPFS fetches + the LLM judgement.
    direct_vm.mock_web(r".*" + SPEC + r".*", {"status": 200, "body": "Build a React dashboard with 5 pages."})
    direct_vm.mock_web(r".*" + DELIV_BAD + r".*", {"status": 200, "body": "It's a static cat picture."})
    direct_vm.mock_llm(r".*Score 0-100.*", json.dumps({"score": 5, "reasoning": "totally missed the spec"}))

    direct_vm.sender = direct_charlie
    direct_vm.value = CLAIM_BOND
    contract.file_claim("job-1")

    assert contract.get_claim_status("job-1") == "upheld"
    info = contract.get_pool_info("unrated")
    assert info["locked_exposure_atto"] == 0
    assert info["balance_atto"] == 20 * 10**18 + prem - coverage


def test_claim_judged_rejected_bond_forfeited(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
):
    """Deliverable conforms -> score high -> rejected; buyer's bond goes to
    the pool (compensates LPs for consensus), exposure released."""
    contract = direct_deploy("intelligent-contracts/aegis.py")
    setUpPoolAndAgent(direct_vm, contract, direct_alice, direct_bob, direct_charlie)

    coverage = 10**18
    prem = premium_for(coverage, "unrated")
    issue_policy(direct_vm, contract, direct_charlie, "job-1", "agent-a",
                 coverage, SPEC, DEADLINE, prem)

    direct_vm.sender = direct_bob
    contract.submit_deliverable("job-1", DELIV_OK)

    direct_vm.mock_web(r".*" + SPEC + r".*", {"status": 200, "body": "Build a React dashboard with 5 pages."})
    direct_vm.mock_web(r".*" + DELIV_OK + r".*", {"status": 200, "body": "React dashboard with 5 pages delivered."})
    direct_vm.mock_llm(r".*Score 0-100.*", json.dumps({"score": 95, "reasoning": "matches"}))

    direct_vm.sender = direct_charlie
    direct_vm.value = CLAIM_BOND
    contract.file_claim("job-1")

    assert contract.get_claim_status("job-1") == "rejected"
    info = contract.get_pool_info("unrated")
    assert info["locked_exposure_atto"] == 0
    # Premium stays, bond added to pool, coverage not paid out.
    assert info["balance_atto"] == 20 * 10**18 + prem + CLAIM_BOND


def test_claim_gate_access_and_bond(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie, direct_owner
):
    contract = direct_deploy("intelligent-contracts/aegis.py")
    setUpPoolAndAgent(direct_vm, contract, direct_alice, direct_bob, direct_charlie)

    coverage = 10**18
    prem = premium_for(coverage, "unrated")
    issue_policy(direct_vm, contract, direct_charlie, "job-1", "agent-a",
                 coverage, SPEC, DEADLINE, prem)

    direct_vm.warp("2026-03-02T00:00:00Z")  # after deadline
    # Wrong bond.
    direct_vm.sender = direct_charlie
    direct_vm.value = CLAIM_BOND - 1
    with direct_vm.expect_revert("claim bond must be exactly"):
        contract.file_claim("job-1")

    # Not the buyer.
    direct_vm.sender = direct_owner
    direct_vm.value = CLAIM_BOND
    with direct_vm.expect_revert("only the policy buyer"):
        contract.file_claim("job-1")

    # Legit claim then double-claim is blocked.
    direct_vm.sender = direct_charlie
    direct_vm.value = CLAIM_BOND
    contract.file_claim("job-1")
    direct_vm.value = CLAIM_BOND
    with direct_vm.expect_revert("already resolved"):
        contract.file_claim("job-1")


def test_claim_payout_capped_at_10pct_pool(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
):
    """MAX_PAYOUT_BPS_OF_POOL: a single claim can pay at most 10% of the tier
    pool, even if coverage is larger."""
    contract = direct_deploy("intelligent-contracts/aegis.py")
    fund_accounts(direct_vm, direct_alice, direct_bob, direct_charlie)
    direct_vm.warp(T0)
    deposit(direct_vm, contract, direct_alice, "unrated", 5 * 10**18)  # small pool
    register(direct_vm, contract, direct_bob, "agent-a")

    coverage = 3 * 10**18  # 60% of the 5 GEN pool
    prem = premium_for(coverage, "unrated")
    issue_policy(direct_vm, contract, direct_charlie, "job-1", "agent-a",
                 coverage, SPEC, DEADLINE, prem)

    direct_vm.warp("2026-03-02T00:00:00Z")  # after deadline, no deliverable
    pool_before = 5 * 10**18 + prem
    cap = (pool_before * 1000) // 10000

    direct_vm.sender = direct_charlie
    direct_vm.value = CLAIM_BOND
    contract.file_claim("job-1")

    assert contract.get_claim_status("job-1") == "upheld"
    info = contract.get_pool_info("unrated")
    assert info["balance_atto"] == pool_before - cap  # paid cap, not full coverage


# ---------------------------------------------------------------------------
# Reputation / tier
# ---------------------------------------------------------------------------

def test_tier_promotion_bronze_requires_real_buyers_and_tenure(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie, direct_owner
):
    """Bronze: >=3 insured jobs, >=2 distinct buyers, >=3 days tenure."""
    contract = direct_deploy("intelligent-contracts/aegis.py")
    fund_accounts(direct_vm, direct_alice, direct_bob, direct_charlie, direct_owner)
    direct_vm.warp(T0)
    deposit(direct_vm, contract, direct_alice, "unrated", 50 * 10**18)
    register(direct_vm, contract, direct_bob, "agent-a")

    coverage = 10**18
    prem = premium_for(coverage, "unrated")

    # Buyer 1 buys 2 jobs at T0.
    issue_policy(direct_vm, contract, direct_charlie, "job-1", "agent-a",
                 coverage, SPEC, DEADLINE, prem)
    issue_policy(direct_vm, contract, direct_charlie, "job-2", "agent-a",
                 coverage, SPEC, DEADLINE, prem)
    assert contract.get_profile("agent-a")["tier"] == "unrated"

    # Same address buying a 3rd job must NOT push to bronze (needs 2 distinct).
    issue_policy(direct_vm, contract, direct_charlie, "job-3", "agent-a",
                 coverage, SPEC, DEADLINE, prem)
    assert contract.get_profile("agent-a")["tier"] == "unrated"

    # Distinct buyer 2, but still within tenure window (2 days < 3).
    direct_vm.warp("2026-01-03T00:00:00Z")
    issue_policy(direct_vm, contract, direct_owner, "job-4", "agent-a",
                 coverage, SPEC, DEADLINE, prem)
    assert contract.get_profile("agent-a")["tier"] == "unrated"

    # After >=3 days tenure, the next action promotes.
    direct_vm.warp(T_PLUS_4)
    issue_policy(direct_vm, contract, direct_owner, "job-5", "agent-a",
                 coverage, SPEC, DEADLINE, prem)
    assert contract.get_profile("agent-a")["tier"] == "bronze"
    assert contract.get_profile("agent-a")["distinct_buyers"] == 2


def test_tier_pricing_changes_after_promotion(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie, direct_owner
):
    """After promotion the premium is priced off the new tier's rate."""
    contract = direct_deploy("intelligent-contracts/aegis.py")
    fund_accounts(direct_vm, direct_alice, direct_bob, direct_charlie, direct_owner)
    direct_vm.warp(T0)
    deposit(direct_vm, contract, direct_alice, "unrated", 50 * 10**18)
    deposit(direct_vm, contract, direct_alice, "bronze", 50 * 10**18)
    register(direct_vm, contract, direct_bob, "agent-a")

    coverage = 10**18
    prem = premium_for(coverage, "unrated")
    issue_policy(direct_vm, contract, direct_charlie, "job-1", "agent-a",
                 coverage, SPEC, DEADLINE, prem)
    issue_policy(direct_vm, contract, direct_charlie, "job-2", "agent-a",
                 coverage, SPEC, DEADLINE, prem)
    issue_policy(direct_vm, contract, direct_owner, "job-3", "agent-a",
                 coverage, SPEC, DEADLINE, prem)
    direct_vm.warp(T_PLUS_4)
    issue_policy(direct_vm, contract, direct_owner, "job-4", "agent-a",
                 coverage, SPEC, DEADLINE, prem)

    assert contract.get_profile("agent-a")["tier"] == "bronze"

    quote = contract.quote_premium("agent-a", coverage)
    assert quote["tier"] == "bronze"
    assert quote["rate_bps"] == 400

    # A new policy must now pay the bronze premium exactly.
    with direct_vm.expect_revert("premium must be exactly"):
        issue_policy(direct_vm, contract, direct_charlie, "job-5", "agent-a",
                     coverage, SPEC, DEADLINE, premium_for(coverage, "unrated"))
    issue_policy(direct_vm, contract, direct_charlie, "job-5", "agent-a",
                 coverage, SPEC, DEADLINE, premium_for(coverage, "bronze"))


# ---------------------------------------------------------------------------
# Claim against an agent drags their reputation down
# ---------------------------------------------------------------------------

def test_claim_history_updates_profile(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
):
    contract = direct_deploy("intelligent-contracts/aegis.py")
    setUpPoolAndAgent(direct_vm, contract, direct_alice, direct_bob, direct_charlie)

    coverage = 10**18
    prem = premium_for(coverage, "unrated")
    issue_policy(direct_vm, contract, direct_charlie, "job-1", "agent-a",
                 coverage, SPEC, DEADLINE, prem)

    direct_vm.warp("2026-03-02T00:00:00Z")  # after deadline, no deliverable
    direct_vm.sender = direct_charlie
    direct_vm.value = CLAIM_BOND
    contract.file_claim("job-1")

    p = contract.get_profile("agent-a")
    assert p["claims_filed_against"] == 1
    assert p["claims_upheld_against"] == 1
