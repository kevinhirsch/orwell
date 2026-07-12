"""ADR 0010 token-economy follow-on #4 — `Continue ▸` in CHAT mode.

When a narration/chat reply hits its output `max_tokens` budget the model stops mid-sentence with
finish_reason ``"length"`` (a token-cap cutoff, not a natural stop). The agent-loop path already
surfaces a Continue affordance (F-S4-D); the GAP #4 closed is the **chat-mode** path, which bypasses
the agent loop and so must inspect the terminal finish_reason itself and surface the SAME affordance.

This is the #4-specific gate (a named companion to test_fs4d_truncation.py) pinning the end-to-end
chat-mode contract across the three surfaces it rides on:

  chat_routes.py (chat-mode branch) — read the stream's `finish` event → emit `{"type":"truncated"}`
                                      at [DONE] iff the reply was cut off by the output cap ("length").
  chat.js        (`truncated` handler) — render a quiet "cut off … Continue ▸" note in the history
                                      container (NOT the GM body bubble, which is re-rendered at
                                      finalize), and on click resume via the shared same-message
                                      merge seam (public body only — reasoning is never spliced in).
  style.css      (.response-truncated) — the note shares the round-cap pill so the token-cap cutoff
                                      reads as a cohesive pill, not the bare stopped row with the
                                      giant glyph-sized base `.continue-btn`.

All assertions are source-pins (the streaming hot path isn't hermetically unit-drivable end to end
here); the driven behaviour of the sibling agent-loop leg lives in test_fs4d_truncation.py.
"""
import os
import re

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*parts):
    with open(os.path.join(FRONTEND, *parts), encoding="utf-8") as f:
        return f.read()


CHAT = _read("static", "js", "chat.js")
ROUTES = _read("routes", "chat_routes.py")
CSS = _read("static", "style.css")


def _truncated_block() -> str:
    # The `truncated` handler is a distinct else-if arm; bound it precisely between its own marker and
    # the NEXT arm (`model_actual`) — no fixed char cap (a cap can slice through a token we assert on).
    assert "json.type === 'truncated'" in CHAT, "chat.js must handle the chat-mode `truncated` event"
    after = CHAT.split("json.type === 'truncated'", 1)[1]
    return after.split("json.type === 'model_actual'", 1)[0]


# ── 1. chat mode (no agent loop) DETECTS the length cutoff and emits `truncated` ──────────────── #

def test_chat_mode_backend_emits_truncated_on_a_length_finish():
    # The chat-mode branch streams via stream_llm_with_fallback directly (no agent loop). It must read
    # the terminal finish_reason off the stream's `finish` event and, when it was an output-cap cutoff,
    # emit the `truncated` UI signal — the same one the agent-loop path emits. This is the #4 leg
    # (distinct from F-S4-D's agent-loop leg): chat mode surfaces the affordance itself.
    assert 'data.get("type") == "finish"' in ROUTES, \
        "chat mode must read the stream's `finish` event to learn the terminal reason"
    assert "_chat_finish_reason" in ROUTES, "chat mode must track the terminal finish_reason"
    assert re.search(r'_chat_finish_reason\s*==\s*"length"', ROUTES), \
        "the truncated signal must gate on a `length` (output-cap) finish, not a natural stop"
    assert '"type": "truncated"' in ROUTES, \
        "chat mode must emit a `truncated` event on a length-finish so the Continue affordance shows"


# ── 2. chat.js renders a Continue affordance for the truncated reply ───────────────────────────── #

def test_chatjs_renders_a_continue_affordance_for_a_truncated_reply():
    block = _truncated_block()
    # A distinct class so repeated cutoffs de-dupe to one live note.
    assert "response-truncated" in block, "the note needs its own class so it can be de-duped/styled"
    assert "cut off" in block.lower(), "the label must tell the player the reply was cut off"
    assert "continue-btn" in block and "Continue ▸" in block, "it must offer a Continue ▸ button"


def test_the_note_lives_in_the_history_container_not_the_re_rendered_body():
    # The GM message body innerHTML is re-rendered at stream finalize, which would wipe an in-body note.
    block = _truncated_block()
    assert "getElementById('chat-history')" in block, \
        "the note must append to the history container, never the GM body bubble (re-rendered at finalize)"


# ── 3. clicking Continue resumes the SAME message (public body only — no reasoning splice) ─────── #

def test_continue_click_resumes_into_the_same_message_via_the_shared_merge_seam():
    block = _truncated_block()
    # Reuse the shared stop/continue merge seam: mark the stopped holder so the next reply merges into
    # it, and suppress a fresh user bubble (this is a continuation, not a new turn).
    assert "_pendingContinue" in block, \
        "the click must set _pendingContinue to the truncated holder so the resume merges into it"
    assert "_hideUserBubble = true" in block, \
        "a continuation must not spawn a fresh user bubble — it resumes the same assistant message"
    assert "handleChatSubmit(" in block, "the click resumes through the existing send path"
    # The continuation prompt tells the model to pick up from the cutoff and NOT repeat itself.
    assert re.search(r"do NOT repeat", block, re.I), \
        "the continuation prompt must instruct the model not to repeat what it already wrote"


def test_truncated_seam_never_splices_reasoning_into_the_public_body():
    # The reasoning channel (roundReasoningText) feeds the Thinking accordion only. The truncated note
    # is a plain history-container render + a _pendingContinue mark; it must not touch the reasoning
    # buffer (the public/reasoning split stays by construction).
    block = _truncated_block()
    assert "roundReasoningText" not in block, \
        "the truncated affordance must not read/merge the reasoning buffer — public body only"
    # The actual resume-merge (consumed later) rebuilds the merged bubble from dataset.raw through the
    # reasoning-aware renderer, so <think> reasoning is split out of the body — never concatenated in.
    merge = CHAT.split("Merge with previous stopped message", 1)
    assert len(merge) == 2, "chat.js must carry the shared _pendingContinue merge seam"
    merge_block = merge[1][:900]
    assert "dataset.raw" in merge_block and "processWithThinking" in merge_block, \
        "the resume must merge via dataset.raw through processWithThinking (keeps reasoning out of body)"


# ── 4. the affordance is styled as a cohesive pill (not the giant base .continue-btn) ──────────── #

def test_response_truncated_is_styled_as_a_pill_not_the_giant_base_button():
    # The bare base `.continue-btn` is a 2.6em glyph-sized affordance (for the "▸" stop-continue). The
    # truncated note carries text ("Continue ▸"), so it must get the round-cap pill treatment — a
    # scoped `.response-truncated .continue-btn` override — or it renders as an oversized red button.
    assert re.search(r"\.response-truncated\b", CSS), \
        "style.css must style the .response-truncated note"
    assert re.search(r"\.response-truncated\s+\.continue-btn", CSS), \
        "the .continue-btn inside the truncated note must be re-sized off the 2.6em glyph base"
    # It shares the round-cap pill so a token-cap cutoff reads identically to a round-cap one.
    pill = re.search(r"\.rounds-exhausted[^{]*\.response-truncated[^{]*\{|"
                     r"\.response-truncated[^{]*\.rounds-exhausted[^{]*\{|"
                     r"\.rounds-exhausted,\s*\n?\s*\.response-truncated\s*\{", CSS)
    assert pill, "the truncated note should share the .rounds-exhausted pill rule (cohesive, DRY)"
