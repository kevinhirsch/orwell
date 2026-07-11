"""#891 P0 (messaging resilience) — the RELOAD-DURABLE outbox + honest offline status.

The #985 send outbox shipped in-memory only, with the reload-durable half explicitly deferred to
#891 (the old chat.js header comment; audit row INT-3 in docs/audits/2026-07-03-product-review-
fix-ledger.md: "hard reload while a send is QUEUED loses it"). This change closes the #891 P0 set:

  P0-1  RELOAD-DURABLE OUTBOX — every queued item persists to sessionStorage (PER-TAB by design:
        the outbox is this tab's queue per ADR 0008/0012, and a drained send flows through the
        NORMAL canonical-session send path — localStorage would let two tabs restore one queue and
        double-send; IndexedDB buys nothing for a handful of {id, text} strings). An item stays
        persisted from enqueue THROUGH dispatch (awaiting-confirm) until a server row carrying its
        clientMsgId is OBSERVED (adopt pass / pre-send dedupe). On boot the queue restores, bubbles
        repaint pending, and the drain resumes. At-most-once: restored/requeued items carry
        `needsDedupe` — one /api/history fetch drops any item whose client_msg_id the server
        already persisted, FAIL-CLOSED (unverifiable ⇒ stay queued + backoff, never a blind
        re-send). This is the F1 "no missing messages" bar (docs/audits/2026-06-27-ship-gate.md).

  P0-2  OFFLINE DETECTION + HONEST STATUS — a queued bubble carries a real-text-node `.queued-tag`
        ('queued' / 'queued — offline'; the .unsent-tag WCAG 4.1.3 precedent); the flush gates on
        navigator.onLine; an offline send goes STRAIGHT to the outbox (no doomed POST); a send that
        died at the network layer before any byte (`_isNetworkSendFailure` — deliberately narrower
        than the auto-recover classifier) is RE-QUEUED instead of surfacing a raw error; and the
        'online' event + a capped exponential backoff auto-drain the queue.

No second send path exists: the drain dispatches through the one `_outboxDispatch` →
`handleChatSubmit`, riding the existing clientMsgId adopt/reconcile seams (ADR 0008/0012).

Like #985/#836 this is an LLM-stub-blind seam, so the runtime gates drive the REAL chat.js in
headless chromium — including the literal commissioned scenario: queue while offline
(context.set_offline), reload, reconnect, exactly-once delivery with order preserved.

Run: cd frontend && .venv/bin/python -m pytest tests/test_891_reload_durable_outbox.py
"""

import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request

import pytest

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(rel):
    with open(os.path.join(FRONTEND, rel), encoding="utf-8") as f:
        return f.read()


# ─────────────────────────────────────────────────────────────────────────────
# Source pins — the durability legs can't silently regress (cheap, no browser).
# ─────────────────────────────────────────────────────────────────────────────

def test_persistence_layer_exists_and_is_per_tab():
    js = _read("static/js/chat.js")
    assert "function _persistOutbox()" in js, "the persistence write point must exist"
    assert "'orwell-send-outbox:'" in js, "the storage key must be user-scoped (E71 pattern)"
    assert "sessionStorage.setItem(_outboxKey()" in js, "the queue must persist to sessionStorage"
    # The storage CHOICE is load-bearing (per-tab, no cross-tab double-drain) — pin the rationale.
    assert "localStorage is shared across tabs" in js, \
        "the per-tab sessionStorage-vs-localStorage justification must stay documented in source"
    assert "const _outboxAwaitingConfirm = []" in js, \
        "dispatched-but-unconfirmed items must be tracked (persisted through the in-flight window)"


def test_enqueue_persists_immediately():
    js = _read("static/js/chat.js")
    fn = js[js.index("function _enqueueSend(text)"):]
    fn = fn[:fn.index("function _paintOutboxBubble")]
    assert "_persistOutbox();" in fn, "an enqueued send must be reload-durable from the instant it queues"
    assert "sessionId:" in fn, "the item must record its session for the restore-side dedupe/drain gates"


