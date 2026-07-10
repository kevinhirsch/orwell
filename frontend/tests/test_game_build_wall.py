"""
0073 — Structural anti-sycophancy wall: game-build boundary is a CI gate.

This test file proves the ORWELL_GAME_BUILD wall unconditionally by forcing the
game build ON internally (via monkeypatch) regardless of the ambient environment.
The gate cannot pass with the wall accidentally disabled.

No Vault types are imported here. No game logic is touched.
"""

import ast
import os
import pathlib
import sys

import pytest

# Force game build ON for every test in this module before any settings import.
# We do this via a module-level env-set so is_feature_enabled() sees it on import.
os.environ.setdefault("ORWELL_GAME_BUILD", "1")


# Import settings AFTER forcing env so the module-level functions see it.
# (game_build_enabled() reads os.getenv each call, so env patching also works
# per-test via monkeypatch — but the module-level set is the belt-and-suspenders
# proof that the wall holds even when the env is ambient.)
from src.settings import (  # noqa: E402 — import after env-set is intentional
    GAME_DROP_SCRIPTS,
    GAME_DROP_SET,
    GAME_KEEP_SET,
    dropped_script_srcs,
    front_end_context_sources,
    game_build_enabled,
    is_feature_enabled,
    strip_dropped_scripts,
)


# ── fixture: pin game build ON for every test ────────────────────────────────

@pytest.fixture(autouse=True)
def pin_game_build(monkeypatch):
    """Every test in this module runs with ORWELL_GAME_BUILD=1 pinned."""
    monkeypatch.setenv("ORWELL_GAME_BUILD", "1")


# ── 1. env-pin sanity ─────────────────────────────────────────────────────────

def test_game_build_is_on():
    """Confirm the fixture has correctly enabled the game build."""
    assert game_build_enabled(), (
        "game_build_enabled() returned False even with ORWELL_GAME_BUILD=1 — "
        "the test fixture is broken."
    )


# ── 2. set purity ─────────────────────────────────────────────────────────────

def test_drop_and_keep_sets_are_disjoint():
    """No feature may appear in both GAME_DROP_SET and GAME_KEEP_SET."""
    overlap = GAME_DROP_SET & GAME_KEEP_SET
    assert overlap == set(), (
        f"Features in both GAME_DROP_SET and GAME_KEEP_SET (must be disjoint): {sorted(overlap)}"
    )


def test_all_drop_set_features_disabled_under_game_build():
    """Every drop-set feature returns is_feature_enabled == False under game build."""
    failing = [name for name in GAME_DROP_SET if is_feature_enabled(name)]
    assert failing == [], (
        f"Drop-set features still enabled under game build: {failing}"
    )


def test_all_keep_set_features_enabled_under_game_build():
    """Every keep-set feature returns is_feature_enabled == True under game build."""
    failing = [name for name in GAME_KEEP_SET if not is_feature_enabled(name)]
    assert failing == [], (
        f"Keep-set features not enabled under game build: {failing}"
    )


def test_drop_set_is_nonempty():
    """Sanity: GAME_DROP_SET must not be accidentally emptied."""
    assert len(GAME_DROP_SET) >= 5, (
        f"GAME_DROP_SET has only {len(GAME_DROP_SET)} entries — looks misconfigured."
    )


# ── 3. context-injection zeroed ───────────────────────────────────────────────

def test_context_injection_all_false_under_game_build():
    """front_end_context_sources() must return all False under game build."""
    sources = front_end_context_sources()
    active = {k: v for k, v in sources.items() if v}
    assert active == {}, (
        f"Context sources are ON under game build (must all be False): {active}"
    )


def test_memory_context_off_under_game_build():
    """memory auto-injection is off under game build."""
    assert not front_end_context_sources().get("memory", False)


def test_rag_context_off_under_game_build():
    """rag auto-injection is off under game build."""
    assert not front_end_context_sources().get("rag", False)


def test_skills_context_off_under_game_build():
    """skills auto-injection is off under game build."""
    assert not front_end_context_sources().get("skills", False)


def test_web_auto_injection_off_under_game_build():
    """web auto-injection is off under game build even though web_search is a keep-set tool.

    The distinction: the agent calls the web_search TOOL deliberately in-fiction (keep-set);
    automatic web-context injection into the system preface must stay OFF (would rival the
    engine's narrator framing).
    """
    assert not front_end_context_sources().get("web", False), (
        "web auto-injection is ON under game build — "
        "this would rival the engine narrator framing (see front_end_context_sources note)."
    )


