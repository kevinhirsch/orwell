"""#764 — Liquid Glass login over an admin-configurable animated background.

Pins, in three layers:
  1. The login page is a GLASS PANEL with a sans font + reduced-motion fallback.
  2. The admin login-background control + its full setting plumbing.
  3. The pre-auth read is COSMETIC-ONLY, validated/clamped, default=gradient
     (the security-critical contract for a pre-auth surface).

The live FE/engine can't run in this gate, so behaviour is pinned by reading the
static assets + unit-testing the cosmetic config helper directly.
"""
import os
import importlib

FE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(rel):
    with open(os.path.join(FE, rel), encoding="utf-8") as fh:
        return fh.read()


# ─────────────────────────────────────────────────────────────────────────────
# 1. The login page is a glass panel (kit material) with sans font + a11y fallback
# ─────────────────────────────────────────────────────────────────────────────

def test_login_panel_is_glass():
    html = _read("static/login.html")
    # The card carries the kit glass material: a backdrop blur + the soft luminous
    # hairline rgba(255,255,255,0.14) edge (consistent with OrwellWindow/Notice).
    assert "backdrop-filter: blur(" in html, "the login .card must be a backdrop-blur glass panel"
    assert "rgba(255, 255, 255, 0.14)" in html, "the glass panel needs the soft luminous hairline edge"


def test_login_loads_the_background_module():
    html = _read("static/login.html")
    assert "/static/js/login_bg.js" in html, "login.html must load the login_bg.js background module"


def test_login_uses_canonical_sans_font_not_mono():
    html = _read("static/login.html")
    # The #696 canonical UI sans must be the page font...
    assert "-apple-system, BlinkMacSystemFont" in html
    assert "--login-font" in html
    # ...and nothing on the page may fall back to mono (the page missed the font work).
    assert "Fira Code" not in html, "login.html must not use Fira Code / monospace anywhere"
    assert "monospace" not in html, "login.html must not fall back to monospace anywhere"


def test_login_reduced_motion_freezes_animation():
    html = _read("static/login.html")
    assert "prefers-reduced-motion: reduce" in html, "must honour reduced-motion"
    # The mesh animation is killed under reduced motion (belt-and-braces CSS).
    assert "animation: none" in html


def test_login_bg_module_has_all_four_sources_and_reduced_motion():
    js = _read("static/js/login_bg.js")
    for src in ("gradient", "photo", "particles", "bundled"):
        assert f"'{src}'" in js, f"login_bg.js must implement the '{src}' source"
    assert "prefers-reduced-motion" in js, "login_bg.js must check reduced-motion"
    # It reads the cosmetic-only public GET (never anything sensitive).
    assert "/api/auth/login-background" in js


def test_login_cta_composes_the_element_kit_button():
    html = _read("static/login.html")
    # The CTA composes the shared element-kit button (.ow-btn .ow-btn-prominent),
    # not a bespoke login button — one source of truth with the app's primary action.
    assert 'class="ow-btn ow-btn-prominent"' in html, "the CTA must compose the kit button"
    assert ".ow-btn-prominent" in html
    # The threshold hero copy exists (the welcome/arrival moment).
    assert "greeting" in html


def test_login_eye_blink_is_reduced_motion_safe():
    html = _read("static/login.html")
    assert "logo-eye-blink" in html, "the hero eye must have a blink animation"
    assert "logo-eye-lid" in html, "blink is driven by an eyelid overlay"
    # Under reduced-motion the eye must NOT blink (stays open/static).
    assert ".logo-eye-lid { animation: none" in html


def test_login_has_five_gradient_presets():
    # The five aurora-mesh palette presets now live in the SHARED stylesheet
    # css/meshGradient.css (reused by the in-app glass theme), and login.html
    # links it. Pin the presets in the shared file + the link in login.html.
    css = _read("static/css/meshGradient.css")
    for preset in ("sunset", "aurora", "ocean", "gold", "lavender"):
        assert f'data-lbg-preset="{preset}"' in css, f"the '{preset}' palette preset must exist (shared mesh CSS)"
    html = _read("static/login.html")
    assert "/static/css/meshGradient.css" in html, \
        "login.html must link the shared mesh-gradient stylesheet"


# ─────────────────────────────────────────────────────────────────────────────
# 2. The admin control + setting plumbing
# ─────────────────────────────────────────────────────────────────────────────

def test_admin_has_login_background_control():
    js = _read("static/js/admin.js")
    assert "initLoginBackground" in js, "admin.js must define the login-background control"
    assert "adm-loginbg-source" in js, "admin must offer a source picker"
    # Rich controls (not just a source dropdown): gradient palette + particle + photo upload.
    assert "adm-loginbg-preset" in js
    assert "adm-loginbg-pdensity" in js
    assert "adm-loginbg-upload-btn" in js


def test_admin_control_is_wired_into_init():
    js = _read("static/js/admin.js")
    # The init must actually call it (a function defined but never wired is dead).
    assert "initLoginBackground," in js or "initLoginBackground]" in js


