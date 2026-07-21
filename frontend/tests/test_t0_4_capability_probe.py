"""T0-4 (telemetry + probe arm) — the provider capability contract.

docs/audits/2026-07-21-campaign-report-and-exhaustive-backlog.md §T0-4. Covers:

  * ``src/capability_probe.py`` — the ~10-call probe (tool_choice honoring, json conformance,
    reasoning-channel separation), its tiering, and the per-endpoint CapabilityProfile
    persistence in the FE settings store.
  * ``routes/model_routes.py`` — the best-effort background kickoff at endpoint registration.
  * ``routes/admin_health_routes.py`` — the Vault-free ``capability`` section + the
    ``capability-red`` alarm on ``/api/admin/health`` (the ``/admin/status`` surface).

Every network call is mocked (``httpx.post``) — no real provider is ever reached.
"""

import importlib
import json as _json
import threading

import pytest

cap = importlib.import_module("src.capability_probe")
settings = importlib.import_module("src.settings")


class _FakeResponse:
    def __init__(self, status_code=200, json_data=None):
        self.status_code = status_code
        self._json = json_data if json_data is not None else {}

    @property
    def is_success(self):
        return 200 <= self.status_code < 300

    def json(self):
        return self._json


@pytest.fixture(autouse=True)
def _isolated_settings(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "SETTINGS_FILE", str(tmp_path / "settings.json"))
    settings._invalidate_caches()
    yield
    settings._invalidate_caches()


# ── _tool_choice_call ────────────────────────────────────────────────────────────────────────


def test_tool_choice_call_honored_when_the_named_tool_is_called(monkeypatch):
    def fake_post(*a, **k):
        return _FakeResponse(json_data={"choices": [{"message": {
            "tool_calls": [{"function": {"name": cap._PROBE_TOOL_NAME, "arguments": "{}"}}]}}]})
    monkeypatch.setattr(cap.httpx, "post", fake_post)
    assert cap._tool_choice_call("http://x", None, "m", "prompt", 5) is True


def test_tool_choice_call_ignored_when_it_answers_in_prose(monkeypatch):
    def fake_post(*a, **k):
        return _FakeResponse(json_data={"choices": [{"message": {"content": "sure, blue!"}}]})
    monkeypatch.setattr(cap.httpx, "post", fake_post)
    assert cap._tool_choice_call("http://x", None, "m", "prompt", 5) is False


def test_tool_choice_call_ignored_when_a_different_tool_is_called(monkeypatch):
    def fake_post(*a, **k):
        return _FakeResponse(json_data={"choices": [{"message": {
            "tool_calls": [{"function": {"name": "some_other_tool", "arguments": "{}"}}]}}]})
    monkeypatch.setattr(cap.httpx, "post", fake_post)
    assert cap._tool_choice_call("http://x", None, "m", "prompt", 5) is False


def test_tool_choice_call_returns_none_on_http_failure(monkeypatch):
    def fake_post(*a, **k):
        return _FakeResponse(status_code=500)
    monkeypatch.setattr(cap.httpx, "post", fake_post)
    assert cap._tool_choice_call("http://x", None, "m", "prompt", 5) is None


def test_tool_choice_call_returns_none_on_transport_exception(monkeypatch):
    def fake_post(*a, **k):
        raise RuntimeError("connection refused")
    monkeypatch.setattr(cap.httpx, "post", fake_post)
    assert cap._tool_choice_call("http://x", None, "m", "prompt", 5) is None


# ── _json_call ───────────────────────────────────────────────────────────────────────────────


def test_json_call_conformant_plain_object(monkeypatch):
    def fake_post(*a, **k):
        return _FakeResponse(json_data={"choices": [{"message": {
            "content": '{"result": "blue"}'}}]})
    monkeypatch.setattr(cap.httpx, "post", fake_post)
    assert cap._json_call("http://x", None, "m", "prompt", 5) is True


def test_json_call_recovers_a_markdown_fenced_object(monkeypatch):
    def fake_post(*a, **k):
        return _FakeResponse(json_data={"choices": [{"message": {
            "content": '```json\n{"result": "ok"}\n```'}}]})
    monkeypatch.setattr(cap.httpx, "post", fake_post)
    assert cap._json_call("http://x", None, "m", "prompt", 5) is True


def test_json_call_non_conformant_prose_reply(monkeypatch):
    def fake_post(*a, **k):
        return _FakeResponse(json_data={"choices": [{"message": {
            "content": "the result is blue"}}]})
    monkeypatch.setattr(cap.httpx, "post", fake_post)
    assert cap._json_call("http://x", None, "m", "prompt", 5) is False


def test_json_call_non_conformant_wrong_shape(monkeypatch):
    def fake_post(*a, **k):
        return _FakeResponse(json_data={"choices": [{"message": {
            "content": '{"answer": "blue"}'}}]})  # valid JSON, missing the "result" key
    monkeypatch.setattr(cap.httpx, "post", fake_post)
    assert cap._json_call("http://x", None, "m", "prompt", 5) is False


