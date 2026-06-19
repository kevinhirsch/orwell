"""Lane G20 — the portrait reconciler: verify-and-retry until the cast set is complete.

The user commission closed here: "what happens if there's no image generation model
available at the time images are queued to generate? is there a sanity checker to make
sure that those files are present and retry until they all are?" — before G20 the answer
was "no": a no-model season skipped generation (logged only) and the G9 backfill fired
only when somebody viewed the roster. The reconciler is the autonomous half: a per-process
background sweep that, for every user seen by the roster/portrait routes, verifies the
ACTIVE cast's portrait set and retries the gap THROUGH the standard pipeline under a
per-houseguest budget (failed attempt n cools down ~2^n cycles, RECONCILE_MAX_ATTEMPTS
real failures stands it down), while provider ABSENCE idles without consuming the budget.

Name-agnostic (account ids are roles like "user-a"; houseguests are ids). The engine
client and the image provider are monkeypatched, like test_g9_portrait_backfill.py.
Covers the lane gates:
  • the reconciler fills the missing set (mocked engine + provider), multi-user sweep
  • absence idles WITHOUT consuming budget; absent→present resets all counters
  • exponential backoff between real failures; the cap stands the reconciler down and
    the manual lever still works afterwards
  • a success resets the houseguest's counter; the budget survives a process restart
  • transition-only logging (the A9 lesson: no line per idle cycle)
  • deliberate debounce coordination (the reconciler stamps the lazy-path window)
  • the health payload shape (images.portraits {total, present, missing}) + the roster
    route's portraitsPresent/portraitsTotal counter
  • the single-task guard — two starts never double-run
"""

import asyncio
import importlib
import logging

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

orwell_portraits = importlib.import_module("src.orwell_portraits")
orwell_engine = importlib.import_module("src.orwell_engine")
orwell_routes = importlib.import_module("routes.orwell_routes")
ahr = importlib.import_module("routes.admin_health_routes")


def _run(coro):
    # Same loop discipline as test_g9_portrait_backfill.py: reuse the thread's loop rather
    # than asyncio.run (which would close it out from under the sibling test files).
    return asyncio.get_event_loop().run_until_complete(coro)


@pytest.fixture
def tmp_portraits(tmp_path, monkeypatch):
    """Throwaway portrait tree + logs + sidecar + fresh reconciler state per test."""
    d = tmp_path / "portraits"
    monkeypatch.setattr(orwell_portraits, "PORTRAITS_DIR", d)
    monkeypatch.setattr(orwell_portraits, "PORTRAIT_LOG_PATH", tmp_path / "portrait-log.jsonl")
    monkeypatch.setattr(orwell_portraits, "RECONCILE_STATE_PATH", tmp_path / "portrait-reconcile.json")
    monkeypatch.setattr(orwell_portraits, "_LAST_BACKFILL_AT", {})
    monkeypatch.setattr(orwell_portraits, "_SEEN_USERS", {})
    monkeypatch.setattr(orwell_portraits, "_PROVIDER_SEEN", {})
    monkeypatch.setattr(orwell_portraits, "_LAST_MISSING", {})
    monkeypatch.setattr(orwell_portraits, "_RECONCILER_TASK", None)
    return d


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(orwell_routes.setup_orwell_routes())
    return TestClient(app, raise_server_exceptions=False)


@pytest.fixture
def health_client():
    app = FastAPI()
    app.include_router(ahr.setup_admin_health_routes())
    app.include_router(ahr.setup_admin_status_page())
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
_ACTIVE_IDS = ["player", "npc:1", "npc:3"]  # the active cast in _STATE


def _stub_state(monkeypatch, state=_STATE):
    async def fake_state(user=None, **k):
        return state
    monkeypatch.setattr(orwell_engine, "get_game_state", fake_state)