def test_restore_exists_and_dedupes_before_resend():
    js = _read("static/js/chat.js")
    assert "function _restoreOutboxFromStorage()" in js, "the boot restore must exist"
    restore = js[js.index("function _restoreOutboxFromStorage()"):]
    restore = restore[:restore.index("function _outboxConfirmDelivery")]
    assert "needsDedupe: true" in restore, \
        "EVERY restored item must verify against the server log before re-sending (at-most-once)"
    assert "_paintOutboxBubble(item)" in restore, "restored items must repaint their pending bubbles"
    # restore is wired to the boot (pageshow + retry schedule), not left for callers to remember
    assert "window.addEventListener('pageshow', _kickOutboxRestore" in js
    assert "function _dedupeOutboxAgainstServer()" in js.replace("async function", "function"), \
        "the pre-send server-log dedupe must exist"
    dd = js[js.index("async function _dedupeOutboxAgainstServer()"):]
    dd = dd[:dd.index("\n  // ──")]
    assert "metadata.client_msg_id" in dd.replace("m.metadata && m.metadata.client_msg_id", "metadata.client_msg_id"), \
        "dedupe must key on the server-stamped client_msg_id"
    assert "return false" in dd, "dedupe must FAIL CLOSED when verification is unavailable"


def test_flush_gates_on_offline_and_dedupe_and_keeps_item_persisted_through_dispatch():
    js = _read("static/js/chat.js")
    fn = js[js.index("function _flushSendOutbox()"):]
    fn = fn[:fn.index("// ── #891 P0: durability wiring")]
    # original #985 guards intact
    assert "if (_flushingOutbox) return;" in fn
    assert "if (isStreaming) return;" in fn
    assert "_sendOutbox.shift()" in fn
    # the new gates
    offline_at = fn.index("_outboxOnline()")
    shift_at = fn.index("_sendOutbox.shift()")
    assert offline_at < shift_at, "the offline gate must run BEFORE an item is consumed"
    assert "_dedupeOutboxAgainstServer()" in fn, "the at-most-once preflight must gate the dispatch"
    dedupe_at = fn.index("_dedupeOutboxAgainstServer()")
    assert dedupe_at < shift_at, "dedupe must run BEFORE the item is consumed"
    assert "ok === false" in fn, "an unverifiable dedupe must defer the drain (fail closed)"
    # durability through the in-flight window: dispatch does NOT drop the persisted copy
    assert "_outboxAwaitingConfirm.push(item)" in fn and "_persistOutbox()" in fn, \
        "a dispatched item must stay in the persisted record until server-confirmed"


def test_offline_send_goes_straight_to_outbox():
    """A non-headless send while navigator.onLine === false must enqueue (honest 'queued — offline')
    instead of firing a doomed POST — placed AFTER the slash dispatch, BEFORE the BUG-1 early bubble
    / session materialization (so no session machinery runs for a dead link)."""
    js = _read("static/js/chat.js")
    fn = js[js.index("export async function handleChatSubmit"):]
    preflight_at = fn.index("an OFFLINE send goes STRAIGHT to the durable outbox")
    bug1_at = fn.index("BUG 1 (never eat a message)")
    materialize_at = fn.index("Materialize pending session")
    assert preflight_at < bug1_at < materialize_at
    block = fn[preflight_at:bug1_at]
    assert "!_headless && !_outboxOnline()" in block
    assert "_enqueueSend(msg);" in block
    assert "_armOutboxRetry();" in block
    assert "_releaseSendFlag();" in block, "the send flag must release or the next send wedges"


