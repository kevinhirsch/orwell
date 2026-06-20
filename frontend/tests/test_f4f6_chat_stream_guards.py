"""F4 — the chat.js → status-HUD reconcile trigger (source-pinned).

CI cannot drive the real, non-deterministic LLM stream, so we do not test the
streaming behaviour itself — we test the WIRING that prevents the sync bug,
deterministically, by reading static/js/chat.js and asserting the dispatch exists.
Mirrors the source-reading style of the other chat.js gates.

F4 (trigger side) — the status HUD polls every 20s, so it lags after a turn. The
sibling status panel now listens for the existing 'orwell:gamechanged' window
CustomEvent and re-fetches immediately. chat.js must DISPATCH that event when a
streamed run STARTS and when it ENDS/finalizes so the HUD reconciles at once. The
event already exists (orwellDecision.js listens) so dispatching is idempotent; no
new polling is added.

F6 (stall-watchdog false-fire) — NON-ISSUE, no change shipped: investigation found
`_startStallWatchdog()` is *deliberately disabled* on main (its body comment: the
manual "still working?" banner is "redundant (and annoying)" now that the
server-side stall detector + auto-continue loop-breaker handle quiet/stalled
streams). A disabled watchdog cannot false-fire, so re-enabling it (even tool-aware)
would revert that deliberate product decision. F6 therefore needs no code change.
"""
import os
import re

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHAT_JS = os.path.join(FRONTEND, "static", "js", "chat.js")


def _read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


# ── F4: chat.js DISPATCHES orwell:gamechanged at run-start and run-end ───────

def test_dispatches_gamechanged_event():
    js = _read(CHAT_JS)
    dispatches = re.findall(
        r"window\.dispatchEvent\(new CustomEvent\('orwell:gamechanged'\)\)", js
    )
    assert len(dispatches) >= 2, (
        "chat.js must dispatch 'orwell:gamechanged' at BOTH run-start and "
        f"run-end so the HUD reconciles immediately (found {len(dispatches)})."
    )


def test_gamechanged_dispatched_at_run_start():
    """Run-start: the dispatch lands where the stream actually begins — right
    after the reader is acquired from the streamed response body."""
    js = _read(CHAT_JS)
    start = re.search(
        r"const reader = res\.body\.getReader\(\);(.*?)const decoder = new TextDecoder\(\);",
        js,
        re.DOTALL,
    )
    assert start, "could not locate the stream-begin (reader acquisition) site."
    assert "dispatchEvent(new CustomEvent('orwell:gamechanged'))" in start.group(1), (
        "chat.js must dispatch 'orwell:gamechanged' at run-start (stream begin)."
    )


def test_gamechanged_dispatched_at_run_end():
    """Run-end: the dispatch lands in the streaming function's finally block (the
    canonical finalize path — alongside clearResponseTimeout())."""
    js = _read(CHAT_JS)
    end = re.search(
        r"\} finally \{\s*clearResponseTimeout\(\);(.*?)P1 \(OOBE cutover\)",
        js,
        re.DOTALL,
    )
    assert end, "could not locate the streaming function's finally/finalize block."
    assert "dispatchEvent(new CustomEvent('orwell:gamechanged'))" in end.group(1), (
        "chat.js must dispatch 'orwell:gamechanged' at run-end/finalize."
    )


def test_gamechanged_dispatch_adds_no_new_polling():
    """The F4 trigger side adds NO new polling — it only dispatches the existing
    event. Each dispatch must be a bare call, never wrapped in a setInterval that
    would re-introduce a status-poll timer next to the dispatch."""
    js = _read(CHAT_JS)
    for ctx in re.findall(r".{0,160}orwell:gamechanged.{0,40}", js):
        assert "setInterval" not in ctx, (
            "the gamechanged dispatch must not introduce a new polling interval."
        )


def test_stall_watchdog_remains_disabled():
    """F6 guard: the manual stall-watchdog banner must stay deliberately disabled
    (server-side stall detection supersedes it). _startStallWatchdog must not arm a
    polling interval."""
    js = _read(CHAT_JS)
    fn = re.search(r"function _startStallWatchdog\(\)\s*\{(.*?)\n  \}", js, re.DOTALL)
    assert fn, "could not locate _startStallWatchdog()."
    assert "setInterval" not in fn.group(1), (
        "the stall watchdog must stay disabled — it must not arm a setInterval "
        "(the manual banner was ruled redundant/annoying; server-side handles it)."
    )
