"""B6 — strip workspace machinery that leaks the costume (Thesis 2, FE-chrome half).

Orwell is a vendored general chat-workspace wearing a Big Brother costume; several pieces of
that workspace's own chrome bled through the fiction, ungated by the game build
(`ORWELL_GAME_BUILD`, default on):

  - the composer's inline "model pill" (`#model-picker-wrap` / `#model-picker-btn`) named the
    raw model/provider id on every turn — a SEPARATE DOM node from the already-admin-gated
    Settings `#model-select` dropdown (E72), so the E72 rule didn't cover it.
  - the "· N msgs" counter next to the chat title (`#current-meta-count`, populated live in
    app.js) named the transcript as a workspace "chat" with a message count.
  - `markdown.js` rendered a live "Run code" button (a real Pyodide/server-shell executor via
    `codeRunnerModule.run`) and an "Edit code" button on ANY fenced code block, regardless of
    build — Big Brother never runs your Python for you.
  - the `rounds_exhausted` branch in `chat.js` surfaced "Reached the N-step limit — not
    finished." / a "Continue the task"-titled button, naming the agent loop's tool-call budget
    directly mid-scene, ungated even though the sibling stream-error branch a few hundred lines
    up already has the isGameBuild() diegetic-copy treatment (#872 item A).
  - the reasoning "Thinking" accordion (`markdown.js` `processWithThinking`) rendered each
    `<think>` block completely UNSCRUBBED — a live real-model run confirmed it named backstage
    machinery ("the engine shows…", "the game is WAITING on a PLAYER DECISION") verbatim, even
    though the reply channel a few lines above gets `redactRawIds` + `scrubMachineryAsides`
    before it ever reaches the public bubble.

Fixes gate/remove each tell under the game build, reusing the existing gating mechanisms
(`body[data-game-build]` CSS, the shared `isGameBuild()` / `_inGameBuild()` JS helpers, and —
for the accordion — the SAME scrub functions the body already runs through, not a new regex
family). Source-pinned; no browser required.
"""

import os
import re
import shutil
import subprocess

import pytest

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_NODE = shutil.which("node")


def _read(*rel):
    with open(os.path.join(FRONTEND, *rel), encoding="utf-8") as f:
        return f.read()


CSS_TRIM = _read("static", "css", "game-trim.css")
HTML_SRC = _read("static", "index.html")
JS_MARKDOWN = _read("static", "js", "markdown.js")
JS_CHAT = _read("static", "js", "chat.js")


# ===========================================================================
# Model pill (composer inline model switcher)
# ===========================================================================

class TestModelPillGating:
    def test_model_picker_wrap_present_in_html(self):
        assert 'id="model-picker-wrap"' in HTML_SRC
        assert 'id="model-picker-btn"' in HTML_SRC

    def test_model_picker_wrap_admin_only_under_game_build(self):
        # Same E72 "players never see raw model ids" rule the Settings #model-select dropdown
        # already gets — the composer's OWN model switcher is a separate DOM node that rule
        # never covered.
        assert "body[data-game-build] #model-picker-wrap { display: none; }" in CSS_TRIM
        assert "body[data-game-build].is-admin #model-picker-wrap" in CSS_TRIM


# ===========================================================================
# Message counter
# ===========================================================================

class TestMessageCounterGating:
    def test_counter_element_present_in_html(self):
        assert 'id="current-meta-count"' in HTML_SRC

    def test_counter_hidden_under_game_build(self):
        assert "body[data-game-build] #current-meta-count { display: none !important; }" in CSS_TRIM

    def test_title_itself_is_not_hidden(self):
        # Only the count suffix is a workspace tell — the title (season/session name) stays.
        assert "#current-meta {" not in CSS_TRIM
        assert "body[data-game-build] #current-meta " not in CSS_TRIM
        assert "body[data-game-build] #current-meta{" not in CSS_TRIM


# ===========================================================================
# "Run code" / "Edit code" buttons on fenced code blocks
# ===========================================================================

