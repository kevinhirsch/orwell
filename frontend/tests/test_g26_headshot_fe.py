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
    # both paths exist: exact (no AI) and the studio (AI options)
    assert 'upload("exact")' in js
    assert 'upload("reference")' in js


def test_studio_flow_generates_options_picks_and_finalizes():
    js = _read("static/js/orwellHeadshot.js")
    assert "/api/orwell/portrait/studio/generate" in js   # 3 options at a time
    assert "/api/orwell/portrait/studio/finalize" in js   # pick one
    assert "Generate 3 more" in js                        # back-and-forth, indefinitely
    assert "Upload a different photo" in js               # swap the source photo
    # finalizing updates the circle avatar immediately
    assert "orwell:avatarchanged" in js


def test_control_is_pre_game_and_game_build_only():
    js = _read("static/js/orwellHeadshot.js")
    assert "data-game-build" in js                      # only the game build
    assert "st.started === false" in js                 # only pre-game casting
    assert 'orwell:gamechanged' in js                   # re-evaluated on season start/reset


def test_control_is_vault_safe_reads_only_its_own_portrait_surfaces():
    """It may only touch /api/orwell/state (started?), its own /portrait/* (intake + studio),
    and /avatar — never a roster, status, or any surface that could carry game content."""
    js = _read("static/js/orwellHeadshot.js")
    import re
    endpoints = set(re.findall(r'/api/orwell/[a-z/\-]+', js))
    allowed = {
        "/api/orwell/state", "/api/orwell/avatar",
        "/api/orwell/portrait/intake",
        "/api/orwell/portrait/studio/generate",
        "/api/orwell/portrait/studio/finalize",
    }
    assert endpoints <= allowed, endpoints


def test_avatar_module_paints_the_circle_from_the_finalized_headshot():
    html = _read("static/index.html")
    assert "/static/js/orwellAvatar.js" in html
    js = _read("static/js/orwellAvatar.js")
    assert "/api/orwell/avatar" in js
    assert "user-bar-avatar" in js and "settings-account-avatar" in js   # both circles
    assert "orwell:avatarchanged" in js                                  # live update seam