def _stub_provider(monkeypatch, available=True):
    """Static or flippable provider: pass a dict holder for dynamic tests."""
    holder = available if isinstance(available, dict) else {"available": available}
    monkeypatch.setattr(orwell_portraits, "image_generation_available",
                        lambda user: holder["available"])
    return holder


def _stub_engine_prompts(monkeypatch):
    async def fake_prompt(hid, user=None):
        return {"houseguestId": hid, "name": f"HG {hid}", "prompt": f"photoreal {hid}"}

    async def fake_beat(hid, ref, user=None):
        return {"ok": True}

    monkeypatch.setattr(orwell_engine, "get_portrait_prompt", fake_prompt)
    monkeypatch.setattr(orwell_engine, "record_image_beat", fake_beat)


class _Gen:
    """A controllable _generate_one: flip .ok, count real generation attempts."""

    def __init__(self, ok=True):
        self.ok = ok
        self.calls = []

    async def __call__(self, prompt, user, reference_png=None):
        self.calls.append((prompt, user))
        if not self.ok:
            orwell_portraits._note_gen_error("http-503")
            return None
        return b"\x89PNG-fake-" + prompt.encode()[:12]


def _stub_gen(monkeypatch, ok=True):
    gen = _Gen(ok=ok)
    monkeypatch.setattr(orwell_portraits, "_generate_one", gen)
    return gen


def _store_portrait(user, hid):
    orwell_portraits._write_portrait(user, hid, b"\x89PNG-fake", "stored")


def _counters(user):
    return orwell_portraits._user_counters(
        orwell_portraits._load_reconcile_state(), orwell_portraits._safe_user(user))


# --- gate 1: the reconciler fills the missing set (mocked engine + provider) ---------------

def test_reconciler_fills_the_missing_set(tmp_portraits, monkeypatch):
    _stub_state(monkeypatch)
    _stub_provider(monkeypatch, True)
    _stub_engine_prompts(monkeypatch)
    _stub_gen(monkeypatch, ok=True)

    orwell_portraits.note_user_seen("user-a")
    results = _run(orwell_portraits.reconcile_once())

    assert results["user-a"] == {"missing": 3, "attempted": 3}
    for hid in _ACTIVE_IDS:
        assert orwell_portraits.portrait_file("user-a", hid) is not None
    # The jury houseguest is departed — never late-generated.
    assert orwell_portraits.portrait_file("user-a", "npc:2") is None
    # Success leaves no budget counters behind.
    assert not _counters("user-a")


def test_reconciler_sweeps_every_seen_user_in_isolation(tmp_portraits, monkeypatch):
    _stub_state(monkeypatch)
    _stub_provider(monkeypatch, True)
    _stub_engine_prompts(monkeypatch)
    _stub_gen(monkeypatch, ok=True)

    orwell_portraits.note_user_seen("user-a")
    orwell_portraits.note_user_seen("user-b")
    results = _run(orwell_portraits.reconcile_once())

    assert set(results) == {"user-a", "user-b"}
    assert (tmp_portraits / "user-a" / "player.png").exists()
    assert (tmp_portraits / "user-b" / "player.png").exists()


def test_reconciler_idles_pre_game_and_when_engine_down(tmp_portraits, monkeypatch):
    _stub_provider(monkeypatch, True)
    gen = _stub_gen(monkeypatch, ok=True)
    orwell_portraits.note_user_seen("user-a")

    async def pre_game(user=None, **k):
        return {"started": False}
    monkeypatch.setattr(orwell_engine, "get_game_state", pre_game)
    assert _run(orwell_portraits.reconcile_once())["user-a"] is None

    async def down(user=None, **k):
        raise RuntimeError("engine unreachable")
    monkeypatch.setattr(orwell_engine, "get_game_state", down)
    assert _run(orwell_portraits.reconcile_once())["user-a"] is None  # fail-open: idle
    assert gen.calls == []


# --- gate 2: provider absence idles WITHOUT consuming budget --------------------------------

