# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
"""
Aegis -- Non-Performance Insurance for the Agentic Marketplace Economy
Single-contract v1, built for studio.genlayer.com (StudioNet).

Everything lives in one gl.Contract: agent identity/reputation, policy
issuance and pricing, per-tier LP pools, and the GenLayer-consensus claims
judge. The only external calls are plain native-token transfers
(`emit_transfer`) to pay a claim or return LP capital -- made from ordinary
deterministic write methods, never from inside the leader/validator
closures.

Design rules:
- Non-performance / SLA-breach is the only thing GenLayer judges here.
  Premium pricing is a deterministic lookup, not an AI call.
- One wallet address binds to exactly one agent_id, at registration time.
- Deterministic gate (single-use, access control, bond) runs before any
  AI call; the validator independently re-derives the score rather than
  trusting the leader's JSON shape.

Identity-key hardening (Veil DAO-voting post-mortem):
- agent_id / job_id are user-typed, non-canonical strings with no external
  registry to check against. Used as raw TreeMap keys, a case variant
  would silently register as a different identity -- for agent_id that's a
  brand-squatting vector, not just a dedup bug. Normalized (_normalize_key)
  before touching any key; as-typed text kept separately for display.
- address_to_agent is keyed by str(Address) -- already canonical, no
  user-typed casing involved -- confirmed safe, not changed.
- LP share keys (tier + address) are normalized the same way, for the same
  reason: a user querying their own position with different address
  casing must not get a false "no position found."

Gaming-audit hardening (this pass):
- A policy can only be issued against a tier that already has real LP
  capital (pool_value > 0), and coverage can't exceed that tier's current
  pool value. Closes an empty-pool first-depositor exploit: previously a
  premium could accumulate in a tier with zero LP shares, and the first
  LP to deposit afterward would mint 100% of the shares against that
  pre-existing balance -- capturing other buyers' premiums for a token
  deposit.
- tier_locked_exposure tracks total live coverage per tier. withdraw()
  cannot drop a tier's balance below its locked exposure -- an LP can no
  longer pull capital out from under active coverage, leaving a buyer
  holding a claim against an empty pool.
- The deliverable being judged is submitted by the AGENT
  (submit_deliverable, address-bound like everything else here), never
  supplied by the buyer at claim time. The earlier design let a buyer pass
  an arbitrary deliverable_hash straight into file_claim -- meaning a
  dishonest buyer could point evidence at unrelated content and manufacture
  a breach verdict against an agent who delivered exactly what was
  promised. This is the same "independently attributable" evidence
  property from CROSS_PROJECT_LESSONS.md Lesson 1, applied to the single
  most consequential piece of evidence in the contract. If the agent never
  submits anything and the deadline passes, that's an unambiguous breach
  decided deterministically -- no LLM call needed, nothing to game.
- spec_hash / deliverable_hash must look like a real content-addressed
  IPFS CID (CIDv0/CIDv1 shape check), not an arbitrary URL. A mutable URL
  (e.g. an editable Gist) can be changed between the leader's fetch and
  the validator's independent re-fetch, defeating the "every validator
  judges the same bytes" guarantee the whole evidence model depends on.
- Tier promotion required only a raw COUNT of insured jobs, with no check
  on who bought them. One agent could quietly control a second wallet,
  issue itself a stream of cheap policies, and buy its way to a "gold"
  reputation it never earned -- then real customers pay the low gold-tier
  rate for a track record that was fabricated. Fixed with the same idea a
  sibling GenLayer project's reviewer required for a sybil-prone
  threshold: a minimum real cost per unit of progress
  (MIN_COVERAGE_ATTO) plus a minimum count of *distinct* buyer addresses
  (MIN_DISTINCT_BUYERS_BY_TIER), so a single controlled address can no
  longer single-handedly advance the count. Same honest caveat as that
  fix: this raises the attack's cost, it doesn't make it impossible.
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
STATUS_EXPIRED = "expired"

CLAIM_BOND_ATTO = 2 * 10**18
BREACH_THRESHOLD = 40
SCORE_TOLERANCE = 15
MAX_PAYOUT_BPS_OF_POOL = 1000  # 10% of that tier's pool per single claim
MIN_COVERAGE_ATTO = 10**16  # 0.01 GEN floor -- makes every policy a real cost, not free spam

MIN_DISTINCT_BUYERS_BY_TIER = {
    TIER_BRONZE: 2,
    TIER_SILVER: 5,
    TIER_GOLD: 10,
}

# Content-addressed evidence gateway. spec_hash / deliverable_hash must
# resolve to the exact same immutable bytes for every validator.
EVIDENCE_GATEWAY = "https://w3s.link/ipfs/"

_B58_ALPHABET = set("123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz")
_B32_ALPHABET = set("abcdefghijklmnopqrstuvwxyz234567")


def _normalize_key(raw: str) -> str:
    """Canonicalizes a user-typed identifier (agent_id, job_id, an
    address embedded in an LP share key) before it touches a TreeMap key.
    Case-fold + strip only -- closes the exact bug class from the Veil
    DAO-voting post-mortem (a case variant silently treated as a different
    identity), generalized to every identifier in this contract that has
    no external canonical registry to check against."""
    return raw.strip().lower()


def _looks_like_content_hash(value: str) -> bool:
    """Pragmatic shape check for an IPFS CID -- not full CID-spec parsing,
    just enough to reject an arbitrary/mutable URL (e.g. a Gist link) at
    the door. A mutable URL can change between the leader's fetch and the
    validator's independent re-fetch, which breaks the "every validator
    judges the same bytes" guarantee the evidence model depends on."""
    v = value.strip()
    if len(v) == 46 and v.startswith("Qm") and all(c in _B58_ALPHABET for c in v):
        return True  # CIDv0
    if len(v) >= 50 and v[0] in ("b", "B") and all(c in _B32_ALPHABET for c in v[1:].lower()):
        return True  # CIDv1 (base32)
    return False


