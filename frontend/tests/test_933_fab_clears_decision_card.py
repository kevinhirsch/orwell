"""Issue #933 — the jump-to-bottom fab (#orwell-scroll-bottom) overlapped the in-chat decision
card (#orwell-decision-card) at <=360px (overlap true at 360 and 320; clear at 390).

The player must be able to read the decision card to make a binding move, so the card owns the
above-composer bottom region. The fix (the #948 mutual-exclusion, hardened here for #933): while a
decision card is mounted AND visible, the fab is hard-suppressed — they share the slot and must
never coexist. The responsive-matrix D2 overlap invariant is extended to register the fab so a
regression that lets the two paint together is caught.

Source-pinned regression guards (the behavioral suppression itself is exercised by
test_887_single_scroll_bottom.py's #948 scenarios; these pin the #933 contract + the matrix wiring).
"""
import os
import re

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*parts):
    with open(os.path.join(FRONTEND, *parts), encoding="utf-8") as f:
        return f.read()


OSB = _read("static", "js", "orwellScrollBottom.js")
MATRIX = _read("scripts", "responsive_matrix.py")


def test_fab_is_suppressed_when_decision_card_visible():
    # The fab's hide-condition must include a visible-decision-card check so a mounted card wins
    # over scroll position (the card owns the bottom region — #933).
    assert "function decisionCardVisible" in OSB
    assert "orwell-decision-card" in OSB, (
        "#933: suppression must key on the real decision-card id (#orwell-decision-card)."
    )
    hide_cond = re.search(r"if \(nearBottom\(box\).*?\)\s*\{", OSB, flags=re.S)
    assert hide_cond, "could not find the fab hide-condition in update()"
    assert "decisionCardVisible()" in hide_cond.group(0), (
        "#933: the fab hide-condition must include decisionCardVisible() (card wins over scroll pos)."
    )


def test_fab_rechecks_on_card_mount_unmount():
    # The card mounts/unmounts OUTSIDE #chat-history, so a body-subtree observer (or the
    # orwell:pending event) must re-run the suppression decision when a card appears/disappears.
    assert "function watchDecisionCard" in OSB
    assert "document.body" in OSB and "subtree: true" in OSB
    assert ("addEventListener(\"orwell:pending\"" in OSB
            or "addEventListener('orwell:pending'" in OSB)
    assert "watchDecisionCard()" in OSB, "watchDecisionCard must be wired in start()."


def test_responsive_matrix_d2_registers_the_fab_against_the_card():
    # The D2 overlap sweep (GAME_SURFACES) must include both the decision card and the fab so the
    # matrix would FAIL if they ever paint together at a narrow viewport.
    # The list spans multiple lines and contains inner `[...]` selectors, so capture from
    # `GAME_SURFACES = [` up to the `CHROME =` assignment that follows it.
    surfaces = re.search(r"GAME_SURFACES\s*=\s*\[(.*?)\n\s*CHROME\s*=", MATRIX, re.S)
    assert surfaces, "GAME_SURFACES list not found in responsive_matrix.py"
    body = surfaces.group(1)
    assert "#orwell-decision-card" in body, "#933: the decision card must be a registered surface."
    assert "#orwell-scroll-bottom" in body, (
        "#933: the jump-to-bottom fab must be registered in the D2 overlap sweep so a card/fab "
        "overlap regression is caught."
    )
