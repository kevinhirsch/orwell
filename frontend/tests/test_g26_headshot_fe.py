"""Lane G26 (front-end half) — the casting headshot control source pins.

The runtime behaviour is exercised by the BE route tests + the boot/browser smokes; these
are the suite's JS/HTML-as-text pins that keep the control wired to the right seams and
keep it OPTIONAL, PRE-GAME, and Vault-safe.
"""

import os

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(rel):
    with open(os.path.join(FRONTEND, rel), encoding="utf-8") as f:
        return f.read()


def test_module_is_included_after_the_cast_panel():
    html = _read("static/index.html")
    assert "/static/js/orwellHeadshot.js" in html


def test_control_posts_the_two_modes_to_the_intake_route():
    js = _read("static/js/orwellHeadshot.js")
    # the upload + clear seams
    assert '"/api/orwell/portrait/intake"' in js
    assert "FormData" in js and 'fd.append("file"' in js and 'fd.append("mode"' in js
    assert 'method: "DELETE"' in js
    # both modes exist, reference is the default (still-AI, likeness-keeping)
    assert 'value="reference" checked' in js
    assert 'value="exact"' in js


def test_control_is_pre_game_and_game_build_only():
    js = _read("static/js/orwellHeadshot.js")
    assert "data-game-build" in js                      # only the game build
    assert "st.started === false" in js                 # only pre-game casting
    assert 'orwell:gamechanged' in js                   # re-evaluated on season start/reset


def test_control_is_vault_safe_reads_only_state_and_its_own_intake():
    """It may only touch /api/orwell/state (started?) and its own /portrait/intake — never a
    roster, status, or any surface that could carry game content."""
    js = _read("static/js/orwellHeadshot.js")
    import re
    endpoints = set(re.findall(r'/api/orwell/[a-z/\-{}]+', js))
    assert endpoints <= {"/api/orwell/state", "/api/orwell/portrait/intake"}, endpoints
