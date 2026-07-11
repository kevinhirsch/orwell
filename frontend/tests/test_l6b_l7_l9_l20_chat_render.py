"""Chat-render fix cluster L6b / L7 / L9 / L20 (FE).

Four player-visible chat-render bugs, fixed FE-only and game-build-gated where the
change is game-only. Tested at the SOURCE level (the render/stream/composer files are
vanilla JS with no JS test runner in this repo) plus, for L20, a real round-trip
through the pure helpers (Node) and the Python live-game scrub.

L6b — PLAIN-CONTENT reasoning leak in the game build. L6a already hid <think> blocks;
  but the model also emits its planning as a NORMAL assistant ROUND (an INTERMEDIATE
  agent round, followed by a tool call and/or another round). In the game build only
  the FINAL narration round may render; intermediate rounds are suppressed, and a
  plain-content reasoning preamble (raw `npc:<id>` ids, operator openers) is scrubbed
  even on a final render. Non-game build is UNCHANGED; admin `data-show-thinking`
  still shows everything (that gate lives in gameBuildSuppressesThinking()).

L7 — empty/worthless accordions. An inter-message tool/agent node rendered an
  expand chevron even with nothing to expand (a production beat has no command, no
  output, no diff, no screenshot). The chevron + collapsible content now render ONLY
  when there is real expandable content; otherwise the node is a flat label.

L9 — the agent/chat mode switch is meaningless in this game (play is always hybrid),
  so it is HIDDEN in the game build only (gated on data-game-build).

L20 — trailing `?` stripped from the END of model responses. A reply ending in `?`
  (or `??`) must round-trip intact through the content-clean / scrub steps.
"""

import os
import re
import shutil
import subprocess
import tempfile

import pytest

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*rel):
    with open(os.path.join(FRONTEND, *rel), encoding="utf-8") as f:
        return f.read()


# ── L6b ──────────────────────────────────────────────────────────────────────── #

def test_markdown_scrubs_plain_content_reasoning_preamble():
    md = _read("static", "js", "markdown.js")
    assert "export function scrubReasoningPreamble(" in md
    # raw engine entity ids and operator/planning openers are the scrub targets
    assert "npc:" in md
    for opener in ("let me", "looking at", "the game state", "i need", "i should"):
        assert opener in md.lower()
    # the game-build render path calls the scrub before rendering the reply
    pwt = md[md.index("export function processWithThinking"):]
    gated = pwt[pwt.index("if (gameBuildSuppressesThinking())"):]
    gated = gated[:gated.index("let html = ''")]
    assert "scrubReasoningPreamble(" in gated


# L6c (2026-06-21) SUPERSEDES L6b: a multi-round agent turn (the casting interview, a multi-beat
# scene) narrates real player-facing dialogue across several rounds; the old "only the FINAL round
# renders" rule lost all but the last ("4 answers go away" — prod casting loop). The discriminator
# is now CONTENT (a round that produced visible narration persists; only an empty tool-only round is
# hidden), not POSITION. The reasoning-preamble scrub (processWithThinking) still strips planning.

def test_l6c_narration_round_with_following_tool_is_kept_live():
    """A round that produced visible narration renders even when a tool follows it; only an EMPTY
    tool-only round is hidden. The old unconditional game-build hide at the tool_start finalize is
    gone — game + non-game share one content-driven rule. #829 TURN COALESCING: an empty round may
    hide the (still-empty) turn bubble ONLY while nothing is committed yet; once the turn carries
    committed narration an empty round retires its live container and never hides the bubble
    (hiding it was the reverted #822 era's "messages disappear")."""
    chat = _read("static", "js", "chat.js")
    fin = chat[chat.index("Finalize current text bubble (only once per round)"):]
    fin = fin[:fin.index("Track tool name for contextual spinner labels")]
    # the old unconditional game-build hide is REMOVED from this block
    assert "if (isGameBuild()) {" not in fin
    # a round with visible narration renders the reply (one shared rule, no game gate)
    assert "if (dt.trim())" in fin
    assert "markdownModule.processWithThinking(markdownModule.squashOutsideCode(dt))" in fin
    # the whole-bubble hide survives ONLY for the nothing-committed-yet case...
    assert "} else if (!_turnHasCommitted()) {" in fin
    assert "roundHolder.style.display = 'none';" in fin
    # ...and a committed turn's empty round just retires the empty live container.
    assert "_emptySc3.remove();" in fin


