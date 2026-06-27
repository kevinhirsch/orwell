"""#1047 — tool-name / operator-aside scrub in the game-build BODY (markdown.js).

During eviction narration the GM **body** (the visible bubble, not the reasoning accordion)
leaked tool-process asides MID-PARAGRAPH:

  - "Let me call advanceGame and see what surfaces"
  - "Let me advance the game"
  - "let me walk through it"

The reasoning-channel split held (these were in the visible reply, not leaked reasoning), so this
is an anti-machinery / fourth-wall leak the game-build body scrub must strip. The pre-existing
markdown.js scrub passes (scrubReasoningPreamble / redactRawIds) only drop a STANDALONE line that
OPENS with an operator phrase — a tool-process clause riding inside otherwise-clean prose survives
them. `scrubMachineryAsides` is the missing SENTENCE-level pass (mirrors src/agent_loop.py's
_scrub_game_leak), wired into the game-build branch of processWithThinking.

Source-level wiring assertions + a Node round-trip through the pure helper (no DOM): the leak
phrases are stripped from a game-build body, ordinary prose / NPC dialogue / legitimate
first-person in-character lines are untouched (no over-scrub).
"""

import os
import shutil
import subprocess

import pytest

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_NODE = shutil.which("node")


def _read(*rel):
    with open(os.path.join(FRONTEND, *rel), encoding="utf-8") as f:
        return f.read()


# ── wiring: scrubMachineryAsides is defined, exported, and runs in the game build ── #

def test_scrub_machinery_asides_is_defined_and_exported():
    md = _read("static", "js", "markdown.js")
    assert "export function scrubMachineryAsides(" in md
    # exported on the module object so chat.js / chatRenderer.js can reach it if needed
    export_block = md[md.index("const markdownModule = {"):]
    export_block = export_block[:export_block.index("};")]
    assert "scrubMachineryAsides," in export_block


def test_scrub_runs_inside_the_game_build_body_branch():
    md = _read("static", "js", "markdown.js")
    pwt = md[md.index("export function processWithThinking"):]
    gated = pwt[pwt.index("if (gameBuildSuppressesThinking())"):]
    gated = gated[:gated.index("let html = ''")]
    # the sentence-level machinery scrub runs in the game-build reply path, after redactRawIds
    assert "scrubMachineryAsides(" in gated
    assert gated.index("redactRawIds(") < gated.index("scrubMachineryAsides(")


# ── Node round-trip: the leak phrases are stripped; normal prose is untouched ────── #

def _run_scrub(cases):
    """Drive the pure scrubMachineryAsides helper in Node over [input, expected] cases.
    Extracts the helper + its pattern constants from markdown.js (no DOM dependency)."""
    md_path = os.path.join(FRONTEND, "static", "js", "markdown.js")
    program = r"""
    const fs = require('fs');
    const src = fs.readFileSync(process.argv[1], 'utf8');
    function grab(marker, end) {
      const i = src.indexOf(marker);
      const j = src.indexOf(end, i);
      return src.slice(i, j);
    }
    // the tool-word array, the aside regex, and the function — all pure, no DOM.
    const words = grab('const _GAME_TOOL_WORDS = [', '];') + '];';
    const re = grab('const _MACHINERY_ASIDE_RE = new RegExp(', ");\n");
    let fn = src.slice(src.indexOf('export function scrubMachineryAsides'));
    fn = fn.slice(0, fn.indexOf('\n}\n') + 2).replace('export function', 'function');
    const cases = JSON.parse(process.argv[2]);
    const run = new Function('cases', words + '\n' + re + ');\n' + fn + '\n' +
      "let ok = true;" +
      "for (const [inp, exp] of cases) { const got = scrubMachineryAsides(inp);" +
      "  if (got.trim() !== exp.trim()) { ok = false;" +
      "    console.error('MISMATCH', JSON.stringify(inp), '=>', JSON.stringify(got), 'WANT', JSON.stringify(exp)); } }" +
      "return ok;");
    console.log(run(cases) ? 'OK' : 'FAIL');
    """
    import json
    res = subprocess.run(
        [_NODE, "-e", program, "--", md_path, json.dumps(cases)],
        capture_output=True, text=True,
    )
    return res


@pytest.mark.skipif(_NODE is None, reason="node not available")
def test_strips_the_exact_1047_leak_phrases_from_the_body():
    cases = [
        # the three reported leaks, each riding inside otherwise-clean eviction prose
        ["The votes are counted. Let me call advanceGame and see what surfaces. "
         "The houseguests sit in tense silence.",
         "The votes are counted. The houseguests sit in tense silence."],
        ["By a vote of five to two, you are evicted. Let me advance the game. "
         "Grab your bag and head for the door.",
         "By a vote of five to two, you are evicted. Grab your bag and head for the door."],
        ["This is a close one. Let me walk through it. The first ballot reads to evict.",
         "This is a close one. The first ballot reads to evict."],
        # a bare engine tool name anywhere in a sentence is a leak
        ["I'll submitDecision for the vote now. The medallion catches the light.",
         "The medallion catches the light."],
    ]
    res = _run_scrub(cases)
    assert "OK" in res.stdout, f"stdout={res.stdout!r} stderr={res.stderr!r}"


@pytest.mark.skipif(_NODE is None, reason="node not available")
def test_normal_narration_is_untouched_no_over_scrub():
    cases = [
        # ordinary scene prose passes through byte-identical
        ["The lights dim over the living room. Who do you trust?",
         "The lights dim over the living room. Who do you trust?"],
        # an NPC saying "let me walk through it" in DIALOGUE is fine (leading quote protects it),
        # and a legitimate first-person in-character line must survive
        ['"Let me think about my next move," Delia says. You nod and step back.',
         '"Let me think about my next move," Delia says. You nod and step back.'],
        # legitimate first-person in-character prose (NOT a tool-process verb) survives
        ["Let me show you the bedroom. I can see the kitchen from here.",
         "Let me show you the bedroom. I can see the kitchen from here."],
        # ordinary words that merely contain a tool-ish substring are untouched
        ["You advance toward the front door as the audience applauds.",
         "You advance toward the front door as the audience applauds."],
        ["She moves the game piece across the board with a grin.",
         "She moves the game piece across the board with a grin."],
    ]
    res = _run_scrub(cases)
    assert "OK" in res.stdout, f"stdout={res.stdout!r} stderr={res.stderr!r}"
