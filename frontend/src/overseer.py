"""Feature 0079 — the runtime loop overseer (the *reasoning* tier over the engine↔LLM loop).

Wide eyes, small hands. The boundary between the narration LLM and the deterministic engine is
*already* supervised today, but by brittle, scattered heuristics in ``agent_loop.py`` that
pattern-match **one symptom to one fixed action** and can't tell distinct root causes apart. This
module promotes that supervision into an overseer that is

  * **summoned only when needed** — :func:`should_assess` is the cheap, pure, deterministic
    **symptom-gate**: *wide across symptom TYPES* (so nothing real slips past) but *sparse in
    TIME* (a healthy turn trips nothing). Breadth is not frequency.
  * **wide-eyed on wake** — it reads ONLY the Vault-free telemetry carried in :class:`Signals`
    (never the Vault, never an outcome, never authored narration), diagnoses the **root cause**,
  * **small-but-RIGHT-handed** — and applies **exactly one** lever from the small fixed
    :data:`LEVERS` enum, or **surfaces and backs off** (``escalate``) when the right fix is
    outside the toolbox. The edge of the toolbox is the same line as the mandate wall: no lever
    authors content, decides an outcome, or reads/writes the Vault.

Two adapters sit behind :class:`OverseerPort` (mirroring ``NarrativePort`` / ``DeterministicNarrator``):

  * :class:`DeterministicOverseer` — the stub; returns the heuristic verdict and **never calls a
    model**, so seeded UAT/BDD lanes stay byte-identical and never hit the network.
  * :class:`LlmOverseer` — the reasoning tier; an injected ``llm_fn`` does the diagnosis over the
    Vault-free telemetry and proposes one lever. **Fail-soft**: on any error / out-of-contract
    reply (including a lever outside :data:`LEVERS`) it falls back to the deterministic verdict.

Governed by ADR 0003 (error-correct the model's *omissions*, never author content) and ADR 0005
(act only on the **open set**; the **closed set** stays engine-dictated). Every public method
swallows its own errors and degrades to a safe default — nothing raises into the caller.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import Optional, Protocol

# The SMALL FIXED lever set — "small hands". Each lever is the correct fix for one diagnosable
# failure mode and is mandate-safe BY CONSTRUCTION: every action here is one the FE already
# pulls, validated downstream by the MCP boundary + the 0031 checkpoint. No lever authors
# content, decides an outcome, or reads/writes the Vault. A proposed lever OUTSIDE this tuple is
# rejected (the urge for a bigger hand is the signal to ``escalate``, never a missing tool).
LEVERS = ("hold", "nudge", "force-advance", "propose-record", "reinject-delta", "escalate")

# The verdict levels — MUST equal log_rings._OVERSEER_LEVELS so record_overseer accepts them.
LEVELS = ("observation", "action", "anomaly", "escalation")


def overseer_enabled() -> bool:
    """Feature 0079 runtime overseer — OPT-IN, default OFF. Set ``ORWELL_OVERSEER`` to
    ``1``/``true``/``yes``/``on`` to enable the live shadow hook; unset (or any falsey value) ⇒ the
    deterministic floor stands and the loop runs exactly as before. Read from the env so an operator
    flips it without a restart (mirrors ``settings.game_build_enabled``)."""
    raw = os.getenv("ORWELL_OVERSEER")
    if raw is None:
        return False
    return raw.strip().lower() in ("1", "true", "yes", "on")


@dataclass(frozen=True)
class Signals:
    """The Vault-free per-turn telemetry the gate and the overseer read. Structural facts only —
    loop phase, tool-call tallies, the 0065 sync result, the 0065 beatSeq before/after — NEVER
    the Vault, an outcome, or a narration body. The overseer cannot leak what it never receives.
    """

    in_advance_phase: bool = False        # loop parked at an advance gate
    play_quiet: bool = False              # the turn was a lull (engagement signal)
    engaged_scene: bool = False           # an engaged player<->NPC scene happened this turn
    recorded_interaction: bool = False    # did recordInteraction fire this turn
    desync: bool = False                  # a 0065 desync / 409 stale-beat was flagged
    io_error: bool = False                # an engine I/O error/stall this turn
    beat_seq_before: Optional[int] = None
    beat_seq_after: Optional[int] = None
    progression_tool_called: bool = False  # advanceGame/submitDecision fired this turn
    tool_skip_streak: int = 0             # repeated tool-skip pattern this session


@dataclass(frozen=True)
class Verdict:
    """The overseer's conclusion: a level, a short symptom/correction token, a one-line diagnosis,
    and exactly one lever from :data:`LEVERS`. All fields are Vault-free tokens — they hand off
    straight to ``log_rings.record_overseer``."""

    level: str    # one of LEVELS
    kind: str     # short symptom/correction token (e.g. "stall", "gap-repair")
    diagnosis: str
    lever: str    # one of LEVERS
    confident: bool = True


# ── the sparse symptom-gate (the *when*) ──────────────────────────────────────────


def _beats_stalled_equal(signals: "Signals") -> bool:
    """True iff both beat values are present and equal — the 0065 ``beatSeq`` did not move when
    it should have. Absent/unequal ⇒ not a stall (we never invent one)."""
    before, after = signals.beat_seq_before, signals.beat_seq_after
    return before is not None and after is not None and before == after


def should_assess(signals: "Signals") -> bool:
    """The SPARSE symptom-gate: cheap, pure, deterministic; wide across symptom TYPES, sparse in
    TIME. ``True`` only when a structural symptom is present; a healthy turn trips nothing. It is
    the cheap structural *precondition*, NOT the fuzzy judgment the overseer makes on wake.

    Trips on ANY of:
      * an advance-phase lull the model did not progress;
      * an engaged player↔NPC scene that recorded nothing (the 0055 condition);
      * a flagged desync / 409 stale-beat;
      * an engine I/O error or stall;
      * ``beatSeq`` that did not move at an advance phase the model did not progress;
      * a repeated tool-skip pattern (≥3 this session).
    """
    try:
        if signals.in_advance_phase and signals.play_quiet and not signals.progression_tool_called:
            return True
        if signals.engaged_scene and not signals.recorded_interaction:
            return True
        if signals.desync:
            return True
        if signals.io_error:
            return True
        if (
            signals.in_advance_phase
            and _beats_stalled_equal(signals)
            and not signals.progression_tool_called
        ):
            return True
        if signals.tool_skip_streak >= 3:
            return True
        return False
    except Exception:
        # Fail-soft: a malformed Signals must never raise into the loop. A gate that cannot
        # decide stays silent (the deterministic floor still stands underneath).
        return False


# ── the port + the deterministic stub (the *what*) ────────────────────────────────


class OverseerPort(Protocol):
    def assess(self, signals: "Signals") -> Optional["Verdict"]: ...


def _heuristic_verdict(signals: "Signals") -> "Verdict":
    """Map each symptom to its ONE right lever (wide eyes, small hands). Precedence is by
    mandate weight: a missed social fold (the core consequence loop, mandate #1/#4) before a
    drifted read, before an engine fault, before a pure pacing stall, before a watch-only
    tool-skip streak. A symptom that woke the gate but warrants no action ⇒ observation/hold.
    Every branch yields a lever in :data:`LEVERS`."""
    # gap-repair: an engaged scene that folded nothing — propose a constrained record so the
    # social play moves the hidden weights. The ENGINE still owns the magnitude.
    if signals.engaged_scene and not signals.recorded_interaction:
        return Verdict(
            level="action",
            kind="gap-repair",
            diagnosis="engaged scene recorded nothing; proposing a constrained record",
            lever="propose-record",
        )
    # drifted read: the model's view diverged from the board — re-inject the stateDelta (fix the
    # INPUT, never the output).
    if signals.desync:
        return Verdict(
            level="action",
            kind="desync",
            diagnosis="model read drifted from the board; re-injecting the state delta",
            lever="reinject-delta",
        )
    # engine fault: an I/O error/stall is out of the overseer's hands — surface and back off.
    if signals.io_error:
        return Verdict(
            level="anomaly",
            kind="io-error",
            diagnosis="engine I/O error or stall; surfacing to health and backing off",
            lever="escalate",
        )
    # pacing stall: parked at an advance phase with quiet play / an unmoved beatSeq and no
    # progression call — nudge the deterministic advance (we TRIGGER it, never author it).
    if signals.in_advance_phase and not signals.progression_tool_called and (
        signals.play_quiet or _beats_stalled_equal(signals)
    ):
        return Verdict(
            level="action",
            kind="stall",
            diagnosis="model skipped the advance at a lull; nudging the deterministic advance",
            lever="nudge",
        )
    # watch-only: a repeated tool-skip pattern is notable but not yet actionable on its own.
    if signals.tool_skip_streak >= 3:
        return Verdict(
            level="anomaly",
            kind="tool-skip",
            diagnosis=f"repeated tool-skip pattern ({signals.tool_skip_streak}x this session)",
            lever="hold",
        )
    # assessed, but nothing to do — hold, and log WHY.
    return Verdict(
        level="observation",
        kind="lull",
        diagnosis="symptom present but no action warranted; holding",
        lever="hold",
    )


class DeterministicOverseer:
    """The stub adapter — returns the heuristic verdict and NEVER calls a model (seeded UAT/BDD
    lanes wire this, so they never hit the network and stay byte-identical). It maps each symptom
    to its one right lever; a symptomless turn ⇒ ``None`` (no wake, no log line)."""

    def assess(self, signals: "Signals") -> Optional["Verdict"]:
        try:
            if not should_assess(signals):
                return None
            return _heuristic_verdict(signals)
        except Exception:
            # Fail-soft: the supervisor must never crash the loop. A safe, do-nothing verdict.
            return Verdict(
                level="observation",
                kind="overseer-error",
                diagnosis="overseer self-error; holding",
                lever="hold",
            )


class LlmOverseer:
    """The reasoning tier — an injected ``llm_fn`` does the wide-eyes diagnosis over the Vault-free
    telemetry in :class:`Signals` ONLY (no narration body ever enters the prompt) and proposes one
    lever from :data:`LEVERS`. **Fail-soft**: on any error, unparseable reply, or out-of-contract
    field (a level outside :data:`LEVELS` or a lever outside :data:`LEVERS`), it returns the
    ``fallback`` (or a :class:`DeterministicOverseer`) verdict. A model reply can NEVER introduce a
    lever outside the enum — that path is rejected and the deterministic floor stands.
    """

    def __init__(self, llm_fn, fallback: Optional[OverseerPort] = None):
        self._llm_fn = llm_fn
        self._fallback: OverseerPort = fallback or DeterministicOverseer()

    # -- prompt construction (Vault-free: Signals scalars ONLY) --------------------

    def _telemetry(self, signals: "Signals") -> dict:
        """The Vault-free telemetry dict handed to the model — structural facts only, built from
        the :class:`Signals` fields. No narration, no outcome, no Vault content can enter here."""
        return {
            "in_advance_phase": bool(signals.in_advance_phase),
            "play_quiet": bool(signals.play_quiet),
            "engaged_scene": bool(signals.engaged_scene),
            "recorded_interaction": bool(signals.recorded_interaction),
            "desync": bool(signals.desync),
            "io_error": bool(signals.io_error),
            "beat_seq_before": signals.beat_seq_before,
            "beat_seq_after": signals.beat_seq_after,
            "progression_tool_called": bool(signals.progression_tool_called),
            "tool_skip_streak": int(signals.tool_skip_streak),
        }

    def _prompt(self, signals: "Signals") -> str:
        return (
            "You are the runtime overseer of the engine<->LLM loop. Read ONLY this Vault-free "
            "telemetry, diagnose the root cause, and pick EXACTLY ONE lever from this fixed set: "
            f"{list(LEVERS)}. You may never author content, decide an outcome, or read the Vault; "
            "if the right fix is outside the lever set, choose \"escalate\". Reply with a single "
            'JSON object: {"level": one of '
            f"{list(LEVELS)}, "
            '"kind": "<short token>", "diagnosis": "<one line>", "lever": "<one lever>"}.\n'
            "TELEMETRY:\n" + json.dumps(self._telemetry(signals), sort_keys=True)
        )

    # -- reply parsing (strict: out-of-contract => fallback) -----------------------

    @staticmethod
    def _extract_json(text: str) -> Optional[dict]:
        """Parse the first JSON object out of the model reply. ``None`` if there is none / it is
        not an object — which routes the caller to the deterministic fallback."""
        if not isinstance(text, str):
            return None
        try:
            obj = json.loads(text)
            return obj if isinstance(obj, dict) else None
        except Exception:
            pass
        # Tolerate prose around the JSON: take the outermost {...} span and try once.
        start, end = text.find("{"), text.rfind("}")
        if start != -1 and end > start:
            try:
                obj = json.loads(text[start : end + 1])
                return obj if isinstance(obj, dict) else None
            except Exception:
                return None
        return None

    def assess(self, signals: "Signals") -> Optional["Verdict"]:
        try:
            if not should_assess(signals):
                return None
            raw = self._llm_fn(self._prompt(signals))
            parsed = self._extract_json(raw)
            if not parsed:
                return self._fallback.assess(signals)

            level = parsed.get("level")
            lever = parsed.get("lever")
            kind = parsed.get("kind")
            diagnosis = parsed.get("diagnosis")

            # Strict contract check. A reply that proposes a lever OUTSIDE LEVERS (or a level
            # outside LEVELS, or with missing/non-string tokens) is rejected — the model can
            # never widen the hand; the deterministic verdict stands instead.
            if level not in LEVELS or lever not in LEVERS:
                return self._fallback.assess(signals)
            if not isinstance(kind, str) or not isinstance(diagnosis, str):
                return self._fallback.assess(signals)

            return Verdict(
                level=level,
                kind=kind,
                diagnosis=diagnosis,
                lever=lever,
            )
        except Exception:
            # Any error in the model call / parse path -> the deterministic floor.
            try:
                return self._fallback.assess(signals)
            except Exception:
                return None
