"""S8 (RC8) — portrait/image-beat per-turn budget PRE-CHECK.

Name-agnostic (roles only). The engine METERS a re-generation of an already-portrayed houseguest
against a per-turn image budget (IMAGE_BUDGET.perTurnCap == 3) and REFUSES a recordImageBeat past
the cap with an EngineRefusal. Before S8 a re-shoot burst fired every beat blind, so the ones past
the cap all came back EngineRefusal (the RC8 bundle: 3 extra straight into the cap, twice → 6
refusals). `_record_image_beats` now consults the remaining per-turn budget and SKIPS a metered
beat it cannot fire — logging a RED-eligible 'image-budget-skip' (#1599) — instead of over-firing.

Gate:
  • 0 remaining budget  ⇒ NO recordImageBeat call is attempted (for a metered burst) + a skip logged.
  • 2 remaining budget  ⇒ at most 2 metered beats fire.
  • move-in (exempt) beats always fire regardless of budget — the engine exempts a first-image beat.
"""

import asyncio
import importlib

import pytest

orwell_portraits = importlib.import_module("src.orwell_portraits")
orwell_engine = importlib.import_module("src.orwell_engine")
log_rings = importlib.import_module("src.log_rings")


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


@pytest.fixture
def recorder(monkeypatch):
    """Capture every recordImageBeat the FE fires + every RED-eligible skip it records."""
    fired = []
    skips = []

    async def fake_record_image_beat(hid, ref, user=None):
        fired.append(str(hid))
        return {"eventId": f"evt:{hid}"}

    def fake_soft_failure(anomaly_class, exc, *, corrected=None, **ctx):
        skips.append({"class": str(anomaly_class), "corrected": corrected})

    monkeypatch.setattr(orwell_engine, "record_image_beat", fake_record_image_beat)
    monkeypatch.setattr(log_rings, "record_soft_failure", fake_soft_failure)
    # No inter-beat sleeps in the test.
    monkeypatch.setattr(orwell_portraits, "IMAGE_BEAT_SPACING_S", 0)
    return fired, skips


def _burst(n):
    return [(f"npc:{i}", f"/api/orwell/portrait/npc_{i}") for i in range(1, n + 1)]


def test_zero_budget_fires_nothing_and_logs_a_skip(recorder, monkeypatch):
    """0 remaining budget ⇒ a fully-metered burst attempts NO recordImageBeat + logs a skip each."""
    fired, skips = recorder
    monkeypatch.setattr(orwell_portraits, "_image_beat_budget_remaining", lambda user: 0)

    shown = _burst(3)
    metered = {orwell_portraits._safe_id(h) for h, _ in shown}
    _run(orwell_portraits._record_image_beats(shown, "u", metered_ids=metered))

    assert fired == []                     # not one metered beat fired into the exhausted budget
    assert len(skips) == 3                 # every skipped metered beat is a RED-eligible fault
    assert all(s["class"] == "portraits:image-budget-skip" for s in skips)
    assert all(s["corrected"] for s in skips)  # auto-corrected disposition (#1599 — still RED)


def test_two_remaining_fires_at_most_two(recorder, monkeypatch):
    """2 remaining budget ⇒ of 3 metered beats at most 2 fire; the overflow is skipped + logged."""
    fired, skips = recorder
    monkeypatch.setattr(orwell_portraits, "_image_beat_budget_remaining", lambda user: 2)

    shown = _burst(3)
    metered = {orwell_portraits._safe_id(h) for h, _ in shown}
    _run(orwell_portraits._record_image_beats(shown, "u", metered_ids=metered))

    assert len(fired) <= 2                 # never over-fires past the remaining budget
    assert len(fired) == 2                 # ...and uses the budget it has
    assert len(skips) == 1                 # the one overflow beat is a RED-eligible skip
    assert skips[0]["class"] == "portraits:image-budget-skip"


def test_exempt_move_in_beats_always_fire(recorder, monkeypatch):
    """Move-in (first-image) beats are engine-EXEMPT: they fire regardless of a spent budget and
    never consume it — so a fresh cast set is never blocked by the per-turn cap."""
    fired, skips = recorder
    monkeypatch.setattr(orwell_portraits, "_image_beat_budget_remaining", lambda user: 0)

    shown = _burst(5)
    # No metered ids ⇒ every beat is an exempt move-in first-shoot.
    _run(orwell_portraits._record_image_beats(shown, "u", metered_ids=set()))

    assert len(fired) == 5                 # all exempt beats fired
    assert skips == []                     # nothing budget-skipped


def test_mixed_burst_budgets_only_the_metered_beats(recorder, monkeypatch):
    """A burst of exempt move-in beats + metered re-shoots budgets ONLY the re-shoots: the move-in
    beats always land, and the metered overflow past the budget is skipped."""
    fired, skips = recorder
    monkeypatch.setattr(orwell_portraits, "_image_beat_budget_remaining", lambda user: 1)

    # 2 exempt move-in + 2 metered re-shoots, budget of 1 for the metered set.
    shown = [("npc:1", "r1"), ("npc:2", "r2"), ("npc:3", "r3"), ("npc:4", "r4")]
    metered = {orwell_portraits._safe_id("npc:3"), orwell_portraits._safe_id("npc:4")}
    _run(orwell_portraits._record_image_beats(shown, "u", metered_ids=metered))

    # Both move-in beats fire; exactly one of the two metered re-shoots fits the budget.
    assert "npc:1" in fired and "npc:2" in fired
    metered_fired = [h for h in fired if h in ("npc:3", "npc:4")]
    assert len(metered_fired) == 1
    assert len(skips) == 1
    assert skips[0]["class"] == "portraits:image-budget-skip"


def test_default_budget_is_the_engine_per_turn_cap():
    """The default remaining budget mirrors the engine's IMAGE_BUDGET.perTurnCap (== 3) — the FE
    never invents its own cap; it only stops firing INTO the engine's."""
    assert orwell_portraits.IMAGE_BEAT_PER_TURN_CAP == 3
    assert orwell_portraits._image_beat_budget_remaining("u") == 3
