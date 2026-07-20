"""Owner directive 2026-07-11 — the narration model authors characters end-to-end, hot.

Gates for the cast-authoring call-class upgrade:
  * ROUTING — `resolve_authoring_llm_fn` routes to the NARRATION model (`default_*`) by default,
    with the utility chain APPENDED as the EXPLICIT fallback (never silent); the runtime-editable
    `cast_authoring_model_source="utility"` restores the legacy utility-first routing.
  * TEMPERATURE — the per-class `cast_authoring_temperature` knob (default 1.0 — owner: hot
    character generation out of the box; clamped 0.0–2.0 so >=1.5 stays reachable) applies to the
    cast-authoring calls ONLY; the shared background-utility default (0.6) is untouched for the
    other `_resolve_llm_fn` consumers.
  * COMPAT — the many tests that monkeypatch `_resolve_llm_fn` with a bare `(owner)` fake keep
    intercepting the authoring path (the router falls back to the bare legacy call).
  * WIDENING — the authoring prompt + parser carry the expressive-e2e VOICE fingerprint (0084
    idiolect), forwarded whole-or-nothing; the seeded voice rides the skeleton brief. The seeded
    NAME draw and the numeric competition stats stay engine-side (ruling #1 / anti-sycophancy).

Roles only — every string is a generic probe, never cast material.
"""
import importlib
import json

import pytest

ca = importlib.import_module("src.orwell_cast_authoring")


# ── the knobs (runtime-read, defensively validated) ─────────────────────────────────────

def _pin_setting(monkeypatch, key, value):
    import src.settings as settings_mod
    real = settings_mod.get_setting

    def fake(k, default=None):
        if k == key:
            return value
        return real(k, default)
    monkeypatch.setattr(settings_mod, "get_setting", fake)


def test_model_source_defaults_to_narration(monkeypatch):
    _pin_setting(monkeypatch, "cast_authoring_model_source", "")
    assert ca.cast_authoring_model_source() == "narration"


def test_model_source_utility_override(monkeypatch):
    _pin_setting(monkeypatch, "cast_authoring_model_source", "utility")
    assert ca.cast_authoring_model_source() == "utility"


def test_model_source_garbage_falls_back(monkeypatch):
    _pin_setting(monkeypatch, "cast_authoring_model_source", "gpt-9000")
    assert ca.cast_authoring_model_source() == "narration"


def test_temperature_defaults_to_1_0(monkeypatch):
    _pin_setting(monkeypatch, "cast_authoring_temperature", None)
    assert ca.cast_authoring_temperature() == pytest.approx(1.0)


def test_temperature_is_runtime_editable_and_allows_hot_values(monkeypatch):
    _pin_setting(monkeypatch, "cast_authoring_temperature", 1.6)
    assert ca.cast_authoring_temperature() == pytest.approx(1.6), \
        ">=1.5 must stay admin-reachable (owner ruling)"


def test_temperature_is_clamped_and_garbage_safe(monkeypatch):
    _pin_setting(monkeypatch, "cast_authoring_temperature", 40)
    assert ca.cast_authoring_temperature() == pytest.approx(2.0)
    _pin_setting(monkeypatch, "cast_authoring_temperature", -3)
    assert ca.cast_authoring_temperature() == pytest.approx(0.0)
    _pin_setting(monkeypatch, "cast_authoring_temperature", "not-a-number")
    assert ca.cast_authoring_temperature() == pytest.approx(1.0)
    _pin_setting(monkeypatch, "cast_authoring_temperature", True)  # a stray bool is never a temp
    assert ca.cast_authoring_temperature() == pytest.approx(1.0)


def test_shared_utility_temperature_untouched():
    """The other `_resolve_llm_fn` consumers (zeitgeist / texture / identity) keep the moderate
    shared default — the hot knob is per-class, applied to cast authoring only."""
    assert ca._AUTHOR_TEMPERATURE == pytest.approx(0.6)


def test_defaults_present_in_settings():
    from src.settings import DEFAULT_SETTINGS
    assert DEFAULT_SETTINGS["cast_authoring_model_source"] == "narration"
    assert DEFAULT_SETTINGS["cast_authoring_temperature"] == pytest.approx(1.0)
    assert "enrichment_policy" in DEFAULT_SETTINGS


# ── the live routing (narration-first, explicit utility fallback, hot temperature) ───────

