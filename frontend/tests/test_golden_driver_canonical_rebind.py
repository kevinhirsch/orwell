"""L-F6 / #1745 — the golden-path DRIVER must FOLLOW a canonical-session rebinding, not 404 forever.

Verdict on #1745: the mid-game history 404 is a **REST-harness artifact**, not a user-facing binding
bug. The canonical game-session id (ADR 0008/0012) is first-writer-wins and STABLE during a started
game, so under continuous single-season play it never rotates. It only changes on a season-lifecycle
event — a new-game/restart clears the binding (``orwell_routes.py`` ``clear_game_session``), a session
delete, or an admin chat-wipe — which deletes the old chat row, so ``GET /api/history/{old}`` 404s
(``get_session`` → ``KeyError`` → 404). A real browser FOLLOWS the rebinding via
``GET /api/orwell/game-session`` (``sessions.js`` ``_resolveCanonicalGameSession``) and re-selects the
new chat; a FIXED-session REST client that pins one id 404s where the browser converges — the ~turn-58
false alarm.

The fix (harness side, not product): the pinned-session driver re-resolves the canonical binding on a
history 404 and adopts it, exactly like a browser. These tests pin BOTH halves — the follow, and the
NON-masking guarantee that a 404 with no live rebinding to follow still raises loudly (a genuine
dropped-session fault is never hidden). No live engine/FE needed."""
from __future__ import annotations

import io
import json
import urllib.error

import pytest

import scripts._golden_driver as gd
from scripts._golden_driver import GoldenDriver


def _driver(tmp_path) -> GoldenDriver:
    # The constructor is pure (only bookkeeping), so a bare instance exercises the read helpers.
    d = GoldenDriver(mode="replay", fixture=str(tmp_path / "f.jsonl"),
                     model="m", work_dir=str(tmp_path))
    d.session = "chat-old"
    return d


def _ok_body(payload: dict):
    return io.BytesIO(json.dumps(payload).encode())


def _router(routes):
    """A urlopen stub that dispatches by the FIRST matching path fragment. A route value that is an
    Exception is raised (a 404, a reset); anything else is returned as a JSON body."""
    def _urlopen(url, timeout=None):
        for frag, val in routes.items():
            if frag in url:
                if isinstance(val, Exception):
                    raise val
                return _ok_body(val)
        raise urllib.error.HTTPError(url, 404, "Not Found", None, None)
    return _urlopen


def test_history_follows_canonical_rebinding_on_404(tmp_path, monkeypatch):
    """The core L-F6 fix: the pinned id 404s (its chat row was rotated away by a lifecycle event),
    ``GET /api/orwell/game-session`` reports the NEW binding, and the driver ADOPTS it + re-reads —
    instead of hammering the dead id forever. ``self.session`` is updated so every later turn/read
    keys on the new chat, exactly like a browser re-selecting."""
    d = _driver(tmp_path)
    monkeypatch.setattr(gd.time, "sleep", lambda *_a, **_k: None)  # no real backoff wait

    monkeypatch.setattr(gd.urllib.request, "urlopen", _router({
        "/api/history/chat-old": urllib.error.HTTPError(  # the rotated-away id 404s persistently
            "u", 404, "Not Found", None, None),
        "/api/orwell/game-session": {"sessionId": "chat-new"},  # the rebinding a browser follows
        "/api/history/chat-new": {"history": [{"role": "assistant", "content": "hi"}]},
    }))

    msgs = d._history()
    assert msgs == [{"role": "assistant", "content": "hi"}]  # read succeeded against the NEW chat
    assert d.session == "chat-new"                            # the driver adopted the rebinding


def test_history_404_without_a_rebinding_still_raises(tmp_path, monkeypatch):
    """NON-masking: when the canonical resolver returns the SAME (dead) id — nothing new to follow —
    the 404 propagates loudly. A genuinely dropped session is a real fault, never silently swallowed."""
    d = _driver(tmp_path)
    monkeypatch.setattr(gd.time, "sleep", lambda *_a, **_k: None)

    monkeypatch.setattr(gd.urllib.request, "urlopen", _router({
        "/api/history/chat-old": urllib.error.HTTPError("u", 404, "Not Found", None, None),
        "/api/orwell/game-session": {"sessionId": "chat-old"},  # no rebinding — same dead id back
    }))

    with pytest.raises(urllib.error.HTTPError):
        d._history()
    assert d.session == "chat-old"  # nothing to adopt — the pinned id is unchanged


