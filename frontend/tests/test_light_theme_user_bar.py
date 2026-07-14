"""The sidebar user chip/footer rides the frosted MATERIAL's polarity (APP-OV-3).

History: the footer band was first a hardcoded dark chip (`rgba(14,16,22,.55)` + `#fff` ink —
wrong on light palettes), then a theme-token band (`var(--bg)` + `var(--fg)` ink). The
2026-07-14 theme audit (APP-OV-3, the §0 systemic polarity class) overturned the token band
too: the frosted material is a LIGHT surface REGARDLESS of theme tokens, so on the default
DARK theme the var(--bg) band rendered a DARK capsule with light ink sitting on the LIGHT
frosted sidebar — the exact polarity glitch the audit calls out. The durable rule (§0): an
element inside glass either composes the kit's material-fixed fills or it is a latent
wrong-polarity bug.

The fix mirrors how the kit surfaces do it: the footer chip paints the ONE light glass
(`var(--ow-glass-light-color)` — material-fixed white translucent, reads identically over any
theme/backdrop), and the username + account icons fall back to the sidebar's blanket DARK
chrome ink (#16191f + light halo). The chip still guarantees the AA backing the old band
existed for: white .60 stacked on the sidebar's .60 glass composites ≥ ~0.84 white even over
the darkest backdrop, so the dark ink clears 4.5:1 everywhere. Flat tier untouched (the rule
stays body.theme-frosted-scoped).

SOURCE pins (fast `fe-unit` lane, no browser) + a BROWSER gate (computed styles over the REAL
stylesheet with the light and dark token sets — proves the chip + ink render light-glass/dark-
ink on BOTH palettes). Roles only; Vault-free (chrome only).
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


def test_frosted_user_bar_band_is_the_kit_light_glass():
    """APP-OV-3: the footer chip paints the kit's ONE light glass (material-fixed), never a
    theme-token band (which inverts polarity on the light frosted material) and never the
    original hardcoded dark chip."""
    m = re.search(r"body\.theme-frosted\s+#sidebar\s+\.sidebar-user-bar\s*\{[^}]*\}", CSS, re.S)
    assert m, "missing the frosted user-bar footer chip rule"
    body = m.group(0)
    assert "var(--ow-glass-light-color" in body, \
        "the user-bar chip must paint the kit light glass (var(--ow-glass-light-color)) — APP-OV-3"
    assert "color-mix(in srgb, var(--bg" not in body, \
        "the var(--bg) token band must not come back (dark capsule on the light frosted sidebar)"
    assert "rgba(14, 16, 22" not in body and "rgba(14,16,22" not in body, \
        "the hardcoded dark band (the light-theme 'dark chip' bug) must not come back"


def test_frosted_sidebar_label_ink_derives_from_theme_fg():
    """The brand-title / New-Chat ink + halo still follow the theme's polarity (they float on
    unbounded glass with no backing chip). The USERNAME is deliberately NOT in this group any
    more (APP-OV-3): it sits on the light-glass footer chip and takes the sidebar's blanket
    dark chrome ink."""
    m = re.search(
        r"body\.theme-frosted\s+#sidebar\s+\.sidebar-brand-title,\s*"
        r"body\.theme-frosted\s+#sidebar\s+#sidebar-new-chat-btn\s+\.grow\s*\{[^}]*\}",
        CSS, re.S)
    assert m, "missing the frosted sidebar label ink rule (.sidebar-brand-title et al.)"
    body = m.group(0)
    assert "var(--fg" in body, "the label ink must be the theme's own --fg"
    assert "color: #fff" not in body, \
        "the hardcoded white ink (light-on-light on a light palette) must not come back"
    assert "color-mix(in srgb, var(--bg" in body, \
        "the legibility halo must follow the theme's bg polarity, not a fixed dark shadow"
    # APP-OV-3: no frosted rule may force the username back onto var(--fg) — light ink on the
    # light-glass chip is the polarity bug this fix removes.
    # `[^{}]*` (not `[^}]*`) in the body so an @media wrapper can't swallow its first nested
    # rule — each innermost rule pairs with its own selector even one level inside an at-rule.
    for sel, rule_body in re.findall(r"([^{}]+)\{([^{}]*)\}", CSS):
        if "#user-bar-name" in sel and "theme-frosted" in sel:
            assert "var(--fg" not in rule_body, (
                "a frosted rule flips #user-bar-name back to var(--fg) — on the light-glass "
                "footer chip the username must keep the sidebar's dark chrome ink (APP-OV-3)")


def test_user_bar_carries_no_other_hardcoded_background():
    """Belt-and-braces: no OTHER .sidebar-user-bar rule may (re)introduce a polarity-fixed
    background — every background it paints is transparent or token/material-derived."""
    for m in re.finditer(r"[^{}]*\.sidebar-user-bar[^{}]*\{[^{}]*\}", CSS, re.S):
        rule = m.group(0)
        for decl in re.findall(r"background(?:-color)?\s*:\s*([^;]+);", rule):
            v = decl.strip()
            assert v.startswith(("transparent", "var(", "color-mix(")), (
                f".sidebar-user-bar paints a hardcoded background {v!r} — use the kit material "
                "tokens (the light-theme dark-chip bug shape)")


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
    """APP-OV-3: the frosted material is LIGHT regardless of theme tokens, so on BOTH token sets
    the footer chip renders as light glass and the username as dark chrome ink. The brand title
    (no backing chip) keeps following the theme's --fg. Rendered from the real stylesheet, so a
    reintroduced token-polarity band (the dark-capsule-on-light-sidebar glitch) fails here."""
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
            # the chip: the kit's ONE light glass — a translucent white wash.
            assert 0.30 <= light["band"]["a"] <= 0.85, \
                f"the chip should stay a translucent wash ({light['band']['raw']})"
            assert _mean(light["band"]) > 180, \
                f"LIGHT theme: the user-bar chip must render LIGHT glass ({light['band']['raw']})"
            # the ink: the sidebar's dark chrome ink on the light chip.
            assert _mean(light["name"]) < 128, \
                f"LIGHT theme: the username ink must render DARK ({light['name']['raw']})"
            assert _mean(light["brand"]) < 128, \
                f"LIGHT theme: the brand-title ink must render DARK ({light['brand']['raw']})"

            dark = page.evaluate(_PROBE_JS, GLASS_DARK)
            # APP-OV-3: the chip is MATERIAL-fixed — it stays light glass on the dark theme too
            # (the old var(--bg) band rendered a dark capsule on the light frosted sidebar).
            assert 0.30 <= dark["band"]["a"] <= 0.85, \
                f"the chip should stay a translucent wash ({dark['band']['raw']})"
            assert _mean(dark["band"]) > 180, \
                f"DARK glass theme: the user-bar chip must stay LIGHT glass ({dark['band']['raw']})"
            assert _mean(dark["name"]) < 128, \
                f"DARK glass theme: the username ink must be the DARK chrome ink ({dark['name']['raw']})"
            # the brand title has no chip — it keeps the theme's own (light) ink over the glass.
            assert _mean(dark["brand"]) > 200, \
                f"DARK glass theme: the brand-title ink must stay theme-fg LIGHT ({dark['brand']['raw']})"
        finally:
            browser.close()
