"""Lane 7 — game-build trim remainder (2026-06-10 audit: W1, W3, W4, W5, W7, E17).

Roles only — no houseguest/player names. Vertical/tool/command names (vault, sh,
ui_control, …) are app capabilities, not people.

  W1 — ui_control collapses to the curated safe subset under the game build,
       enforced in code at do_ui_control (the single dispatch chokepoint), with a
       client-side belt in chatStream.js.
  W5 — the ui_control manifest the model sees (prompt section + native function
       schema) is game-only: no panel-opening / mode / model / toggle teaching.
  W3 — the Bitwarden/Vaultwarden password-manager vertical joins the drop set
       (server-side unmount, not CSS hiding).
  W4 — the slash-command surface under the game build is the keep-set only,
       refused at dispatch time with a game-framed reply.
  W7 — /backgrounds (dev prototype page) is gone under the game build.
  E17 — search_chats moves KEEP → OPTIONAL (off by default; the GM must recall
       the stores, never the chat).
"""

import asyncio
import os
import re

import pytest
from fastapi import FastAPI
from starlette.testclient import TestClient

from src import settings

FRONTEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _set_game_build(monkeypatch, on: bool):
    monkeypatch.setenv("ORWELL_GAME_BUILD", "1" if on else "0")


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def _read(rel: str) -> str:
    with open(os.path.join(FRONTEND_DIR, rel), encoding="utf-8") as f:
        return f.read()


# ═══════════════════════════════════════════════════════════════════════════
# W1 — ui_control safe subset (server-side, structural)
# ═══════════════════════════════════════════════════════════════════════════

_UNSAFE_CALLS = (
    "set_mode chat",                 # flip the player out of the game loop
    "switch_model some-model",       # swap the narrating LLM mid-scene
    "toggle incognito on",           # strip all game framing (P7/E24)
    "toggle bash on",                # power toggles
    "open_panel email",              # dropped-vertical panels
    "open_email_reply 123 INBOX",    # email plumbing
    "get_toggles",                   # workspace meta-knowledge
)


@pytest.mark.parametrize("call", _UNSAFE_CALLS)
def test_w1_unsafe_ui_control_actions_refused_under_game_build(monkeypatch, call):
    _set_game_build(monkeypatch, True)
    from src.ai_interaction import do_ui_control

    res = _run(do_ui_control(call))
    assert "error" in res, call
    # Refused structurally: no ui_event ever leaves the server for the client to apply.
    assert "ui_event" not in res, call
    # The refusal is game-framed guidance, not a workspace error.
    assert "camera direction" in res["error"].lower()


def test_w1_safe_subset_still_works_under_game_build(monkeypatch):
    _set_game_build(monkeypatch, True)
    from src.ai_interaction import do_ui_control

    hl = _run(do_ui_control("highlight #orwell-status The house"))
    assert hl.get("ui_event") == "highlight" and hl.get("selector") == "#orwell-status"
    clear = _run(do_ui_control("clear_highlight"))
    assert clear.get("ui_event") == "clear_highlight"
    theme = _run(do_ui_control("set_theme dark"))
    assert theme.get("ui_event") == "set_theme" and theme.get("theme_name") == "dark"


def test_w1_full_workspace_keeps_the_inherited_action_space(monkeypatch):
    _set_game_build(monkeypatch, False)
    from src.ai_interaction import do_ui_control

    res = _run(do_ui_control("set_mode agent"))
    assert res.get("ui_event") == "set_mode" and res.get("mode") == "agent"


def test_w1_safe_subset_is_the_curated_set():
    # The allowlist is camera direction + house theming — nothing that can flip
    # mode/model/toggles or open panels.
    assert settings.GAME_UI_CONTROL_SAFE_ACTIONS == frozenset(
        {"highlight", "clear_highlight", "set_theme", "create_theme"}
    )