def test_history_404_with_nothing_bound_still_raises(tmp_path, monkeypatch):
    """NON-masking, the unbound case: a 404 while NOTHING is canonically bound (null sessionId) has no
    rebinding to follow, so it raises rather than adopting an empty id."""
    d = _driver(tmp_path)
    monkeypatch.setattr(gd.time, "sleep", lambda *_a, **_k: None)

    monkeypatch.setattr(gd.urllib.request, "urlopen", _router({
        "/api/history/chat-old": urllib.error.HTTPError("u", 404, "Not Found", None, None),
        "/api/orwell/game-session": {"sessionId": None},  # nothing bound
    }))

    with pytest.raises(urllib.error.HTTPError):
        d._history()
    assert d.session == "chat-old"


def test_history_transient_404_is_absorbed_without_a_rebind(tmp_path, monkeypatch):
    """A one-call transient 404 (a SQLite reader briefly behind a writer) is already retried away
    inside ``_get``'s budget, so it clears BEFORE the rebind path is reached — the canonical resolver
    is never even consulted, and the driver keeps its pinned id. Only a PERSISTENT 404 (a true
    rotation) triggers the follow. This keeps the existing transient-blip behavior byte-identical."""
    d = _driver(tmp_path)
    monkeypatch.setattr(gd.time, "sleep", lambda *_a, **_k: None)
    calls = {"history": 0, "game_session": 0}

    def _urlopen(url, timeout=None):
        if "/api/orwell/game-session" in url:
            calls["game_session"] += 1
            return _ok_body({"sessionId": "chat-new"})
        if "/api/history/chat-old" in url:
            calls["history"] += 1
            if calls["history"] < 3:  # two transient blips, then it clears
                raise urllib.error.HTTPError(url, 404, "Not Found", None, None)
            return _ok_body({"history": [{"role": "assistant", "content": "ok"}]})
        raise urllib.error.HTTPError(url, 404, "Not Found", None, None)

    monkeypatch.setattr(gd.urllib.request, "urlopen", _urlopen)

    msgs = d._history()
    assert msgs == [{"role": "assistant", "content": "ok"}]
    assert d.session == "chat-old"          # the pinned id was NOT rotated (no persistent 404)
    assert calls["game_session"] == 0       # the rebind resolver was never consulted


def test_history_non_404_error_does_not_trigger_a_rebind(tmp_path, monkeypatch):
    """A non-404 HTTP error (e.g. a 500) is NOT a rotation signal — it propagates without consulting
    the canonical resolver, so a server fault is never miscategorized as a rebinding."""
    d = _driver(tmp_path)
    monkeypatch.setattr(gd.time, "sleep", lambda *_a, **_k: None)
    consulted = {"game_session": False}

    def _urlopen(url, timeout=None):
        if "/api/orwell/game-session" in url:
            consulted["game_session"] = True
            return _ok_body({"sessionId": "chat-new"})
        raise urllib.error.HTTPError(url, 500, "Server Error", None, None)

    monkeypatch.setattr(gd.urllib.request, "urlopen", _urlopen)

    with pytest.raises(urllib.error.HTTPError):
        d._history()
    assert consulted["game_session"] is False  # a 500 is not a rebinding — resolver untouched
    assert d.session == "chat-old"


def test_canonical_session_helper_is_failsoft(tmp_path, monkeypatch):
    """``_canonical_session`` is best-effort: a resolver blip returns "" so the caller keeps its pinned
    id rather than crashing the walk on a transient game-session read failure."""
    d = _driver(tmp_path)
    monkeypatch.setattr(gd.time, "sleep", lambda *_a, **_k: None)

    def _boom(url, timeout=None):
        raise urllib.error.URLError("connection reset")

    monkeypatch.setattr(gd.urllib.request, "urlopen", _boom)
    assert d._canonical_session() == ""