def test_admin_writes_through_admin_gated_endpoints():
    js = _read("static/js/admin.js")
    assert "/api/auth/settings" in js, "settings save goes through the admin-gated settings POST"
    assert "/api/auth/login-background/photo" in js, "photo upload goes through the admin-gated upload POST"


def test_admin_links_to_element_kit_demo():
    js = _read("static/js/admin.js")
    assert "/static/element_kit_demo.html" in js, "admin must link to the element-kit demo page (#773)"


def test_settings_defaults_to_gradient():
    from src.settings import DEFAULT_SETTINGS
    assert DEFAULT_SETTINGS["login_background"] == "gradient", "default login background must be 'gradient'"


# ─────────────────────────────────────────────────────────────────────────────
# 3. The pre-auth read is cosmetic-only, validated/clamped, default=gradient
# ─────────────────────────────────────────────────────────────────────────────

def _fresh_settings_module(tmp_path, monkeypatch):
    """Import src.settings pointed at an isolated settings file."""
    import src.constants as constants
    settings_file = os.path.join(tmp_path, "settings.json")
    monkeypatch.setattr(constants, "SETTINGS_FILE", settings_file, raising=False)
    import src.settings as settings
    importlib.reload(settings)
    # reload rebinds SETTINGS_FILE from constants at import time
    monkeypatch.setattr(settings, "SETTINGS_FILE", settings_file, raising=False)
    settings._invalidate_caches()
    return settings, settings_file


def test_cosmetic_config_default_is_gradient(tmp_path, monkeypatch):
    settings, _ = _fresh_settings_module(str(tmp_path), monkeypatch)
    cfg = settings.login_background_config()
    assert cfg["source"] == "gradient"
    # Shape is cosmetic-only: source + photo_url + gradient + particles, nothing else.
    assert set(cfg.keys()) == {"source", "photo_url", "gradient", "particles"}


def test_cosmetic_config_rejects_bad_source(tmp_path, monkeypatch):
    settings, fpath = _fresh_settings_module(str(tmp_path), monkeypatch)
    import json
    with open(fpath, "w") as f:
        json.dump({"login_background": "javascript:alert(1)"}, f)
    settings._invalidate_caches()
    cfg = settings.login_background_config()
    assert cfg["source"] == "gradient", "an unknown source must fall back to the gradient default"


def test_cosmetic_config_clamps_numbers_and_validates_preset(tmp_path, monkeypatch):
    settings, fpath = _fresh_settings_module(str(tmp_path), monkeypatch)
    import json
    with open(fpath, "w") as f:
        json.dump({
            "login_background": "particles",
            "login_gradient_preset": "not-a-preset",
            "login_gradient_speed": 9999,
            "login_gradient_intensity": -5,
            "login_particles_density": 999999,
            "login_particles_speed": 0,
        }, f)
    settings._invalidate_caches()
    cfg = settings.login_background_config()
    assert cfg["source"] == "particles"
    assert cfg["gradient"]["preset"] == "aurora"          # bad preset → default
    assert cfg["gradient"]["speed"] <= 60                  # clamped to range
    assert cfg["gradient"]["intensity"] >= 0.4            # clamped to range
    assert cfg["particles"]["density"] <= 160             # clamped to range
    assert cfg["particles"]["speed"] >= 0.05             # clamped to range


def test_cosmetic_config_drops_hostile_photo_url(tmp_path, monkeypatch):
    settings, fpath = _fresh_settings_module(str(tmp_path), monkeypatch)
    import json
    with open(fpath, "w") as f:
        json.dump({"login_background_photo_url": "javascript:alert(document.cookie)"}, f)
    settings._invalidate_caches()
    cfg = settings.login_background_config()
    assert cfg["photo_url"] == "", "a non-http(s)/non-path photo url must be dropped"


def test_cosmetic_config_keeps_valid_photo_url(tmp_path, monkeypatch):
    settings, fpath = _fresh_settings_module(str(tmp_path), monkeypatch)
    import json
    with open(fpath, "w") as f:
        json.dump({"login_background_photo_url": "/static/img/login/uploaded.jpg"}, f)
    settings._invalidate_caches()
    cfg = settings.login_background_config()
    assert cfg["photo_url"] == "/static/img/login/uploaded.jpg"


def test_public_get_is_pre_auth_exempt():
    """The pre-auth login page must be able to read the cosmetic config without a session."""
    app_src = _read("app.py")
    assert "/api/auth/login-background" in app_src, (
        "the cosmetic GET must be on the pre-auth exempt allowlist so the login page can read it"
    )
    # ...but the admin-gated UPLOAD must NOT be blanket-exempt (it's a different, longer path).
    # Exact-match exemption means /api/auth/login-background/photo still requires auth.
    auth_src = _read("routes/auth_routes.py")
    assert 'is_admin(user)' in auth_src
