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
    # a real dismiss control
    assert "opt-dismiss" in js


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
    # the card names the first-week beats in order (the hand-held rhythm)
    for beat in ["Meet the house", "HOH", "Nominations", "Veto", "Eviction"]:
        assert beat in js, f"premiere card should name the {beat!r} beat"
    # it mounts itself on game state, never waits for the player to ask
    assert "orwell:gamechanged" in js
    assert "refresh" in js


def test_l31_css_is_theme_token_driven():
    js = _read("static", "js", "orwellPremiereTutorial.js")
    m = re.search(r"orwell-premiere-tutorial-css.*?textContent\s*=(.*?);\n", js, re.S)
    assert m, "tutorial CSS block not found"
    css = m.group(1)
    assert "var(--fg)" in css
    # no hard-coded hex colors — derive from theme tokens so the house themes stay readable
    assert "#" not in css, "L31 tutorial CSS must be theme-token driven (no hex)"
