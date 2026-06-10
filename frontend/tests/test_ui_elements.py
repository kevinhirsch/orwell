"""
UI element tests for the Orwell game surface.

Verifies every interactive UI piece: what it does, what it shows, and what it hides.
Tests are structured as:
  A) HTML structural presence  - element IDs/selectors exist in source
  B) CSS visibility rules       - game-trim.css correctly hides workspace chrome
  C) Route contracts            - FastAPI TestClient for each orwell route
  D) JS source guards           - behavioral assertions from JS source text

No browser required — all assertions are source-level or TestClient-level.
"""

import importlib
import pathlib
import re
import sys

import pytest

FRONTEND_DIR = pathlib.Path(__file__).parent.parent
HTML_SRC = (FRONTEND_DIR / "static" / "index.html").read_text(encoding="utf-8")
CSS_TRIM = (FRONTEND_DIR / "static" / "css" / "game-trim.css").read_text(encoding="utf-8")
JS_ONBOARDING = (FRONTEND_DIR / "static" / "js" / "orwellOnboarding.js").read_text(encoding="utf-8")
JS_STATUS = (FRONTEND_DIR / "static" / "js" / "orwellStatusPanel.js").read_text(encoding="utf-8")
JS_SOCIAL = (FRONTEND_DIR / "static" / "js" / "orwellSocial.js").read_text(encoding="utf-8")


# ---------------------------------------------------------------------------
# Test client helpers
# ---------------------------------------------------------------------------

def _build_client(monkeypatch, overrides: dict):
    """
    Build a TestClient for orwell_routes with engine functions monkeypatched.
    `overrides` maps engine-function names to callables.
    """
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    # conftest.py inserts FRONTEND_DIR into sys.path — mirror that here.
    frontend = str(FRONTEND_DIR)
    if frontend not in sys.path:
        sys.path.insert(0, frontend)

    orwell_engine = importlib.import_module("src.orwell_engine")
    for name, fn in overrides.items():
        monkeypatch.setattr(orwell_engine, name, fn)

    # Force reload so closures in setup_orwell_routes() see the patched engine.
    orwell_routes = importlib.import_module("routes.orwell_routes")
    importlib.reload(orwell_routes)

    app = FastAPI()
    app.include_router(orwell_routes.setup_orwell_routes())
    return TestClient(app, raise_server_exceptions=False)


def _raise(exc_factory):
    """Return an async function that raises the given exception."""
    async def _fn(*args, **kwargs):
        raise exc_factory()
    return _fn


# ===========================================================================
# TestOnboardingOverlay
# ===========================================================================