def test_network_failure_classification_and_requeue():
    js = _read("static/js/chat.js")
    # the classifier is deliberately NARROW (browser fetch-network messages + navigator.onLine only)
    fn = js[js.index("function _isNetworkSendFailure(err)"):]
    fn = fn[:fn.index("async function _dedupeOutboxAgainstServer")]
    assert "failed to fetch" in fn and "networkerror" in fn
    assert "_outboxOnline()" in fn
    # the catch hook re-queues BEFORE the auto-recover branch, only for a zero-byte real player turn
    hook_at = js.index("_requeueOutboxItem(_clientMsgId, msg, _userMsgEl)")
    recover_at = js.index("_tryAutoRecover(holder, accumulated, streamSessionId)")
    assert hook_at < recover_at, "the requeue classification must precede auto-recover"
    hook_region = js[hook_at - 600:hook_at]
    assert "!accumulated && _userMsgEl && _isNetworkSendFailure(err)" in hook_region + js[hook_at - 120:hook_at + 120], \
        "requeue must be gated on zero bytes + a real user bubble + the network classifier"
    # the requeue helper: idempotent, dedupe-armed, capped
    rq = js[js.index("function _requeueOutboxItem(clientMsgId, text, bubbleEl)"):]
    rq = rq[:rq.index("function _isNetworkSendFailure")]
    assert "item.needsDedupe = true;" in rq, "a requeued POST may have reached the server — must re-verify"
    assert "_OUTBOX_MAX_RETRIES" in rq, "requeue must be capped (a misclassified error can't loop forever)"
    assert "_sendOutbox.unshift(item)" in rq, "the failed turn is the OLDEST — it re-sends first (order)"


def test_online_event_and_backoff_wiring():
    js = _read("static/js/chat.js")
    assert "window.addEventListener('online'" in js, "the reconnect drain must ride the 'online' event"
    assert "window.addEventListener('offline'" in js, "going offline must retag queued bubbles honestly"
    assert "function _armOutboxRetry()" in js
    arm = js[js.index("function _armOutboxRetry()"):]
    arm = arm[:arm.index("\n  /**")]
    assert "_OUTBOX_RETRY_MAX_MS" in arm and "* 2" in arm, "retry must back off exponentially with a cap"
    assert "const _OUTBOX_RETRY_BASE_MS = 2000" in js
    assert "const _OUTBOX_RETRY_MAX_MS = 60000" in js


def test_honest_status_tag_exists_and_is_styled():
    js = _read("static/js/chat.js")
    assert "function _setQueuedTag(bubbleEl, mode)" in js
    assert "'queued — offline'" in js and "'queued'" in js
    assert "tag.className = 'queued-tag'" in js, "the status must be a REAL text node (WCAG 4.1.3)"
    css = _read("static/style.css")
    assert ".msg-user .role .queued-tag" in css, "the queued tag must be styled in style.css"
    assert ".msg-user.msg-queued-offline .role .queued-tag" in css, \
        "the offline variant must be visually distinct"


def test_confirm_seam_and_single_send_path():
    js = _read("static/js/chat.js")
    # delivery confirm rides the EXISTING adopt pass (softReloadHistory) — no new reconcile path
    adopt_at = js.index("// 1) ADOPT PASS — no DOM churn.")
    adopt_block = js[adopt_at:adopt_at + 1400]
    assert "_outboxConfirmDelivery(cid)" in adopt_block, \
        "a server row carrying the clientMsgId must release the durable copy (adopt-pass seam)"
    # the drain still dispatches through the ONE dispatcher → handleChatSubmit (no second send path)
    assert "let _outboxDispatch = (text, opts) => handleChatSubmit(null, text, opts);" in js
    assert js.count("let _outboxDispatch") == 1


# ─────────────────────────────────────────────────────────────────────────────
# Runtime — drive the REAL chat.js in headless chromium.
# ─────────────────────────────────────────────────────────────────────────────

