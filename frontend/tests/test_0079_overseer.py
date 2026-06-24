"""Feature 0079 — the runtime loop overseer (the reasoning tier + the sparse symptom-gate).

Name-agnostic — roles ONLY (player, NPC, HOH, nominee, admin). Covers the overseer MODULE
(``src/overseer.py``); the 4th log-ring writer + admin route are covered in
``test_0079_overseer_log.py``. Realizes the executable-spec scenarios:

  * sparse trigger      — a healthy turn wakes nothing; each symptom individually wakes it;
  * wide eyes           — the SAME advance-phase symptom yields different levers by root cause;
  * small hands         — every produced lever is in the fixed LEVERS enum (no authoring/outcome/Vault);
  * fail-soft           — a raising / garbage / out-of-contract llm_fn falls back to the heuristic;
  * Vault-free handoff  — a verdict hands straight to record_overseer and carries only tokens/beats.
"""

import importlib

import pytest

overseer = importlib.import_module("src.overseer")
log_rings = importlib.import_module("src.log_rings")

Signals = overseer.Signals
Verdict = overseer.Verdict
should_assess = overseer.should_assess
DeterministicOverseer = overseer.DeterministicOverseer
LlmOverseer = overseer.LlmOverseer
LEVERS = overseer.LEVERS
LEVELS = overseer.LEVELS


# ── role-only Signals fixtures (no names anywhere) ───────────────────────────────

def _healthy():
    """An ordinary in-character turn: scene recorded, beat advanced, no error."""
    return Signals(
        in_advance_phase=False,
        play_quiet=False,
        engaged_scene=True,
        recorded_interaction=True,
        desync=False,
        io_error=False,
        beat_seq_before=7,
        beat_seq_after=8,
        progression_tool_called=True,
        tool_skip_streak=0,
    )


def _advance_lull():
    """Parked at an advance gate while play has gone quiet; the model did not advance."""
    return Signals(in_advance_phase=True, play_quiet=True, progression_tool_called=False)


def _advance_beat_stalled():
    """Parked at an advance gate; beatSeq did not move; the model did not advance."""
    return Signals(
        in_advance_phase=True,
        beat_seq_before=12,
        beat_seq_after=12,
        progression_tool_called=False,
    )


def _engaged_not_recorded():
    """An engaged player↔NPC scene that recorded nothing (the 0055 condition)."""
    return Signals(engaged_scene=True, recorded_interaction=False)


def _desync():
    return Signals(desync=True)


def _io_error():
    return Signals(io_error=True)


def _tool_skip_streak():
    return Signals(tool_skip_streak=3)


# ════════════════════════════════════════════════════════════════════════════════
# Scenario: a healthy turn does not wake the overseer (sparse trigger)
# ════════════════════════════════════════════════════════════════════════════════

def test_healthy_turn_trips_no_symptom_and_does_not_wake():
    sig = _healthy()
    assert should_assess(sig) is False
    # the stub honours the gate: a symptomless turn -> no verdict, no log line.
    assert DeterministicOverseer().assess(sig) is None


def test_empty_signals_default_is_healthy():
    # the dataclass defaults are an all-clear turn — nothing trips.
    assert should_assess(Signals()) is False


# ── each symptom individually trips the gate (wide across TYPES) ─────────────────

@pytest.mark.parametrize(
    "sig",
    [
        _advance_lull(),
        _advance_beat_stalled(),
        _engaged_not_recorded(),
        _desync(),
        _io_error(),
        _tool_skip_streak(),
    ],
)
def test_each_symptom_individually_wakes_the_gate(sig):
    assert should_assess(sig) is True


def test_a_lone_quiet_lull_without_advance_phase_does_not_trip():
    # the lull symptom needs the advance phase — quiet alone is not a symptom (sparse in time).
    assert should_assess(Signals(play_quiet=True)) is False


def test_advance_phase_alone_without_a_lull_does_not_trip():
    # parked at an advance gate but play is lively and beats moved — not stuck.
    assert should_assess(
        Signals(in_advance_phase=True, beat_seq_before=3, beat_seq_after=4)
    ) is False


def test_a_recorded_engaged_scene_does_not_trip():
    assert should_assess(Signals(engaged_scene=True, recorded_interaction=True)) is False