def _wire_fake_endpoints(monkeypatch):
    """Stub the endpoint resolver with distinct narration/utility tiers and capture the stream call."""
    import src.endpoint_resolver as er
    import src.llm_core as lc

    def fake_resolve(prefix, owner=None, **k):
        if prefix == "default":
            return ("https://x/narr", "narrator-model", {})
        if prefix == "utility":
            return ("https://x/util", "utility-model", {})
        return (None, None, None)
    monkeypatch.setattr(er, "resolve_endpoint", fake_resolve)
    monkeypatch.setattr(er, "resolve_utility_fallback_candidates",
                        lambda owner=None: [("https://x/util2", "utility-fallback-model", {})])
    monkeypatch.setattr(er, "_resolve_fallback_candidates", lambda key, owner=None: [])

    captured = {}

    async def fake_stream(candidates, messages, **kwargs):
        captured["candidates"] = candidates
        captured["kwargs"] = kwargs
        yield {"delta": '{"ok": true}'}
    monkeypatch.setattr(lc, "stream_llm_with_fallback", fake_stream)
    return captured


def test_default_routing_is_narration_first_with_explicit_utility_fallback(monkeypatch, run):
    _pin_setting(monkeypatch, "cast_authoring_model_source", "")
    captured = _wire_fake_endpoints(monkeypatch)

    fn = run(ca.resolve_authoring_llm_fn("u"))
    assert fn is not None
    run(fn([{"role": "user", "content": "author"}]))

    models = [m for (_u, m, _h) in captured["candidates"]]
    assert models[0] == "narrator-model", "the narration model must be the PRIMARY authoring model"
    assert "utility-model" in models and "utility-fallback-model" in models, \
        "the utility chain must be appended as the EXPLICIT fallback — never silent"
    assert models.index("narrator-model") < models.index("utility-model")
    assert captured["kwargs"].get("temperature") == pytest.approx(1.0), \
        "the hot per-class temperature must ride the authoring call"


def test_runtime_temperature_override_rides_the_call(monkeypatch, run):
    import src.settings as settings_mod
    real = settings_mod.get_setting

    def fake(k, default=None):
        if k == "cast_authoring_temperature":
            return 1.5
        if k == "cast_authoring_model_source":
            return ""
        return real(k, default)
    monkeypatch.setattr(settings_mod, "get_setting", fake)
    captured = _wire_fake_endpoints(monkeypatch)

    fn = run(ca.resolve_authoring_llm_fn("u"))
    run(fn([{"role": "user", "content": "author"}]))
    assert captured["kwargs"].get("temperature") == pytest.approx(1.5)


def test_utility_override_restores_legacy_routing(monkeypatch, run):
    _pin_setting(monkeypatch, "cast_authoring_model_source", "utility")
    captured = _wire_fake_endpoints(monkeypatch)

    fn = run(ca.resolve_authoring_llm_fn("u"))
    run(fn([{"role": "user", "content": "author"}]))
    models = [m for (_u, m, _h) in captured["candidates"]]
    assert models[0] == "utility-model", "the utility override must restore utility-first routing"
    assert "narrator-model" not in models, "no narration candidate on the legacy routing"


def test_other_consumers_keep_the_utility_routing_and_temperature(monkeypatch, run):
    """The shared `_resolve_llm_fn(owner)` default call — zeitgeist/texture/identity — is
    byte-identical: utility-first, moderate temperature, no narration candidate."""
    captured = _wire_fake_endpoints(monkeypatch)
    fn = run(ca._resolve_llm_fn("u"))
    run(fn([{"role": "user", "content": "extract"}]))
    models = [m for (_u, m, _h) in captured["candidates"]]
    assert models[0] == "utility-model"
    assert "narrator-model" not in models
    assert captured["kwargs"].get("temperature") == pytest.approx(0.6)


def test_deduped_when_narration_and_utility_share_a_model(monkeypatch, run):
    import src.endpoint_resolver as er
    import src.llm_core as lc

    monkeypatch.setattr(er, "resolve_endpoint",
                        lambda prefix, owner=None, **k: ("https://x/one", "same-model", {}))
    monkeypatch.setattr(er, "resolve_utility_fallback_candidates", lambda owner=None: [])
    monkeypatch.setattr(er, "_resolve_fallback_candidates", lambda key, owner=None: [])
    captured = {}

    async def fake_stream(candidates, messages, **kwargs):
        captured["candidates"] = candidates
        yield {"delta": "{}"}
    monkeypatch.setattr(lc, "stream_llm_with_fallback", fake_stream)
    _pin_setting(monkeypatch, "cast_authoring_model_source", "")

    fn = run(ca.resolve_authoring_llm_fn("u"))
    run(fn([{"role": "user", "content": "author"}]))
    models = [m for (_u, m, _h) in captured["candidates"]]
    assert models == ["same-model"], "the explicit fallback must be de-duped, never dialed twice"


# ── monkeypatch compatibility (the whole existing stub fleet) ────────────────────────────