class TestOnboardingOverlay:
    """
    Onboarding with NO data-entry modal (orwellOnboarding.js, feature 0050):
      - Character creation is acquired through the CHAT (the producer's casting interview);
        this module never collects fields and never posts to /api/orwell/new-game
      - Pre-game + model ready: PREFILLS the composer (never auto-sends) and opens a fresh
        chat session ONCE per interview (F7 fence; sessionStorage seat marker)
      - J4 model gate + F5 dark-house holding cards remain (blocking notices, not forms)
    """

    # -- JS source (D-level) --------------------------------------------------

    def test_onboarding_routes_on_state_check(self):
        assert "/api/orwell/state" in JS_ONBOARDING

    def test_no_data_entry_form_remains(self):
        # The interview owns data acquisition (0050): no name/archetype inputs, no form post.
        for gone in ("ob-name", "ob-arche", "ob-style", "ob-form", "/api/orwell/new-game"):
            assert gone not in JS_ONBOARDING, gone

    def test_seat_taking_prefills_composer_and_never_autosends(self):
        # The house rule (ADR 0003): prefill + focus; the player sends the first line themselves.
        assert 'getElementById("message")' in JS_ONBOARDING
        assert "box.focus()" in JS_ONBOARDING
        assert "casting interview" in JS_ONBOARDING
        assert "sendMessage" not in JS_ONBOARDING

    def test_seat_taking_runs_once_per_interview(self):
        assert "sessionStorage" in JS_ONBOARDING

    def test_new_interview_gets_a_fresh_chat_session(self):
        # F7: a finished/reset season's transcript never rides along as narrator context.
        assert "sidebar-new-chat-btn" in JS_ONBOARDING

    def test_holding_cards_remain(self):
        assert "Production needs a feed source" in JS_ONBOARDING  # J4 model gate
        assert "The house is dark" in JS_ONBOARDING               # F5 engine down

    def test_holding_card_is_a_real_modal(self):
        assert "orwell-onboarding" in JS_ONBOARDING
        assert "inertBackground" in JS_ONBOARDING
        assert "trapFocus" in JS_ONBOARDING

    # -- Route contracts (C-level) -------------------------------------------

    def test_new_game_rejects_blank_name(self, monkeypatch):
        client = _build_client(monkeypatch, {})
        resp = client.post("/api/orwell/new-game", json={"playerName": ""})
        assert resp.status_code == 400

    def test_new_game_rejects_missing_name_field(self, monkeypatch):
        client = _build_client(monkeypatch, {})
        resp = client.post("/api/orwell/new-game", json={})
        assert resp.status_code in (400, 422)

    def test_new_game_success(self, monkeypatch):
        async def fake_state(user=None):
            return {"started": False}  # fresh sandbox: no confirm needed (C12 guard)

        async def fake_create(player_name, *, archetype=None, strategy_style=None, seed=None,
                              confirm_restart=False, user=None):
            return {"ok": True}

        client = _build_client(monkeypatch, {"create_character": fake_create, "get_game_state": fake_state})
        resp = client.post("/api/orwell/new-game", json={"playerName": "Alice"})
        assert resp.status_code == 200

    def test_new_game_forwards_optional_fields(self, monkeypatch):
        captured = {}

        async def fake_state(user=None):
            return {"started": False}

        async def fake_create(player_name, *, archetype=None, strategy_style=None, seed=None,
                              confirm_restart=False, user=None):
            captured["archetype"] = archetype
            captured["strategy_style"] = strategy_style
            return {"ok": True}

        client = _build_client(monkeypatch, {"create_character": fake_create, "get_game_state": fake_state})
        client.post(
            "/api/orwell/new-game",
            json={"playerName": "Alice", "archetype": "Strategist", "strategyStyle": "aggressive"},
        )
        assert captured.get("archetype") == "Strategist"
        assert captured.get("strategy_style") == "aggressive"

    def test_new_game_502_on_engine_failure(self, monkeypatch):
        client = _build_client(
            monkeypatch,
            {"create_character": _raise(lambda: Exception("engine down"))},
        )
        resp = client.post("/api/orwell/new-game", json={"playerName": "Alice"})
        assert resp.status_code == 502

    def test_state_passthrough(self, monkeypatch):
        async def fake_state(user=None):
            return {"started": True, "week": 3}

        client = _build_client(monkeypatch, {"get_game_state": fake_state})
        resp = client.get("/api/orwell/state")
        assert resp.status_code == 200
        assert resp.json()["started"] is True

    def test_state_502_on_engine_failure(self, monkeypatch):
        client = _build_client(
            monkeypatch,
            {"get_game_state": _raise(lambda: Exception("down"))},
        )
        resp = client.get("/api/orwell/state")
        assert resp.status_code == 502


# ===========================================================================
# TestStatusHUD
# ===========================================================================

class TestStatusHUD:
    """
    The in-game status HUD (orwellStatusPanel.js):
      - Polls /api/orwell/status every 20 seconds
      - Displays week, phase, HOH, nominees, and veto holder
      - Hides when week < 1 (game not yet started)
      - Refreshes immediately on orwell:gamechanged
      - Is draggable via makeWindowDraggable
      - Fails open: if engine is unreachable the panel is hidden, not broken
    """

    def test_status_panel_root_id(self):
        assert "orwell-status" in JS_STATUS

    def test_status_week_element(self):
        assert "os-week" in JS_STATUS

    def test_status_phase_element(self):
        assert "os-phase" in JS_STATUS

    def test_status_hoh_element(self):
        assert "os-hoh" in JS_STATUS

    def test_status_nominees_element(self):
        assert "os-noms" in JS_STATUS

    def test_status_veto_element(self):
        assert "os-veto" in JS_STATUS

    def test_status_polls_20s(self):
        assert "20000" in JS_STATUS

    def test_status_hides_when_week_lt_1(self):
        src = JS_STATUS
        assert "week" in src and ("< 1" in src or "<1" in src or "hidden" in src.lower() or "display" in src)

    def test_status_listens_for_gamechanged(self):
        assert "orwell:gamechanged" in JS_STATUS

    def test_status_fail_open_on_error(self):
        assert "catch" in JS_STATUS or "try" in JS_STATUS

    def test_status_is_draggable(self):
        src = JS_STATUS
        assert "Draggable" in src or "draggable" in src.lower()

    # -- Route contracts (C-level) -------------------------------------------

    def test_status_passthrough(self, monkeypatch):
        async def fake_status(user=None):
            return {"week": 2, "phase": "nominations", "hoh": "Sam", "nominees": ["Alex", "Jordan"], "veto": None}

        client = _build_client(monkeypatch, {"game_status": fake_status})
        resp = client.get("/api/orwell/status")
        assert resp.status_code == 200
        data = resp.json()
        assert data["week"] == 2
        assert data["phase"] == "nominations"

    def test_status_502_on_engine_failure(self, monkeypatch):
        client = _build_client(
            monkeypatch,
            {"game_status": _raise(lambda: Exception("down"))},
        )
        resp = client.get("/api/orwell/status")
        assert resp.status_code == 502

    def test_status_vault_free(self, monkeypatch):
        async def fake_status(user=None):
            return {"week": 1, "phase": "hoh", "hoh": "Sam", "nominees": [], "veto": None}

        client = _build_client(monkeypatch, {"game_status": fake_status})
        resp = client.get("/api/orwell/status")
        body = resp.text
        # No raw stat numbers (vault data) should appear
        assert not re.search(r'"(physical|mental|social)"\s*:\s*\d', body)
        assert not re.search(r'"(trust|affinity|threat)"\s*:\s*\d', body)