def _free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def _boot(env, port):
    proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "app:app", "--host", "127.0.0.1", "--port", str(port)],
        cwd=FRONTEND, env=env,
        stdout=open(f"/tmp/fe-891-{port}.log", "w"), stderr=subprocess.STDOUT,
    )
    base = f"http://127.0.0.1:{port}"
    for _ in range(120):
        if proc.poll() is not None:
            raise RuntimeError(f"uvicorn exited early; see /tmp/fe-891-{port}.log")
        try:
            urllib.request.urlopen(base + "/openapi.json", timeout=2)
            return proc, base
        except Exception:
            time.sleep(1)
    proc.terminate()
    raise RuntimeError("server never became ready")


@pytest.fixture(scope="module")
def _app():
    try:
        from playwright.sync_api import sync_playwright  # noqa: F401
    except Exception:
        pytest.skip("playwright not installed")
    env = dict(
        os.environ,
        ORWELL_GAME_BUILD="1",
        AUTH_ENABLED="false",
        LOCALHOST_BYPASS="true",
        PLAYWRIGHT_BROWSERS_PATH=os.environ.get("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers"),
        DATABASE_URL="sqlite:///" + os.path.join(tempfile.mkdtemp(prefix="orwell-891-"), "app.db"),
    )
    port = _free_port()
    try:
        proc, base = _boot(env, port)
    except RuntimeError as e:
        pytest.skip(str(e))
    yield base
    proc.terminate()
    try:
        proc.wait(timeout=10)
    except Exception:
        proc.kill()


def _new_context(pw, app, init_scripts=()):
    try:
        browser = pw.chromium.launch()
    except Exception as e:
        pytest.skip(f"chromium unavailable: {e}")
    context = browser.new_context()
    for script in init_scripts:
        context.add_init_script(script)
    page = context.new_page()
    page.goto(app + "/", wait_until="load", timeout=30000)
    page.wait_for_timeout(3500)  # module graph + async init
    return browser, context, page


# The dispatch spy used after the reload: records (text, clientMsgId) and mimics the real
# stream-end finally by scheduling the next flush, so the drain chains FIFO exactly like prod.
_INSTALL_SPY = r"""
() => {
  const chat = window.chatModule;
  const sent = [];
  window.__durableSpy = sent;
  chat._setOutboxDispatch((text, opts) => {
    sent.push({ text, clientMsgId: opts && opts.queuedClientMsgId });
    return Promise.resolve().then(() => { setTimeout(() => chat._flushSendOutbox(), 0); });
  });
  return true;
}
"""


