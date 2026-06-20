"""Feature 0065 — cast pre-warm orchestration (FE side).

The hard invariant: a FULLY WARMED AUTHORSHIP before any portrait is ever generated. Author warm runs
the deep authoring in the background as early as possible; portrait warm is held and WAITS for author
warm to finish before it shoots a single face. Deps are injected, so the whole gate is testable with no
live model, engine, or image provider.
"""
import asyncio

from src import orwell_prewarm as P


def _run(coro):
    # FE convention: drive on the existing session loop (never asyncio.run, which closes the loop).
    return asyncio.get_event_loop().run_until_complete(coro)


def _drive():
    # Let the loop process the background task(s) created by warm_portraits / kickoff_authoring.
    _run(asyncio.sleep(0))


class _FakeEngine:
    def __init__(self, res):
        self.res = res
        self.calls = 0

    async def pre_seed_cast(self, user=None):
        self.calls += 1
        return self.res


class _FakeAuthoring:
    """Captures the kickoff and the gate-release callback; releases on `finish()` (or immediately)."""
    def __init__(self, auto_finish=True):
        self.cast = None
        self.calls = 0
        self._then = None
        self._auto = auto_finish

    def kickoff_authoring(self, cast, user, then=None):
        self.cast = cast
        self.calls += 1
        self._then = then
        if self._auto and then:
            then()

    def finish(self):
        if self._then:
            self._then()


class _FakePortraits:
    def __init__(self):
        self.prompts = None
        self.calls = 0

    def kickoff_generation(self, prompts, user):
        self.prompts = prompts
        self.calls += 1


_WARM_RES = {
    "warmed": True, "seed": 5,
    "house": [{"id": "npc:1", "name": "A", "biography": "A deep bio. Two sentences."}],
    "portraitPrompts": [{"houseguestId": "npc:1", "name": "A", "prompt": "a portrait"}],
}


def setup_function(_):
    P.reset()  # isolate per-user warm state across tests


# ── author warm ────────────────────────────────────────────────────────────────

def test_prewarm_cast_pre_seeds_then_authors_in_background():
    eng, auth = _FakeEngine(_WARM_RES), _FakeAuthoring()
    res = _run(P.prewarm_cast("u1", engine=eng, authoring=auth))
    assert res["warmed"] is True
    assert eng.calls == 1
    assert auth.calls == 1
    assert auth.cast == _WARM_RES["house"]
    st = P.warm_state("u1")
    assert st["authorStarted"] is True and st["authorDone"] is True and st["promptCount"] == 1


def test_prewarm_cast_is_idempotent_within_a_season():
    eng, auth = _FakeEngine(_WARM_RES), _FakeAuthoring()
    _run(P.prewarm_cast("u1", engine=eng, authoring=auth))
    again = _run(P.prewarm_cast("u1", engine=eng, authoring=auth))
    assert again.get("alreadyWarmed") is True
    # The engine is polled each time (cheap, idempotent), but the SAME seed never re-authors.
    assert eng.calls == 2 and auth.calls == 1


def test_prewarm_cast_re_warms_a_fresh_cast_across_seasons():
    # A new season mints a new seed → a fresh author warm (self-resetting, no per-route plumbing).
    eng = _FakeEngine(dict(_WARM_RES, seed=5))
    auth = _FakeAuthoring()
    _run(P.prewarm_cast("u1", engine=eng, authoring=auth))
    assert auth.calls == 1
    eng.res = dict(_WARM_RES, seed=99)  # season 2's cast
    res2 = _run(P.prewarm_cast("u1", engine=eng, authoring=auth))
    assert res2.get("alreadyWarmed") is not True
    assert auth.calls == 2  # the new cast was authored afresh
    assert P.warm_state("u1")["authorDone"] is True


def test_prewarm_cast_declines_when_a_season_is_running():
    eng, auth = _FakeEngine({"warmed": False, "refused": "in-progress"}), _FakeAuthoring()
    res = _run(P.prewarm_cast("u1", engine=eng, authoring=auth))
    assert res["warmed"] is False
    assert auth.calls == 0
    assert P.warm_state("u1")["authorStarted"] is False


# ── portrait warm — gated on author warm ─────────────────────────────────────────

def test_warm_portraits_declines_when_no_author_warm_ran():
    # No prewarm_cast first → nothing to gate on → decline (createCharacter's fallback owns portraits).
    port = _FakePortraits()
    res = _run(P.warm_portraits("u1", portraits=port))
    assert res["started"] is False
    assert port.calls == 0


def test_warm_portraits_shoots_after_author_warm_finished():
    eng, auth, port = _FakeEngine(_WARM_RES), _FakeAuthoring(auto_finish=True), _FakePortraits()
    _run(P.prewarm_cast("u1", engine=eng, authoring=auth))  # author warm already done (auto_finish)
    res = _run(P.warm_portraits("u1", portraits=port))
    assert res["started"] is True
    _drive()  # let the gated background task run
    assert port.calls == 1
    assert port.prompts == _WARM_RES["portraitPrompts"]


def test_portraits_NEVER_shoot_before_authoring_completes():
    """The load-bearing invariant: hold portraits until authorship is 100% complete."""
    eng = _FakeEngine(_WARM_RES)
    auth = _FakeAuthoring(auto_finish=False)  # authoring is in-flight; the gate stays closed
    port = _FakePortraits()
    _run(P.prewarm_cast("u1", engine=eng, authoring=auth))
    _run(P.warm_portraits("u1", portraits=port))
    _drive()  # the portrait task starts and AWAITS the gate
    assert port.calls == 0, "a portrait was shot before authoring finished"
    assert P.warm_state("u1")["authorDone"] is False

    auth.finish()  # authoring completes → the gate opens
    _drive()
    assert port.calls == 1, "the portrait did not shoot once authoring finished"


def test_warm_portraits_is_idempotent():
    eng, auth, port = _FakeEngine(_WARM_RES), _FakeAuthoring(), _FakePortraits()
    _run(P.prewarm_cast("u1", engine=eng, authoring=auth))
    _run(P.warm_portraits("u1", portraits=port))
    again = _run(P.warm_portraits("u1", portraits=port))
    assert again.get("alreadyStarted") is True
    _drive()
    assert port.calls == 1  # a single generation pass, not two


def test_reset_clears_state_for_a_fresh_oobe():
    eng, auth = _FakeEngine(_WARM_RES), _FakeAuthoring()
    _run(P.prewarm_cast("u1", engine=eng, authoring=auth))
    assert P.warm_state("u1")["authorStarted"] is True
    P.reset("u1")
    assert P.warm_state("u1")["authorStarted"] is False
