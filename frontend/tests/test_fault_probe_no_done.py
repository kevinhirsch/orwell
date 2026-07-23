"""R6 residual (#1453) — an incomplete stream (a drop with NO `[DONE]` sentinel) is an HONEST FAILURE,
never a fabricated Game-Master turn.

THE FAILURE MODE. The streaming reader loop in `frontend/static/js/chat.js` consumes SSE `data:` lines
and considers the turn genuinely complete ONLY when it observes the terminal `[DONE]` sentinel. If the
upstream connection silently drops mid-stream — no error frame, no `[DONE]` — a naive client would just
stop reading and leave the half-typed (or entirely empty) reply sitting in the Big-Brother bubble as if
the narrator had finished speaking. That is a two-fold lie: the player is shown text the GM never
finished (or a blank turn presented as an answer), AND the turn looks done when it was cut off. This is a
DISTINCT mode from the explicit `finish_reason == "length"` truncation that `test_fs4d_truncation.py`
already guards — there the server SIGNALS the cutoff with a `{"type":"truncated"}` event; HERE there is
no signal at all, so detection has to come from the ABSENCE of the sentinel.

THE SHIPPED BEHAVIOUR (already on `main`; this file only adds the missing regression gate):
  1. `_streamSawDone` — a latch that starts false and flips true ONLY inside the `[DONE]` sentinel branch,
     so a stream that ends without the sentinel leaves it false.
  2. after the reader loop drains, `if (!_streamSawDone) throw new Error('Stream closed before completion')`
     turns a missing sentinel into a THROWN fault — it can never fall through as a completed turn.
  3. the catch classifies that fault recoverable ('closed'/'stream' match) and routes it to
     `_tryAutoRecover` → `_renderStreamDropRetry` — a user-controlled **Retry** control — and only writes a
     raw `Error:` into the assistant bubble if auto-recover DECLINED. The no-token drop path renders the
     Retry, not a GM-voiced body bubble.
  4. the F-S4-C reclassification frames any stream/connection failure as a quiet `.msg-system` notice and
     rebuilds the holder with ONLY a `.body` (dropping the GM `.role`/avatar) — so an incomplete stream
     never renders as if the Game Master said something.

`test_fs4d_truncation.py` pins the EXPLICIT-`truncated` mode only; the no-`[DONE]` (silent-drop) path was
unguarded. This is that gate.

WHY SOURCE-PINNED. Exactly like the chat.js/llm_core legs of `test_fs4d_truncation.py`: the streaming
client hot path isn't hermetically unit-drivable end-to-end here (no DOM, no reader, no live server), and
a mid-stream drop is flaky to inject in-browser — the deterministic source anchor is the durable gate.
Anchors are matched as stable substrings (whitespace-normalised where they span lines), NOT by line
number, so they tolerate surrounding indentation / line moves.
"""
import os
import re

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*parts):
    with open(os.path.join(FRONTEND, *parts), encoding="utf-8") as f:
        return f.read()


def _norm(s: str) -> str:
    """Collapse runs of whitespace to a single space so multi-line anchors tolerate wrap / indent drift."""
    return re.sub(r"\s+", " ", s)


CHAT_JS = _read("static", "js", "chat.js")
CHAT_JS_NORM = _norm(CHAT_JS)


# ── 1. the `_streamSawDone` latch starts false and flips true ONLY at the `[DONE]` sentinel ──────────

def test_stream_saw_done_latch_is_false_until_the_done_sentinel():
    assert "let _streamSawDone = false;" in CHAT_JS, (
        "the completion latch must INITIALISE false — a stream that never signals completion stays "
        "'not done' by default (#1453)."
    )
    # Exactly ONE place flips it true, and it is the `[DONE]` sentinel branch. A second assignment
    # anywhere else would let a non-terminal frame masquerade as completion.
    assert CHAT_JS.count("_streamSawDone = true") == 1, (
        "the latch must be set true in EXACTLY ONE place (the [DONE] sentinel) — otherwise a stream that "
        "ends without [DONE] could still read as 'done'."
    )
    assert "if (data === '[DONE]')" in CHAT_JS, "the sentinel branch must key off the literal [DONE] line."
    # The single set-true lives INSIDE the `[DONE]` branch, so a stream that ends with no [DONE] leaves it
    # false (⇒ the fault throw below fires).
    sentinel_block = CHAT_JS.split("if (data === '[DONE]')", 1)[1][:200]
    assert "_streamSawDone = true" in sentinel_block, (
        "the latch must flip true INSIDE the [DONE] sentinel branch; a stream that ends without [DONE] "
        "then leaves it false."
    )


# ── 2. a missing sentinel is a THROWN fault, not a silent success ─────────────────────────────────────

