"""Feature 0081 — the SHADOW-mode faithfulness hook (P2b: the agent-loop wiring).

The judge (P2a) is wired into the live loop at the post-turn seam (beside the 0079 overseer hook) by
``_faith_check`` + ``_faith_build_projection`` in ``src/agent_loop.py``. This lane proves the
wiring's behavior at the unit grain, mirroring the 0080 active-overseer lane:

  * SHADOW logs a detected slip to the OVERSEER ring and **does NOT correct** (no recordInteraction);
  * a faithful turn (no slip) logs nothing;
  * **live-only carve-out** — with no utility model the hook is a no-op (seeded lanes byte-identical);
  * ``off`` never even resolves a model; a turn with no claim and no engaged scene never wakes;
  * the projection is built ONLY from the two Vault-free engine readers, whitelisted board fields;
  * SOURCE-PIN — the loop wires the hook + the claim-bearing trigger.

Name-agnostic: ROLES only. Async helpers are driven with ``asyncio.run`` (no event loop assumed).
"""

import asyncio
import json
import pathlib

from src.agent_loop import _faith_build_projection, _faith_check


def _run(coro):
    """Run a coroutine on a PRIVATE loop without mutating the global event-loop policy. (asyncio.run
    leaves the policy with no current loop + _set_called=True, which then breaks sibling tests that
    still use the deprecated asyncio.get_event_loop() — e.g. the adr0010 lane — when the full suite
    runs them after this file.)"""
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


def _isolate_settings(monkeypatch, tmp_path):
    from src import settings as _s
    monkeypatch.setattr(_s, "SETTINGS_FILE", str(tmp_path / "settings.json"))
    monkeypatch.setattr(_s, "_settings_cache", None)


def _set_mode(monkeypatch, tmp_path, mode):
    from src.settings import save_settings
    _isolate_settings(monkeypatch, tmp_path)
    monkeypatch.delenv("ORWELL_FAITHFULNESS_MODE", raising=False)
    save_settings({"faithfulness_mode": mode})


async def _fake_state(*a, **k):
    # a Vault-free board projection — plus a bogus field to prove the whitelist drops it.
    return {"week": 2, "phase": "veto", "vetoHolder": "npc:1", "evicted": 3, "secretXYZ": "NOPE"}


async def _fake_visible(*a, **k):
    return {"knows": ["the player witnessed a veto-comp win"]}


def _patch_engine_reads(monkeypatch):
    monkeypatch.setattr("src.orwell_engine.get_game_state", _fake_state)
    monkeypatch.setattr("src.orwell_engine.get_visible_state", _fake_visible)


def _patch_llm(monkeypatch, reply):
    async def _fake_resolve(owner):
        return lambda prompt: reply
    monkeypatch.setattr("src.orwell_cast_authoring._resolve_llm_fn", _fake_resolve)


def _capture_log(monkeypatch):
    logged = []
    monkeypatch.setattr("src.log_rings.record_overseer", lambda *a, **k: logged.append((a, k)))
    return logged


# ── SHADOW logs a slip, and never corrects ─────────────────────────────────────────

def test_shadow_logs_a_slip_and_does_not_correct(monkeypatch, tmp_path):
    _set_mode(monkeypatch, tmp_path, "shadow")
    _patch_engine_reads(monkeypatch)
    _patch_llm(monkeypatch, json.dumps(
        {"dimension": "board", "classification": "closed", "lever": "reframe",
         "rationale": "narration contradicts the board"}))
    logged = _capture_log(monkeypatch)
    corrected = []
    monkeypatch.setattr("src.orwell_engine.record_interaction", lambda *a, **k: corrected.append(1))

    _run(_faith_check("you pulled off the veto", claim_bearing=True,
                             engaged_scene=False, owner="u1"))

    # exactly one slip logged, on the OVERSEER ring, with the faith:<dimension> kind + the lever.
    assert len(logged) == 1
    args, kw = logged[0]
    assert args[0] == "anomaly" and args[1] == "faith:board"
    assert kw.get("lever") == "reframe" and kw.get("user") == "u1"
    assert kw.get("ok") is False                       # a slip is not a clean turn
    # SHADOW: the slip is LOGGED, never corrected — no recordInteraction, no canonicalization.
    assert corrected == []


