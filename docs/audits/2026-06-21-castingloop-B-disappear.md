# 2026-06-21 — Casting-loop "answers generate then disappear" (multi-round agent turn) — diagnosis + fix

- **Type:** READ-ONLY diagnosis. No code changed. Concrete fix + test specs below; implement directly.
- **Symptom (PO):** during the casting interview "you get like 4 answers and they all go away."
- **Evidence:** `docs/audits/2026-06-21-casting-loop-evidence.md` (prod debug bundle, deepseek/deepseek-v4-pro, phase=setup).
- **Companion audit (game build, same mechanism):** `docs/audits/2026-06-21-mirror-B-disappear.md` (cause D1/D2).
- **Roles only.** No game-entity names used.

> **Channel-split is NOT the bug and MUST be preserved.** Reasoning routed to the Thinking accordion
> (`roundReasoningText`) and kept out of the public bubble (`roundReplyText`) is by design (CLAUDE.md).
> Everything below moves *only* public `roundReplyText` narration; it never touches the reasoning channel.

---

## Root cause (one paragraph)

In the game build, every agent round that is followed by a tool call or a new round is treated as the
model's *planning* and its bubble is hidden (`chat.js:2169-2170` on `tool_start`-after-text and
`chat.js:2672-2673` on `agent_step`), and the end-of-turn final render re-shows **only the LAST round's**
`roundReplyText` (`chat.js:2861`). That L6b heuristic assumes player-facing narration only ever lands in
the **final** round. The casting interview violates that assumption structurally: the interviewer
**narrates a real line of dialogue in rounds 1, 2, 4, 5, … and the turn keeps going** (more rounds, plus
the `casting finalize nudge` L0–L4 re-prompts that never terminate — audit A). Each narration round is
therefore reclassified as "intermediate" and hidden the instant the next round starts, while only the
final round survives — and if the turn ends on a tool-only / empty round (round 3 in the evidence: "0
chars, 1 native call"), even the final render is blank. The player watches ~4 interviewer lines paint and
vanish. The reload path (`chatRenderer.js:1935-1947`, `_gbSkipIntermediateText = isGameBuild() &&
!isLastTextRound`) has the **identical** last-round-only rule, so a history reload reproduces it rather
than rescuing it. **The finalize loop (audit A) is the blast-radius multiplier (it manufactures many
narration rounds per turn), but the hide itself is the bug** — even a single narrate-then-tool round
disappears.

---

## Confirmed sites (file:line)

### Buffer mechanics (ground truth)
- **`chat.js:1479-1480`** — channel split: `if (json.thinking) roundReasoningText += json.delta; else roundReplyText += json.delta;`. Public narration → `roundReplyText`. Reasoning is structurally absent from it.
- **`chat.js:2705-2707`** (and `:2746-2747`, teacher path) — on a new round, `roundText='' ; roundReplyText='' ; roundReasoningText=''`. So at any hide-decision point, `roundReplyText` holds **this round's reply only**; prior rounds' replies are already gone from the buffer and survive only as painted DOM in their (about-to-be-hidden) `roundHolder`.
- **`chat.js:1291-1327`** `_renderStream()` paints `stripToolBlocks(roundReplyText)` (reply-only) into the current `roundHolder` — this is what the player SEES grow.
- **`chatRenderer.js:835-845`** `stripToolBlocks` — strips tool-invocation blocks; trailing punctuation preserved (L20/L45 gate). Empty/whitespace ⇒ `''`.

### Hide site 1 — a tool follows this round's text (`tool_start`)
`chat.js:2159-2180`:
```js
if (!roundFinalized) {
  roundFinalized = true;
  if (spinner && spinner.element) spinner.destroy();
  const dt = stripToolBlocks(roundReplyText);   // 2162
  if (isGameBuild()) {                            // 2169  <-- BUG: hides UNCONDITIONALLY
    roundHolder.style.display = 'none';           // 2170      even when dt has real narration
  } else if (dt.trim()) { ...render... }          // 2171 (non-game: renders)
  else { roundHolder.style.display = 'none'; }     // 2178 (non-game: empty → hide, correct)
}
```
In the game build the bubble is hidden **whether or not `dt` carried visible narration**. The non-game
branch already does the right thing (render when `dt.trim()`, hide only when empty).

### Hide site 2 — a new round begins (`agent_step`)
`chat.js:2661-2674`:
```js
} else if (json.type === 'agent_step') {
  ...
  _renderStream();                                  // 2665 (paints the round we're about to hide)
  if (isGameBuild() && roundHolder) {               // 2672  <-- BUG: hides UNCONDITIONALLY
    roundHolder.style.display = 'none';             // 2673      no check that the round was empty
  }
  ...new roundHolder, buffers reset at 2705-2707...
}
```
Here `roundReplyText` still holds the round being closed (reset happens AFTER, at 2706). So the
non-empty check is available right here.

### Final render — reads the LAST round only
`chat.js:2861`: `const finalDisplay = stripToolBlocks(roundReplyText);` → only the surviving (last)
round's reply is shown (`:2862-2891`); empty closing round ⇒ bubble hidden (`:2896-2910`). Every
earlier round was already `display:none` by sites 1/2 and is **not** re-shown.

### Reload path — same last-round-only rule
`chatRenderer.js:1935-1947`:
```js
var isLastTextRound = true;
for (let rr = r + 1; rr < maxRound; rr++) {
  if ((roundTexts[rr] || '').trim()) { isLastTextRound = false; break; }
}
const _gbSkipIntermediateText = isGameBuild() && !isLastTextRound;   // 1945
if (txt && !_gbSkipIntermediateText) { ...render bubble... }          // 1947
```
`metadata.round_texts[]` **does** carry every round's text (server persists per-round — `:1914`,
`:1931`), so the data to render all narration rounds is present; the reload heuristic discards it. A
history reload therefore reproduces the disappearance instead of rescuing it.

