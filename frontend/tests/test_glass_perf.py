"""Liquid-glass PERFORMANCE hardening — #738 item #20 SOURCE-PINS.

Perf-only touches to the Liquid Glass layer (frontend/static/js/liquidGlass.js).
No visual/craft change: none of the pinned craft rules (corner-clip, specular
fringe, tint token) or adaptiveGlass.js are touched by these — they only cut
needless repaint/reflow/compositor work.

The contracts pinned here are the ones easy to regress by accident:

  (A) Layout-thrash fix — the pointer-reactive specular does NOT read
      getBoundingClientRect in the hot per-event pointermove handler; the forced
      synchronous layout is deferred to the once-per-frame rAF flush (batch
      reads-then-writes). onSpecPointerMove stashes RAW pointer coords only.

  (B) Observer coalescing + tier respect — the watchMounts MutationObserver bails
      BEFORE its per-node selector scan when (1) a pass is already scheduled for
      the next frame (applyScheduled) or (2) the body is not the Full-Glass tier
      (isFrosted() == body.glass-full). So a streamed DOM churn costs one queued
      pass, and the Off/Frosted tiers do near-zero work per mutation (they do LESS
      work, never more — the reduced-tier perf contract).

The FE has no DOM runtime in pytest, so these are source-pinned like the sibling
glass gates (test_liquid_glass.py / test_liquid_glass_craft.py). Roles only, no
names, no engine/network.
"""
import os

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*parts):
    with open(os.path.join(FRONTEND, *parts), encoding="utf-8") as f:
        return f.read()


JS = _read("static", "js", "liquidGlass.js")


def _fn(name, after):
    """Slice the body of function `name` up to the start of function `after`."""
    start = JS.index("function " + name + "(")
    end = JS.index("function " + after + "(")
    assert start < end, f"{name} must precede {after} in the source"
    return JS[start:end]


# ── (A) layout-thrash: no per-event getBoundingClientRect ─────────────────────

def test_pointermove_defers_layout_read_to_raf_flush():
    move = _fn("onSpecPointerMove", "bindSpec")
    # The hot per-event handler must NOT force a synchronous layout (the CALL, not the
    # word — the explanatory comment names the API it deliberately avoids).
    assert ".getBoundingClientRect(" not in move, (
        "onSpecPointerMove must NOT call getBoundingClientRect per event — a "
        "pointermove storm during streaming would force one layout per event. The "
        "read belongs in the once-per-frame rAF flush."
    )
    # It still stashes the coords and schedules the rAF (the throttle contract).
    assert "specPending = {" in move
    assert "requestAnimationFrame" in move


def test_raf_flush_owns_the_single_layout_read():
    flush = _fn("flushSpec", "onSpecPointerMove")
    # The forced layout is read EXACTLY ONCE per frame, in the flush. Presence alone
    # is too weak: a second getBoundingClientRect sneaking into flushSpec would
    # reintroduce per-frame layout thrash yet still pass a mere `in` check.
    assert flush.count(".getBoundingClientRect(") == 1, (
        "flushSpec must own the single per-frame getBoundingClientRect (fresh rect "
        "each frame keeps it drag-correct)."
    )
    # Reduced-motion still short-circuits the flush (static rim, no pointer chase).
    assert "if (reducedMotion()) return" in flush


# ── (B) watchMounts coalescing + reduced-tier respect ─────────────────────────

def test_watchmounts_bails_before_scan_when_pass_scheduled_or_not_glass():
    # watchMounts precedes the pointer-spec block (specEligible is its first neighbour).
    body = _fn("watchMounts", "specEligible")
    # The early bail must be BEFORE the added-node loop (the `for (var i` scan).
    guard_idx = body.index("if (applyScheduled || !isFrosted()) return;")
    loop_idx = body.index("for (var i = 0; i < muts.length")
    assert guard_idx < loop_idx, (
        "watchMounts must bail on (pass-already-scheduled OR not-Full-Glass) BEFORE "
        "the per-node selector scan — otherwise a streamed DOM churn runs a "
        "querySelector storm, and Off/Frosted tiers do needless work."
    )


def test_watchmounts_tier_guard_uses_isfrosted():
    # The tier gate is the same body.glass-full predicate the apply pass uses, so the
    # observer does near-zero work when the SVG-refraction tier is off.
    body = _fn("watchMounts", "specEligible")
    assert "isFrosted()" in body
