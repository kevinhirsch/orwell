"""Issue #1660 — cast-identity coherence: the FE belt that stops deep-authoring from committing a
houseguest whose photo contradicts their narration.

Pins the three tractable fixes for the 2026-07-16 debug bundle (5 gender-flipped houseguests, a
retired-principal 22-year-old):

  * F2 — the author-time WRITE-BACK coherence lint (this PR): an authored profile whose
    self-referential prose contradicts the houseguest's PINNED identity is refused (the contradicting
    field is dropped to the coherent seeded floor) BEFORE `recordCastProfile`, and a RED-eligible
    `identity-incoherence` health event is recorded (#1599). A coherent dossier is a byte-identical no-op.
  * F3 — reasoning-channel salvage (landed #1662, pinned here): when the visible body is empty but the
    model MISROUTED the JSON answer into the reasoning channel, the paid-for content is USED, not
    discarded, and a RED reasoning-channel-misroute event is recorded.
  * F4 — genesis token budget (landed #1662, pinned here): the full-cast genesis sketch output floor
    clears the ~4400-token skeleton with headroom, so the whole-cast skeleton is never chopped at the
    one-NPC-sized 3000 cap (`finish_reason=length` → committed nothing).

Roles only — every probe string is generic (no houseguest names).
"""

import asyncio
import importlib
import json

import pytest

ca = importlib.import_module("src.orwell_cast_authoring")
enrichment_policy = importlib.import_module("src.enrichment_policy")
log_rings = importlib.import_module("src.log_rings")
token_policy = importlib.import_module("src.token_policy")


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def _clear_rings():
    for ring in (log_rings.OVERSEER, log_rings.LLMIO, log_rings.IO, log_rings.LIVE):
        ring.buf.clear()


def _overseer_kinds_failed():
    _, lines = log_rings.OVERSEER.since(0, limit=100000)
    return {e.get("kind") for e in lines if e.get("ok") is False}


@pytest.fixture
def _clean_ledger():
    enrichment_policy.clear_failures()
    _clear_rings()
    yield
    enrichment_policy.clear_failures()


# A well-formed authored profile whose PROSE is authored for the OPPOSITE gender — the bundle's
# gender-flip shape (a "man" houseguest narrated as "she"). The bio clears the quality floor so it is
# parsed into the write-back (and is therefore the field the lint must strip).
_FEM_BIO = ("She grew up in a small coastal town and always loved a good challenge. She applied on a "
            "whim and never once looked back, chasing her own quiet ambition all season.")
_MASC_BIO = ("He grew up in a small coastal town and always loved a good challenge. He applied on a "
             "whim and never once looked back, chasing his own quiet ambition all season.")


def _phys(mark="a small compass tattoo on the left wrist"):
    """A complete 7-key physical facet (the engine folds it whole-or-nothing). `mark` is neutral by
    default; pass a gendered mark to exercise the facet-drop path."""
    return {
        "heightBuild": "average height, lean", "skinTone": "olive", "hair": "short dark",
        "facialFeatures": "sharp jaw", "distinguishingMark": mark, "ageLook": "looks about forty",
        "style": "understated",
    }


# ══════════════════════════ F2 — the author-time write-back coherence lint ══════════════════════════


def test_coherence_conflicts_flags_a_gender_flipped_biography():
    # The pure lint: a feminine self-referential bio contradicts a pinned "man".
    npc = {"id": "npc:1", "genderPresentation": "man"}
    assert ca.coherence_conflicts({"biography": _FEM_BIO}, npc) == ["biography"]
    # ...and the mirror: a masculine bio contradicts a pinned "woman".
    assert ca.coherence_conflicts({"biography": _MASC_BIO}, {"genderPresentation": "woman"}) == ["biography"]


def test_coherence_conflicts_is_conservative_about_relatives():
    # A bio that MENTIONS an opposite-gender relative but self-refers in the pinned gender is NOT a flip
    # (the subject's own pronoun is present) — the lint must not false-positive here.
    npc = {"id": "npc:1", "genderPresentation": "man"}
    bio = ("He runs a bakery with his wife; she keeps the books while he works the ovens. He never "
           "misses a farmers market.")
    assert ca.coherence_conflicts({"biography": bio}, npc) == []
    # A coherent, pin-matching bio + neutral facet is a clean no-op.
    assert ca.coherence_conflicts({"biography": _MASC_BIO, "physicalCharacteristics": _phys()}, npc) == []