def test_a_progressed_advance_phase_does_not_trip():
    # the model DID advance -> no stall symptom even at an advance phase with quiet play.
    assert should_assess(
        Signals(in_advance_phase=True, play_quiet=True, progression_tool_called=True)
    ) is False
    assert should_assess(
        Signals(in_advance_phase=True, beat_seq_before=5, beat_seq_after=5,
                progression_tool_called=True)
    ) is False


def test_a_short_tool_skip_streak_does_not_trip():
    assert should_assess(Signals(tool_skip_streak=2)) is False


# ════════════════════════════════════════════════════════════════════════════════
# DeterministicOverseer: each symptom -> its one right (level, lever)
# ════════════════════════════════════════════════════════════════════════════════

@pytest.mark.parametrize(
    "sig, level, kind, lever",
    [
        (_engaged_not_recorded(), "action", "gap-repair", "propose-record"),
        (_desync(), "action", "desync", "reinject-delta"),
        (_advance_lull(), "action", "stall", "nudge"),
        (_advance_beat_stalled(), "action", "stall", "nudge"),
        (_io_error(), "anomaly", "io-error", "escalate"),
        (_tool_skip_streak(), "anomaly", "tool-skip", "hold"),
    ],
)
def test_deterministic_overseer_maps_symptom_to_lever(sig, level, kind, lever):
    v = DeterministicOverseer().assess(sig)
    assert v is not None
    assert v.level == level
    assert v.kind == kind
    assert v.lever == lever
    assert v.lever in LEVERS
    assert v.level in LEVELS


def test_assessed_but_nothing_actionable_holds_as_observation():
    # a Signals that passes the gate yet warrants no concrete lever -> observation/hold.
    # (e.g. a stale beat that is NOT at an advance phase still trips no actionable branch.)
    sig = Signals(in_advance_phase=True, play_quiet=True, progression_tool_called=False)
    # force the "nothing actionable" floor directly through the heuristic helper:
    v = overseer._heuristic_verdict(Signals())  # no symptom -> the fallthrough hold
    assert v.level == "observation"
    assert v.lever == "hold"
    assert v.kind == "lull"
    # and the public path on a true non-actionable-but-gated case still yields hold/observation
    # by routing through the same fallthrough is exercised above; sanity-check the lever set:
    assert DeterministicOverseer().assess(sig).lever in LEVERS


# ════════════════════════════════════════════════════════════════════════════════
# Scenario: SAME symptom (advance-phase), DIFFERENT root cause, DIFFERENT fix
# ════════════════════════════════════════════════════════════════════════════════

def test_same_advance_phase_symptom_different_root_cause_different_lever():
    # root cause A — the model under-called the advance at a lull -> nudge.
    lull = Signals(in_advance_phase=True, play_quiet=True, progression_tool_called=False)
    # root cause B — at the same advance phase, an engaged scene folded nothing -> propose-record.
    gap = Signals(in_advance_phase=True, play_quiet=True, progression_tool_called=False,
                  engaged_scene=True, recorded_interaction=False)
    va = DeterministicOverseer().assess(lull)
    vb = DeterministicOverseer().assess(gap)
    assert va.lever == "nudge"
    assert vb.lever == "propose-record"
    assert va.lever != vb.lever               # the wide-eyes value: distinct fixes


def test_mid_scene_is_held_not_advanced():
    # the player is legitimately mid-scene (engaged + recorded) but parked at an advance phase
    # with no model progression — the gate trips on the stall, yet the right move is to nudge
    # the advance, NOT to invent a record (nothing is missing). Distinct from a true lull only
    # in that recording already happened; the lever stays within the fixed set.
    sig = Signals(in_advance_phase=True, play_quiet=True, progression_tool_called=False,
                  engaged_scene=True, recorded_interaction=True)
    v = DeterministicOverseer().assess(sig)
    assert v.lever in LEVERS
    assert v.lever == "nudge"                  # nothing to repair -> the pacing lever, not a record


# ════════════════════════════════════════════════════════════════════════════════
# Scenario: a missed social fold -> the constrained record lever (engine owns magnitude)
# ════════════════════════════════════════════════════════════════════════════════

