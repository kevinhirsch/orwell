"""L31 (FE half) — the premiere is a light, one-time, dismissible tutorial.

The engine drives the structured premiere (introductions round + gentler first-week cadence);
this is the FE framing: a quiet card shown in WEEK 1 that sets the weekly-rhythm expectation so
a brand-new player never has to prompt for it. It never replaces the chat.

Source-pinned (the FE pytest lane has no DOM runtime; browser-smoke covers the live DOM). We pin
the gates (game-build, per-user dismiss, premiere-week), the module load, and the theme-token CSS.
"""
import os
import re

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*rel):
    with open(os.path.join(FRONTEND, *rel), encoding="utf-8") as f:
        return f.read()


def test_l31_module_is_loaded_in_index():
    html = _read("static", "index.html")
    assert "orwellPremiereTutorial.js" in html


def test_l31_is_game_build_gated():
    js = _read("static", "js", "orwellPremiereTutorial.js")
    assert "data-game-build" in js
    # both the mount and the refresh bail out unless the game build is on
    assert js.count("isGameBuild()") >= 2


def test_l31_per_user_dismiss_persists_once():
    js = _read("static", "js", "orwellPremiereTutorial.js")
    # per-user key (E71 pattern) persisted in localStorage; shown once per account
    assert "orwell-premiere-tutorial-dismissed:" in js
    assert "document.body.dataset.user" in js
    assert "localStorage.setItem" in js and "localStorage.getItem" in js
    assert "hasDismissed()" in js
    # #642: the guide composes the OrwellNotice kit — the dismiss control is the kit's corner ×
    # (dismissible:true) wired through onDismiss → the premiere's own (synced) dismiss persistence.
    assert "OrwellNoticeKit.create(" in js, "the guide must compose the OrwellNotice kit (#642)"
    assert "dismissible: true" in js
    assert "onDismiss" in js


def test_l31_shows_only_in_premiere_week():
    js = _read("static", "js", "orwellPremiereTutorial.js")
    m = re.search(r"function isPremiereWeek\([^)]*\)\s*\{(.*?)\n  \}", js, re.S)
    assert m, "isPremiereWeek gate not found"
    body = m.group(1)
    # week 1 only, and never post-season; requires a started season
    assert "week === 1" in body
    assert '"post-season"' in body
    assert "started" in body
    # it reads the same Vault-free projections the season HUD uses
    assert "/api/orwell/status" in js and "/api/orwell/state" in js


def test_l31_walks_the_weekly_rhythm_without_prompting():
    js = _read("static", "js", "orwellPremiereTutorial.js")
    # J3-09 (UX audit): "Meet the house" is a prerequisite, not a phase in the weekly loop.
    # The tutorial copy now names the gate ("all fifteen houseguests") and then the four phases.
    assert "fifteen houseguests" in js, "tutorial must state the 15-houseguest gate condition"
    for beat in ["HOH", "Nominations", "Veto", "Eviction"]:
        assert beat in js, f"premiere card should name the {beat!r} beat"
    # it mounts itself on game state, never waits for the player to ask
    assert "orwell:gamechanged" in js
    assert "refresh" in js


def test_l31_css_is_theme_token_driven():
    js = _read("static", "js", "orwellPremiereTutorial.js")
    m = re.search(r"orwell-premiere-tutorial-css.*?textContent\s*=(.*?);\n", js, re.S)
    assert m, "tutorial CSS block not found"
    css = m.group(1)
    # #642: the card SHELL moved to the kit (.on-card.on-guide); only the premiere-specific inner
    # rules (the rhythm line + the CTA row) remain — still theme-token driven (the CTA uses
    # var(--accent)/var(--fg) mixes), and still no hard-coded hex.
    assert "var(--fg)" in css or "var(--accent" in css
    assert "#" not in css, "L31 tutorial CSS must be theme-token driven (no hex)"


def test_j2_13_offers_an_action_affordance():
    """J2-13: the tutorial must give a way to DO the first move, not only name the rhythm."""
    js = _read("static", "js", "orwellPremiereTutorial.js")
    # a CTA control + the seam that fills the composer and focuses it (the player still authors).
    assert "opt-go" in js, "premiere tutorial should carry a 'first move' CTA"
    assert "function firstMove" in js
    # it seeds the live composer (#message) and never auto-sends — ADR 0003 keeps the player author.
    assert 'getElementById("message")' in js
    assert ".focus()" in js
    # never clobber an in-progress draft
    assert "input.value.trim()" in js


def test_j2_10_entrance_staging_is_reduced_motion_guarded():
    """J2-10 / J1-20: the premiere card stages its arrival, and reduced-motion strips it.

    #642: the entrance staging (rise+fade) + its reduced-motion guard moved into the OrwellNotice
    kit (.on-card.on-anim-in, stripped under prefers-reduced-motion). The guide composes the kit,
    so the staging it inherits is reduced-motion-safe by construction — assert it on the kit."""
    js = _read("static", "js", "orwellPremiereTutorial.js")
    assert "OrwellNoticeKit.create(" in js, "the guide composes the kit (which owns the entrance)"
    kit = _read("static", "js", "orwellNotice.js")
    assert "on-anim-in" in kit, "the kit owns the mount entrance staging"
    assert "@keyframes on-in" in kit, "entrance keyframes missing in the kit"
    m = re.search(r"prefers-reduced-motion: reduce.*?animation: none.*?\}", kit, re.S)
    assert m, "the kit's reduced-motion media block must strip the entrance animation"
    assert "on-anim-in" in m.group(0), \
        "the kit entrance must be named in the prefers-reduced-motion block"


def test_j2_18_controls_meet_the_tap_floor():
    """J2-18 / WCAG 2.5.5: the premiere card's controls clear the 44px coarse-pointer floor.

    #642: the dismiss control is now the OrwellNotice kit's corner × (44px in the kit + style.css);
    the premiere keeps its own "Meet the house" CTA (>=44px). So the floor holds across both: the
    CTA in the premiere module, the dismiss in the kit."""
    js = _read("static", "js", "orwellPremiereTutorial.js")
    assert "min-height: 36px" not in js, "premiere control still below the 44px tap floor"
    assert "min-height: 44px" in js, "the premiere CTA should be >= 44px"
    kit = _read("static", "js", "orwellNotice.js")
    assert "min-width: 44px" in kit and "min-height: 44px" in kit, "the kit dismiss is >= 44px"
