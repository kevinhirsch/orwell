"""Feature 0065 (advance-warm) — the two-phase pre-warm of the NEXT season, truly in advance.

Phase 1 (char-data warm) is triggered when the CURRENT season's FINALE DAY begins. The engine now
supports a REAL mid-season warm: `preSeedNextSeason` warms the NEXT season's cast off a NEW seed into a
per-user HOLDING STORE that survives the cutover rotation, WITHOUT touching the active season. The FE
deeply authors the held cast in the background (write-back routed through `pre_seed_next_season(profile=…)`
so it lands on the HOLDING store, never the live cast), releasing the same author-done gate Phase 2 reads.
Phase 2 (image warm) fires at the next-season CONFIRM and is gated off Phase 1 exactly as startup gates
portraits off cast authoring.

Deps are injected (engine + authoring), so the whole two-phase gate is testable with no live model,
engine, or image provider. Name-agnostic (roles only).
"""
import asyncio
import re

import importlib
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

from src import orwell_prewarm as P

_JS_DIR = Path(__file__).resolve().parents[1] / "static" / "js"
_FINALE_JS = (_JS_DIR / "orwellFinale.js").read_text(encoding="utf-8")
_NEW_SEASON_JS = (_JS_DIR / "orwellNewSeason.js").read_text(encoding="utf-8")


def _loop():
    return asyncio.get_event_loop()


def _drive(turns: int = 8):
    # Pump the loop so the armed background warm task runs to completion.
    for _ in range(turns):
        _loop().run_until_complete(asyncio.sleep(0))


class _FakeAuthoring:
    """Mirrors kickoff_authoring(cast, user, then, on_authored, write); auto-finishes the whole cast and
    routes each NPC's write-back through the supplied `write` sink (the next-season holding-store path)."""
    def __init__(self):
        self.calls = 0
        self.write = None
        self.written = []

    def kickoff_authoring(self, cast, user, then=None, on_authored=None, write=None, seed=None):
        self.calls += 1
        self.write = write
        for npc in (cast or []):
            hid = npc.get("id")
            if hid and hid != "player":
                if write is not None:
                    # Exercise the write sink so the test proves authoring lands on the holding store.
                    self.written.append(hid)
                if on_authored:
                    on_authored(hid)
        if then:
            then()


class _AdvanceWarmEngine:
    """A `pre_seed_next_season` that warms the NEXT season's cast directly (no refusal — the engine now
    warms mid-season into the holding store). A supplied `profile` records onto the held cast."""
    def __init__(self, warm_res):
        self.warm_res = warm_res
        self.warm_calls = 0
        self.profile_calls = []

    async def pre_seed_next_season(self, seed=None, profile=None, user=None):
        if profile is not None:
            self.profile_calls.append(profile)
            return {"warmed": True, "seed": self.warm_res["seed"],
                    "house": self.warm_res["house"], "portraitPrompts": self.warm_res["portraitPrompts"],
                    "authored": {"accepted": True, "publicFields": ["biography"], "hiddenFields": []}}
        self.warm_calls += 1
        return self.warm_res


_WARM_RES = {
    "warmed": True, "seed": 42,
    "house": [{"id": "npc:1", "name": "A", "biography": "A deep bio. Two sentences."}],
    "portraitPrompts": [{"houseguestId": "npc:1", "name": "A", "prompt": "a portrait"}],
}


def setup_function(_):
    P.reset(None)               # drop every per-season gate
    P.cancel_next_season(None)  # and any armed warm task


# ── Phase 1: the finale-day char-data warm (REAL mid-season warm into the holding store) ───────────────

def test_warm_next_season_warms_the_holding_store_and_authors_it():
    eng, auth = _AdvanceWarmEngine(_WARM_RES), _FakeAuthoring()
    res = _loop().run_until_complete(P.warm_next_season("u1", engine=eng, authoring=auth))
    assert res.get("warmed") is True
    # It warmed the next-season cast directly (no poll, no refusal loop) and kicked deep authoring.
    assert eng.warm_calls == 1
    assert auth.calls == 1
    st = P.warm_state("u1")
    assert st["authorStarted"] is True and st["authorDone"] is True
    # The authoring write-back was routed to the holding store (the next-season sink), not record_cast_profile.
    assert auth.write is not None