def test_absence_idles_without_consuming_budget(tmp_portraits, monkeypatch):
    _stub_state(monkeypatch)
    holder = _stub_provider(monkeypatch, {"available": False})
    _stub_engine_prompts(monkeypatch)
    gen = _stub_gen(monkeypatch, ok=False)  # would fail IF it were ever tried

    orwell_portraits.note_user_seen("user-a")
    for _ in range(10):  # ten absence cycles
        _run(orwell_portraits.reconcile_once())
    assert gen.calls == []          # never even tried — absence is not an attempt
    assert not _counters("user-a")  # and the budget is untouched

    # The moment a provider appears, the FULL budget is available: the very first real
    # failure is attempt 1 of RECONCILE_MAX_ATTEMPTS.
    holder["available"] = True
    _run(orwell_portraits.reconcile_once())
    assert len(gen.calls) == 3  # one real attempt per missing active houseguest
    assert all(c["attempts"] == 1 for c in _counters("user-a").values())


def test_provider_appearing_after_absence_resets_all_counters(tmp_portraits, monkeypatch):
    _stub_state(monkeypatch)
    holder = _stub_provider(monkeypatch, {"available": True})
    _stub_engine_prompts(monkeypatch)
    gen = _stub_gen(monkeypatch, ok=False)
    _store_portrait("user-a", "player")
    _store_portrait("user-a", "npc:3")  # only npc:1 is missing — single-counter clarity

    orwell_portraits.note_user_seen("user-a")
    for _ in range(200):  # drive npc:1 to budget exhaustion
        _run(orwell_portraits.reconcile_once())
    assert len(gen.calls) == orwell_portraits.RECONCILE_MAX_ATTEMPTS
    _run(orwell_portraits.reconcile_once())
    assert len(gen.calls) == orwell_portraits.RECONCILE_MAX_ATTEMPTS  # stood down

    holder["available"] = False
    _run(orwell_portraits.reconcile_once())  # an observed absence cycle…
    holder["available"] = True
    _run(orwell_portraits.reconcile_once())  # …then (re)configured: a fresh budget
    assert len(gen.calls) == orwell_portraits.RECONCILE_MAX_ATTEMPTS + 1
    assert _counters("user-a")["npc_1"]["attempts"] == 1


# --- gate 3: exponential backoff; the cap stands it down; manual still works ----------------

def test_backoff_waits_exponentially_between_attempts(tmp_portraits, monkeypatch):
    _stub_state(monkeypatch)
    _stub_provider(monkeypatch, True)
    _stub_engine_prompts(monkeypatch)
    gen = _stub_gen(monkeypatch, ok=False)
    _store_portrait("user-a", "player")
    _store_portrait("user-a", "npc:3")  # only npc:1 missing

    orwell_portraits.note_user_seen("user-a")
    attempts_after_cycle = []
    for _ in range(9):
        _run(orwell_portraits.reconcile_once())
        attempts_after_cycle.append(len(gen.calls))
    # attempt 1 on cycle 1, then ~2^1 cycles of cooldown; attempt 2 on cycle 4, then ~2^2
    # cycles of cooldown; attempt 3 on cycle 9 — never a retry-per-cycle hammer.
    assert attempts_after_cycle == [1, 1, 1, 2, 2, 2, 2, 2, 3]


