"""#891 F4 order-stability — send/render order must survive an erratic server (the wedge regression).

Owner-reported live regression (2026-07-13, server wedged by a hung house-entry hold): "big
regressions on messages sending in order and showing up in order after they're sent, old messages
hanging out and getting out of order." The audit traced it to three seams (none of them the F4
gap-detect reload itself, which inherits softReloadHistory's full guard set):

  HOLE A — a DIRECT composer send was never outbox-held. Only queued/offline/requeued sends had a
      durable record; a direct send whose POST hung for minutes (the wedge) had NOTHING persisted,
      so a refresh mid-hang lost the message entirely — and a QUEUED sibling then restored and
      dispatched FIRST while the original's zombie POST could still persist later server-side (a
      permanent send-order inversion). Fix: `_outboxTrackInflightSend` registers every player-visible
      send in the awaiting-confirm bucket (persisted 'state:inflight' — the EXACT lifecycle a flushed
      queued send already had) right before the transport dispatch, covering the whole hang window on
      both the WS up-frame and the SSE POST. Released via the existing seams (adopt-pass confirm /
      requeue / mark-failed) plus an explicit release on a client-visible refusal.

  HOLE B — a fresh composer send could jump AHEAD of restored-but-unconfirmed older sends (the boot
      restore runs at 600ms+, its drain later still). Fix: a per-session FIFO gate in
      handleChatSubmit — when an older undispatched send for this session exists (in memory, or
      still un-restored in sessionStorage during the boot window), the fresh send JOINS the queue
      behind it instead of dispatching directly.

  HOLE C — the boot restore repainted a pending bubble for an item whose server row ALREADY rendered
      (refresh mid-flight where the POST landed), creating a duplicate the divergence check is
      structurally blind to (pending shape ⇒ excluded from _visibleMsgCount ⇒ RESCUED by every
      rebuild — "old messages hanging out"). Fix: the restore adopts an existing same-clientMsgId
      bubble instead of repainting; a db-id-stamped existing bubble proves delivery and releases the
      record outright; and the confirm/dedupe seams REMOVE a redundant never-adopted copy when the
      authoritative render is on screen.

  Plus the F4 recovery rate-limit: gap/resync-triggered reconciles get a per-session cooldown
      (folded into ONE reconcile within it) so an erratic SSE stream can't fire a full history
      fetch per event — while still routing through the ONE coalesced scheduleReconcile seam.

The refresh-mid-hang browser repro lives in test_f4_order_stability_browser.py (the conftest lane
split auto-marks any sync_playwright module `browser`). Roles only; no names (CLAUDE.md).

Run: cd frontend && .venv/bin/python -m pytest tests/test_f4_order_stability.py
"""

import os

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(rel):
    with open(os.path.join(FRONTEND, rel), encoding="utf-8") as f:
        return f.read()


# ─────────────────────────────────────────────────────────────────────────────
# F4 recovery rate-limit (sessionSync.js)
# ─────────────────────────────────────────────────────────────────────────────

def test_gap_reconcile_is_rate_limited_per_session():
    """A busSeq hole / resync sentinel on an ERRATIC stream can arrive per-event; each un-throttled
    recovery is a full /api/history fetch (softReloadHistory fetches BEFORE its hasActiveStream
    deferral). The gap path must carry a per-session cooldown that folds a burst into ONE reconcile."""
    js = _read("static/js/sessionSync.js")
    assert "var _GAP_RECONCILE_COOLDOWN_MS" in js, "the cooldown constant must exist"
    assert "function scheduleGapReconcile(id)" in js, "the rate-limited gap wrapper must exist"
    fn = js[js.index("function scheduleGapReconcile(id)"):]
    fn = fn[:fn.index("\n  }") + 4]
    assert "_lastGapReconcileAt" in fn, "the wrapper must track the last gap reconcile per session"
    assert "scheduleReconcile(id, wait)" in fn, \
        "the wrapper must route into the ONE coalesced scheduleReconcile seam — never a second reload path"


