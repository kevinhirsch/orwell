"""BUG 1 (never eat a message): the FIRST send of a page-load must ALWAYS render a user bubble.

The owner's bug: on a fresh page-load the first message ("Hello?") vanished from the composer with
NO bubble and never reached the backend; the SECOND message worked. Root cause: in
`frontend/static/js/chat.js` the optimistic user bubble was rendered LATE — AFTER the first-send
branches that materialize a session / auto-create one via `/api/default-chat`. Those branches could
clear the composer (`el('message').value = ''`) and early-return with no bubble, so the text was
eaten before it was ever shown or sent.

Fix: paint the optimistic bubble SYNCHRONOUSLY up front (before any session/model materialization),
in a PENDING state; on a hard early-return mark it UNSENT and RESTORE the composer text — never wipe
it into nothing. The later render block adopts the early bubble instead of painting a second one.

chat.js DOM behaviour isn't unit-drivable in the Python gate (no jsdom harness here), so — like the
other chat.js convention gates (g15, the reasoning-scrub, the render contract) — this pins the
STRUCTURAL invariants in source: the bubble renders before the early-return branches, and those
branches no longer clear the composer without keeping the message. browser_smoke covers the live DOM.
"""
import os

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHAT_JS = open(os.path.join(FRONTEND, "static", "js", "chat.js"), encoding="utf-8").read()


def _send_fn_src() -> str:
    """The body of `handleChatSubmit` only (the send path)."""
    start = CHAT_JS.index("export async function handleChatSubmit(")
    # The next top-level export after it bounds the function for our search.
    end = CHAT_JS.index("\n  export ", start + 1)
    return CHAT_JS[start:end]


SRC = _send_fn_src()


def test_optimistic_bubble_renders_before_session_materialization():
    # The early optimistic-bubble render (the BUG-1 fix) must come BEFORE the first-send branches that
    # await session/model materialization — otherwise a clear+return on that path eats the message.
    bubble_idx = SRC.index("BUG 1 (never eat a message)")
    materialize_idx = SRC.index("Materialize pending session")
    autocreate_idx = SRC.index("fetch('/api/default-chat')")  # the actual auto-create fetch
    assert bubble_idx < materialize_idx < autocreate_idx, (
        "the optimistic user bubble must be painted BEFORE the session-materialize / "
        "default-chat auto-create branches (which can early-return on the first send)."
    )
    # And it actually paints a user bubble there.
    early = SRC[bubble_idx:materialize_idx]
    assert "addMessage('user'" in early, "the early block must render the user bubble"
    assert "_wantOptimisticBubble" in early


def test_no_model_and_error_branches_do_not_clear_the_composer():
    # The two first-send hard-fail branches (no model configured / default-chat fetch error) must NOT
    # clear the composer into nothing. They route through `_abortSendKeepMessage`, which keeps the
    # bubble + restores the text — never `el('message').value = ''` + bare return.
    # Locate the no-session block.
    block_start = SRC.index("if (!sessionModule.getCurrentSessionId()) {")
    # bound: the API-key guard is the next major step after the no-session block.
    block_end = SRC.index("API key guard", block_start)
    block = SRC[block_start:block_end]
    assert "el('message').value = ''" not in block, (
        "the first-send no-model/error branches must NOT wipe the composer (that eats the message); "
        "they must route through `_abortSendKeepMessage`."
    )
    # Both the no-model and the catch branch use the keep-message abort.
    assert block.count("_abortSendKeepMessage(") >= 2, (
        "both the no-model guard and the fetch-error catch must abort via `_abortSendKeepMessage`."
    )


def test_abort_keep_message_preserves_bubble_and_restores_text():
    # The abort helper must (a) settle the bubble to an UNSENT state and (b) restore the composer text.
    h_idx = SRC.index("_abortSendKeepMessage = (")
    helper = SRC[h_idx:h_idx + 900]
    assert "msg-unsent" in helper, "the aborted bubble must be marked unsent (kept on screen)"
    assert "_mi.value = msg" in helper, "the helper must restore the composer text — never eat it"
    assert "_releaseSendFlag()" in helper, "the helper must release the send flag so the next send works"


def test_materialize_failure_paths_keep_the_message():
    # Both materialize-failure early returns (pending-session + auto-created-session) must abort via the
    # keep-message helper, NOT a bare `_releaseSendFlag(); return;` that leaves no bubble.
    # The pending-session materialize:
    mat_idx = SRC.index("Materialize pending session")
    mat_block = SRC[mat_idx:mat_idx + 400]
    assert "_abortSendKeepMessage(); return;" in mat_block, (
        "a failed pending-session materialize must keep the message (abort helper), not bare-return."
    )


def test_later_render_block_adopts_the_early_bubble_not_a_duplicate():
    # The later (post-attachment) render block must ADOPT the early bubble — settle its pending state —
    # rather than unconditionally painting a second user bubble (which would double the message).
    adopt_idx = SRC.index("ADOPT the optimistic bubble")
    adopt_block = SRC[adopt_idx:adopt_idx + 1100]
    assert "_userMsgEl.classList.remove('msg-pending')" in adopt_block, (
        "the later block must settle the early bubble's pending state (adopt it)."
    )
    # The second addMessage('user', …) here is a guarded DEFENSIVE fallback (only if the early render
    # somehow didn't happen) — it must be gated, not unconditional.
    assert "else if (!skipBubble)" in adopt_block, (
        "the fallback paint must be guarded behind `_userMsgEl` being absent — never an unconditional "
        "second bubble."
    )


def test_client_msg_id_is_single_sourced_for_reconciliation():
    # ADR 0008 temp-id -> server-id reconciliation must still hold: exactly one `_clientMsgId`
    # declaration (the early block's) and it's the one appended to the form data. (#985 P2-A: a flushed
    # outbox send re-uses its queued bubble's pre-stamped id via `_queuedClientMsgId || 'c-'…`, so the
    # literal generator is wrapped — but there is still exactly ONE `const _clientMsgId =` declaration.)
    assert SRC.count("const _clientMsgId = ") == 1, (
        "there must be exactly ONE _clientMsgId declaration (the early block's) — the later "
        "duplicate was removed so the temp-id->server-id reconcile uses one stable id."
    )
    assert "'c-' + ((window.crypto && crypto.randomUUID)" in SRC, (
        "the client-temp-id generator (when no queued id is supplied) must remain."
    )
    assert "fd.append('client_msg_id', _clientMsgId)" in SRC, (
        "the optimistic bubble's client_msg_id must still be sent for server reconciliation."
    )
