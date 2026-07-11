"""#764 — login particle-canvas PERF BUDGET (login_bg.js).

Additive budget caps on the animated login particle field, source-pinned like the
sibling glass gates (the pytest lane has no DOM runtime; login boots the field only in
the browser). The particle field is an O(N²) neighbour-link render loop, so:

  • low-end density cap — a coarse pointer OR a small viewport caps the particle COUNT
    well below the configured density (small GPUs; the link pass is the cost).
  • visibility pause — the render loop STOPS while the tab is hidden and resumes on
    visibilitychange, so a backgrounded login tab never burns the O(N²) pass.

Roles only, no names, no engine/network.
"""
import os
import re

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*parts):
    with open(os.path.join(FRONTEND, *parts), encoding="utf-8") as f:
        return f.read()


JS = _read("static", "js", "login_bg.js")


def test_lowend_env_helper_reads_coarse_pointer_and_small_viewport():
    m = re.search(r"function _isLowEndEnv\(\)\s*\{(.*?)\n\}", JS, re.S)
    assert m, "_isLowEndEnv helper not found"
    body = m.group(1)
    assert "(pointer: coarse)" in body, "must treat a coarse pointer as low-end"
    assert "innerWidth" in body and "LOWEND_VIEWPORT_W" in body, \
        "must treat a small viewport as low-end"
    # the threshold mirrors theme.js / liquidGlass.js MOBILE_W.
    assert re.search(r"const LOWEND_VIEWPORT_W = 768;", JS)


def test_particle_count_is_capped_on_low_end():
    assert re.search(r"const LOWEND_PARTICLE_CAP = \d+;", JS), \
        "a hard particle-count cap constant must exist"
    m = re.search(r"function _mountParticles\([^)]*\)\s*\{(.*?)\n\}", JS, re.S)
    assert m, "_mountParticles body not found"
    body = m.group(1)
    # N is the configured density on a capable device, but Math.min(density, cap) on low-end.
    assert "_isLowEndEnv()" in body, "the particle mount must consult the low-end signal"
    assert re.search(r"Math\.min\(particles\.density,\s*LOWEND_PARTICLE_CAP\)", body), \
        "#764: low-end must cap the particle COUNT to LOWEND_PARTICLE_CAP"


def test_render_loop_pauses_when_tab_hidden():
    m = re.search(r"function step\(\)\s*\{(.*?)\n  \}", JS, re.S)
    assert m, "the particle step() loop not found"
    body = m.group(1)
    # while hidden, step() bails WITHOUT rescheduling the rAF (the loop stops).
    assert re.search(r"if \(document\.hidden\)\s*\{[^}]*return;", body), \
        "#764: step() must bail (no reschedule) while the tab is hidden"
    # normal frames still schedule the next one.
    assert "requestAnimationFrame(step)" in body


def test_loop_resumes_on_visibilitychange_for_animated_field_only():
    m = re.search(r"function _mountParticles\([^)]*\)\s*\{(.*?)\n\}", JS, re.S)
    body = m.group(1)
    # a visibilitychange listener re-schedules the loop when the tab returns...
    assert "visibilitychange" in body, "#764: the animated field must resume on visibilitychange"
    assert re.search(r"if \(!document\.hidden && !raf\)", body), \
        "resume must only fire when visible AND the loop is currently stopped (no double-schedule)"
    # ...and ONLY the animated field wires it (the still in-app field has no loop to resume).
    resume = JS[JS.index("if (animate) { step(); }"):]
    resume = resume[:resume.index("return canvas;")]
    assert "if (animate) {" in resume and "visibilitychange" in resume, \
        "the resume listener must be gated on `animate` (still field never schedules a loop)"


def test_still_field_shape_unchanged():
    # The shared exported mountParticles still supports the still (animate:false) in-app
    # path — the budget work is additive, not a behaviour swap.
    assert "export function mountParticles(" in JS
    assert "if (animate) { step(); } else { draw(); }" in JS
