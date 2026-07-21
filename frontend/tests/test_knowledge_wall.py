"""Ship-blocker A0 — the model-level KNOWLEDGE WALL (post-hoc leak scan).

Two live playthroughs had a houseguest recite the player's private bedroom secret and the player's
Diary-Room plan VERBATIM, though the Vault proved NO in-game pathway ever gave that houseguest the
content. The Diary Room is a player-level OOC channel with NO pathway to ANY houseguest — a
structural Vault-Wall violation, not a narration-quality nit. While it holds nothing the player says
is private and the social-deduction game has no floor.

The engine already computes the always-sealed set (`sealedFromHouse` — the Diary-Room entries,
`knownTo` empty). This is the DEFENSE-IN-DEPTH scan the front-end runs before a line reaches the
player: if a houseguest is STAGED voicing content sealed from them, the sentence is DROPPED.

Roles only: the houseguest display names are role words (HOH / Nominee). Throwaway prose exercises the
regexes exactly as the sibling guard tests do; no name carries test intent.
"""

import asyncio
import importlib
import time

import pytest

chat_helpers = importlib.import_module("routes.chat_helpers")
orwell_engine = importlib.import_module("src.orwell_engine")
agent_loop = importlib.import_module("src.agent_loop")


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


_USER = "u-knowledge-wall"
# The player's private Diary-Room plan — sealed from the WHOLE house (no pathway to any houseguest).
_DIARY = "my secret plan is to backdoor the reigning HOH next week"


def _seed(user, *, sealed, active_names):
    """Prime the per-turn stores the scan reads: the sealed manifest (TTL cache) + the active roster."""
    facts = []
    for f in sealed:
        sigs = chat_helpers._sealed_signatures(f["content"])
        facts.append({"content": f["content"], "knownTo": [k.lower() for k in f.get("knownTo", [])],
                      "signatures": sigs})
    chat_helpers._KW_SEALED_CACHE[chat_helpers._kw_key(user)] = (time.monotonic(), facts)
    chat_helpers._LAST_BEAT_SIG[chat_helpers._desync_key(user)] = {"activeNames": list(active_names)}


@pytest.fixture(autouse=True)
def _clean_state():
    for key in (chat_helpers._kw_key(_USER), "default"):
        chat_helpers._KW_SEALED_CACHE.pop(key, None)
    for key in (chat_helpers._desync_key(_USER), None):
        chat_helpers._LAST_BEAT_SIG.pop(key, None)
        chat_helpers._DESYNC_REGROUND.pop(key, None)
    yield
    for key in (chat_helpers._kw_key(_USER), "default"):
        chat_helpers._KW_SEALED_CACHE.pop(key, None)
    for key in (chat_helpers._desync_key(_USER), None):
        chat_helpers._LAST_BEAT_SIG.pop(key, None)
        chat_helpers._DESYNC_REGROUND.pop(key, None)


# ── the distinctive-signature primitive ──────────────────────────────────────────────────── #

def test_signatures_are_distinctive_multiword_shingles():
    sigs = chat_helpers._sealed_signatures(_DIARY)
    assert sigs, "a non-trivial disclosure must yield signatures"
    # Every shingle is multi-word and stopword-free (so ordinary phrasing never trips it).
    assert all(len(s.split()) >= 2 for s in sigs)
    assert all("the" not in s.split() and "to" not in s.split() for s in sigs)
    # The distinctive core of the plan is present as a signature.
    assert any("backdoor" in s for s in sigs)


def test_signature_survives_intervening_stopwords():
    # The recital's raw words are interrupted by stopwords ('is to', 'the') — the content-normalized
    # comparison must still see the sealed shingle.
    sig = chat_helpers._sealed_signatures(_DIARY)[0]
    spoken = "I know your secret plan is to backdoor the reigning HOH before anyone catches on"
    assert sig in chat_helpers._kw_content_norm(spoken)


