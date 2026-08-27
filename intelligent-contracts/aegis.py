# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
"""
Aegis -- Non-Performance Insurance for the Agentic Marketplace Economy
Single-contract v1, built for studio.genlayer.com (StudioNet).

Everything lives in one gl.Contract: agent identity/reputation, policy
issuance and pricing, per-tier LP pools, and the GenLayer-consensus claims
judge. Collapsing what was a 4-contract design into one removes all
cross-contract calls and the deploy-order dependency chain that came with
them -- the only external calls left are plain native-token transfers
(`emit_transfer`) to pay a claim or return LP capital, which are not
inter-contract *logic* calls and are made from ordinary deterministic write
methods, never from inside the leader/validator closures.

Design rules carried over from the architecture doc, unchanged by the merge:
- Non-performance / SLA-breach is the only thing GenLayer judges here.
  Premium pricing is a deterministic lookup, not an AI call.
- One wallet address binds to exactly one agent_id, at registration time
  (CROSS_PROJECT_LESSONS.md Lesson 3 / FIX_IDENTITY_BINDING.md).
- Claim evidence is fetched by content hash through a gateway, never a
  mutable URL, so every validator judges the same bytes (Lesson 1).
- Deterministic gate (single-use, access control, bond) runs before any
  AI call; the validator independently re-derives the score rather than
  trusting the leader's JSON shape (write-contract.md).

Identity-key hardening (from the Veil DAO-voting post-mortem):
- `agent_id` and `job_id` are user-typed, non-canonical strings with no
  external source of truth -- unlike a GitHub handle, there's no registry
  to check them against. That makes them exactly the kind of identifier
  the Veil lessons warn about: used as TreeMap dedup/lookup keys without
  normalization, `"agent-alice"` and `"Agent-Alice"` would silently
  register as two unrelated agents. For agent_id specifically this is
  worse than a dedup bypass -- it's a brand-squatting vector, since a
  buyer has no on-chain way to tell a confusable variant from the
  original. Both are normalized (`_normalize_key`) before ever touching a
  TreeMap key; the as-typed string is preserved separately for display.
- `address_to_agent` is keyed by `str(gl.message.sender_address)`, which
  is a canonical checksum string derived from raw bytes -- never
  user-typed -- so it needed no change. Confirmed deliberately rather than
  assumed.
- No feature here binds an on-chain sender to an *external* off-chain
  identity (a GitHub handle, a domain, an API endpoint) yet -- that's a
  v2 direction (see the accompanying roadmap doc). When that's built: any
  proof string used for that binding must use the caller's full address,
  never a truncated prefix -- an 8-hex-digit prefix is a 32-bit space,
  cheap to grind offline until two different addresses collide on the
  same proof string, which defeats the binding entirely.
"""

from genlayer import *
from dataclasses import dataclass

ERROR_EXPECTED = "[EXPECTED]"
ERROR_EXTERNAL = "[EXTERNAL]"
ERROR_TRANSIENT = "[TRANSIENT]"
ERROR_LLM = "[LLM_ERROR]"

TIER_UNRATED = "unrated"
TIER_BRONZE = "bronze"
TIER_SILVER = "silver"
TIER_GOLD = "gold"
VALID_TIERS = (TIER_UNRATED, TIER_BRONZE, TIER_SILVER, TIER_GOLD)

RATE_BPS_BY_TIER = {
    TIER_UNRATED: 600,
    TIER_BRONZE: 400,
    TIER_SILVER: 250,
    TIER_GOLD: 150,
}

STATUS_ACTIVE = "active"
STATUS_CLAIMED = "claimed"

CLAIM_BOND_ATTO = 2 * 10**18
BREACH_THRESHOLD = 40
SCORE_TOLERANCE = 15
MAX_PAYOUT_BPS_OF_POOL = 1000  # 10% of that tier's pool per single claim

