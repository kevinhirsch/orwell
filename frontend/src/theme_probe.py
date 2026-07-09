"""0114 — the theme-surface-consistency probe's classifier (BLOCKING half).

Companion to `src/visual_geometry.py` (0113) — same split: a browser-side JS extraction pass
(`THEME_PROBE_JS` below, injected via `page.evaluate`) collects RAW facts, and classification —
deciding which raw facts are actual FINDINGS — is pure arithmetic with NO Playwright/browser
import anywhere in this module, so `tests/test_0114_theme_consistency.py` can unit-test it
against synthetic layer-stack fixtures without launching a browser.

The bug this catches (owner-reported): a surface hardcodes a polarity-fixed color (e.g.
`background:#1d2026`) instead of the active theme's token (`var(--panel)` / `var(--bg)`), so on
SOME themes it renders correctly and on others it stays stuck at a foreign color — e.g. a dark
tile that never lightens on the `light` preset. The correct pattern already in use elsewhere in
this codebase is `.gadget-rail .ow-window { background: var(--panel, #1d2026); }` — the token
first, a sensible fallback second (the fallback only ever paints if the token is literally unset,
never as a competing polarity).

## Why "far from --bg/--panel", not "light theme ⇒ white"

There are ~25 themes, including tinted house themes (a dark green `the-feed`) and the neutral
`glass` theme — the gate is NOT "on `light` every surface must be near-white." A surface is
CORRECT iff its rendered background derives from the ACTIVE theme's own `--bg`/`--panel` (however
those resolve for whatever theme is active); it is WRONG iff it renders a color un-derived from
either — i.e. it is stuck at some OTHER theme's (or no theme's) polarity. So the classifier reads
the active theme's OWN computed `--bg`/`--panel` at capture time and compares every registered
surface's OWN rendered background against those two — never a hardcoded expectation of what a
theme's colors "should" be.

## Compositing simplification

A surface's OWN CSS `background-color` may be fully opaque (the common case — and the offending
case, e.g. `background:#0d0f14`), semi-transparent (a `color-mix(...)`/`rgba(...)` wash meant to
tint whatever's beneath it), or fully transparent (inherits its ancestor's paint entirely). The JS
probe walks a BOUNDED ancestor chain (`MAX_LAYERS`) collecting each ancestor's own
`background-color` too, and `composite_layers` alpha-composites them outermost-to-innermost (the
element's own layer paints last, on top) into one effective opaque RGB — the same "paint the DOM
back-to-front" model a browser uses, simplified to a bounded chain instead of the full render tree
(the design note's sanctioned "composite over the parent, or treat near-transparent as inherit"
simplification). A stack that is transparent all the way up (nothing in the chain declares a real
background) composites to `None` — such an element inherits the page's own base color by
construction and cannot itself be an offender.
"""
from __future__ import annotations

import math
import re
from typing import Dict, List, Optional, Tuple, TypedDict

