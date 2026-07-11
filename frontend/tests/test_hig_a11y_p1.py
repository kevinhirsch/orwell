"""HIG audit (2026-07-09) P1 accessibility fixes — F-A11Y-1 and F-A11Y-2.

Source-pinned convention checks (no DOM runtime needed), mirroring the style of
test_j5_endgame_a11y.py and test_wavec_a11y_contrast_focus.py.

F-A11Y-1 — the narrator streams token-by-token into #chat-history; if that log
carries aria-live="polite" a screen reader re-announces every partial fragment,
making the game's main surface unusable with AT. Fix: the transcript log is
aria-live="off" and completed replies are announced ONCE per round into a
dedicated visually-hidden polite region (#a11y-announcer) via window.orwellAnnounce.

F-A11Y-2 — keyboard/AT users tab the entire sidebar before reaching the composer.
Fix: a visually-hidden-until-focused "skip to chat" link as the FIRST child of
<body>, with a :focus reveal.
"""
import os
import re

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*rel):
    with open(os.path.join(FRONTEND, *rel), encoding="utf-8") as f:
        return f.read()


# ── F-A11Y-1: the streaming transcript log must NOT be a live region ──────────

def test_chat_history_is_aria_live_off():
    html = _read("static", "index.html")
    m = re.search(r'<div id="chat-history"[^>]*>', html)
    assert m, "#chat-history container not found"
    tag = m.group(0)
    assert 'aria-live="off"' in tag, (
        "#chat-history streams token-by-token; it MUST be aria-live=\"off\" so a screen "
        "reader is not flooded with partial fragments (F-A11Y-1)"
    )
    assert 'aria-live="polite"' not in tag, (
        "#chat-history must not be a polite live region — the old over-announce source (F-A11Y-1)"
    )
    # role="log" is still the correct semantic for a chronological transcript.
    assert 'role="log"' in tag, "#chat-history should keep role=\"log\" (it is a transcript)"


def test_dedicated_polite_announcer_region_exists():
    html = _read("static", "index.html")
    m = re.search(r'<div id="a11y-announcer"[^>]*>', html)
    assert m, "the dedicated #a11y-announcer polite region is missing (F-A11Y-1)"
    tag = m.group(0)
    assert 'aria-live="polite"' in tag, "#a11y-announcer must be a polite live region"
    assert 'aria-atomic="true"' in tag, "#a11y-announcer must be aria-atomic so the whole reply reads once"
    assert "a11y-visually-hidden" in tag, "#a11y-announcer must be visually hidden (SR-only)"


def test_announcer_helper_defined_and_reasoning_scrubbed():
    js = _read("static", "js", "a11y.js")
    assert "window.orwellAnnounce" in js, "js/a11y.js must define window.orwellAnnounce (F-A11Y-1)"
    assert "a11y-announcer" in js, "the announcer must write into #a11y-announcer"
    # Respect the reasoning-scrub split: reasoning/tool nodes are stripped before announcing.
    assert "thinking-section" in js and "thinking-content" in js, (
        "the announcer must strip the reasoning accordion so reasoning is never spoken (F-A11Y-1)"
    )
    assert "agent-thread" in js, "the announcer must strip tool nodes, announcing only the public reply"


def test_chat_js_announces_at_footer_target_seam():
    js = _read("static", "js", "chat.js")
    # The call must pass footerTarget — the SAME last-visible-bubble resolution the footer uses —
    # so a tool-only trailing round (empty roundHolder) still announces the earlier real narration,
    # not an empty bubble. This is also the settled render point (post final-render + empty-hide).
    assert "orwellAnnounce(footerTarget)" in js, (
        "chat.js must call window.orwellAnnounce(footerTarget) at the settled round-complete seam — "
        "passing the settled last-visible bubble, not a raw roundHolder/holder that can be an empty "
        "trailing tool-round bubble (F-A11Y-1)"
    )
    idx = js.index("orwellAnnounce(footerTarget)")
    # footerTarget is resolved just above the call, inside the foreground final-render block.
    assert "const footerTarget" in js[max(0, idx - 1200):idx], (
        "the announce call must sit right after footerTarget is resolved (the settled render point)"
    )
    # Window widened 14000 → 20000 for #829 (turn coalescing grew the final-render block with the
    # committed-block finalize branches); the invariant is unchanged — the announce call still
    # lives inside the `if (!_isBgFinal)` foreground final-render block.
    assert "_isBgFinal" in js[max(0, idx - 20000):idx], (
        "the announce call must live in the foreground final-render block, not the background stream path"
    )


# ── F-A11Y-2: skip-to-content link ───────────────────────────────────────────

def test_skip_link_is_first_child_of_body():
    html = _read("static", "index.html")
    m = re.search(r"<body>\s*(?:<!--.*?-->\s*)*(<[a-zA-Z][^>]*>)", html, re.DOTALL)
    assert m, "could not locate the first element child of <body>"
    first = m.group(1)
    assert "skip-link" in first, (
        "the skip-to-content link must be the FIRST focusable child of <body> so it precedes "
        "the sidebar in tab order (F-A11Y-2); found: " + first
    )
    # It must target the composer/transcript, not be a dead anchor.
    assert re.search(r'href="#(message|chat-container|chat-history)"', first), (
        "the skip link must jump to the composer/transcript"
    )


def test_skip_link_focus_reveal_css_present():
    css = _read("static", "style.css")
    m = re.search(r"\.skip-link\s*\{([^}]*)\}", css)
    assert m, ".skip-link base rule is missing from style.css (F-A11Y-2)"
    base = m.group(1)
    # Off-screen by default…
    assert re.search(r"left:\s*-\d", base), ".skip-link must be off-screen by default (e.g. left:-9999px)"
    # …revealed on focus.
    assert re.search(r"\.skip-link:focus(?:-visible)?\s*(?:,\s*\.skip-link:focus(?:-visible)?\s*)*\{[^}]*left:\s*0",
                     css), ".skip-link must become visible on :focus (left:0)"