def test_gap_and_resync_route_through_the_rate_limited_wrapper():
    js = _read("static/js/sessionSync.js")
    assert "if (id && (type === 'resync' || _busGap(id, data))) { scheduleGapReconcile(id); }" in js, \
        "both the resync sentinel and a detected busSeq hole must ride the rate-limited recovery"
    # the normal message-added path keeps its prompt default coalesce (no cooldown for real writes)
    assert "} else if (type === 'message-added') {\n      scheduleReconcile(id);" in js, \
        "message-added must keep the prompt un-throttled coalesced reconcile"


def test_schedule_reconcile_keeps_default_delay_and_fold():
    """The base seam is unchanged for every other caller: default 120ms coalesce, per-session timer
    fold (an already-scheduled reconcile absorbs later triggers)."""
    js = _read("static/js/sessionSync.js")
    fn = js[js.index("function scheduleReconcile(id, delayMs)"):]
    fn = fn[:fn.index("function scheduleGapReconcile")]
    assert "if (_recTimers[id]) return;" in fn, "the per-session coalesce fold must be preserved"
    assert "typeof delayMs === 'number' ? delayMs : 120" in fn, \
        "callers that pass no delay must keep the original 120ms coalesce"


# ─────────────────────────────────────────────────────────────────────────────
# HOLE A — the durable in-flight record for a direct send (chat.js + chatOutbox.js)
# ─────────────────────────────────────────────────────────────────────────────

def test_direct_send_registers_a_durable_inflight_record_before_dispatch():
    js = _read("static/js/chat.js")
    fn = js[js.index("export async function handleChatSubmit"):]
    track_at = fn.index("_outboxTrackInflightSend(_clientMsgId, msg, streamSessionId, _userMsgEl)")
    ws_at = fn.index("WebSocket Phase-1 up-frame")
    post_at = fn.index("fetch(`${API_BASE}/api/chat_stream`")
    assert track_at < ws_at < post_at, \
        "the record must be registered BEFORE the transport dispatch (covers BOTH the WS up-frame and the SSE POST)"
    region = fn[track_at - 900:track_at + 200]
    assert "_userMsgEl && !ids.length" in region, \
        "scope: a visible player bubble only (headless machinery never restores), no attachments"
    assert "incognito-toggle" in region, \
        "an incognito send must never be tracked (its row never persists — a reload must not resurrect it)"


def test_track_inflight_is_idempotent_and_rides_awaiting_confirm():
    ob = _read("static/js/chatOutbox.js")
    fn = ob[ob.index("function _outboxTrackInflightSend(clientMsgId, text, sessionId, bubbleEl)"):]
    fn = fn[:fn.index("function _outboxReleaseInflightSend")]
    assert "[chatState._outboxAwaitingConfirm, chatState._sendOutbox, chatState._outboxFailed]" in fn, \
        "idempotent per clientMsgId — a flushed outbox send is already tracked, never double-recorded"
    assert "chatState._outboxAwaitingConfirm.push(" in fn, \
        "a direct send gets the EXACT queued→dispatched lifecycle: awaiting-confirm ('state:inflight')"
    assert "_persistOutbox();" in fn, "the record must be reload-durable from the instant it dispatches"
    assert "needsDedupe: false" in fn and "coalesce: false" in fn


def test_inflight_restore_order_preserves_dispatch_order():
    """_persistOutbox serializes awaiting-confirm FIRST, then the queue — so a reload mid-hang
    restores the in-flight turn AHEAD of the still-queued ones and the drain re-sends in the
    original dispatch order (the coordinator's refresh-mid-hang inversion)."""
    ob = _read("static/js/chatOutbox.js")
    fn = ob[ob.index("function _persistOutbox()"):]
    fn = fn[:fn.index("function _restoreOutboxFromStorage")]
    inflight_at = fn.index("state: 'inflight'")
    queued_at = fn.index("state: 'queued'")
    assert inflight_at < queued_at, \
        "in-flight (older, already-dispatched) items must serialize BEFORE queued ones (restore = FIFO)"


