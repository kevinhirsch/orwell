"""UX Phase-4 polish — Theme / settings IA cluster (source-pinned).

CI can't drive the live stack here, so we pin the WIRING for each fix by reading
the static assets. Cluster items (GitHub issue #606): J1-17, J1-24, J1-33.
Already-done items (J1-06 show-fewer #666, J1-15 single theme home) are re-pinned
so they don't silently regress.

Deferred (need an owner ruling, intentionally NOT pinned here): J1-07 (curate the
game-build Appearance toggle set), J1-12 (mobile drawer-only path — audit
steelmans it as standard mobile IA), J1-19 (duplicate profile-photo entry points —
marked [by-design] in the open-items verification).
"""
import os

FE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(rel):
    with open(os.path.join(FE, rel), encoding="utf-8") as fh:
        return fh.read()


# ── J1-17: auth furniture (Logout / Change Password / 2FA) hides when auth is off ─

def test_j1_17_auth_status_exposes_auth_enabled():
    py = _read("routes/auth_routes.py")
    assert 'result["auth_enabled"]' in py, (
        "/api/auth/status must report whether the operator has auth turned on so the "
        "FE can hide the account auth furniture on a single-player, auth-off build."
    )


def test_j1_17_account_hides_auth_controls_when_auth_off():
    js = _read("static/js/settings.js")
    # Reads the flag from the status payload (defaults to SHOWING when absent).
    assert "d.auth_enabled === false" in js, (
        "initAccount must gate the auth furniture on the auth_enabled flag (and only "
        "hide when it is explicitly false — absent ⇒ keep showing)."
    )
    # Hides all three: Logout button, Change Password card, 2FA card.
    assert "settings-logout-btn" in js
    assert "settings-pw-card" in js
    assert "settings-2fa-card" in js


def test_j1_17_password_card_has_a_stable_id():
    html = _read("static/index.html")
    assert 'id="settings-pw-card"' in html, (
        "the Change Password card needs a stable id so it can be hidden when auth is off."
    )


# ── J1-24: theme swatch dots stay legible on any tile; the tile is a real preview ─

def test_j1_24_swatch_dots_use_background_independent_ring():
    css = _read("static/style.css")
    block = css[css.index(".theme-swatch-colors span"):]
    block = block[: block.index("}") + 1]
    # The old --fg-keyed border vanished on dark dots over dark tiles. The ring is
    # now a dual light/dark box-shadow, independent of the page colours.
    assert "box-shadow" in block, "dots need a background-independent ring (box-shadow)"
    assert "rgba(255, 255, 255" in block and "rgba(0, 0, 0" in block, (
        "the ring must combine a light inner edge and a dark outer edge so each dot "
        "reads on both light and dark tiles."
    )
    assert "var(--fg) 12%" not in block, (
        "the faint --fg-keyed border was the J1-24 defect — it must be gone."
    )


def test_j1_24_swatch_tile_previews_the_theme_colors():
    js = _read("static/js/theme.js")
    assert "theme-swatch--preview" in js, "the swatch must carry the preview class"
    # The tile paints in the theme's OWN bg + fg so it is a mini-preview, not just
    # an abstract dot row.
    assert "background:${c.bg};color:${c.fg}" in js, (
        "the swatch tile must preview the theme's own bg + fg colours."
    )


# ── J1-33: keyboard-shortcut labels match the in-app vocabulary ("Chats") ─────

def test_j1_33_settings_shortcut_labels_use_chat_vocabulary():
    js = _read("static/js/settings.js")
    # The drifted nouns are gone.
    assert "Search conversations" not in js
    assert "'New session'" not in js
    assert "'Favorite session'" not in js
    assert "'Delete session'" not in js
    assert "'Toggle Window'" not in js
    # The aligned vocabulary is present.
    assert "'Search chats'" in js
    assert "'New chat'" in js
    assert "'Open Settings'" in js
    # The category that grouped them is renamed from "Sessions" to "Chats".
    assert "name: 'Chats'" in js


def test_j1_33_slash_help_labels_use_chat_vocabulary():
    js = _read("static/js/slashCommands.js")
    block = js[js.index("const ACTION_LABELS"):]
    block = block[: block.index("};") + 2]
    assert "Search conversations" not in block
    assert "New session" not in block
    assert "Search chats" in block
    assert "New chat" in block


# ── J1-06 (already shipped, #666): the game build tucks non-house themes away ──

def test_j1_06_game_build_shows_house_themes_first_with_reveal():
    js = _read("static/js/theme.js")
    assert "theme-show-all" in js and "theme-extra" in js, (
        "the game build must show the curated house themes first and tuck the rest "
        "behind a 'Show all themes' reveal (J1-06 / #666)."
    )


# ── J1-15 (already shipped): the theme picker has exactly ONE home ────────────

def test_j1_15_theme_picker_has_one_home_no_appearance_card():
    html = _read("static/index.html")
    # The Appearance tab carries the explicit no-Theme-card note.
    assert "no Theme card here" in html, (
        "the theme picker's single home is the standing sidebar entry (#tool-theme-btn); "
        "the Settings->Appearance Theme card must stay removed (J1-15)."
    )
    # The picker itself lives in its own window. Its content (#themeGrid +
    # #theme-popup) is hosted, hidden, in #theme-host until the OrwellWindow kit's
    # first open() lifts it into the kit window (id "theme-modal", built in
    # theme.js initThemeKitWindow — so the id is created at runtime, not in static
    # HTML). Mirror the Settings kit migration (#settings-host / id 'settings-modal').
    assert 'id="themeGrid"' in html and 'id="theme-host"' in html and 'id="theme-popup"' in html
    js = _read("static/js/theme.js")
    assert "initThemeKitWindow" in js and "id: 'theme-modal'" in js, \
        "the theme window must be created via the OrwellWindow kit (id 'theme-modal')"