# ── the browser-side extraction pass (kept as a single JS string; imported by
#    scripts/theme_consistency.py and injected via page.evaluate — never executed here) ──
#
# Takes ONE argument object: { selectors: [...], maxLayers: N }. Reads the ACTIVE theme's own
# computed `--bg`/`--panel` custom properties off `:root` ONCE per shot (custom properties are
# NOT normalized to rgb() by getComputedStyle — they come back as whatever literal string
# theme.js's applyColors set, e.g. "#f0ebe3"; the Python side's parse_color handles both hex and
# rgb()/rgba() forms). For every matching VISIBLE, non-zero-size element: walk up to `maxLayers`
# ancestors (element first, outward), recording each one's own computed `background-color` (a
# real CSS property — ALWAYS normalized to rgb()/rgba()/transparent by the browser). Bounded
# (first 300 matches total) so a pathological selector can't wedge the probe.
THEME_PROBE_JS = r"""
(args) => {
  const selectors = args.selectors || [];
  const maxLayers = args.maxLayers || 6;
  const rootCs = getComputedStyle(document.documentElement);
  const tokens = {
    bg: (rootCs.getPropertyValue('--bg') || '').trim(),
    panel: (rootCs.getPropertyValue('--panel') || '').trim(),
  };
  const label = (el) => {
    if (!el) return null;
    const id = el.id ? ('#' + el.id) : '';
    const cls = (typeof el.className === 'string' && el.className.trim())
      ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.') : '';
    return (el.tagName || '').toLowerCase() + id + cls;
  };
  const out = [];
  const seen = new Set();
  let budget = 300;
  for (const sel of selectors) {
    let els;
    try { els = document.querySelectorAll(sel); } catch (e) { continue; }
    for (const el of els) {
      if (budget-- <= 0) break;
      if (seen.has(el)) continue;
      seen.add(el);
      const ecs = getComputedStyle(el);
      if (ecs.display === 'none' || ecs.visibility === 'hidden') continue;
      if (el.offsetParent === null && ecs.position !== 'fixed') continue;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      const layers = [];
      let node = el, depth = 0;
      while (node && node.nodeType === 1 && depth < maxLayers) {
        layers.push(getComputedStyle(node).backgroundColor);
        if (node === document.body || node === document.documentElement) break;
        node = node.parentElement;
        depth++;
      }
      out.push({ selector: sel, id: el.id || null, label: label(el), layers });
    }
  }
  return { tokens, elements: out };
}
"""


class ThemeElement(TypedDict, total=False):
    selector: str
    id: Optional[str]
    label: Optional[str]
    layers: List[str]


class ThemeFinding(TypedDict):
    kind: str            # "foreign-polarity"
    selector: Optional[str]
    id: Optional[str]
    label: Optional[str]
    detail: str


RGB = Tuple[float, float, float]

_HEX_RE = re.compile(r"^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")
_RGB_RE = re.compile(
    r"^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+))?\s*\)$"
)

#: A layer whose alpha is at or below this is treated as fully transparent — it contributes
#: nothing to the composite (avoids a near-zero-alpha rounding artifact registering as a real
#: base layer).
NEAR_TRANSPARENT_ALPHA = 0.03

#: Perceptual-ish "redmean" RGB distance (a well-known, cheap approximation — the same family
#: `visual_pixeldiff.py` avoids for the same documented reason: AA-aware diffing is a bigger
#: algorithm for marginal gain, and this gate has the same "advisory eyeball, blocking floor"
#: posture at the geometry layer). Calibration (see the module docstring's worked examples in
#: `docs/features/0114-theme-surface-consistency.md`): a subtle `color-mix(in srgb, #fff 5%,
#: transparent)` wash over either theme's own panel sits well under 40; a fully foreign fixed
#: color (e.g. a dark `#0d0f14` tile against the `light` preset's near-white panel) sits over
#: 600. The threshold sits comfortably between the two with margin on both sides.
OFFENDER_DISTANCE_THRESHOLD = 90.0


def parse_color(value: Optional[str]) -> Optional[Tuple[float, float, float, float]]:
    """Parse a CSS color string — hex (`#rgb`/`#rrggbb`, as a raw custom-property value comes
    back) or `rgb()`/`rgba()` (as a real computed `background-color` always comes back) — into
    (r, g, b, a) with r/g/b in [0, 255] and a in [0, 1]. Returns None for anything else
    (unparseable / empty / a named color the tokens never use)."""
    if not value:
        return None
    s = value.strip()
    if not s:
        return None
    if s == "transparent":
        return (0.0, 0.0, 0.0, 0.0)
    m = _HEX_RE.match(s)
    if m:
        h = m.group(1)
        if len(h) == 3:
            h = "".join(c * 2 for c in h)
        return (float(int(h[0:2], 16)), float(int(h[2:4], 16)), float(int(h[4:6], 16)), 1.0)
    m = _RGB_RE.match(s)
    if m:
        r, g, b = float(m.group(1)), float(m.group(2)), float(m.group(3))
        a = float(m.group(4)) if m.group(4) is not None else 1.0
        return (r, g, b, a)
    return None