# ── the sentence-level leak detector ─────────────────────────────────────────────────────── #

def _facts_diary():
    return [{"content": _DIARY, "knownTo": [], "signatures": chat_helpers._sealed_signatures(_DIARY)}]


def test_houseguest_voicing_diary_content_is_a_leak():
    leak = 'the Nominee leaned in and whispered, "I know your secret plan is to backdoor the reigning HOH."'
    assert chat_helpers._sentence_leaks_sealed(leak, _facts_diary(), ["HOH", "Nominee"]) is True


def test_player_restating_their_own_plan_is_not_a_leak():
    # No houseguest is STAGED speaking — the player voicing their OWN plan is legitimate, never stripped.
    own = "You decide your secret plan is to backdoor the reigning HOH, and you keep it to yourself."
    assert chat_helpers._sentence_leaks_sealed(own, _facts_diary(), ["HOH", "Nominee"]) is False


def test_ordinary_scene_prose_is_not_a_leak():
    prose = 'the Nominee laughed and said, "the backyard is freezing tonight."'
    assert chat_helpers._sentence_leaks_sealed(prose, _facts_diary(), ["HOH", "Nominee"]) is False


# ── the cross-NPC pathway case (knownTo-aware) ───────────────────────────────────────────── #

def test_secret_voiced_by_a_houseguest_outside_the_pathway_is_a_leak():
    # A private disclosure only the HOH holds (knownTo=[HOH]); the Nominee voicing it had no pathway.
    secret = "I am in a secret final two with the HOH"
    facts = [{"content": secret, "knownTo": ["hoh"], "signatures": chat_helpers._sealed_signatures(secret)}]
    leak = 'the Nominee smirked and said, "I am in a secret final two with the HOH, everyone knows."'
    assert chat_helpers._sentence_leaks_sealed(leak, facts, ["HOH", "Nominee"]) is True


def test_secret_voiced_by_the_pathway_holder_is_allowed():
    secret = "I am in a secret final two with the Nominee"
    facts = [{"content": secret, "knownTo": ["hoh"], "signatures": chat_helpers._sealed_signatures(secret)}]
    # The HOH DOES hold it (knownTo) — the HOH voicing it is legitimate, never stripped.
    ok = 'the HOH murmured, "I am in a secret final two with the Nominee, keep it quiet."'
    assert chat_helpers._sentence_leaks_sealed(ok, facts, ["HOH", "Nominee"]) is False


# ── the end-to-end scan over a synthetic transcript ──────────────────────────────────────── #

def test_scan_strips_the_leaking_sentence_and_keeps_the_rest():
    _seed(_USER, sealed=[{"content": _DIARY}], active_names=["HOH", "Nominee"])
    transcript = (
        "The kitchen was loud with the whole house milling around. "
        'the Nominee leaned in and whispered, "I know your secret plan is to backdoor the reigning HOH." '
        "You kept your face still and changed the subject."
    )
    out = _run(chat_helpers.screen_knowledge_wall(_USER, transcript))
    assert "backdoor the reigning HOH" not in out  # the recital is gone
    assert "The kitchen was loud" in out            # ordinary prose survives
    assert "changed the subject" in out
    # A next-turn re-ground is stashed after a strip.
    assert chat_helpers._DESYNC_REGROUND.get(chat_helpers._desync_key(_USER))


def test_scan_passes_clean_narration_through_verbatim():
    _seed(_USER, sealed=[{"content": _DIARY}], active_names=["HOH", "Nominee"])
    clean = (
        'the HOH grinned and said, "welcome to my room." '
        "You settled onto the couch and traded strategy in vague terms."
    )
    out = _run(chat_helpers.screen_knowledge_wall(_USER, clean))
    assert out == clean  # byte-identical: nothing sealed is voiced


def test_scan_is_a_noop_when_nothing_is_sealed():
    _seed(_USER, sealed=[], active_names=["HOH", "Nominee"])
    text = 'the Nominee said, "I have a plan to win the veto."'
    out = _run(chat_helpers.screen_knowledge_wall(_USER, text))
    assert out == text


