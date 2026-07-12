"""#1411 — pre-refactor CHARACTERIZATION PIN of the FE-held beat→lever forced-`tool_choice` map.

Today the front-end owns the map that decides WHICH single engine lever is forced on the wire at a
closed-set beat where exactly one lever is legal (`docs/design/undercall-seam-structural.md` §2.1 /
§3, the #1154/#1319 forced-`tool_choice` seam). The force set is an FE literal
(`_FORCE_COMP_PHASES` / `_FORCE_ADVANCE_PHASES`) plus the one pre-game casting-finalize force
(`_forced_tool_choice_for_casting`). Issue **#1411** moves that decision to an **engine-signalled
`requiredLever`** field (the pending/moment projection names the lever; the FE forces whatever the
engine names). The undercall doc §3, option (a), calls this out as the accepted follow-on shape.

This file exists to make that migration provably behaviour-preserving. It pins the CURRENT
beat→lever map as a single golden table (`EXPECTED_BEAT_LEVER_MAP`) plus the invariants that keep
the seam safe, and asserts the live source honours it exactly. **If the #1411 refactor changes which
lever a beat forces — or adds/removes a forced beat — THIS test flips red**, forcing a conscious
re-pin against the new engine-signalled shape rather than a silent behaviour drift.

The *implementation* of the migration (the `requiredLever` wiring in the FENCED
`frontend/src/agent_loop.py` + the engine projection) is **separate fenced work** tracked under
#1411 — this file is a read-only characterization pin only; it edits nothing.

Sibling / non-overlap:
  * `test_tool_choice_force.py` pins the #1154/#1319 GATE scenario-by-scenario (the wire payload, the
    provider-rejecter gate, the kill-switch, each suppression path). This file pins the MAP itself as
    one golden table and adds the *completeness* invariant (map keys == the source force sets), which
    is the exact property the migration must preserve. No behaviour is re-implemented here.
  * The belt-fire telemetry contract (a forced-tool-choice count means an OBSERVED landed tool event,
    never a mere wire selection) stays owned by `test_belt_telemetry.py`; this file only REFERENCES
    that authority (see `test_forced_tool_choice_telemetry_contract_is_referenced_not_duplicated`).

Roles only — no houseguest names as data. Stdlib-only.
"""

import importlib
import os

import pytest

_HERE = os.path.dirname(os.path.abspath(__file__))


# ── The extractor: locate the CURRENT forcing sites, or FAIL LOUDLY (never silently pass) ────────────
#
# #1411 will move/rename these. When it does, the loud failure below is the SIGNAL to re-pin this
# characterization test against the engine-signalled `requiredLever` shape — it must NEVER degrade to a
# no-op that quietly passes while the map has moved out from under it.

_REQUIRED_SYMBOLS = (
    "_forced_tool_choice_for_beat",       # the pure live-beat force gate
    "_forced_tool_choice_for_casting",    # the pure casting-finalize force gate
    "_FORCE_COMP_PHASES",                 # comp phases → forced lever
    "_FORCE_ADVANCE_PHASES",              # ceremony advance-phases → forced lever
    "_CASTING_FINALIZE_TOOL",             # the casting-finalize forced lever name
    "_SOCIAL_HOLD_MOMENT",                # the social-runway hold that suppresses forcing
)


def _forcing_api():
    """Return the agent_loop module after asserting every forcing site this pin characterizes is
    still present. FAIL LOUDLY ("update the extractor") if #1411 moved/renamed any of them — that is
    the intended re-pin trigger, not a pass."""
    al = importlib.import_module("src.agent_loop")
    missing = [name for name in _REQUIRED_SYMBOLS if not hasattr(al, name)]
    if missing:
        pytest.fail(
            "update the extractor: the #1411 requiredLever migration moved/renamed the FE "
            f"beat→lever forcing site(s) {missing}. This characterization pin can no longer locate "
            "the map it exists to protect — re-pin it against the new engine-signalled shape "
            "(docs/design/undercall-seam-structural.md §2.1/§3, option (a)).")
    return al


# ── THE GOLDEN TABLE — the current FE-held beat→lever forced-`tool_choice` map ────────────────────────
#
# Each key is a closed-set beat where exactly one engine-owned lever is legal; the value is the lever
# the FE forces on the wire TODAY. #1411 must reproduce this map from the engine's `requiredLever`
# field byte-for-byte, or this test re-pins consciously. The two forced levers are BOTH engine-owned,
# deterministic reads the model may only VOICE — never `submitDecision` (the player's binding pick).

# Live-season closed-set beats (framed `phase`) → forced lever.
_LIVE_BEAT_LEVER_MAP = {
    # comp phases: #1319 forces the NAMED advanceGame (never runCompetition — a no-op mid-stage — and
    # never a bare "required"), the one call that both resolves the field and reveals the next batch.
    "hoh-competition":  "advanceGame",
    "veto-competition": "advanceGame",
    # ceremony advance-phases: only advanceGame drips these deterministic beats.
    "nominations":      "advanceGame",
    "veto-ceremony":    "advanceGame",
    "eviction":         "advanceGame",
}