def test_coherence_conflicts_flags_a_gender_flipped_distinguishing_mark():
    # The portrait reads the physical facet; a distinguishingMark self-referring in the opposite gender
    # drops the WHOLE facet to the coherent floor (whole-or-nothing).
    npc = {"id": "npc:1", "genderPresentation": "man"}
    profile = {"physicalCharacteristics": _phys(mark="a faded tattoo on her left forearm")}
    assert ca.coherence_conflicts(profile, npc) == ["physicalCharacteristics"]


def test_coherence_conflicts_flags_an_elder_life_stage_on_a_young_age():
    # The bundle's Donna shape: a young pinned age beside a retired / decades-long-career self-bio.
    npc = {"id": "npc:1", "age": 22}
    bio = ("She is a retired principal who spent thirty years in the classroom before this. She now "
           "spends her days gardening.")
    assert ca.coherence_conflicts({"biography": bio}, npc) == ["biography"]
    # An age-appropriate bio at the same young age is fine.
    ok = ("She is a first-year teacher who just finished her degree. She loves a good debate and a "
          "long run.")
    assert ca.coherence_conflicts({"biography": ok}, npc) == []


def test_incoherent_profile_is_refused_and_red_recorded(_clean_ledger):
    # END TO END through author_cast: a profile whose ONLY authored field is a gender-flipped bio is
    # REFUSED (nothing coherent left ⇒ the seeded floor stands) and a RED identity-incoherence health
    # event is recorded — the contradiction never reaches the write-back.
    async def _llm(_messages):
        return json.dumps({"biography": _FEM_BIO})

    written_profiles = []

    async def _write(profile):
        written_profiles.append(profile)
        return {"accepted": True}

    cast = [{"id": "player"}, {"id": "npc:1", "name": "Some One", "genderPresentation": "man"}]
    written = _run(ca.author_cast(cast, _llm, _write, user="probe-user"))

    assert written == 0, "a dossier that contradicts the pinned identity must not commit"
    assert written_profiles == [], "the contradicting profile must never reach recordCastProfile"
    classes = {r["callClass"] for r in enrichment_policy.failures("probe-user")}
    assert "identity-incoherence" in classes, (
        "a write-back that contradicts the pinned identity must record a RED identity-incoherence event")
    assert "enrichment:identity-incoherence" in _overseer_kinds_failed()


def test_incoherent_field_is_stripped_but_coherent_fields_still_write(_clean_ledger):
    # The lint drops ONLY the contradicting field: a flipped bio is stripped, but the coherent facet +
    # secrets still commit (non-degradation — keep what is good, floor only what contradicts).
    async def _llm(_messages):
        return json.dumps({
            "biography": _FEM_BIO,  # contradicts the pinned "man" — must be dropped
            "physicalCharacteristics": _phys(),  # neutral — kept
            "secrets": ["harbors a long-held grudge from a past season", "secretly funds a rival's campaign"],
        })

    written_profiles = []

    async def _write(profile):
        written_profiles.append(profile)
        return {"accepted": True}

    cast = [{"id": "player"}, {"id": "npc:1", "genderPresentation": "man"}]
    written = _run(ca.author_cast(cast, _llm, _write, user="probe-user"))

    assert written == 1, "the coherent remainder of the dossier still commits"
    assert len(written_profiles) == 1
    committed = written_profiles[0]
    assert "biography" not in committed, "the gender-flipped biography must be dropped before write-back"
    assert "physicalCharacteristics" in committed and "secrets" in committed, "coherent fields survive"
    assert "identity-incoherence" in {r["callClass"] for r in enrichment_policy.failures("probe-user")}


def test_coherent_cast_is_a_byte_identical_no_op(_clean_ledger):
    # The lint must NEVER fire on a coherent cast — a pin-matching dossier commits whole with zero
    # health events (this is what keeps soft/golden byte-identical).
    async def _llm(_messages):
        return json.dumps({
            "biography": _MASC_BIO,  # matches the pinned "man"
            "physicalCharacteristics": _phys(),
        })

    written_profiles = []

    async def _write(profile):
        written_profiles.append(profile)
        return {"accepted": True}

    cast = [{"id": "player"}, {"id": "npc:1", "genderPresentation": "man"}]
    written = _run(ca.author_cast(cast, _llm, _write, user="probe-user"))

    assert written == 1
    assert "biography" in written_profiles[0], "a coherent biography is preserved"
    assert not any(r["callClass"] == "identity-incoherence" for r in enrichment_policy.failures("probe-user"))