def test_scan_is_a_noop_without_a_roster_baseline():
    # No active roster ⇒ a speaker can't be attributed ⇒ conservative emit (never a false strip).
    chat_helpers._KW_SEALED_CACHE[chat_helpers._kw_key(_USER)] = (
        time.monotonic(), _facts_diary())
    chat_helpers._LAST_BEAT_SIG.pop(chat_helpers._desync_key(_USER), None)
    leak = 'the Nominee whispered, "I know your secret plan is to backdoor the reigning HOH."'
    out = _run(chat_helpers.screen_knowledge_wall(_USER, leak))
    assert out == leak


# ── NAR-1: the belt is NOT dead single-tenant (owner=None) ───────────────────────────────── #

def test_scan_fires_single_tenant_with_owner_none():
    # Under AUTH_ENABLED=false the chat route runs with owner=None. The cache/roster key must resolve
    # to the SAME sentinel on the write and the read — the exact NAR-1 trap the prior bug hit.
    key = chat_helpers._kw_key(None)          # "default" (or the canonical gs id)
    dkey = chat_helpers._desync_key(None)     # None (or the canonical gs id)
    chat_helpers._KW_SEALED_CACHE[key] = (time.monotonic(), _facts_diary())
    chat_helpers._LAST_BEAT_SIG[dkey] = {"activeNames": ["HOH", "Nominee"]}
    try:
        leak = 'the Nominee whispered, "I know your secret plan is to backdoor the reigning HOH." You froze.'
        out = _run(chat_helpers.screen_knowledge_wall(None, leak))
        assert "backdoor the reigning HOH" not in out
        assert "You froze." in out
    finally:
        chat_helpers._KW_SEALED_CACHE.pop(key, None)
        chat_helpers._LAST_BEAT_SIG.pop(dkey, None)
        chat_helpers._DESYNC_REGROUND.pop(dkey, None)


# ── ADR 0019 Layer 3 — the guard consumes the generalized knowledge-scope manifest ──────────── #


def test_fetch_unions_sealed_and_scope_manifests(monkeypatch):
    """`fetch_sealed_from_house` merges `sealedFromHouse` (DR class) AND ADR 0019 Layer 3's
    `knowledgeScopeManifest` (bounded facts with their real holder set) into ONE guard manifest."""
    chat_helpers._KW_SEALED_CACHE.pop(chat_helpers._kw_key(_USER), None)

    async def _sealed(user=None):
        return [{"content": _DIARY, "knownTo": []}]

    async def _scope(user=None):
        return [{"content": "I am in a secret final two with the HOH", "knownTo": ["HOH"]}]

    monkeypatch.setattr(orwell_engine, "sealed_from_house", _sealed)
    monkeypatch.setattr(orwell_engine, "knowledge_scope_manifest", _scope)

    facts = _run(chat_helpers.fetch_sealed_from_house(_USER))
    contents = [f["content"] for f in facts]
    assert _DIARY in contents  # the always-sealed DR fact
    assert any("secret final two" in c for c in contents)  # the bounded scope-manifest fact
    scoped = next(f for f in facts if "secret final two" in f["content"])
    assert scoped["knownTo"] == ["hoh"]  # holder names carried through (lowercased)


def test_scope_manifest_fetch_failure_still_yields_sealed(monkeypatch):
    """If the ADR 0019 manifest call fails, the always-sealed DR set is still delivered (fail-soft)."""
    chat_helpers._KW_SEALED_CACHE.pop(chat_helpers._kw_key(_USER), None)

    async def _sealed(user=None):
        return [{"content": _DIARY, "knownTo": []}]

    async def _scope(user=None):
        raise RuntimeError("engine blip")

    monkeypatch.setattr(orwell_engine, "sealed_from_house", _sealed)
    monkeypatch.setattr(orwell_engine, "knowledge_scope_manifest", _scope)

    facts = _run(chat_helpers.fetch_sealed_from_house(_USER))
    assert any(_DIARY in f["content"] for f in facts)


