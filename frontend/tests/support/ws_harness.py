"""Shared scaffolding for the WebSocket Phase-1 SERVER-half tests (protocol-spec §7 / test-plan §2).

Mirrors the role of ``tests/support/sandbox.ts`` on the engine side — a canonical factory, not
per-test wiring. Three pieces:

  * ``FakeWebSocket`` + ``run_ws`` — drive the REAL module-level ``ws_routes.ws_session`` handler with
    an in-process duplex fake socket in ONE event loop (the repo's ``_run(main())`` async idiom, see
    ``test_0064_turn_queue.py``). No booted app, no TestClient portal thread — so the handler,
    ``agent_runs.start``, and a gate-controlled fake run all share the loop, which is exactly what the
    reconnect-splice test needs.
  * ``seed_live_game`` — bind a canonical id so ``resolve_live_game_session`` returns it (liveness is
    controlled per-test by monkeypatching ``ws_routes._is_live``; the store path is redirected to a tmp
    file by the test fixture). Roles only, no names (CLAUDE.md).
  * ``push_run`` — drive a fake detached run through the **real** ``agent_runs`` (``start`` →
    ``_publish``/``subscribe``/``has_run``), so the socket adapter is the only new code under test; the
    splice logic is the shipped one. **Never stub ``agent_runs``** — the whole risk is that the socket
    adapter breaks the real splice, so it must run the real generator.

The frame ``seq`` a client reads MUST equal the ``_Run.buffer`` index (``agent_runs.py`` ``_publish``);
every case that reads ``frame["seq"]`` asserts it against that buffer index, never a client counter.
"""
from __future__ import annotations

import asyncio
import contextlib
import importlib
import json
from typing import Any, Callable, Optional

from starlette.websockets import WebSocketDisconnect

agent_runs = importlib.import_module("src.agent_runs")

_DISCONNECT = object()


class _FakeState:
    auth_manager = None


class _FakeApp:
    state = _FakeState()


class FakeWebSocket:
    """An in-process duplex fake of a Starlette WebSocket. The test pushes client→server frames with
    ``client_send`` / ``client_disconnect`` and reads server→client frames with ``recv`` — both over
    asyncio queues, so the handler and the test cooperate in one loop."""

    def __init__(self, cookies: Optional[dict] = None, app: Any = None):
        self.cookies = cookies or {}
        self.app = app or _FakeApp()
        self.sent: list[dict] = []
        self.accepted = False
        self.closed = False
        self._incoming: asyncio.Queue = asyncio.Queue()
        self._outgoing: asyncio.Queue = asyncio.Queue()

    # ── server-facing surface (what ws_session calls) ──
    async def accept(self) -> None:
        self.accepted = True

    async def close(self, code: int = 1000) -> None:
        self.closed = True

    async def receive_text(self) -> str:
        item = await self._incoming.get()
        if item is _DISCONNECT:
            raise WebSocketDisconnect(code=1000)
        return item

    async def send_text(self, s: str) -> None:
        frame = json.loads(s)
        self.sent.append(frame)
        await self._outgoing.put(frame)

    # ── test-facing surface ──
    def client_send(self, frame: dict) -> None:
        self._incoming.put_nowait(json.dumps(frame))

    def client_disconnect(self) -> None:
        self._incoming.put_nowait(_DISCONNECT)

    async def recv(self, timeout: float = 2.0) -> dict:
        return await asyncio.wait_for(self._outgoing.get(), timeout=timeout)

    async def recv_where(self, pred: Callable[[dict], bool], timeout: float = 2.0) -> dict:
        """Read frames until one satisfies ``pred`` (skipping heartbeats etc.), returning it."""
        while True:
            f = await self.recv(timeout=timeout)
            if pred(f):
                return f

    async def collect_until(self, pred: Callable[[dict], bool], timeout: float = 2.0) -> list[dict]:
        """Collect frames (inclusive) up to and including the first that satisfies ``pred``."""
        out: list[dict] = []
        while True:
            f = await self.recv(timeout=timeout)
            out.append(f)
            if pred(f):
                return out


def new_ws(cookies: Optional[dict] = None) -> FakeWebSocket:
    return FakeWebSocket(cookies=cookies)


def spawn(ws: FakeWebSocket) -> asyncio.Task:
    """Start the real ws_session handler draining ``ws`` as a task in the current loop."""
    from routes import ws_routes
    return asyncio.create_task(ws_routes.ws_session(ws))


async def stop(ws: FakeWebSocket, task: asyncio.Task) -> None:
    """Disconnect the client and let the handler unwind (cancel as a fallback). ALWAYS leaves
    ``task`` fully done before returning — a task still pending when this coroutine returns can
    survive into the test harness's loop-close (``tests/conftest.py``'s ``_run`` closes the loop
    immediately once the driving coroutine completes) and get GC-finalized against an already-CLOSED
    loop later, producing the 'Task was destroyed but it is pending!' /
    'RuntimeError: Event loop is closed' noise CI hit deterministically under Python 3.12's stricter
    cancellation semantics (issue #1339). The prior version cancelled as a fallback but never
    re-awaited, so the cancellation was only ever *requested*, not delivered, before this returned."""
    ws.client_disconnect()
    try:
        await asyncio.wait_for(task, timeout=1.0)
    except (asyncio.TimeoutError, asyncio.CancelledError, WebSocketDisconnect):
        pass
    if not task.done():
        task.cancel()
    if not task.done():
        with contextlib.suppress(Exception, asyncio.CancelledError):
            await task