def test_w1_client_belt_in_chatstream_js():
    """The JS belt: chatStream.handleUIControl drops non-safe events when the body
    carries data-game-build (no stray/replayed event can flip the UI either)."""
    src = _read("static/js/chatStream.js")
    assert "GAME_UI_SAFE_EVENTS" in src
    m = re.search(r"GAME_UI_SAFE_EVENTS\s*=\s*\[(.*?)\]", src, re.S)
    assert m, "safe-event list missing"
    events = set(re.findall(r"'([a-z_]+)'", m.group(1)))
    assert events == {"highlight", "clear_highlight", "set_theme", "create_theme"}
    assert "dataset.gameBuild" in src
    # The guard runs inside handleUIControl, before the event dispatch chain.
    body = src[src.index("export function handleUIControl"):]
    assert body.index("GAME_UI_SAFE_EVENTS.indexOf") < body.index("uiEvent === 'toggle'")


# ═══════════════════════════════════════════════════════════════════════════
# W5 — the game-only ui_control manifest (prompt section + native schema)
# ═══════════════════════════════════════════════════════════════════════════

_PANEL_TEACHING = ("open_panel", "email", "gallery", "cookbook", "documents",
                   "set_mode", "switch_model", "incognito", "open_email_reply")


def test_w5_builtin_override_injects_game_manifest(monkeypatch):
    _set_game_build(monkeypatch, True)
    # Even with a user-saved override on disk, the game manifest wins (structural,
    # not user-optional) — and it is injected on the READ path only, never persisted.
    monkeypatch.setattr(
        settings, "load_settings",
        lambda: {"builtin_tool_overrides": {"ui_control": "open all the panels",
                                            "bash": "user text"}},
    )
    ov = settings.get_setting("builtin_tool_overrides", {})
    assert ov["ui_control"] == settings.GAME_UI_CONTROL_SECTION
    assert ov["bash"] == "user text"          # other overrides untouched
    # The game manifest teaches only the safe subset — none of the inherited
    # workspace levers/verticals appear even as words.
    low = settings.GAME_UI_CONTROL_SECTION.lower()
    for verboten in _PANEL_TEACHING:
        assert verboten not in low, verboten
    assert "do not try to switch modes" in low
    # The section keeps the one-liner shape the prompt assembler classifies on.
    assert settings.GAME_UI_CONTROL_SECTION.startswith("- ```ui_control``` —")


def test_w5_full_workspace_overrides_untouched(monkeypatch):
    _set_game_build(monkeypatch, False)
    monkeypatch.setattr(
        settings, "load_settings",
        lambda: {"builtin_tool_overrides": {"ui_control": "user text"}},
    )
    ov = settings.get_setting("builtin_tool_overrides", {})
    assert ov == {"ui_control": "user text"}


def test_w5_agent_prompt_section_is_the_game_manifest(monkeypatch):
    """End-to-end through the real prompt seam: agent_loop's effective section text
    for ui_control is the game-only manifest under the game build."""
    _set_game_build(monkeypatch, True)
    monkeypatch.setattr(settings, "load_settings", lambda: {})
    from src.agent_loop import TOOL_SECTIONS, _section_text

    eff = _section_text("ui_control", TOOL_SECTIONS["ui_control"])
    assert eff == settings.GAME_UI_CONTROL_SECTION
    for verboten in ("open_panel", "gallery", "cookbook", "open_email_reply"):
        assert verboten not in eff


def test_w5_game_schema_advertises_only_the_safe_subset():
    from src import tool_schemas

    base = next(s for s in tool_schemas.FUNCTION_TOOL_SCHEMAS
                if s.get("function", {}).get("name") == "ui_control")
    game = tool_schemas.game_ui_control_schema(base)
    fn = game["function"]
    assert set(fn["parameters"]["properties"]["action"]["enum"]) == set(
        settings.GAME_UI_CONTROL_SAFE_ACTIONS
    )
    desc = fn["description"].lower()
    for verboten in _PANEL_TEACHING:
        assert verboten not in desc, verboten
    # Email plumbing args are gone from the manifest.
    for dead in ("uid", "folder", "mode"):
        assert dead not in fn["parameters"]["properties"]
    # And under the (default-on) game build the LIVE schema list carries it.
    if settings.game_build_enabled():
        assert base["function"]["parameters"]["properties"]["action"]["enum"] == \
            fn["parameters"]["properties"]["action"]["enum"]