def test_l6c_agent_step_coalesces_rounds_into_one_turn_bubble():
    """#829 TURN COALESCING (supersedes the per-round L6c mount/hide): starting a new agent round
    FREEZES the finished round into the SAME turn bubble (_freezeRoundIntoTurnBubble renames its
    live containers to inert committed blocks) instead of spawning a fresh msg-continuation
    bubble. The L6c CONTENT discriminator survives INSIDE the one bubble: a narration round
    persists as a committed block, a pure tool-call round contributes nothing. The per-round
    split buffers reset in lockstep with roundText (F8), the spinner re-arms as a DIRECT `.body`
    child (never inside the renderer-owned .stream-content — the #822 failure class), and the
    teacher takeover remains the only fresh-bubble path."""
    chat = _read("static", "js", "chat.js")
    step = chat[chat.index("} else if (json.type === 'agent_step') {"):]
    step = step[:step.index("} else if (json.type === 'budget_exceeded') {")]
    # the round is frozen into the one bubble, not spawned as a new bubble
    assert "_freezeRoundIntoTurnBubble();" in step
    # F8: the merged buffer + the split buffers reset in lockstep at the round boundary
    assert step.count("roundText = '';") >= 2          # coalesce branch + teacher branch
    assert step.count("roundReplyText = '';") >= 2
    assert step.count("roundReasoningText = '';") >= 2
    # the spinner re-arms in the SAME body, as a direct child (one stable position per turn)
    assert "roundHolder.querySelector('.body').appendChild(spinner.createElement());" in step
    # the teacher_takeover exception (roundHolder === null) still creates a fresh bubble
    assert "if (roundHolder) {" in step
    assert "roundHolder = newWrap;" in step
    # the old per-round hide-at-agent_step is GONE (an empty round is handled by the freeze)
    assert "!stripToolBlocks(roundReplyText).trim()" not in step


def test_829_freeze_helper_contract():
    """The freeze helper is the coalescing mechanism: it retires the finished round's live
    containers (stream-content → committed-round, live-reply-content → committed-reply), clears
    the incremental-renderer bookkeeping, and resets the per-round accordion refs so a frozen
    block can never receive cross-round writes. The end-of-stream finalize must never whole-body
    innerHTML once committed blocks exist."""
    chat = _read("static", "js", "chat.js")
    helper = chat[chat.index("const _freezeRoundIntoTurnBubble = () => {"):]
    helper = helper[:helper.index("const _turnHasCommitted = () => {")]
    assert "el.classList.remove('stream-content');" in helper
    assert "el.classList.add('committed-round');" in helper
    assert "el.classList.remove('live-reply-content');" in helper
    assert "el.classList.add('committed-reply');" in helper
    assert "el._streamRenderer = null;" in helper
    assert "_liveThinkSection = null;" in helper
    # the finalize renders ONLY into the live container when committed blocks exist
    fin = chat[chat.index("var _hasCommitted4 ="):]
    fin = fin[:fin.index("if (window.hljs) {")]
    assert "} else if (_hasCommitted4) {" in fin
    assert "_liveSc4.innerHTML =" in fin
    # ...and the single-round whole-body render survives byte-identically for the no-committed case
    assert "_body4.innerHTML = (_sourcesData ? _buildSourcesBox(_sourcesData, _sourcesType, _wasExpanded) : '')" in fin


def test_l6c_reload_renders_every_narration_round_not_just_last():
    """Reload parity: every narration round still renders on reload — nothing is lost. #829 TURN
    COALESCING: the rounds accumulate INSIDE the one turn bubble (one `.committed-round` block
    per non-empty round, matching the live freeze) instead of across per-round continuation
    bubbles; the intermediate-round skip stays gone."""
    renderer = _read("static", "js", "chatRenderer.js")
    # the L6b intermediate-skip must never return
    assert "_gbSkipIntermediateText = isGameBuild() && !isLastTextRound" not in renderer
    # every non-empty round renders as its own committed block inside the ONE bubble
    assert "let roundSegs = roundTexts.map((t) => (t || '').trim()).filter(Boolean);" in renderer
    assert "roundSegs.map((t) => '<div class=\"committed-round\">'" in renderer
    # legacy rows without round_texts still render their persisted content (never lose narration)
    assert "if (!roundSegs.length && (textRaw || '').trim()) roundSegs = [(textRaw || '').trim()];" in renderer