def test_a_faithful_turn_logs_nothing(monkeypatch, tmp_path):
    _set_mode(monkeypatch, tmp_path, "shadow")
    _patch_engine_reads(monkeypatch)
    _patch_llm(monkeypatch, json.dumps(
        {"dimension": "none", "classification": "none", "lever": "none", "rationale": ""}))
    logged = _capture_log(monkeypatch)
    _run(_faith_check("you and a houseguest talk strategy", claim_bearing=False,
                             engaged_scene=True, owner="u1"))
    assert logged == []                                # a non-slip verdict surfaces nothing


# ── live-only carve-out + dial gating ───────────────────────────────────────────────

def test_no_model_is_a_noop(monkeypatch, tmp_path):
    """The live-only carve-out (ruling D4): with no utility model the hook does nothing — so a seeded
    lane (which never wires a model) is byte-identical."""
    _set_mode(monkeypatch, tmp_path, "shadow")

    async def _none(owner):
        return None
    monkeypatch.setattr("src.orwell_cast_authoring._resolve_llm_fn", _none)
    logged = _capture_log(monkeypatch)
    _run(_faith_check("you won HOH", claim_bearing=True, engaged_scene=False, owner="u1"))
    assert logged == []


def test_off_mode_never_resolves_a_model(monkeypatch, tmp_path):
    _set_mode(monkeypatch, tmp_path, "off")
    resolved = []

    async def _fake_resolve(owner):
        resolved.append(1)
        return lambda p: "{}"
    monkeypatch.setattr("src.orwell_cast_authoring._resolve_llm_fn", _fake_resolve)
    _run(_faith_check("you won HOH", claim_bearing=True, engaged_scene=False, owner="u1"))
    assert resolved == []                              # off ⇒ the judge path is never entered


def test_a_turn_with_no_claim_and_no_scene_never_wakes(monkeypatch, tmp_path):
    """The sparse trigger: a pure lull (no board claim, no engaged scene) never wakes the judge — so
    the live judge cost stays bounded to turns where faithfulness is actually at stake."""
    _set_mode(monkeypatch, tmp_path, "shadow")
    resolved = []

    async def _fake_resolve(owner):
        resolved.append(1)
        return lambda p: "{}"
    monkeypatch.setattr("src.orwell_cast_authoring._resolve_llm_fn", _fake_resolve)
    _run(_faith_check("the house is quiet for a moment", claim_bearing=False,
                             engaged_scene=False, owner="u1"))
    assert resolved == []


# ── the projection is Vault-free + whitelisted ─────────────────────────────────────

def test_projection_is_built_from_vault_free_readers_and_whitelisted(monkeypatch):
    """The projection comes ONLY from the two Vault-free engine readers (getGameState /
    getVisibleStateFor); the board half is a WHITELIST, so an unexpected engine field is dropped — a
    leak can never enter the judge prompt through the projection."""
    calls = []

    async def _state(*a, **k):
        calls.append("state")
        return {"phase": "veto", "vetoHolder": "npc:1", "secretXYZ": "NOPE"}

    async def _visible(*a, **k):
        calls.append("visible")
        return {"knows": ["a"]}
    monkeypatch.setattr("src.orwell_engine.get_game_state", _state)
    monkeypatch.setattr("src.orwell_engine.get_visible_state", _visible)

    proj = _run(_faith_build_projection("u1"))
    assert calls == ["state", "visible"]
    assert proj["board"]["phase"] == "veto" and proj["board"]["vetoHolder"] == "npc:1"
    assert "secretXYZ" not in proj["board"]            # an unknown field is dropped by the whitelist
    assert proj["visible"] == {"knows": ["a"]}


def test_projection_is_fail_soft_when_reads_raise(monkeypatch):
    async def _boom(*a, **k):
        raise RuntimeError("engine down")
    monkeypatch.setattr("src.orwell_engine.get_game_state", _boom)
    monkeypatch.setattr("src.orwell_engine.get_visible_state", _boom)
    # a read failure must degrade to an empty/partial projection, never raise.
    proj = _run(_faith_build_projection("u1"))
    assert isinstance(proj, dict)


# ── SOURCE-PIN — the loop wires the hook + the claim-bearing trigger ───────────────

_AGENT_LOOP_SRC = pathlib.Path(__file__).resolve().parents[1] / "src" / "agent_loop.py"