def test_budget_caps_then_the_manual_lever_still_works(tmp_portraits, monkeypatch):
    _stub_state(monkeypatch)
    _stub_provider(monkeypatch, True)
    _stub_engine_prompts(monkeypatch)
    gen = _stub_gen(monkeypatch, ok=False)
    _store_portrait("user-a", "player")
    _store_portrait("user-a", "npc:3")

    orwell_portraits.note_user_seen("user-a")
    for _ in range(200):
        _run(orwell_portraits.reconcile_once())
    assert len(gen.calls) == orwell_portraits.RECONCILE_MAX_ATTEMPTS  # capped at 6
    assert _counters("user-a")["npc_1"]["attempts"] == orwell_portraits.RECONCILE_MAX_ATTEMPTS
    for _ in range(20):  # well past every cooldown — the reconciler has stood down
        _run(orwell_portraits.reconcile_once())
    assert len(gen.calls) == orwell_portraits.RECONCILE_MAX_ATTEMPTS

    # The manual lever (G9) is NOT gated by the reconciler's budget: clear the shared
    # debounce stamp the reconciler wrote and the lazy/manual path still generates.
    gen.ok = True
    orwell_portraits._LAST_BACKFILL_AT.clear()
    assert orwell_portraits.backfill_allowed("user-a") is True
    summary = _run(orwell_portraits.backfill_missing(["npc:1"], "user-a"))
    assert summary["generated"] == 1
    assert orwell_portraits.portrait_file("user-a", "npc:1") is not None


# --- gate 4: a success resets the counter; the budget survives a restart --------------------

def test_success_resets_the_counter_and_transitions_are_logged(tmp_portraits, monkeypatch, caplog):
    _stub_state(monkeypatch)
    _stub_provider(monkeypatch, True)
    _stub_engine_prompts(monkeypatch)
    gen = _stub_gen(monkeypatch, ok=False)
    _store_portrait("user-a", "player")
    _store_portrait("user-a", "npc:3")

    orwell_portraits.note_user_seen("user-a")
    caplog.set_level(logging.INFO, logger="src.orwell_portraits")

    _run(orwell_portraits.reconcile_once())  # cycle 1: real failure → attempts=1
    assert _counters("user-a")["npc_1"]["attempts"] == 1
    assert any("verify-and-retry engaged" in r.getMessage() for r in caplog.records)

    gen.ok = True
    for _ in range(3):  # cooldown (2 cycles) then the retry that succeeds
        _run(orwell_portraits.reconcile_once())
    assert orwell_portraits.portrait_file("user-a", "npc:1") is not None
    assert not _counters("user-a")  # SUCCESS resets the houseguest's counter

    _run(orwell_portraits.reconcile_once())  # the next sweep observes completeness
    assert any("portrait set complete" in r.getMessage() for r in caplog.records)


def test_budget_persists_across_a_process_restart(tmp_portraits, monkeypatch):
    _stub_state(monkeypatch)
    _stub_provider(monkeypatch, True)
    _stub_engine_prompts(monkeypatch)
    gen = _stub_gen(monkeypatch, ok=False)
    _store_portrait("user-a", "player")
    _store_portrait("user-a", "npc:3")

    orwell_portraits.note_user_seen("user-a")
    _run(orwell_portraits.reconcile_once())
    assert len(gen.calls) == 1  # attempts=1, cooldown=2 persisted to the sidecar

    # "Restart": in-memory trackers vanish; the sidecar file remains. The next cycle must
    # honor the persisted cooldown (no fresh attempt) and an unknown→available provider
    # observation must NOT be mistaken for absent→available (no budget reset).
    monkeypatch.setattr(orwell_portraits, "_PROVIDER_SEEN", {})
    monkeypatch.setattr(orwell_portraits, "_LAST_MISSING", {})
    _run(orwell_portraits.reconcile_once())
    assert len(gen.calls) == 1  # still cooling down — the budget survived the restart
    assert _counters("user-a")["npc_1"]["attempts"] == 1


# --- A9: transition-only logging — idle cycles say nothing ---------------------------------

def test_idle_cycles_log_nothing(tmp_portraits, monkeypatch, caplog):
    _stub_state(monkeypatch)
    _stub_provider(monkeypatch, True)
    for hid in _ACTIVE_IDS:
        _store_portrait("user-a", hid)  # the set is complete

    orwell_portraits.note_user_seen("user-a")
    caplog.set_level(logging.INFO, logger="src.orwell_portraits")
    for _ in range(5):
        _run(orwell_portraits.reconcile_once())
    assert not caplog.records, "an idle reconcile cycle must not log (the A9 lesson)"