# ── L7 ───────────────────────────────────────────────────────────────────────── #

def test_live_tool_node_only_renders_chevron_when_expandable():
    chat = _read("static", "js", "chat.js")
    out = chat[chat.index("const cmdHtml2 ="):]
    out = out[:out.index("_lastToolName = '';")]
    assert "_hasExpand" in out
    assert "agent-thread-node--flat" in out
    # the chevron + content div are conditional on real content
    assert "_chevron2 = _hasExpand ?" in out
    assert "_contentDiv2 = _hasExpand ?" in out


def test_reload_tool_node_only_renders_chevron_when_expandable():
    renderer = _read("static", "js", "chatRenderer.js")
    assert "_evHasExpand" in renderer
    assert "agent-thread-node--flat" in renderer
    assert "_evChevron = _evHasExpand ?" in renderer
    assert "_evContentDiv = _evHasExpand ?" in renderer


def test_flat_node_is_not_a_click_target():
    chat = _read("static", "js", "chat.js")
    # the delegated fold/expand handler ignores flat nodes
    handler = chat[chat.index("Single delegated handler for tool-call fold/expand"):]
    handler = handler[:handler.index("__orwell_thread_click_bound = true;")]
    assert "agent-thread-node--flat" in handler
    assert "return;" in handler
    # CSS removes the pointer affordance for a flat node
    style = _read("static", "style.css")
    assert ".agent-thread-node--flat" in style
    assert "cursor: default;" in style[style.index(".agent-thread-node--flat"):]


# ── L9 ───────────────────────────────────────────────────────────────────────── #

def test_mode_toggle_hidden_in_game_build():
    # The Agent|Chat switch is meaningless in this game (always hybrid) — hidden in the
    # game build regardless of whether a game is active yet (casting included).
    css = _read("static", "css", "game-trim.css")
    # the rule targets the toggle under the game build, NOT only data-game-active
    rule = re.search(
        r"body\[data-game-build\][^\n{]*\.mode-toggle\s*\{[^}]*display:\s*none[^}]*\}",
        css,
    )
    assert rule, "no game-build rule hides .mode-toggle"
    # and it is not narrowed to an active game only (the L9 widening)
    assert 'body[data-game-build] .mode-toggle' in css
    # belt-and-suspenders JS gate exists in a chat/composer file we own
    chat = _read("static", "js", "chat.js")
    assert "mode-toggle" in chat and "isGameBuild()" in chat


def test_mode_toggle_present_in_non_game_build():
    # NON-game build keeps the toggle (no unconditional hide).
    css = _read("static", "css", "game-trim.css")
    # every .mode-toggle hide rule is scoped under body[data-game-build]
    for m in re.finditer(r"([^\n{}]*\.mode-toggle[^\n{}]*)\{[^}]*display:\s*none", css):
        assert "data-game-build" in m.group(1)


# ── L20 ──────────────────────────────────────────────────────────────────────── #

# L45 — the same systemic class the owner re-reported can recur in via ANY trailing
# sentence-terminator, not only `?`. The single line of defense (these guards) must cover
# `?`, `!`, `.` and `…` (ellipsis) — plus a closing quote/paren riding after them.
_L45_TERMINATORS = ("?", "!", ".", "…")


