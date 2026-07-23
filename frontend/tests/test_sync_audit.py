"""The PENDING-DECISION BARRIER covers EVERY player decision kind (the chat↔engine DESYNC gate).

The Python half of the standing chat↔engine sync audit (the TS half lives in
`tests/integration/syncAudit.test.ts`). CI cannot drive the real, non-deterministic LLM, so we
do not test the narration itself — we test the thing that PREVENTS desync deterministically: the
pending-decision barrier (`routes.chat_helpers._pending_barrier_directive`). When the engine sits
BLOCKED on a player decision, the barrier is the forceful GM directive that HARD-BLOCKS the model
from narrating PAST it (no new day / week / ceremony) — the fix for the live bug where the GM
role-played into the next week while the engine waited on a goodbye-message.

A barrier that covered only the kinds we happened to think of would silently let a NEW (or rarer)
player pending slip past — and that single gap is a desync. So this gate asserts that for EVERY
player decision kind the engine can raise, the barrier returns a forceful, well-formed directive.
The decision-kind set is `routes.orwell_routes._DECISION_KINDS` / `PendingDecisionView.kind`
(src/ports/GameSession.ts); we pin the full list here so a new engine kind that isn't covered
trips this test.

Mirrors the import/style of `frontend/tests/test_pending_barrier.py`. Roles only — no names.
"""

import importlib

chat_helpers = importlib.import_module("routes.chat_helpers")


# The COMPLETE set of player decision kinds the engine can block on (frontend/routes/orwell_routes.py
# `_DECISION_KINDS`, mirrored by src/ports/GameSession.ts `PendingDecisionView.kind`). Pinned here so
# a new engine decision kind that the barrier does not cover fails this gate.
_DECISION_KINDS = [
    "nominations",
    "veto-decision",
    "comp-intent",
    "comp-round",  # 0006 staged-rounds: the per-round competition approach
    "houseguests-choice",
    "replacement",
    "eviction-vote",
    "tie-break",
    "final-eviction",
    "goodbye-message",
    "finale-statement",
    "finale-answer",
    "juror-question",
    "juror-vote",
    # 0130: the player-evictee's exit interview (posture + optional words) rides the same seam.
    "exit-interview",
    # 0061: the confirmed self-eviction rides the same validated decision seam (and gets the barrier).
    "self-evict",
]


def _barrier_for(kind: str) -> str:
    """Build the barrier for one player pending of `kind` (a player decider, with a prompt)."""
    return chat_helpers._pending_barrier_directive(
        {"kind": kind, "by": {"id": "player", "name": "P"}, "prompt": "do the thing"}
    )


def test_no_pending_returns_none():
    """No player pending → no barrier (the turn is framed exactly as before)."""
    assert chat_helpers._pending_barrier_directive(None) is None


def test_decision_kinds_list_matches_the_engine_set():
    """Keep this gate's pinned list in lockstep with the engine's _DECISION_KINDS. If the engine
    grows a new decision kind, this surfaces the drift here (so the per-kind coverage below is
    actually exhaustive). Read the route module's set without importing the heavy app."""
    import os
    import re

    src = open(
        os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
            "routes",
            "orwell_routes.py",
        ),
        encoding="utf-8",
    ).read()
    block = re.search(r"_DECISION_KINDS\s*=\s*\{([^}]*)\}", src)
    assert block, "could not locate _DECISION_KINDS in routes/orwell_routes.py"
    engine_kinds = set(re.findall(r'"([a-z-]+)"', block.group(1)))
    assert engine_kinds == set(_DECISION_KINDS), (
        "the engine's _DECISION_KINDS drifted from this gate's pinned list "
        f"(engine-only={engine_kinds - set(_DECISION_KINDS)}, "
        f"gate-only={set(_DECISION_KINDS) - engine_kinds}) — update both."
    )

    # Also scan ws_routes.py for its _DECISION_KINDS — three-way lockstep drift gate
    # (the issue #1864 AC demands both transport allowlists stay in sync).
    ws_src = open(
        os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
            "routes",
            "ws_routes.py",
        ),
        encoding="utf-8",
    ).read()
    ws_block = re.search(r"_DECISION_KINDS\s*=\s*\{([^}]*)\}", ws_src)
    assert ws_block, "could not locate _DECISION_KINDS in routes/ws_routes.py"
    ws_kinds = set(re.findall(r'"([a-z-]+)"', ws_block.group(1)))
    assert ws_kinds == set(_DECISION_KINDS), (
        "the ws_routes.py _DECISION_KINDS drifted from the pinned list "
        f"(ws-only={ws_kinds - set(_DECISION_KINDS)}, "
        f"gate-only={set(_DECISION_KINDS) - ws_kinds}) — update both."
    )
    # exit-interview must be present in BOTH transport allowlists (issue #1864).
    assert "exit-interview" in engine_kinds, "exit-interview missing from orwell_routes.py _DECISION_KINDS"
    assert "exit-interview" in ws_kinds, "exit-interview missing from ws_routes.py _DECISION_KINDS"


def test_every_player_decision_kind_gets_a_forceful_barrier():
    """The core gate: NO player pending kind may slip the barrier. For each kind the barrier must
    (i) name the decision/kind, and (ii) forbid advancing past it — the desync language plus an
    explicit time-skip ban (no new week / day / ceremony)."""
    for kind in _DECISION_KINDS:
        out = _barrier_for(kind)
        assert out and isinstance(out, str), f"{kind}: barrier was empty / not a string"
        low = out.lower()

        # (i) it NAMES the decision/kind.
        assert kind in out, f"{kind}: barrier does not name the decision kind"

        # (ii) it FORBIDS advancing past the decision — the desync language is present.
        assert "desync" in low, f"{kind}: barrier missing the 'desync' language"
        assert (
            "not allowed" in low or "forbidden" in low or "not" in low
        ), f"{kind}: barrier does not forbid advancing"
        assert "past this decision" in low or "past it" in low, (
            f"{kind}: barrier does not reference advancing PAST the decision"
        )

        # ...and it explicitly forbids a new week / day / ceremony time-skip (the live bug was the
        # GM skipping into the NEXT WEEK past a pending).
        assert "new day" in low, f"{kind}: barrier does not forbid a new day"
        assert "next week" in low, f"{kind}: barrier does not forbid advancing to the next week"
        assert "ceremony" in low, f"{kind}: barrier does not forbid a new ceremony"

        # ...and it pins the model to taking the player's choice via the engine.
        assert "submitDecision" in out, f"{kind}: barrier does not steer to submitDecision"


def test_barrier_names_the_decider_and_quotes_the_engine_prompt():
    """The barrier identifies WHO must decide and quotes the engine's own instruction, for each
    kind — so the model is pinned to the SPECIFIC pending, never a generic stall."""
    for kind in _DECISION_KINDS:
        out = chat_helpers._pending_barrier_directive(
            {"kind": kind, "by": {"id": "player", "name": "P"}, "prompt": "Make the call now."}
        )
        assert out, f"{kind}: no barrier"
        assert "P" in out, f"{kind}: barrier does not name the decider"
        assert "Make the call now." in out, f"{kind}: barrier does not quote the engine prompt"