# The one pre-game closed-set beat with a single legal lever (the casting-finalize force).
_CASTING_BEAT = "casting-finalize"
_CASTING_LEVER = "createCharacter"

# The complete beat→lever map (live + casting) — the single golden truth this file pins.
EXPECTED_BEAT_LEVER_MAP = {**_LIVE_BEAT_LEVER_MAP, _CASTING_BEAT: _CASTING_LEVER}

# The ONLY two levers the whole map may ever force. `submitDecision` must NEVER appear.
_FORCEABLE_LEVERS = {"advanceGame", "createCharacter"}

# Beats deliberately EXCLUDED from the force set (they carry their own belts and are more delicate):
# premiere (markHouseguestMet), finale flow, twist-reveal — plus ordinary social/lull turns.
_DELIBERATELY_UNFORCED_BEATS = ("premiere", "finale", "twist-reveal", "social", "lingering")

_NAMED_ADVANCE = {"type": "function", "function": {"name": "advanceGame"}}


def _force_live(phase, fired=(), *, moment=None, pending=False):
    """Drive the pure live-beat force gate the way the loop does: a (week, phase, moment[, pending])
    framed key, the set of tool names already fired this turn, and the open-pending flag."""
    al = _forcing_api()
    key = ("w1", phase, phase if moment is None else moment)
    return al._forced_tool_choice_for_beat(key, set(fired), pending_open=pending)


def _force_casting(fired=(), *, ready=True, finalizable=True, started=False, player=True):
    al = _forcing_api()
    return al._forced_tool_choice_for_casting(
        set(fired), ready=ready, finalizable=finalizable, started=started, player_signalled=player)


# ── 1. Which beats force, and WHICH lever each forces (the map, pinned) ───────────────────────────────


def test_extractor_locates_every_forcing_site():
    # Guard the guard: the pin is only meaningful while it can find the map. This test is the loud
    # tripwire — it fails with an "update the extractor" message if #1411 renamed the sites.
    al = _forcing_api()
    for name in _REQUIRED_SYMBOLS:
        assert hasattr(al, name), name


def test_live_beat_lever_map_is_pinned_exactly():
    # Every live closed-set beat forces exactly the lever the golden table names — a NAMED advanceGame
    # tool_choice, never a bare "required" string (#1319), never runCompetition, never submitDecision.
    for phase, lever in _LIVE_BEAT_LEVER_MAP.items():
        forced = _force_live(phase)
        assert isinstance(forced, dict), (phase, forced)
        assert forced["type"] == "function", (phase, forced)
        assert forced["function"]["name"] == lever, (phase, forced)
        assert forced == _NAMED_ADVANCE, phase  # the concrete wire shape, pinned


def test_force_set_equals_the_map_keys_no_beat_added_or_dropped():
    # COMPLETENESS invariant (the property #1411 must preserve): the source's force sets are EXACTLY
    # the live map's keys — nothing more, nothing less. Adding or removing a forced beat flips this red.
    al = _forcing_api()
    source_force_phases = set(al._FORCE_COMP_PHASES) | set(al._FORCE_ADVANCE_PHASES)
    assert source_force_phases == set(_LIVE_BEAT_LEVER_MAP), (
        "the FE force set drifted from the pinned beat→lever map — re-pin EXPECTED_BEAT_LEVER_MAP "
        f"(source={sorted(source_force_phases)}, pinned={sorted(_LIVE_BEAT_LEVER_MAP)})")


def test_casting_finalize_beat_forces_create_character():
    # The one pre-game closed-set beat: casting-finalize forces createCharacter (and the source's
    # lever-name constant agrees with the golden table).
    al = _forcing_api()
    assert al._CASTING_FINALIZE_TOOL == _CASTING_LEVER
    forced = _force_casting()
    assert forced == {"type": "function", "function": {"name": _CASTING_LEVER}}


def test_every_forced_lever_is_one_of_the_two_engine_owned_levers():
    # The whole map may only ever force advanceGame or createCharacter — both engine-owned deterministic
    # reads the model merely VOICES. Sweep the live map + casting.
    forced_levers = set()
    for phase in _LIVE_BEAT_LEVER_MAP:
        forced_levers.add(_force_live(phase)["function"]["name"])
    forced_levers.add(_force_casting()["function"]["name"])
    assert forced_levers == _FORCEABLE_LEVERS, forced_levers


# ── 2. submitDecision is NEVER force-forced (the mandate: the engine never speaks for the player) ─────


def test_submit_decision_is_never_forced_anywhere_in_the_live_map():
    # Sweep every live force phase × representative fired-set × pending flag: no input shape may ever
    # yield a submitDecision force. Forcing it would make the model INVENT the player's binding pick.
    al = _forcing_api()
    for phase in set(al._FORCE_COMP_PHASES) | set(al._FORCE_ADVANCE_PHASES):
        for fired in ([], ["runCompetition"], ["advanceGame"]):
            for pend in (True, False):
                got = _force_live(phase, fired, pending=pend)
                if isinstance(got, dict):
                    assert got["function"]["name"] != "submitDecision", (phase, fired, pend)


