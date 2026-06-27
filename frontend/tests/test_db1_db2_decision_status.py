"""DB1/DB2 (#1025) — /api/orwell/decision must NOT rewrite the engine's deliberate 400
client-validation error into a 502.

Root cause: a deliberate engine 400 ("a legal finale appeal is required", E31) was rewritten to a
hardcoded 502; 502 is in the engine client's `_TRANSIENT_STATUSES` ("retry me"), so a permanent
client error masqueraded as a transient gateway failure and invited a retry storm (the prod bundle
showed 60 refused POSTs in 5.5s). Fix: propagate the engine's REAL status (400 stays 400); reserve
502 for genuine unreachability; debounce a rapidly-repeated IDENTICAL failing decision.
"""

import importlib

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

orwell_engine = importlib.import_module("src.orwell_engine")
orwell_routes = importlib.import_module("routes.orwell_routes")


@pytest.fixture(autouse=True)
def _reset_debounce():
    # Each test starts with a clean debounce table (process-local module state). Guarded so the
    # status-propagation tests (which don't need the table) still FAIL meaningfully on pre-fix code
    # rather than erroring on a missing attribute.
    table = getattr(orwell_routes, "_LAST_DECISION_FAIL", None)
    if table is not None:
        table.clear()
    yield
    if table is not None:
        table.clear()


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(orwell_routes.setup_orwell_routes())
    return TestClient(app)


def test_validation_400_propagates_not_502(client, monkeypatch):
    """The engine's DELIBERATE 400 (a missing required field) must reach the client AS a 400 —
    never the 502 that signals "retry me"."""
    async def refuse(decision, user=None):
        raise orwell_engine.EngineToolError("a legal finale appeal is required", status=400)

    monkeypatch.setattr(orwell_engine, "submit_decision", refuse)
    r = client.post("/api/orwell/decision", json={"kind": "finale-answer"})
    assert r.status_code == 400, r.status_code
    assert "finale appeal" in r.json()["error"]
    # 400 is NOT a transient status — a compliant client will not auto-retry it.
    assert 400 not in orwell_engine._TRANSIENT_STATUSES


def test_engine_409_propagates(client, monkeypatch):
    """A structured engine 409 (e.g. a stale-beat or refused commit) propagates as 409, not 502."""
    async def refuse(decision, user=None):
        raise orwell_engine.EngineToolError("stale beat", status=409, code="stale-beat")

    monkeypatch.setattr(orwell_engine, "submit_decision", refuse)
    r = client.post("/api/orwell/decision", json={"kind": "eviction-vote", "vote": "npc:1"})
    assert r.status_code == 409, r.status_code


def test_502_reserved_for_unreachability(client, monkeypatch):
    """A genuine transport outage (no structured engine answer) is the ONLY 502 case."""
    async def boom(decision, user=None):
        raise RuntimeError("connection refused")

    monkeypatch.setattr(orwell_engine, "submit_decision", boom)
    r = client.post("/api/orwell/decision", json={"kind": "eviction-vote", "vote": "npc:1"})
    assert r.status_code == 502, r.status_code
    assert "engine unreachable" in r.json()["error"]


def test_engine_error_without_status_falls_back_to_502(client, monkeypatch):
    """An engine answer with no usable status is unclassifiable — fall back to 502 so it still reads
    as a problem (never a silent 200)."""
    async def refuse(decision, user=None):
        raise orwell_engine.EngineToolError("odd engine answer")  # status=None

    monkeypatch.setattr(orwell_engine, "submit_decision", refuse)
    r = client.post("/api/orwell/decision", json={"kind": "eviction-vote", "vote": "npc:1"})
    assert r.status_code == 502, r.status_code


def test_no_game_still_409(client, monkeypatch):
    """The benign pre/post-game "no active game" refusal stays a clean 409 (unchanged)."""
    async def refuse(decision, user=None):
        raise orwell_engine.EngineToolError("no active game", status=400)

    monkeypatch.setattr(orwell_engine, "submit_decision", refuse)
    r = client.post("/api/orwell/decision", json={"kind": "eviction-vote", "vote": "npc:1"})
    assert r.status_code == 409, r.status_code
    assert r.json()["started"] is False


