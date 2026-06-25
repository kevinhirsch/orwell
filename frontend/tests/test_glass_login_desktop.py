"""Glass login → desktop cohesion.

Two related front-end features that make the app feel like one cohesive "desktop":

  Feature 1 — the GLASS theme's DEFAULT wallpaper MIRRORS the login background for
              EVERY login-bg source (photo / gradient-mesh / particles), not just
              the mesh. It drives the same #__wp layer adaptiveGlass samples, and
              it is the DEFAULT only — an explicit user wallpaper/pattern wins.

  Feature 2 — a macOS-style SIGN-IN TRANSITION: the login screen fades out, then
              the app's persistent surfaces slide in from their adjacent edges on
              the FIRST reveal — once, never on poll / orwell:gamechanged / reload
              (the #752 persistent-surface stability rule) — and reduced-motion is
              honoured (fade only / instant, no slide).

Source-pinned, JS/HTML/CSS-as-text like the other FE chrome gates (the FE has no
DOM runtime in the pytest lane — browser-smoke + responsive-matrix cover the live
DOM; here we pin the wiring + the conventions that drive it).
"""
import os
import re

FE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(rel):
    with open(os.path.join(FE, rel), encoding="utf-8") as fh:
        return fh.read()


# ════════════════════════════════════════════════════════════════════════════
# Feature 1 — the glass default wallpaper mirrors EVERY login-bg source
# ════════════════════════════════════════════════════════════════════════════

def test_login_bg_exports_a_reusable_particle_mounter():
    # theme.js reuses the login's particle renderer (DRY) when the login source is
    # particles — so login_bg.js must expose it.
    lb = _read("static/js/login_bg.js")
    assert "export function mountParticles(" in lb, (
        "login_bg.js must export mountParticles so the glass desktop reuses the "
        "SAME particle field the login renders"
    )


def test_theme_imports_the_shared_particle_mounter():
    js = _read("static/js/theme.js")
    assert "mountParticles as _mountParticles" in js, (
        "theme.js must import login_bg.js's mountParticles (DRY — one renderer)"
    )


def test_glass_default_dispatches_on_the_login_source():
    # The glass default wallpaper branches on resolveLoginBackgroundConfig().source.
    js = _read("static/js/theme.js")
    m = re.search(r"function _renderGlassDefault\([^)]*\)\s*\{(.*?)\n\}", js, re.S)
    assert m, "theme.js must define a source-dispatching _renderGlassDefault()"
    body = m.group(1)
    assert "source" in body
    # Every login-bg source is handled: photo, particles, and the mesh fallthrough.
    assert "_renderGlassPhoto" in body, "the photo source must paint the photo into #__wp"
    assert "_renderGlassParticles" in body, "the particles source must paint the particle field"
    assert "_renderGlassMesh" in body, "gradient/mesh/bundled fall through to the shared mesh"


def test_glass_photo_paints_the_login_photo_into_the_wallpaper_layer():
    js = _read("static/js/theme.js")
    m = re.search(r"function _renderGlassPhoto\([^)]*\)\s*\{(.*?)\n\}", js, re.S)
    assert m, "_renderGlassPhoto must exist"
    body = m.group(1)
    # It uses the resolved photoUrl (the admin's login photo) on the #__wp layer.
    assert "photoUrl" in body, "the glass photo wallpaper must use the resolved login photoUrl"
    assert "backgroundImage" in body, "the photo must be set as #__wp's background-image"
    # And it lays a mesh base first so a slow/broken image never leaves a void.
    assert "_renderGlassMeshBaseInto" in body, (
        "the photo must paint a mesh base first (graceful fallback, like login _mountPhoto)"
    )


def test_glass_particles_are_static_for_performance_documented():
    js = _read("static/js/theme.js")
    m = re.search(r"function _renderGlassParticles\([^)]*\)\s*\{(.*?)\n\}", js, re.S)
    assert m, "_renderGlassParticles must exist"
    body = m.group(1)
    # The desktop mounts the particle field STILL (animate:false) — a documented
    # perf decision (the app + glass refraction are already heavy).
    assert re.search(r"animate:\s*false", body), (
        "the in-app particle wallpaper must mount STILL (animate:false) for performance"
    )
    # The decision is documented in the source comment.
    assert "perf" in body.lower() or "performance" in js.lower()