@pytest.mark.parametrize("term", _L45_TERMINATORS)
def test_python_live_scrub_preserves_trailing_terminator(term):
    # The live-game stream scrub + the saved-message strip must not eat a trailing
    # sentence terminator (?, !, ., …) — L20/L45.
    os.environ.setdefault(
        "DATABASE_URL",
        "sqlite:///" + os.path.join(tempfile.mkdtemp(prefix="orwell-l20-db-"), "app.db"),
    )
    import src.agent_tools  # noqa: F401  (load-order coupling)
    import src.agent_loop as al
    import src.tool_parsing as tp

    # Each case carries (input, suffix-that-must-survive). The terminator may sit at
    # the very end, be doubled, or ride just inside a closing quote/parenthetical —
    # in every shape the punctuation (and the quote/paren after it) must round-trip.
    cases = (
        (f"Who do you trust most in this house{term}", term),
        (f"So what is your move{term}{term}", f"{term}{term}"),
        (f"They huddle by the pool{term}", term),
        (f"I trust you{term} Do you really trust me{term}", term),
        (f'"You ready{term}"', f'{term}"'),
        (f"(We never saw that coming{term})", f"{term})"),
    )
    for reply, suffix in cases:
        comp, rem = al._split_complete_sentences(reply)
        scrubbed = al._scrub_game_leak(comp) + al._scrub_game_leak(rem)
        assert scrubbed.endswith(suffix), \
            f"live scrub ate the trailing {suffix!r} from {reply!r} -> {scrubbed!r}"
        stripped = tp.strip_tool_blocks(reply)
        assert stripped.endswith(suffix), \
            f"strip_tool_blocks ate the trailing {suffix!r} from {reply!r} -> {stripped!r}"


def test_python_live_scrub_preserves_trailing_question_mark():
    # The live-game stream scrub + the saved-message strip must not eat a trailing `?`.
    os.environ.setdefault(
        "DATABASE_URL",
        "sqlite:///" + os.path.join(tempfile.mkdtemp(prefix="orwell-l20-db-"), "app.db"),
    )
    import src.agent_tools  # noqa: F401  (load-order coupling)
    import src.agent_loop as al
    import src.tool_parsing as tp

    for reply in (
        "Who do you trust most in this house?",
        "So what is your move??",
        "Are you ready to play?",
        "I trust you. Do you trust me?",
        "You ready?",
    ):
        comp, rem = al._split_complete_sentences(reply)
        scrubbed = al._scrub_game_leak(comp) + al._scrub_game_leak(rem)
        assert scrubbed.endswith("?"), f"live scrub ate the trailing ? from {reply!r}"
        assert tp.strip_tool_blocks(reply).endswith("?"), \
            f"strip_tool_blocks ate the trailing ? from {reply!r}"


def test_python_streaming_scrub_round_trips_trailing_question():
    os.environ.setdefault(
        "DATABASE_URL",
        "sqlite:///" + os.path.join(tempfile.mkdtemp(prefix="orwell-l20-db-"), "app.db"),
    )
    import src.agent_tools  # noqa: F401
    import src.agent_loop as al

    def simulate(deltas):
        round_response = ""
        full = ""
        game_buf = ""
        halted = False
        emitted_len = 0
        for d in deltas:
            round_response += d
            if not halted and al.tool_call_opener_index(round_response) >= 0:
                halted = True
            if not halted:
                game_buf += d
                emitted_len = len(round_response)
            complete, game_buf = al._split_complete_sentences(game_buf)
            if complete:
                clean = al._scrub_game_leak(complete)
                if clean:
                    full += clean
            if halted:
                game_buf = ""
        if game_buf:
            clean = al._scrub_game_leak(game_buf)
            if clean:
                full += clean
        return full

    # The terminator arrives in the final delta and the stream ends. L45 widens this
    # from `?`-only to every sentence terminator (?, !, ., …).
    cases = [
        (["The room ", "goes quiet. ", "Who do ", "you trust ", "most", "?"],
         "The room goes quiet. Who do you trust most?"),
        (["So ", "what is ", "your move", "?"], "So what is your move?"),
        (["Ready", "?"], "Ready?"),
        (["The lights ", "snap ", "off", "!"], "The lights snap off!"),
        (["She ", "leaves the ", "room", "."], "She leaves the room."),
        (["He ", "trails ", "off", "…"], "He trails off…"),
    ]
    for deltas, expected in cases:
        assert simulate(deltas) == expected


_NODE = shutil.which("node")


def _run_node(program: str, *argv: str):
    # Plain (CommonJS) script mode so an eval'd `function`/`const` is visible to the
    # rest of the eval'd program. The pure helpers under test have no DOM deps.
    return subprocess.run(
        [_NODE, "-e", program, "--", *argv], capture_output=True, text=True,
    )


