"""#970 — a leading OOC `((...))` block + in-character prose in ONE model turn renders as TWO bubbles.

The GM marks an OUT-OF-CHARACTER producer aside by wrapping its reply in `((...))` (the momentPrompts
"never-both" contract). The prompt-level fix shipped (#965). This is the RENDERER safety net: when a
SINGLE model turn DOES contain a leading complete `((...))` block followed (after a line break) by
un-parenthesized in-character prose, the FE must SEGMENT it into TWO distinct bubbles —

  · a styled OOC aside bubble (`<div class="ooc-producer-aside">…</div>`) for the `((...))` content, then
  · the remaining prose as its OWN normal in-character bubble (NOT wrapped in the aside class)

— instead of cramming both into one bubble or marking the WHOLE turn as an aside (the old behavior).

Both the live-stream and the reload/persisted assistant render paths funnel through the SAME engine
`markdown.js processWithThinking`, so fixing the OOC handling there fixes both paths; they cannot
reflow differently on reload.

This file mixes:
  · SOURCE-PINNED wiring assertions — the two-bubble path exists, runs in the game-build branch, and the
    whole-wrap single-aside rule is intact.
  · A Node round-trip through the PURE `_segmentLeadingOocAside` helper (no DOM): a leading-OOC-plus-prose
    input splits into (aside, prose); a whole-wrap input does NOT split (stays a single aside bubble); a
    plain in-character turn does NOT split (renders byte-identically to today).
"""

import json
import os
import shutil
import subprocess

import pytest

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_NODE = shutil.which("node")


def _read(*rel):
    with open(os.path.join(FRONTEND, *rel), encoding="utf-8") as f:
        return f.read()


# ── SOURCE-PINNED wiring — the two-bubble segmentation path exists and is wired ──────── #

def test_segment_helper_is_defined():
    md = _read("static", "js", "markdown.js")
    # the pure segmenter + its leading-block regex are defined
    assert "function _segmentLeadingOocAside(" in md
    assert "const _OOC_LEADING_BLOCK_RE =" in md


def test_two_bubble_emit_runs_in_the_game_build_branch():
    md = _read("static", "js", "markdown.js")
    pwt = md[md.index("export function processWithThinking"):]
    gated = pwt[pwt.index("if (gameBuildSuppressesThinking())"):]
    gated = gated[:gated.index("let html = ''")]
    # the segmenter is CALLED in the game-build reply path
    assert "_segmentLeadingOocAside(" in gated
    # the leading aside is emitted as its OWN producer-aside bubble, BEFORE the trailing prose bubble
    assert "leadingAsideText" in gated
    aside_emit = gated.index("if (leadingAsideText)")
    prose_emit = gated.index("if (reply) {", aside_emit)
    assert aside_emit < prose_emit, "the OOC aside bubble must be emitted before the prose bubble"
    # the leading aside bubble carries the styled producer-aside class
    block = gated[aside_emit:prose_emit]
    assert 'class="ooc-producer-aside"' in block


def test_whole_wrap_single_aside_rule_is_intact():
    """A reply that is ENTIRELY `((...))` must still render as a SINGLE aside bubble — the segmenter
    must defer to the existing whole-wrap rule (no regression)."""
    md = _read("static", "js", "markdown.js")
    # the whole-wrap rule still runs (only when the segmenter did NOT split)
    pwt = md[md.index("export function processWithThinking"):]
    gated = pwt[pwt.index("if (gameBuildSuppressesThinking())"):]
    gated = gated[:gated.index("let html = ''")]
    assert "_OOC_WHOLE_WRAP_RE" in gated
    assert "!leadingAsideText" in gated, "the whole-wrap path must be guarded so it does not double-fire"


def test_single_render_engine_shared_by_live_and_reload():
    """Both the live stream and the reload/persisted assistant path render through the same
    processWithThinking, so the two-bubble split applies identically and a reload cannot reflow."""
    chat = _read("static", "js", "chat.js")
    renderer = _read("static", "js", "chatRenderer.js")
    assert "processWithThinking" in chat
    assert "processWithThinking" in renderer


# ── Node round-trip — drive the PURE segmenter over a case table (no DOM) ────────────── #

