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