@pytest.mark.skipif(_NODE is None, reason="node not available")
def test_js_scrub_reasoning_preamble_keeps_trailing_question():
    # scrubReasoningPreamble is a pure function (no DOM) — drive it in Node directly.
    # It must NOT strip a legitimate trailing `?`, and it must drop a leading
    # operator/planning preamble while keeping the narration that follows.
    md_path = os.path.join(FRONTEND, "static", "js", "markdown.js")
    program = r"""
    const fs = require('fs');
    const src = fs.readFileSync(process.argv[1], 'utf8');
    const reLine = src.match(/const _REASONING_LINE_RE = [^\n]+/)[0];
    const reNpc  = src.match(/const _RAW_NPC_ID_RE = [^\n]+/)[0];
    const fn = src.slice(src.indexOf('export function scrubReasoningPreamble'));
    const body = fn.slice(0, fn.indexOf('\n}\n') + 2).replace('export function', 'function');
    const cases = [
      ['Are you ready to play?', 'Are you ready to play?'],
      ['So what is your move??', 'So what is your move??'],
      ['Looking at the roster: npc:1 - someone.\nWelcome to the house. Who do you trust?',
       'Welcome to the house. Who do you trust?'],
      ['Let me stay in character.\nThe lights dim. Ready?', 'The lights dim. Ready?'],
      // L45 — preserve every trailing sentence terminator, not just `?`.
      ['The lights snap off!', 'The lights snap off!'],
      ['She leaves the room.', 'She leaves the room.'],
      ['He trails off…', 'He trails off…'],
    ];
    const run = new Function('cases', reLine + '\n' + reNpc + '\n' + body + '\n' +
      "let ok = true;" +
      "for (const [inp, exp] of cases) { const got = scrubReasoningPreamble(inp);" +
      "  if (got !== exp) { ok = false; console.error('MISMATCH', JSON.stringify(inp), '=>', JSON.stringify(got)); } }" +
      "return ok;");
    console.log(run(cases) ? 'OK' : 'FAIL');
    """
    res = _run_node(program, md_path)
    assert "OK" in res.stdout, f"stdout={res.stdout!r} stderr={res.stderr!r}"


@pytest.mark.skipif(_NODE is None, reason="node not available")
def test_js_strip_tool_blocks_keeps_trailing_question():
    # The FE stripToolBlocks regex set (chatRenderer.js) must not eat a trailing `?`.
    renderer_path = os.path.join(FRONTEND, "static", "js", "chatRenderer.js")
    program = r"""
    const fs = require('fs');
    const src = fs.readFileSync(process.argv[1], 'utf8');
    const reNames = ['TOOL_CALL_RE','EXEC_FENCE_RE','XML_TOOL_CALL_RE','XML_INVOKE_RE',
                     'DSML_TOOL_RE','DSML_STRAY_RE','TOOL_NARRATION_RE'];
    let prelude = '';
    for (const n of reNames) {
      const m = src.match(new RegExp('const ' + n + ' = [^\\n]+'));
      if (m) prelude += m[0] + '\n';
    }
    const fn = src.slice(src.indexOf('export function stripToolBlocks'));
    const body = fn.slice(0, fn.indexOf('\n}\n') + 2).replace('export function', 'function');
    // L45 — every trailing sentence terminator (?, !, ., …) must survive, not just `?`.
    const cases = ['Who do you trust most in this house?','So what is your move??','Ready to play?',
                   'You ready??','The lights snap off!','She leaves the room.','He trails off…',
                   'No way!!','Wait...'];
    const run = new Function('cases', prelude + body + '\n' +
      "const TERMS = ['?','!','.','…'];" +
      "let ok = true;" +
      "for (const t of cases) { const got = stripToolBlocks(t);" +
      "  const term = TERMS.find(x => t.endsWith(x));" +
      "  if (!got.endsWith(term)) { ok = false; console.error('ATE', JSON.stringify(term), JSON.stringify(t), '=>', JSON.stringify(got)); } }" +
      "return ok;");
    console.log(run(cases) ? 'OK' : 'FAIL');
    """
    res = _run_node(program, renderer_path)
    assert "OK" in res.stdout, f"stdout={res.stdout!r} stderr={res.stderr!r}"