def test_absence_cycles_log_nothing(tmp_portraits, monkeypatch, caplog):
    _stub_state(monkeypatch)
    _stub_provider(monkeypatch, False)
    orwell_portraits.note_user_seen("user-a")
    caplog.set_level(logging.INFO, logger="src.orwell_portraits")
    for _ in range(5):
        _run(orwell_portraits.reconcile_once())
    assert not caplog.records


# --- debounce coordination: the reconciler stamps the lazy-path window ----------------------

def test_reconciler_attempt_stamps_the_lazy_debounce(tmp_portraits, monkeypatch):
    _stub_state(monkeypatch)
    _stub_provider(monkeypatch, True)
    _stub_engine_prompts(monkeypatch)
    _stub_gen(monkeypatch, ok=False)

    orwell_portraits.note_user_seen("user-a")
    assert orwell_portraits.backfill_allowed("user-a") is True
    _run(orwell_portraits.reconcile_once())  # a real attempt cycle
    # A roster poll moments later must not re-hammer the same failing provider.
    assert orwell_portraits.backfill_allowed("user-a") is False

    # A cooldown-only cycle (no attempt) leaves the lazy window alone.
    orwell_portraits._LAST_BACKFILL_AT.clear()
    _run(orwell_portraits.reconcile_once())  # npc set is cooling down — attempted: 0
    assert orwell_portraits.backfill_allowed("user-a") is True


# --- gate 5: completeness visibility — health payload + roster counter ----------------------

def _stub_health_tiers(monkeypatch):
    async def fake_detail():
        return {"ok": True, "engineUrl": "http://127.0.0.1:8765"}

    async def fake_raw():
        return {"ok": True, "uptimeSeconds": 1}, 5

    monkeypatch.setattr(orwell_engine, "engine_health_detail", fake_detail)
    monkeypatch.setattr(ahr, "_engine_raw_health", fake_raw)
    monkeypatch.setattr(ahr, "_store_stats", lambda: {"sessions": 1, "messages": 1})


def test_health_payload_carries_portrait_completeness(tmp_portraits, monkeypatch, health_client):
    monkeypatch.setenv("AUTH_ENABLED", "false")  # require_admin's documented bypass
    _stub_health_tiers(monkeypatch)
    _stub_state(monkeypatch)
    _stub_provider(monkeypatch, True)
    monkeypatch.setattr(orwell_portraits, "_image_settings",
                        lambda user: (True, "img-model", "medium"))
    _store_portrait("default", "npc:1")  # no auth → user resolves to None → "default"

    body = health_client.get("/api/admin/health").json()
    img = body["images"]
    assert img["available"] is True
    assert img["portraits"] == {"total": 3, "present": 1, "missing": 2}


def test_health_portraits_are_null_pre_game_and_engine_down(tmp_portraits, monkeypatch, health_client):
    monkeypatch.setenv("AUTH_ENABLED", "false")
    _stub_health_tiers(monkeypatch)
    _stub_provider(monkeypatch, True)
    monkeypatch.setattr(orwell_portraits, "_image_settings",
                        lambda user: (True, "img-model", "medium"))

    async def pre_game(user=None, **k):
        return {"started": False}
    monkeypatch.setattr(orwell_engine, "get_game_state", pre_game)
    body = health_client.get("/api/admin/health").json()
    assert body["images"]["portraits"] is None  # no active cast to count

    async def down(user=None, **k):
        raise RuntimeError("engine unreachable")
    monkeypatch.setattr(orwell_engine, "get_game_state", down)
    r = health_client.get("/api/admin/health")
    assert r.status_code == 200  # the health surface never 500s on an outage
    assert r.json()["images"]["portraits"] is None