# ── THE commissioned scenario: queue while OFFLINE → honest status → reload → restore →
#    reconnect ('online' event) → exactly-once delivery, order preserved. ─────────────────────────
def test_offline_queue_reload_reconnect_exactly_once_in_order(_app):
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        browser, context, page = _new_context(
            pw, _app,
            # After the reload, hold the boot auto-drain until the spy is installed (deterministic —
            # the init script lands before any page script on every navigation).
            init_scripts=("window.__orwellOutboxHoldDrain = true;",),
        )
        # NOTE: the init script also applied to THIS first load — clear it so phase 1 behaves
        # exactly like production (offline enqueue never dispatches anyway).
        page.evaluate("() => { window.__orwellOutboxHoldDrain = false; }")

        # Phase 1 — go OFFLINE and send twice through the REAL submit path.
        context.set_offline(True)
        phase1 = page.evaluate(r"""
          async () => {
            const chat = window.chatModule;
            if (!chat || !chat.handleChatSubmit || !chat._outboxPeekStorage) return { error: 'helpers missing' };
            const box = document.getElementById('chat-history');
            if (box) box.innerHTML = '';
            chat._sendOutbox.length = 0;
            const mi = document.getElementById('message');
            mi.value = 'first offline msg';
            await chat.handleChatSubmit(null);
            const composerClearedAfterFirst = mi.value === '';
            mi.value = 'second offline msg';
            await chat.handleChatSubmit(null);
            const bubbles = Array.from(document.querySelectorAll('#chat-history .msg.msg-user'));
            const rec = chat._outboxPeekStorage();
            return {
              queueLen: chat._sendOutbox.length,
              ids: chat._sendOutbox.map(it => it.clientMsgId),
              storedItems: rec && rec.items ? rec.items.map(it => ({ id: it.clientMsgId, text: it.text, state: it.state })) : null,
              bubbleCount: bubbles.length,
              tags: bubbles.map(b => { const t = b.querySelector('.role .queued-tag'); return t ? t.textContent : null; }),
              offlineClass: bubbles.every(b => b.classList.contains('msg-queued-offline')),
              pending: bubbles.every(b => b.dataset.clientMsgId && !b.dataset.dbId),
              composerClearedAfterFirst,
              composerClearedAfterSecond: mi.value === '',
            };
          }
        """)
        assert "error" not in phase1, phase1.get("error")
        assert phase1["queueLen"] == 2, "both offline sends must be captured in the outbox (never dropped)"
        assert phase1["bubbleCount"] == 2, "each offline send must paint its optimistic bubble"
        assert phase1["pending"], "the bubbles must be pending optimistic sends (clientMsgId, no dbId)"
        assert phase1["tags"] == ["queued — offline", "queued — offline"], (
            f"an offline send must show the HONEST status, not spin: {phase1['tags']!r}"
        )
        assert phase1["offlineClass"], "the offline variant class must be applied"
        assert phase1["composerClearedAfterFirst"] and phase1["composerClearedAfterSecond"], \
            "the composer must clear — the words are safely captured in the durable queue"
        assert phase1["storedItems"] is not None and len(phase1["storedItems"]) == 2, \
            "the queue must be persisted (reload-durable) the instant it queues"
        assert [s["text"] for s in phase1["storedItems"]] == ["first offline msg", "second offline msg"]
        assert all(s["state"] == "queued" for s in phase1["storedItems"])
        pre_reload_ids = phase1["ids"]
        assert len(set(pre_reload_ids)) == 2 and all(i.startswith("c-") for i in pre_reload_ids)

        # Phase 2 — hold the drain in THIS page too, reconnect, and hard-reload (sessionStorage is
        # per-tab, so the record rides the same tab across the reload).
        page.evaluate("() => { window.__orwellOutboxHoldDrain = true; }")
        context.set_offline(False)
        page.reload(wait_until="load", timeout=30000)
        try:
            page.wait_for_function(
                "() => window.chatModule && window.chatModule._sendOutbox.length >= 2",
                timeout=20000,
            )
        except Exception as e:
            state = page.evaluate(
                "() => window.chatModule ? { n: window.chatModule._sendOutbox.length, rec: window.chatModule._outboxPeekStorage() } : null"
            )
            browser.close()
            pytest.fail(f"the queue never restored after the reload (the deferred #891 half): {state!r} — {e}")

        restored = page.evaluate(r"""
          () => {
            const chat = window.chatModule;
            const bubbles = Array.from(document.querySelectorAll('#chat-history .msg.msg-user'))
              .filter(b => b.dataset.clientMsgId && !b.dataset.dbId);
            return {
              ids: chat._sendOutbox.map(it => it.clientMsgId),
              texts: chat._sendOutbox.map(it => it.text),
              needsDedupe: chat._sendOutbox.every(it => it.needsDedupe === true),
              repainted: bubbles.length,
            };
          }
        """)
        assert restored["ids"] == pre_reload_ids, (
            "the client message ids (the idempotency keys) must survive the reload byte-identical: "
            f"{restored['ids']!r} vs {pre_reload_ids!r}"
        )
        assert restored["texts"] == ["first offline msg", "second offline msg"], "order must be preserved"
        assert restored["needsDedupe"], "restored items must be marked for the pre-send server-log check"
        assert restored["repainted"] >= 2, "the restored queue must repaint its pending bubbles"

        # Phase 3 — install the spy, release the hold, and drain via the REAL 'online' seam.
        page.evaluate(_INSTALL_SPY)
        page.evaluate("() => { window.__orwellOutboxHoldDrain = false; window.dispatchEvent(new Event('online')); }")
        try:
            page.wait_for_function("() => (window.__durableSpy || []).length >= 2", timeout=15000)
        except Exception as e:
            spy = page.evaluate("() => (window.__durableSpy || []).map(s => s.text)")
            browser.close()
            pytest.fail(f"the reconnect drain never delivered both queued sends: {spy!r} — {e}")
        # Exactly-once: an extra flush + settle window must not re-dispatch anything.
        page.evaluate("() => window.chatModule._flushSendOutbox()")
        page.wait_for_timeout(400)
        final = page.evaluate(r"""
          () => {
            const chat = window.chatModule;
            const sent = window.__durableSpy || [];
            const rec = chat._outboxPeekStorage();
            return {
              order: sent.map(s => s.text),
              ids: sent.map(s => s.clientMsgId),
              sentCount: sent.length,
              queueDrained: chat._sendOutbox.length === 0,
              awaiting: chat._outboxAwaitingConfirm.map(it => it.clientMsgId),
              storedStates: rec && rec.items ? rec.items.map(it => it.state) : null,
            };
          }
        """)
        assert final["sentCount"] == 2, (
            f"exactly-once: both sends deliver, neither doubles — got {final['sentCount']} ({final['order']!r})"
        )
        assert final["order"] == ["first offline msg", "second offline msg"], (
            f"delivery must preserve send order: {final['order']!r}"
        )
        assert final["ids"] == pre_reload_ids, "the dispatched sends must carry the ORIGINAL client ids"
        assert final["queueDrained"]
        # Durability through the in-flight window: still persisted until the server row is observed…
        assert final["awaiting"] == pre_reload_ids
        assert final["storedStates"] == ["inflight", "inflight"], \
            "a dispatched-but-unconfirmed item must STILL be reload-durable"
        # …and released exactly when delivery is confirmed.
        confirmed = page.evaluate(r"""
          (ids) => {
            const chat = window.chatModule;
            ids.forEach(id => chat._outboxConfirmDelivery(id));
            return { awaiting: chat._outboxAwaitingConfirm.length, rec: chat._outboxPeekStorage() };
          }
        """, pre_reload_ids)
        assert confirmed["awaiting"] == 0
        assert confirmed["rec"] is None, "a confirmed delivery must release the persisted copy"
        browser.close()