class TestRunCodeButtonGating:
    def _code_fence_block(self):
        block = JS_MARKDOWN[JS_MARKDOWN.index("const runnableLangs = "):]
        return block[: block.index("return placeholder;")]

    def test_run_button_gated_on_game_build(self):
        block = self._code_fence_block()
        assert "!_inGameBuild()" in block, (
            "the run-code button (a live Pyodide/server-shell executor) must be dropped "
            "outright in the game build"
        )
        # the gate must guard the SAME branch that emits the run-code button markup
        run_branch = block[block.index("const runBtn ="):block.index("const editBtn =")]
        assert "!_inGameBuild()" in run_branch
        assert "class=\"run-code\"" in run_branch

    def test_edit_button_gated_on_game_build(self):
        block = self._code_fence_block()
        edit_branch = block[block.index("const editBtn ="):]
        assert "_inGameBuild()" in edit_branch
        assert "class=\"edit-code\"" in edit_branch

    def test_copy_button_stays_ungated(self):
        # Copying game text is not machinery — only run/edit are workspace tells.
        block = self._code_fence_block()
        assert 'class="copy-code"' in block


# ===========================================================================
# Step-limit toast ("rounds_exhausted")
# ===========================================================================

class TestStepLimitToastGating:
    def _rounds_exhausted_branch(self):
        block = JS_CHAT[JS_CHAT.index("json.type === 'rounds_exhausted'"):]
        return block[: block.index("json.type === 'truncated'")]

    def test_label_is_diegetic_in_game_build(self):
        branch = self._rounds_exhausted_branch()
        assert "label.textContent = isGameBuild()" in branch
        m = re.search(
            r"label\.textContent = isGameBuild\(\)\s*\?\s*'(.*?)'\s*:", branch, re.S,
        )
        assert m, "could not find the game-build diegetic rounds_exhausted label"
        diegetic = m.group(1)
        for forbidden in ("step limit", "step-limit", "Reached", "not finished"):
            assert forbidden not in diegetic, (
                f"the diegetic rounds_exhausted label leaks machinery word {forbidden!r}: "
                f"{diegetic!r}"
            )

    def test_non_game_build_keeps_the_informative_label(self):
        branch = self._rounds_exhausted_branch()
        assert "step limit — not finished" in branch

    def test_button_title_and_text_are_diegetic_in_game_build(self):
        branch = self._rounds_exhausted_branch()
        assert "contBtn.title = isGameBuild() ? 'Keep the scene going' : 'Continue the task';" in branch
        assert "contBtn.textContent = isGameBuild() ? 'Keep going ▸' : 'Continue ▸';" in branch

    def test_hidden_resend_prompt_is_unchanged(self):
        # The actual resend text sent to the model on click is never shown to the player
        # (_hideUserBubble = true) — MICRO-3's fix only touches the VISIBLE label/button.
        branch = self._rounds_exhausted_branch()
        assert "_hideUserBubble = true;" in branch
        assert "You hit the step limit before finishing" in branch


# ===========================================================================
# Reasoning ("Thinking") accordion scrub
# ===========================================================================

class TestReasoningAccordionScrub:
    def _accordion_branch(self):
        pwt = JS_MARKDOWN[JS_MARKDOWN.index("export function processWithThinking"):]
        gated = pwt[pwt.index("if (gameBuildShowsThinkingAccordion())"):]
        return gated[: gated.index("if (leadingAsideText)")]

    def test_accordion_content_is_scrubbed_before_render(self):
        branch = self._accordion_branch()
        # reuses the SAME body-scrub functions — no bespoke accordion regex family
        assert "scrubMachineryAsides(redactRawIds(block))" in branch
        assert "createThinkingSection(scrubbedBlock" in branch
        # a block that scrubs to nothing renders no accordion shell
        assert "if (scrubbedBlock)" in branch

    def test_machinery_word_list_covers_the_confirmed_live_leak(self):
        # deepplay DEEP-25 / the confirmed live-run leak: "the game is WAITING on a PLAYER
        # DECISION" echoes momentPrompts.ts's own "pending decision" prompt vocabulary.
        assert "pending decision" in JS_MARKDOWN
        assert "player(?:'s)? decision" in JS_MARKDOWN


