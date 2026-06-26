"""#977 — the cast window must stay resizeable / responsive (regression guard, source-pinned).

CI can't drive the live stack here, so we pin the WIRING by reading the static asset —
the same pattern as test_cast_ia_cluster.py / test_s_responsive_mechanism.py.

The regression (cause, file:line):
  #894/#923 made the cast roster a responsive horizontal gallery whose columns-per-page
  adapt to the WINDOW width — implemented by putting `container-type: inline-size` on the
  `#orwell-cast` window element (so its @container queries key off the window's own width).
  `container-type: inline-size` applies INLINE-SIZE CONTAINMENT: the element's width is
  computed WITHOUT regard to its contents.

  Separately, #902/#896 added a resize CAP to the OrwellWindow kit
  (static/js/windowResize.js): a window may not grow past
  `min(naturalContentWidth, viewport − margin)`, where `naturalContentWidth` measures the
  window at `width: max-content` to learn how wide the content genuinely wants.

  Together these two regressed: a size-contained `#orwell-cast` reports ~0 at
  `width: max-content`, so the cap collapsed to the kit minimum and the cast window could
  no longer be dragged wider — the gallery's responsive @container reflow stayed intact but
  the OUTER window was frozen at its default 2-column width.

The fix (cast-scoped, no kit change):
  declare `contain-intrinsic-size` on `#orwell-cast` — the standard companion to size
  containment — so the kit's `naturalContentWidth` reads a real, generous content want
  (covering the 1→4-column @container range) and the window resizes freely, WITHOUT pinning
  the live floor (the kit's inline width still governs the rendered size).

These gates fail if either half of the fix is removed or if the gallery's responsive
@container tiers (the reflow logic) regress.
"""
import os
import re

FE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CAST_JS = os.path.join(FE, "static", "js", "orwellCast.js")


def _read():
    with open(CAST_JS, encoding="utf-8") as fh:
        return fh.read()


def _orwell_cast_rule(src):
    """The body of the top-level `#orwell-cast { ... }` rule (the window-sizing block)."""
    m = re.search(r"#orwell-cast\s*\{(.*?)\}", src, re.DOTALL)
    assert m, "#orwell-cast base rule not found in orwellCast.js"
    return m.group(1)


def test_cast_window_still_declares_inline_size_container():
    """The responsive context the gallery reflows against (must stay — #894)."""
    body = _orwell_cast_rule(_read())
    assert re.search(r"container-type:\s*inline-size", body), (
        "#orwell-cast lost `container-type: inline-size` — the gallery's @container "
        "reflow keys off the window width and would stop responding."
    )


def test_cast_window_declares_contain_intrinsic_size():
    """The #977 fix: a size-contained window MUST provide an intrinsic-size placeholder so
    the kit's resize-cap (naturalContentWidth) reads a real content want and the window can
    be dragged wider than its minimum."""
    body = _orwell_cast_rule(_read())
    assert re.search(r"contain-intrinsic-size:", body), (
        "#orwell-cast is `container-type: inline-size` (size-contained) but declares no "
        "`contain-intrinsic-size` — the kit resize-cap (#896 naturalContentWidth) measures "
        "~0 and pins the window at its minimum: it cannot be resized. This is exactly the "
        "#977 regression."
    )


def test_contain_intrinsic_size_width_covers_responsive_range():
    """The intrinsic-size width must be generous enough to let the window grow through the
    gallery's widest @container tier (the 4-column breakpoint at >=620px); otherwise the cap
    would stop the window short of its own responsive range."""
    body = _orwell_cast_rule(_read())
    m = re.search(r"contain-intrinsic-size:\s*[^;]*?(\d+)px", body)
    assert m, "contain-intrinsic-size has no px width to cap against"
    width = int(m.group(1))
    # The widest @container tier below is >=620px (4 columns). The cap must clear it.
    assert width >= 620, (
        f"contain-intrinsic-size width is {width}px but the cast gallery reflows up to a "
        f">=620px (4-column) @container tier — the resize cap would freeze before reaching it."
    )


def test_gallery_responsive_container_tiers_intact():
    """The reflow logic itself: the @container tiers that drive columns-per-page must remain
    (1 col narrow / 2 default / 3 at >=480 / 4 at >=620)."""
    src = _read()
    assert re.search(r"@container[^{]*max-width:\s*240px", src), "lost the 1-column narrow tier"
    assert re.search(r"@container[^{]*min-width:\s*480px", src), "lost the 3-column (>=480) tier"
    assert re.search(r"@container[^{]*min-width:\s*620px", src), "lost the 4-column (>=620) tier"
    assert re.search(r"--oc-cols:\s*\d", src), "lost the --oc-cols column variable the tiers set"


def test_cast_window_does_not_opt_out_of_kit_resize():
    """The cast window must NOT pass `resizable: false` to the kit (the kit default is
    resizable: true; an explicit opt-out would also kill resize)."""
    src = _read()
    assert "resizable: false" not in src and "resizable:false" not in src, (
        "the cast window passes `resizable: false` to OrwellWindowKit.create — it must stay "
        "resizeable (kit default)."
    )
