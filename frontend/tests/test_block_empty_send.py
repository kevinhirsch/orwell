"""Block an empty message at the input affordance. SOURCE-PINS.

Owner bug: "the user should not be able to send an empty message." An empty (or whitespace-only)
composer with no attachments must not submit — and not merely by a silent early-return once it
reaches the server. Post-#1352 an empty player turn is read server-side as a "lull" readiness cue
that can ADVANCE the game, so a stray empty send is worse than a no-op. The block must live at the
affordance: neither the send-button click nor Enter may fire `handleSubmit` on an empty,
attachment-less composer.

These pins guard the two send affordances in `static/app.js` (the `.send-btn` click handler and the
composer Enter/keydown handler) plus the existing defense-in-depth server guard in
`static/js/chat.js`, so a future edit can't silently regress the block. No network/engine; roles
only (no player names).

Do NOT break: an attachments-only send (a photo with no text IS allowed), and a live stream's Stop
affordance (dataset.mode === 'streaming'), which must still fire on an empty composer.

Run: cd frontend && .venv/bin/python -m pytest tests/test_block_empty_send.py
"""
import os

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*parts):
    with open(os.path.join(FRONTEND, *parts), encoding="utf-8") as f:
        return f.read()


APP_JS = _read("static", "app.js")
CHAT_JS = _read("static", "js", "chat.js")


def _click_handler():
    """The send-btn click handler body (up to the Enter/keydown wiring)."""
    h = APP_JS[APP_JS.index("sendBtn.addEventListener('click'"):]
    return h[: h.index("Enter to send")]


def _enter_handler():
    """The composer Enter/keydown handler body."""
    h = APP_JS[APP_JS.index("Enter to send (shift+enter"):]
    # up to the input-change icon toggle wiring that follows the keydown block
    return h[: h.index("Toggle mic/send icon")]


# ── 1. the send-button CLICK cannot fire an empty submit ───────────────────────

def test_click_blocks_empty_attachmentless_submit_before_handleSubmit():
    h = _click_handler()
    guard = "if (!hasText && !hasFiles && sendBtn.dataset.mode !== 'streaming') return;"
    assert guard in h, \
        "the send-btn click handler must block an empty, attachment-less submit at the affordance"
    # The guard must precede the actual send so an empty composer never reaches handleSubmit.
    assert h.index(guard) < h.index("handleSubmit(e)"), \
        "the empty-block guard must run BEFORE handleSubmit in the click handler"


# ── 2. the Enter/keydown affordance cannot fire an empty submit ────────────────

def test_enter_blocks_empty_attachmentless_submit_before_handleSubmit():
    h = _enter_handler()
    assert "_hasAttachments()" in h and "messageInput.value.trim().length > 0" in h, \
        "the Enter handler must compute the live text/attachment state to gate the submit"
    guard = "if (!_hasText && !_hasFiles && sendBtn && sendBtn.dataset.mode !== 'streaming') return;"
    assert guard in h, \
        "Enter on an empty, attachment-less composer must not submit"
    assert h.index(guard) < h.index("handleSubmit(e)"), \
        "the empty-block guard must run BEFORE handleSubmit in the Enter handler"


# ── 3. attachments-only sends still work (a photo with no text is allowed) ──────

def test_attachments_only_send_is_not_blocked():
    # The guard requires BOTH no text AND no files (`!hasText && !hasFiles`), so any pending
    # attachment falls through to the real send — mirroring the chat.js line-713 server guard.
    for h in (_click_handler(), _enter_handler()):
        # every empty-block guard in the affordance is the conjunction, never a text-only check
        assert "!hasFiles" in h or "!_hasFiles" in h, \
            "the empty-block must also clear the attachment count so a photo-only send still fires"


# ── 4. the streaming Stop affordance is preserved on an empty composer ──────────

def test_streaming_stop_is_not_blocked_by_the_empty_guard():
    # A live foreground stream shows Stop (dataset.mode === 'streaming'); clicking / Enter on an
    # empty composer must still Stop it, so the empty-block explicitly excludes that mode.
    for h in (_click_handler(), _enter_handler()):
        assert "dataset.mode !== 'streaming'" in h, \
            "the empty-block must exclude the streaming Stop affordance"


# ── 5. defense-in-depth: the server-side guard in chat.js still stands ──────────

def test_chat_js_server_guard_still_present():
    # The line-713 guard remains as defense-in-depth: even if an empty submit ever reached
    # handleChatSubmit, it early-returns before any chat POST / advance.
    assert "if (!msg.trim() && !fileHandlerModule.getPendingCount()" in CHAT_JS, \
        "the chat.js server-side empty-message guard must remain as defense-in-depth"
