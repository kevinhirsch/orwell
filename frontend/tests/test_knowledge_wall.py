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


# ── the agent-loop wrapper is wired and fail-open ────────────────────────────────────────── #

def test_agent_loop_wrapper_strips_the_leak():
    _seed(_USER, sealed=[{"content": _DIARY}], active_names=["HOH", "Nominee"])
    leak = 'the Nominee whispered, "I know your secret plan is to backdoor the reigning HOH." You stayed calm.'
    out = _run(agent_loop._knowledge_wall_guard(leak, _USER))
    assert "backdoor the reigning HOH" not in out
    assert "You stayed calm." in out


def test_agent_loop_wrapper_is_fail_open_on_empty():
    assert _run(agent_loop._knowledge_wall_guard("", _USER)) == ""

