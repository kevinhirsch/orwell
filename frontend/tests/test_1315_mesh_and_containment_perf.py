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


# ── (2) mesh wallpaper pause ──────────────────────────────────────────────────

def test_mesh_paused_by_default_in_app():
    # the in-app #__wp mesh is PAUSED by default (the still frame) …
    assert re.search(
        r"#__wp \.login-bg-gradient\.is-animated::before,\s*"
        r"#__wp \.login-bg-gradient\.is-animated::after \{[^}]*animation-play-state:\s*paused",
        MESH_CSS, re.S), "in-app mesh must default to PAUSED (still frame)"


def test_mesh_runs_only_full_glass_and_visible():
    # … and only RUNS under the FULL glass tier (body.glass-full) AND while the tab is visible
    # (body without .ow-bg-hidden). Both gates in the one selector.
    m = re.search(
        r"body\.glass-full:not\(\.ow-bg-hidden\) #__wp \.login-bg-gradient\.is-animated::before,\s*"
        r"body\.glass-full:not\(\.ow-bg-hidden\) #__wp \.login-bg-gradient\.is-animated::after \{"
        r"[^}]*animation-play-state:\s*running",
        MESH_CSS, re.S)
    assert m, "mesh may only RUN under body.glass-full AND a visible tab"


def test_mesh_pause_scoped_to_in_app_not_login():
    # the pause/run rules are scoped to #__wp so the LOGIN mesh (its own host) keeps animating.
    for sel in re.findall(r"[^\n{}]*animation-play-state:\s*(?:paused|running)", MESH_CSS):
        pass  # (the block selectors are asserted above; this documents the intent)
    # neither pause nor run rule may target the bare .login-bg-gradient (that would hit login).
    assert "#__wp .login-bg-gradient.is-animated::before" in MESH_CSS
    assert not re.search(r"(?<!#__wp )(?<!\) )\.login-bg-gradient\.is-animated::before,?\s*\n?\s*"
                         r"\.login-bg-gradient\.is-animated::after \{[^}]*animation-play-state",
                         MESH_CSS, re.S)


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
    m = re.search(r"\.msg-ai,\s*\.msg-user \{([^}]*)\}", STYLE_CSS, re.S)
    body = m.group(1)
    assert "contain: size" not in body and "contain:size" not in body
    assert "content-visibility" not in body
