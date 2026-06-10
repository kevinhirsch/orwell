"""Queue C24 (slice) — HUD resilience (U5) + social-surface texture (U6/U7).

Static source contract (the HUDs are pure JS), like the other HUD tests:
  U5 — a transient engine hiccup keeps the last-known panel up (offline dot), instead of
       vanishing the player's only readout; only a genuine "no game" hides it.
  U6 — acting on an approach frames the NPC as the one who came over (they initiated via
       socialInitiatives), not the player pulling them aside; and it's varied.
  U7 — a few houseguests may want the player at once, not exactly one.
"""

import os

STATIC = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "static", "js")


def _read(name):
    with open(os.path.join(STATIC, name), encoding="utf-8") as f:
        return f.read()


# --- U5: resilience -------------------------------------------------------------------

def test_status_panel_keeps_last_known_on_engine_hiccup():
    src = _read("orwellStatusPanel.js")
    # an offline indicator exists and a "_shown" guard distinguishes hiccup from no-game
    assert 'id="os-stale"' in src and "markStale(" in src
    assert "_shown" in src
    ref = src[src.index("async function refresh()"): src.index("async function refresh()") + 800]
    assert "if (_shown) markStale(true)" in ref          # hiccup → keep + flag
    assert "else hidePanel()" in ref                      # never shown → nothing to keep


def test_status_panel_hides_only_on_genuine_no_game():
    src = _read("orwellStatusPanel.js")
    # the no-game branch (week < 1) clears _shown and the stale dot, then hides
    body = src[src.index("function render(st)"): src.index("function render(st)") + 600]
    assert "_shown = false" in body and "hidePanel()" in body
    assert "_shown = true" in body                        # a real game marks shown


def test_social_panel_keeps_panel_on_hiccup_but_hides_on_no_game():
    src = _read("orwellSocial.js")
    ref = src[src.index("async function refresh()"): src.index("async function refresh()") + 900]
    assert "if (!_shown) hidePanel()" in ref              # hiccup: keep a shown panel
    assert "_shown = false" in ref and "genuinely no game" in ref
    # a transient initiatives error must not blank existing chips
    assert "renderApproaches([])" not in ref


# --- U6/U7: social texture ------------------------------------------------------------

def test_approach_frames_the_npc_as_initiator_and_varies():
    src = _read("orwellSocial.js")
    assert "_APPROACH_LINES" in src
    block = src[src.index("_APPROACH_LINES"): src.index("_APPROACH_LINES") + 500]
    # the NPC comes to the player — not "I pull <name> aside"
    assert "I pull ${name} aside" not in src
    assert block.count("=>") >= 3                          # several varied templates
    assert "catches my eye" in block or "sidles up" in block


def test_a_few_approaches_can_show_at_once():
    src = _read("orwellSocial.js")
    assert "MAX_APPROACHES = 3" in src
    assert "one person pulls you aside at a time" not in src   # the stale single-approach note is gone