def test_client_visible_refusals_release_the_record():
    """A refusal the player SAW (a !res.ok streamed error, a WS pre-stream refusal) must release the
    durable copy — a later reload must not resurrect a turn the player consciously retries."""
    js = _read("static/js/chat.js")
    fn = js[js.index("export async function handleChatSubmit"):]
    # the !res.ok branch
    notok_at = fn.index("if (!res.ok) {")
    notok_block = fn[notok_at:notok_at + 900]
    assert "_outboxReleaseInflightSend(_clientMsgId)" in notok_block, \
        "a server-refused POST (client-visible error) must release the in-flight record"
    # the WS pre-stream refusal catch
    ws_catch_at = fn.index("Pre-stream refusal (stale-beat / forbidden / not-bound")
    ws_block = fn[ws_catch_at:ws_catch_at + 900]
    assert "_outboxReleaseInflightSend(_clientMsgId)" in ws_block, \
        "a WS pre-stream refusal must release the in-flight record (stale-beat retry semantics)"
    ob = _read("static/js/chatOutbox.js")
    rel = ob[ob.index("function _outboxReleaseInflightSend(clientMsgId)"):]
    rel = rel[:rel.index("function _outboxHasBlockingSendFor")]
    assert "_outboxAwaitingConfirm.findIndex" in rel and "_persistOutbox()" in rel, \
        "release drops ONLY the awaiting-confirm copy and re-persists"


# ─────────────────────────────────────────────────────────────────────────────
# HOLE B — per-session FIFO for fresh sends across a reload (chat.js)
# ─────────────────────────────────────────────────────────────────────────────

def test_fresh_send_joins_the_queue_behind_older_unconfirmed_sends():
    js = _read("static/js/chat.js")
    fn = js[js.index("export async function handleChatSubmit"):]
    gate_at = fn.index("_outboxHasBlockingSendFor(sessionModule.getCurrentSessionId())")
    inflight_guard_at = fn.index("if (chatState._sendInFlight) return;")
    assert gate_at < inflight_guard_at, \
        "the FIFO gate must run before the send-in-flight machinery (it queues, it doesn't dispatch)"
    block = fn[fn.index("per-session FIFO across a reload"):inflight_guard_at]
    assert "!chatState.isStreaming && !_headless" in block, \
        "scope: an idle plain composer send only (streaming sends already queue; machinery is exempt)"
    assert "_enqueueSend(_fifoText)" in block, "the blocked fresh send must JOIN the one queue"
    assert "isCommand(_fifoTrim)" in block, "a slash command must never be queued as chat"
    assert "fileHandlerModule.getPendingCount()" in block, \
        "attachment-carrying sends keep the inline path (their upload can't ride the queue)"
    assert "_flushSendOutbox()" in block, \
        "the gate must nudge the drain (the restore's own kick may have parked on backoff)"


def test_blocking_check_covers_memory_and_the_unrestored_boot_window():
    ob = _read("static/js/chatOutbox.js")
    fn = ob[ob.index("function _outboxHasBlockingSendFor(sessionId)"):]
    fn = fn[:fn.index("function _isRedundantConfirmedBubble")]
    assert "chatState._sendOutbox.some" in fn, "in-memory queued items must block"
    assert "!chatState._outboxRestoreDone" in fn and "_outboxPeekStorage()" in fn, \
        "during the pre-restore boot window the persisted record must block too (a fast typist must not outrun the restore)"
    assert "it.state !== 'failed'" in fn, \
        "terminally-failed items never block (they move only on an explicit Retry)"
    assert "!sid || !sessionId || sid === sessionId" in fn, \
        "the gate is per-session (an item bound to ANOTHER session never blocks this lane)"


# ─────────────────────────────────────────────────────────────────────────────
# HOLE C — the sticky-duplicate hole (chatOutbox.js)
# ─────────────────────────────────────────────────────────────────────────────

def test_restore_adopts_an_existing_bubble_instead_of_repainting():
    ob = _read("static/js/chatOutbox.js")
    restore = ob[ob.index("function _restoreOutboxFromStorage()"):]
    restore = restore[:restore.index("function _outboxConfirmDelivery")]
    assert "_existingByCid" in restore, \
        "the restore must look for an already-rendered bubble carrying the same clientMsgId"
    assert "existingEl.dataset.dbId) continue;" in restore.replace("if (existingEl && ", ""), \
        "a db-id-stamped existing bubble PROVES the row landed — release the record, never re-queue"
    assert "bubbleEl: existingEl || null" in restore, \
        "an existing un-adopted bubble is ADOPTED as the item's bubble — never repainted as a duplicate"


