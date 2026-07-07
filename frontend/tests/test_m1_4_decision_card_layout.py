"""M1-4 (audit A4) — decision card: one roster, nothing clipped, Confirm reachable.

Source pins for the three layout fixes (the behavioral render check lives in
scripts/browser_smoke.py's M1-4 block, which drives the real component):

  1. the prompt's templated "Still in with you: …" sentence elides ONLY when the structured
     `stillIn` block renders (any non-matching prompt passes through untouched — ADR 0005:
     this is the one known engine template, never general prose rewriting);
  2. the disabled-Confirm hint carries no negative top margin (the audit's half-clipped
     "Make your selection above to enable Confirm." at the card's bottom edge);
  3. on small viewports the PROSE region scrolls internally so the option chips + Confirm
     row never leave the fold (the m-1 audit shot: Confirm off-screen at 390×844).
"""

import os
import re

JS = open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                       "static", "js", "orwellDecision.js"), encoding="utf-8").read()


def test_prompt_roster_elides_only_with_structured_stillin():
    assert "willRenderStillIn" in JS, "the elide must key on the structured block rendering"
    m = re.search(r"if \(willRenderStillIn\) \{\s*\n\s*promptText = promptText\.replace\(", JS)
    assert m, "the elide is gated on willRenderStillIn (fallback: prompt untouched)"
    assert r"Still in with you:" in JS, "the elide targets the one known engine template"


def test_hint_has_no_negative_margin():
    hint_rule = JS[JS.index(".odec-hint {"): JS.index(".odec-hint {") + 260]
    assert "margin-top: -" not in hint_rule, \
        "the negative top margin half-clipped the hint's descenders (audit A4)"
    assert "margin-top: 0" in hint_rule


def test_small_viewport_prose_scrolls_internally():
    assert re.search(r"@media \(max-width: 480px\), \(max-height: 720px\)", JS), \
        "the prose containment tier must exist"
    tier = JS[JS.index("@media (max-width: 480px), (max-height: 720px)"):]
    tier = tier[: tier.index("}\n") + 400]
    assert ".odec-prompt" in tier and ".odec-stillin" in tier
    assert "overflow-y: auto" in tier and "max-height" in tier, \
        "prose scrolls internally so Confirm stays reachable"


def test_smoke_carries_the_behavioral_gate():
    smoke = open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                              "scripts", "browser_smoke.py"), encoding="utf-8").read()
    assert "promptHasRoster" in smoke and "hintVisible" in smoke, \
        "the real-render M1-4 checks must stay in the browser smoke"
