"""Queue C30 — global LLM config (admin-set, hidden from non-admins) + per-profile prefs.

Settings ruling (2026-06-10): logically-global config is global, unchangeable by and hidden
from non-admins; genuine user preferences persist per-profile. Asserts the server resolution
rules and the front-end gating (JS-as-text, like the other UI tests).
"""

import importlib
import os
import tempfile

settings = importlib.import_module("src.settings")

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(rel):
    with open(os.path.join(FRONTEND, rel), encoding="utf-8") as f:
        return f.read()


# --- server: global config inherits down; preferences are per-profile ----------------

def test_keybinds_is_a_per_profile_preference():
    # The S4 fix: keybinds joins the per-user whitelist so a non-admin can save their own.
    assert "keybinds" in settings._PER_USER_KEYS


def test_llm_defaults_are_per_user_resolvable_but_global_by_default():
    # Ruling point 2: a non-admin INHERITS the admin's global default model with no
    # per-user override — get_user_setting falls back to the global setting.
    assert "default_model" in settings._PER_USER_KEYS
    assert "default_endpoint_id" in settings._PER_USER_KEYS


def test_get_user_setting_falls_back_to_global_then_honors_override(monkeypatch, tmp_path):
    # A user with NO pref sees the global value; a per-profile override wins for that user
    # only. Drive the real prefs store at a temp path.
    prefs = importlib.import_module("routes.prefs_routes")
    monkeypatch.setattr(prefs, "PREFS_FILE", str(tmp_path / "user_prefs.json"))
    monkeypatch.setattr(settings, "get_setting", lambda k, d=None: "global-model" if k == "default_model" else d)

    # no override → global
    assert settings.get_user_setting("default_model", owner="bob", default=None) == "global-model"
    # bob personalizes → bob sees his, the global is untouched for everyone else
    prefs._save_for_user("bob", {"default_model": "bob-model"})
    assert settings.get_user_setting("default_model", owner="bob") == "bob-model"
    assert settings.get_user_setting("default_model", owner="alice") == "global-model"


def test_non_per_user_key_is_never_personalized(monkeypatch, tmp_path):
    # A non-whitelisted (global-only) key ignores any per-user value — global config
    # stays global and unchangeable by a regular user.
    prefs = importlib.import_module("routes.prefs_routes")
    monkeypatch.setattr(prefs, "PREFS_FILE", str(tmp_path / "user_prefs.json"))
    monkeypatch.setattr(settings, "get_setting", lambda k, d=None: "GLOBAL" if k == "some_global_only" else d)
    prefs._save_for_user("bob", {"some_global_only": "sneaky"})
    assert settings.get_user_setting("some_global_only", owner="bob") == "GLOBAL"


# --- front-end: LLM config hidden from non-admins; keybinds save honest --------------

def test_services_and_ai_tabs_are_admin_only():
    html = _read("static/index.html")
    import re
    for tab in ("services", "ai"):
        m = re.search(r'<button class="([^"]*)" data-settings-tab="%s"' % tab, html)
        assert m, f"{tab} nav button not found"
        assert "admin-only" in m.group(1), f"{tab} tab must be admin-only (hidden from non-admins)"


def test_non_admin_default_tab_is_not_an_llm_tab():
    js = _read("static/js/settings.js")
    # open() falls non-admins to `appearance` (look/feel) — never the markup-default `services`, and
    # never an LLM/AI tab (J1-14: players want look/feel, not account management or model config).
    assert "window._isAdmin ? 'services' : 'appearance'" in js
    assert "_tabVisible('appearance') ? 'appearance' : 'account'" in js


def test_keybinds_saved_via_per_user_prefs_not_admin_settings():
    js = _read("static/js/settings.js")
    # The S4 fix: saveKeybinds PUTs /api/prefs/keybinds (per-profile), not the
    # admin-only /api/auth/settings POST — and surfaces failure instead of lying.
    assert "/api/prefs/keybinds" in js
    save_block = js[js.index("async function saveKeybinds"): js.index("async function saveKeybinds") + 1000]
    # the actual save must hit prefs, not POST the admin-only settings endpoint
    assert "fetch('/api/prefs/keybinds'" in save_block
    assert "fetch('/api/auth/settings'" not in save_block, "saveKeybinds must not POST admin-only settings"
    assert "Could not save shortcut" in save_block, "must surface a real failure, not toast 'saved'"