# ── At-most-once across a reload: an item whose row ALREADY reached the server never re-sends. ───
def test_restored_item_already_on_server_never_double_sends(_app):
    from playwright.sync_api import sync_playwright
    seed = json.dumps({
        "v": 1,
        "items": [{
            "clientMsgId": "c-891-dup", "text": "already delivered turn",
            "sessionId": "sess-891-dup", "ts": 1, "retries": 0, "state": "inflight",
        }],
    })
    init = (
        "window.__orwellOutboxHoldDrain = true;"
        "try { sessionStorage.setItem('orwell-send-outbox:', %s); } catch (_) {}"
        % json.dumps(seed)
    )
    with sync_playwright() as pw:
        try:
            browser = pw.chromium.launch()
        except Exception as e:
            pytest.skip(f"chromium unavailable: {e}")
        context = browser.new_context()
        context.add_init_script(init)
        page = context.new_page()
        # The server already persisted this client_msg_id (stubbed history for the recorded session).
        page.route(
            "**/api/history/sess-891-dup",
            lambda route: route.fulfill(
                status=200, content_type="application/json",
                body=json.dumps({"history": [{
                    "role": "user", "content": "already delivered turn",
                    "metadata": {"client_msg_id": "c-891-dup"},
                }]}),
            ),
        )
        page.goto(_app + "/", wait_until="load", timeout=30000)
        page.wait_for_timeout(3500)
        try:
            page.wait_for_function(
                "() => window.chatModule && window.chatModule._sendOutbox.length >= 1",
                timeout=20000,
            )
        except Exception as e:
            browser.close()
            pytest.fail(f"the seeded record never restored — {e}")
        page.evaluate(_INSTALL_SPY)
        page.evaluate("() => { window.__orwellOutboxHoldDrain = false; window.chatModule._flushSendOutbox(); }")
        try:
            page.wait_for_function(
                "() => window.chatModule._sendOutbox.length === 0",
                timeout=15000,
            )
        except Exception as e:
            state = page.evaluate("() => ({ n: window.chatModule._sendOutbox.length, spy: window.__durableSpy })")
            browser.close()
            pytest.fail(f"the dedupe pass never resolved the queued duplicate: {state!r} — {e}")
        page.wait_for_timeout(300)
        result = page.evaluate(r"""
          () => ({
            dispatched: (window.__durableSpy || []).length,
            rec: window.chatModule._outboxPeekStorage(),
          })
        """)
        browser.close()
    assert result["dispatched"] == 0, (
        "an item whose client_msg_id the server already persisted must NEVER re-send "
        f"(at-most-once across a reload) — got {result['dispatched']} dispatches"
    )
    assert result["rec"] is None, "the proven-delivered item must be released from storage"