@pytest.mark.skipif(_NODE is None, reason="node not available")
def _run_accordion_scrub(cases):
    """Node round-trip: extract the pure redactRawIds + scrubMachineryAsides helpers (no DOM)
    and prove they strip the confirmed accordion leak phrases the same way the body scrub does."""
    md_path = os.path.join(FRONTEND, "static", "js", "markdown.js")
    program = r"""
    const fs = require('fs');
    const src = fs.readFileSync(process.argv[1], 'utf8');
    function grab(marker, end) {
      const i = src.indexOf(marker);
      const j = src.indexOf(end, i);
      return src.slice(i, j);
    }
    const words = grab('const _GAME_TOOL_WORDS = [', '];') + '];';
    const re = grab('const _MACHINERY_ASIDE_RE = new RegExp(', ');') + ');';
    const reasonLineRe = grab('const _REASONING_LINE_RE =', ';') + ';';
    const rawNpcIdGlobalRe = grab('const _RAW_NPC_ID_GLOBAL_RE =', ';') + ';';
    let fnRedact = src.slice(src.indexOf('export function redactRawIds'));
    fnRedact = fnRedact.slice(0, fnRedact.indexOf('\n}\n') + 2).replace('export function', 'function');
    let fnMachinery = src.slice(src.indexOf('export function scrubMachineryAsides'));
    fnMachinery = fnMachinery.slice(0, fnMachinery.indexOf('\n}\n') + 2).replace('export function', 'function');
    const cases = JSON.parse(process.argv[2]);
    const run = new Function('cases', words + '\n' + re + '\n' + reasonLineRe + '\n' +
      rawNpcIdGlobalRe + '\n' + fnRedact + '\n' + fnMachinery + '\n' +
      "let ok = true;" +
      "for (const [inp, exp] of cases) { const got = scrubMachineryAsides(redactRawIds(inp));" +
      "  if (got.trim() !== exp.trim()) { ok = false;" +
      "    console.error('MISMATCH', JSON.stringify(inp), '=>', JSON.stringify(got), 'WANT', JSON.stringify(exp)); } }" +
      "return ok;");
    console.log(run(cases) ? 'OK' : 'FAIL');
    """
    import json
    return subprocess.run(
        [_NODE, "-e", program, "--", md_path, json.dumps(cases)],
        capture_output=True, text=True,
    )


@pytest.mark.skipif(_NODE is None, reason="node not available")
def test_accordion_scrub_strips_the_confirmed_live_leak_phrases():
    cases = [
        ["The engine shows the game is WAITING on a PLAYER DECISION. My read on the room: "
         "wildcard energy, a hook in the question.",
         "My read on the room: wildcard energy, a hook in the question."],
        ["npc:7 leans in and whispers a plan. She smiles warmly at you.",
         "leans in and whispers a plan. She smiles warmly at you."],
        ["The pending decision is which nominee to save. The room falls quiet.",
         "The room falls quiet."],
    ]
    res = _run_accordion_scrub(cases)
    assert "OK" in res.stdout, f"stdout={res.stdout!r} stderr={res.stderr!r}"


@pytest.mark.skipif(_NODE is None, reason="node not available")
def test_accordion_scrub_does_not_over_scrub_ordinary_reasoning_prose():
    cases = [
        ["I think she's bluffing about the alliance. Her tone shifted when I mentioned the vote.",
         "I think she's bluffing about the alliance. Her tone shifted when I mentioned the vote."],
    ]
    res = _run_accordion_scrub(cases)
    assert "OK" in res.stdout, f"stdout={res.stdout!r} stderr={res.stderr!r}"