# ── 4. JS strip completeness ──────────────────────────────────────────────────

def test_all_drop_scripts_in_dropped_srcs():
    """Every GAME_DROP_SCRIPTS entry appears in dropped_script_srcs() under game build."""
    srcs = dropped_script_srcs()
    missing = [s for s in GAME_DROP_SCRIPTS if s not in srcs]
    assert missing == [], (
        f"GAME_DROP_SCRIPTS entries not in dropped_script_srcs(): {missing}"
    )


def test_strip_removes_all_drop_scripts_from_html():
    """strip_dropped_scripts removes every drop-set <script> tag from HTML."""
    lines = ["<html><body>"]
    for script in GAME_DROP_SCRIPTS:
        lines.append(f'    <script src="/static/js/{script}"></script>')
    lines.append('    <script src="/static/js/chat.js"></script>')  # keep-set
    lines.append("</body></html>")
    html = "\n".join(lines)

    result = strip_dropped_scripts(html)

    for script in GAME_DROP_SCRIPTS:
        assert script not in result, (
            f"Drop script {script!r} still present after strip_dropped_scripts()"
        )
    assert "chat.js" in result, "Keep-set script chat.js was incorrectly stripped"


def test_strip_is_noop_for_clean_html():
    """strip_dropped_scripts leaves HTML that contains no drop scripts unchanged."""
    html = '<html><body><script src="/static/js/chat.js"></script></body></html>'
    assert strip_dropped_scripts(html) == html


def test_strip_handles_query_params_in_src():
    """strip_dropped_scripts matches src with a cache-busting query string."""
    script = list(GAME_DROP_SCRIPTS)[0]
    html = f'<html><body>\n    <script src="/static/js/{script}?v=abc123"></script>\n</body></html>'
    result = strip_dropped_scripts(html)
    assert script not in result, (
        f"Drop script {script!r} with query param not stripped"
    )


# ── 5. no Vault import in settings.py ─────────────────────────────────────────

def test_settings_imports_no_vault_type():
    """settings.py must not import any Vault-side type (structural isolation check)."""
    settings_path = pathlib.Path(__file__).parent.parent / "src" / "settings.py"
    src = settings_path.read_text()
    tree = ast.parse(src)

    vault_names = {"VaultStore", "VectorIndex", "SoulProvider", "VaultAdapter"}
    for node in ast.walk(tree):
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            for alias in node.names:
                for vault in vault_names:
                    assert vault not in alias.name, (
                        f"settings.py imports a Vault type ({vault}) from {alias.name} — "
                        "this violates the Vault Wall. The settings module must be mandate-neutral."
                    )


def test_game_build_wall_module_imports_no_vault_type():
    """This test module itself imports no Vault type (sanity check on the gate itself)."""
    this_file = pathlib.Path(__file__)
    tree = ast.parse(this_file.read_text())
    vault_names = {"VaultStore", "VectorIndex", "SoulProvider", "VaultAdapter"}
    for node in ast.walk(tree):
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            for alias in node.names:
                for vault in vault_names:
                    assert vault not in alias.name, (
                        f"test_game_build_wall.py imports a Vault type ({vault}) — "
                        "the gate must be Vault-free."
                    )


# ── 6. wall cannot be bypassed with ORWELL_GAME_BUILD=0 ──────────────────────

def test_gate_is_env_pinned(monkeypatch):
    """The assertions in this file hold even when the env is later set to 0,
    because the autouse fixture re-pins it to 1 before each test.

    This test verifies that the fixture is doing its job: if we temporarily
    set ORWELL_GAME_BUILD=0 and then check, the fixture's env_set takes
    precedence (fixture runs after the manual set in this test context, but
    we verify by checking game_build_enabled() with a fresh override).
    """
    # Temporarily flip to 0, then back to 1 (simulating ambient GAME_BUILD=0)
    monkeypatch.setenv("ORWELL_GAME_BUILD", "0")
    assert not game_build_enabled(), "sanity: ORWELL_GAME_BUILD=0 should disable game build"

    # Re-enable as the fixture would
    monkeypatch.setenv("ORWELL_GAME_BUILD", "1")
    assert game_build_enabled(), "ORWELL_GAME_BUILD=1 must re-enable game build"

    # Confirm that with it on, the drop-set is still walled
    assert not is_feature_enabled("memory"), "memory must be off under game build"
    assert not is_feature_enabled("rag"), "rag must be off under game build"
    assert not is_feature_enabled("skills"), "skills must be off under game build"


