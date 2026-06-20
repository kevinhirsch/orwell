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
