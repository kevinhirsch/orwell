"""Pre-launch E2E audit — the two launch-blockers (source-pinned).

CI can't drive the live, non-deterministic stack here, so we pin the WIRING that
closes each blocker by reading the static JS. See
`docs/audits/2026-06-19-e2e-smoke-test-audit.md` (S6-2, S4-1).

S6-2 — the floating "top-left" slot (the cast window mounts there) was pinned at a
bare 14px left margin, landing ON TOP of the persistent left sidebar (#sidebar) and
covering its controls (New Chat / Search / sort). Fix: left-anchored slots inset
past the sidebar's LIVE right edge.

S4-1 — a pending player decision was only reachable via the chat agent's tool result
(`orwell:pending`) or a reload; if the model narrated past it (or another device
advanced) with no `orwell:gamechanged` in this tab, the card was unreachable. Fix: a
slow periodic status poll surfaces the engine's own `pending` as a backstop. It must
be dismissal-aware — surfacing only when the player hasn't dismissed and no card is
already up — so it never re-nags a waved-away card.

F-S4-C — a pre-stream non-200 (gateway/proxy 502, 4xx, 409) on /api/chat_stream was
typewritten straight into the already-mounted GM bubble (`msg msg-ai` + a `.role`
"Big Brother" label), so a raw "Error 502 / upstream model error" read as in-game
narration — an immersion break. Fix: on the error path, reclassify the idle holder to
the quiet out-of-character `.msg-system` style AND drop its `.role` label (rebuild the
body), then frame a generic connection failure instead of the raw upstream string.
"""
import os
import re

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JS = os.path.join(FRONTEND, "static", "js")


def _read(name):
    with open(os.path.join(JS, name), encoding="utf-8") as fh:
        return fh.read()


# ── S6-2: left-anchored slots clear the sidebar ──────────────────────────────

def test_left_slot_anchor_is_sidebar_aware_not_bare_14():
    js = _read("orwellSlots.js")
    m = re.search(r"name\.endsWith\(\"left\"\)\s*\?\s*([^\n:]+)", js)
    assert m, "could not locate the left-slot baseLeft branch in orwellSlots.js"
    branch = m.group(1).strip()
    assert "leftBase()" in branch, (
        f"left-anchored slots must inset via leftBase(), not a bare margin — found `{branch}`."
    )


def test_leftBase_reads_the_live_sidebar_geometry():
    js = _read("orwellSlots.js")
    m = re.search(r"function leftBase\(\)\s*\{(.*?)\n  \}", js, re.DOTALL)
    assert m, "orwellSlots.js must define leftBase()."
    body = m.group(1)
    assert 'getElementById("sidebar")' in body, "leftBase must read the live #sidebar element."
    assert "getBoundingClientRect" in body, (
        "leftBase must measure the sidebar's live geometry (resized/collapsed rail), not a constant."
    )
    assert "return 14" in body, "leftBase must fall back to the 14px margin when there's no docked rail."


# ── S4-1: the decision card is reachable from the polled status ───────────────

def _s4_poll_body(js):
    # The S4-1 escape-hatch poll: a setInterval whose body fetches the status and can
    # dispatch orwell:pending. Grab the interval body for assertions.
    m = re.search(r"setInterval\(async \(\)\s*=>\s*\{(.*?)\}, \d+\);", js, re.DOTALL)
    return m.group(1) if m else None


def test_decision_card_has_a_periodic_status_backstop():
    js = _read("orwellDecision.js")
    body = _s4_poll_body(js)
    assert body is not None, (
        "orwellDecision.js must poll the status on an interval so a pending decision is reachable "
        "WITHOUT the chat agent (the S4-1 escape hatch)."
    )
    assert "/api/orwell/status" in body, "the backstop must read the engine's own pending from status."
    assert "orwell:pending" in body, "the backstop must dispatch orwell:pending to arm the card."


def test_backstop_is_dismissal_aware_and_does_not_renag():
    """The poll must NOT re-nag a dismissed card: it bails when the player has dismissed
    (_userDismissed) and when a card is already shown (CARD_ID), and it must NOT call
    rearmFromStatus (which clears _userDismissed and would defeat the guard)."""
    js = _read("orwellDecision.js")
    body = _s4_poll_body(js)
    assert body is not None
    assert "_userDismissed" in body, "the poll must respect an explicit dismissal (_userDismissed)."
    assert "CARD_ID" in body, "the poll must not re-arm when a card is already showing."
    assert "rearmFromStatus" not in body, (
        "the poll must NOT call rearmFromStatus (it resets _userDismissed → would re-nag); it arms "
        "directly only when not dismissed and no card is up."
    )


# ── F-S4-C: a stream/connection error is a SYSTEM notice, not GM narration ────

def _chat_error_path(js):
    """The `if (!res.ok) { … }` block in the chat-stream sender — the pre-stream
    non-200 handler that renders the failure into the mounted holder."""
    i = js.find("if (!res.ok) {")
    assert i != -1, "could not locate the `if (!res.ok)` error path in chat.js"
    # Grab a generous window: the handler returns within ~50 lines (the F-S4-C comment is long).
    return js[i:i + 3400]


def test_stream_error_reclassifies_holder_to_system_not_gm_bubble():
    js = _read("chat.js")
    body = _chat_error_path(js)
    assert "holder.className = 'msg msg-system'" in body, (
        "a pre-stream non-200 must reclassify the GM holder to the quiet `.msg-system` style "
        "so it doesn't read as in-game narration (F-S4-C)."
    )
    # The role label ("Big Brother") must be dropped — a system notice has no houseguest author.
    assert 'holder.innerHTML = \'<div class="body"></div>\'' in body, (
        "the error path must rebuild the holder body (dropping the `.role` GM label) so nothing "
        "attributes the connection failure to a houseguest."
    )


def test_stream_error_frames_generic_failure_not_raw_upstream():
    js = _read("chat.js")
    body = _chat_error_path(js)
    assert "your message didn't go through" in body, (
        "the error path must frame a generic, actionable connection failure rather than typing the "
        "raw upstream `Error 502 / upstream model error` string into the chat (F-S4-C)."
    )
    # The helpful tool-mode-switch copy is preserved (not clobbered by the generic reframe).
    assert "/Chat mode/i.test(errText)" in body, (
        "the generic reframe must NOT overwrite the tool-mode-switch guidance (it matches /Chat mode/i)."
    )
