"""Wayfinding cluster — J3-07 / J3-08 / J3-13 (UX Phase-4 polish, issue #606).

"Where am I / where can I go / how do I get back" — the premiere-gate legibility lenses:

  • J3-07  no persistent game-phase / current-objective indicator in the chrome.
  • J3-08  no visible premiere progress counter ("X of 15 met"); the meet-all-15 unlock has no
           independent tracker, so a stalled HOH looks like a bug.
  • J3-13  premiere redirects INCONSISTENTLY named the remaining-HG count, so a ceremony-bound
           player got "not yet" with no action plan.

J3-07/08 are FE chrome: the status panel (orwellStatusPanel.js) now surfaces the engine's
Vault-free `premiere` progress (PremiereIntrosView on getGameState) as the persistent objective +
"X of N met" counter during the premiere. Static source-contract pins (the HUD is pure JS), plus a
Vault-free guard. J3-13 is the framing directive in apply_game_framing — unit-tested on the helper
and pinned to the wiring.
"""

import os

import importlib

STATIC = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "static", "js")


def _panel() -> str:
    with open(os.path.join(STATIC, "orwellStatusPanel.js"), encoding="utf-8") as f:
        return f.read()


def _fn_body(src: str, name: str) -> str:
    """Slice a top-level `function name(...) { ... }` by brace-matching from its signature — the real
    function boundary, not a fixed-width window (which would let moved logic pass while the UI regresses)."""
    start = src.index("function " + name + "(")
    i = src.index("{", start)
    depth = 0
    for j in range(i, len(src)):
        if src[j] == "{":
            depth += 1
        elif src[j] == "}":
            depth -= 1
            if depth == 0:
                return src[start : j + 1]
    raise AssertionError("unterminated function " + name)


# ── J3-07 / J3-08 — the premiere objective + "X of N met" counter in the panel ── #

def test_premiere_progress_is_rendered_from_state():
    src = _panel()
    assert "function renderPremiere(" in src
    # renderRoster (which receives the /state projection) drives it.
    assert "renderPremiere(el, state)" in src
    # The persistent objective element + counter exist in the panel markup.
    assert 'id="os-premiere"' in src
    assert 'id="os-prem-count"' in src


def test_premiere_shows_no_progress_count_or_still_to_meet_checklist():
    # CHAMPAGNE CIRCLE (feature 0111, owner ruling 2026-07-14): the whole house is met at the toast, so
    # the premiere gadget is now a pure cast ROSTER — NO "X of 15 met" counter and NO "still to meet"
    # checklist. Pin that the removed tracker copy is gone from the renderer.
    src = _panel()
    body = _fn_body(src, "renderPremiere")
    assert "met + \" of \" + total + \" met\"" not in body, "the X-of-15 counter must be gone"
    assert "Still to meet:" not in body, "the still-to-meet checklist must be gone"
    # the count/left elements are emptied/hidden, not populated (they stay in the DOM but carry no tracker)
    assert 'countEl.textContent = ""' in body
    assert "leftEl.hidden = true" in body


def test_premiere_progress_shown_throughout_the_premiere_not_gated_on_complete():
    # The roster shows while the engine's `premiere` projection is PRESENT (the premiere moment), regardless
    # of `complete` (everyone is met at the toast, so complete is always true during the premiere). It hides
    # the instant the first HOH begins (the engine drops the `premiere` field ⇒ the `!prem` guard fires).
    src = _panel()
    body = _fn_body(src, "renderPremiere")
    assert "prem.complete" not in body, "the premiere block must NOT gate on complete anymore"
    assert "!prem || typeof prem !== \"object\"" in body
    assert "wrap.hidden = true" in body


def test_premiere_renders_the_cast_roster_strip():
    # The premiere gadget's only content is now the sixteen-tile cast roster strip (color, not a tracker).
    src = _panel()
    body = _fn_body(src, "renderPremiere")
    assert "renderPremiereStrip(el, state)" in body
    assert 'id="os-prem-left"' in src  # the (now-hidden) element still exists in the markup


