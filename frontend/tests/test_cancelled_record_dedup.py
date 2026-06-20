"""Duplicate "[Cancelled by user]" record guard (concurrent-session desync).

Symptom: stopping an empty (no-token-yet) streaming turn — common for framed/casting turns
that QUEUE behind an in-flight run and are slow to first token — persisted TWO
"[Cancelled by user]" assistant records. Invisible in the acting tab (both writes hit the
same DOM node) but surfacing as DUPLICATE bubbles on reload and in a second concurrent
session, because the mirror / cross-device sync re-reads history.

Root cause: a single Stop reaches `_renderCancelledBubble` from BOTH the stop branch in
`handleChatSubmit` AND the aborted reader's catch block, for the same holder. Each call POSTs
`/inject_messages`, which blindly appends (no dedupe) — so the cancel is persisted twice.

Fix: `_renderCancelledBubble` is idempotent per turn (a `dataset.cancelledRendered` latch), so
the cancel is recorded exactly once no matter how many abort paths fire.

Source-level assertions (chat.js is vanilla JS with no JS test runner in this repo).
"""

import os

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*rel):
    with open(os.path.join(FRONTEND, *rel), encoding="utf-8") as f:
        return f.read()


def _fn(src, marker, end):
    start = src.index(marker)
    return src[start:src.index(end, start)]


def test_render_cancelled_bubble_is_idempotent():
    chat = _read("static", "js", "chat.js")
    fn = _fn(chat, "function _renderCancelledBubble(holder)", "function detachCurrentStream")
    # an early-return latch keyed on the holder, set BEFORE the inject fetch fires
    assert "dataset.cancelledRendered === '1'" in fn
    assert "holder.dataset.cancelledRendered = '1'" in fn
    # the latch is checked before the persistence POST (so the second call truly no-ops)
    latch = fn.index("holder.dataset.cancelledRendered = '1'")
    inject = fn.index("/inject_messages")
    assert latch < inject, "the dedupe latch must be set before the inject_messages POST"


def test_both_abort_paths_still_route_through_the_guarded_helper():
    # The two call sites remain (the guard is the dedupe, not removal of a path): the
    # synchronous stop branch and the aborted reader's catch block both call the helper.
    chat = _read("static", "js", "chat.js")
    assert chat.count("_renderCancelledBubble(") >= 3  # 1 definition + >=2 call sites


def test_inject_messages_endpoint_has_no_server_side_dedupe():
    # Documents WHY the client guard is load-bearing: the endpoint blindly appends every
    # message, so a double client call WAS two persisted records.
    routes = _read("routes", "session_routes.py")
    seg = routes[routes.index("async def inject_messages("):]
    seg = seg[:seg.index("@router.post(\"/session/{sid}/delete\")")]
    assert "for m in messages:" in seg
    assert "sess.add_message(" in seg