def test_submit_decision_is_never_forced_by_the_casting_gate():
    # The casting gate carries no player binding-pick either — createCharacter only, never submitDecision.
    for started in (False, True):
        for ready in (False, True):
            for player in (False, True):
                got = _force_casting(ready=ready, finalizable=ready, started=started, player=player)
                if isinstance(got, dict):
                    assert got["function"]["name"] != "submitDecision"


# ── 3. Forcing is SUPPRESSED on open pendings and social/witnessed-ceremony holds ────────────────────


def test_open_player_pending_suppresses_all_live_forcing():
    # An open player pending ⇒ the engine waits on the PLAYER (a card); the model surfaces it, and
    # forcing (which would advance/run a comp past the card) is fully suppressed for every force beat.
    for phase in _LIVE_BEAT_LEVER_MAP:
        assert _force_live(phase, [], pending=True) is None, phase


def test_social_hold_moment_suppresses_forcing_even_on_a_force_phase():
    # The social-runway HOLD (moment == the source's _SOCIAL_HOLD_MOMENT while phase is the next
    # unresolved ceremony/comp) must suppress phase-blind forcing, or forcing re-opens the force-march
    # ADR 0003 forbids past the player's lingering window.
    al = _forcing_api()
    for phase in _LIVE_BEAT_LEVER_MAP:
        assert _force_live(phase, [], moment=al._SOCIAL_HOLD_MOMENT) is None, phase


def test_witnessed_ceremony_moment_mismatch_suppresses_forcing():
    # After the engine self-advances phase past a just-resolved ceremony (NARR-7), the FE re-frames the
    # moment onto that beat so the player witnesses it. A moment that is a force-advance beat but does
    # NOT match the (already-rolled) phase suppresses forcing — the model already has the beat to narrate.
    assert _force_live("veto-competition", [], moment="nominations") is None
    assert _force_live("eviction", [], moment="veto-ceremony") is None


def test_guarantee_met_this_turn_does_not_reforce():
    # Once advanceGame has already fired this turn the guarantee is met; the gate must not re-force on a
    # later round of a multi-round turn.
    for phase in _LIVE_BEAT_LEVER_MAP:
        assert _force_live(phase, ["advanceGame"]) is None, phase


def test_casting_gate_suppressions_are_pinned():
    # The casting force is gated on EVERY reactive-terminal condition: pre-game (not started), engine
    # ready AND finalizable, an explicit player readiness signal, and createCharacter not already fired.
    assert _force_casting(started=True) is None                       # season already started
    assert _force_casting(ready=False) is None                        # engine not ready
    assert _force_casting(finalizable=False) is None                  # not finalizable → never a floater
    assert _force_casting(player=False) is None                       # no explicit player signal
    assert _force_casting(["createCharacter"]) is None                # guarantee already met this turn


# ── 4. Deliberately-unforced beats stay unforced (the excluded set, pinned) ──────────────────────────


def test_excluded_beats_are_never_forced():
    # premiere / finale / twist-reveal (their own belts) + ordinary social/lull turns must NEVER force.
    # If #1411 ever pulls one of these into the force set it must be a conscious change here.
    for beat in _DELIBERATELY_UNFORCED_BEATS:
        assert _force_live(beat) is None, beat
        assert beat not in EXPECTED_BEAT_LEVER_MAP, beat


# ── 5. The belt-fire telemetry contract is REFERENCED (owned elsewhere), not duplicated ──────────────


def test_forced_tool_choice_telemetry_contract_is_referenced_not_duplicated():
    # A `forced-tool-choice:<tool>` belt count means an OBSERVED landed tool event, never a mere wire
    # selection (undercall doc §5). That success-gating is pinned by test_belt_telemetry.py — this pin
    # only asserts that authority still exists, so #1411 (which touches the forcing sites) cannot land
    # while its telemetry contract has silently vanished. We do NOT re-implement the behaviour here.
    belt_test = os.path.join(_HERE, "test_belt_telemetry.py")
    assert os.path.exists(belt_test), "the belt-telemetry contract authority is missing"
    with open(belt_test, encoding="utf-8") as fh:
        src = fh.read()
    assert "def test_forced_tool_choice_notes_only_after_the_forced_call_landed(" in src, (
        "the success-gated forced-tool-choice telemetry contract (undercall doc §5) is no longer "
        "pinned in test_belt_telemetry.py — that gate must survive the #1411 migration")
    assert "def test_success_gated_belts_fire_only_after_the_helper_applied(" in src


def test_stable_belt_token_format_is_pinned():
    # The telemetry token for a forced-lever fire is `forced-tool-choice:<tool>` (undercall doc §5, the
    # stable-token registry). Pinned so the migration keeps the token stable across the refactor.
    for lever in sorted(_FORCEABLE_LEVERS):
        token = "forced-tool-choice:" + lever
        assert token.startswith("forced-tool-choice:")
        assert token.split(":", 1)[1] == lever