# ══════════════════════════ F3 — reasoning-channel salvage (landed #1662) ══════════════════════════


def test_reasoning_channel_json_is_recovered_not_dropped():
    # The pure detector: a JSON answer misrouted into the reasoning channel is recovered as a JSON string.
    genesis = importlib.import_module("src.orwell_cast_genesis")
    payload = {"biography": _MASC_BIO, "vocation": "court reporter"}
    reasoning = "Let me think about this houseguest... " + json.dumps(payload) + " that should do it."
    recovered = genesis.recover_reasoning_channel_json(reasoning)
    assert recovered is not None, "content in the reasoning channel must be recovered, not dropped"
    assert json.loads(recovered)["vocation"] == "court reporter"
    # Reasoning with no JSON object at all → None (the caller then keeps the empty body ⇒ floor).
    assert genesis.recover_reasoning_channel_json("just thinking out loud, no json here") is None


def test_recover_from_reasoning_channel_uses_content_and_records_red(_clean_ledger):
    # The cast-authoring salvage: it returns the recovered JSON STRING (so the normal parser consumes it)
    # AND records a RED reasoning-channel-misroute health event — paid-for content is USED, never a
    # silent discard (#1599).
    payload = {"biography": _MASC_BIO, "vocation": "court reporter",
               "secrets": ["keeps a hidden ledger of every promise made"]}
    reasoning = "reasoning: " + json.dumps(payload)
    recovered = ca._recover_from_reasoning_channel(reasoning, "probe-user")
    assert recovered is not None, "the reasoning-channel content must be used"
    # The recovered string flows through the normal authoring parser into a usable write-back profile.
    parsed = ca.parse_authored_profile(recovered, "npc:1")
    assert parsed is not None and parsed.get("vocation") == "court reporter"
    classes = {r["callClass"] for r in enrichment_policy.failures("probe-user")}
    assert "cast-genesis" in classes, "a reasoning-channel misroute must be RED-recorded, not swallowed"
    assert "enrichment:cast-genesis" in _overseer_kinds_failed()


# ══════════════════════════ F4 — genesis token budget (landed #1662) ══════════════════════════


def test_genesis_sketch_floor_clears_the_skeleton_estimate():
    # The whole-cast genesis sketch is ONE completion carrying the ~4400-token 15-NPC skeleton; its
    # output floor must clear that with headroom (the 3000 one-NPC class cap chopped it → committed 0).
    assert token_policy.GENESIS_SKELETON_TOKEN_ESTIMATE >= 4400
    assert token_policy.GENESIS_SKETCH_MIN_OUTPUT_TOKENS >= token_policy.GENESIS_SKELETON_TOKEN_ESTIMATE, (
        "the genesis sketch output floor must clear the 15-NPC skeleton estimate")


def test_genesis_floor_exceeds_the_per_npc_class_cap_that_truncated():
    # The load-bearing fix: the genesis floor must exceed the per-NPC background-authoring class cap
    # (3000) that caused finish_reason=length on the whole-cast sketch.
    per_npc_cap = token_policy.resolve_token_policy("background-authoring").get("max_tokens")
    assert per_npc_cap == 3000, "the per-NPC background-authoring class cap is the 3000 that truncated"
    assert token_policy.GENESIS_SKETCH_MIN_OUTPUT_TOKENS > per_npc_cap, (
        "the whole-cast genesis floor must exceed the one-NPC class cap that chopped the skeleton")
    # A finish_reason=length can grow the cap (the retry ceiling sits above the genesis floor).
    assert token_policy.LENGTH_RETRY_MAX_TOKENS >= token_policy.GENESIS_SKETCH_MIN_OUTPUT_TOKENS


def test_authoring_resolver_accepts_the_genesis_output_floor():
    # F4 plumbing: the authoring resolver takes a per-call `min_output_tokens` floor (the genesis sketch
    # raises the resolved cap to the whole-cast size); the signature is what the genesis path introspects.
    import inspect
    params = inspect.signature(ca.resolve_authoring_llm_fn).parameters
    assert "min_output_tokens" in params, (
        "resolve_authoring_llm_fn must accept min_output_tokens so genesis can raise the sketch cap")
