"""Pre-launch E2E audit — the two launch-blockers (source-pinned).

CI can't drive the live, non-deterministic stack here, so we pin the WIRING that
closes each blocker by reading the static JS. See
`docs/audits/2026-06-19-e2e-smoke-test-audit.md` (S6-2, S4-1).

S6-2 — the floating "top-left" slot (the cast window mounts there) was pinned at a
bare 14px left margin, landing ON TOP of the persistent left sidebar (#sidebar) and
covering its controls (New Chat / Search / sort). Fix: left-anchored slots inset
past the sidebar's LIVE right edge.

S4-1 — a pending player decision was only reachable via the chat agent's tool
result (`orwell:pending`) or a reload; if the model narrated past it (or another
device advanced) with no `orwell:gamechanged` in this tab, the card was unreachable.
Fix: a slow periodic `rearmFromStatus` poll surfaces the engine's own `pending` as a
backstop — fail-open and dismissal-aware, so it never re-nags a waved-away card.
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
    # The left-slot branch must call leftBase(), not pin the literal 14.
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

def test_decision_card_has_a_periodic_status_backstop():
    js = _read("orwellDecision.js")
    assert re.search(r"setInterval\(\s*rearmFromStatus\s*,", js), (
        "orwellDecision.js must poll rearmFromStatus on an interval so a pending decision is "
        "reachable WITHOUT the chat agent (the S4-1 escape hatch)."
    )


def test_rearm_is_reentrancy_guarded():
    js = _read("orwellDecision.js")
    assert "_rearmRunning" in js, (
        "rearmFromStatus must guard against re-entrancy (boot + gamechanged + the poll can all "
        "call it) so the re-assert loop doesn't stack."
    )


def test_periodic_rearm_routes_through_the_dismissal_guard():
    """The backstop must reuse rearmFromStatus (which honors _dismissedSig) rather than
    dispatch `orwell:pending` directly from a poller — the orwell:pending listener renders
    without the dismissal guard, so a direct dispatch would re-nag a dismissed card."""
    js = _read("orwellDecision.js")
    # rearmFromStatus consults the dismissed signature before re-arming.
    assert "_dismissedSig" in js and re.search(r"_sig\(pending\)\s*===\s*_dismissedSig", js), (
        "rearmFromStatus must short-circuit when the live pending matches the dismissed signature."
    )
