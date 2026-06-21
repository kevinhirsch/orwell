"""ADR 0008 — the cross-tab/-device chat reconcile contract (drift guards).

The S3-RACE divergence was a *structural* FE failure (a replicated log with no merge discipline),
so the fix is pinned structurally — these source gates fail if any leg of the fix is reverted. They
mirror the g15 single-dispatcher / casting-leak drift-guard style (source-string asserts, no browser).

The four legs (ADR 0008 "Decision"):
  1. authoritative ordering   — ChatMessage.seq + UNIQUE(session_id, seq) + order-by-seq render paths;
  2. render-/reconcile-by-id  — adopt optimistic bubbles to {id, seq}; rebuild only when diverged;
  3. idempotent event handling — NO blanket hasActiveStream suppression (process every event);
  4. completion broadcast      — add_message publishes message-added with the authoritative {id, seq}.
"""
import os

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*parts):
    with open(os.path.join(FRONTEND, *parts), encoding="utf-8") as f:
        return f.read()


# ── Leg 1: authoritative ordering (schema + migration + ordered reads) ───────────

def test_schema_has_seq_column_and_unique_index():
    src = _read("core", "database.py")
    assert "seq = Column(Integer" in src, "ChatMessage must carry a `seq` column"
    assert "ix_messages_session_seq" in src and "unique=True" in src, \
        "UNIQUE(session_id, seq) index is the total-order backstop"
    assert "def _migrate_add_chat_message_seq_column" in src, "a backfill migration must exist"
    assert "_migrate_add_chat_message_seq_column()" in src, "the migration must be wired into init"


def test_render_paths_order_by_seq_not_timestamp():
    sm = _read("core", "session_manager.py")
    hr = _read("routes", "history_routes.py")
    # The chat-history render paths must order by the authoritative seq.
    assert "order_by(DbChatMessage.seq)" in sm
    assert "order_by(DbChatMessage.seq)" in hr
    # And must NOT reorder a render path by the non-unique timestamp (the original reorder bug).
    assert ".order_by(DbChatMessage.timestamp)" not in hr, \
        "an ASC timestamp ordering re-introduces the cross-tab reorder"
    assert ".order_by(DbChatMessage.timestamp)" not in sm


def test_history_api_exposes_id_and_seq():
    hr = _read("routes", "history_routes.py")
    # DB-fallback path surfaces the canonical id + seq per entry.
    assert '"id": m.id, "seq": m.seq' in hr, "history entries must expose {id, seq} for render-by-id"
    # In-memory path surfaces them from the stamped metadata.
    assert 'entry["seq"] = msg.metadata["_seq"]' in hr or 'entry["seq"]' in hr


# ── Leg 2: render-/reconcile-by-id (adopt + divergence-gated rebuild) ─────────────

def test_soft_reload_history_adopts_then_rebuilds_only_on_divergence():
    src = _read("static", "js", "chat.js")
    assert "ADOPT PASS" in src, "the cheap adopt pass (no churn) must be present"
    # The divergence guard: the full innerHTML rebuild must be gated, never unconditional.
    assert "const converged =" in src and "if (converged)" in src, \
        "a rebuild must only run when the rendered order diverges from the server seq order"
    assert "_pendingReconcile" in src, "a live stream must DEFER its reconcile, not stomp the stream"
    assert "flushPendingReconcile" in src, "the deferred reconcile must flush at stream end"


def test_sender_reconciles_after_its_own_turn_read_your_writes():
    src = _read("static", "js", "chat.js")
    # The optimistic temp id + its round-trip (so the sender adopts its own user bubble).
    assert "_clientMsgId" in src and "dataset.clientMsgId = _clientMsgId" in src
    assert "fd.append('client_msg_id', _clientMsgId)" in src, "the temp id must be sent for adoption"
    assert "flushPendingReconcile(streamSessionId)" in src, \
        "the sender must reconcile after its own turn persists (read-your-writes)"


def test_stream_end_resets_stream_session_id_so_deferred_reconcile_can_flush():
    # ADR-0008 LIVE-verification fix (audit 2026-06-21): _streamSessionId is set on stream START but was
    # NEVER reset, so hasActiveStream() (`_streamSessionId === sessionId || …`) stayed permanently true
    # for the last-streamed session. The deferred reconcile then RE-DEFERRED forever at the
    # `if (hasActiveStream(sessionId))` guard, so a tab that had sent even one turn could never
    # live-reconcile a peer's concurrent write to that session until a reload (the two-tabs-streaming-
    # concurrently residual, reproduced + fixed live). The foreground reader's finally must clear it —
    # guarded to `=== streamSessionId` so a newer stream's session isn't clobbered by a late finally.
    src = _read("static", "js", "chat.js")
    assert "if (_streamSessionId === streamSessionId) _streamSessionId = null;" in src, \
        "the foreground stream's finally must reset _streamSessionId so hasActiveStream clears at stream end"


def test_renderer_stamps_seq_and_client_id_on_bubbles():
    src = _read("static", "js", "chatRenderer.js")
    assert "wrap.dataset.seq" in src, "rendered bubbles must carry their seq for the divergence check"
    assert "wrap.dataset.clientMsgId" in src, "rendered bubbles must carry the temp id for adoption"


# ── Leg 3: idempotent event handling (no blanket suppression) ────────────────────

def test_session_sync_no_longer_drops_peer_events():
    src = _read("static", "js", "sessionSync.js")
    # The defect: a streaming tab bailed on EVERY event, dropping the peer's writes. That blanket
    # early-return must be gone; events route through the idempotent reconcile instead.
    assert "if (cm.hasActiveStream && cm.hasActiveStream(id)) return;" not in src, \
        "the blanket hasActiveStream suppression dropped the peer's reconcile signal (S3-RACE)"
    assert "scheduleReconcile" in src, "message events must drive an idempotent (coalesced) reconcile"


# ── Leg 4: completion broadcast (the missing message-added on persist) ───────────

def test_add_message_broadcasts_completion_with_id_and_seq():
    src = _read("core", "session_manager.py")
    assert 'func.max(DbChatMessage.seq)' in src, "seq is assigned MAX(seq)+1 under the write lock"
    assert "IntegrityError" in src, "the unique-index race must be caught + retried"
    assert '"message-added"' in src, "add_message must publish the completion broadcast"
    # The payload carries the authoritative {id, seq} (+ the optimistic client id), never content.
    assert '"seq"' in src and '"client_msg_id"' in src
    # Vault-free / cross-user-safe: the broadcast never ships the message body.
    assert '"content"' not in src.split('"message-added"')[1].split(")")[0]
