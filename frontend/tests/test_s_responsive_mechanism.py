"""Stream S (ruling #16) — the responsive-mechanism lint gate.

One breakpoint token set, one JS viewport helper, one type scale, a working PWA
baseline. These are SOURCE gates: they fail any reintroduction of the breakpoint
anarchy (S5), literal innerWidth thresholds (S5), or the broken-install icons (S7).
The runtime half is scripts/responsive_matrix.py (the matrix gate).
"""
import json
import re
from pathlib import Path

FE = Path(__file__).resolve().parents[1]
STATIC = FE / "static"
JS = STATIC / "js"

# The token set (responsive-tokens.css): @media widths and their min-width complements.
MEDIA_TOKENS = {480, 768, 1024, 1440, 481, 769, 1025, 1441}
# 480 joined the container tiers with G6 (settings rail): the settings stacking
# switch moved 620 → 480 so the LEFT tab rail survives moderately narrow modals
# (user preference); 480 is already the narrowest member of the @media token set,
# so container tiers stay aligned with the one breakpoint family — no new anarchy.
CONTAINER_TOKENS = {360, 480, 620}

# Documented exceptions, each tied to an open finding — REMOVE the entry when the
# finding lands; the gate then enforces the token. Never add to this list without
# a finding ID.
MEDIA_EXCEPTIONS = {
    # (empty — the settings repair removed the @media-600 duplicates; add ONLY
    # with a finding ID and a count cap, and remove when the finding lands.)
}
CONTAINER_EXCEPTIONS = {
    # The chatbar micro-tier: a second collapse stage below the 360 tier for the
    # composer when the sidebar squeezes it. Documented sub-tier, page chrome.
    260: ("chatbar micro-tier (composer icon collapse)", 1),
    # #894 — the cast gallery's narrow-rail tier: when the cast window is docked into
    # the (narrow) gadget rail, the horizontal 2-row gallery drops to ONE column per
    # page so the squares stay legible. A sub-tier below the 360 token, scoped to the
    # #orwell-cast container only. The 3-/4-column up-tiers use the 480/620 tokens.
    240: ("cast gallery narrow-rail one-column page (#orwell-cast docked)", 1),
}

MEDIA_RX = re.compile(r"@media[^{]*?\((?:max|min)-width:\s*(\d+)px")
CONTAINER_RX = re.compile(r"@container[^{]*?\((?:max|min)-width:\s*(\d+)px")
INNERWIDTH_RX = re.compile(r"innerWidth\s*[<>]=?\s*\d+")


def css_sources():
    """Every stylesheet AND every JS file (panels inject <style> blocks)."""
    yield STATIC / "style.css"
    yield from (STATIC / "css").glob("*.css")
    yield from JS.glob("*.js")


def test_media_thresholds_are_tokens():
    offenders, exception_counts = [], {}
    for f in css_sources():
        text = f.read_text(encoding="utf-8", errors="replace")
        for m in MEDIA_RX.finditer(text):
            v = int(m.group(1))
            if v in MEDIA_TOKENS:
                continue
            if v in MEDIA_EXCEPTIONS:
                exception_counts[v] = exception_counts.get(v, 0) + 1
                continue
            line = text.count("\n", 0, m.start()) + 1
            offenders.append(f"{f.name}:{line}: @media …{v}px")
    assert not offenders, (
        "Breakpoint outside the token set {480,768,1024,1440} (S5). Use a token "
        "(responsive-tokens.css) or a @container tier:\n  " + "\n  ".join(offenders)
    )
    # The exception ratchet: counts may only go DOWN.
    for v, (why, cap) in MEDIA_EXCEPTIONS.items():
        got = exception_counts.get(v, 0)
        assert got <= cap, f"@media {v}px exception grew ({got} > {cap}): {why}"


