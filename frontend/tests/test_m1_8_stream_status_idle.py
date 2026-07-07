"""M1-8 (audit A8) — "no active stream" is a normal state, never a 404.

F-8 already cut the CLIENT probe frequency (once per session per page-load); this pins the
SERVER half: the remaining legitimate probes must answer 200 `{"status": "idle"}` instead of
red-lining the console with 404s that mask real failures. Both client consumers branch on
`status !== 'streaming'`, so the idle payload is drop-in compatible (no client change).
"""

import inspect
import importlib


def _route_source() -> str:
    chat_routes = importlib.import_module("routes.chat_routes")
    src = inspect.getsource(chat_routes)
    fn = src[src.index("async def chat_stream_status("):]
    # cut at the next route decorator so we only inspect this handler
    return fn[: fn.index("@router.") if "@router." in fn else len(fn)]


def test_idle_session_answers_200_idle_not_404():
    body = _route_source()
    assert '{"status": "idle"}' in body, "an idle session must answer a normal 200 payload"
    assert 'HTTPException(404' not in body, \
        "no-active-stream is a normal state — the 404-as-flow signal must not return"


def test_detached_run_still_reports_streaming():
    body = _route_source()
    assert '"detached": True' in body and '"streaming"' in body, \
        "the detached-run reconnect signal (F-8's whole purpose) must survive the idle change"


def test_clients_branch_on_status_not_ok(  ):
    """The two sessions.js consumers must keep gating on status !== 'streaming' — that is
    what makes the 200-idle payload drop-in compatible."""
    import os
    p = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                     "static", "js", "sessions.js")
    js = open(p, encoding="utf-8").read()
    assert js.count("status !== 'streaming'") >= 2, \
        "both stream_status consumers must branch on the status field"