def _run_segment(cases):
    """Drive the pure _segmentLeadingOocAside helper in Node over `cases`.
    Extracts the helper + the regexes it depends on from markdown.js (no DOM dependency)."""
    md_path = os.path.join(FRONTEND, "static", "js", "markdown.js")
    program = r"""
    const fs = require('fs');
    const src = fs.readFileSync(process.argv[1], 'utf8');
    function grabLine(marker) {
      const i = src.indexOf(marker);
      const j = src.indexOf('\n', i);
      return src.slice(i, j);
    }
    // the regexes the segmenter reads (pure, no DOM)
    const wholeWrap = grabLine('const _OOC_WHOLE_WRAP_RE =');
    const leadBlock = grabLine('const _OOC_LEADING_BLOCK_RE =');
    // the helper itself
    let fn = src.slice(src.indexOf('function _segmentLeadingOocAside'));
    fn = fn.slice(0, fn.indexOf('\n}\n') + 2);
    const cases = JSON.parse(process.argv[2]);
    const run = new Function('cases',
      wholeWrap + '\n' + leadBlock + '\n' + fn + '\n' +
      "return cases.map(c => _segmentLeadingOocAside(c));");
    process.stdout.write(JSON.stringify(run(cases)));
    """
    res = subprocess.run(
        [_NODE, "-e", program, "--", md_path, json.dumps(cases)],
        capture_output=True, text=True,
    )
    assert res.returncode == 0, f"node failed: {res.stderr}"
    return json.loads(res.stdout)


@pytest.mark.skipif(_NODE is None, reason="node not available")
def test_leading_ooc_plus_prose_splits_into_two():
    """A leading complete `((...))` block + trailing in-character prose → (aside, prose)."""
    cases = [
        "((You're safe this week — just play it cool.))\n\nThe living room hums with low chatter as you step in.",
        "(( who's HOH? you are. ))\nYou walk into the kitchen and three heads turn.",
        # markers stripped + both halves trimmed
        "((  quiet word from production  ))   The backyard is bathed in floodlight.",
    ]
    out = _run_segment(cases)
    # case 0 — clean split
    assert out[0]["aside"] == "You're safe this week — just play it cool."
    assert out[0]["prose"] == "The living room hums with low chatter as you step in."
    # case 1
    assert out[1]["aside"] == "who's HOH? you are."
    assert out[1]["prose"] == "You walk into the kitchen and three heads turn."
    # case 2 — inner + prose trimmed
    assert out[2]["aside"] == "quiet word from production"
    assert out[2]["prose"] == "The backyard is bathed in floodlight."


@pytest.mark.skipif(_NODE is None, reason="node not available")
def test_whole_wrap_does_not_split():
    """A reply that is ENTIRELY `((...))` must NOT split — it stays a single aside bubble."""
    cases = [
        "((This whole thing is an out-of-character aside to production.))",
        "  (( what time is it in-game? ))  ",
    ]
    out = _run_segment(cases)
    for got, raw in zip(out, cases):
        assert got["aside"] is None, f"whole-wrap must not split: {raw!r} -> {got}"
        assert got["prose"] == raw


@pytest.mark.skipif(_NODE is None, reason="node not available")
def test_plain_in_character_turn_does_not_split():
    """A turn with NO leading `((...))` block renders byte-identically — never split."""
    cases = [
        "The lights dim over the living room. Who do you trust?",
        '"Let me think about it," Delia says, and the room goes quiet.',
        "I think (maybe) we vote him out this week.",  # a MID-sentence paren is not a leading block
        "",
    ]
    out = _run_segment(cases)
    for got, raw in zip(out, cases):
        assert got["aside"] is None, f"plain prose must not split: {raw!r} -> {got}"
        assert got["prose"] == raw


@pytest.mark.skipif(_NODE is None, reason="node not available")
def test_leading_block_followed_by_empty_or_rewrapped_tail_does_not_split():
    """No real trailing prose (empty tail, or another `((...))` wrap) → do not emit a stray bubble;
    leave it for the existing whole-wrap / salvage rules."""
    cases = [
        "((just an aside))\n\n   ",          # whitespace-only tail
        "(())\n\nSome prose after empty.",   # empty leading aside → no meaningful split
    ]
    out = _run_segment(cases)
    for got, raw in zip(out, cases):
        assert got["aside"] is None, f"no-prose / empty-aside must not split: {raw!r} -> {got}"
        assert got["prose"] == raw