# ── 7. tool SELECTION + DISPATCH wall (#1314 — P0) ────────────────────────────
#
# The checks above prove the game build strips scripts/features. This section
# proves the separate, previously-unguarded surface: which TOOLS the agent
# offers the model (selection, in agent_loop.py) and which tools it will
# actually RUN (dispatch, in tool_execution.py). Before this fix, neither path
# intersected the candidate/executed set with the game keep-set — only the
# route-level `disabled_tools` did, and background entrypoints
# (task_scheduler.py, bg_monitor.py) called the loop with `disabled_tools=None`,
# so a background game turn could select AND dispatch workspace tools
# (create_document, manage_notes, manage_calendar, ...) that must never reach
# the in-fiction narrator or its Vault-free surface.

import asyncio  # noqa: E402 — grouped with this section, matches file's late-import style


def _run_async(coro):
    """Run a coroutine on a PRIVATE, throwaway event loop.

    Not `asyncio.run(...)`: its Runner sets the thread's current event loop to
    None on close, which breaks every LATER test in the same (xdist) worker
    process that still uses this suite's prevailing
    `asyncio.get_event_loop().run_until_complete(...)` pattern — swapping this
    file to asyncio.run produced 73 cross-file failures. Not
    `asyncio.get_event_loop()` either: deprecated on newer Python. A fresh loop
    that is never installed as current gives both properties — no deprecation
    warning, no ambient-loop pollution."""
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


class _FakeToolBlock:
    """Minimal stand-in for tool_parsing.ToolBlock — avoids importing the real
    parser just to build a (tool_type, content) pair for dispatch tests."""

    def __init__(self, tool_type, content):
        self.tool_type = tool_type
        self.content = content


def _captured_tools_for_query(monkeypatch, query, *, game_mode=False, disabled_tools=None,
                              relevant_tools=None):
    """Drive stream_agent_loop with the RAG tool index forced OFF (so selection
    falls back to the keyword path — or uses `relevant_tools` when the caller
    provides one, mirroring the task_scheduler path) and capture the tool schema
    array the loop would hand to the model. Mirrors the harness in
    test_a5_tool_manifest_and_machinery_leak.py."""
    from src import agent_loop as al
    import src.tool_index as ti

    monkeypatch.setattr(ti, "get_tool_index", lambda: None)  # force keyword-fallback selection
    monkeypatch.setattr(al, "get_setting", lambda key, default=None: (
        [] if key == "game_tools_enabled" else default))

    captured = {}

    async def fake_stream(candidates, messages, **kwargs):
        captured["tools"] = kwargs.get("tools") or []
        yield "data: [DONE]\n\n"

    monkeypatch.setattr(al, "stream_llm_with_fallback", fake_stream)

    async def drive():
        gen = al.stream_agent_loop(
            "https://api.openai.com/v1/chat/completions",  # API-model path -> schemas are sent
            "gpt-4",
            [{"role": "user", "content": query}],
            disabled_tools=disabled_tools,
            game_mode=game_mode,
            relevant_tools=relevant_tools,
        )
        async for _ in gen:
            pass

    _run_async(drive())
    return {s.get("function", {}).get("name") for s in captured.get("tools", []) if isinstance(s, dict)}


# A query that trips several keyword hints (calendar/event/meeting + note/remind)
# PLUS the keyword-fallback's hardcoded create_document/manage_memory/manage_notes
# union — none of which are in GAME_TOOL_KEEP.
_WORKSPACE_LEANING_QUERY = "remind me to check the calendar meeting notes"


def test_1314_keyword_fallback_selection_capped_to_keep_set_on_game_turn(monkeypatch):
    """(a) Forced keyword fallback (no RAG index) on a game turn, with the exact
    leak vector `disabled_tools=None`, must still only select keep-set /
    opted-in-optional tools."""
    from src.agent_tools import GAME_TOOL_KEEP

    names = _captured_tools_for_query(
        monkeypatch, _WORKSPACE_LEANING_QUERY, game_mode="game", disabled_tools=None,
    )
    leaked = names - GAME_TOOL_KEEP  # nothing opted in -> keep-set is the whole allowance
    assert leaked == set(), f"Non-keep tools leaked into the schema: {sorted(leaked)}"
    for must_drop in ("create_document", "manage_memory", "manage_notes", "manage_calendar"):
        assert must_drop not in names, f"{must_drop} must not be selectable under the game build"


