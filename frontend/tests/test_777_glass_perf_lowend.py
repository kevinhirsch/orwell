"""#777 — glass-tier low-end AUTO-DOWNGRADE (theme.js) + SVG-refraction CLEAN-DEGRADE
(liquidGlass.js).

Two additive PERF-safety touches to the Full-Glass tier, source-pinned like the sibling
glass gates (test_1315_*, test_adaptive_glass_perf, test_glass_perf) — the pytest lane has
no DOM runtime; the browser-smoke / responsive-matrix gates cover the live DOM.

  #777-3  theme.js — on a CONSTRAINED environment (coarse pointer OR small viewport OR
          sustained low FPS) the glass tier is CLAMPED DOWN to a Frosted ceiling, so a
          mobile/low-end device never pays the concurrent-backdrop-filter + SVG-refraction
          cost of Full glass. It is a RUNTIME cap only — the saved preference is untouched,
          it only ever LOWERS, and it composes with (never overrides) the user's setting.

  #777-2  liquidGlass.js — the refraction cap degrades cleanly: a repeatedly-failing filter
          build (canvas OOM / context loss on a constrained GPU) latches the whole layer OFF
          so the CSS blur-glass baseline stands — no broken glass, no retry storm, no spew.

Roles only, no names, no engine/network.
"""
import os
import re

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*parts):
    with open(os.path.join(FRONTEND, *parts), encoding="utf-8") as f:
        return f.read()


THEME = _read("static", "js", "theme.js")
LG = _read("static", "js", "liquidGlass.js")


# ── #777-3: theme.js low-end auto-downgrade ───────────────────────────────────

def test_glass_tier_ceiling_exists_and_is_exported():
    # A dedicated resolver: the highest tier this environment should render.
    assert "export function glassTierCeiling(" in THEME
    m = re.search(r"export function glassTierCeiling\(\)\s*\{(.*?)\n\}", THEME, re.S)
    assert m, "glassTierCeiling body not found"
    body = m.group(1)
    # constrained ⇒ frosted (drop refraction), else full (no ceiling).
    assert "'frosted'" in body and "'full'" in body
    assert "_constrainedEnvironment()" in body


def test_constrained_environment_reads_all_three_signals():
    m = re.search(r"function _constrainedEnvironment\(\)\s*\{(.*?)\n\}", THEME, re.S)
    assert m, "_constrainedEnvironment body not found"
    body = m.group(1)
    assert "_lowFps" in body, "sustained low-FPS must be a downgrade signal"
    assert "_coarsePointer()" in body, "a coarse pointer must be a downgrade signal"
    assert "_smallViewport()" in body, "a small viewport must be a downgrade signal"


def test_coarse_pointer_and_small_viewport_helpers():
    cp = re.search(r"function _coarsePointer\(\)\s*\{(.*?)\n\}", THEME, re.S).group(1)
    assert "(pointer: coarse)" in cp, "_coarsePointer must query the coarse-pointer media query"
    sv = re.search(r"function _smallViewport\(\)\s*\{(.*?)\n\}", THEME, re.S).group(1)
    assert "innerWidth" in sv and "LOWEND_VIEWPORT_W" in sv, \
        "_smallViewport must compare innerWidth to the small-screen threshold"
    # the threshold mirrors liquidGlass.js MOBILE_W (one 'small' definition).
    assert re.search(r"const LOWEND_VIEWPORT_W = 768;", THEME)


def test_apply_glass_tier_clamps_to_the_ceiling():
    m = re.search(r"export function applyGlassTier\(tier\)\s*\{(.*?)\n\}", THEME, re.S)
    assert m, "applyGlassTier body not found"
    body = m.group(1)
    # the requested tier is clamped DOWN to the environment ceiling before the classes flip.
    assert "_clampTierToCeiling(requested)" in body, \
        "#777-3: applyGlassTier must clamp the requested tier to the low-end ceiling"
    # it still drives the SAME two body classes (the shared contract is unchanged).
    assert "classList.toggle('theme-frosted'" in body
    assert "classList.toggle('glass-full'" in body
    # the raw request is remembered so a live env change can re-apply.
    assert "_lastRequestedTier = requested" in body
    # the live-ceiling watch is armed (so a viewport/pointer/fps change re-evaluates).
    assert "_bindLowEndWatch()" in body


def test_clamp_only_ever_lowers_never_raises():
    m = re.search(r"function _clampTierToCeiling\(tier\)\s*\{(.*?)\n\}", THEME, re.S)
    assert m, "_clampTierToCeiling body not found"
    body = m.group(1)
    # rank comparison: return the ceiling ONLY when the requested rank is strictly higher.
    assert "_TIER_RANK[t] > _TIER_RANK[ceil]" in body, \
        "#777-3: the clamp must only downgrade (requested rank > ceiling rank), never upgrade"
    # the ranks put full above frosted above normal.
    assert re.search(r"const _TIER_RANK = \{ normal: 0, frosted: 1, full: 2 \};", THEME)