def test_sealed_fetch_failure_still_yields_scope_manifest(monkeypatch):
    """The REVERSE of the above (Greptile #1723): if the DR-seal fetch fails, the ADR 0019 Layer 3
    scope manifest is STILL delivered — the two fetches are independent, so one failing never skips
    the other (before the per-source try split, a sealed_from_house blip killed both)."""
    chat_helpers._KW_SEALED_CACHE.pop(chat_helpers._kw_key(_USER), None)

    async def _sealed(user=None):
        raise RuntimeError("engine blip")

    async def _scope(user=None):
        return [{"content": "I am in a secret final two with the HOH", "knownTo": ["HOH"]}]

    monkeypatch.setattr(orwell_engine, "sealed_from_house", _sealed)
    monkeypatch.setattr(orwell_engine, "knowledge_scope_manifest", _scope)

    facts = _run(chat_helpers.fetch_sealed_from_house(_USER))
    assert any("secret final two" in f["content"] for f in facts)


def test_bounded_fact_voiced_by_a_non_holder_is_dropped_end_to_end():
    """The room-to-room asymmetry the ADR closes: a fact bounded to the HOH, voiced by a STAGED
    Nominee who has no pathway to it, is stripped exactly as a Diary-Room recital is."""
    secret = "the HOH and I have a secret final two deal"
    _seed(
        _USER,
        sealed=[{"content": secret, "knownTo": ["HOH"]}],
        active_names=["HOH", "Nominee"],
    )
    transcript = (
        "The two of them lingered by the pool. "
        'the Nominee grinned and said, "the HOH and I have a secret final two deal." '
        "You filed it away."
    )
    out = _run(chat_helpers.screen_knowledge_wall(_USER, transcript))
    assert "secret final two deal" not in out  # the Nominee had no pathway — dropped
    assert "lingered by the pool" in out
    assert "You filed it away." in out


def test_bounded_fact_voiced_by_the_holder_is_kept_end_to_end():
    """The holder voicing THEIR OWN bounded fact is legitimate — never stripped."""
    secret = "the Nominee and I have a secret final two deal"
    _seed(
        _USER,
        sealed=[{"content": secret, "knownTo": ["HOH"]}],
        active_names=["HOH", "Nominee"],
    )
    transcript = 'the HOH murmured, "the Nominee and I have a secret final two deal." You nodded.'
    out = _run(chat_helpers.screen_knowledge_wall(_USER, transcript))
    assert out == transcript  # the HOH holds it — nothing stripped


# ── the agent-loop wrapper is wired and fail-open ────────────────────────────────────────── #

def test_agent_loop_wrapper_strips_the_leak():
    _seed(_USER, sealed=[{"content": _DIARY}], active_names=["HOH", "Nominee"])
    leak = 'the Nominee whispered, "I know your secret plan is to backdoor the reigning HOH." You stayed calm.'
    out = _run(agent_loop._knowledge_wall_guard(leak, _USER))
    assert "backdoor the reigning HOH" not in out
    assert "You stayed calm." in out


def test_agent_loop_wrapper_is_fail_open_on_empty():
    assert _run(agent_loop._knowledge_wall_guard("", _USER)) == ""


# ── ADR 0019 guardian caveat C1 — the producer-only casting backstop ─────────────────────── #
#
# The player's producer-only casting material (motivation / private strategy / backstory / interview
# notes) has NO in-game pathway to ANY houseguest — the exact "camp counselor" leak class that birthed
# ADR 0019. The engine now emits it from `sealedFromHouse` as a GLOBALLY-sealed fact (`knownTo` empty),
# so the SAME Layer 3 guard that drops a Diary-Room recital also drops a houseguest reciting a casting
# answer — the defense-in-depth backstop behind Layer 1's context removal. Roles only.

