"""Google Fonts in the theme font picker.

The theme engine's font setting ships offline-safe built-ins (the default System /
SF stack, Monospace, Sans-serif, Serif) and ADDS a searchable Google Fonts picker
so the player can pick (almost) any Google font for the UI. (The unused GohuFont
custom-folder file was removed in the typography-#696 pass; the custom-folder scan
machinery stays for player-dropped fonts.)

These are source-pinned tests in the same JS/HTML/JSON-as-text style as the other
FE chrome tests (the FE has no DOM runtime in the pytest lane). They pin the
contract the live picker relies on:

  * the built-ins stay intact + offline-safe (no network needed),
  * the vendored static catalog ships family names (+ category) with NO runtime
    Google Fonts Developer API key,
  * a selected family is loaded lazily via a SINGLE Google Fonts CSS2 <link>
    (URL-encoded family, display=swap), swapped cleanly on change,
  * the UI font-family CSS var is set with a system fallback in the stack,
  * the choice persists through the existing theme/settings store (gf: tag in the
    same `font` field), incl. on the first-paint head-script,
  * free-text entry of any family is accepted,
  * graceful offline fallback to a built-in / system font, never fontless.
"""
import json
import os
import re

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*rel):
    with open(os.path.join(FRONTEND, *rel), encoding="utf-8") as f:
        return f.read()


# ── the vendored static catalog (no API key) ──────────────────────────────────

def test_vendored_catalog_exists_and_is_valid_json():
    data = json.loads(_read("static", "fonts", "google-fonts.json"))
    assert isinstance(data.get("families"), list)
    assert len(data["families"]) >= 100, "ship a useful number of families"


def test_vendored_catalog_ships_family_names_and_categories():
    data = json.loads(_read("static", "fonts", "google-fonts.json"))
    fams = data["families"]
    for f in fams:
        assert isinstance(f.get("family"), str) and f["family"].strip()
        # category is handy for the datalist hint; pin it ships.
        assert isinstance(f.get("category"), str) and f["category"].strip()
    names = [f["family"] for f in fams]
    assert len(names) == len(set(names)), "no duplicate family names"
    # Spread across categories so the picker is genuinely useful.
    cats = {f["category"] for f in fams}
    assert {"sans-serif", "serif", "monospace"} <= cats


def test_catalog_is_a_static_asset_not_an_api_call():
    # The picker must NOT depend on the Google Fonts Developer API (needs a key).
    js = _read("static", "js", "theme.js")
    assert "/static/fonts/google-fonts.json" in js, \
        "the catalog must load from the vendored static asset"
    assert "googleapis.com/webfonts" not in js, \
        "must not call the key-gated Google Fonts Developer API"
    # No API key is referenced anywhere in the font code.
    assert "api_key" not in js.lower() and "apikey" not in js.lower()


# ── the four built-ins stay offline-safe ──────────────────────────────────────

def test_builtins_intact_and_offline():
    js = _read("static", "js", "theme.js")
    # The three CSS built-ins are unchanged and need no network.
    fontmap = re.search(r"const FONT_MAP = \{(.*?)\};", js, re.S).group(1)
    assert "system:" in fontmap and "mono:" in fontmap and "sans:" in fontmap and "serif:" in fontmap
    # The default font is the Apple SF SYSTEM stack (audit #696) — a built-in (offline)
    # one (the stack degrades to Inter / platform defaults with no network).
    assert re.search(r"const DEFAULT_FONT = '(system|mono|sans|serif)';", js)
    # The default 'system' entry IS the SF system-font stack (no bundled SF Pro — license).
    assert "-apple-system" in fontmap and "Inter" in fontmap


def test_html_still_lists_the_builtin_font_options():
    html = _read("static", "index.html")
    sel = re.search(r'<select id="theme-font-select".*?</select>', html, re.S).group(0)
    assert 'value="system"' in sel and 'value="mono"' in sel and 'value="sans"' in sel and 'value="serif"' in sel


def test_google_font_path_is_additive_not_a_replacement():
    # applyFontDensity keeps the built-in + custom-folder branches; the Google
    # branch is added, so an air-gapped deploy works on the built-ins alone.
    js = _read("static", "js", "theme.js")
    body = re.search(r"export function applyFontDensity\(font, density\) \{(.*?)\n\}", js, re.S).group(1)
    assert "FONT_MAP[f]" in body, "built-in lookup retained"
    assert "_customFonts[f]" in body, "custom-folder lookup retained"
    assert "_googleFamilyFromFont(f)" in body, "Google branch added"


# ── the lazy single-link CSS2 load ────────────────────────────────────────────

def test_single_dynamic_link_with_stable_id():
    js = _read("static", "js", "theme.js")
    assert "const GOOGLE_FONT_LINK_ID = 'orwell-google-font-link';" in js
    body = re.search(r"function _loadGoogleFont\(family\) \{(.*?)\n\}", js, re.S).group(1)
    # Replaces (removes) the prior link when a DIFFERENT family is selected.
    assert "link.remove()" in body
    assert "rel = 'stylesheet'" in body


def test_css2_url_is_encoded_with_display_swap():
    js = _read("static", "js", "theme.js")
    body = re.search(r"function _googleFontHref\(family\) \{(.*?)\n\}", js, re.S).group(1)
    assert "fonts.googleapis.com/css2?family=" in body
    assert "encodeURIComponent(family)" in body
    assert "display=swap" in body
    # No bulk catalog load — only one family in the URL.
    assert "css2?family=" in body and "&family=" not in body


def test_font_stack_carries_a_system_fallback():
    js = _read("static", "js", "theme.js")
    body = re.search(r"function _googleFontStack\(family\) \{(.*?)\n\}", js, re.S).group(1)
    # A generic system fallback after the chosen family → never fontless offline.
    assert "system-ui" in body and "sans-serif" in body