def test_downgrade_does_not_mutate_the_saved_preference():
    # The clamp is a RENDER-only cap: applyGlassTier must NOT call save()/_saveFull — the
    # user's explicit tier stays in storage, the DOM just renders the capped tier.
    m = re.search(r"export function applyGlassTier\(tier\)\s*\{(.*?)\n\}", THEME, re.S)
    body = m.group(1)
    assert "save(" not in body and "_saveFull(" not in body, \
        "#777-3: the low-end downgrade must never persist — the saved preference is untouched"


def test_low_fps_sampler_is_one_shot_and_only_downgrades():
    m = re.search(r"function _sampleLowFps\(\)\s*\{(.*?)\n\}", THEME, re.S)
    assert m, "_sampleLowFps body not found"
    body = m.group(1)
    # one-shot (guarded) + only samples while Full-glass is actually live (nothing to gain otherwise).
    assert "_fpsSampled" in body
    assert "classList.contains('glass-full')" in body, \
        "the fps sample must only run while Full-glass is rendered"
    # a low sample can only LATCH the low-fps ceiling (a downgrade), never raise a tier.
    assert "_lowFps = true;" in body
    assert "_FPS_LOWEND_THRESHOLD" in THEME


def test_live_ceiling_watch_reapplies_on_env_change():
    m = re.search(r"function _bindLowEndWatch\(\)\s*\{(.*?)\n  \}", THEME, re.S)
    assert m, "_bindLowEndWatch body not found"
    body = m.group(1)
    # bound once (lazy) and re-applies the last requested tier on resize / pointer-type change.
    assert "_lowEndWatchBound" in body
    assert "addEventListener('resize'" in body
    assert "(pointer: coarse)" in body
    assert "_lastRequestedTier" in body, "the re-apply must use the un-clamped requested tier"


# ── #777-2: liquidGlass.js clean-degrade circuit breaker ──────────────────────

def test_refraction_circuit_breaker_state_exists():
    assert "var MAX_BUILD_FAILURES" in LG
    assert "var _buildFailures = 0;" in LG
    assert "var _refractionDisabled = false;" in LG


def test_filter_build_is_guarded_and_latches_off_on_repeated_failure():
    m = re.search(r"function filterFor\([^)]*\)\s*\{(.*?)\n  \}", LG, re.S)
    assert m, "filterFor body not found"
    body = m.group(1)
    # the throwing canvas build is wrapped; a clean build resets the failure streak.
    assert "buildMapDataUrl(" in body
    assert "_buildFailures = 0;" in body, "a clean build must reset the failure streak"
    # repeated failures latch the whole layer off (clearAll) and return null.
    assert "++_buildFailures >= MAX_BUILD_FAILURES" in body
    assert "_refractionDisabled = true;" in body
    assert "clearAll();" in body
    assert "return null;" in body, "a failed build returns null so the caller leaves the CSS glass"


def test_apply_to_leaves_css_glass_when_build_fails():
    m = re.search(r"function applyTo\(el\)\s*\{(.*?)\n  \}", LG, re.S)
    assert m, "applyTo body not found"
    body = m.group(1)
    # a null filter id ⇒ clear our override and bail (the CSS blur-glass baseline stands).
    assert re.search(r"if \(!id\)\s*\{\s*clearFrom\(el\);\s*return;\s*\}", body), \
        "#777-2: applyTo must clear + bail on a null filter id (leave the CSS glass)"


def test_apply_pass_honours_the_latch():
    m = re.search(r"function applyPass\(\)\s*\{(.*?)\n    var targets", LG, re.S)
    assert m, "applyPass head not found"
    head = m.group(1)
    # once latched, the whole pass stands down to CSS glass.
    assert "_refractionDisabled" in head
    assert "clearAll();" in head


def test_cap_still_present_and_mobile_is_lower():
    # The concurrent-refraction cap (the thing that degrades gracefully on low-end) is intact.
    assert "MAX_LIVE_SURFACES" in LG and "activeMaxSurfaces" in LG
    d = int(re.search(r"MAX_LIVE_SURFACES\s*=\s*(\d+)", LG).group(1))
    m = int(re.search(r"MAX_LIVE_SURFACES_MOBILE\s*=\s*(\d+)", LG).group(1))
    assert m < d, "the mobile cap must stay strictly lower than desktop"


def test_no_console_spew_in_liquid_glass():
    # 'no console spew' — the whole module stays silent (fail-soft catches, no console.*).
    assert "console." not in LG, "liquidGlass.js must not log (clean degrade, no spew)"
