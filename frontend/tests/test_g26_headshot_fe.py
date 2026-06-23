"""Lane G26 (front-end half) — the casting headshot control source pins.

The runtime behaviour is exercised by the BE route tests + the boot/browser smokes; these
are the suite's JS/HTML-as-text pins that keep the control wired to the right seams and
keep it OPTIONAL, PRE-GAME, and Vault-safe.
"""

import os
import re

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
    """It may only touch /api/orwell/state (started? + casting status), its own /portrait/* (intake +
    studio), /avatar, and /casting/photo (record the player's own photo-step) — never a roster,
    status, or any surface that could carry game content."""
    js = _read("static/js/orwellHeadshot.js")
    import re
    endpoints = set(re.findall(r'/api/orwell/[a-z/\-]+', js))
    allowed = {
        "/api/orwell/state", "/api/orwell/avatar",
        # OOBE re-sequence: record the player's own cast-photo step (uploaded/skipped). Vault-safe —
        # it carries only the player's own photo-step status, never game content.
        "/api/orwell/casting/photo",
        "/api/orwell/portrait/intake",
        "/api/orwell/portrait/studio/generate",
        "/api/orwell/portrait/studio/finalize",
        "/api/orwell/portrait/studio/candidate/",  # G32 restore the picker on refresh
        "/api/orwell/portrait/library",          # G30 list / select
        "/api/orwell/portrait/library/select",
        "/api/orwell/portrait/library/",         # DELETE base (id appended)
    }
    assert endpoints <= allowed, endpoints


def test_studio_shows_the_cached_headshot_library():
    js = _read("static/js/orwellHeadshot.js")
    # the cached options strip + select/delete seams (G30)
    assert "/api/orwell/portrait/library" in js
    assert "/api/orwell/portrait/library/select" in js
    assert "Your headshots" in js                 # the cached-options strip
    assert "selectFromLibrary" in js and "deleteFromLibrary" in js


def test_avatar_module_paints_the_circle_from_the_finalized_headshot():
    html = _read("static/index.html")
    assert "/static/js/orwellAvatar.js" in html
    js = _read("static/js/orwellAvatar.js")
    assert "/api/orwell/avatar" in js
    assert "user-bar-avatar" in js and "settings-account-avatar" in js   # both circles
    assert "orwell:avatarchanged" in js                                  # live update seam


def test_j3_15_thumbnails_have_a_token_skeleton_and_broken_fallback():
    """J3-15: a casting thumbnail that is still loading / fails reads as a skeleton, not a
    broken-image glyph — token-driven (--panel/--border) and reduced-motion guarded."""
    js = _read("static/js/orwellHeadshot.js")
    # the skeleton + broken states + a real keyframe driven by the img's load result
    assert "hs-loading" in js and "hs-broken" in js
    assert "@keyframes hsSkeleton" in js
    assert "function wireThumbStates" in js
    # both the candidate grid and the saved-headshots strip mount the loading state and are wired
    assert "hs-cand hs-loading" in js
    assert "hs-libitem hs-loading" in js
    # token-driven (no hard-coded shimmer hex), and reduced-motion freezes the sweep
    assert "var(--panel" in js and "var(--border" in js
    m = re.search(r"prefers-reduced-motion: reduce.*?hs-loading.*?animation: none", js, re.S)
    assert m, "the J3-15 skeleton sweep must be disabled under prefers-reduced-motion"