def test_missing_done_sentinel_throws_stream_closed_before_completion():
    # After the reader loop drains, an unset latch throws — the no-sentinel end is treated as a FAULT,
    # never a quietly-finished turn.
    assert (
        "if (!_streamSawDone) { throw new Error('Stream closed before completion'); }" in CHAT_JS_NORM
    ), (
        "a stream that ended with no [DONE] sentinel must THROW 'Stream closed before completion' after "
        "the reader loop drains — it must NOT fall through as a completed turn (#1453)."
    )


# ── 3. the fault routes to a user Retry control, NOT a GM-voiced body bubble ──────────────────────────

def test_incomplete_stream_fault_routes_to_stream_drop_retry_not_a_gm_bubble():
    # The thrown 'Stream closed before completion' classifies RECOVERABLE (its message contains both
    # 'stream' and 'closed', which are alternatives in the recoverable-error regex)...
    recov = CHAT_JS.split("function _isRecoverableStreamErr", 1)[1][:600]
    assert "closed" in recov and "stream" in recov, (
        "the recoverable-stream-error test must match on 'closed'/'stream' so 'Stream closed before "
        "completion' classifies as recoverable and reaches the auto-recover arm."
    )
    # ...and the catch routes it through _tryAutoRecover; the raw `Error:` bubble write is GATED behind
    # auto-recover DECLINING (`!(recoverable && _tryAutoRecover(...))`), so a handled drop never types an
    # error into the assistant bubble.
    assert (
        "!(_isRecoverableStreamErr(err) && _tryAutoRecover(holder, accumulated, streamSessionId))"
        in CHAT_JS_NORM
    ), (
        "a recoverable stream fault must be handed to _tryAutoRecover BEFORE any error bubble is written; "
        "the error bubble is only reached when auto-recover declines."
    )
    # When nothing was produced (the pure no-[DONE] drop), _tryAutoRecover surfaces a user-controlled
    # Retry via _renderStreamDropRetry — an honest control, not a silent auto-resend and not a GM bubble.
    recover_fn = CHAT_JS.split("function _tryAutoRecover", 1)[1][:2000]
    assert "_renderStreamDropRetry(holder, sessionId)" in recover_fn, (
        "a drop that produced no tokens must surface a user-controlled Retry (_renderStreamDropRetry), not "
        "a silent resend."
    )
    # The Retry control is a distinct `.stream-drop-retry` note carrying a Retry button appended to the
    # message body — a user affordance, NOT a fresh GM (`.msg-ai` + `.role`) narration bubble.
    render_fn = CHAT_JS.split("function _renderStreamDropRetry", 1)[1][:2000]
    assert "note.className = 'stream-drop-retry';" in render_fn, (
        "the drop notice must be a distinct `.stream-drop-retry` node (so it is not a GM narration bubble "
        "and can be de-duped/removed)."
    )
    assert "btn.textContent = 'Retry';" in render_fn and "target.appendChild(note);" in render_fn, (
        "the drop notice must offer a Retry button appended to the message body — a user retry control, "
        "never GM-voiced narration."
    )
    # #1729 D2: self-resume honesty — a no-token drop must not silently auto-resend;
    # accumulated-gated self-resume is the honest path that falls through to _renderStreamDropRetry.
    assert "if (accumulated && chatState._ownRunIds[sessionId])" in recover_fn or "if (accumulated" in recover_fn, (
        "self-resume must be gated on accumulated (truthy partial text); "
        "a no-token drop falls through to _renderStreamDropRetry"
    )


# ── 4. the stream-error notice is a SYSTEM notice with NO GM `.role`/avatar attribution ───────────────

def test_stream_error_notice_is_system_channel_with_no_gm_attribution():
    # F-S4-C: a stream/connection failure is a SYSTEM notice, not the GM's voice. The bubble is
    # reclassified from `msg-ai` (Big Brother) to the quiet `.msg-system` channel...
    assert "holder.className = 'msg msg-system';" in CHAT_JS, (
        "a stream/connection error must be reclassified to the `.msg-system` channel, never left as the "
        "GM's `msg-ai` bubble (#1453 / F-S4-C)."
    )
    # ...and the holder is rebuilt with ONLY a `.body` — dropping the GM `.role` label / avatar so nothing
    # attributes the failure to a houseguest. An incomplete stream never renders as if the GM spoke.
    assert 'holder.innerHTML = \'<div class="body"></div>\';' in CHAT_JS, (
        "the reclassified system notice must rebuild the holder with only a `.body` (no GM `.role`/avatar), "
        "so the failure is never attributed to the Game Master."
    )
    # The design intent is stated at the reclassification site — pin the stable, distinctive framing.
    assert "SYSTEM notice, NOT the GM" in CHAT_JS, (
        "the reclassification must document that a stream error is a SYSTEM notice, not the GM's voice."
    )
    assert "drop the `.role` label" in CHAT_JS, (
        "the reclassification must drop the GM `.role` label so nothing attributes the failure to a "
        "houseguest."
    )