async def hello(ws: FakeWebSocket, per_tab_id: str, cid: str = "c_hello", **extra) -> dict:
    """Send a ``hello`` and return the first ``ack``/``error`` reply."""
    ws.client_send({"t": "hello", "cid": cid, "d": {"perTabId": per_tab_id, "protocol": 1, **extra}})
    return await ws.recv_where(lambda f: f.get("t") in ("ack", "error") and f.get("ch") is None)


# ── canonical-binding + run seeding ──────────────────────────────────────────────────────────────

def seed_live_game(user: Optional[str], session_id: str = "live-canon") -> str:
    """Bind ``session_id`` as ``user``'s canonical game session and return it. Liveness is asserted by
    the test via ``monkeypatch.setattr(ws_routes, "_is_live", lambda sid: True)``; the store path is a
    tmp file (fixture). Roles only — never a houseguest name."""
    ogs = importlib.import_module("src.orwell_game_session")
    ogs.bind_game_session(user, session_id)
    return session_id


def sse_delta(text: str, thinking: bool = False) -> str:
    return f'data: {json.dumps({"delta": text, "thinking": thinking})}\n\n'


def sse_message_saved(msg_id: str, seq: int) -> str:
    return f'data: {json.dumps({"type": "message_saved", "id": msg_id, "seq": seq})}\n\n'


def sse_done() -> str:
    return "data: [DONE]\n\n"


async def _fake_agen(events, gate: Optional[asyncio.Event] = None, release_after: Optional[int] = None):
    """Yield the exact SSE event strings the chat producer emits. When ``gate`` + ``release_after`` are
    given, HOLD the run open after ``release_after`` events until the gate is set — a deterministic
    "drop mid-stream, more arrives later" with no wall-clock race (test-plan §3)."""
    for i, ev in enumerate(events):
        if gate is not None and release_after is not None and i == release_after:
            await gate.wait()
        yield ev
        await asyncio.sleep(0)  # hand control to subscribers so the buffer drains in order


def push_run(canonical_id: str, events, gate: Optional[asyncio.Event] = None,
             release_after: Optional[int] = None, queue: bool = False):
    """Start a fake detached run through the REAL ``agent_runs`` (must be called inside the running
    loop, alongside the ws_session task)."""
    return agent_runs.start(canonical_id, _fake_agen(events, gate, release_after), queue=queue)


def reset_runs() -> None:
    """Clear the process-global ``agent_runs`` registry between tests (they share module state) and
    cancel any dangling drain/evict tasks so the closing loop doesn't warn about pending timers. Use
    ``aclose_runs`` from INSIDE a test's coroutine to also AWAIT the cancellations (the clean path).
    Runs both inside and outside a live loop (fixture setup/teardown is sync) — a stale task bound to
    an already-closed loop from a prior test can raise on ``.cancel()`` under 3.12's stricter checks,
    so that path is defensively swallowed too."""
    for run in list(agent_runs._RUNS.values()):
        for attr in ("task", "evict_task"):
            t = getattr(run, attr, None)
            if t is not None and not t.done():
                with contextlib.suppress(Exception):
                    t.cancel()
    agent_runs._RUNS.clear()


async def aclose_runs() -> None:
    """Cancel AND await every dangling ``agent_runs`` drain/evict task, then clear the registry — call
    this at the end of a test's ``main()`` (inside the loop) so a detached run / its 180s evict timer
    never survives to the loop close (which would raise ``Event loop is closed`` in teardown).

    ``asyncio.CancelledError`` is a ``BaseException`` (since Python 3.8), NOT an ``Exception`` — so
    ``contextlib.suppress(Exception)`` does not catch it. A task that is cancelled BEFORE it has ever
    had a chance to run its first step (common for a just-created evict timer: `_schedule_evict`
    creates it in the SAME tick this function then cancels it in) gets `CancelledError` thrown into it
    before its own `try/except CancelledError` is ever installed, so the exception propagates straight
    out of `await t` uncaught — cancelling the awaiting task in turn. Under Python 3.12 this reproduced
    deterministically (issue #1339); explicitly suppressing `CancelledError` alongside `Exception` is
    the correct fix (not a version-specific one — the prior code was always subtly wrong here)."""
    pending = []
    for run in list(agent_runs._RUNS.values()):
        for attr in ("task", "evict_task"):
            t = getattr(run, attr, None)
            if t is not None and not t.done():
                t.cancel()
                pending.append(t)
    for t in pending:
        with contextlib.suppress(Exception, asyncio.CancelledError):
            await t
    agent_runs._RUNS.clear()
