"""#1740 (F7 audit) — reasoning-off GLM-4.7 narrates its own tool-planning into the player body.

Finding: "NEVER NAME THE MACHINERY" (`src/engine/momentPrompts.ts`) does not bind — same class as
the location/knowledge findings (#1726/#1727/#1735, "wording is not the wall"). A/B testing caught
the exact leak: reasoning OFF, the model wrote

    I call `getGameState`... `whereabouts`... `moveTo`... `recordInteraction`

straight into the visible narration body. Production's real defense is the RENDER-LAYER scrub —
`markdown.js`'s `scrubReasoningPreamble` / `redactRawIds` / `scrubMachineryAsides` chain, wired
into `processWithThinking`'s game-build branch. This file audits that scrub's actual coverage
against real reasoning-off leak phrasings and pins the two concrete gaps this issue closed:

  1. ELLIPSIS DEBRIS (the exact audit-quoted shape). `scrubMachineryAsides` splits the body into
     sentences on `/(?<=[.!?\\n])/` — one boundary per punctuation CHARACTER, so an ellipsis-
     separated leak like "I call `getGameState`... `whereabouts`..." split into a machinery
     fragment (dropped) plus several bare "." fragments (kept, because a lone "." matches no
     machinery pattern). The player still saw a literal "......" trail where the tool names used
     to be — a broken, telling artifact, not a clean scrub. Fixed by gluing a whole run of
     terminal punctuation to the sentence it closes (`(?![.!?])` in the split regex) so the
     ENTIRE unit — words plus trailing "..." — drops together.

  2. MISSING SUBJECT-AGNOSTIC PHRASES. The JS `_MACHINERY_ASIDE_RE` was missing a set of
     phrasings the Python-side `_GAME_LEAK_SENTENCE_RE` (src/agent_loop.py) has always carried —
     "comp-intent", "pending decision/binding", "binding choice/decision", "decision/choice
     card(s)/button(s)", "tool call", "jumped ahead", "narratively", subject-agnostic "record
     this/the/that interaction/scene", and third-person "the player/user …" references. Since
     markdown.js is the actual wall (production relies on it, not the prompt), that gap meant
     those exact leak phrasings reached the player body untouched. Mirrored in here now.

  3. BARE-PRESENT-TENSE "I <verb>" (no modal). "I check the game state now." — present tense,
     no "I'll"/"I should"/"let me" — slipped through both the JS and (separately) the Python
     scrub, because the operator-clause alternations all required a leading modal or "let me".
     Extended (JS-side only, since this file is THE wall) for the four verbs that are already
     object-noun-gated (check/run/log/note), so it inherits their existing false-positive
     protection rather than bare-matching every verb.

Reasoning/`<think>` channel split is untouched by any of this — these are pure-function scrub
passes on the already-separated reply-channel text; see `test_1047_machinery_aside_scrub.py` /
`test_i9_machinery_leak_hardening.py` for the channel-split wiring pins this file complements.
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


# ── source pins: the new phrasings + the bare-i clause are actually in the regex ──────────── #

def test_subject_agnostic_machinery_phrases_are_present():
    md = _read("static", "js", "markdown.js")
    re_block = md[md.index("const _MACHINERY_ASIDE_RE = new RegExp("):md.index("'i',\n);")]
    for phrase in (
        "comp-intent", "pending (?:decision|binding)", "binding (?:choice|decision)",
        "(?:decision|choice) (?:card|cards|button|buttons)", "tool call",
        "jumped ahead", "narratively",
        "record (?:this|the|that) (?:interaction|scene)",
        "the (?:player|user)",
    ):
        assert phrase in re_block, f"missing subject-agnostic phrase: {phrase!r}"


def test_bare_i_object_gated_clause_is_present():
    md = _read("static", "js", "markdown.js")
    re_block = md[md.index("const _MACHINERY_ASIDE_RE = new RegExp("):md.index("'i',\n);")]
    # a THIRD operator-clause branch (beyond "let me" and "i(?:'ll|...)") that requires no modal
    assert "\\\\bi\\\\s+(?:now" in re_block or "\\bi\\s+(?:now" in re_block


def test_ellipsis_debris_fix_is_present_in_the_split_regex():
    md = _read("static", "js", "markdown.js")
    fn = md[md.index("export function scrubMachineryAsides("):]
    fn = fn[:fn.index("\n}\n")]
    assert "(?![.!?])" in fn, "the split regex must glue a terminal-punctuation run together"


# ── Node round-trip: drive scrubMachineryAsides over the leak corpus ──────────────────────── #

def _run_scrub(cases):
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
def test_the_exact_audit_quoted_leak_is_fully_scrubbed_no_debris():
    # the literal A/B-run leak, reproduced verbatim (backticked tool names, ellipsis separators)
    cases = [
        ["I call `getGameState`... `whereabouts`... `moveTo`... `recordInteraction`.", ""],
        ["I call `getGameState`... `whereabouts`... `moveTo`... `recordInteraction`. "
         "The house settles into the evening.",
         "The house settles into the evening."],
        # a variant without backticks, still ellipsis-joined
        ["Let me call getGameState... then whereabouts... then moveTo... then recordInteraction. "
         "The kitchen empties out.",
         "The kitchen empties out."],
    ]
    res = _run_scrub(cases)
    assert "OK" in res.stdout, f"stdout={res.stdout!r} stderr={res.stderr!r}"
    # the exact-match assertion above IS the debris check: any leftover "." trail would make the
    # scrubbed output differ from the expected clean string, so a regression here fails loudly.


@pytest.mark.skipif(_NODE is None, reason="node not available")
def test_previously_missing_subject_agnostic_phrases_now_scrub():
    tail = " The house watches."
    leaks = [
        "That comp-intent is locked in now.",
        "You have a pending decision waiting.",
        "You have a pending binding waiting.",
        "This is a binding choice you cannot undo.",
        "This is a binding decision you cannot undo.",
        "Tap the decision card to confirm.",
        "Tap the choice button to confirm.",
        "That required a tool call behind the scenes.",
        "We jumped ahead in the story there.",
        "Narratively, this moment matters.",
        "Record this interaction before moving on.",
        "Record the scene before moving on.",
        "The player, Sam, has finished his conversation.",
        "The player is deciding what to do next.",
        "The user wants to skip ahead.",
    ]
    cases = [[leak + tail, tail.strip()] for leak in leaks]
    res = _run_scrub(cases)
    assert "OK" in res.stdout, f"stdout={res.stdout!r} stderr={res.stderr!r}"


@pytest.mark.skipif(_NODE is None, reason="node not available")
def test_bare_present_tense_i_operator_leaks_now_scrub():
    cases = [
        ["I check the game state now. The house stirs.", "The house stirs."],
        ["I run the game to see what happens. The house stirs.", "The house stirs."],
        ["I log this interaction for later. The house stirs.", "The house stirs."],
        ["I note the state before continuing. The house stirs.", "The house stirs."],
    ]
    res = _run_scrub(cases)
    assert "OK" in res.stdout, f"stdout={res.stdout!r} stderr={res.stderr!r}"


@pytest.mark.skipif(_NODE is None, reason="node not available")
def test_bare_present_tense_i_stays_high_precision_no_over_scrub():
    # the SAME bare-"i" widening must not eat ordinary first-person narration that happens to use
    # one of the four ambiguous verbs with a non-engine object (mirrors the #989/#1369 protections).
    cases = [
        ["I check on the others before bed. The house settles.",
         "I check on the others before bed. The house settles."],
        ["I run to the door as the buzzer sounds. The crowd gasps.",
         "I run to the door as the buzzer sounds. The crowd gasps."],
        ["I log every grudge I've ever held. The diary room light blinks.",
         "I log every grudge I've ever held. The diary room light blinks."],
        ["I note that you've been quiet tonight. The room stills.",
         "I note that you've been quiet tonight. The room stills."],
    ]
    res = _run_scrub(cases)
    assert "OK" in res.stdout, f"stdout={res.stdout!r} stderr={res.stderr!r}"


@pytest.mark.skipif(_NODE is None, reason="node not available")
def test_legitimate_punctuation_runs_survive_the_glued_split():
    # a genuine dramatic-pause ellipsis, or a "?!"/"!!!" run, must render byte-identically — the
    # split-regex fix only changes WHERE a boundary falls, never what survives when nothing around
    # it is machinery.
    cases = [
        ["The room falls silent... No one moves.", "The room falls silent... No one moves."],
        ["Wait?! You cannot be serious. The room goes still.",
         "Wait?! You cannot be serious. The room goes still."],
        ["No way!!! She actually did it. The crowd erupts.",
         "No way!!! She actually did it. The crowd erupts."],
        ["The lights dim over the living room. Who do you trust?",
         "The lights dim over the living room. Who do you trust?"],
    ]
    res = _run_scrub(cases)
    assert "OK" in res.stdout, f"stdout={res.stdout!r} stderr={res.stderr!r}"


@pytest.mark.skipif(_NODE is None, reason="node not available")
def test_ellipsis_leak_mid_paragraph_drops_cleanly_with_neighbours_intact():
    cases = [
        ["The votes are counted. I call `getGameState`... `whereabouts`... `moveTo`... "
         "`recordInteraction`. The houseguests sit in tense silence.",
         "The votes are counted. The houseguests sit in tense silence."],
    ]
    res = _run_scrub(cases)
    assert "OK" in res.stdout, f"stdout={res.stdout!r} stderr={res.stderr!r}"


# ── each individual bare tool name named in the audit, in isolation (the un-degraded floor) ── #

@pytest.mark.skipif(_NODE is None, reason="node not available")
def test_each_audited_tool_name_alone_is_scrubbed():
    tail = " The house watches."
    for tool in ("getGameState", "whereabouts", "moveTo", "recordInteraction"):
        cases = [[f"I'll call {tool} now.{tail}", tail.strip()]]
        res = _run_scrub(cases)
        assert "OK" in res.stdout, f"{tool}: stdout={res.stdout!r} stderr={res.stderr!r}"


# ── the framing-vs-wall documentation (AC #4) ──────────────────────────────────────────────── #

def test_moment_prompts_documents_the_ban_as_framing_not_the_wall():
    src = _read("..", "src", "engine", "momentPrompts.ts")
    idx = src.index("export const BASE_GAME_MASTER_PROMPT")
    doc = src[max(0, idx - 1600):idx]
    assert "#1740" in doc
    assert "wall" in doc.lower()
    assert "scrubMachineryAsides" in doc
