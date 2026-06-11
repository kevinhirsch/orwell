"""Lane G9 — 0051 portraits: backfill for existing seasons + retry lever + attempt log.

Root cause closed here: portrait generation originally kicked off ONLY from the
createCharacter response, so any season created before 0051 merged showed placeholders
forever — even after an image provider was configured. The backfill fetches each missing
houseguest's Vault-free prompt via the engine's live `getPortraitPrompt` player-channel
tool (no engine change) and reuses the standard generate+persist pipeline.

Name-agnostic (roles only); the engine client and the image provider are monkeypatched.
Covers:
  • missing-set detection (active houseguests without a stored portrait)
  • backfill_missing: prompt fetch -> generate -> persist; fetch failures logged + skipped
  • the per-user per-process debounce (roster polls / button mashes never hammer a provider)
  • the roster route kicks the backfill (and does NOT when unavailable / nothing missing)
  • POST /api/orwell/portraits/backfill — {kicked, missing, available}, player-reachable
  • the capped JSONL attempt ring (~100) + generate_and_store writing attempt outcomes
  • GET /api/orwell/portraits/log — admin-gated (require_admin contract)
"""

import asyncio
import importlib
import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

orwell_portraits = importlib.import_module("src.orwell_portraits")
orwell_engine = importlib.import_module("src.orwell_engine")
orwell_routes = importlib.import_module("routes.orwell_routes")


def _run(coro):
    # Same loop discipline as test_orwell_portraits.py: reuse the thread's loop rather than
    # asyncio.run (which would close it out from under the sibling test files).
    return asyncio.get_event_loop().run_until_complete(coro)


def _kick(ids, user):
    """Drive kickoff_backfill from INSIDE a running loop (the production posture: an async
    FastAPI route), then yield so the scheduled background task completes."""
    async def _inner():
        res = orwell_portraits.kickoff_backfill(ids, user)
        await asyncio.sleep(0)
        return res
    return _run(_inner())


@pytest.fixture
def tmp_portraits(tmp_path, monkeypatch):
    """Throwaway portrait tree + attempt log + a clean debounce table per test."""
    d = tmp_path / "portraits"
    monkeypatch.setattr(orwell_portraits, "PORTRAITS_DIR", d)
    monkeypatch.setattr(orwell_portraits, "PORTRAIT_LOG_PATH", tmp_path / "portrait-log.jsonl")
    monkeypatch.setattr(orwell_portraits, "_LAST_BACKFILL_AT", {})
    return d


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(orwell_routes.setup_orwell_routes())
    return TestClient(app, raise_server_exceptions=False)


_STATE = {
    "started": True,
    "player": {"id": "player", "name": "The Player", "status": "active"},
    "house": [
        {"id": "npc:1", "name": "Houseguest One", "status": "active"},
        {"id": "npc:2", "name": "Houseguest Two", "status": "jury"},
        {"id": "npc:3", "name": "Houseguest Three", "status": "active"},
    ],
}


def _stub_state(monkeypatch, state=_STATE):
    async def fake_state(user=None, **k):
        return state
    monkeypatch.setattr(orwell_engine, "get_game_state", fake_state)


def _stub_provider(monkeypatch, available=True):
    monkeypatch.setattr(orwell_portraits, "image_generation_available", lambda user: available)


def _store_portrait(user, hid):
    orwell_portraits._write_portrait(user, hid, b"\x89PNG-fake", "stored")


# --- missing-set detection ----------------------------------------------------------------

def test_missing_ids_are_active_houseguests_without_a_stored_portrait(tmp_portraits):
    _store_portrait("alice", "npc:1")
    cards = [
        {"id": "player", "status": "active"},   # missing
        {"id": "npc:1", "status": "active"},    # stored
        {"id": "npc:2", "status": "jury"},      # departed — never backfilled
        {"id": "npc:3", "status": "evicted"},   # departed — never backfilled
        {"id": "npc:4", "status": "active"},    # missing
    ]
    assert orwell_portraits.missing_portrait_ids("alice", cards) == ["player", "npc:4"]


# --- backfill_missing: engine prompt fetch -> the standard pipeline ------------------------