def _parse_score(analysis) -> int:
    if not isinstance(analysis, dict):
        raise gl.vm.UserError(f"{ERROR_LLM} non-dict response: {type(analysis)}")
    raw = analysis.get("score")
    if raw is None:
        raise gl.vm.UserError(f"{ERROR_LLM} missing 'score' key")
    try:
        return max(0, min(100, int(round(float(str(raw).strip())))))
    except (ValueError, TypeError, OverflowError):
        # OverflowError: a malformed/adversarial response like "inf" or
        # "1e400" parses fine as a Python float but blows up on round() --
        # must land in the same fail-closed [LLM_ERROR] path as any other
        # unusable score, not escape as an unclassified exception.
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
    agent_id: str          # canonical (normalized) key, safe to reuse in lookups
    display_job_id: str    # as-typed at issuance -- never used as a key
    coverage_atto: u256
    spec_hash: str
    deliverable_hash: str  # "" until the agent submits one -- see submit_deliverable
    deadline_iso: str
    pool_tier: str
    status: str


class Aegis(gl.Contract):
    admin: Address

    agents: TreeMap[str, AgentProfile]
    address_to_agent: TreeMap[str, str]

    policies: TreeMap[str, Policy]
    resolved_claims: TreeMap[str, str]   # job_id -> "upheld" | "rejected"

    tier_balance: TreeMap[str, u256]         # tier -> pool ledger (atto)
    tier_shares: TreeMap[str, u256]          # tier -> total LP shares
    tier_locked_exposure: TreeMap[str, u256]  # tier -> sum of coverage_atto still live
    lp_shares: TreeMap[str, u256]            # "{tier}:{normalized address}" -> shares

    agent_distinct_buyers: TreeMap[str, u256]  # agent_id -> count of distinct buyer addresses
    agent_buyer_seen: TreeMap[str, bool]       # "{agent_id}:{buyer address}" -> True once seen

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
        distinct_buyers = (
            int(self.agent_distinct_buyers[agent_id_key])
            if agent_id_key in self.agent_distinct_buyers
            else 0
        )

        if (
            insured >= 50
            and breach_rate <= 0.02
            and distinct_buyers >= MIN_DISTINCT_BUYERS_BY_TIER[TIER_GOLD]
        ):
            profile.tier = TIER_GOLD
        elif (
            insured >= 15
            and breach_rate <= 0.08
            and distinct_buyers >= MIN_DISTINCT_BUYERS_BY_TIER[TIER_SILVER]
        ):
            profile.tier = TIER_SILVER
        elif insured >= 3 and distinct_buyers >= MIN_DISTINCT_BUYERS_BY_TIER[TIER_BRONZE]:
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
            "distinct_buyers": int(self.agent_distinct_buyers[key]) if key in self.agent_distinct_buyers else 0,
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
        if not _looks_like_content_hash(spec_hash):
            raise gl.vm.UserError(
                f"{ERROR_EXPECTED} spec_hash must be a content-addressed IPFS CID, not a URL"
            )
        if int(coverage_atto) <= 0:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} coverage_atto must be > 0")
        if int(coverage_atto) < MIN_COVERAGE_ATTO:
            raise gl.vm.UserError(
                f"{ERROR_EXPECTED} coverage_atto must be at least {MIN_COVERAGE_ATTO} atto"
            )

        tier = self.agents[agent_key].tier
        pool_value = int(self.tier_balance[tier]) if tier in self.tier_balance else 0
        if pool_value <= 0:
            raise gl.vm.UserError(
                f"{ERROR_EXPECTED} no underwriting capital available for tier '{tier}' yet"
            )
        if int(coverage_atto) > pool_value:
            raise gl.vm.UserError(
                f"{ERROR_EXPECTED} coverage exceeds available pool capacity "
                f"({pool_value} atto) for tier '{tier}'"
            )

        rate_bps = RATE_BPS_BY_TIER[tier]
        premium_atto = (int(coverage_atto) * rate_bps) // 10000
        if premium_atto <= 0:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} coverage too small to price a premium")

        if int(gl.message.value) != premium_atto:
            raise gl.vm.UserError(
                f"{ERROR_EXPECTED} premium must be exactly {premium_atto} atto"
            )

        self.tier_balance[tier] = u256(pool_value + premium_atto)

        prior_exposure = int(self.tier_locked_exposure[tier]) if tier in self.tier_locked_exposure else 0
        self.tier_locked_exposure[tier] = u256(prior_exposure + int(coverage_atto))

        self.policies[job_key] = Policy(
            buyer=gl.message.sender_address,
            agent_id=agent_key,
            display_job_id=job_id.strip(),
            coverage_atto=coverage_atto,
            spec_hash=spec_hash,
            deliverable_hash="",
            deadline_iso=deadline_iso,
            pool_tier=tier,
            status=STATUS_ACTIVE,
        )

        profile = self.agents[agent_key]
        profile.jobs_insured = u256(int(profile.jobs_insured) + 1)

        buyer_key = _normalize_key(str(gl.message.sender_address))
        seen_key = f"{agent_key}:{buyer_key}"
        if seen_key not in self.agent_buyer_seen:
            self.agent_buyer_seen[seen_key] = True
            prior_distinct = (
                int(self.agent_distinct_buyers[agent_key])
                if agent_key in self.agent_distinct_buyers
                else 0
            )
            self.agent_distinct_buyers[agent_key] = u256(prior_distinct + 1)

        self._recompute_tier(agent_key)

    @gl.public.write
    def submit_deliverable(self, job_id: str, deliverable_hash: str) -> None:
        """Only the insured agent can attach the evidence a claim will be
        judged against -- a buyer can never supply this themselves (see
        module docstring). Can be called any time before the policy is
        resolved; a later call simply overwrites an earlier submission,
        which is fine since nothing is judged until file_claim runs."""
        job_key = _normalize_key(job_id)
        if job_key not in self.policies:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} unknown job_id")

        policy = self.policies[job_key]
        if policy.status != STATUS_ACTIVE:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} policy not active")

        agent_owner = self.agents[policy.agent_id].owner
        if gl.message.sender_address != agent_owner:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} only the insured agent may submit a deliverable")
        if not _looks_like_content_hash(deliverable_hash):
            raise gl.vm.UserError(
                f"{ERROR_EXPECTED} deliverable_hash must be a content-addressed IPFS CID, not a URL"
            )

        policy.deliverable_hash = deliverable_hash

    @gl.public.write
    def expire_policy(self, job_id: str) -> None:
        """Lets a buyer voluntarily release their own coverage once they no
        longer intend to claim, freeing that capital back to the pool for
        LPs to withdraw. Buyer-only and deadline-gated on purpose: nobody
        else (especially not the insured agent) can move a policy out of
        "active" status, which is what keeps this safe -- an agent racing
        to expire a policy the instant a legitimate claim was coming would
        be exactly the kind of new gaming hole this audit is trying to
        close, not create.

        Known v1 limitation: a buyer who simply never calls this and never
        files a claim leaves that slice of pool capital locked
        indefinitely. Accepted tradeoff for now -- a permissionless expiry
        with a long grace window is a reasonable v1.1 addition once
        there's a safe way to compute "grace period passed" without adding
        a race condition."""
        job_key = _normalize_key(job_id)
        if job_key not in self.policies:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} unknown job_id")

        policy = self.policies[job_key]
        if gl.message.sender_address != policy.buyer:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} only the buyer may expire this policy")
        if policy.status != STATUS_ACTIVE:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} policy not active")
        if gl.message_raw["datetime"] <= policy.deadline_iso:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} deadline has not passed yet")

        policy.status = STATUS_EXPIRED
        self._release_exposure(policy.pool_tier, int(policy.coverage_atto))

    def _release_exposure(self, tier: str, coverage_atto: int) -> None:
        current = int(self.tier_locked_exposure[tier]) if tier in self.tier_locked_exposure else 0
        self.tier_locked_exposure[tier] = u256(max(0, current - coverage_atto))

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
            "deliverable_hash": p.deliverable_hash,
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

        if shares_before == 0 and pool_before > 0:
            # Should be unreachable: issue_policy only allows premiums into
            # a tier that already has shares_before > 0 (see its pool_value
            # check), and every other credit to tier_balance is paired with
            # a matching share mint in this same function. If this is ever
            # hit anyway (e.g. a future code change reintroduces the gap),
            # fail loudly instead of silently handing a depositor 100% of
            # an unattributed balance -- the exact empty-pool exploit this
            # audit pass closed.
            raise gl.vm.UserError(
                f"{ERROR_EXPECTED} tier has an unattributed balance with no shares -- aborting"
            )

        if shares_before == 0:
            minted = contributed  # true bootstrap: fresh tier, 1 share per atto
        else:
            minted = (contributed * shares_before) // pool_before

        self.tier_balance[tier] = u256(pool_before + contributed)
        self.tier_shares[tier] = u256(shares_before + minted)

        share_key = f"{tier}:{_normalize_key(str(gl.message.sender_address))}"
        existing = int(self.lp_shares[share_key]) if share_key in self.lp_shares else 0
        self.lp_shares[share_key] = u256(existing + minted)

    @gl.public.write
    def withdraw(self, tier: str, shares: u256) -> None:
        share_key = f"{tier}:{_normalize_key(str(gl.message.sender_address))}"
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

        locked = int(self.tier_locked_exposure[tier]) if tier in self.tier_locked_exposure else 0
        if pool_value - payout < locked:
            raise gl.vm.UserError(
                f"{ERROR_EXPECTED} withdrawal blocked: {locked} atto is locked backing "
                f"active coverage in this tier -- try a smaller amount"
            )

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
            "locked_exposure_atto": int(self.tier_locked_exposure[tier])
            if tier in self.tier_locked_exposure
            else 0,
        }

    @gl.public.view
    def get_lp_position(self, tier: str, address: str) -> u256:
        share_key = f"{tier}:{_normalize_key(address)}"
        return self.lp_shares[share_key] if share_key in self.lp_shares else u256(0)

    # ------------------------------------------------------------------
    # Claims -- the only place an AI call happens
    # ------------------------------------------------------------------

    @gl.public.write.payable
    def file_claim(self, job_id: str) -> None:
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

        deadline_passed = gl.message_raw["datetime"] > policy.deadline_iso

        if policy.deliverable_hash == "":
            # The agent never submitted anything for this contract to
            # judge. Before the deadline that's premature -- the agent
            # still has time. After the deadline it's an unambiguous,
            # deterministic breach: no evidence exists to fetch, so
            # there's no judgment call for GenLayer consensus to make.
            if not deadline_passed:
                raise gl.vm.UserError(
                    f"{ERROR_EXPECTED} deadline has not passed and no deliverable was submitted yet"
                )
            breach = True
        else:
            # ---------------- Judged consensus (the only nondet part) ----------------
            verdict = self._judge_breach(policy.spec_hash, policy.deliverable_hash)
            breach = bool(verdict["breach"])

        self.resolved_claims[job_key] = "upheld" if breach else "rejected"
        policy.status = STATUS_CLAIMED

        agent_key = policy.agent_id  # already canonical -- stored that way in issue_policy
        profile = self.agents[agent_key]
        profile.claims_filed_against = u256(int(profile.claims_filed_against) + 1)

        tier = policy.pool_tier
        pool_value = int(self.tier_balance[tier]) if tier in self.tier_balance else 0
        self._release_exposure(tier, int(policy.coverage_atto))

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
