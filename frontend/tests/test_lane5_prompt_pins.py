"""Lane 5 (audit 2026-06-10) — FE-side pins for the prompt-integrity findings.

P4: game levers are silent production machinery — the generic `ask_user` description used
to invite "Record this interaction?" permission prompts; it is now explicitly carved AWAY from
the engine's pending BINDING decisions on game turns (the player's own decision card is the
single authority there — PROMPT-9/PROMPT2-1 audit fix, mirrored engine-side in
`BASE_GAME_MASTER_PROMPT` + `GAME_AGENT_PREAMBLE`, pinned in `tests/unit/leverManifest.test.ts`).

P6: `runCompetition` PREVIEWS the weekly loop's already-decided winner; only `advanceGame`
commits the beat. The FE schema must say so, or a prompt-obedient model can announce a
winner that is never committed.
"""

import importlib

# tool_implementations first: it pulls the agent_tools/tool_schemas chain in a
# cycle-safe order (tool_schemas imports agent_tools at module level) — see test_c13.
importlib.import_module("src.tool_implementations")
tool_schemas = importlib.import_module("src.tool_schemas")


def _schema(name: str) -> dict:
    for t in tool_schemas.FUNCTION_TOOL_SCHEMAS:
        if isinstance(t, dict) and t.get("type") == "function" and t["function"]["name"] == name:
            return t["function"]
    raise AssertionError(f"schema {name} not found")


def test_p4_ask_user_is_scoped_away_from_lever_permission_prompts():
    desc = _schema("ask_user")["description"]
    assert "silent production machinery" in desc
    assert "NEVER use ask_user to ask permission to call a game tool" in desc
    assert "NEVER use it to present the engine's pending" in desc
    assert "decision card already presents those" in desc


def test_p6_run_competition_schema_states_preview_semantics():
    desc = _schema("runCompetition")["description"]
    assert "PREVIEW" in desc
    assert "ALREADY-DECIDED" in desc
    assert "advanceGame" in desc
    # The old wording invited the model to treat it as the resolver.
    assert "Ask the engine to RESOLVE" not in desc
