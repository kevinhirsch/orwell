"""Feature 0080 — the ACTIVE overseer: the reasoning tier as the primary actor, with the
deterministic guardrails demoted to the fail-soft floor.

This is the TEST lane for 0080. It realizes the .feature INVARIANTS at the unit grain against the
0080 contract added to ``src/overseer.py`` (the foundation lane), reusing the 0079 primitives
(``Signals``, ``Verdict``, ``LEVERS``, ``should_assess``, ``DeterministicOverseer``):

  * **3-state mode + default off + reversibility** — ``overseer_mode()`` resolves
    ``off``/``shadow``/``active`` (settings ``overseer_mode`` wins; the legacy ``overseer_enabled``
    toggle / ``ORWELL_OVERSEER`` env map to ``shadow``); flipping the setting flips the mode;
    default is ``off`` and ``overseer_enabled()`` tracks ``mode != 'off'``.
  * **TRIGGER-ONLY** (the core anti-sycophancy invariant, §7.1) — ``dispatch_lever`` only *invokes*
    the verdict's lever's caller-supplied callable; exactly that lever's spy fires, no other; the
    overseer authors NO outcome (the spy is the only side effect). Driven for every actionable lever.
  * **FAIL-SOFT FLOOR** (§7.3) — a raising action ⇒ ``applied=False`` (never propagates); a
    ``hold`` verdict, a lever with no provided action, and a ``None`` verdict ⇒ ``applied=False``.
  * **LIVE-ONLY shape** (§6 / ruling D4) — the active dispatch is only reachable in ``active`` mode
    (tested through the mode gate: in any non-``active`` mode the caller never dispatches).
  * **SOURCE-PIN** — ``src/agent_loop.py`` wires the active path (``overseer_mode()`` +
    ``dispatch_lever(``) additively, with the legacy ``_FORCED_ADVANCE_NUDGE`` / "advance nudge"
    guardrail kept as the fall-through floor.

Name-agnostic — ROLES only (player, NPC, HOH, nominee, admin), never names. The overseer's inputs
and verdicts are Vault-free BY CONSTRUCTION (0079 ``Signals``); no Vault content is ever constructed
here. Settings writes are isolated to a tmp file so the test never touches the real store.
"""

import pathlib

import pytest

from src.overseer import (
    LEVERS,
    OVERSEER_MODES,
    Signals,
    Verdict,
    dispatch_lever,
    overseer_enabled,
    overseer_mode,
    should_assess,
    DeterministicOverseer,
)


# ── settings isolation (copied from tests/test_0079_overseer_settings.py) ─────────

def _isolate_settings(monkeypatch, tmp_path):
    """Point the settings store at a tmp file and drop the TTL cache, so a mode write never
    touches the real settings.json and reads/writes are immediate."""
    from src import settings as _s
    monkeypatch.setattr(_s, "SETTINGS_FILE", str(tmp_path / "settings.json"))
    monkeypatch.setattr(_s, "_settings_cache", None)


# The actionable levers (everything that triggers a deterministic engine action). 'hold' is the
# deliberate no-op and is exercised separately in the fail-soft block.
_ACTIONABLE_LEVERS = ("nudge", "force-advance", "propose-record", "reinject-delta", "escalate")


def _verdict(lever: str) -> Verdict:
    """A hand-built Vault-free Verdict carrying just the lever under test (level/kind/diagnosis are
    inert tokens — dispatch only reads ``.lever``)."""
    return Verdict(level="action", kind="probe", diagnosis="probe verdict", lever=lever)


# ── the contract surface exists & is shaped as documented ─────────────────────────

def test_modes_tuple_is_the_three_states():
    assert OVERSEER_MODES == ("off", "shadow", "active")


def test_actionable_levers_are_a_subset_of_the_fixed_lever_set():
    # The fixed lever set is load-bearing (§7.2): the dispatcher can only ever route a lever the
    # 0079 enum already contains. 'hold' is in LEVERS but is the no-op, so it is not "actionable".
    assert set(_ACTIONABLE_LEVERS) | {"hold"} == set(LEVERS)


# ── 1) three-state mode + default off + reversibility ─────────────────────────────

def test_mode_defaults_to_off_with_nothing_configured(monkeypatch, tmp_path):
    """A fresh install with no overseer mode configured ⇒ off (the live loop runs as before)."""
    from src.settings import save_settings
    _isolate_settings(monkeypatch, tmp_path)
    monkeypatch.delenv("ORWELL_OVERSEER", raising=False)
    monkeypatch.delenv("ORWELL_OVERSEER_MODE", raising=False)
    save_settings({})                                   # nothing configured
    assert overseer_mode() == "off"
    assert overseer_enabled() is False                  # the back-compat shim tracks mode != off


