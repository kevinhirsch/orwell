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
    `<think>` block with a raw `npc:<id>` engine token showing verbatim. The accordion is the
    model's PRIVATE chain-of-thought, already walled from the fiction body (the public reply
    gets the full reasoning/machinery scrub) — the P1 owner ruling keeps it and it is ALLOWED
    to discuss mechanics/levers (browser_smoke's reasoning/public split proves lever talk stays
    OUT of the bubble but IS held here). So the only safe cleanup is a SURGICAL npc:<id> token
    redaction — running the line/sentence-dropping body scrubs would empty a mechanics-heavy
    reasoning block and vanish the accordion.

Fixes gate/remove each tell under the game build, reusing the existing gating mechanisms
(`body[data-game-build]` CSS, the shared `isGameBuild()` / `_inGameBuild()` JS helpers, and —
for the accordion — only the pure `_RAW_NPC_ID_GLOBAL_RE` token redaction). Source-pinned; no
browser required.
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

    def test_accordion_redacts_only_the_raw_npc_id_token(self):
        # The reasoning accordion is the model's PRIVATE chain-of-thought, already walled from
        # the fiction body — the P1 owner ruling keeps it, and it is ALLOWED to discuss
        # mechanics/levers (that's exactly what browser_smoke's reasoning/public split proves).
        # So the accordion must NOT run the line-dropping / sentence-dropping body scrubs
        # (redactRawIds / scrubMachineryAsides) — those would empty a mechanics-heavy block and
        # vanish the accordion. The ONE surgical cleanup is a pure npc:<id> TOKEN redaction.
        branch = self._accordion_branch()
        assert "block.replace(_RAW_NPC_ID_GLOBAL_RE, '')" in branch
        assert "createThinkingSection(cleanedBlock" in branch

    def test_accordion_does_not_run_the_body_line_or_sentence_scrubs(self):
        branch = self._accordion_branch()
        # neither line-dropping (redactRawIds) nor sentence-dropping (scrubMachineryAsides) may
        # run on the accordion — they would over-scrub a mechanics-heavy reasoning block.
        assert "redactRawIds(" not in branch
        assert "scrubMachineryAsides(" not in branch

    def test_machinery_aside_regex_not_extended_for_the_accordion(self):
        # The accordion fix does NOT touch the public-body scrub regex — the "pending decision"
        # / "player decision" additions (an earlier over-scrubbing approach) are reverted, so
        # the public-reply scrub keeps its original high-precision surface.
        assert "pending decision" not in JS_MARKDOWN
        assert "player(?:'s)? decision" not in JS_MARKDOWN


@pytest.mark.skipif(_NODE is None, reason="node not available")
def _run_accordion_redact(cases):
    """Node round-trip: extract the pure npc:<id> token redaction the accordion applies and
    prove it strips the raw id WITHOUT emptying mechanics-heavy reasoning (never line-drops)."""
    md_path = os.path.join(FRONTEND, "static", "js", "markdown.js")
    program = r"""
    const fs = require('fs');
    const src = fs.readFileSync(process.argv[1], 'utf8');
    function grab(marker, end) {
      const i = src.indexOf(marker);
      const j = src.indexOf(end, i);
      return src.slice(i, j);
    }
    const rawNpcIdGlobalRe = grab('const _RAW_NPC_ID_GLOBAL_RE =', ';') + ';';
    const cases = JSON.parse(process.argv[2]);
    const run = new Function('cases', rawNpcIdGlobalRe + '\n' +
      "const redact = (b) => b.replace(_RAW_NPC_ID_GLOBAL_RE, '');" +
      "let ok = true;" +
      "for (const [inp, exp] of cases) { const got = redact(inp);" +
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
def test_accordion_redacts_raw_npc_ids_but_keeps_the_mechanics_reasoning():
    # The browser_smoke reasoning fixture is deliberately mechanics-heavy (lever names, a
    # "rewind") to PROVE that content is held in the accordion (not the bubble). The accordion
    # treatment must keep every bit of it — only a bare npc:<id> token is redacted.
    cases = [
        # the exact browser_smoke reasoning block: levers + "Let me rewind" all survive
        ["Let me rewind that. I should call whereabouts and npcVoice, then a social read via "
         "getGameState before narrating.",
         "Let me rewind that. I should call whereabouts and npcVoice, then a social read via "
         "getGameState before narrating."],
        # a bare npc:<id> engine token is redacted; the trailing name survives
        ["npc:7 leans in and whispers a plan. She smiles warmly at you.",
         "leans in and whispers a plan. She smiles warmly at you."],
        # ordinary reasoning prose is byte-identical
        ["I think she's bluffing about the alliance. Her tone shifted when I mentioned the vote.",
         "I think she's bluffing about the alliance. Her tone shifted when I mentioned the vote."],
    ]
    res = _run_accordion_redact(cases)
    assert "OK" in res.stdout, f"stdout={res.stdout!r} stderr={res.stderr!r}"
