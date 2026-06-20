"""The final FE batch — A3/A4/A5 + V3 + C18 + the C22 premiere slice (source pins;
the live behaviors are exercised in real Chromium by scripts/browser_smoke.py)."""

import os
import re

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*rel):
    with open(os.path.join(FRONTEND, *rel), encoding="utf-8") as f:
        return f.read()


def test_a3_status_hud_announces_deltas_not_rereads():
    js = _read("static", "js", "orwellStatusPanel.js")
    assert "announceDeltas(" in js and 'id="os-announce"' in js
    # the live region is the dedicated announcer, not the display-toggled root
    assert 'el.setAttribute("aria-live", "polite")' not in js
    body = js[js.index("function announceDeltas"): js.index("function announceDeltas") + 900]
    assert "Head of Household:" in body and "On the block:" in body  # show terms, not enums


def test_v3_no_raw_phase_enum_in_the_hud():
    js = _read("static", "js", "orwellStatusPanel.js")
    assert "PHASE_LABELS" in js
    assert "phaseLabel(st.phase)" in js
    for label in ("Veto ceremony", "Eviction night", "Move-in day"):
        assert label in js, label


def test_a4_no_opacity_dimmed_text_in_huds():
    # explicit AA-checked colors replace the sub-AA opacity dims on TEXT rows
    sp = _read("static", "js", "orwellStatusPanel.js")
    assert "color-mix" in sp
    assert ".os-k { opacity" not in sp and ".os-out { opacity" not in sp


def test_a5_streaming_log_gated_by_aria_busy():
    js = _read("static", "js", "chat.js")
    assert "setAttribute('aria-busy', 'true')" in js
    assert "setAttribute('aria-busy', 'false')" in js


def test_c18_polling_pauses_hidden_and_backs_off():
    for f in ("orwellStatusPanel.js",):
        js = _read("static", "js", f)
        assert "document.hidden" in js, f
        assert "_pollDelay" in js and "Math.pow(2, _failures)" in js, f
        assert "setInterval(refresh" not in js, f


def test_c22_producers_reach_out_first_after_the_image_step():
    # P1 onboarding evolved C22: the houseguest IMAGE is the player's first interaction, and once
    # it's secured the PRODUCERS reach out FIRST — the player never types the opening word. The old
    # "one keypress away" composer pre-prompt is gone; the kickoff auto-sends with the user bubble
    # HIDDEN so the first visible message is the producers'. The premiere then flows from the
    # conversation (the engine's interview prompt rolls the producer straight into the premiere).
    js = _read("static", "js", "orwellOnboarding.js")
    assert "I take my seat for the casting interview." not in js   # the pre-prompt is removed
    seg = js[js.index("window._orwellOpenGameAfterCasting"):]
    seg = seg[: seg.index("\n  };")]
    assert "setHideUserBubble" in seg                              # producers appear to reach out first
    assert "handleChatSubmit" in seg                               # auto-sent (this single cutover)
    assert "_openSent" in seg                                      # fired once
    import os
    repo = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    repo = os.path.dirname(repo)
    with open(os.path.join(repo, "src", "engine", "momentPrompts.ts"), encoding="utf-8") as f:
        prompt = f.read()
    assert "roll straight into the premiere" in prompt