# Content-addressed evidence gateway. spec_hash / deliverable_hash must
# resolve to the exact same immutable bytes for every validator.
EVIDENCE_GATEWAY = "https://w3s.link/ipfs/"


def _normalize_key(raw: str) -> str:
    """Canonicalizes a user-typed identifier (agent_id, job_id) before it
    touches a TreeMap key. Case-fold + strip only -- deliberately not a
    full confusable/homoglyph defense, just closes the exact bug class from
    the Veil DAO-voting post-mortem (a case-variant silently treated as a
    different identity). Never apply this to a value that's about to be
    used against an *external* canonical system (e.g. a real GitHub API
    call) unless that system is itself case-insensitive -- here there is no
    external system, so normalizing the key is the whole fix."""
    return raw.strip().lower()


def _parse_score(analysis) -> int:
    if not isinstance(analysis, dict):
        raise gl.vm.UserError(f"{ERROR_LLM} non-dict response: {type(analysis)}")
    raw = analysis.get("score")
    if raw is None:
        raise gl.vm.UserError(f"{ERROR_LLM} missing 'score' key")
    try:
        return max(0, min(100, int(round(float(str(raw).strip())))))
    except (ValueError, TypeError):
        raise gl.vm.UserError(f"{ERROR_LLM} non-numeric score: {raw}")


def _handle_leader_error(leaders_res, leader_fn) -> bool:
    leader_msg = leaders_res.message if hasattr(leaders_res, "message") else ""
    try:
        leader_fn()
        return False  # leader errored but validator succeeded -- disagree
    except gl.vm.UserError as e:
        validator_msg = e.message if hasattr(e, "message") else str(e)
        if validator_msg.startswith(ERROR_EXPECTED) or validator_msg.startswith(ERROR_EXTERNAL):
            return validator_msg == leader_msg
        if validator_msg.startswith(ERROR_TRANSIENT) and leader_msg.startswith(ERROR_TRANSIENT):
            return True
        return False  # LLM_ERROR or unclassified -- force rotation, never agree
    except Exception:
        return False


@allow_storage
@dataclass
class AgentProfile:
    owner: Address
    display_name: str    # as-typed at registration -- never used as a key
    tier: str
    jobs_insured: u256
    claims_filed_against: u256
    claims_upheld_against: u256
    registered_at: str


@allow_storage
@dataclass
class Policy:
    buyer: Address
    agent_id: str         # canonical (normalized) key, safe to reuse in lookups
    display_job_id: str   # as-typed at issuance -- never used as a key
    coverage_atto: u256
    spec_hash: str
    deadline_iso: str
    pool_tier: str
    status: str