def test_restore_never_paints_into_a_foreign_sessions_view():
    ob = _read("static/js/chatOutbox.js")
    restore = ob[ob.index("function _restoreOutboxFromStorage()"):]
    restore = restore[:restore.index("function _outboxConfirmDelivery")]
    assert "_paintable" in restore, "the session paint-guard must exist"
    assert "!sid || sid === _curSid" in restore, \
        "a restored bubble may only paint into ITS OWN session's view (pre-session items paint anywhere)"
    assert "if (!item.bubbleEl && _paintable(item.sessionId)) _paintOutboxBubble(item);" in restore, \
        "the queued-restore paint must be existing-bubble-aware AND session-guarded"


def test_confirm_and_dedupe_remove_a_redundant_confirmed_copy():
    ob = _read("static/js/chatOutbox.js")
    assert "function _isRedundantConfirmedBubble(bubbleEl, clientMsgId)" in ob, \
        "the redundant-copy predicate must exist"
    helper = ob[ob.index("function _isRedundantConfirmedBubble(bubbleEl, clientMsgId)"):]
    helper = helper[:helper.index("function _restoreOutboxFromStorage")]
    assert "bubbleEl.dataset.dbId) return false" in helper, \
        "an ADOPTED bubble is the authoritative render — never redundant"
    assert ".msg[data-db-id]" in helper, \
        "redundancy requires the authoritative (db-id-stamped) render of the same clientMsgId on screen"
    confirm = ob[ob.index("function _outboxConfirmDelivery(clientMsgId)"):]
    confirm = confirm[:confirm.index("function _requeueOutboxItem")]
    assert "_isRedundantConfirmedBubble(removed.bubbleEl, clientMsgId)" in confirm, \
        "the confirm seam must remove a redundant copy instead of settling a permanent duplicate"
    assert "_setDeliveryState(removed.bubbleEl, 'delivered')" in confirm, \
        "the normal (non-duplicate) confirm still settles the bubble 'delivered'"
    dd = ob[ob.index("async function _dedupeOutboxAgainstServer()"):]
    dd = dd[:dd.index("function _setQueuedTag")]
    assert "_isRedundantConfirmedBubble(it.bubbleEl, it.clientMsgId)" in dd, \
        "the dedupe 'already on server' drop must remove a redundant copy too"
    assert "_setDeliveryState(it.bubbleEl, 'delivered')" in dd


# ─────────────────────────────────────────────────────────────────────────────
# The F4 reload path itself — the deferral guards it inherits must stay intact.
# ─────────────────────────────────────────────────────────────────────────────

def test_soft_reload_keeps_the_stream_deferral_and_pending_rescue():
    """The audited hypothesis (the F4-triggered reload yanking in-flight bubbles) was disproven
    BECAUSE these guards exist — pin them so that stays true: the destructive rebuild defers past a
    live stream, a pending optimistic bubble is excluded from the divergence count, and the rebuild
    RESCUES un-persisted pending sends instead of erasing them."""
    recon = _read("static/js/chatReconcile.js")
    fn = recon[recon.index("export async function softReloadHistory(sessionId)"):]
    assert "if (hasActiveStream(sessionId)) {" in fn, \
        "the destructive rebuild must defer past a live stream (the hang window is covered)"
    assert "chatState._pendingReconcile.add(sessionId);" in fn
    assert "_isPendingOptimisticBubble(el) && !_serverClientIds.has(el.dataset.clientMsgId)" in fn, \
        "the rebuild must rescue still-pending optimistic sends (never eat a message)"
    js = _read("static/js/chat.js")
    # the stream flags are set BEFORE the POST dispatch, so hasActiveStream covers a hung request
    fn2 = js[js.index("export async function handleChatSubmit"):]
    flags_at = fn2.index("chatState._streamSessionId = streamSessionId;")
    post_at = fn2.index("fetch(`${API_BASE}/api/chat_stream`")
    assert flags_at < post_at, \
        "hasActiveStream must be true for the WHOLE hang window (flags set before the POST)"