def composite_layers(layers: List[str]) -> Optional[RGB]:
    """Alpha-composite a bounded ancestor chain — `layers[0]` is the element's OWN
    background-color, `layers[1]` its parent, `layers[2]` its grandparent, and so on outward —
    into one effective opaque RGB, painting outermost-first (as a browser paints the DOM
    back-to-front) so the element's own layer always wins where it declares real coverage.

    Returns None when every layer in the chain is transparent/near-transparent (an element that
    declares no background of its own anywhere up the bounded chain — it inherits the page's own
    base paint and is therefore not itself a candidate offender)."""
    parsed = [parse_color(layer) for layer in layers]
    result: Optional[RGB] = None
    for color in reversed(parsed):  # outermost -> innermost
        if color is None:
            continue
        r, g, b, a = color
        if a <= NEAR_TRANSPARENT_ALPHA:
            continue
        if result is None:
            result = (r, g, b)
        else:
            rr, gg, bb = result
            result = (r * a + rr * (1 - a), g * a + gg * (1 - a), b * a + bb * (1 - a))
    return result


def _redmean(c1: RGB, c2: RGB) -> float:
    """A cheap, well-known perceptual RGB distance approximation ("redmean") — see the
    `OFFENDER_DISTANCE_THRESHOLD` docstring for the calibration this threshold was picked
    against."""
    r1, g1, b1 = c1
    r2, g2, b2 = c2
    rmean = (r1 + r2) / 2.0
    dr, dg, db = r1 - r2, g1 - g2, b1 - b2
    return math.sqrt(
        (2 + rmean / 256.0) * dr * dr
        + 4 * dg * dg
        + (2 + (255 - rmean) / 256.0) * db * db
    )


def classify_theme_findings(
    elements: List[ThemeElement], tokens: Dict[str, str],
) -> List[ThemeFinding]:
    """Pure classification over raw extraction facts — no browser dependency.

    A registered surface is a `foreign-polarity` finding when its effective composited
    background is far (beyond `OFFENDER_DISTANCE_THRESHOLD`) from BOTH the active theme's own
    `--bg` and `--panel` tokens — i.e. it renders a color that doesn't derive from either. An
    element whose composited background is close to EITHER token (including a deliberate subtle
    tint over one of them) is not a finding; an element that inherits (no real background
    anywhere in its bounded ancestor chain) cannot be a finding by construction."""
    bg_tok = parse_color(tokens.get("bg"))
    panel_tok = parse_color(tokens.get("panel"))
    bg_rgb = bg_tok[:3] if bg_tok else None
    panel_rgb = panel_tok[:3] if panel_tok else None
    if bg_rgb is None and panel_rgb is None:
        return []  # can't classify without at least one resolved active-theme token

    findings: List[ThemeFinding] = []
    for el in elements:
        effective = composite_layers(el.get("layers") or [])
        if effective is None:
            continue
        distances = []
        if bg_rgb is not None:
            distances.append(_redmean(effective, bg_rgb))
        if panel_rgb is not None:
            distances.append(_redmean(effective, panel_rgb))
        nearest = min(distances)
        if nearest > OFFENDER_DISTANCE_THRESHOLD:
            base = {
                "selector": el.get("selector"), "id": el.get("id"),
                "label": el.get("label") or el.get("id") or el.get("selector"),
            }
            findings.append({
                **base, "kind": "foreign-polarity",
                "detail": (
                    f"rendered bg rgb({effective[0]:.0f},{effective[1]:.0f},{effective[2]:.0f}) "
                    f"is {nearest:.0f} from the active theme's --bg/--panel "
                    f"(threshold {OFFENDER_DISTANCE_THRESHOLD:.0f})"
                ),
            })
    return findings