---

## Why casting is the worst case (and what the correct behavior is)

| Round (evidence) | chars | native calls | Classification today | Correct |
|---|---|---|---|---|
| 1 | 830 / 221 / 364 / 449 | 0 | intermediate → **hidden** | narration → **show** |
| 2 | 364 / 733 | 0 | intermediate → **hidden** | narration → **show** |
| 3 | **0** | **1 (updateCasting)** | intermediate → hidden | empty tool-only → **hidden (correct)** |
| 4 | 257 | 0 | intermediate → **hidden** | narration → **show** |
| 5 | 345 | 0 | intermediate → **hidden** | narration → **show** |
| 6 / next-turn 1,2 | 449 / 733 | 0 | last survives / re-loop | narration → **show** |

- **Each narration round is a real, player-facing interviewer line** (the casting interviewer's
  dialogue) — it is *output*, not planning. Multiple narration rounds in one turn must **persist and
  accumulate**, not be replaced by the last.
- **The legitimate hide is the EMPTY tool-only round** (round 3: "0 chars, 1 native call" → `dt` is
  empty → nothing to show). That must stay hidden. The discriminator is therefore **`dt.trim()` /
  `txt.trim()` non-empty**, NOT "is this the final round."
- **Casting is the worst case** because (a) the interview is intrinsically a multi-line back-and-forth
  (the model narrates *every* round) and (b) the **finalize loop never terminates** (audit A — the
  `casting finalize nudge` L0…L4 keep re-prompting because the model won't call the finalize tool), so
  the turn accrues many narration rounds, all-but-the-last hidden. **Audit A's fix shrinks the blast
  radius (fewer manufactured rounds) but does not fix the hide** — a single "narrate then `updateCasting`"
  exchange still disappears.

---

## The fix (minimal, content-driven, both paths)

**Principle:** hide a round's bubble **iff it produced no visible narration** (`stripToolBlocks` is
empty). Hide stays for pure tool/empty rounds; any round that painted real narration **persists**. This
is phase-agnostic (no need to detect "casting") and also fixes the general game-turn case (audit D1/D2).
Reasoning is untouched — `roundReplyText` is already reply-only by the `json.thinking` split.