def test_w5_highlight_function_call_converts_with_its_selector():
    from src.tool_schemas import function_call_to_tool_block

    blk = function_call_to_tool_block(
        "ui_control", '{"action": "highlight", "name": "#orwell-status", "value": "The house"}'
    )
    assert blk and blk.content == "highlight #orwell-status The house"


# ═══════════════════════════════════════════════════════════════════════════
# W3 — the password-manager vault vertical joins the drop set
# ═══════════════════════════════════════════════════════════════════════════

def test_w3_vault_in_drop_set_and_gated(monkeypatch):
    assert "vault" in settings.GAME_DROP_SET
    _set_game_build(monkeypatch, True)
    assert settings.is_feature_enabled("vault") is False
    _set_game_build(monkeypatch, False)
    assert settings.is_feature_enabled("vault", features={}) is True


def test_w3_vault_router_unmounted_under_game_build(monkeypatch):
    """The REAL vault router through the real mount_optional gate: gone server-side
    (404 even for an admin) under the game build; back in full-workspace mode."""
    from routes.vault_routes import setup_vault_routes

    _set_game_build(monkeypatch, True)
    app = FastAPI()
    assert settings.mount_optional(app, "vault", setup_vault_routes()) is False
    client = TestClient(app)
    admin_headers = {"Authorization": "Bearer admin", "Cookie": "session=admin"}
    assert client.get("/api/vault/config", headers=admin_headers).status_code == 404

    _set_game_build(monkeypatch, False)
    app2 = FastAPI()
    assert settings.mount_optional(app2, "vault", setup_vault_routes()) is True
    # Flatten the route tree: newer FastAPI keeps an included router as a nested wrapper in
    # app.routes (no top-level `.path`) rather than copying its routes up — so collect paths
    # recursively, version-robustly (the loose `fastapi` pin lets CI drift ahead of the lock).
    paths = set()
    stack = list(app2.routes)
    while stack:
        r = stack.pop()
        p = getattr(r, "path", None)
        if isinstance(p, str):
            paths.add(p)
        sub = getattr(r, "routes", None)
        if sub:
            stack.extend(sub)
    assert any(p.startswith("/api/vault") for p in paths)


def test_w3_app_wires_vault_through_the_gate():
    app_src = _read("app.py")
    assert 'mount_optional(app, "vault", setup_vault_routes())' in app_src
    assert "app.include_router(setup_vault_routes())" not in app_src


# ═══════════════════════════════════════════════════════════════════════════
# W7 — the /backgrounds dev prototype page is removed
# ═══════════════════════════════════════════════════════════════════════════

def test_w7_backgrounds_route_removed():
    """W7: the unauthenticated dev sandbox page does not ship — the route is gone
    (its static/backgrounds.html was never vendored, so the route only 500'd)."""
    app_src = _read("app.py")
    assert '@app.get("/backgrounds")' not in app_src
    assert "serve_backgrounds" not in app_src
    assert not os.path.exists(os.path.join(FRONTEND_DIR, "static", "backgrounds.html"))


# ═══════════════════════════════════════════════════════════════════════════
# W4 — the slash-command keep-set
# ═══════════════════════════════════════════════════════════════════════════

def _slash_src() -> str:
    return _read("static/js/slashCommands.js")


def _keep_set() -> set:
    m = re.search(r"GAME_SLASH_KEEP = new Set\(\[(.*?)\]\)", _slash_src(), re.S)
    assert m, "GAME_SLASH_KEEP missing from slashCommands.js"
    return set(re.findall(r"'([A-Za-z0-9-]+)'", m.group(1)))