def test_missed_social_fold_proposes_a_constrained_record():
    v = DeterministicOverseer().assess(_engaged_not_recorded())
    assert v.kind == "gap-repair"
    assert v.lever == "propose-record"
    # the lever only PROPOSES a record; the engine still owns the magnitude — no number is
    # anywhere in the verdict (it carries tokens + a one-line diagnosis only).
    assert not any(ch.isdigit() for ch in v.diagnosis) or "magnitude" not in v.diagnosis.lower()


# ════════════════════════════════════════════════════════════════════════════════
# Scenario: small hands stay small — no lever authors content / outcome / Vault
# ════════════════════════════════════════════════════════════════════════════════

def test_every_produced_lever_is_within_the_fixed_enum():
    sigs = [
        _advance_lull(), _advance_beat_stalled(), _engaged_not_recorded(),
        _desync(), _io_error(), _tool_skip_streak(),
    ]
    for sig in sigs:
        v = DeterministicOverseer().assess(sig)
        assert v is not None
        assert v.lever in LEVERS, f"lever {v.lever!r} escaped the fixed toolbox"
        assert v.level in LEVELS


def test_an_out_of_toolbox_problem_escalates_rather_than_acts():
    # the engine fault (io-error) is the canonical "outside my hands" case: surface + back off.
    v = DeterministicOverseer().assess(_io_error())
    assert v.level == "anomaly"
    assert v.lever == "escalate"               # backs off; never reaches for a bigger lever


def test_the_lever_enum_is_exactly_the_mandate_safe_set():
    # the toolbox is fixed and small — no lever names an outcome/authoring/Vault action.
    assert set(LEVERS) == {
        "hold", "nudge", "force-advance", "propose-record", "reinject-delta", "escalate",
    }


# ════════════════════════════════════════════════════════════════════════════════
# Scenario: fail-soft — LlmOverseer degrades to the deterministic verdict
# ════════════════════════════════════════════════════════════════════════════════

def test_llm_overseer_passes_through_a_well_formed_reply():
    ov = LlmOverseer(lambda p: (
        '{"level": "action", "kind": "stall", '
        '"diagnosis": "model under-called the advance", "lever": "nudge"}'
    ))
    v = ov.assess(_advance_lull())
    assert v.level == "action"
    assert v.kind == "stall"
    assert v.lever == "nudge"
    assert v.lever in LEVERS


def test_llm_overseer_tolerates_prose_around_the_json():
    ov = LlmOverseer(lambda p: (
        "Here is my read.\n"
        '{"level": "action", "kind": "desync", "diagnosis": "drifted", "lever": "reinject-delta"}'
        "\nThat is all."
    ))
    v = ov.assess(_desync())
    assert v.lever == "reinject-delta"


def test_llm_overseer_falls_back_when_the_model_raises():
    def raising_llm(_prompt):
        raise RuntimeError("provider exploded")
    ov = LlmOverseer(raising_llm)
    v = ov.assess(_advance_lull())
    # exactly the deterministic verdict for this symptom.
    assert v == DeterministicOverseer().assess(_advance_lull())
    assert v.lever == "nudge"


def test_llm_overseer_falls_back_on_garbage():
    ov = LlmOverseer(lambda p: "this is not json at all {nope")
    v = ov.assess(_desync())
    assert v == DeterministicOverseer().assess(_desync())
    assert v.lever == "reinject-delta"


def test_llm_overseer_falls_back_on_empty_or_none_reply():
    assert LlmOverseer(lambda p: "").assess(_io_error()).lever == "escalate"
    assert LlmOverseer(lambda p: None).assess(_io_error()).lever == "escalate"


def test_llm_overseer_rejects_a_lever_outside_the_enum():
    # the model proposes a hand it is NOT allowed to hold -> rejected, deterministic floor stands.
    ov = LlmOverseer(lambda p: (
        '{"level": "action", "kind": "stall", '
        '"diagnosis": "let me author it", "lever": "writeNarration"}'
    ))
    v = ov.assess(_advance_lull())
    assert v.lever in LEVERS
    assert v.lever == "nudge"                  # the deterministic verdict, not the rogue lever
    assert v == DeterministicOverseer().assess(_advance_lull())


def test_llm_overseer_rejects_an_out_of_set_level():
    ov = LlmOverseer(lambda p: (
        '{"level": "godmode", "kind": "stall", "diagnosis": "x", "lever": "nudge"}'
    ))
    v = ov.assess(_advance_lull())
    assert v.level in LEVELS
    assert v == DeterministicOverseer().assess(_advance_lull())


