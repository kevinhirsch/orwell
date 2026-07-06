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
    Extracts the helper + its pattern constants from markdown.js (no DOM dependency).

    FEDEEP-3/ADV2-3/ADV2-4 (2026-07-05): scrubMachineryAsides now also depends on the
    `_MACHINERY_NOUN_VERBS` verb-context string and the `_rebalanceParenAsides` helper it calls
    before returning — both grabbed here alongside the pre-existing pieces so the harness keeps
    working after that hardening."""
    md_path = os.path.join(FRONTEND, "static", "js", "markdown.js")
    program = r"""
    const fs = require('fs');
    const src = fs.readFileSync(process.argv[1], 'utf8');
    function grab(marker, end) {
      const i = src.indexOf(marker);
      const j = src.indexOf(end, i);
      return src.slice(i, j);
    }
    function grabFn(marker) {
      let fn = src.slice(src.indexOf(marker));
      fn = fn.slice(0, fn.indexOf('\n}\n') + 2).replace('export function', 'function');
      return fn;
    }
    // the tool-word array, the noun-verb context string, the aside regex, the paren-rebalance
    // helper, and the scrub function itself — all pure, no DOM.
    const words = grab('const _GAME_TOOL_WORDS = [', '];') + '];';
    const nounVerbs = grab('const _MACHINERY_NOUN_VERBS = ', ';\n') + ';';
    const re = grab('const _MACHINERY_ASIDE_RE = new RegExp(', ");\n");
    const rebalanceFn = grabFn('function _rebalanceParenAsides');
    const fn = grabFn('export function scrubMachineryAsides');
    const cases = JSON.parse(process.argv[2]);
    const run = new Function('cases', words + '\n' + nounVerbs + '\n' + re + ');\n'
      + rebalanceFn + '\n' + fn + '\n' +
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
def test_strips_machinery_nouns_parity_with_python_scrub_1109a():
    # #1109(a) — the JS body scrub must catch the machinery NOUNS ("the engine/system/model" + the
    # app the player runs us on) the same way the Python _GAME_LEAK_SENTENCE_RE does, so the two
    # scrub layers reach parity (defense-in-depth). These rode mid-paragraph inside clean prose.
    cases = [
        ["You can shade, spin, or play a character. The engine will take it from there. "
         "The medallion catches the light.",
         "You can shade, spin, or play a character. The medallion catches the light."],
        ["The votes are in. The system tallies them. The room holds its breath.",
         "The votes are in. The room holds its breath."],
        ["The model decides the outcome. The houseguests file in one by one.",
         "The houseguests file in one by one."],
        ["Whatever the front end ate, I've got you now. You settle into the casting chair.",
         "You settle into the casting chair."],
        ["The app froze for a second. The producer leans in with a grin.",
         "The producer leans in with a grin."],
    ]
    res = _run_scrub(cases)
    assert "OK" in res.stdout, f"stdout={res.stdout!r} stderr={res.stderr!r}"


@pytest.mark.skipif(_NODE is None, reason="node not available")
def test_machinery_noun_scrub_stays_high_precision_1109a():
    # ordinary in-character prose containing "engine/front/app/site" as plain words is UNTOUCHED —
    # only the narrow "the engine/system/model", "the/front end", "the app", "this app/website/site"
    # phrases are leaks (mirrors the Python high-precision guard).
    cases = [
        ["You approach the front door as the audience applauds. The applause swells.",
         "You approach the front door as the audience applauds. The applause swells."],
        ["The campsite story he told still hangs in the air. She fronts confidence she lacks.",
         "The campsite story he told still hangs in the air. She fronts confidence she lacks."],
        # FEDEEP-3 (2026-07-05): a machinery NOUN is only a leak when it is the SUBJECT of an
        # operator/status verb — a bare "the system"/"the model" that is the OBJECT of a preceding
        # verb, or followed by an ordinary noun rather than a verb, is legitimate in-fiction prose.
        ["Gaming the system got him this far, but trust doesn't come free.",
         "Gaming the system got him this far, but trust doesn't come free."],
        ["The model houseguest strutted into the room like she owned every camera in it.",
         "The model houseguest strutted into the room like she owned every camera in it."],
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


# ── ADV2-3 (2026-07-05) — Vault/God-Mode word parity with the Python scrub ────────────── #
#
# The Python `_GAME_LEAK_SENTENCE_RE` (src/agent_loop.py) has always blocked "god mode", "the
# vault", "producer's vault", an "admin panel/surface/console/mode/controls/tools", and "developer
# controls/mode/console/tools" — but the JS `_MACHINERY_ASIDE_RE` (markdown.js) had NONE of these
# words, even though its own comment said the two must stay in parity. This closes that gap.

@pytest.mark.skipif(_NODE is None, reason="node not available")
def test_strips_vault_and_god_mode_words_adv2_3():
    cases = [
        ["The votes are locked in. God Mode isn't a thing you can reach from here. The room stays quiet.",
         "The votes are locked in. The room stays quiet."],
        ["Nobody in the house has ever seen the Vault. The living room hums with tension.",
         "The living room hums with tension."],
        ["Only the producer's vault holds that answer. The house waits for the ceremony.",
         "The house waits for the ceremony."],
        ["That lives behind an admin panel you'll never see. The ceremony continues.",
         "The ceremony continues."],
        ["Nothing here opens a developer console for you. The house stays sealed.",
         "The house stays sealed."],
        ["Calling producerVault is not something you get to do. The night rolls on.",
         "The night rolls on."],
    ]
    res = _run_scrub(cases)
    assert "OK" in res.stdout, f"stdout={res.stdout!r} stderr={res.stderr!r}"


@pytest.mark.skipif(_NODE is None, reason="node not available")
def test_vault_god_mode_words_stay_high_precision_adv2_3():
    # "admin" alone (e.g. an in-fiction "admin assistant" backstory) is NOT a leak — only the
    # specific backstage-machinery phrasings are. Mirrors the Python guard's own precision note.
    cases = [
        ["Before the show, she worked as an admin assistant for a law firm.",
         "Before the show, she worked as an admin assistant for a law firm."],
        ["He jokes that his mom is the household's chief administrator.",
         "He jokes that his mom is the household's chief administrator."],
    ]
    res = _run_scrub(cases)
    assert "OK" in res.stdout, f"stdout={res.stdout!r} stderr={res.stderr!r}"


# ── ADV2-4 (2026-07-05) — a dropped mid-run sentence must not leave an orphaned `((`/`))` ── #

@pytest.mark.skipif(_NODE is None, reason="node not available")
def test_orphaned_producer_aside_delimiter_is_rebalanced_adv2_4():
    cases = [
        # The OPEN and CLOSE land in different sentences; only the sentence carrying the OPEN is a
        # machinery aside and gets dropped, which would otherwise leave a stray `))` behind.
        ["((Let me advance the game. The house holds its breath.))",
         "The house holds its breath."],
        # A genuinely balanced, non-machinery aside (both delimiters survive together) is untouched.
        ["((It's day 12; the veto ceremony is next.))",
         "((It's day 12; the veto ceremony is next.))"],
        # Ordinary prose with no delimiters at all is untouched.
        ["The living room goes quiet as the votes are read.",
         "The living room goes quiet as the votes are read."],
    ]
    res = _run_scrub(cases)
    assert "OK" in res.stdout, f"stdout={res.stdout!r} stderr={res.stderr!r}"