def test_glass_default_drives_the_shared_wallpaper_layer():
    # All sources funnel through #__wp via _ensureGlassWp so adaptiveGlass keeps
    # adapting (it samples #__wp).
    js = _read("static/js/theme.js")
    assert "function _ensureGlassWp(" in js
    assert "WALLPAPER_ID" in js
    # The clear path tears down ALL source kinds (mesh child, photo, particle canvas).
    m = re.search(r"function _clearGlassMesh\([^)]*\)\s*\{(.*?)\n\}", js, re.S)
    assert m
    clear = m.group(1)
    assert "login-bg-gradient" in clear and "login-bg-photo" in clear and "login-bg-particles" in clear, (
        "switching away must clear EVERY default-wallpaper source from #__wp"
    )


def test_glass_default_is_default_only_explicit_choice_wins():
    # The mirror is the DEFAULT path (the 'glass-mesh' sentinel). An explicit user
    # wallpaper image routes through applyBgImage with pattern 'none' (boot path),
    # so the mirror never overrides a deliberate selection.
    js = _read("static/js/theme.js")
    # Boot: a saved bgImage supersedes the animated/default pattern.
    assert "applyBgPattern(_initBgImage ? 'none' : _initPattern)" in js, (
        "a saved wallpaper image must supersede the glass default pattern on boot"
    )
    # The default sentinel resolves through applyGlassMeshBackground only when the
    # glass-mesh pattern is active.
    assert "if (p === GLASS_MESH_PATTERN) {" in js
    assert "applyGlassMeshBackground()" in js


def test_glass_default_still_resolves_from_the_login_background_config():
    # The mirror reads the SAME public cosmetic config the login page uses.
    js = _read("static/js/theme.js")
    assert "resolveLoginBackgroundConfig" in js
    m = re.search(r"function applyGlassMeshBackground\(\)\s*\{(.*?)\n\}", js, re.S)
    assert m
    body = m.group(1)
    assert "_renderGlassDefault" in body, (
        "applyGlassMeshBackground must render via the source-aware _renderGlassDefault"
    )


# ════════════════════════════════════════════════════════════════════════════
# Feature 2 — the macOS sign-in transition (first-mount-only, reduced-motion aware)
# ════════════════════════════════════════════════════════════════════════════

def test_login_arms_the_transition_flag_and_fades_out():
    html = _read("static/login.html")
    # On successful login the dedicated one-shot flag is set right before navigation.
    assert "ody-signin-transition" in html, (
        "login.html must arm the sign-in transition flag on a successful login"
    )
    assert "sessionStorage.setItem('ody-signin-transition', '1')" in html
    # Phase a: the login screen fades out before navigating (one continuous feel).
    assert "login-leaving" in html, "login.html must fade the screen out before navigating"
    css = _read("static/login.html")
    assert "body.login-leaving" in css and "opacity: 0" in css


def test_login_leaving_respects_reduced_motion():
    html = _read("static/login.html")
    # The fade is skipped (instant navigation) under prefers-reduced-motion.
    assert "_reduced" in html and "prefers-reduced-motion" in html
    # And the CSS neutralises the transition too (belt-and-braces).
    assert re.search(
        r"@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*body\.login-leaving",
        html, re.S,
    ), "login-leaving must be neutralised under reduced motion in CSS"


def test_app_captures_and_consumes_the_flag_once_in_head():
    # The flag is read + REMOVED in index.html's head, BEFORE any module sees it —
    # this is what makes the entrance first-mount-only (consumed exactly once).
    html = _read("static/index.html")
    assert "window.__orwellSigninEntrance" in html, (
        "index.html head must capture the sign-in entrance flag into a global"
    )
    # It removeItem()s the flag immediately (one-shot consume).
    assert "sessionStorage.removeItem('ody-signin-transition')" in html, (
        "the head must CONSUME the flag (removeItem) so it can never replay"
    )


def test_signin_transition_module_exists_and_is_wired():
    js = _read("static/js/signinTransition.js")
    assert "export function playSigninEntrance(" in js
    assert "export function isSigninEntrance(" in js
    # app.js imports it and fires it at the app-reveal (loader-fade) seam.
    app = _read("static/app.js")
    assert "import { playSigninEntrance } from './js/signinTransition.js';" in app
    assert "playSigninEntrance()" in app