# A distinctive producer-only casting answer (the player told production this; no houseguest was there).
_CASTING = "I told the producers my real motivation is to avenge my sister's blindside"


def test_producer_casting_content_voiced_by_a_houseguest_is_a_leak():
    # A globally-sealed casting fact (knownTo empty) recited by a STAGED houseguest — dropped, exactly
    # like a Diary-Room recital: no houseguest ever had a pathway to the casting interview.
    facts = [{"content": _CASTING, "knownTo": [],
              "signatures": chat_helpers._sealed_signatures(_CASTING)}]
    leak = ('the Nominee smirked and said, '
            '"I know your real motivation is to avenge your sister\'s blindside."')
    assert chat_helpers._sentence_leaks_sealed(leak, facts, ["HOH", "Nominee"]) is True


def test_player_recalling_their_own_casting_answer_is_not_a_leak():
    # No houseguest is STAGED — the player's own narration of their casting motivation is legitimate.
    facts = [{"content": _CASTING, "knownTo": [],
              "signatures": chat_helpers._sealed_signatures(_CASTING)}]
    own = "You remember telling the producers your real motivation is to avenge your sister's blindside."
    assert chat_helpers._sentence_leaks_sealed(own, facts, ["HOH", "Nominee"]) is False


def test_scan_strips_a_houseguest_reciting_the_casting_answer_end_to_end():
    _seed(_USER, sealed=[{"content": _CASTING, "knownTo": []}], active_names=["HOH", "Nominee"])
    transcript = (
        "The backyard was quiet at dusk. "
        'the HOH leaned in and said, "I know your real motivation is to avenge your sister\'s blindside." '
        "You forced a laugh and deflected."
    )
    out = _run(chat_helpers.screen_knowledge_wall(_USER, transcript))
    assert "avenge your sister" not in out          # the casting recital is dropped (C1 backstop)
    assert "The backyard was quiet" in out           # ordinary prose survives
    assert "forced a laugh" in out


def test_fetch_surfaces_the_casting_class_from_sealed_from_house(monkeypatch):
    """The producer-only casting class rides in on `sealedFromHouse` (knownTo empty), UNIONed with the
    Layer 3 scope manifest exactly as the DR class is — so the guard consumes it with zero new wiring."""
    chat_helpers._KW_SEALED_CACHE.pop(chat_helpers._kw_key(_USER), None)

    async def _sealed(user=None):
        # sealedFromHouse now returns the DR class AND the producer-only casting class, both knownTo=[].
        return [{"content": _DIARY, "knownTo": []}, {"content": _CASTING, "knownTo": []}]

    async def _scope(user=None):
        return []

    monkeypatch.setattr(orwell_engine, "sealed_from_house", _sealed)
    monkeypatch.setattr(orwell_engine, "knowledge_scope_manifest", _scope)

    facts = _run(chat_helpers.fetch_sealed_from_house(_USER))
    contents = [f["content"] for f in facts]
    assert any("avenge my sister" in c for c in contents)  # the casting fact is in the guard manifest
    casting = next(f for f in facts if "avenge my sister" in f["content"])
    assert casting["knownTo"] == []  # globally sealed ⇒ ANY staged houseguest voicing it is dropped


def test_a_houseguest_referencing_the_players_shared_backstory_is_NOT_dropped():
    # Greptile #1763 / ADR 0005 #1: backstory is shareable public bio, so it is NOT in the sealed set —
    # a houseguest the player told legitimately references it, and the guard must never hold that line.
    # Only the producer-only motivation is sealed here; the backstory reference has no signature to match.
    _seed(_USER, sealed=[{"content": _CASTING, "knownTo": []}], active_names=["HOH", "Nominee"])
    transcript = (
        'the Nominee smiled and said, "you mentioned you\'re a nurse from Ohio — that must be intense." '
        "You nodded and told them more about the ward."
    )
    out = _run(chat_helpers.screen_knowledge_wall(_USER, transcript))
    assert out == transcript  # byte-identical: shared backstory is legitimate open-set narration