# ── Requeue semantics: idempotent per id, capped, confirm releases everything. ───────────────────
def test_requeue_idempotent_capped_and_confirm_releases(_app):
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        browser, context, page = _new_context(pw, _app)
        result = page.evaluate(r"""
          () => {
            const chat = window.chatModule;
            if (!chat || !chat._requeueOutboxItem) return { error: 'helpers missing' };
            chat._sendOutbox.length = 0;
            chat._outboxAwaitingConfirm.length = 0;
            try { sessionStorage.removeItem('orwell-send-outbox:'); } catch (_) {}

            // idempotent per clientMsgId: a double network-failure classification queues ONE copy
            const r1 = chat._requeueOutboxItem('c-rq-891', 'hello world', null);
            const r2 = chat._requeueOutboxItem('c-rq-891', 'hello world', null);
            const rec1 = chat._outboxPeekStorage();
            const afterTwo = {
              r1, r2,
              queueLen: chat._sendOutbox.length,
              needsDedupe: chat._sendOutbox[0] && chat._sendOutbox[0].needsDedupe === true,
              persisted: !!(rec1 && rec1.items && rec1.items.length === 1),
            };

            // capped: an item that has burned its retries hands the turn back (returns false)
            chat._sendOutbox.length = 0;
            chat._outboxAwaitingConfirm.push({ clientMsgId: 'c-cap-891', text: 'x', retries: 4, sessionId: null, ts: 1 });
            const capOk = chat._requeueOutboxItem('c-cap-891', 'x', null);
            const capState = { capOk, queueLen: chat._sendOutbox.length, awaiting: chat._outboxAwaitingConfirm.length };

            // confirm releases queue + awaiting + storage
            chat._sendOutbox.length = 0;
            chat._outboxAwaitingConfirm.length = 0;
            chat._requeueOutboxItem('c-cf-891', 'bye', null);
            chat._outboxConfirmDelivery('c-cf-891');
            const confirmed = { queueLen: chat._sendOutbox.length, rec: chat._outboxPeekStorage() };

            return { afterTwo, capState, confirmed };
          }
        """)
        browser.close()
    assert "error" not in result, result.get("error")
    a = result["afterTwo"]
    assert a["r1"] is True and a["r2"] is True and a["queueLen"] == 1, \
        f"requeue must be idempotent per clientMsgId (one copy): {a!r}"
    assert a["needsDedupe"], "a requeued item must re-verify against the server before re-sending"
    assert a["persisted"], "a requeued item must be reload-durable"
    c = result["capState"]
    assert c["capOk"] is False and c["queueLen"] == 0, \
        f"past the retry cap the requeue must decline (the normal error surface speaks): {c!r}"
    f = result["confirmed"]
    assert f["queueLen"] == 0 and f["rec"] is None, \
        "a confirmed delivery must release every durable copy"