def test_entrance_fires_at_the_loader_fade_reveal_seam():
    # The call sits in the same .finally that fades + removes #app-loader (the app
    # shell becomes visible there) — the correct login→app reveal seam.
    app = _read("static/app.js")
    m = re.search(r"getElementById\('app-loader'\)(.*?)playSigninEntrance\(\)", app, re.S)
    assert m, "playSigninEntrance must fire at the app-loader fade/reveal seam"


def test_entrance_is_first_mount_only_gated_on_the_consumed_flag():
    # playSigninEntrance is a no-op unless we arrived from a fresh login (the flag),
    # AND it is idempotent (a second call no-ops). This is the #752 guarantee: it
    # never replays on poll / gamechanged / reload-while-authed.
    js = _read("static/js/signinTransition.js")
    assert "isSigninEntrance()" in js
    assert "_played" in js, "the entrance must be one-shot (idempotent guard)"
    # It must NOT subscribe to the freshness poll / gamechanged dispatcher at all
    # (a comment may MENTION the event to explain why; what's banned is wiring it).
    assert "addEventListener('orwell:gamechanged'" not in js and \
        'addEventListener("orwell:gamechanged"' not in js, (
        "the sign-in entrance must NOT listen to orwell:gamechanged (#752 — it is a "
        "one-shot first-mount reveal, never a refresh animation)"
    )
    assert "setInterval" not in js


def test_entrance_removes_its_class_on_animationend_no_residue():
    # The class is removed on animationend (with a safety timeout) so the surfaces
    # fall back to their persisted geometry — leaving no residue that could let a
    # later restack re-animate (#752).
    js = _read("static/js/signinTransition.js")
    assert "animationend" in js
    assert "classList.remove(ENTRANCE_CLASS)" in js or "classList.remove('signin-entrance')" in js


def test_entrance_respects_reduced_motion():
    js = _read("static/js/signinTransition.js")
    assert "prefers-reduced-motion" in js, "the entrance must check reduced motion"
    # Under reduced motion it returns BEFORE adding the animating class (instant reveal).
    m = re.search(r"if \(_prefersReducedMotion\(\)\) return;", js)
    assert m, "reduced motion must short-circuit before the slide class is added"


def test_entrance_css_slides_each_surface_from_its_adjacent_edge():
    css = _read("static/style.css")
    # macOS-style: each persistent surface slides from its adjacent edge.
    for kf in (
        "@keyframes signin-slide-from-left",
        "@keyframes signin-slide-from-right",
        "@keyframes signin-slide-from-top",
        "@keyframes signin-slide-from-bottom",
        "@keyframes signin-content-in",
    ):
        assert kf in css, f"missing entrance keyframe {kf}"
    # Sidebar ← left, rail/dock → right, top bar ↓ top, composer ↑ bottom, content fade.
    assert "body.signin-entrance #sidebar" in css and "signin-slide-from-left" in css
    assert "body.signin-entrance #gadget-rail" in css and "signin-slide-from-right" in css
    assert "body.signin-entrance .chat-top-bar" in css and "signin-slide-from-top" in css
    assert "body.signin-entrance .chat-input-bar" in css and "signin-slide-from-bottom" in css
    assert "body.signin-entrance .chat-history" in css and "signin-content-in" in css


def test_entrance_css_is_staggered():
    # The four edges are subtly staggered (different animation-delays) so the
    # desktop reads as assembling itself, not one block.
    css = _read("static/style.css")
    block = css[css.index("macOS SIGN-IN TRANSITION"):]
    delays = set(re.findall(r"animation-delay:\s*([0-9.]+s)", block))
    assert len(delays) >= 3, f"the entrance edges must be staggered (distinct delays), got {delays}"


def test_entrance_css_neutralised_under_reduced_motion():
    css = _read("static/style.css")
    block = css[css.index("macOS SIGN-IN TRANSITION"):]
    assert re.search(
        r"@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*body\.signin-entrance[^}]*animation:\s*none",
        block, re.S,
    ), "the entrance keyframes must be neutralised under reduced motion in CSS"