# ── ADR 0019 guardian caveat C2 — the ACCEPTED-RESIDUAL paraphrase MONITOR (SOFT, never a drop) ── #
#
# C2 is ADR 0019's deliberately-accepted residual: one LLM voices every NPC from ONE shared completion,
# and the transcript is legitimately the player's own knowledge union, so a VAGUE PARAPHRASE ("you've
# got a counselor vibe") cannot be shingle-matched or deleted without dropping legitimate creative prose
# (ADR 0005 #1). It is NOT closed structurally — by design. `_paraphrase_suspect` is a SOFT, LOG-ONLY
# red-team signal for the nightly probe; these tests pin that (a) it flags the residual the verbatim
# guard cannot, (b) the verbatim guard still HARD-drops a recital, and (c) it does not fire on ordinary
# prose or on the holder alluding to their own fact. Roles only.

# A genuinely producer-only casting note the player confided to production (never spoken in-house — a
# private-strategy-class fact, not the shareable public backstory, which is NOT globally sealed).
_CAMP = "I confided to production that my hidden edge is old summer camp counselor mind games"


def _facts_camp():
    return [{"content": _CAMP, "knownTo": [], "signatures": chat_helpers._sealed_signatures(_CAMP)}]


def test_paraphrase_of_a_sealed_fact_is_a_soft_suspect_not_a_hard_leak():
    # The "counselor vibe" case: a houseguest ALLUDES to the sealed casting fact without reciting it.
    para = 'the Nominee leaned in and said, "you\'ve totally got a camp-counselor vibe, no offense."'
    # HARD guard does NOT (and must not) drop it — it is not a verbatim shingle of the sealed content.
    assert chat_helpers._sentence_leaks_sealed(para, _facts_camp(), ["HOH", "Nominee"]) is False
    # SOFT monitor DOES flag it for red-team review (the accepted residual is observed, not silently lost).
    assert chat_helpers._paraphrase_suspect(para, _facts_camp(), ["HOH", "Nominee"]) is True


def test_verbatim_recital_is_still_hard_dropped_not_merely_soft_flagged():
    recital = 'the Nominee grinned, "your hidden edge is old summer camp counselor mind games, huh?"'
    # The verbatim class stays HARD (Layer 3 drops it); the SOFT monitor defers to it (no double-count).
    assert chat_helpers._sentence_leaks_sealed(recital, _facts_camp(), ["HOH", "Nominee"]) is True
    assert chat_helpers._paraphrase_suspect(recital, _facts_camp(), ["HOH", "Nominee"]) is False


def test_ordinary_prose_is_not_a_paraphrase_suspect():
    prose = 'the Nominee laughed and said, "the backyard hammock is the best seat in the house."'
    assert chat_helpers._paraphrase_suspect(prose, _facts_camp(), ["HOH", "Nominee"]) is False


def test_the_player_alluding_to_their_own_casting_answer_is_not_a_suspect():
    # No houseguest is STAGED — the player reflecting on their own casting past is legitimate.
    own = "You think back to your summer camp counselor days and smile to yourself."
    assert chat_helpers._paraphrase_suspect(own, _facts_camp(), ["HOH", "Nominee"]) is False


def test_a_pathway_holder_alluding_to_a_fact_they_hold_is_not_a_suspect():
    # A bounded fact the HOH legitimately holds — the HOH paraphrasing it is fine, only a NON-holder flags.
    secret = "the HOH and I are quietly running a secret final two"
    facts = [{"content": secret, "knownTo": ["hoh"],
              "signatures": chat_helpers._sealed_signatures(secret)}]
    holder_line = 'the HOH murmured, "our quiet little final-two arrangement is holding, right?"'
    assert chat_helpers._paraphrase_suspect(holder_line, facts, ["HOH", "Nominee"]) is False