def test_1314_keyword_fallback_capped_even_without_game_mode_flag(monkeypatch):
    """The literal reported leak: a BACKGROUND caller (task_scheduler / bg_monitor)
    never sets `game_mode` at all and passes `disabled_tools=None`. The wall is a
    build-wide floor (mirrors the unconditional route-level check in
    chat_routes.py), not scoped to explicit in-fiction turns, so it must still
    hold here."""
    from src.agent_tools import GAME_TOOL_KEEP

    names = _captured_tools_for_query(
        monkeypatch, _WORKSPACE_LEANING_QUERY, game_mode=False, disabled_tools=None,
    )
    leaked = names - GAME_TOOL_KEEP
    assert leaked == set(), f"Non-keep tools leaked with no game_mode set: {sorted(leaked)}"


def test_1314_full_workspace_build_selection_unaffected(monkeypatch):
    """(c) ORWELL_GAME_BUILD=0 must leave tool SELECTION completely unrestricted —
    the #1314 fix must never leak into a full-workspace build."""
    monkeypatch.setenv("ORWELL_GAME_BUILD", "0")
    names = _captured_tools_for_query(
        monkeypatch, _WORKSPACE_LEANING_QUERY, game_mode=False, disabled_tools=None,
    )
    for must_have in ("create_document", "manage_memory", "manage_notes", "manage_calendar"):
        assert must_have in names, f"{must_have} incorrectly dropped in a full-workspace build"


def test_1314_dispatch_refuses_non_keep_tool_with_disabled_tools_none(monkeypatch):
    """(b) Fail-closed dispatch backstop: even when a caller never builds a
    disabled_tools set at all (the exact bg_monitor/task_scheduler bug), dispatch
    refuses to actually RUN a non-keep tool under the game build — cleanly, not
    with a crash — and never reaches the tool's implementation."""
    from src import tool_execution

    async def _must_not_run(*_a, **_k):
        raise AssertionError("tool implementation must never run — the wall should refuse first")

    monkeypatch.setattr("src.tool_implementations.do_create_document", _must_not_run, raising=False)
    monkeypatch.setattr("src.tool_implementations.do_manage_notes", _must_not_run, raising=False)

    for tool_name, payload in (
        ("create_document", '{"title": "x", "content": "y"}'),
        ("manage_notes", '{"action": "list"}'),
    ):
        desc, result = _run_async(
            tool_execution.execute_tool_block(
                _FakeToolBlock(tool_name, payload),
                disabled_tools=None,
                owner="someone",
            )
        )
        assert result.get("exit_code") == 1, (tool_name, result)
        assert "error" in result, (tool_name, result)
        assert "BLOCKED" in desc, (tool_name, desc)


def test_1314_dispatch_unaffected_in_full_workspace_build(monkeypatch):
    """(c) Dispatch counterpart: ORWELL_GAME_BUILD=0 must never refuse a tool via
    the #1314 wall (any failure must come from the tool's own logic, not the
    game-build gate)."""
    monkeypatch.setenv("ORWELL_GAME_BUILD", "0")
    from src import tool_execution

    desc, result = _run_async(
        tool_execution.execute_tool_block(
            _FakeToolBlock("manage_notes", '{"action": "list"}'),
            disabled_tools=None,
            owner="someone",
        )
    )
    assert "not available in the game build" not in str(result.get("error", "")), result


def test_1314_dispatch_still_honors_explicit_disabled_tools(monkeypatch):
    """Sanity: the new wall is additive — an explicitly disabled tool stays
    blocked (with its original user-facing message) regardless of game build."""
    from src import tool_execution

    desc, result = _run_async(
        tool_execution.execute_tool_block(
            _FakeToolBlock("bash", "echo hi"),
            disabled_tools={"bash"},
            owner="someone",
        )
    )
    assert result.get("exit_code") == 1
    assert "disabled by user" in result.get("error", "")


# ── 7b. CodeRabbit follow-ups on #1329 (both MAJOR) ──────────────────────────