def test_load_failure_drops_the_link_gracefully():
    js = _read("static", "js", "theme.js")
    body = re.search(r"function _loadGoogleFont\(family\) \{(.*?)\n\}", js, re.S).group(1)
    # An 'error' on the stylesheet removes it so the stack falls to the fallback.
    assert "addEventListener('error'" in body
    assert "cur.remove()" in body


def test_apply_sets_the_css_variable():
    js = _read("static", "js", "theme.js")
    body = re.search(r"export function applyFontDensity\(font, density\) \{(.*?)\n\}", js, re.S).group(1)
    assert "setProperty('--font-family', family)" in body


# ── persistence (gf: tag in the existing store) ───────────────────────────────

def test_google_font_persists_through_the_existing_save_path():
    js = _read("static", "js", "theme.js")
    assert "export const GOOGLE_FONT_PREFIX = 'gf:';" in js
    # save() writes any non-default font (gf:Family included) to localStorage +
    # syncs to the per-user server store — the SAME path as the built-in setting.
    save = re.search(r"export function save\(name, colors, opts\) \{(.*?)\n\}", js, re.S).group(1)
    assert "opts.font" in save and "obj.font" in save
    assert "Storage.setJSON(LS_KEY, obj)" in save
    assert "_syncToServer(obj)" in save


def test_first_paint_head_script_handles_google_font():
    html = _read("static", "index.html")
    # The early head-script paints a saved gf: font on the first frame (no flash)
    # — injects the single link + sets the var with a fallback stack.
    assert "t.font.indexOf('gf:') === 0" in html
    assert "fonts.googleapis.com/css2?family=" in html
    assert "display=swap" in html
    assert "system-ui" in html  # fallback baked into the first-paint stack
    assert "orwell-google-font-link" in html


# ── the searchable picker UI + free text ──────────────────────────────────────

def test_picker_ui_present_and_styled_like_settings():
    html = _read("static", "index.html")
    # A text combobox backed by a datalist (searchable + free-text).
    assert 'id="theme-google-font-input"' in html
    assert 'list="theme-google-font-list"' in html
    assert '<datalist id="theme-google-font-list">' in html
    # Apply + Clear, using the existing settings button class.
    assert 'id="theme-google-font-apply"' in html
    assert 'id="theme-google-font-clear"' in html
    assert "theme-io-btn" in re.search(r'id="theme-google-font-apply"[^>]*', html).group(0)


def test_free_text_entry_is_accepted():
    js = _read("static", "js", "theme.js")
    # The input is free text; Apply/Enter uses whatever the user typed (trimmed),
    # not a fixed option set — so a family not in the shipped list still works.
    body = re.search(r"function _wireGoogleFontPicker\(.*?\n\}", js, re.S).group(0)
    assert "input.value.trim()" in body
    assert "applyFont(v)" in body
    # Enter applies too.
    assert "e.key === 'Enter'" in body


def test_datalist_populated_from_the_vendored_catalog():
    js = _read("static", "js", "theme.js")
    body = re.search(r"function _wireGoogleFontPicker\(.*?\n\}", js, re.S).group(0)
    assert "_loadGoogleFontCatalog()" in body
    assert "theme-google-font-list" in body
    # Catalog loader points at the static asset, tolerates failure (free-text still works).
    loader = re.search(r"function _loadGoogleFontCatalog\(\) \{(.*?)\n\}", js, re.S).group(1)
    assert "GOOGLE_FONTS_ASSET" in loader
    assert ".catch(" in loader


def test_clear_returns_to_a_builtin_offline_font():
    js = _read("static", "js", "theme.js")
    body = re.search(r"function _clearGoogleFont\(\) \{(.*?)\n  \}", js, re.S).group(1)
    assert "applyFontDensity(DEFAULT_FONT" in body
    # And the dynamic link is removed so nothing keeps pointing at Google.
    assert "GOOGLE_FONT_LINK_ID" in body and "link.remove()" in body


# ── the CSP must allow the load (else the whole picker is broken at runtime) ────
# Regression: the picker was fully built + source-tested, but the Content-Security-
# Policy never allowed the Google Fonts hosts — so a selected `gf:` font's <link>
# (fonts.googleapis.com) and its .woff2 files (fonts.gstatic.com) were blocked and
# silently fell back to system fonts. Source pins can't catch that; assert the real
# response header from the middleware.

def test_csp_allows_the_google_fonts_hosts():
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from core.middleware import SecurityHeadersMiddleware

    app = FastAPI()
    app.add_middleware(SecurityHeadersMiddleware)

    @app.get("/")
    def _root():
        return {"ok": True}

    csp = TestClient(app).get("/").headers["content-security-policy"]
    # the stylesheet host must be in style-src; the font-file host in font-src.
    style = re.search(r"style-src[^;]*", csp).group(0)
    font = re.search(r"font-src[^;]*", csp).group(0)
    assert "https://fonts.googleapis.com" in style, "the gf: <link> stylesheet host must be allowed"
    assert "https://fonts.gstatic.com" in font, "the gf: .woff2 font host must be allowed"
    # the offline built-ins keep working — 'self' stays in both directives.
    assert "'self'" in style and "'self'" in font


# ── the privacy disclosure ────────────────────────────────────────────────────

def test_privacy_note_near_the_picker():
    html = _read("static", "index.html")
    note = re.search(r'id="theme-google-font-note".*?</span>', html, re.S)
    assert note, "a privacy note element must sit by the picker"
    text = note.group(0)
    # Brief, unobtrusive disclosure that loading sends the browser IP to Google.
    assert "Google" in text
    assert "IP" in text or "ip" in text