def test_premiere_progress_is_vault_free():
    # Public facets only: the render touches premiere counts + houseguest NAMES, never a hidden stat,
    # soul, or relationship field.
    src = _panel()
    body = _fn_body(src, "renderPremiere")
    import re
    accessed = set(re.findall(r"\.(\w+)", body))
    leaky = {"trust", "affinity", "threat", "stats", "physical", "mental", "social",
             "soul", "emotional", "confidence"}
    assert not (accessed & leaky), f"premiere render reads hidden fields: {accessed & leaky}"


# ── J3-13 — the premiere redirect ALWAYS names the gap (framing directive) ── #

chat_helpers = importlib.import_module("routes.chat_helpers")


def test_premiere_directive_none_outside_premiere():
    # No premiere field / non-dict ⇒ no directive (the turn is framed exactly as before).
    assert chat_helpers._premiere_progress_directive(None) is None
    assert chat_helpers._premiere_progress_directive("nope") is None
    assert chat_helpers._premiere_progress_directive({}) is None


def test_premiere_directive_none_when_complete():
    prem = {"complete": True, "metCount": 16, "total": 16, "remaining": []}
    assert chat_helpers._premiere_progress_directive(prem) is None


def test_premiere_directive_none_when_power_reachable():
    # #1387 / 0111: once first power is REACHABLE (a couple of hot reads + nobody invisible), the
    # directive must STOP stonewalling a ready player — even though not all 15 are formally met.
    prem = {
        "complete": False,
        "powerReachable": True,
        "metCount": 6,           # player + 5 NPCs met so far
        "total": 16,
        "hotReads": 3,
        "remaining": [{"houseguest": {"id": "npc:9", "name": "Rowan"}}],
    }
    assert chat_helpers._premiere_progress_directive(prem) is None


def test_premiere_directive_names_count_and_remaining():
    prem = {
        "complete": False,
        "powerReachable": False,  # power not reachable yet ⇒ the warm redirect fires
        "metCount": 12,          # player + 11 NPCs met
        "total": 16,             # player + 15 NPCs
        "hotReads": 1,
        "remaining": [
            {"houseguest": {"id": "npc:1", "name": "Avery"}},
            {"houseguest": {"id": "npc:2", "name": "Elliot"}},
        ],
    }
    out = chat_helpers._premiere_progress_directive(prem)
    assert out and isinstance(out, str)
    # NPC-only figures: met 11 of 15, 4 still to meet in motion.
    assert "11 of 15" in out
    assert "4 still to meet" in out
    # It names WHO is left (the audit's missing consistency).
    assert "Avery" in out and "Elliot" in out
    low = out.lower()
    assert "hoh" in low
    # #1387: the redirect is now the ASYMMETRIC gate — never an all-15 stonewall.
    assert "do not need every one of the 15" in low
    assert "hard-gate" in low


def test_premiere_directive_handles_missing_names():
    # No remaining names ⇒ still a valid directive carrying the count.
    prem = {"complete": False, "metCount": 2, "total": 16, "remaining": []}
    out = chat_helpers._premiere_progress_directive(prem)
    assert out and "1 of 15" in out


def test_premiere_directive_bad_counts_fail_safe():
    # Non-numeric counts must not raise.
    assert chat_helpers._premiere_progress_directive({"complete": False, "metCount": "x", "total": 16}) is None


def test_framing_appends_the_premiere_directive_fail_open():
    src = open(
        os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                     "routes", "chat_helpers.py"),
        encoding="utf-8",
    ).read()
    # apply_game_framing calls the helper and appends it to gm_prompt, wrapped fail-open.
    assert "_premiere_progress_directive(game_state.get(\"premiere\"))" in src
    call = src.index("_prem = _premiere_progress_directive(")
    assert "gm_prompt = gm_prompt + " in src[call:call + 300]
    assert "except Exception" in src[call:call + 600]
    assert "premiere progress framing skipped" in src
