"""#989 — assistant narration starting with "Let me…" must NOT be scrubbed from the public bubble.

The reasoning-preamble scrub (`_REASONING_LINE_RE` in markdown.js, run by scrubReasoningPreamble
and the NARR-10 whole-body redactRawIds pass) carried a bare `let me\\b` alternation, so legitimate
producer/GM narration — "Let me log that." (the owner-playtest line from the issue), "Let me show
you the bedroom." — was silently eaten on the assistant render path. The same false-positive class
lived in the SENTENCE-level machinery scrubs: bare "log/note" in the "let me …" / "I'll …" operator
branches of `_MACHINERY_ASIDE_RE` (markdown.js) and `_GAME_LEAK_SENTENCE_RE`/`_OPERATOR_VERBS`
(src/agent_loop.py) ate "Let me log that." even when the line-level scrub spared it.

The fix keeps the scrub LOAD-BEARING (reasoning must never reach the public bubble) and narrows it:

  * `_REASONING_LINE_RE`'s "let me" branch now requires a REASONING/META verb after the opener
    ("think/check/see/look/verify/review/analyze/re-read/rewind/figure/plan/stay in character/…").
    Narrative "let me" verbs ("log", "show", "give", "be clear", "ask") no longer match.
  * In the machinery scrubs, "log/note" count as operator verbs only when followed by an ENGINE
    object noun ("log this interaction", "note the state") — a bare pronoun object ("log that.")
    reads as narration and survives. All other tool-process verbs stay bare (no gutting).

These tests pin the behavior BOTH ways: real reasoning preambles / operator asides are still
scrubbed, and in-character "Let me…" narration survives — across all three scrub layers plus the
Python stream scrub (parity partner).
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


# ── source pins: the bare `let me\b` alternation is gone; the scrub itself remains ── #

def test_reasoning_line_re_no_longer_carries_a_bare_let_me():
    md = _read("static", "js", "markdown.js")
    line = next(l for l in md.splitlines() if l.startswith("const _REASONING_LINE_RE"))
    # the old over-broad shape (`let me\b` as a whole alternation branch) must not return
    assert "let me\\b" not in line, "bare `let me\\b` re-eats legitimate narration (#989)"
    # the branch still exists — narrowed to require a reasoning/meta verb
    assert "let me" in line
    for verb in ("think", "rewind", "stay in character"):
        assert verb in line, f"reasoning verb {verb!r} must stay scrubbed (pinned elsewhere)"


def test_machinery_scrubs_gate_log_note_on_an_engine_object():
    md = _read("static", "js", "markdown.js")
    py = _read("src", "agent_loop.py")
    for src, name in ((md, "markdown.js"), (py, "agent_loop.py")):
        assert "(?:log|note)(?=" in src, (
            f"{name}: log/note must be object-gated (bare 'log that.' is narration, #989)"
        )


# ── Node round-trips: scrubReasoningPreamble (the #989 root cause) ─────────────────── #

def _run_preamble(cases):
    md_path = os.path.join(FRONTEND, "static", "js", "markdown.js")
    program = r"""
    const fs = require('fs');
    const src = fs.readFileSync(process.argv[1], 'utf8');
    const reLine = src.match(/const _REASONING_LINE_RE = [^\n]+/)[0];
    const reNpc  = src.match(/const _RAW_NPC_ID_RE = [^\n]+/)[0];
    const fn = src.slice(src.indexOf('export function scrubReasoningPreamble'));
    const body = fn.slice(0, fn.indexOf('\n}\n') + 2).replace('export function', 'function');
    const cases = JSON.parse(process.argv[2]);
    const run = new Function('cases', reLine + '\n' + reNpc + '\n' + body + '\n' +
      "let ok = true;" +
      "for (const [inp, exp] of cases) { const got = (scrubReasoningPreamble(inp) || '').trim();" +
      "  if (got !== exp.trim()) { ok = false;" +
      "    console.error('MISMATCH', JSON.stringify(inp), '=>', JSON.stringify(got), 'WANT', JSON.stringify(exp)); } }" +
      "return ok;");
    console.log(run(cases) ? 'OK' : 'FAIL');
    """
    return subprocess.run(
        [_NODE, "-e", program, "--", md_path, json.dumps(cases)],
        capture_output=True, text=True,
    )


@pytest.mark.skipif(_NODE is None, reason="node not available")
def test_let_me_narration_survives_the_preamble_scrub():
    cases = [
        # the exact owner-playtest line from #989
        ["Let me log that.", "Let me log that."],
        ["Let me log that.\nThe camera light blinks twice.",
         "Let me log that.\nThe camera light blinks twice."],
        # legitimate first-person in-character prose (pinned untouched at the sentence layer too)
        ["Let me show you the bedroom. I can see the kitchen from here.",
         "Let me show you the bedroom. I can see the kitchen from here."],
        ["Let me give you one piece of advice before the doors open.",
         "Let me give you one piece of advice before the doors open."],
        ["Let me be clear about the stakes here.",
         "Let me be clear about the stakes here."],
        ["Let me guess — you thought the votes were locked.",
         "Let me guess — you thought the votes were locked."],
    ]
    res = _run_preamble(cases)
    assert "OK" in res.stdout, f"stdout={res.stdout!r} stderr={res.stderr!r}"


@pytest.mark.skipif(_NODE is None, reason="node not available")
def test_real_reasoning_preambles_are_still_scrubbed():
    cases = [
        # reasoning/meta "let me" openers stay dead — the scrub is NOT gutted
        ["Let me check the game state.\nThe kitchen hums with morning energy.",
         "The kitchen hums with morning energy."],
        ["Let me think about how to respond here.\nThe backyard goes quiet.",
         "The backyard goes quiet."],
        ["Let me review the roster first.\nWelcome back, houseguests.",
         "Welcome back, houseguests."],
        ["Let me re-read the last beat.\nThe living room settles.",
         "The living room settles."],
        # the pinned shapes from the older gates keep their behavior
        ["Let me stay in character.\nThe lights dim. Ready?", "The lights dim. Ready?"],
        ["Let me rewind that.\nThe lights dim over the living room. Who do you trust?",
         "The lights dim over the living room. Who do you trust?"],
        # a whole-message reasoning line still blanks (the user-scrub gate depends on this)
        ["Let me think about it.", ""],
        # non-"let me" reasoning openers are untouched by the narrowing
        ["I need to figure out the vote math.\nThe ceremony begins.", "The ceremony begins."],
    ]
    res = _run_preamble(cases)
    assert "OK" in res.stdout, f"stdout={res.stdout!r} stderr={res.stderr!r}"


# ── Node round-trip: redactRawIds (the NARR-10 whole-body line pass) ───────────────── #

@pytest.mark.skipif(_NODE is None, reason="node not available")
def test_redact_raw_ids_keeps_a_mid_body_let_me_narration_line():
    md_path = os.path.join(FRONTEND, "static", "js", "markdown.js")
    program = r"""
    const fs = require('fs');
    const src = fs.readFileSync(process.argv[1], 'utf8');
    const reLine = src.match(/const _REASONING_LINE_RE = [^\n]+/)[0];
    const reNpcGlobal = src.match(/const _RAW_NPC_ID_GLOBAL_RE = [^\n]+/)[0];
    const fn = src.slice(src.indexOf('export function redactRawIds'));
    const body = fn.slice(0, fn.indexOf('\n}\n') + 2).replace('export function', 'function');
    const cases = JSON.parse(process.argv[2]);
    const run = new Function('cases', reLine + '\n' + reNpcGlobal + '\n' + body + '\n' +
      "let ok = true;" +
      "for (const [inp, exp] of cases) { const got = redactRawIds(inp);" +
      "  if (got !== exp) { ok = false;" +
      "    console.error('MISMATCH', JSON.stringify(inp), '=>', JSON.stringify(got), 'WANT', JSON.stringify(exp)); } }" +
      "return ok;");
    console.log(run(cases) ? 'OK' : 'FAIL');
    """
    cases = [
        # a mid-body narration line opening with "Let me" survives the whole-body pass
        ["The vote lands.\nLet me log that.\nThe house exhales.",
         "The vote lands.\nLet me log that.\nThe house exhales."],
        # a mid-body REASONING line (no quotes) is still dropped
        ["The vote lands.\nLet me re-check the state.\nThe house exhales.",
         "The vote lands.\nThe house exhales."],
    ]
    res = subprocess.run(
        [_NODE, "-e", program, "--", md_path, json.dumps(cases)],
        capture_output=True, text=True,
    )
    assert "OK" in res.stdout, f"stdout={res.stdout!r} stderr={res.stderr!r}"


# ── Node round-trip: scrubMachineryAsides (the sentence layer must not re-eat it) ──── #

def _run_machinery(cases):
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
    return subprocess.run(
        [_NODE, "-e", program, "--", md_path, json.dumps(cases)],
        capture_output=True, text=True,
    )


@pytest.mark.skipif(_NODE is None, reason="node not available")
def test_machinery_sentence_scrub_spares_bare_log_note_narration():
    cases = [
        # the #989 line, riding inside otherwise-clean prose, survives the sentence pass
        ["Let me log that. The medallion catches the light.",
         "Let me log that. The medallion catches the light."],
        ["Let me note that you came in swinging. The room settles.",
         "Let me note that you came in swinging. The room settles."],
    ]
    res = _run_machinery(cases)
    assert "OK" in res.stdout, f"stdout={res.stdout!r} stderr={res.stderr!r}"


@pytest.mark.skipif(_NODE is None, reason="node not available")
def test_machinery_sentence_scrub_still_kills_engine_object_log_note():
    cases = [
        # log/note WITH an engine object stays machinery — the scrub is not gutted
        ["Let me log this interaction. The medallion catches the light.",
         "The medallion catches the light."],
        ["I'll note the state before we continue. The room settles.",
         "The room settles."],
        # the unambiguous tool-process verbs stay bare (pinned in the #1047 gates too)
        ["Let me advance the game. Grab your bag and head for the door.",
         "Grab your bag and head for the door."],
    ]
    res = _run_machinery(cases)
    assert "OK" in res.stdout, f"stdout={res.stdout!r} stderr={res.stderr!r}"


# ── Python parity: the live-stream scrub must not eat what the render layer keeps ──── #

def _scrub():
    import tempfile
    os.environ.setdefault(
        "DATABASE_URL",
        "sqlite:///" + os.path.join(tempfile.mkdtemp(prefix="orwell-989-db-"), "app.db"),
    )
    import src.agent_tools  # noqa: F401  (load-order coupling)
    from src.agent_loop import _scrub_game_leak
    return _scrub_game_leak


def test_python_stream_scrub_keeps_let_me_log_narration():
    scrub = _scrub()
    for legit in (
        "Let me log that. You settle into the casting chair.",
        "Actually, let me log that. The house waits.",
        "I'll note that for later. The kitchen empties out.",
    ):
        assert scrub(legit) == legit, f"stream scrub ate legit narration: {legit!r}"


def test_python_stream_scrub_still_kills_operator_asides():
    scrub = _scrub()
    # engine-object log/note is still an operator aside
    out = scrub("Let me log this interaction. You settle into the casting chair.")
    assert "log this interaction" not in out
    assert "You settle into the casting chair." in out
    out = scrub("I'll note the state first. The ceremony continues.")
    assert "note the state" not in out
    assert "The ceremony continues." in out
    # the pre-existing bare operator verbs keep their teeth (pinned in the audit gates too)
    assert scrub("Let me call whereabouts to see the room.").strip() == ""
    assert scrub("Let me record this interaction and advance the game.").strip() == ""