def test_mode_resolves_each_state_from_settings(monkeypatch, tmp_path):
    """settings ``overseer_mode`` wins and resolves each of off/shadow/active."""
    from src.settings import save_settings
    _isolate_settings(monkeypatch, tmp_path)
    monkeypatch.delenv("ORWELL_OVERSEER", raising=False)
    monkeypatch.delenv("ORWELL_OVERSEER_MODE", raising=False)
    for state in OVERSEER_MODES:
        save_settings({"overseer_mode": state})
        assert overseer_mode() == state
        assert overseer_enabled() is (state != "off")


def test_flipping_the_setting_flips_the_mode_reversibly(monkeypatch, tmp_path):
    """Reversibility (scenario 'Reversibility …'): active → shadow → off flips the live mode each
    time and restores prior behavior; the flip is purely the setting."""
    from src.settings import save_settings
    _isolate_settings(monkeypatch, tmp_path)
    monkeypatch.delenv("ORWELL_OVERSEER", raising=False)
    monkeypatch.delenv("ORWELL_OVERSEER_MODE", raising=False)
    save_settings({"overseer_mode": "active"})
    assert overseer_mode() == "active"
    save_settings({"overseer_mode": "shadow"})
    assert overseer_mode() == "shadow"                  # deterministic guardrails resume acting
    save_settings({"overseer_mode": "off"})
    assert overseer_mode() == "off"
    assert overseer_enabled() is False


def test_legacy_toggle_and_env_map_to_shadow(monkeypatch, tmp_path):
    """The 0079 controls still work untouched: the legacy ``overseer_enabled`` setting and the
    ``ORWELL_OVERSEER`` env each map to 'shadow' (never silently 'active')."""
    from src.settings import save_settings
    _isolate_settings(monkeypatch, tmp_path)
    monkeypatch.delenv("ORWELL_OVERSEER", raising=False)
    monkeypatch.delenv("ORWELL_OVERSEER_MODE", raising=False)
    # legacy settings toggle: True -> shadow, False -> off
    save_settings({"overseer_enabled": True})
    assert overseer_mode() == "shadow"
    save_settings({"overseer_enabled": False})
    assert overseer_mode() == "off"
    # legacy env fallback when the setting is unset: truthy -> shadow
    save_settings({})
    monkeypatch.setenv("ORWELL_OVERSEER", "1")
    assert overseer_mode() == "shadow"
    monkeypatch.delenv("ORWELL_OVERSEER", raising=False)
    assert overseer_mode() == "off"


def test_explicit_overseer_mode_setting_wins_over_legacy_toggle(monkeypatch, tmp_path):
    """When both are present the explicit 3-state ``overseer_mode`` wins over the legacy binary
    ``overseer_enabled`` (so 'active' is reachable even with the old toggle set)."""
    from src.settings import save_settings
    _isolate_settings(monkeypatch, tmp_path)
    monkeypatch.delenv("ORWELL_OVERSEER", raising=False)
    monkeypatch.delenv("ORWELL_OVERSEER_MODE", raising=False)
    save_settings({"overseer_mode": "active", "overseer_enabled": False})
    assert overseer_mode() == "active"


# ── 2) TRIGGER-ONLY: dispatch routes to exactly one caller-supplied callable ───────

@pytest.mark.parametrize("target", _ACTIONABLE_LEVERS)
def test_dispatch_invokes_exactly_the_verdicts_lever_spy(target):
    """The core anti-sycophancy invariant (§7.1, scenario 'The overseer is trigger-only'): for a
    verdict whose lever is ``target``, exactly that lever's spy is invoked, no other spy fires, and
    the spy is the ONLY side effect — dispatch authors nothing itself."""
    calls = []
    # one spy per lever; each records its name and returns truthy ("applied").
    actions = {lever: (lambda lev=lever: (calls.append(lev) or True)) for lever in LEVERS}

    result = dispatch_lever(_verdict(target), actions)

    # exactly the target lever's deterministic action ran — and nothing else.
    assert calls == [target]
    # the result shape is the documented {'lever','applied','reason'}.
    assert set(result.keys()) == {"lever", "applied", "reason"}
    assert result["lever"] == target
    assert result["applied"] is True
    assert isinstance(result["reason"], str)