def test_backfill_fetches_prompts_and_persists_portraits(tmp_portraits, monkeypatch):
    _stub_provider(monkeypatch, True)

    fetched = []

    async def fake_prompt(hid, user=None):
        fetched.append((hid, user))
        return {"houseguestId": hid, "name": f"HG {hid}", "prompt": f"photoreal {hid}"}
    monkeypatch.setattr(orwell_engine, "get_portrait_prompt", fake_prompt)

    async def fake_gen(prompt, user):
        return b"\x89PNG-" + prompt.encode()[:8]
    monkeypatch.setattr(orwell_portraits, "_generate_one", fake_gen)

    async def fake_beat(hid, ref, user=None):
        return {"ok": True}
    monkeypatch.setattr(orwell_engine, "record_image_beat", fake_beat)

    summary = _run(orwell_portraits.backfill_missing(["player", "npc:1"], "bob"))

    assert summary["generated"] == 2
    assert [f[0] for f in fetched] == ["player", "npc:1"]
    assert all(f[1] == "bob" for f in fetched)
    assert (tmp_portraits / "bob" / "player.png").exists()
    assert (tmp_portraits / "bob" / "npc_1.png").exists()


def test_backfill_prompt_fetch_failure_is_logged_and_skipped(tmp_portraits, monkeypatch):
    _stub_provider(monkeypatch, True)

    async def fake_prompt(hid, user=None):
        if hid == "npc:1":
            raise RuntimeError("engine hiccup")
        return {"houseguestId": hid, "name": "HG", "prompt": "photoreal"}
    monkeypatch.setattr(orwell_engine, "get_portrait_prompt", fake_prompt)

    async def fake_gen(prompt, user):
        return b"PNG"
    monkeypatch.setattr(orwell_portraits, "_generate_one", fake_gen)

    async def fake_beat(hid, ref, user=None):
        return {"ok": True}
    monkeypatch.setattr(orwell_engine, "record_image_beat", fake_beat)

    summary = _run(orwell_portraits.backfill_missing(["npc:1", "npc:2"], "carol"))

    assert summary["generated"] == 1  # the healthy one still landed
    log = orwell_portraits.read_attempt_log()
    failed = [e for e in log if not e["ok"]]
    assert any(e["houseguestId"] == "npc:1" and e["errorClass"] == "prompt-fetch-failed"
               for e in failed)


# --- the debounce: one attempt per user per process per window -----------------------------

def test_kickoff_backfill_debounces_per_user(tmp_portraits, monkeypatch):
    runs = []

    async def fake_backfill(ids, user):
        runs.append((tuple(ids), user))
        return {"generated": 0, "skipped": 0, "total": 0}
    monkeypatch.setattr(orwell_portraits, "backfill_missing", fake_backfill)

    assert _kick(["npc:1"], "dave") is True
    assert _kick(["npc:1"], "dave") is False  # inside the window
    assert _kick(["npc:1"], "erin") is True   # other user unaffected
    assert len(runs) == 2

    # Window elapsed -> allowed again.
    orwell_portraits._LAST_BACKFILL_AT["dave"] -= orwell_portraits.BACKFILL_DEBOUNCE_S + 1
    assert _kick(["npc:1"], "dave") is True
    assert len(runs) == 3


def test_kickoff_backfill_noops_on_empty_missing_set(tmp_portraits, monkeypatch):
    async def boom(ids, user):
        raise AssertionError("must not run with nothing missing")
    monkeypatch.setattr(orwell_portraits, "backfill_missing", boom)
    assert _kick([], "fay") is False
    # An empty kick must NOT consume the debounce window.
    assert orwell_portraits.backfill_allowed("fay") is True


def test_scrub_user_resets_the_debounce(tmp_portraits, monkeypatch):
    async def fake_backfill(ids, user):
        return {}
    monkeypatch.setattr(orwell_portraits, "backfill_missing", fake_backfill)
    assert _kick(["npc:1"], "gail") is True
    assert orwell_portraits.backfill_allowed("gail") is False
    orwell_portraits.scrub_user("gail")  # a new season may backfill immediately
    assert orwell_portraits.backfill_allowed("gail") is True


# --- the roster route kicks the backfill ---------------------------------------------------

def test_roster_kicks_backfill_for_missing_active_portraits(tmp_portraits, client, monkeypatch):
    _stub_state(monkeypatch)
    _stub_provider(monkeypatch, True)
    _store_portrait("default", "npc:1")  # TestClient has no auth -> user resolves to None

    kicked = {}

    def fake_kick(missing, user):
        kicked["missing"] = list(missing)
        return True
    monkeypatch.setattr(orwell_portraits, "kickoff_backfill", fake_kick)

    body = client.get("/api/orwell/roster").json()
    assert body["imagesAvailable"] is True
    assert len(body["roster"]) == 4
    # The jury houseguest and the stored one are NOT in the missing set.
    assert kicked["missing"] == ["player", "npc:3"]


