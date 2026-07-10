"""HIG audit (2026-07-09) P2 accessibility fix — F-A11Y-3 (heading hierarchy).

Source-pinned convention checks (no DOM runtime needed), mirroring the style of
test_hig_a11y_p1.py.

F-A11Y-3 — the Theme dialog (#theme-popup, role="dialog", title <h4>Theme</h4>)
nested its section headings as <h2 role="heading" aria-level="5">. That is two
defects at once: the document outline jumped from the dialog title to aria-level 5
with no level in between, and a native <h2> element carrying role="heading"
aria-level="5" is self-contradictory (an element forced to a level it isn't).
Fix: the section headings are real <h5> elements — one level deeper than the h4
dialog title — so the outline is logical and monotonic with no skipped levels, and
no heading element carries a role/aria-level override. The .admin-card h5 CSS rule
preserves the original visual sizing.
"""
import os
import re

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*rel):
    with open(os.path.join(FRONTEND, *rel), encoding="utf-8") as f:
        return f.read()


def _strip_comments(html: str) -> str:
    """Drop HTML comments so a comment that mentions the old markup as prose does
    not count as a real occurrence."""
    return re.sub(r"<!--.*?-->", "", html, flags=re.DOTALL)


def _heading_levels(fragment: str):
    """Native heading element levels (1..6) in document order for a fragment."""
    return [int(m.group(1)) for m in re.finditer(r"<h([1-6])(?:\s[^>]*)?>", fragment)]


# ── F-A11Y-3: no native heading may be forced to a different ARIA level ────────

def test_no_native_heading_carries_aria_level_or_role_heading_override():
    html = _strip_comments(_read("static", "index.html"))
    # A native <h1>..<h6> must never carry role="heading" or aria-level — that is
    # the self-contradictory "element-vs-ARIA mismatch" F-A11Y-3 called out.
    bad = re.findall(r"<h[1-6]\b[^>]*\b(?:role=\"heading\"|aria-level=)", html)
    assert not bad, (
        "a native <hN> heading carries role=\"heading\"/aria-level — a self-contradictory "
        "level override; use a real heading element at the true level instead (F-A11Y-3): "
        + repr(bad)
    )


# ── F-A11Y-3: the Theme dialog outline is monotonic (no skipped levels) ────────

def _theme_dialog_fragment(html: str) -> str:
    start = html.index('<div id="theme-host"')
    # The theme host closes just before the mobile backdrop element.
    end = html.index('<div id="mobile-backdrop"', start)
    return html[start:end]


def test_theme_dialog_heading_outline_is_monotonic():
    html = _strip_comments(_read("static", "index.html"))
    frag = _theme_dialog_fragment(html)
    levels = _heading_levels(frag)
    assert levels, "the Theme dialog should contain headings"
    # The dialog title is the first heading; every subsequent heading may go at
    # most ONE level deeper than the running minimum context — i.e. no jump > +1.
    prev = levels[0]
    for lvl in levels[1:]:
        assert lvl - prev <= 1, (
            f"Theme dialog heading outline skips a level ({prev} -> {lvl}); heading "
            f"levels must not jump more than one deeper (F-A11Y-3). Full outline: {levels}"
        )
        prev = lvl
    # Concretely: the dialog title is <h4> and the section headings are <h5>
    # (exactly one deeper), never <h2>.
    assert levels[0] == 4, f"the Theme dialog title should be <h4>; got h{levels[0]}"
    assert set(levels[1:]) == {5}, (
        "every Theme section heading should be a real <h5> (one deeper than the h4 "
        f"dialog title); got {levels[1:]}"
    )


def test_theme_section_h5_styling_is_pinned():
    """The <h5> section headings must reuse the shared .admin-card h2 sizing so the
    visual appearance is unchanged — enforced by an .admin-card h5 rule."""
    css = _read("static", "style.css")
    m = re.search(r"\.admin-card h2\s*,\s*(?:/\*.*?\*/\s*)?\.admin-card h5\s*\{", css, re.DOTALL)
    assert m, (
        ".admin-card h5 must be styled alongside .admin-card h2 so the Theme dialog's "
        "<h5> section headings keep their original size (F-A11Y-3)"
    )