### Change 1 — `chat.js:2169-2170` (tool_start finalize)
Replace the unconditional game-build hide with the empty-only hide. Collapse it into the existing
non-game branch so both builds share one rule:
```js
// was:
if (isGameBuild()) {
  roundHolder.style.display = 'none';
} else if (dt.trim()) {
  ...render...
} else {
  roundHolder.style.display = 'none';
}

// becomes (game + non-game identical: render when this round produced visible narration,
// hide only a truly-empty tool-only round). L6c: a narration round that is FOLLOWED by a
// tool is still the player's dialogue, not planning — keep it.
if (dt.trim()) {
  var _body3 = roundHolder.querySelector('.body');
  var _contentEl3 = _ensureStreamLayout(_body3);
  _contentEl3.style.minHeight = '';
  _contentEl3.innerHTML = markdownModule.processWithThinking(markdownModule.squashOutsideCode(dt));
  if (window.hljs) roundHolder.querySelectorAll('pre code').forEach((b) => window.hljs.highlightElement(b));
} else {
  roundHolder.style.display = 'none';   // empty tool-only round — correctly hidden
}
```
Note `dt` (`= stripToolBlocks(roundReplyText)`, line 2162) is already reply-only and already game-build
scrubbed by `processWithThinking` (the L6b reasoning-preamble scrub runs inside it — see
`markdown.js scrubReasoningPreamble`), so no leak risk.

### Change 2 — `chat.js:2672-2673` (agent_step)
Guard the hide on emptiness instead of hiding unconditionally. `roundReplyText` here still holds the
round being closed (reset is later, at 2706):
```js
// was:
if (isGameBuild() && roundHolder) {
  roundHolder.style.display = 'none';
}

// becomes: only hide a round that rendered NO visible narration; a narration round persists.
if (roundHolder && !stripToolBlocks(roundReplyText).trim()) {
  roundHolder.style.display = 'none';
}
```
(If `roundFinalized` already ran for this round at a preceding `tool_start`, the bubble was already
rendered/hidden by Change 1 and is non-empty ⇒ this guard leaves it shown — consistent. The
`&& roundHolder` retains the original null-guard; dropping the `isGameBuild()` gate makes non-game
behavior strictly the same as before, since non-game already rendered the bubble at `tool_start` and an
empty round was already hidden.)