def test_json_call_returns_none_on_http_failure(monkeypatch):
    def fake_post(*a, **k):
        return _FakeResponse(status_code=429)
    monkeypatch.setattr(cap.httpx, "post", fake_post)
    assert cap._json_call("http://x", None, "m", "prompt", 5) is None


# ── _reasoning_call ──────────────────────────────────────────────────────────────────────────


def test_reasoning_call_separated_when_a_reasoning_field_is_present(monkeypatch):
    def fake_post(*a, **k):
        return _FakeResponse(json_data={"choices": [{"message": {
            "reasoning_content": "17*24 = 408", "content": "408"}}]})
    monkeypatch.setattr(cap.httpx, "post", fake_post)
    assert cap._reasoning_call("http://x", None, "m", "prompt", 5) == "separated"


def test_reasoning_call_inline_when_no_reasoning_field(monkeypatch):
    def fake_post(*a, **k):
        return _FakeResponse(json_data={"choices": [{"message": {
            "content": "Let me think... 17*24 is 408."}}]})
    monkeypatch.setattr(cap.httpx, "post", fake_post)
    assert cap._reasoning_call("http://x", None, "m", "prompt", 5) == "inline"


def test_reasoning_call_returns_none_on_http_failure(monkeypatch):
    def fake_post(*a, **k):
        return _FakeResponse(status_code=500)
    monkeypatch.setattr(cap.httpx, "post", fake_post)
    assert cap._reasoning_call("http://x", None, "m", "prompt", 5) is None


# ── _tier ────────────────────────────────────────────────────────────────────────────────────


def test_tier_thresholds():
    assert cap._tier(None) == "unknown"
    assert cap._tier(0.0) == "red"
    assert cap._tier(0.35) == "red"  # the playtest's 7/20 ratio
    assert cap._tier(0.49) == "red"
    assert cap._tier(0.5) == "yellow"
    assert cap._tier(0.89) == "yellow"
    assert cap._tier(0.9) == "green"
    assert cap._tier(1.0) == "green"


# ── run_capability_probe (orchestration) ────────────────────────────────────────────────────


def test_run_capability_probe_all_honored_is_green(monkeypatch):
    monkeypatch.setattr(cap, "_tool_choice_call", lambda *a, **k: True)
    monkeypatch.setattr(cap, "_json_call", lambda *a, **k: True)
    monkeypatch.setattr(cap, "_reasoning_call", lambda *a, **k: "separated")
    profile = cap.run_capability_probe("http://x", "key", "model-a")
    assert profile["overallTier"] == "green"
    assert profile["toolChoice"]["honoredRate"] == 1.0
    assert profile["toolChoice"]["calls"] == len(cap._TOOL_CHOICE_PROMPTS)
    assert profile["json"]["conformanceRate"] == 1.0
    assert profile["reasoning"]["separated"] is True
    assert profile["callsFailed"] == 0
    assert profile["model"] == "model-a"
    assert profile["version"] == cap.CAPABILITY_PROBE_VERSION


def test_run_capability_probe_matches_the_playtest_ratio_is_red(monkeypatch):
    # 7/20 honored overall ≈ 0.35 — model the SAME imbalance on the tool_choice dimension alone.
    seq = iter([True, False, False, False])
    monkeypatch.setattr(cap, "_tool_choice_call", lambda *a, **k: next(seq))
    monkeypatch.setattr(cap, "_json_call", lambda *a, **k: True)
    monkeypatch.setattr(cap, "_reasoning_call", lambda *a, **k: "inline")
    profile = cap.run_capability_probe("http://x", "key", "model-a")
    assert profile["toolChoice"]["honoredRate"] == 0.25
    assert profile["toolChoice"]["tier"] == "red"
    assert profile["overallTier"] == "red"  # red on ANY dimension ⇒ overall red
    assert profile["reasoning"]["separated"] is False


def test_run_capability_probe_a_totally_failed_endpoint_is_unknown_not_a_crash(monkeypatch):
    monkeypatch.setattr(cap, "_tool_choice_call", lambda *a, **k: None)
    monkeypatch.setattr(cap, "_json_call", lambda *a, **k: None)
    monkeypatch.setattr(cap, "_reasoning_call", lambda *a, **k: None)
    profile = cap.run_capability_probe("http://x", "key", "model-a")
    assert profile["overallTier"] == "unknown"
    assert profile["callsFailed"] == len(cap._TOOL_CHOICE_PROMPTS) + len(cap._JSON_PROMPTS) + len(cap._REASONING_PROMPTS)
    assert profile["toolChoice"]["honoredRate"] is None


# ── persistence (the FE settings store) ─────────────────────────────────────────────────────


def test_save_and_get_capability_profile_round_trips():
    profile = {"overallTier": "green", "model": "m"}
    cap.save_capability_profile("ep-1", profile)
    assert cap.get_capability_profile("ep-1") == profile
    assert cap.get_capability_profile("ep-nonexistent") is None