def test_roster_does_not_kick_when_provider_unavailable(tmp_portraits, client, monkeypatch):
    _stub_state(monkeypatch)
    _stub_provider(monkeypatch, False)

    def boom(missing, user):
        raise AssertionError("backfill must not kick with no provider")
    monkeypatch.setattr(orwell_portraits, "kickoff_backfill", boom)

    body = client.get("/api/orwell/roster").json()
    assert body["imagesAvailable"] is False
    assert len(body["roster"]) == 4  # the roster itself is unaffected


def test_roster_does_not_kick_when_nothing_is_missing(tmp_portraits, client, monkeypatch):
    _stub_state(monkeypatch)
    _stub_provider(monkeypatch, True)
    for hid in ("player", "npc:1", "npc:3"):  # every ACTIVE houseguest stored
        _store_portrait("default", hid)

    def boom(missing, user):
        raise AssertionError("backfill must not kick when complete")
    monkeypatch.setattr(orwell_portraits, "kickoff_backfill", boom)

    body = client.get("/api/orwell/roster").json()
    assert all(c["portrait"] for c in body["roster"] if c["status"] == "active")


def test_roster_response_never_blocks_on_a_backfill_failure(tmp_portraits, client, monkeypatch):
    _stub_state(monkeypatch)
    _stub_provider(monkeypatch, True)

    def boom(missing, user):
        raise RuntimeError("kick exploded")
    monkeypatch.setattr(orwell_portraits, "kickoff_backfill", boom)

    r = client.get("/api/orwell/roster")
    assert r.status_code == 200
    assert len(r.json()["roster"]) == 4  # fail-open: the roster still serves


# --- POST /api/orwell/portraits/backfill (the manual lever) --------------------------------

def test_backfill_route_returns_kicked_missing_available(tmp_portraits, client, monkeypatch):
    _stub_state(monkeypatch)
    _stub_provider(monkeypatch, True)
    _store_portrait("default", "npc:3")

    def fake_kick(missing, user):
        return True
    monkeypatch.setattr(orwell_portraits, "kickoff_backfill", fake_kick)

    body = client.post("/api/orwell/portraits/backfill").json()
    assert body == {"kicked": True, "missing": ["player", "npc:1"], "available": True}


def test_backfill_route_reports_debounced_attempt_honestly(tmp_portraits, client, monkeypatch):
    _stub_state(monkeypatch)
    _stub_provider(monkeypatch, True)
    monkeypatch.setattr(orwell_portraits, "kickoff_backfill", lambda missing, user: False)

    body = client.post("/api/orwell/portraits/backfill").json()
    assert body["kicked"] is False
    assert body["available"] is True
    assert body["missing"]  # still reports what's missing


def test_backfill_route_when_provider_unavailable(tmp_portraits, client, monkeypatch):
    _stub_state(monkeypatch)
    _stub_provider(monkeypatch, False)

    def boom(missing, user):
        raise AssertionError("must not kick with no provider")
    monkeypatch.setattr(orwell_portraits, "kickoff_backfill", boom)

    body = client.post("/api/orwell/portraits/backfill").json()
    assert body["kicked"] is False and body["available"] is False


def test_backfill_route_pre_game_and_engine_down_fail_open(tmp_portraits, client, monkeypatch):
    _stub_provider(monkeypatch, True)

    async def pre_game(user=None, **k):
        return {"started": False}
    monkeypatch.setattr(orwell_engine, "get_game_state", pre_game)
    body = client.post("/api/orwell/portraits/backfill").json()
    assert body == {"kicked": False, "missing": [], "available": True}

    async def down(user=None, **k):
        raise RuntimeError("engine unreachable")
    monkeypatch.setattr(orwell_engine, "get_game_state", down)
    r = client.post("/api/orwell/portraits/backfill")
    assert r.status_code == 200
    assert r.json()["kicked"] is False


def test_backfill_route_is_player_reachable(tmp_portraits, client, monkeypatch):
    """The lever is NOT admin-gated: the prompts it triggers are Vault-free player-channel
    reads (same exposure as the roster itself)."""
    monkeypatch.setenv("AUTH_ENABLED", "true")
    _stub_state(monkeypatch)
    _stub_provider(monkeypatch, True)
    monkeypatch.setattr(orwell_portraits, "kickoff_backfill", lambda missing, user: True)
    assert client.post("/api/orwell/portraits/backfill").status_code == 200