### Change 3 — `chatRenderer.js:1945-1947` (reload parity)
Drop the "last round only" gate; render every round that has text, skip empty rounds (already handled by
the `if (txt && ...)` guard — `txt` is already `.trim()`'d at 1931). The empty tool-only rounds carry no
`txt` and are skipped; their tools still render as beats below.
```js
// was:
const _gbSkipIntermediateText = isGameBuild() && !isLastTextRound;
if (txt && !_gbSkipIntermediateText) { ...render bubble... }

// becomes: render EVERY non-empty text round (a multi-line interview/scene accumulates);
// `isLastTextRound` is retained ONLY for source/findings placement below.
const _gbSkipIntermediateText = false;   // L6c: narration rounds all persist; empty rounds have no txt
if (txt && !_gbSkipIntermediateText) { ...render bubble... }
```
Keep `isLastTextRound` (it still gates `web_sources`/`research`/`rag` placement at 1970-1981 and
`_renderedTxt`/thread connectors at 1997-2011 — leave those as-is). The minimal change is setting
`_gbSkipIntermediateText` to a constant `false`; or delete the variable and inline `txt` at 1947/1997.
Prefer the explicit constant + comment so the source-pin test has a stable string to assert.

### Guard that keeps empty tool-only rounds hidden
The discriminator in all three changes is **`stripToolBlocks(...).trim()` non-empty** (live) /
**`txt` non-empty** (reload). Round 3 ("0 chars, 1 native call") ⇒ empty ⇒ hidden, unchanged. The
`comp-round`/silent-beat chip suppression (`orwellBeatIsSilent`, ADR 0011) is independent and untouched.

### Reasoning split preserved
No change reads `roundReasoningText` or `accumulated`; the body still renders only
`stripToolBlocks(roundReplyText)` (live) / `roundTexts[r]` reply text (reload), both reply-only and run
through `processWithThinking` (which carries the game-build reasoning-preamble scrub). The Thinking
accordion path is untouched.

---

## Test specs (source-pin gates + Node behavioral)

Add to **`frontend/tests/test_l6b_l7_l9_l20_chat_render.py`** (the existing L6b file — same helpers
`_read` / `_run_node`). These FAIL if the fix is reverted. Closest templates to copy:
`test_l6b_l7_l9_l20_chat_render.py::test_live_path_suppresses_intermediate_agent_rounds_in_game_build`
(invert it) and `test_fs4d_truncation.py` / `test_adr0008_reconcile_contract.py` (source-pin style).

### Spec 1 (source-pin, live `tool_start`) — a narration round followed by a tool is NOT hidden
```python
def test_l6c_narration_round_with_following_tool_is_kept_live():
    """L6c: in BOTH builds, a round that produced visible narration (dt non-empty) renders
    even when a tool follows it; only an EMPTY tool-only round is hidden. The old unconditional
    `if (isGameBuild()) roundHolder.style.display='none'` at the tool_start finalize is gone."""
    chat = _read("static", "js", "chat.js")
    fin = chat[chat.index("Finalize current text bubble (only once per round)"):]
    fin = fin[:fin.index("Track tool name for contextual spinner labels")]
    # the unconditional game-build hide is REMOVED — no bare isGameBuild()-gated display:none here
    assert "if (isGameBuild()) {\n" not in fin  # (adjust to exact whitespace of the removed line)
    # a round with visible narration renders the reply…
    assert "if (dt.trim())" in fin
    assert "markdownModule.processWithThinking(markdownModule.squashOutsideCode(dt))" in fin
    # …and ONLY an empty round is hidden
    assert "roundHolder.style.display = 'none';" in fin   # the empty-only else branch survives
    assert "else {" in fin
```

### Spec 2 (source-pin, live `agent_step`) — new round hides the previous one ONLY if it was empty
```python
def test_l6c_agent_step_hides_previous_round_only_when_empty():
    """L6c: starting a new agent round hides the previous bubble ONLY when it rendered no
    narration (stripToolBlocks empty); a narration round persists. The old unconditional
    `isGameBuild() && roundHolder -> display:none` is gone."""
    chat = _read("static", "js", "chat.js")
    step = chat[chat.index("} else if (json.type === 'agent_step') {"):]
    step = step[:step.index("New round: create fresh AI bubble")]
    # the hide is now guarded on emptiness, not on isGameBuild() alone
    assert "!stripToolBlocks(roundReplyText).trim()" in step
    assert "roundHolder.style.display = 'none';" in step
    # the old unconditional game-build hide string is gone
    assert "if (isGameBuild() && roundHolder) {" not in step
```

### Spec 3 (source-pin, reload parity) — every non-empty round renders on reload
```python
def test_l6c_reload_renders_every_narration_round_not_just_last():
    """L6c reload parity: chatRenderer no longer skips intermediate text rounds in the game
    build; every round with text renders (empty tool-only rounds have no txt and are skipped).
    isLastTextRound is retained only for source/findings placement."""
    renderer = _read("static", "js", "chatRenderer.js")
    # the intermediate-skip is disabled (no longer gated on !isLastTextRound)
    assert "_gbSkipIntermediateText = isGameBuild() && !isLastTextRound" not in renderer
    assert "const _gbSkipIntermediateText = false" in renderer
    # every non-empty round still gates on txt (empty rounds skipped)
    assert "if (txt && !_gbSkipIntermediateText)" in renderer
    # isLastTextRound is still used for source placement (not deleted)
    assert "isLastTextRound" in renderer
```

### Spec 4 (Node behavioral, optional but feasible) — drive `stripToolBlocks` to prove the discriminator
Mirrors `test_js_strip_tool_blocks_keeps_trailing_question` (same `_run_node` harness). Proves the
empty-vs-narration discriminator the fix relies on: a narration round is non-empty (→ kept), a pure
tool-call round strips to empty (→ hidden).
```python
@pytest.mark.skipif(_NODE is None, reason="node not available")
def test_l6c_strip_tool_blocks_discriminates_narration_from_tool_only():
    renderer_path = os.path.join(FRONTEND, "static", "js", "chatRenderer.js")
    program = r"""
    const fs = require('fs');
    const src = fs.readFileSync(process.argv[1], 'utf8');
    const reNames = ['TOOL_CALL_RE','EXEC_FENCE_RE','XML_TOOL_CALL_RE','XML_INVOKE_RE',
                     'DSML_TOOL_RE','DSML_STRAY_RE','TOOL_NARRATION_RE'];
    let prelude = '';
    for (const n of reNames) { const m = src.match(new RegExp('const ' + n + ' = [^\\n]+')); if (m) prelude += m[0] + '\n'; }
    const fn = src.slice(src.indexOf('export function stripToolBlocks'));
    const body = fn.slice(0, fn.indexOf('\n}\n') + 2).replace('export function', 'function');
    // narration round → non-empty (KEPT); pure tool-call round → empty (HIDDEN, round 3 case)
    const narration = '*The camera light blinks on.* "Photo\\'s in. Good — you exist now."';
    const toolOnly  = '<tool_call>{"name":"updateCasting","arguments":{}}</tool_call>';
    const run = new Function(prelude + body + '\n' +
      "const a = stripToolBlocks(narration).trim().length > 0;" +
      "const b = stripToolBlocks(toolOnly).trim().length === 0;" +
      "return a && b;");
    console.log(run() ? 'OK' : 'FAIL');
    """  # NOTE: define narration/toolOnly inside the Function or pass as args; sketch only.
    res = _run_node(program, renderer_path)
    assert "OK" in res.stdout, f"stdout={res.stdout!r} stderr={res.stderr!r}"
```
(Spec 4 is illustrative — wire `narration`/`toolOnly` as `new Function` args exactly like the template's
`cases` param. If the inline-string escaping is fiddly, Specs 1–3 are sufficient as the revert gate.)

### Also UPDATE the existing inverted tests (they encode the OLD behavior and will now fail)
`test_live_path_suppresses_intermediate_agent_rounds_in_game_build` (lines 60-73) and
`test_reload_path_renders_only_final_narration_round_in_game_build` (lines 76-83) assert the **old**
"suppress intermediate rounds" strings — they must be **rewritten** to the L6c behavior (Specs 1-3) or
they will (correctly) fail after the fix. Note this in the PR so the reviewer expects the churn.

---

## Run

`cd frontend && python3 -m pytest tests/test_l6b_l7_l9_l20_chat_render.py` then the **full** suite
(`python3 -m pytest tests/`) — several gates are source-pinned convention checks outside obvious
keywords (CLAUDE.md: a `-k` subset can pass green while a sibling gate fails).

## Relationship to audit A (finalize loop)
Audit A (the never-terminating `casting finalize nudge`) is the **volume** problem — it manufactures
many narration rounds per turn, maximizing how many get hidden. Fixing A reduces the count; **this fix
(L6c) makes any surviving narration round persist regardless.** Ship both: A stops the runaway loop,
L6c stops the disappearance. L6c alone already restores the player's lines even while A is open.

> READ-ONLY observation. No remediation applied.
