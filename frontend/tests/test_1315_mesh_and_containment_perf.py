"""#1315 — mesh-wallpaper animation pause + transcript containment (SOURCE-PINS).

Two of the four compounding glass/transcript costs:

  (2) MESH WALLPAPER — the in-app glass wallpaper (mounted into #__wp) is a paint-triggering
      background-position animation on a huge blurred fixed layer under the WHOLE backdrop-filter
      stack. It now only ANIMATES under the FULL glass tier (body.glass-full) AND while the tab is
      visible; the Frosted/Normal tiers and a hidden tab freeze it to a still frame. Reduced-motion
      behaviour is unchanged (still frozen). LOGIN (its own #login-bg-host) is unaffected.

  (3) CONTAINMENT — prose bubbles carry `contain: layout paint` so a streamed-token append or an
      adaptiveGlass inline-style write invalidates only that bubble, not the whole O(n) transcript.
      `content-visibility: auto` is DELIBERATELY not used (it would desync #chat-history scrollHeight
      that scroll-restore / jump-to-bottom / the F1–F5 "never eat a message" math rely on).

Source-pinned (no DOM runtime in the pytest lane). Roles only, no names, no engine/network.
"""
import os
import re

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*parts):
    with open(os.path.join(FRONTEND, *parts), encoding="utf-8") as f:
        return f.read()


MESH_CSS = _read("static", "css", "meshGradient.css")
THEME_JS = _read("static", "js", "theme.js")
STYLE_CSS = _read("static", "style.css")


def _strip_comments(css):
    return re.sub(r"/\*.*?\*/", "", css, flags=re.S)


def _css_rules(css):
    """Yield (selector_text, declarations) for every LEAF rule (innermost {} pair).
    `[^{}]+\\{[^{}]*\\}` matches only blocks whose body holds no nested braces, so
    @media headers are skipped and their inner rules surface individually."""
    for m in re.finditer(r"([^{}]+)\{([^{}]*)\}", _strip_comments(css)):
        yield m.group(1).strip(), m.group(2)


# ── (2) mesh wallpaper pause ──────────────────────────────────────────────────

def test_mesh_paused_by_default_in_app():
    # the in-app #__wp mesh is PAUSED by default (the still frame) …
    assert re.search(
        r"#__wp \.login-bg-gradient\.is-animated::before,\s*"
        r"#__wp \.login-bg-gradient\.is-animated::after \{[^}]*animation-play-state:\s*paused",
        MESH_CSS, re.S), "in-app mesh must default to PAUSED (still frame)"


def test_mesh_runs_only_full_glass_and_visible():
    # … and only RUNS under the FULL glass tier (body.glass-full) AND while the tab is visible
    # (body without .ow-bg-hidden). EXHAUSTIVE: enumerate every animation-play-state rule in the
    # file and reject ANY `running` whose selectors are not ALL behind the exact double gate —
    # a later rule sneaking `running` in via a different selector must fail this gate.
    gate = "body.glass-full:not(.ow-bg-hidden)"
    running_rules = [
        (sel, decls) for sel, decls in _css_rules(MESH_CSS)
        if re.search(r"animation-play-state\s*:\s*running", decls)
    ]
    assert running_rules, "the gated `running` rule must exist"
    for sel_text, _ in running_rules:
        for sel in sel_text.split(","):
            sel = sel.strip()
            assert sel.startswith(gate), \
                f"`running` outside the {gate} gate: {sel!r}"
            assert "#__wp" in sel, f"`running` must stay scoped to the in-app #__wp mesh: {sel!r}"


def test_mesh_pause_scoped_to_in_app_not_login():
    # EVERY animation-play-state rule (paused AND running) must be scoped to the in-app #__wp
    # host in EVERY selector of its list — parsed per-selector, not a bypassable lookbehind —
    # so the LOGIN mesh (its own #login-bg-host, alone on screen) is never touched.
    aps_rules = [
        (sel, decls) for sel, decls in _css_rules(MESH_CSS)
        if "animation-play-state" in decls
    ]
    assert aps_rules, "the pause/run play-state rules must exist"
    for sel_text, _ in aps_rules:
        for sel in sel_text.split(","):
            sel = sel.strip()
            assert "#__wp" in sel, \
                f"play-state rule not scoped to #__wp (would hit the login mesh): {sel!r}"
    # and the paused default targets the in-app mesh layer specifically.
    assert "#__wp .login-bg-gradient.is-animated::before" in MESH_CSS


def test_reduced_motion_still_freezes_mesh_unchanged():
    # the reduced-motion kill-switch is untouched — still force-kills any animation.
    block = MESH_CSS[MESH_CSS.index("@media (prefers-reduced-motion: reduce)"):]
    assert "animation: none !important" in block


def test_theme_mirrors_tab_visibility_into_body_class():
    # theme.js mirrors document.hidden → body.ow-bg-hidden (document.hidden has no CSS selector),
    # bound once and applied from the mesh render path.
    assert "function _bindMeshVisibility(" in THEME_JS
    body = THEME_JS[THEME_JS.index("function _bindMeshVisibility("):THEME_JS.index("function _renderGlassMesh(")]
    assert "visibilitychange" in body, "must listen for visibilitychange"
    assert re.search(r"classList\.toggle\('ow-bg-hidden',\s*document\.hidden", body), \
        "must toggle body.ow-bg-hidden from document.hidden"
    # it is invoked from the mesh render (so the mirror is live whenever the mesh is mounted).
    render = THEME_JS[THEME_JS.index("function _renderGlassMesh("):]
    render = render[:render.index("function _renderGlassPhoto(")]
    assert "_bindMeshVisibility();" in render


def test_theme_still_reduced_motion_gates_mesh():
    # the mesh still drops .is-animated under reduced motion (perf gate is ADDITIVE, not a replacement).
    render = THEME_JS[THEME_JS.index("function _renderGlassMesh("):]
    render = render[:render.index("function _renderGlassPhoto(")]
    assert "!_meshReducedMotion()" in render


# ── (3) transcript containment ────────────────────────────────────────────────

def test_prose_bubbles_carry_layout_paint_containment():
    m = re.search(r"\.msg-ai,\s*\.msg-user \{([^}]*)\}", STYLE_CSS, re.S)
    assert m, "a .msg-ai, .msg-user containment rule must exist"
    body = m.group(1)
    assert re.search(r"contain:\s*layout\s+paint", body), \
        "prose bubbles must carry `contain: layout paint`"


def test_containment_never_uses_size_or_content_visibility_on_bubbles():
    # `contain: size` would collapse the bubble; `content-visibility: auto` would desync
    # #chat-history scrollHeight (scroll-restore / jump-to-bottom / never-eat-a-message math).
    # EXHAUSTIVE: scan EVERY style.css rule whose selector targets .msg-ai / .msg-user (or the
    # .msg base they inherit from), not just the containment block — a forbidden property added
    # in ANY later bubble rule must fail here.
    bubble_rules = [
        (sel, decls) for sel, decls in _css_rules(STYLE_CSS)
        if re.search(r"\.msg(?:-ai|-user)?(?![\w-])", sel)
    ]
    assert bubble_rules, "bubble rules must exist in style.css"
    for sel, decls in bubble_rules:
        assert not re.search(r"contain\s*:\s*[^;]*\bsize\b", decls), \
            f"`contain: size` on a bubble rule would collapse it: {sel!r}"
        assert "content-visibility" not in decls, \
            f"content-visibility on a bubble rule would desync scrollHeight: {sel!r}"