def test_dispatch_result_is_always_the_three_key_shape():
    """Every dispatch outcome (applied, declined, held, no-action, garbage) returns the same
    ``{'lever','applied','reason'}`` shape with a bool ``applied``."""
    cases = [
        dispatch_lever(_verdict("nudge"), {"nudge": lambda: True}),
        dispatch_lever(_verdict("nudge"), {"nudge": lambda: False}),
        dispatch_lever(_verdict("hold"), {}),
        dispatch_lever(_verdict("force-advance"), {}),
        dispatch_lever(None, {}),
    ]
    for r in cases:
        assert set(r.keys()) == {"lever", "applied", "reason"}
        assert isinstance(r["applied"], bool)
        assert isinstance(r["lever"], str)
        assert isinstance(r["reason"], str)


def test_dispatch_authors_no_outcome_only_triggers_the_action():
    """Trigger-only (§5 / §7.1): dispatch's ONLY effect is invoking the caller's callable — it
    never computes a winner/vote/magnitude. We prove it by making the spy the sole observable
    effect: the returned 'applied' is exactly what the action reported, nothing more."""
    sink = {}

    def _record_action():
        # stand-in for the existing engine-triggering path (_auto_record_scene / advanceGame …);
        # the ENGINE owns the magnitude — dispatch passes through this callable's truthy signal.
        sink["triggered"] = True
        return True

    result = dispatch_lever(_verdict("propose-record"), {"propose-record": _record_action})
    assert sink == {"triggered": True}                  # the action is the only side effect
    assert result["applied"] is True
    # dispatch_lever returns a plain telemetry dict — never an outcome/magnitude field.
    assert set(result.keys()) == {"lever", "applied", "reason"}


def test_a_declining_action_reports_not_applied():
    """A wired action that returns falsy ⇒ applied=False (it was triggered but declined); the lever
    is still echoed. This is distinct from 'no action provided'."""
    ran = []
    result = dispatch_lever(_verdict("nudge"), {"nudge": lambda: ran.append("x") or False})
    assert ran == ["x"]                                 # the action DID run…
    assert result["applied"] is False                   # …but reported "not applied"
    assert result["lever"] == "nudge"


# ── 3) FAIL-SOFT FLOOR ────────────────────────────────────────────────────────────

def test_a_raising_action_never_propagates(monkeypatch):
    """§7.3 / scenario 'The deterministic guardrails are the fail-soft floor': a lever action that
    RAISES must be swallowed — applied=False, no exception into the caller (the deterministic floor
    catches the symptom next)."""
    def _boom():
        raise RuntimeError("action exploded")

    # must not raise:
    result = dispatch_lever(_verdict("force-advance"), {"force-advance": _boom})
    assert result["applied"] is False
    assert result["lever"] == "force-advance"
    assert isinstance(result["reason"], str)


def test_hold_verdict_is_a_no_op():
    """A 'hold' verdict triggers nothing (logged as an observation upstream): applied=False even
    when a 'hold' action is somehow wired — 'hold' is the deliberate no-op."""
    ran = []
    result = dispatch_lever(_verdict("hold"), {"hold": lambda: ran.append("x") or True})
    assert ran == []                                    # 'hold' never invokes an action
    assert result["applied"] is False
    assert result["lever"] == "hold"


def test_lever_with_no_provided_action_is_a_no_op():
    """An actionable lever with no callable provided this turn ⇒ applied=False (a no-op, not an
    error) — nothing fires, the floor still stands."""
    for lever in _ACTIONABLE_LEVERS:
        result = dispatch_lever(_verdict(lever), {})    # empty action map
        assert result["applied"] is False
        assert result["lever"] == lever


def test_none_verdict_is_a_no_op():
    """A None verdict (the gate produced nothing) ⇒ applied=False, no action, no raise."""
    ran = []
    result = dispatch_lever(None, {lever: (lambda: ran.append("x")) for lever in LEVERS})
    assert ran == []
    assert result["applied"] is False


def test_out_of_set_lever_is_rejected_to_the_floor():
    """A verdict proposing a lever OUTSIDE the fixed set (the model can never widen the hand, §7.2)
    ⇒ applied=False even if a same-named callable is offered — dispatch only routes LEVERS."""
    ran = []
    rogue = Verdict(level="action", kind="rogue", diagnosis="out of contract", lever="frobnicate")
    result = dispatch_lever(rogue, {"frobnicate": lambda: ran.append("x") or True})
    assert ran == []                                    # the out-of-set callable never fired
    assert result["applied"] is False


# ── 4) LIVE-ONLY shape — active dispatch is only reachable in 'active' mode ────────

