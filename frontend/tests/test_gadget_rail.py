"""0054 — the control-room gadget rail. Source-pins for the structure + wiring; the live
behaviour (mount, collapse, side-swap, mobile drawer) is exercised in the play-through harness.
"""
import os

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*rel):
    with open(os.path.join(FRONTEND, *rel), encoding="utf-8") as f:
        return f.read()


def test_rail_markup_and_controls_present():
    html = _read("static", "index.html")
    assert 'id="gadget-rail"' in html
    assert 'id="gadget-rail-body"' in html
    assert 'id="gadget-rail-toggle"' in html      # collapse
    assert 'id="gadget-rail-swap"' in html        # side-swap
    assert 'id="gadget-rail-open"' in html        # mobile drawer opener
    assert 'id="gadget-rail-strip"' in html       # collapsed icon strip
    assert 'src="/static/js/orwellGadgetRail.js"' in html


def test_rail_is_game_build_gated_and_responsive():
    css = _read("static", "style.css")
    # hidden in the full inherited workspace
    assert "body:not([data-game-build]) #gadget-rail" in css
    # collapse + side-swap + mobile drawer
    assert '.gadget-rail[data-collapsed="true"]' in css
    assert 'body[data-gadget-side="left"] #gadget-rail' in css
    assert "@media (max-width: 768px)" in css and ".gadget-rail.grail-open" in css
    # canonical gadget stacking
    assert ".gadget-rail-body > #orwell-status { order: 1; }" in css


def test_controller_persists_state_and_gates_on_active_game():
    js = _read("static", "js", "orwellGadgetRail.js")
    assert "data-game-build" in js                 # never in the full workspace
    assert "orwell-gadget-rail-collapsed" in js     # persisted collapse
    assert "orwell-gadget-side" in js               # persisted side
    assert "/api/orwell/status" in js               # show only while a season is live
    assert "orwell:gamechanged" in js
    # Escape is NOT handled per-surface (flows through ui.js's arbiter — F3 ratchet)
    assert '"Escape"' not in js and "'Escape'" not in js


def test_hud_gadgets_prefer_the_rail():
    # each HUD gadget mounts into the rail when present, with the sidebar as fallback
    for f in ("orwellStatusPanel.js", "orwellSocial.js", "orwellPresence.js"):
        js = _read("static", "js", f)
        assert 'getElementById("gadget-rail-body")' in js, f
        assert 'getElementById("sidebar")' in js, f   # fallback preserved