# Every command the audit names as inherited bleed, plus the rest of the dropped
# verticals' entry points — none may be in the keep-set.
_W4_FORBIDDEN = {
    "sh", "setup", "toggle", "plan", "workspace",                # shell/keys/toggles
    "memory", "rag", "todo", "event", "note",                    # dropped stores
    "email", "gallery", "cookbook", "notes", "tasks", "brain",   # dropped verticals
    "library", "research", "compare", "open",
    "demo", "tour-compare", "tour-cookbook", "tour-research",    # the /tour-* set
    "tour-library", "tour-theme", "tour-settings", "tour-gallery",
    "tour-brain", "tour-task-1", "tour-task-2",
    "models", "ping", "probe", "stats",                          # model/endpoint meta
    "compact", "search", "prompt",                               # transcript/workspace
}


def test_w4_keep_set_is_the_game_surface_only():
    keep = _keep_set()
    assert not (keep & _W4_FORBIDDEN), keep & _W4_FORBIDDEN
    # The game's own surface survives: sessions, theme, settings, help, search-in-chats.
    for kept in ("chats", "theme", "settings", "help", "shortcuts", "find"):
        assert kept in keep, kept


def test_w4_keep_set_entries_are_real_commands():
    """Drift guard: every keep-set entry must be a defined COMMANDS key, so a renamed
    command can't silently leave a dead allowlist entry."""
    src = _slash_src()
    for name in _keep_set():
        pat = rf"\n  (?:'{re.escape(name)}'|{re.escape(name)}):\s*\{{"
        assert re.search(pat, src), f"keep-set entry {name!r} is not a COMMANDS key"


def test_w4_dispatch_time_gate_with_game_framed_reply():
    src = _slash_src()
    body = src[src.index("async function handleSlashCommand"):]
    gate = body.index("isGameSlashAllowed(_canonical)")
    # The gate runs before any handler dispatch (direct, legacy, or sub).
    assert gate < body.index("await subDef.handler")
    assert gate < body.index("await cmdDef.handler")
    # Legacy aliases (e.g. /bash → toggle) resolve through the same gate.
    assert "LEGACY_ALIASES[rawCmd] ? LEGACY_ALIASES[rawCmd].parent" in body
    # The refusal is game-framed, not a bare error.
    assert "part of the broadcast" in body


def test_w4_menu_help_and_suggestions_filtered():
    src = _slash_src()
    # /help lists the keep-set only.
    help_body = src[src.index("async function _cmdHelp"):src.index("const COMMANDS")]
    assert "isGameSlashAllowed(name)" in help_body
    # Fuzzy "did you mean" never suggests a refused command.
    fuzzy = src[src.index("function _fuzzyMatch"):src.index("function _isCmd")]
    assert "isGameSlashAllowed" in fuzzy
    # The autocomplete popup (the slash menu) renders the keep-set only.
    ac = _read("static/js/slashAutocomplete.js")
    assert "isGameSlashAllowed" in ac
    flatten = ac[ac.index("function _flatten"):ac.index("function _scoreMatch")]
    assert flatten.count("isGameSlashAllowed") >= 2  # top-level + promoted aliases


# ═══════════════════════════════════════════════════════════════════════════
# E17 — search_chats: KEEP → OPTIONAL (off by default)
# ═══════════════════════════════════════════════════════════════════════════

def test_e17_search_chats_is_optional_not_keep():
    from src.agent_tools import (
        GAME_TOOL_KEEP, GAME_TOOL_OPTIONAL, game_build_disabled_additions,
    )

    assert "search_chats" not in GAME_TOOL_KEEP
    assert "search_chats" in GAME_TOOL_OPTIONAL
    # Off by default under the game build (the GM recalls the stores, not the chat) …
    assert "search_chats" in game_build_disabled_additions([])
    # … and the explicit opt-in still works.
    assert "search_chats" not in game_build_disabled_additions(["search_chats"])