def test_roster_route_reports_present_and_total(tmp_portraits, monkeypatch, client):
    _stub_state(monkeypatch)
    _stub_provider(monkeypatch, True)
    monkeypatch.setattr(orwell_portraits, "kickoff_backfill", lambda missing, user: True)
    _store_portrait("default", "npc:1")

    body = client.get("/api/orwell/roster").json()
    assert body["portraitsTotal"] == 3
    assert body["portraitsPresent"] == 1

    # The fail-open shapes are PINNED pre-G20 ({roster, imagesAvailable} only — see
    # test_orwell_portraits.py): no counter keys ride along, and the panel's typeof
    # guard falls back to its own roster-derived count. (L15 adds a last-good roster cache;
    # clearing it here pins the genuine "engine down, no prior cast" fail-open — the
    # stale-serving path has its own test in test_l15_l17_cast_generation.py.)
    orwell_routes._LAST_ROSTER.clear()

    async def down(user=None, **k):
        raise RuntimeError("engine unreachable")
    monkeypatch.setattr(orwell_engine, "get_game_state", down)
    body = client.get("/api/orwell/roster").json()
    assert body == {"roster": [], "imagesAvailable": False}


# --- gate 6: the single-task guard ----------------------------------------------------------

def test_single_task_guard_two_starts_dont_double_run(tmp_portraits):
    async def go():
        first = orwell_portraits.ensure_reconciler_started()
        task_after_first = orwell_portraits._RECONCILER_TASK
        second = orwell_portraits.ensure_reconciler_started()
        task_after_second = orwell_portraits._RECONCILER_TASK
        same = task_after_first is task_after_second
        task_after_second.cancel()
        try:
            await task_after_second
        except asyncio.CancelledError:
            pass
        return first, second, same

    first, second, same = _run(go())
    assert first is True      # the first start created the task
    assert second is False    # the second start no-ops
    assert same is True       # …and never swapped in a second task


def test_start_without_a_running_loop_is_a_safe_noop(tmp_portraits):
    assert orwell_portraits.ensure_reconciler_started() is False
    assert orwell_portraits._RECONCILER_TASK is None


# --- the seen-user registry: the per-user read helpers enroll users -------------------------

def test_read_helpers_enroll_users_for_the_sweep(tmp_portraits):
    orwell_portraits.missing_portrait_ids("user-a", [{"id": "x", "status": "active"}])
    orwell_portraits.portrait_ref("user-b", "x")
    orwell_portraits.portrait_file("user-c", "x")
    assert {"user-a", "user-b", "user-c"} <= set(orwell_portraits._SEEN_USERS)


def test_scrub_user_clears_the_budget_and_trackers(tmp_portraits, monkeypatch):
    _stub_state(monkeypatch)
    _stub_provider(monkeypatch, True)
    _stub_engine_prompts(monkeypatch)
    _stub_gen(monkeypatch, ok=False)
    orwell_portraits.note_user_seen("user-a")
    _run(orwell_portraits.reconcile_once())
    assert _counters("user-a")

    orwell_portraits.scrub_user("user-a")  # a new season = a new cast
    assert not _counters("user-a")
    assert "user-a" not in orwell_portraits._PROVIDER_SEEN
    assert "user-a" not in orwell_portraits._LAST_MISSING


# --- the wiring pins: startup hook + the visible rows ---------------------------------------

def _read(*parts):
    import os
    base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    with open(os.path.join(base, *parts), encoding="utf-8") as f:
        return f.read()


def test_app_startup_hook_starts_the_reconciler():
    assert "ensure_reconciler_started" in _read("app.py")


def test_cast_panel_actions_note_reports_the_remainder():
    js = _read("static", "js", "orwellCast.js")
    assert "portraitsTotal" in js and "portraitsPresent" in js
    assert "remaining…" in js  # "Generating N remaining…" on the actions row


def test_admin_card_and_status_page_render_the_portrait_counter():
    assert "img.portraits" in _read("static", "js", "admin.js")
    assert "img.portraits" in _read("routes", "admin_health_routes.py")  # the inline page row
