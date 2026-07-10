"""Shared helpers for the source-pinned accessibility convention tests
(test_hig_a11y_p2.py, test_wavec_a11y_contrast_focus.py).

Keeping these in one place means both suites use the same attribute-tolerant
Theme-dialog fragment boundary, the same HTML-comment stripping (so prose that
mentions the old markup can't trip a heading check), and the same syntax-tolerant
predicate for "a native heading forced to another ARIA level".
"""
import re


def strip_comments(html: str) -> str:
    """Drop HTML comments so a comment that mentions the old markup as prose does
    not count as a real occurrence."""
    return re.sub(r"<!--.*?-->", "", html, flags=re.DOTALL)


def theme_dialog_fragment(html: str) -> str:
    """The Theme dialog fragment (#theme-host up to the mobile-backdrop element).

    Both element boundaries are attribute-tolerant (matched on the opening tag +
    id, not an exact `>`), so extra attributes on either <div> can't break the
    slice."""
    start = html.index('<div id="theme-host"')
    # The theme host closes just before the mobile backdrop element.
    end = html.index('<div id="mobile-backdrop"', start)
    return html[start:end]


def native_headings_forced_to_aria_level(html: str):
    """Native <h1>..<h6> elements that carry role="heading" or aria-level — the
    self-contradictory element-vs-ARIA level override F-A11Y-3 called out.

    Syntax-tolerant: single or double quotes around ``heading`` and arbitrary
    whitespace around ``=`` / the attribute name."""
    return re.findall(
        r"<h[1-6]\b[^>]*(?:\brole\s*=\s*(?:\"heading\"|'heading')|\baria-level\s*=)",
        html,
        flags=re.IGNORECASE,
    )