def test_source_pin_agent_loop_wires_the_shadow_hook():
    src = _AGENT_LOOP_SRC.read_text()
    assert "_faith_check" in src                # the hook is called…
    assert "faithfulness_mode" in src                  # …gated on the dedicated dial…
    assert "_sentence_has_closed_set_claim" in src     # …reusing the 0065 claim-bearing pre-filter.
    assert "dispatch_correction" in src                # …and the active-mode dispatch seam (P3).


# ── P3: ACTIVE-mode adopt + the load-bearing wall ──────────────────────────────────

def _patch_auto_record(monkeypatch):
    """Capture calls to the 0055 record machinery the adopt path reuses (so we can prove WHEN it
    fires). Returns the capture list."""
    recorded = []

    async def _fake_record(*a, **k):
        recorded.append((a, k))
        return True
    monkeypatch.setattr("src.agent_loop._auto_record_scene", _fake_record)
    return recorded


def test_active_adopt_canonicalizes_an_open_set_slip(monkeypatch, tmp_path):
    """In ACTIVE mode an OPEN-set adopt verdict canonicalizes the detail via the 0055 record
    machinery, and emits BOTH the detection line and the O3 adopt marker."""
    _set_mode(monkeypatch, tmp_path, "active")
    _patch_engine_reads(monkeypatch)
    _patch_llm(monkeypatch, json.dumps(
        {"dimension": "persona", "classification": "open", "lever": "adopt",
         "rationale": "a harmless backyard detail"}))
    logged = _capture_log(monkeypatch)
    recorded = _patch_auto_record(monkeypatch)

    _run(_faith_check("they mention a hammock that was never established", claim_bearing=False,
                      engaged_scene=True, owner="u1", endpoint_url="http://x", model="m",
                      headers={}, last_user="hi"))

    assert len(recorded) == 1                          # adopt fired: the scene was recorded
    kinds = [a[1] for (a, k) in logged]
    assert "faith:persona" in kinds                    # the detection line…
    assert "faith:adopt:persona" in kinds              # …and the O3 adopt marker (auditable)


def test_load_bearing_a_closed_set_slip_is_never_adopted(monkeypatch, tmp_path):
    """THE LOAD-BEARING TEST (mandate #3): in ACTIVE mode a closed-set slip is NEVER adopted — the
    recordInteraction machinery is never reached, so a misnarration can never canonicalize a
    closed-set outcome. We try BOTH a clean closed-set verdict (reframe) AND a reply that asks to
    adopt a closed-set slip (which the wall rejects upstream, at parse)."""
    _set_mode(monkeypatch, tmp_path, "active")
    _patch_engine_reads(monkeypatch)
    recorded = _patch_auto_record(monkeypatch)
    _capture_log(monkeypatch)

    # a) a clean CLOSED-set reframe verdict — never adopts.
    _patch_llm(monkeypatch, json.dumps(
        {"dimension": "board", "classification": "closed", "lever": "reframe", "rationale": "x"}))
    _run(_faith_check("you pulled off the veto", claim_bearing=True, engaged_scene=False, owner="u1",
                      endpoint_url="http://x", model="m", headers={}, last_user="hi"))

    # b) a reply ASKING to adopt a closed slip — the wall rejects it at parse (verdict -> None).
    _patch_llm(monkeypatch, json.dumps(
        {"dimension": "board", "classification": "closed", "lever": "adopt", "rationale": "x"}))
    _run(_faith_check("you pulled off the veto", claim_bearing=True, engaged_scene=False, owner="u1",
                      endpoint_url="http://x", model="m", headers={}, last_user="hi"))

    assert recorded == []                              # recordInteraction NEVER fired for closed-set


def test_shadow_never_adopts_even_an_open_set_slip(monkeypatch, tmp_path):
    """SHADOW logs an open-set slip but never corrects — adopt belongs to ACTIVE only."""
    _set_mode(monkeypatch, tmp_path, "shadow")
    _patch_engine_reads(monkeypatch)
    _patch_llm(monkeypatch, json.dumps(
        {"dimension": "persona", "classification": "open", "lever": "adopt", "rationale": "x"}))
    logged = _capture_log(monkeypatch)
    recorded = _patch_auto_record(monkeypatch)

    _run(_faith_check("they mention a hammock", claim_bearing=False, engaged_scene=True, owner="u1",
                      endpoint_url="http://x", model="m", headers={}, last_user="hi"))

    assert len(logged) == 1 and logged[0][0][1] == "faith:persona"   # logged the detection…
    assert recorded == []                                            # …but never adopted
