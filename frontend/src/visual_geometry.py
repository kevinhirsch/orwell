"""0113 — the visual-regression harness's geometry/off-screen detector (BLOCKING half).

Every screenshot the harness (`scripts/visual_regression.py`) takes is preceded by ONE DOM
pass in the real browser page: a JS probe (`GEOMETRY_PROBE_JS` below) walks a curated set of
"registered" surface selectors and extracts RAW geometry facts — bounding rects, the nearest
`overflow:hidden` ancestor's rect (if any), and an `elementFromPoint` identity probe at the
element's own center. That raw extraction is the only part that NEEDS a browser.

Classification — deciding which raw facts are actual FINDINGS (off-viewport, clipped-by-
ancestor, zero-size, covered) — is pure arithmetic over those facts and lives here, with NO
Playwright/browser import anywhere in this module. That split is deliberate: it lets
`tests/test_0113_visual_harness.py` unit-test the classifier against synthetic DOM-rect
fixtures without launching a browser (fast, xdist-safe, no `sync_playwright` string in that
test file so `conftest.py`'s structural browser-marker scan leaves it in the fast lane).

Per the spec (`docs/features/0113-visual-regression-harness.md`): geometry findings BLOCK the
CI job; pixel diffs (see `visual_pixeldiff.py`) only ADVISE.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional, TypedDict

# ── the browser-side extraction pass (kept as a single JS string; imported by
#    scripts/visual_regression.py and injected via page.evaluate — never executed here) ──
#
# Takes ONE argument object: { selectors: [...], overlays: [...] }. For every selector, for
# every matching VISIBLE element: capture its rect, the nearest overflow:hidden/clip
# ancestor's rect (or null), and whether the element at its own center-point (via
# elementFromPoint) is itself/a descendant/an ancestor (i.e. legitimately on top) versus some
# other node covering it. A covering node that matches — or sits inside — one of the
# `overlays` selectors is stamped `coveredByOverlay: true`: a DELIBERATE overlay layer (a
# modal scrim, the boot loader, an open drawer, a floating kit window) covering background
# content is the layering system WORKING, not a finding — the first live run produced 223
# covered-findings of which 219 were exactly this class (ow-scrim/grail-scrim/app-loader/
# settings-modal/open-drawer). Bounded (first 400 matches total) so a pathological selector
# can't wedge the probe.
GEOMETRY_PROBE_JS = r"""
(args) => {
  const selectors = args.selectors || [];
  const overlaySel = (args.overlays || []).join(', ');
  const out = [];
  const vw = window.innerWidth, vh = window.innerHeight;
  const label = (el) => {
    if (!el) return null;
    const id = el.id ? ('#' + el.id) : '';
    const cls = (typeof el.className === 'string' && el.className.trim())
      ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.') : '';
    return (el.tagName || '').toLowerCase() + id + cls;
  };
  let budget = 400;
  for (const sel of selectors) {
    let els;
    try { els = document.querySelectorAll(sel); } catch (e) { continue; }
    for (const el of els) {
      if (budget-- <= 0) break;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      if (el.offsetParent === null && cs.position !== 'fixed') continue;
      const r = el.getBoundingClientRect();
      const rect = { left: r.left, top: r.top, right: r.right, bottom: r.bottom,
                     width: r.width, height: r.height };
      // nearest overflow:hidden/clip ancestor (excluding <body>/<html>, which legitimately
      // clip the whole page and are not a "findable" ancestor for this purpose).
      let clippingAncestor = null;
      let anc = el.parentElement;
      while (anc && anc !== document.body && anc !== document.documentElement) {
        const acs = getComputedStyle(anc);
        if (acs.overflow === 'hidden' || acs.overflowX === 'hidden' || acs.overflowY === 'hidden'
            || (acs.clipPath && acs.clipPath !== 'none')) {
          const ar = anc.getBoundingClientRect();
          clippingAncestor = { label: label(anc),
            rect: { left: ar.left, top: ar.top, right: ar.right, bottom: ar.bottom,
                    width: ar.width, height: ar.height } };
          break;
        }
        anc = anc.parentElement;
      }
      // covered-element probe: what's topmost at the element's own visual center?
      let coveredBy = null, coveredBySelfOrDescendant = true, coveredByOverlay = false;
      if (rect.width > 0 && rect.height > 0) {
        const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
        if (cx >= 0 && cx <= vw && cy >= 0 && cy <= vh) {
          const top = document.elementFromPoint(cx, cy);
          if (top && top !== el) {
            const related = el.contains(top) || top.contains(el);
            if (!related) {
              coveredBy = label(top);
              coveredBySelfOrDescendant = false;
              if (overlaySel) {
                try {
                  coveredByOverlay = !!(top.closest && top.closest(overlaySel));
                } catch (e) { /* a malformed overlay selector never breaks the probe */ }
              }
            }
          }
        }
      }
      out.push({
        selector: sel, id: el.id || null, label: label(el), rect,
        clippingAncestor, coveredBy, coveredBySelfOrDescendant, coveredByOverlay,
      });
    }
  }
  return out;
}
"""


class RectDict(TypedDict, total=False):
    left: float
    top: float
    right: float
    bottom: float
    width: float
    height: float


class ElementGeometry(TypedDict, total=False):
    selector: str
    id: Optional[str]
    label: Optional[str]
    rect: RectDict
    clippingAncestor: Optional[Dict[str, Any]]
    coveredBy: Optional[str]
    coveredBySelfOrDescendant: bool
    coveredByOverlay: bool


class GeometryFinding(TypedDict):
    kind: str            # "zero-size" | "off-viewport" | "clipped-by-ancestor" | "covered"
    selector: Optional[str]
    id: Optional[str]
    label: Optional[str]
    detail: str


#: 1px of grace for sub-pixel rounding, matching the tolerance already used by
#: `responsive_matrix.py`'s `_intersects`.
_GRACE = 1.0


def classify_shot_geometry(elements: List[ElementGeometry], viewport: Dict[str, float],
                           ) -> List[GeometryFinding]:
    """Pure classification over raw extraction facts — no browser dependency.

    Four finding kinds, checked in this order per element (an element that is zero-size is
    reported once and skipped for the rest — a 0x0 node can't be meaningfully off-viewport/
    clipped/covered too):

      1. ``zero-size``           — rendered but occupies no visual area.
      2. ``off-viewport``        — entirely outside the current viewport bounds.
      3. ``clipped-by-ancestor`` — the element's box escapes a real (`overflow:hidden`)
         ancestor's box — content is being cut off, not merely scrollable.
      4. ``covered``             — a probe at the element's own center resolves to some
         OTHER element that is neither an ancestor nor a descendant (something is painted
         on top of it that shouldn't be — a stray element, an overlapping panel). A covering
         node the probe stamped ``coveredByOverlay`` (it sits inside a declared deliberate
         overlay layer — a modal scrim, the boot loader, an open drawer, a kit window) is
         NOT a finding: overlays covering background content is the layering system working.
    """
    vw = float(viewport.get("width") or 0)
    vh = float(viewport.get("height") or 0)
    findings: List[GeometryFinding] = []
    for el in elements:
        rect = el.get("rect") or {}
        base = {"selector": el.get("selector"), "id": el.get("id"),
               "label": el.get("label") or el.get("id") or el.get("selector")}
        width = float(rect.get("width") or 0)
        height = float(rect.get("height") or 0)
        if width <= 0 or height <= 0:
            findings.append({**base, "kind": "zero-size",
                             "detail": f"{width:.0f}x{height:.0f}"})
            continue

        left = float(rect.get("left") or 0)
        top = float(rect.get("top") or 0)
        right = float(rect.get("right") or (left + width))
        bottom = float(rect.get("bottom") or (top + height))
        if right <= 0 or bottom <= 0 or left >= vw or top >= vh:
            findings.append({**base, "kind": "off-viewport",
                             "detail": f"rect=({left:.0f},{top:.0f},{right:.0f},{bottom:.0f}) "
                                       f"viewport={vw:.0f}x{vh:.0f}"})
            continue

        clip = el.get("clippingAncestor")
        if clip:
            ar = clip.get("rect") or {}
            aleft = float(ar.get("left") or 0)
            atop = float(ar.get("top") or 0)
            aright = float(ar.get("right") or 0)
            abottom = float(ar.get("bottom") or 0)
            if (left < aleft - _GRACE or right > aright + _GRACE
                    or top < atop - _GRACE or bottom > abottom + _GRACE):
                findings.append({**base, "kind": "clipped-by-ancestor",
                                 "detail": f"ancestor={clip.get('label')} "
                                           f"el=({left:.0f},{top:.0f},{right:.0f},{bottom:.0f}) "
                                           f"ancestor-box=({aleft:.0f},{atop:.0f},"
                                           f"{aright:.0f},{abottom:.0f})"})

        covered_by = el.get("coveredBy")
        if (covered_by and not el.get("coveredBySelfOrDescendant", True)
                and not el.get("coveredByOverlay", False)):
            findings.append({**base, "kind": "covered", "detail": f"covered by {covered_by}"})

    return findings