class Aegis(gl.Contract):
    admin: Address

    agents: TreeMap[str, AgentProfile]
    address_to_agent: TreeMap[str, str]

    policies: TreeMap[str, Policy]
    resolved_claims: TreeMap[str, str]   # job_id -> "upheld" | "rejected"

    tier_balance: TreeMap[str, u256]     # tier -> pool ledger (atto)
    tier_shares: TreeMap[str, u256]      # tier -> total LP shares
    lp_shares: TreeMap[str, u256]        # "{tier}:{address}" -> shares

    def __init__(self):
        self.admin = gl.message.sender_address

    # ------------------------------------------------------------------
    # Agent identity & reputation
    # ------------------------------------------------------------------

    @gl.public.write
    def register(self, agent_id: str) -> None:
        key = _normalize_key(agent_id)
        if key == "":
            raise gl.vm.UserError(f"{ERROR_EXPECTED} agent_id cannot be empty")

        sender_key = str(gl.message.sender_address)
        if key in self.agents:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} agent_id already registered")
        if sender_key in self.address_to_agent:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} address already bound to an agent_id")

        self.agents[key] = AgentProfile(
            owner=gl.message.sender_address,
            display_name=agent_id.strip(),
            tier=TIER_UNRATED,
            jobs_insured=u256(0),
            claims_filed_against=u256(0),
            claims_upheld_against=u256(0),
            registered_at=gl.message_raw["datetime"],
        )
        self.address_to_agent[sender_key] = key

    def _recompute_tier(self, agent_id_key: str) -> None:
        profile = self.agents[agent_id_key]
        insured = int(profile.jobs_insured)
        upheld = int(profile.claims_upheld_against)
        filed = int(profile.claims_filed_against)
        breach_rate = (upheld / filed) if filed > 0 else 0.0

        if insured >= 50 and breach_rate <= 0.02:
            profile.tier = TIER_GOLD
        elif insured >= 15 and breach_rate <= 0.08:
            profile.tier = TIER_SILVER
        elif insured >= 3:
            profile.tier = TIER_BRONZE
        else:
            profile.tier = TIER_UNRATED

    @gl.public.view
    def get_profile(self, agent_id: str) -> dict:
        key = _normalize_key(agent_id)
        if key not in self.agents:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} unknown agent_id")
        p = self.agents[key]
        return {
            "agent_id": key,
            "display_name": p.display_name,
            "owner": str(p.owner),
            "tier": p.tier,
            "jobs_insured": int(p.jobs_insured),
            "claims_filed_against": int(p.claims_filed_against),
            "claims_upheld_against": int(p.claims_upheld_against),
            "registered_at": p.registered_at,
        }

    @gl.public.view
    def agent_id_for_address(self, address: str) -> str:
        if address not in self.address_to_agent:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} address not registered")
        return self.address_to_agent[address]

    # ------------------------------------------------------------------
    # Policies (premium pricing is deterministic -- no AI call)
    # ------------------------------------------------------------------

    @gl.public.write.payable
    def issue_policy(
        self,
        job_id: str,
        agent_id: str,
        coverage_atto: u256,
        spec_hash: str,
        deadline_iso: str,
    ) -> None:
        job_key = _normalize_key(job_id)
        agent_key = _normalize_key(agent_id)
        if job_key == "":
            raise gl.vm.UserError(f"{ERROR_EXPECTED} job_id cannot be empty")
        if job_key in self.policies:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} policy already exists for job_id")
        if agent_key not in self.agents:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} unknown agent_id")

        tier = self.agents[agent_key].tier
        rate_bps = RATE_BPS_BY_TIER[tier]
        premium_atto = (int(coverage_atto) * rate_bps) // 10000

        if int(gl.message.value) != premium_atto:
            raise gl.vm.UserError(
                f"{ERROR_EXPECTED} premium must be exactly {premium_atto} atto"
            )

        prior = int(self.tier_balance[tier]) if tier in self.tier_balance else 0
        self.tier_balance[tier] = u256(prior + premium_atto)

        self.policies[job_key] = Policy(
            buyer=gl.message.sender_address,
            agent_id=agent_key,
            display_job_id=job_id.strip(),
            coverage_atto=coverage_atto,
            spec_hash=spec_hash,
            deadline_iso=deadline_iso,
            pool_tier=tier,
            status=STATUS_ACTIVE,
        )

        profile = self.agents[agent_key]
        profile.jobs_insured = u256(int(profile.jobs_insured) + 1)
        self._recompute_tier(agent_key)

    @gl.public.view
    def get_policy(self, job_id: str) -> dict:
        job_key = _normalize_key(job_id)
        if job_key not in self.policies:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} unknown job_id")
        p = self.policies[job_key]
        return {
            "job_id": job_key,
            "display_job_id": p.display_job_id,
            "buyer": str(p.buyer),
            "agent_id": p.agent_id,
            "coverage_atto": int(p.coverage_atto),
            "spec_hash": p.spec_hash,
            "deadline_iso": p.deadline_iso,
            "pool_tier": p.pool_tier,
            "status": p.status,
        }

    @gl.public.view
    def quote_premium(self, agent_id: str, coverage_atto: u256) -> dict:
        key = _normalize_key(agent_id)
        tier = self.agents[key].tier if key in self.agents else TIER_UNRATED
        rate_bps = RATE_BPS_BY_TIER[tier]
        premium_atto = (int(coverage_atto) * rate_bps) // 10000
        return {"tier": tier, "rate_bps": rate_bps, "premium_atto": premium_atto}

    # ------------------------------------------------------------------
    # LP pools (per tier, simple proportional shares)
    # ------------------------------------------------------------------

    @gl.public.write.payable
    def deposit(self, tier: str) -> None:
        if tier not in VALID_TIERS:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} unknown tier '{tier}'")
        contributed = int(gl.message.value)
        if contributed <= 0:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} deposit must be > 0")

        pool_before = int(self.tier_balance[tier]) if tier in self.tier_balance else 0
        shares_before = int(self.tier_shares[tier]) if tier in self.tier_shares else 0

        if shares_before == 0 or pool_before <= 0:
            minted = contributed  # bootstrap: 1 share per atto on a fresh pool
        else:
            minted = (contributed * shares_before) // pool_before

        self.tier_balance[tier] = u256(pool_before + contributed)
        self.tier_shares[tier] = u256(shares_before + minted)

        share_key = f"{tier}:{gl.message.sender_address}"
        existing = int(self.lp_shares[share_key]) if share_key in self.lp_shares else 0
        self.lp_shares[share_key] = u256(existing + minted)

    @gl.public.write
    def withdraw(self, tier: str, shares: u256) -> None:
        share_key = f"{tier}:{gl.message.sender_address}"
        if share_key not in self.lp_shares:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} no LP position for sender in this tier")

        owned = int(self.lp_shares[share_key])
        requested = int(shares)
        if requested <= 0 or requested > owned:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} invalid share amount")

        pool_value = int(self.tier_balance[tier]) if tier in self.tier_balance else 0
        total_shares = int(self.tier_shares[tier]) if tier in self.tier_shares else 0
        if total_shares <= 0:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} tier has no outstanding shares")

        payout = (requested * pool_value) // total_shares

        self.lp_shares[share_key] = u256(owned - requested)
        self.tier_shares[tier] = u256(total_shares - requested)
        self.tier_balance[tier] = u256(pool_value - payout)

        gl.get_contract_at(gl.message.sender_address).emit_transfer(
            value=u256(payout), on="finalized"
        )

    @gl.public.view
    def get_pool_info(self, tier: str) -> dict:
        return {
            "tier": tier,
            "balance_atto": int(self.tier_balance[tier]) if tier in self.tier_balance else 0,
            "total_shares": int(self.tier_shares[tier]) if tier in self.tier_shares else 0,
        }

    @gl.public.view
    def get_lp_position(self, tier: str, address: str) -> u256:
        share_key = f"{tier}:{address}"
        return self.lp_shares[share_key] if share_key in self.lp_shares else u256(0)

    # ------------------------------------------------------------------
    # Claims -- the only place an AI call happens
    # ------------------------------------------------------------------

    @gl.public.write.payable
    def file_claim(self, job_id: str, deliverable_hash: str) -> None:
        # ---------------- Deterministic gate (no AI call yet) ----------------
        job_key = _normalize_key(job_id)
        if job_key in self.resolved_claims:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} claim already resolved for job_id")
        if job_key not in self.policies:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} unknown job_id")

        policy = self.policies[job_key]
        if policy.status != STATUS_ACTIVE:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} policy not active")
        if gl.message.sender_address != policy.buyer:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} only the policy buyer may file this claim")
        if int(gl.message.value) != CLAIM_BOND_ATTO:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} claim bond must be exactly {CLAIM_BOND_ATTO} atto")

        spec_hash = policy.spec_hash

        # ---------------- Judged consensus (the only nondet part) ----------------
        verdict = self._judge_breach(spec_hash, deliverable_hash)
        breach = bool(verdict["breach"])

        self.resolved_claims[job_key] = "upheld" if breach else "rejected"
        policy.status = STATUS_CLAIMED

        agent_key = policy.agent_id  # already canonical -- stored that way in issue_policy
        profile = self.agents[agent_key]
        profile.claims_filed_against = u256(int(profile.claims_filed_against) + 1)

        tier = policy.pool_tier
        pool_value = int(self.tier_balance[tier]) if tier in self.tier_balance else 0

        if breach:
            profile.claims_upheld_against = u256(int(profile.claims_upheld_against) + 1)

            cap = (pool_value * MAX_PAYOUT_BPS_OF_POOL) // 10000
            payout = min(int(policy.coverage_atto), cap)
            self.tier_balance[tier] = u256(pool_value - payout)

            gl.get_contract_at(policy.buyer).emit_transfer(value=u256(payout), on="finalized")
            # Legitimate claim -- refund the anti-spam bond.
            gl.get_contract_at(gl.message.sender_address).emit_transfer(
                value=u256(CLAIM_BOND_ATTO), on="finalized"
            )
        else:
            # Bond forfeited into the pool it would otherwise have drawn from --
            # compensates LPs for the cost of running consensus on a claim
            # that didn't hold up, and deters spam.
            self.tier_balance[tier] = u256(pool_value + CLAIM_BOND_ATTO)

        self._recompute_tier(agent_key)

    def _judge_breach(self, spec_hash: str, deliverable_hash: str) -> dict:
        def leader_fn() -> dict:
            spec_res = gl.nondet.web.get(EVIDENCE_GATEWAY + spec_hash)
            deliverable_res = gl.nondet.web.get(EVIDENCE_GATEWAY + deliverable_hash)

            if spec_res.status >= 500 or deliverable_res.status >= 500:
                raise gl.vm.UserError(f"{ERROR_TRANSIENT} evidence gateway unavailable")
            if spec_res.status >= 400 or deliverable_res.status >= 400:
                raise gl.vm.UserError(
                    f"{ERROR_EXTERNAL} evidence fetch failed: "
                    f"{spec_res.status}/{deliverable_res.status}"
                )

            spec_text = (spec_res.body or b"").decode("utf-8", errors="replace")
            deliverable_text = (deliverable_res.body or b"").decode("utf-8", errors="replace")

            prompt = (
                "Spec (what was promised):\n" + spec_text +
                "\n\nDeliverable (what was actually produced):\n" + deliverable_text +
                "\n\nScore 0-100 how well the deliverable conforms to the "
                "spec's material requirements. Ignore stylistic preferences. "
                "A score below " + str(BREACH_THRESHOLD) + " means material "
                "non-conformance / breach.\n"
                "Output JSON: {\"score\": <int 0-100>, \"reasoning\": \"<short>\"}"
            )
            analysis = gl.nondet.exec_prompt(prompt, response_format="json")
            score = _parse_score(analysis)
            return {"score": score, "breach": score < BREACH_THRESHOLD}

        def validator_fn(leaders_res: gl.vm.Result) -> bool:
            if not isinstance(leaders_res, gl.vm.Return):
                return _handle_leader_error(leaders_res, leader_fn)

            leader_calldata = leaders_res.calldata
            validator_result = leader_fn()  # independently re-derive, never trust

            if bool(leader_calldata["breach"]) != bool(validator_result["breach"]):
                return False
            if abs(int(leader_calldata["score"]) - int(validator_result["score"])) > SCORE_TOLERANCE:
                return False
            return True

        return gl.vm.run_nondet_unsafe(leader_fn, validator_fn)

    @gl.public.view
    def get_claim_status(self, job_id: str) -> str:
        key = _normalize_key(job_id)
        return self.resolved_claims[key] if key in self.resolved_claims else "unresolved"