def test_container_thresholds_are_tokens():
    offenders, exception_counts = [], {}
    for f in css_sources():
        text = f.read_text(encoding="utf-8", errors="replace")
        for m in CONTAINER_RX.finditer(text):
            v = int(m.group(1))
            if v in CONTAINER_TOKENS:
                continue
            if v in CONTAINER_EXCEPTIONS:
                exception_counts[v] = exception_counts.get(v, 0) + 1
                continue
            line = text.count("\n", 0, m.start()) + 1
            offenders.append(f"{f.name}:{line}: @container …{v}px")
    assert not offenders, (
        "Container tier outside {360,620} (S5):\n  " + "\n  ".join(offenders)
    )
    for v, (why, cap) in CONTAINER_EXCEPTIONS.items():
        got = exception_counts.get(v, 0)
        assert got <= cap, f"@container {v}px exception grew ({got} > {cap}): {why}"


def test_no_literal_innerwidth_thresholds_outside_platform():
    offenders = []
    for f in JS.glob("*.js"):
        if f.name == "platform.js":
            continue
        text = f.read_text(encoding="utf-8", errors="replace")
        for m in INNERWIDTH_RX.finditer(text):
            line = text.count("\n", 0, m.start()) + 1
            offenders.append(f"{f.name}:{line}: {m.group(0)}")
    assert not offenders, (
        "Literal innerWidth threshold comparison (S5) — use isNarrow()/"
        "isBelowMedium()/onNarrowChange() from platform.js:\n  " + "\n  ".join(offenders)
    )


def test_platform_exports_the_viewport_helpers():
    src = (JS / "platform.js").read_text()
    for sym in ("export function isNarrow", "export function isBelowMedium",
                "export function onNarrowChange", "matchMedia('(max-width: 768px)')"):
        assert sym in src, f"platform.js missing the viewport bridge: {sym}"


def test_tokens_stylesheet_loads_before_style_css():
    html = (STATIC / "index.html").read_text()
    tokens = html.find("css/responsive-tokens.css")
    style = html.find('href="/static/style.css"')
    assert tokens != -1, "responsive-tokens.css is not linked"
    assert style != -1 and tokens < style, "responsive-tokens.css must load BEFORE style.css"


def test_type_scale_and_standalone_tier_exist():
    css = (STATIC / "css" / "responsive-tokens.css").read_text()
    for token in ("--fs-2xs", "--fs-xl", "--tap-min", "--bp-narrow",
                  "text-size-adjust: 100%", "(display-mode: standalone)",
                  "(pointer: coarse)", "clamp("):
        assert token in css, f"responsive-tokens.css missing: {token}"


# ---- S7: the PWA install baseline -------------------------------------------------

def test_manifest_icons_exist_and_are_real_pngs():
    manifest = json.loads((STATIC / "manifest.json").read_text())
    icon_paths = [i["src"] for i in manifest["icons"]]
    assert "/static/icon-192.png" in icon_paths and "/static/icon-512.png" in icon_paths
    for name in ("icon-192.png", "icon-512.png", "apple-touch-icon.png"):
        p = STATIC / name
        assert p.exists(), f"{name} missing — PWA install is broken (S7)"
        data = p.read_bytes()
        assert data[:8] == b"\x89PNG\r\n\x1a\n", f"{name} is not a PNG"
        assert len(data) > 1000, f"{name} looks like a placeholder"
    assert any("maskable" in i.get("purpose", "") for i in manifest["icons"]), \
        "manifest icons must be maskable (S7)"


def test_apple_touch_icon_linked_at_180():
    html = (STATIC / "index.html").read_text()
    assert 'rel="apple-touch-icon" sizes="180x180" href="/static/apple-touch-icon.png"' in html


def test_icons_and_tokens_are_precached():
    sw = (STATIC / "sw.js").read_text()
    for asset in ("/static/icon-192.png", "/static/icon-512.png",
                  "/static/apple-touch-icon.png", "/static/css/responsive-tokens.css"):
        assert asset in sw, f"{asset} missing from the SW precache (S7)"


def test_static_icons_serve_200():
    """The live half of S7: the app actually serves the icons."""
    import importlib
    from fastapi.testclient import TestClient
    app_mod = importlib.import_module("app")
    client = TestClient(app_mod.app)
    for path in ("/static/icon-192.png", "/static/icon-512.png",
                 "/static/apple-touch-icon.png", "/static/manifest.json",
                 "/static/css/responsive-tokens.css"):
        r = client.get(path)
        assert r.status_code == 200, f"{path} -> {r.status_code}"