def test_warm_next_season_write_sink_routes_to_pre_seed_next_season_profile():
    eng, auth = _AdvanceWarmEngine(_WARM_RES), _FakeAuthoring()
    _loop().run_until_complete(P.warm_next_season("u1", engine=eng, authoring=auth))
    # Drive the write sink the FakeAuthoring captured: it must hit pre_seed_next_season(profile=…), never
    # the live record_cast_profile (which mid-season would author the running house — the wrong cast).
    sink = auth.write
    out = _loop().run_until_complete(sink({"houseguestId": "npc:1", "biography": "authored. two sentences."}))
    assert out.get("warmed") is True
    assert len(eng.profile_calls) == 1
    assert eng.profile_calls[0]["houseguestId"] == "npc:1"


def test_prewarm_next_season_arms_a_background_task():
    eng, auth = _AdvanceWarmEngine(_WARM_RES), _FakeAuthoring()
    res = P.prewarm_next_season("u1", engine=eng, authoring=auth)
    assert res == {"armed": True}
    assert P.next_season_armed("u1") is True
    _drive()
    # The background task ran the real warm + authoring; it self-deregisters once done.
    assert eng.warm_calls == 1
    assert auth.calls == 1
    assert P.warm_state("u1")["authorDone"] is True
    assert P.next_season_armed("u1") is False


def test_prewarm_next_season_is_idempotent_while_armed():
    # A warm that never completes (an authoring that never finishes) keeps the task armed; a second
    # finale-day call is a no-op.
    class _NeverDone:
        async def pre_seed_next_season(self, seed=None, profile=None, user=None):
            await asyncio.Event().wait()  # never returns

    class _Auth:
        def kickoff_authoring(self, *a, **k):
            pass

    first = P.prewarm_next_season("u1", engine=_NeverDone(), authoring=_Auth())
    again = P.prewarm_next_season("u1", engine=_NeverDone(), authoring=_Auth())
    assert first == {"armed": True}
    assert again.get("alreadyArmed") is True
    P.cancel_next_season("u1")  # clean up the never-completing task


def test_a_global_reset_cancels_an_armed_next_season_task():
    class _NeverDone:
        async def pre_seed_next_season(self, seed=None, profile=None, user=None):
            await asyncio.Event().wait()

    class _Auth:
        def kickoff_authoring(self, *a, **k):
            pass

    P.prewarm_next_season("u1", engine=_NeverDone(), authoring=_Auth())
    assert P.next_season_armed("u1") is True
    P.reset(None)  # a global wipe tears down the tasks too
    _drive()
    assert P.next_season_armed("u1") is False


def test_warm_next_season_is_fail_soft_when_the_engine_declines():
    # No active season to advance-warm from ⇒ the engine declines; the warm reports it, never raises.
    class _Refuses:
        async def pre_seed_next_season(self, seed=None, profile=None, user=None):
            return {"warmed": False, "refused": "no-active-season"}

    class _Auth:
        def __init__(self): self.calls = 0
        def kickoff_authoring(self, *a, **k): self.calls += 1

    auth = _Auth()
    res = _loop().run_until_complete(P.warm_next_season("u1", engine=_Refuses(), authoring=auth))
    assert res.get("warmed") is False
    assert res.get("refused") == "no-active-season"
    assert auth.calls == 0  # no cast ⇒ no authoring kicked
    assert P.warm_state("u1")["authorStarted"] is False


# ── Phase 2: the image warm gates off Phase 1 (no author warm ⇒ declines) ─────────────────────

