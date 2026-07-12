"""The sidebar user chip/footer must follow the ACTIVE theme's polarity (light-theme fix).

Owner report: on the LIGHT theme the sidebar's bottom user bar (the logged-in username chip)
rendered as a DARK band with mismatched ink — wrong polarity ("dark on light"). Root cause:
the #1375 frosted-sidebar a11y overrides HARDCODED the default dark glass theme's polarity —
`color: #fff` ink + an `rgba(14,16,22,.55)` band on `body.theme-frosted #sidebar` — and the
frosted material is ON for EVERY theme by default (theme.js `defaultGlassTierFor` returns
'frosted' unless a theme opts out), so any light palette (light/paper/lavender/cute…) still got
the dark chip at the sidebar foot.

The fix derives the band + halo from `var(--bg)` and the ink from `var(--fg)` — the 0114
theme-surface convention (surface colors derive from the active theme's tokens, never a
polarity-fixed hardcoded color) — keeping the default dark glass rendering essentially
identical (fg #eef1f4 ≈ the old #fff; bg #15171c ≈ the old rgb(14,16,22)) while a light
palette resolves a light band + dark ink.

SOURCE pins (fast `fe-unit` lane, no browser) + a BROWSER gate (computed styles over the REAL
stylesheet with the light and dark token sets — proves the rendered polarity BOTH ways, so the
light-theme fix can't regress dark). Roles only; Vault-free (chrome only).
"""

import functools
import http.server
import os
import re
import socketserver
import threading

import pytest

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATIC = os.path.join(FRONTEND, "static")

with open(os.path.join(STATIC, "style.css"), encoding="utf-8") as _f:
    CSS = _f.read()


# ── source pins: the frosted sidebar footer/labels derive from theme tokens ───────────────


def test_frosted_user_bar_band_derives_from_theme_bg():
    """The footer band must be the theme's own --bg (translucent), never a hardcoded dark."""
    m = re.search(r"body\.theme-frosted\s+#sidebar\s+\.sidebar-user-bar\s*\{[^}]*\}", CSS, re.S)
    assert m, "missing the frosted user-bar footer band rule"
    body = m.group(0)
    assert "color-mix(in srgb, var(--bg" in body, \
        "the user-bar band must derive from the theme's --bg token (light theme ⇒ light band)"
    assert "rgba(14, 16, 22" not in body and "rgba(14,16,22" not in body, \
        "the hardcoded dark band (the light-theme 'dark chip' bug) must not come back"


def test_frosted_sidebar_label_ink_derives_from_theme_fg():
    """The username / brand-title / New-Chat ink + halo must follow the theme's polarity."""
    m = re.search(
        r"body\.theme-frosted\s+#sidebar\s+#user-bar-name,\s*"
        r"body\.theme-frosted\s+#sidebar\s+\.sidebar-brand-title,\s*"
        r"body\.theme-frosted\s+#sidebar\s+#sidebar-new-chat-btn\s+\.grow\s*\{[^}]*\}",
        CSS, re.S)
    assert m, "missing the frosted sidebar label ink rule (#user-bar-name et al.)"
    body = m.group(0)
    assert "var(--fg" in body, "the label ink must be the theme's own --fg"
    assert "color: #fff" not in body, \
        "the hardcoded white ink (light-on-light on a light palette) must not come back"
    assert "color-mix(in srgb, var(--bg" in body, \
        "the legibility halo must follow the theme's bg polarity, not a fixed dark shadow"


def test_user_bar_carries_no_other_hardcoded_background():
    """Belt-and-braces: no OTHER .sidebar-user-bar rule may (re)introduce a polarity-fixed
    background — every background it paints is transparent or theme-token-derived."""
    for m in re.finditer(r"[^{}]*\.sidebar-user-bar[^{}]*\{[^}]*\}", CSS, re.S):
        rule = m.group(0)
        for decl in re.findall(r"background(?:-color)?\s*:\s*([^;]+);", rule):
            v = decl.strip()
            assert v.startswith(("transparent", "var(", "color-mix(")), (
                f".sidebar-user-bar paints a hardcoded background {v!r} — use theme tokens "
                "(the light-theme dark-chip bug shape)")


# ── browser gate: rendered polarity is correct on BOTH themes ─────────────────────────────

_PORT = int(os.environ.get("ORWELL_USERBAR_PORT", "8799"))

#: Token sets copied from static/js/theme.js's THEMES map (same deliberate copy-as-trip-wire
#: rationale scripts/theme_consistency.py documents for its BASE_THEME_COLORS).
LIGHT = {"bg": "#f0ebe3", "fg": "#5a5248", "panel": "#faf6f0", "border": "#d4cdc2"}
GLASS_DARK = {"bg": "#15171c", "fg": "#eef1f4", "panel": "#1d2026", "border": "#3a3f47"}


def _chromium_path():
    for base in ("/opt/pw-browsers/chromium/chrome-linux/chrome",
                 "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"):
        if os.path.exists(base):
            return base
    return None