def test_1314_empty_intersection_never_falls_through_to_broad_schemas(monkeypatch):
    """CodeRabbit MAJOR #1: when the game-build cap empties the candidate set
    (every selected tool was non-keep), the later `if _relevant_tools:` schema
    check treats an empty set as falsy and would fall through to the BROAD
    FUNCTION_TOOL_SCHEMAS + mcp_schemas branch — undoing the wall for the turn.
    Drive that exact shape via a caller-provided relevant_tools of ONLY non-keep
    tools (the task_scheduler path): the offered schema set must be the keep-set
    fallback — non-empty, all keep — never the broad manifest."""
    from src.agent_tools import GAME_TOOL_KEEP

    names = _captured_tools_for_query(
        monkeypatch, "hello there", game_mode="game", disabled_tools=None,
        relevant_tools={"create_document", "manage_notes", "manage_calendar"},
    )
    assert names, "schema set must not be empty — the keep-set fallback should be offered"
    leaked = names - GAME_TOOL_KEEP
    assert leaked == set(), f"broad-schema fall-through leaked non-keep tools: {sorted(leaked)}"
    for must_drop in ("create_document", "manage_notes", "manage_calendar"):
        assert must_drop not in names, f"{must_drop} survived the empty-intersection cap"
    # A representative keep tool made it into the fallback offer.
    assert "getGameState" in names


# The four tools DISPATCHED in tool_execution.py but absent from TOOL_TAGS —
# `game_build_disabled_additions()` never evaluates them, so a bare
# `tool not in off` guard waves them through. NB: these vault_* are the
# password-manager vertical, NOT the engine Vault; conceptually GAME_DROP_SET.
_UNCLASSIFIED_DISPATCHABLE = (
    ("tail_serve_output", '{"name": "x"}'),
    ("vault_search", '{"query": "x"}'),
    ("vault_get", '{"id": "x"}'),
    ("vault_unlock", '{"password": "x"}'),
)


def test_1314_dispatch_refuses_unclassified_dispatchable_tools_under_game_build(monkeypatch):
    """CodeRabbit MAJOR #2: tools dispatchable in tool_execution.py but ABSENT
    from TOOL_TAGS must be refused under the game build (fail-closed on the
    unknown class), and their implementations must never run."""
    from src import tool_execution

    async def _must_not_run(*_a, **_k):
        raise AssertionError("unclassified tool implementation must never run under the game build")

    for impl in ("do_tail_serve_output", "do_vault_search", "do_vault_get", "do_vault_unlock"):
        monkeypatch.setattr(f"src.tool_implementations.{impl}", _must_not_run, raising=False)

    for tool_name, payload in _UNCLASSIFIED_DISPATCHABLE:
        desc, result = _run_async(
            tool_execution.execute_tool_block(
                _FakeToolBlock(tool_name, payload),
                disabled_tools=None,
                owner="someone",
            )
        )
        assert result.get("exit_code") == 1, (tool_name, result)
        assert "not available in the game build" in result.get("error", ""), (tool_name, result)
        assert "BLOCKED" in desc, (tool_name, desc)


def test_1314_dispatch_refuses_unknown_tool_under_game_build():
    """The general fail-closed-unknown shape: ANY tool name outside TOOL_TAGS is
    refused under the game build — this class of gap (a dispatch branch added
    without a TOOL_TAGS entry) cannot recur."""
    from src import tool_execution

    desc, result = _run_async(
        tool_execution.execute_tool_block(
            _FakeToolBlock("some_future_unclassified_tool", "{}"),
            disabled_tools=None,
            owner="someone",
        )
    )
    assert result.get("exit_code") == 1, result
    assert "not available in the game build" in result.get("error", ""), result


def test_1314_unclassified_tools_not_wall_refused_in_full_workspace_build(monkeypatch):
    """Full-workspace counterpart: with ORWELL_GAME_BUILD=0 the unclassified
    tools must NOT be refused by the game-build wall (any error must come from
    the tool's own logic)."""
    monkeypatch.setenv("ORWELL_GAME_BUILD", "0")
    from src import tool_execution

    async def _fake_ok(*_a, **_k):
        return {"output": "ok", "exit_code": 0}

    for impl in ("do_tail_serve_output", "do_vault_search", "do_vault_get", "do_vault_unlock"):
        monkeypatch.setattr(f"src.tool_implementations.{impl}", _fake_ok, raising=False)

    for tool_name, payload in _UNCLASSIFIED_DISPATCHABLE:
        desc, result = _run_async(
            tool_execution.execute_tool_block(
                _FakeToolBlock(tool_name, payload),
                disabled_tools=None,
                owner="someone",
            )
        )
        assert "not available in the game build" not in str(result.get("error", "")), (
            tool_name, result,
        )