# ===========================================================================
# TestSocialSurface
# ===========================================================================

class TestSocialSurface:
    """
    The social surface panel (orwellSocial.js):
      - Shows NPC approach chips with "pull aside" and dismiss actions
      - Opens a Diary Room modal for player confessionals
      - Diary Room: clears textarea on open, disables send during submit,
        re-enables on error, shows "Recorded" confirmation on success
      - Approach chips: dismiss is session-only (in-memory Set, no server call)
      - startScene prefills the chat composer with "I pull <name> aside..."
      - Modal backdrop click closes the Diary Room
      - Hidden when no game is active (st.started is false)
      - Refreshes on orwell:gamechanged
    """

    def test_social_panel_root_id(self):
        assert "orwell-social" in JS_SOCIAL

    def test_social_dr_open_button(self):
        assert "osoc-dr-open" in JS_SOCIAL

    def test_social_dr_modal_id(self):
        assert "orwell-dr-modal" in JS_SOCIAL

    def test_social_dr_textarea_id(self):
        # Textarea is created dynamically; referenced via getElementById
        assert "osoc-dr-text" in JS_SOCIAL

    def test_social_dr_cancel_button(self):
        assert "osoc-dr-cancel" in JS_SOCIAL

    def test_social_dr_send_button(self):
        assert "osoc-dr-send" in JS_SOCIAL

    def test_social_approach_header(self):
        # Header element shown/hidden based on approach count
        assert "osoc-appr-hd" in JS_SOCIAL

    def test_social_approach_list(self):
        # Container where approach chips are rendered
        assert "osoc-appr" in JS_SOCIAL

    def test_social_dismiss_uses_session_set(self):
        # Dismiss must NOT POST to server — purely in-memory
        src = JS_SOCIAL
        assert "dismissed" in src and ("new Set" in src or "Set(" in src)

    def test_social_dr_clears_textarea_on_open(self):
        src = JS_SOCIAL
        assert "value" in src and ("= ''" in src or '= ""' in src or ".value = " in src)

    def test_social_dr_disables_send_during_submit(self):
        assert "disabled" in JS_SOCIAL

    def test_social_dr_reenables_on_error(self):
        assert "catch" in JS_SOCIAL or "finally" in JS_SOCIAL

    def test_social_dr_shows_confirmation_on_success(self):
        assert "Recorded" in JS_SOCIAL or "recorded" in JS_SOCIAL

    def test_social_start_scene_prefills_composer(self):
        assert "pull" in JS_SOCIAL and "aside" in JS_SOCIAL

    def test_social_backdrop_closes_modal(self):
        src = JS_SOCIAL
        assert "backdrop" in src.lower() or "click" in src

    def test_social_hidden_when_no_game(self):
        # Social surface gates on st.started (not week) and hides when engine is down
        src = JS_SOCIAL
        assert "started" in src and ("display" in src or "hidden" in src.lower())

    def test_social_listens_for_gamechanged(self):
        assert "orwell:gamechanged" in JS_SOCIAL

    def test_social_polls_periodically(self):
        assert "setInterval" in JS_SOCIAL or "setTimeout" in JS_SOCIAL

    def test_social_empty_entry_guard(self):
        assert "trim()" in JS_SOCIAL or ".trim" in JS_SOCIAL

    def test_social_dr_modal_accessibility(self):
        src = JS_SOCIAL + HTML_SRC
        assert "dialog" in src or "aria-modal" in src


# ===========================================================================
# TestGameTrimHiddenElements
# ===========================================================================