@pytest.fixture(scope="module")
def _static_server():
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=STATIC)

    class _Q(socketserver.TCPServer):
        allow_reuse_address = True

    httpd = _Q(("127.0.0.1", _PORT), handler)
    t = threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()
    try:
        yield f"http://127.0.0.1:{_PORT}"
    finally:
        httpd.shutdown()


# The REAL stylesheet over the real sidebar-footer DOM shape (index.html's
# .sidebar-user-bar cluster), body.theme-frosted like every default theme.
_HARNESS = """
<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="/style.css">
</head><body class="theme-frosted">
  <div id="sidebar" class="sidebar">
    <div class="sidebar-header"><span class="sidebar-brand-title">Orwell</span></div>
    <div class="sidebar-user-bar" id="sidebar-user-bar">
      <div class="user-bar-left" id="user-bar-profile">
        <span class="user-bar-name" id="user-bar-name">User</span>
      </div>
    </div>
  </div>
</body></html>
"""

# Applies a theme token set (the same custom properties theme.js applyColors sets) and reads
# back the COMPUTED footer band + label inks, parsed to numeric rgba (handles both the
# rgb()/rgba() and color(srgb …) serializations of a resolved color-mix()).
_PROBE_JS = """
(tokens) => {
  const rs = document.documentElement.style;
  rs.setProperty('--bg', tokens.bg);
  rs.setProperty('--fg', tokens.fg);
  rs.setProperty('--panel', tokens.panel);
  rs.setProperty('--border', tokens.border);
  const parse = (s) => {
    let m = /^rgba?\\(([\\d.]+),\\s*([\\d.]+),\\s*([\\d.]+)(?:,\\s*([\\d.]+))?\\)$/.exec(s);
    if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4], raw: s };
    m = /^color\\(srgb\\s+([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)(?:\\s*\\/\\s*([\\d.]+))?\\)$/.exec(s);
    if (m) return { r: 255 * +m[1], g: 255 * +m[2], b: 255 * +m[3],
                    a: m[4] === undefined ? 1 : +m[4], raw: s };
    return { raw: s };
  };
  return {
    band: parse(getComputedStyle(document.querySelector('.sidebar-user-bar')).backgroundColor),
    name: parse(getComputedStyle(document.getElementById('user-bar-name')).color),
    brand: parse(getComputedStyle(document.querySelector('.sidebar-brand-title')).color),
  };
}
"""


def _mean(c):
    assert "r" in c, f"unparseable computed color: {c.get('raw')!r}"
    return (c["r"] + c["g"] + c["b"]) / 3.0


def test_user_bar_polarity_follows_the_theme(_static_server):
    """LIGHT tokens ⇒ light band + dark ink; the default dark glass tokens ⇒ dark band + light
    ink. Rendered from the real stylesheet, so a reintroduced hardcoded polarity fails here."""
    try:
        from playwright.sync_api import sync_playwright
    except Exception:
        pytest.skip("playwright not installed")
    base = _static_server
    with sync_playwright() as pw:
        exe = _chromium_path()
        try:
            browser = pw.chromium.launch(executable_path=exe) if exe else pw.chromium.launch()
        except Exception:
            pytest.skip("chromium unavailable")
        try:
            page = browser.new_page()
            page.goto(base + "/__h", wait_until="domcontentloaded")  # establish origin
            page.set_content(_HARNESS, wait_until="load")
            # the stylesheet is applied once the base rule's flex layout lands.
            page.wait_for_function(
                "() => getComputedStyle(document.querySelector('.sidebar-user-bar'))"
                ".display === 'flex'", timeout=10000)

            light = page.evaluate(_PROBE_JS, LIGHT)
            # the band: the theme's own light --bg, translucent — NOT the old dark chip.
            assert 0.30 <= light["band"]["a"] <= 0.80, \
                f"light band should stay a translucent wash ({light['band']['raw']})"
            assert _mean(light["band"]) > 180, \
                f"LIGHT theme: the user-bar band must render LIGHT ({light['band']['raw']})"
            # the ink: the theme's dark --fg — not the old hardcoded white.
            assert _mean(light["name"]) < 128, \
                f"LIGHT theme: the username ink must render DARK ({light['name']['raw']})"
            assert _mean(light["brand"]) < 128, \
                f"LIGHT theme: the brand-title ink must render DARK ({light['brand']['raw']})"

            dark = page.evaluate(_PROBE_JS, GLASS_DARK)
            # no dark-theme regression: the band/ink keep the shipped dark-glass polarity.
            assert 0.30 <= dark["band"]["a"] <= 0.80, \
                f"dark band should stay a translucent wash ({dark['band']['raw']})"
            assert _mean(dark["band"]) < 64, \
                f"DARK glass theme: the user-bar band must stay DARK ({dark['band']['raw']})"
            assert _mean(dark["name"]) > 200, \
                f"DARK glass theme: the username ink must stay LIGHT ({dark['name']['raw']})"
            assert _mean(dark["brand"]) > 200, \
                f"DARK glass theme: the brand-title ink must stay LIGHT ({dark['brand']['raw']})"
        finally:
            browser.close()