def test_get_all_capability_profiles_is_a_map_of_every_persisted_endpoint():
    cap.save_capability_profile("ep-1", {"overallTier": "green"})
    cap.save_capability_profile("ep-2", {"overallTier": "red"})
    profiles = cap.get_all_capability_profiles()
    assert profiles == {"ep-1": {"overallTier": "green"}, "ep-2": {"overallTier": "red"}}


def test_save_capability_profile_persists_to_disk(tmp_path):
    cap.save_capability_profile("ep-1", {"overallTier": "yellow"})
    saved = _json.loads((tmp_path / "settings.json").read_text())
    assert saved["capability_profiles"]["ep-1"]["overallTier"] == "yellow"


def test_capability_profile_functions_never_raise_when_settings_is_unwritable(monkeypatch):
    def boom(*a, **k):
        raise OSError("disk full")
    monkeypatch.setattr(settings, "save_settings", boom)
    cap.save_capability_profile("ep-1", {"overallTier": "green"})  # must not raise

    def boom_load(*a, **k):
        raise OSError("disk full")
    monkeypatch.setattr(settings, "get_setting", boom_load)
    assert cap.get_capability_profile("ep-1") is None
    assert cap.get_all_capability_profiles() == {}


# ── probe_endpoint_background (fire-and-forget kickoff) ─────────────────────────────────────


class _SyncThread:
    """A drop-in for threading.Thread that runs the target SYNCHRONOUSLY on .start() — makes the
    fire-and-forget probe deterministic to test without a real background thread / sleep-poll."""
    def __init__(self, target=None, daemon=None, name=None):
        self._target = target

    def start(self):
        if self._target:
            self._target()


def test_probe_endpoint_background_persists_a_green_profile_and_logs_no_red_event(monkeypatch):
    monkeypatch.setattr(cap.threading, "Thread", _SyncThread)
    monkeypatch.setattr(cap, "run_capability_probe",
                        lambda *a, **k: {"overallTier": "green", "model": "m"})
    calls = []
    monkeypatch.setattr("src.log_rings.record_soft_failure",
                        lambda *a, **k: calls.append((a, k)))
    cap.probe_endpoint_background("ep-9", "http://x", "key", "model-a")
    assert cap.get_capability_profile("ep-9") == {"overallTier": "green", "model": "m",
                                                   "endpointId": "ep-9"}
    assert calls == []  # no RED-eligible event for a clean green profile


def test_probe_endpoint_background_red_profile_emits_a_1599_health_event(monkeypatch):
    monkeypatch.setattr(cap.threading, "Thread", _SyncThread)
    monkeypatch.setattr(cap, "run_capability_probe",
                        lambda *a, **k: {"overallTier": "red", "model": "m",
                                         "toolChoice": {"tier": "red"}, "json": {"tier": "green"}})
    calls = []
    monkeypatch.setattr("src.log_rings.record_soft_failure",
                        lambda *a, **k: calls.append((a, k)))
    cap.probe_endpoint_background("ep-red", "http://x", "key", "model-a", user="alice")
    assert cap.get_capability_profile("ep-red")["overallTier"] == "red"
    assert len(calls) == 1
    (anomaly_class, detail), kwargs = calls[0]
    assert anomaly_class == "capability-probe:red-capability"
    assert "ep-red" in detail
    assert kwargs.get("user") == "alice"


def test_probe_endpoint_background_run_failure_emits_a_1599_health_event_and_never_raises(monkeypatch):
    monkeypatch.setattr(cap.threading, "Thread", _SyncThread)

    def boom(*a, **k):
        raise RuntimeError("provider unreachable")
    monkeypatch.setattr(cap, "run_capability_probe", boom)
    calls = []
    monkeypatch.setattr("src.log_rings.record_soft_failure",
                        lambda *a, **k: calls.append((a, k)))
    cap.probe_endpoint_background("ep-fail", "http://x", "key", "model-a")  # must not raise
    assert len(calls) == 1
    (anomaly_class, exc), kwargs = calls[0]
    assert anomaly_class == "capability-probe:run-failed"
    assert cap.get_capability_profile("ep-fail") is None  # nothing persisted on a failed run


def test_probe_endpoint_background_spawns_a_real_daemon_thread(monkeypatch):
    # Capture the Thread() call WITHOUT letting it actually run (no real network call, no
    # backgrounded probe outliving the test) — just prove the kickoff is a genuine daemon
    # thread (never blocks the caller, never survives as a non-daemon on process exit).
    captured = {}

    class _CapturingThread:
        def __init__(self, target=None, daemon=None, name=None):
            captured["target"] = target
            captured["daemon"] = daemon
            captured["name"] = name

        def start(self):
            captured["started"] = True  # deliberately never invoke target — no real I/O here

    monkeypatch.setattr(cap.threading, "Thread", _CapturingThread)
    cap.probe_endpoint_background("ep-real-thread", "http://x", "key", "model-a")
    assert captured["daemon"] is True
    assert captured["started"] is True
    assert "ep-real-thread" in (captured["name"] or "")
    assert callable(captured["target"])