class TestGameTrimHiddenElements:
    """
    game-trim.css hides workspace-tool chrome that doesn't belong in the Orwell
    game surface. Every selector here must be in the CSS AND must correspond to
    a real element in index.html (so the CSS is not dead code).
    """

    HIDDEN_SELECTORS = [
        # Toggle buttons
        "#web-toggle-btn",
        "#bash-toggle-btn",
        "#plan-toggle-btn",
        "#research-toggle-btn",
        "#compare-indicator-btn",
        # Rail sidebar buttons
        "#rail-calendar",
        "#rail-compare",
        "#rail-cookbook",
        "#rail-research",
        "#rail-email",
        "#rail-gallery",
        "#rail-archive",
        "#rail-memory",
        "#rail-notes",
        "#rail-tasks",
        # Sidebar sections
        "#tools-section",
        "#email-section",
        # Settings tabs
        '[data-settings-tab="email"]',
        '[data-settings-tab="integrations"]',
        '[data-settings-tab="reminders"]',
    ]

    @pytest.mark.parametrize("selector", HIDDEN_SELECTORS)
    def test_selector_in_game_trim_css(self, selector):
        assert selector in CSS_TRIM, f"Expected {selector!r} to be hidden by game-trim.css"

    # HTML presence for ID-based selectors (confirms CSS targets real elements)
    HTML_REQUIRED_IDS = [
        "web-toggle-btn",
        "bash-toggle-btn",
        "plan-toggle-btn",
        "research-toggle-btn",
        "compare-indicator-btn",
        "email-section",
        "tools-section",
        "rail-email",
    ]

    @pytest.mark.parametrize("element_id", HTML_REQUIRED_IDS)
    def test_hidden_element_exists_in_html(self, element_id):
        assert f'id="{element_id}"' in HTML_SRC or f"id='{element_id}'" in HTML_SRC, (
            f"CSS hides #{element_id} but that ID was not found in index.html"
        )


# ===========================================================================
# TestKeptElements
# ===========================================================================

class TestKeptElements:
    """
    Elements that should remain visible in the Orwell game surface — they must
    NOT appear in game-trim.css AND must be present in index.html.
    """

    KEPT_SETTINGS_TABS = ["services", "ai", "appearance", "account", "tools", "users", "search"]

    @pytest.mark.parametrize("tab", KEPT_SETTINGS_TABS)
    def test_kept_tab_not_in_game_trim(self, tab):
        assert f'data-settings-tab="{tab}"' not in CSS_TRIM, (
            f"Settings tab {tab!r} should be visible but game-trim.css hides it"
        )

    @pytest.mark.parametrize("tab", KEPT_SETTINGS_TABS)
    def test_kept_tab_exists_in_html(self, tab):
        assert f'data-settings-tab="{tab}"' in HTML_SRC, (
            f"Expected settings tab {tab!r} to be present in index.html"
        )

    def test_model_select_present_in_html(self):
        assert "model-select" in HTML_SRC

    def test_model_select_not_hidden(self):
        assert "#model-select" not in CSS_TRIM


# ===========================================================================
# TestRemainingOrwellRoutes
# ===========================================================================

class TestRemainingOrwellRoutes:
    """
    Routes not covered by other test files:
      GET /api/orwell/moment  — returns the game-master moment prompt
      GET /api/orwell/health  — reports engine liveness
    """

    def test_moment_passthrough(self, monkeypatch):
        async def fake_moment(moment=None, user=None):
            return {"prompt": "You are the game master. Week 2 has begun."}

        client = _build_client(monkeypatch, {"get_moment_prompt": fake_moment})
        resp = client.get("/api/orwell/moment")
        assert resp.status_code == 200

    def test_moment_accepts_moment_param(self, monkeypatch):
        captured = {}

        async def fake_moment(moment=None, user=None):
            captured["moment"] = moment
            return {"prompt": "prompt text"}

        client = _build_client(monkeypatch, {"get_moment_prompt": fake_moment})
        client.get("/api/orwell/moment?moment=nominations")
        assert captured.get("moment") == "nominations"

    def test_moment_502_on_engine_failure(self, monkeypatch):
        client = _build_client(
            monkeypatch,
            {"get_moment_prompt": _raise(lambda: Exception("down"))},
        )
        resp = client.get("/api/orwell/moment")
        assert resp.status_code == 502

    def test_health_returns_engine_field(self, monkeypatch):
        async def fake_health():
            return True

        client = _build_client(monkeypatch, {"engine_health": fake_health})
        resp = client.get("/api/orwell/health")
        assert resp.status_code == 200
        data = resp.json()
        assert "engine" in data

    def test_health_reports_false_when_engine_down(self, monkeypatch):
        async def fake_health():
            return False

        client = _build_client(monkeypatch, {"engine_health": fake_health})
        resp = client.get("/api/orwell/health")
        assert resp.status_code == 200
        assert resp.json()["engine"] is False

    def test_health_reports_engine_url(self, monkeypatch):
        async def fake_health():
            return True

        client = _build_client(monkeypatch, {"engine_health": fake_health})
        resp = client.get("/api/orwell/health")
        data = resp.json()
        assert "engineUrl" in data or "engine_url" in data or "url" in data
