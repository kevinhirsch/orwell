"""J4/F5 holding cards — the no-trap contract (SOURCE-PINS).

A real operator was deadlocked on a fresh install: the J4 "Production needs a
feed source" card told the admin to open Settings while `inert`-ing the entire
page behind it — Settings, the composer (`/setup`), everything — with no
dismiss control and no focusable element. The only exit was the 5s re-probe
noticing a configured model, which required the unreachable Settings.

These are wiring pins, NOT behavior coverage: the behavior (Escape dismisses,
the dismiss button dismisses, dismissal leaves zero inert residue, the card
carries `[data-ob-dismiss]`) is exercised for real in
`frontend/scripts/browser_smoke.py` (the headless-browser keep-set gate).
"""
import os

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*parts):
    with open(os.path.join(FRONTEND, *parts), encoding="utf-8") as f:
        return f.read()


def test_sourcepin_holding_card_carries_an_explicit_way_out():
    js = _read("static", "js", "orwellOnboarding.js")
    assert "data-ob-dismiss" in js          # the always-present dismiss button
    assert "Continue anyway" in js          # ...with operator-readable copy
    assert '"Escape"' in js                 # Escape is the keyboard way out


def test_sourcepin_named_remedy_is_operable_from_the_card():
    # The J4 copy names Settings; an inert page means the card itself must carry the
    # button that goes there (admins), wired to the workspace's real settings triggers.
    js = _read("static", "js", "orwellOnboarding.js")
    assert "Open Settings" in js
    assert "rail-settings" in js
    assert "user-bar-settings" in js


def test_sourcepin_dismiss_stops_the_reprobe_and_uninherits():
    # Dismissal must clear the poller (no re-block mid-configuration) and un-inert the
    # page; the action runs AFTER dismiss so its target never opens behind the inert wall.
    js = _read("static", "js", "orwellOnboarding.js")
    assert "clearInterval(timer)" in js
    assert "uninertBackground()" in js


def test_smoke_exercises_the_dismissal_for_real():
    # The smoke must never again force-remove the overlay via JS to proceed — it dismisses
    # like a person (Escape + the button) and asserts zero inert residue.
    smoke = _read("scripts", "browser_smoke.py")
    assert "data-ob-dismiss" in smoke
    assert 'keyboard.press("Escape")' in smoke
    assert "inertLeft" in smoke
    assert "h.remove();" not in smoke       # the old force-remove hack is gone