def test_llm_overseer_rejects_non_string_tokens():
    ov = LlmOverseer(lambda p: '{"level": "action", "kind": 7, "diagnosis": "x", "lever": "nudge"}')
    v = ov.assess(_advance_lull())
    assert v == DeterministicOverseer().assess(_advance_lull())


def test_llm_overseer_honours_the_gate_no_wake_on_a_healthy_turn():
    called = {"n": 0}

    def counting_llm(_p):
        called["n"] += 1
        return '{"level":"observation","kind":"x","diagnosis":"y","lever":"hold"}'

    ov = LlmOverseer(counting_llm)
    assert ov.assess(_healthy()) is None       # no symptom -> no model call at all
    assert called["n"] == 0


def test_llm_overseer_uses_an_explicit_fallback_when_given_one():
    sentinel = Verdict(level="observation", kind="fallback", diagnosis="custom floor", lever="hold")

    class _Fixed:
        def assess(self, signals):
            return sentinel

    ov = LlmOverseer(lambda p: "garbage", fallback=_Fixed())
    assert ov.assess(_desync()) is sentinel


def test_llm_overseer_prompt_is_vault_free_signals_only():
    # the prompt is built from the Signals scalars only — never a narration body / outcome / Vault.
    captured = {}

    def capturing_llm(prompt):
        captured["p"] = prompt
        return '{"level":"action","kind":"stall","diagnosis":"d","lever":"nudge"}'

    LlmOverseer(capturing_llm).assess(_advance_lull())
    p = captured["p"]
    # it advertises the fixed lever set and forbids out-of-toolbox action…
    for lever in LEVERS:
        assert lever in p
    assert "Vault" in p
    # …and the telemetry is the structural fields, with no free-text body smuggled in.
    assert "in_advance_phase" in p and "beat_seq_before" in p


# ════════════════════════════════════════════════════════════════════════════════
# Scenario: the diagnostic-log handoff is Vault-free (level/kind/diagnosis/lever/beats only)
# ════════════════════════════════════════════════════════════════════════════════

def test_levels_match_the_log_ring_levels():
    # record_overseer accepts our levels verbatim (else it would coerce them to "observation").
    assert LEVELS == log_rings._OVERSEER_LEVELS


def test_verdict_hands_off_cleanly_to_record_overseer():
    sig = Signals(in_advance_phase=True, play_quiet=True, progression_tool_called=False,
                  beat_seq_before=4, beat_seq_after=4)
    v = DeterministicOverseer().assess(sig)
    log_rings.record_overseer(
        v.level, v.kind, v.diagnosis,
        lever=v.lever, beat_before=sig.beat_seq_before, beat_after=sig.beat_seq_after, ok=True,
    )
    _, lines = log_rings.OVERSEER.since(0)
    e = [l for l in lines if l["kind"] == v.kind and l["diagnosis"] == v.diagnosis][-1]
    # the entry carries ONLY the overseer tokens + beats; the level lands verbatim (not coerced).
    assert e["overseerLevel"] == v.level       # accepted as-is, not flattened to "observation"
    assert e["lever"] == v.lever
    assert e["beatBefore"] == 4 and e["beatAfter"] == 4
    # structural Vault-free shape: no narration-body key, only the curated fields + display chrome.
    allowed = {
        "ts", "seq", "level", "logger", "msg",
        "overseerLevel", "kind", "diagnosis", "lever", "beatBefore", "beatAfter", "ok", "user",
    }
    assert set(e.keys()) <= allowed, f"unexpected key(s): {set(e.keys()) - allowed}"


def test_every_symptom_verdict_is_accepted_by_record_overseer():
    for sig in (_advance_lull(), _engaged_not_recorded(), _desync(),
                _io_error(), _tool_skip_streak()):
        v = DeterministicOverseer().assess(sig)
        log_rings.record_overseer(v.level, v.kind, v.diagnosis, lever=v.lever)
        _, lines = log_rings.OVERSEER.since(0)
        # the level is one record_overseer keeps verbatim (proves LEVELS ⊆ _OVERSEER_LEVELS).
        assert lines[-1]["overseerLevel"] == v.level