# --- the attempt log: capped ring + generate_and_store outcomes ----------------------------

def test_attempt_log_ring_caps_at_max_entries(tmp_portraits):
    for i in range(orwell_portraits.PORTRAIT_LOG_MAX_ENTRIES + 50):
        orwell_portraits.log_attempt(f"npc:{i}", ok=(i % 2 == 0),
                                     error_class="http-500", duration_ms=i)
    log = orwell_portraits.read_attempt_log()
    assert len(log) == orwell_portraits.PORTRAIT_LOG_MAX_ENTRIES
    # The ring keeps the NEWEST entries (oldest first in the read).
    assert log[-1]["houseguestId"] == f"npc:{orwell_portraits.PORTRAIT_LOG_MAX_ENTRIES + 49}"
    # The file itself is capped too (the on-disk ring, not just the read view).
    raw = orwell_portraits.PORTRAIT_LOG_PATH.read_text().splitlines()
    assert len([ln for ln in raw if ln.strip()]) == orwell_portraits.PORTRAIT_LOG_MAX_ENTRIES
    # Every line is well-formed JSON with the pinned shape.
    entry = json.loads(raw[0])
    assert set(entry.keys()) == {"ts", "houseguestId", "ok", "errorClass", "durationMs"}


def test_generate_and_store_logs_each_attempt_outcome(tmp_portraits, monkeypatch):
    _stub_provider(monkeypatch, True)

    async def flaky_gen(prompt, user):
        if "fail" in prompt:
            orwell_portraits._note_gen_error("http-503")
            return None
        return b"PNG"
    monkeypatch.setattr(orwell_portraits, "_generate_one", flaky_gen)

    prompts = [
        {"houseguestId": "npc:1", "name": "HG", "prompt": "photoreal ok"},
        {"houseguestId": "npc:2", "name": "HG", "prompt": "photoreal fail"},
    ]
    _run(orwell_portraits.generate_and_store(prompts, "hank", record_beats=False))

    log = orwell_portraits.read_attempt_log()
    by_id = {e["houseguestId"]: e for e in log}
    assert by_id["npc:1"]["ok"] is True and by_id["npc:1"]["errorClass"] is None
    assert by_id["npc:2"]["ok"] is False and by_id["npc:2"]["errorClass"] == "http-503"
    assert all(isinstance(e["durationMs"], int) and isinstance(e["ts"], (int, float)) for e in log)


def test_failure_with_no_noted_class_falls_back_to_generation_failed(tmp_portraits, monkeypatch):
    _stub_provider(monkeypatch, True)

    async def silent_fail(prompt, user):
        return None  # a monkeypatched/legacy failure path that noted no class
    monkeypatch.setattr(orwell_portraits, "_generate_one", silent_fail)

    _run(orwell_portraits.generate_and_store(
        [{"houseguestId": "npc:9", "name": "HG", "prompt": "p"}], "iris", record_beats=False))
    log = orwell_portraits.read_attempt_log()
    assert log[-1]["errorClass"] == "generation-failed"


# --- GET /api/orwell/portraits/log — admin-gated -------------------------------------------

def test_log_route_403_without_admin(tmp_portraits, client, monkeypatch):
    monkeypatch.setenv("AUTH_ENABLED", "true")
    orwell_portraits.log_attempt("npc:1", True, None, 10)
    assert client.get("/api/orwell/portraits/log").status_code == 403


def test_log_route_serves_the_ring_for_admin(tmp_portraits, client, monkeypatch):
    monkeypatch.setenv("AUTH_ENABLED", "false")  # require_admin's documented bypass
    orwell_portraits.log_attempt("npc:1", True, None, 10)
    orwell_portraits.log_attempt("npc:2", False, "http-500", 20)
    body = client.get("/api/orwell/portraits/log").json()
    assert [e["houseguestId"] for e in body["log"]] == ["npc:1", "npc:2"]
    assert body["log"][1]["errorClass"] == "http-500"


def test_log_route_source_keeps_the_gate():
    """Drift pin (mirrors the E70 pattern): the log route body calls require_admin first."""
    import os
    src_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                            "routes", "orwell_routes.py")
    with open(src_path, "r", encoding="utf-8") as f:
        src = f.read()
    body = src.split('@router.get("/portraits/log")')[1]
    assert "require_admin(request)" in body.split("read_attempt_log()")[0]