def test_legacy_bare_signature_stub_still_intercepts(monkeypatch, run):
    """A test that monkeypatches `_resolve_llm_fn` with a bare `(owner)` fake must keep
    intercepting the authoring path — the router falls back to the bare legacy call."""
    sentinel_fn = object()

    async def legacy_stub(owner):
        return sentinel_fn
    monkeypatch.setattr(ca, "_resolve_llm_fn", legacy_stub)
    assert run(ca.resolve_authoring_llm_fn("u")) is sentinel_fn


def test_kwargs_stub_receives_the_routing(monkeypatch, run):
    seen = {}

    async def kwargs_stub(owner, **kwargs):
        seen.update(kwargs)
        return None
    monkeypatch.setattr(ca, "_resolve_llm_fn", kwargs_stub)
    run(ca.resolve_authoring_llm_fn("u"))
    assert seen.get("prefix") == "default"
    assert seen.get("include_utility_fallback") is True
    assert isinstance(seen.get("temperature"), float)


def test_house_entry_gate_mirrors_the_authoring_resolver(monkeypatch, run):
    """The #1313 gate must engage off the SAME resolver authoring uses (narration-routed) —
    resolve_authoring_llm_fn None ⇒ gate off, resolvable ⇒ gate on."""
    monkeypatch.delenv("ORWELL_ALLOW_FLOOR_START", raising=False)

    async def _none(owner):
        return None
    monkeypatch.setattr(ca, "resolve_authoring_llm_fn", _none)
    assert run(ca.house_entry_gate_active("u")) is False

    async def _model(owner):
        return lambda m: "{}"
    monkeypatch.setattr(ca, "resolve_authoring_llm_fn", _model)
    assert run(ca.house_entry_gate_active("u")) is True


# ── the expressive-e2e widening: the VOICE fingerprint (0084 idiolect) ───────────────────

_VOICE = {
    "register": "folksy", "rhythm": "rambling", "energy": "warm", "directness": "candid",
    "humor": "self-deprecating", "stressTell": "over-explains",
    "signature": "circles a topic three times before landing on it",
    "lexicon": ["okay so", "to be fair"],
}


def test_prompt_advertises_the_voice_key():
    assert '"voice"' in ca._SYSTEM, "the authoring prompt must ask for the idiolect fingerprint"
    for dial in ("register", "rhythm", "stressTell", "signature", "lexicon"):
        assert dial in ca._SYSTEM


def test_parse_forwards_a_complete_voice_whole():
    reply = json.dumps({"voice": _VOICE, "weakness": "cannot leave a slight unanswered"})
    out = ca.parse_authored_profile(reply, "npc:1")
    assert out is not None and out["voice"] == _VOICE


def test_parse_caps_the_lexicon():
    voice = dict(_VOICE, lexicon=["a", "b", "c", "d", "e"])
    out = ca.parse_authored_profile(json.dumps({"voice": voice}), "npc:1")
    assert out is not None and out["voice"]["lexicon"] == ["a", "b", "c"]


def test_parse_drops_a_partial_voice_whole():
    """Voice is identity — forwarded whole or not at all (the seeded floor then stands)."""
    partial = {k: v for k, v in _VOICE.items() if k not in ("stressTell",)}
    out = ca.parse_authored_profile(
        json.dumps({"voice": partial, "weakness": "cannot leave a slight unanswered"}), "npc:1")
    assert out is not None and "voice" not in out
    # a voice-only profile whose voice is dropped leaves nothing to write ⇒ parse returns None
    out2 = ca.parse_authored_profile(json.dumps({"voice": dict(_VOICE, lexicon=[])}), "npc:1")
    assert out2 is None or "voice" not in out2
    out3 = ca.parse_authored_profile(json.dumps({"voice": "talks fast"}), "npc:1")
    assert out3 is None or "voice" not in out3


def test_voice_is_a_public_forwarded_key():
    assert "voice" in ca._PUBLIC_KEYS


def test_skeleton_brief_carries_the_seeded_voice():
    """The engine's seeded voice-fingerprint clause rides the skeleton so the model authors FROM
    the engine's seed brief (sharpen, don't invent unmoored)."""
    msgs = ca.build_authoring_messages({
        "id": "npc:1", "name": "Probe Person", "archetype": "underdog",
        "voice": "talks in a folksy, rambling, candid voice",
    })
    user_msg = msgs[1]["content"]
    assert "talks in a folksy, rambling, candid voice" in user_msg


def test_name_stays_guarded_engine_side():
    """Ruling #1: the seeded NAME draw stays engine-side — the FE forwards a replacement display
    name ONLY through the reasonableness guard (gibberish is dropped, the corpus name stands)."""
    out = ca.parse_authored_profile(
        json.dumps({"name": "Nerighrengeinen Herneingenenin",
                    "weakness": "cannot leave a slight unanswered"}), "npc:1")
    assert out is not None and "name" not in out