def test_active_dispatch_is_gated_to_active_mode(monkeypatch, tmp_path):
    """Ruling D4 / scenario 'Active is live-only': the active dispatch path is reachable ONLY in
    'active' mode. We model the caller's gate (``overseer_mode() == 'active'``) and prove that in
    off/shadow the caller would never dispatch — only the deterministic guardrails act."""
    from src.settings import save_settings
    _isolate_settings(monkeypatch, tmp_path)
    monkeypatch.delenv("ORWELL_OVERSEER", raising=False)
    monkeypatch.delenv("ORWELL_OVERSEER_MODE", raising=False)

    dispatched = []

    def _caller_turn():
        """Mirrors the agent_loop gate: dispatch only when the mode is 'active'."""
        if overseer_mode() == "active":
            dispatch_lever(_verdict("nudge"), {"nudge": lambda: dispatched.append("nudge") or True})

    # off ⇒ never dispatch
    save_settings({"overseer_mode": "off"})
    _caller_turn()
    assert dispatched == []
    # shadow (0079: diagnose + log only) ⇒ never dispatch
    save_settings({"overseer_mode": "shadow"})
    _caller_turn()
    assert dispatched == []
    # active ⇒ the dispatch path is reachable
    save_settings({"overseer_mode": "active"})
    _caller_turn()
    assert dispatched == ["nudge"]


def test_shadow_mode_assess_still_produces_a_verdict_without_dispatch(monkeypatch, tmp_path):
    """Belt-and-braces on the live-only carve-out: 'shadow' still DIAGNOSES (the 0079
    DeterministicOverseer yields a verdict on a symptom) — the difference 0080 introduces is purely
    whether the caller then DISPATCHES, which only 'active' does."""
    from src.settings import save_settings
    _isolate_settings(monkeypatch, tmp_path)
    monkeypatch.delenv("ORWELL_OVERSEER", raising=False)
    monkeypatch.delenv("ORWELL_OVERSEER_MODE", raising=False)
    save_settings({"overseer_mode": "shadow"})

    # a stall symptom: parked at an advance phase, a lull, no progression call.
    sig = Signals(in_advance_phase=True, play_quiet=True, progression_tool_called=False)
    assert should_assess(sig) is True
    verdict = DeterministicOverseer().assess(sig)
    assert verdict is not None
    assert verdict.lever in LEVERS                       # a real, in-contract verdict…
    assert overseer_mode() != "active"                   # …but shadow never dispatches it


# ── 5) SOURCE-PIN — agent_loop.py wires the active path additively over the floor ──

_AGENT_LOOP_SRC = pathlib.Path(__file__).resolve().parents[1] / "src" / "agent_loop.py"


def test_source_pin_legacy_guardrail_floor_still_coexists():
    """The deterministic guardrail FLOOR must remain in agent_loop.py regardless of the active
    seam (§3 Model D: the guardrails are demoted to the floor, NOT removed). This half holds today
    and must keep holding — the active block is ADDITIVE, not a replacement."""
    src = _AGENT_LOOP_SRC.read_text()
    assert "_FORCED_ADVANCE_NUDGE" in src                # the L39b forced-advance rung
    assert "advance nudge" in src                        # the stall pacing-nudge guardrail


def test_source_pin_active_path_is_wired_additively():
    """agent_loop.py wires the 'active' path (the ``overseer_mode`` gate + ``dispatch_lever``
    dispatch — the integration lane import-aliases the symbols) ALONGSIDE the legacy guardrail floor
    (``_FORCED_ADVANCE_NUDGE`` / 'advance nudge') — proving the active block is additive (DoD §8: the
    floor acts byte-identically when the overseer is unavailable / not active)."""
    src = _AGENT_LOOP_SRC.read_text()
    # the active seam references the 0080 contract (the wiring may import-alias the symbols):
    assert "overseer_mode" in src
    assert "dispatch_lever" in src
    # …additive over the still-present deterministic floor:
    assert "_FORCED_ADVANCE_NUDGE" in src
    assert "advance nudge" in src


# ── a structural Vault-free sanity guard (the inputs carry only telemetry) ─────────

def test_signals_are_vault_free_structural_telemetry_only():
    """Scenario 'The active path never crosses the Vault Wall': the overseer's only input is the
    0079 ``Signals`` — structural booleans/ints, never an outcome, a narration body, or Vault
    content. Pin the field set so a Vault field can't be smuggled in."""
    from dataclasses import fields
    names = {f.name for f in fields(Signals)}
    assert names == {
        "in_advance_phase", "play_quiet", "engaged_scene", "recorded_interaction",
        "desync", "io_error", "beat_seq_before", "beat_seq_after",
        "progression_tool_called", "tool_skip_streak",
    }
    # every value is a structural scalar (bool / int / None) — never an outcome or narration string.
    sig = Signals(in_advance_phase=True, beat_seq_before=1, beat_seq_after=1, tool_skip_streak=3)
    for f in fields(Signals):
        assert getattr(sig, f.name) is None or isinstance(getattr(sig, f.name), (bool, int))
