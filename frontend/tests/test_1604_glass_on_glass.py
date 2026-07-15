"""#1604 / KIT-G-05 — FORBID GLASS-ON-GLASS (nested cards de-glass).

Owner ruling (LIQUID_GLASS_REFERENCE.md §1: "always avoid glass on glass … use fills,
transparency, and vibrancy for the top elements"): a glass CARD (.og-card / .on-card)
nested inside an already-glass surface — a kit window body (.ow-window > .ow-body), a
modal, or another card — must NOT carry its own backdrop sample. Two independently-
sampling glass planes stacked read muddy/illegible, so the nested card DROPS its own
backdrop-filter and rides the parent's SINGLE glass sample with a vibrant (opaque-ish)
fill (mirroring how a .ow-btn-group shares one sample).

liquidGlass.js already excludes nested cards from the LIVE SVG refraction
(isNestedGlassCard); this gate pins the CSS frosted-FALLBACK side so a regression that
re-introduces glass-on-glass — a nested .og-card/.on-card that keeps its own
backdrop-filter — fails. Plus a demo gate: element_kit_demo.html must render the
composition so it's visually exercised and can't regress unseen. Source-pinned (no
browser).
"""
import os
import re

FE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(rel):
    with open(os.path.join(FE, rel), encoding="utf-8") as fh:
        return fh.read()


def _strip_css_comments(css):
    return re.sub(r"/\*.*?\*/", "", css, flags=re.S)


CSS = _strip_css_comments(_read("static/style.css"))
DEMO = _read("static/element_kit_demo.html")


def _rule_blocks(css):
    """Yield (selector_list, declaration_body) for every plain rule. `[^{}]+` can't cross
    a brace, so a rule nested inside an @media is captured as its own inner block — good
    enough for the flat de-glass rule this gate guards (it is top-level)."""
    for m in re.finditer(r"([^{}]+)\{([^{}]*)\}", css):
        yield m.group(1).strip(), m.group(2)


# `"backdrop-filter: none" in body` is ALSO satisfied by "-webkit-backdrop-filter: none"
# (the former is a substring of the latter), so a substring check would pass on the prefixed
# declaration alone — defeating a gate meant to pin the UNPREFIXED property. Match the real
# unprefixed declaration with a negative-lookbehind boundary.
_UNPREFIXED_NONE = re.compile(r"(?<!-webkit-)backdrop-filter:\s*none")


def _has_unprefixed_none(body):
    return bool(_UNPREFIXED_NONE.search(body))


def test_nested_glass_card_deglass_rule_exists():
    """A frosted rule that nests .og-card/.on-card inside .ow-window/.ow-body (the window
    /body glass surface) MUST drop BOTH backdrop-filter properties — no second sample."""
    hits = []
    for sel, body in _rule_blocks(CSS):
        if "theme-frosted" not in sel:
            continue
        if not re.search(r"\.(ow-window|ow-body)\s+\.(og|on)-card", sel):
            continue
        if _has_unprefixed_none(body) and "-webkit-backdrop-filter: none" in body:
            hits.append(sel)
    assert hits, (
        "#1604 regression: no frosted rule de-glasses a .og-card/.on-card nested inside "
        ".ow-window/.ow-body (must drop backdrop-filter: none + -webkit-backdrop-filter: "
        "none). Glass-on-glass would return."
    )


def test_deglass_covers_the_window_body_card_composition():
    """The exact composition the ruling names — a card nested inside .ow-window AND inside
    .ow-body — must be de-glassed. Checked across the de-glassing frosted rules so it is
    robust to the rule being split, but pinned to the real selector forms."""
    covered = "\n".join(
        sel for sel, body in _rule_blocks(CSS)
        if "theme-frosted" in sel and _has_unprefixed_none(body)
    )
    assert re.search(r"\.ow-window\s+\.og-card", covered), (
        "#1604: a .og-card nested under .ow-window must be de-glassed."
    )
    assert re.search(r"\.ow-body\s+\.og-card", covered), (
        "#1604: a .og-card nested under .ow-body must be de-glassed."
    )


def test_deglass_fallback_uses_a_non_glass_fill_not_transparent():
    """The de-glassed card must ride the parent glass with a VIBRANT (opaque-ish) fill,
    not just vanish — the rule sets a non-transparent background so the card still reads
    as a distinct 'thin overlay that is part of the material' (HIG §1)."""
    for sel, body in _rule_blocks(CSS):
        if "theme-frosted" not in sel:
            continue
        if not re.search(r"\.(ow-window|ow-body)\s+\.(og|on)-card", sel):
            continue
        if not _has_unprefixed_none(body):
            continue
        assert "background-color" in body, (
            "#1604: the de-glassed nested card must set a vibrant fill (background-color), "
            "so it reads as part of the parent material rather than a second glass plane."
        )
        return
    raise AssertionError("no #1604 de-glass rule found to check the fill on")


def test_demo_exercises_nested_glass_card():
    """element_kit_demo.html renders a .og-card nested inside a .ow-window > .ow-body so
    the de-glass fallback is visually exercised (source-order nesting check)."""
    anchor = DEMO.find('id="ek-deglass"')
    assert anchor != -1, (
        "the #1604 de-glass demo composition (#ek-deglass) is missing from element_kit_demo.html"
    )
    frag = DEMO[anchor:anchor + 1400]
    assert 'class="ow-window"' in frag, "the demo composition must contain a .ow-window"
    assert 'class="ow-body"' in frag, "the demo composition must contain a .ow-body"
    assert 'class="og-card"' in frag, "the demo composition must nest a .og-card"
    # the card is INSIDE the body → .ow-body appears before .og-card in source order.
    assert frag.index('class="ow-body"') < frag.index('class="og-card"'), (
        "the nested .og-card must sit inside the .ow-body (glass-on-glass composition)"
    )