def test_warm_portraits_shoots_after_the_next_season_char_data_warm_landed():
    # End-to-end Phase 1 → Phase 2: the finale-day warm warms + authors the holding store, THEN the
    # confirm-time portrait warm gates off it and shoots.
    eng, auth = _AdvanceWarmEngine(_WARM_RES), _FakeAuthoring()
    _loop().run_until_complete(P.warm_next_season("u1", engine=eng, authoring=auth))
    assert P.warm_state("u1")["authorDone"] is True

    class _Port:
        def __init__(self): self.calls = 0; self.shot_ids = []
        def kickoff_generation(self, prompts, user): self.calls += 1

        def kickoff_authored_reshoot(self, hid, user):
            # 2026-07-13: the per-NPC authored shoot hands over the ID — the pipeline fetches the
            # CURRENT (authored) prompt at shoot time, never the captured pre-warm snapshot.
            self.calls += 1
            self.shot_ids.append(hid)
            return True

    port = _Port()
    res = _loop().run_until_complete(P.warm_portraits("u1", portraits=port))
    assert res["started"] is True
    _drive()
    assert port.calls == 1
    assert port.shot_ids == [p["houseguestId"] for p in _WARM_RES["portraitPrompts"]]


def test_warm_portraits_declines_when_no_next_season_warm_ran():
    # No Phase-1 warm ⇒ authorStarted False → portrait warm declines (the route's own generation owns
    # the faces), exactly like startup declines before authoring runs.
    class _Port:
        def __init__(self): self.calls = 0
        def kickoff_generation(self, prompts, user): self.calls += 1

    port = _Port()
    res = _loop().run_until_complete(P.warm_portraits("u1", portraits=port))
    assert res["started"] is False
    assert port.calls == 0


# ── the route arms the warm ───────────────────────────────────────────────────────────────────

def test_prewarm_next_season_route_arms_the_warm(monkeypatch):
    orwell_routes = importlib.import_module("routes.orwell_routes")
    orwell_prewarm = importlib.import_module("src.orwell_prewarm")
    seen = []
    monkeypatch.setattr(orwell_prewarm, "prewarm_next_season",
                        lambda user=None: (seen.append(user) or {"armed": True}))

    app = FastAPI()
    app.include_router(orwell_routes.setup_orwell_routes())
    client = TestClient(app, raise_server_exceptions=False)
    r = client.post("/api/orwell/prewarm-next-season")
    assert r.status_code == 200
    assert r.json() == {"armed": True}
    assert len(seen) == 1  # the route routed through the orchestrator for THIS user


# ── the engine adapter exposes the mid-season warm tool ────────────────────────────────────────

def test_engine_adapter_has_pre_seed_next_season():
    orwell_engine = importlib.import_module("src.orwell_engine")
    assert hasattr(orwell_engine, "pre_seed_next_season")


# ── the FE triggers (source-pinned: the browser smoke can't easily reach a real finale) ────────

def test_finale_js_fires_phase1_when_the_finale_begins_staging():
    # Phase 1 trigger: the finale-day char-data warm POSTs prewarm-next-season, ONCE, gated on the
    # staging transition (a one-shot _nextSeasonWarmed flag), via a fire-and-forget POST.
    assert "/api/orwell/prewarm-next-season" in _FINALE_JS
    assert "_nextSeasonWarmed" in _FINALE_JS
    assert re.search(r"_staging\s*&&\s*!_nextSeasonWarmed", _FINALE_JS), \
        "Phase 1 must fire once, gated on the finale staging transition"


def test_new_season_js_fires_phase2_image_warm_at_confirm():
    # Phase 2 trigger: the next-season confirm success path POSTs warm-portraits (gated server-side
    # off Phase 1's char-data warm — declines until authoring ran).
    assert "/api/orwell/warm-portraits" in _NEW_SEASON_JS
    assert "_warmNextSeasonPortraits" in _NEW_SEASON_JS
    assert re.search(r"_warmNextSeasonPortraits\(\)", _NEW_SEASON_JS)


def test_phase2_image_warm_is_not_fired_before_confirm():
    # The image warm must NOT be POSTed at finale day — only at the explicit next-season confirm.
    assert "/api/orwell/warm-portraits" not in _FINALE_JS