def test_debounce_suppresses_identical_repeat(client, monkeypatch):
    """A buggy client firing the SAME failing decision repeatedly hits the engine ONCE; the rest are
    replayed from the cached refusal — same status, never re-hitting the engine."""
    calls = {"n": 0}

    async def refuse(decision, user=None):
        calls["n"] += 1
        raise orwell_engine.EngineToolError("a legal finale appeal is required", status=400)

    monkeypatch.setattr(orwell_engine, "submit_decision", refuse)
    payload = {"kind": "finale-answer"}
    statuses = []
    for _ in range(10):
        r = client.post("/api/orwell/decision", json=payload)
        statuses.append(r.status_code)

    # Every response is the SAME 400 the engine gave the first time...
    assert statuses == [400] * 10, statuses
    # ...but the engine was hit exactly once — the storm never reached it.
    assert calls["n"] == 1, calls["n"]
    # The replayed responses are flagged debounced (the first is the real engine answer).
    last = client.post("/api/orwell/decision", json=payload)
    assert last.json().get("debounced") is True


def test_debounce_does_not_suppress_a_different_decision(client, monkeypatch):
    """An EDITED payload (the player corrected the field) is judged fresh and reaches the engine —
    the debounce keys on the exact decision, never a whole-route lockout."""
    seen = []

    async def handler(decision, user=None):
        seen.append(dict(decision))
        if "appeal" not in decision:
            raise orwell_engine.EngineToolError("a legal finale appeal is required", status=400)
        return {"event": None, "pending": None}

    monkeypatch.setattr(orwell_engine, "submit_decision", handler)
    monkeypatch.setattr(orwell_engine, "clear_pending", lambda user=None: None)
    monkeypatch.setattr(orwell_engine, "remember_pending", lambda res, user=None: None)

    r1 = client.post("/api/orwell/decision", json={"kind": "finale-answer"})
    assert r1.status_code == 400
    # A DIFFERENT payload (now carrying the required appeal) is not suppressed — it reaches the engine.
    r2 = client.post("/api/orwell/decision", json={"kind": "finale-answer", "appeal": "mend"})
    assert r2.status_code == 200, r2.status_code
    assert len(seen) == 2 and seen[1].get("appeal") == "mend"


def test_success_clears_a_prior_failure_record(client, monkeypatch):
    """A successful submit retires the prior refusal, so a later identical-looking attempt is judged
    fresh (not suppressed against an outcome that no longer holds)."""
    state = {"fail": True, "calls": 0}

    async def handler(decision, user=None):
        state["calls"] += 1
        if state["fail"]:
            raise orwell_engine.EngineToolError("not yet", status=400)
        return {"event": None, "pending": None}

    monkeypatch.setattr(orwell_engine, "submit_decision", handler)
    monkeypatch.setattr(orwell_engine, "clear_pending", lambda user=None: None)
    monkeypatch.setattr(orwell_engine, "remember_pending", lambda res, user=None: None)

    payload = {"kind": "eviction-vote", "vote": "npc:1"}
    assert client.post("/api/orwell/decision", json=payload).status_code == 400
    # The window has not lapsed, so an immediate repeat is debounced (engine not re-hit).
    assert client.post("/api/orwell/decision", json=payload).status_code == 400
    calls_after_storm = state["calls"]
    assert calls_after_storm == 1

    # Now the engine would succeed; clear the record directly (simulating a window-lapse / edit path)
    # and prove a fresh attempt reaches the engine and a SUCCESS retires the record.
    orwell_routes._clear_decision_failure(None, payload)
    state["fail"] = False
    assert client.post("/api/orwell/decision", json=payload).status_code == 200
    assert state["calls"] == 2
    # After the success there is no lingering failure record to suppress the next attempt.
    assert client.post("/api/orwell/decision", json=payload).status_code == 200
    assert state["calls"] == 3
