"""#709 — the onboarding modal(s) rebuilt on the OrwellWindow KIT (Liquid Glass).

The owner flagged the onboarding "holding card" overlay (#orwell-onboarding) rendering as a flat,
red-accented, black-on-black, mono-font card that never joined the Liquid Glass kit. The fix RECREATES
all three onboarding modals (holding card, welcome/setup wizard) on the OrwellWindow kit — the same kit
settings.js uses — so they inherit the frosted glass material, the kit SANS font (--ow-ui-font, retiring
the orphaned `font-family: var(--mono)` hard-pin a font audit should have caught), the neutral colorless
chrome, the scrim + inert + focus-trap + aria-modal, and the legible element-kit buttons (.ow-btn).

This is the source-pinned regression guard the font/glass audits missed. It pins:
  • the overlay is built on the window kit (OrwellWindowKit.create), not the bespoke fixed overlay;
  • the orphaned mono hard-pin is GONE (and the kit/element-kit sans is what these surfaces use);
  • NO red / --brand-color accent survives anywhere in the overlay (colorless kit chrome);
  • the CTAs compose the element kit (.ow-btn / -secondary / -prominent);
  • the card gets its glass material from the kit (the .ow-window frosted rule), not a bespoke
    `background: var(--panel)` flat card;
  • every load-bearing OOBE behavior + external seam is preserved.
"""
import os
import re

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*parts):
    with open(os.path.join(FRONTEND, *parts), encoding="utf-8") as f:
        return f.read()


ONB = _read("static", "js", "orwellOnboarding.js")
STYLE = _read("static", "style.css")


# ── 1. Built on the window kit (not the bespoke overlay) ─────────────────────────────────────────

def test_onboarding_is_built_on_the_window_kit():
    # The modals are created via the kit (the same API settings.js uses), with modal:true (scrim +
    # inert + focus-trap + aria-modal + centered placement).
    assert "OrwellWindowKit.create" in ONB
    assert "modal: true" in ONB
    # the kit window carries the stable id every selector + the dedupe guard rely on
    assert 'id: "orwell-onboarding"' in ONB


def test_bespoke_overlay_css_block_is_gone():
    # The hand-rolled fixed-overlay <style> block (the flat --panel card, the red accents) is retired.
    # The old block hard-set `position: fixed; inset: 0; z-index: 99999` on #orwell-onboarding and
    # painted `.ob-card { background: var(--panel) }` — both gone now that the kit owns the chrome.
    assert "z-index: 99999" not in ONB
    assert "background: var(--panel" not in ONB


# ── 2. The orphaned mono font hard-pin is gone ───────────────────────────────────────────────────

def test_no_mono_font_hardpin():
    # The overlay used to hard-set `font-family: var(--mono)` on #orwell-onboarding — an orphaned pin a
    # font audit should have caught. Per the window kit this surface uses the kit SANS (--ow-ui-font),
    # which the .ow-window root applies. No --mono / monospace pin may survive in this module.
    assert "var(--mono" not in ONB
    assert "monospace" not in ONB
    assert "Fira Code" not in ONB
    # the kit window root (style.css) is what supplies the sans family these modals now inherit
    assert "--ow-ui-font" in STYLE


# ── 3. No red / accent hue anywhere in the overlay (colorless kit chrome) ─────────────────────────

def test_no_red_or_brand_accent_in_the_overlay():
    # The Glass theme is COLOR-AGNOSTIC: chrome takes color only from the wallpaper; while a glass tier
    # is active text/chrome carries NO accent hue. The card border, the h1 title, the step-numbers, and
    # the focus rings must all be neutral. The kit chrome is already colorless; this pins that NOTHING
    # reintroduces red in the module's own content CSS or button markup.
    assert "var(--red" not in ONB
    assert "var(--brand-color" not in ONB
    assert "#e06c75" not in ONB
    # the title + step-number are neutral foreground (not an accent gradient / accent fill)
    assert "linear-gradient(135deg, var(--brand-color" not in ONB


def test_step_numbers_and_title_are_neutral_foreground():
    # The .ob-step-n and h1 carry neutral --fg, never an accent — verify the content CSS block.
    assert ".ob-steps .ob-step-n { display: inline-block" in ONB
    seg = ONB[ONB.index(".ob-steps .ob-step-n"):]
    seg = seg[: seg.index("}") + 1]
    assert "var(--fg" in seg and "var(--red" not in seg and "brand" not in seg


# ── 4. The CTAs compose the element kit (legible glass buttons) ───────────────────────────────────

def test_buttons_use_the_element_kit():
    # The primary/secondary CTAs (the F5 holding card's "Open Settings" / dismiss, the #874
    # no-feed notice's "Open Settings") → .ow-btn .ow-btn-prominent / .ow-btn-secondary. The kit
    # owns their legible glass styling + focus ring, so the bespoke black-on-black .ob-btn
    # coloring is gone.
    assert "ow-btn-prominent" in ONB
    assert "ow-btn-secondary" in ONB
    # legacy hooks kept additive so existing JS/tests selecting them keep working
    assert "ob-btn" in ONB and "data-ob-dismiss" in ONB


# ── 5. The card gets its glass material from the kit, under the glass tiers ───────────────────────

def test_kit_window_supplies_the_glass_material_under_frosted():
    # The card is the kit .ow-window; style.css gives EVERY frosted kit window the Liquid Glass
    # material (transparent tint + blur + neutral rim) — so the onboarding card reads as the same glass
    # as the other windows under body.theme-frosted, with a NEUTRAL (--fg-mixed) border, not red.
    assert "body.theme-frosted .ow-window" in STYLE
    seg = STYLE[STYLE.index("body.theme-frosted .ow-window {"):]
    seg = seg[: seg.index("}") + 1]
    assert "backdrop-filter" in seg
    # the frosted window border is neutral (a --fg mix), never an accent hue
    assert "border-color: color-mix(in srgb, var(--fg)" in seg
    assert "--red" not in seg and "brand" not in seg


# ── 6. Load-bearing OOBE behavior + seams preserved through the rebuild ───────────────────────────

def test_holding_card_behavior_preserved():
    # The blocker keeps: the 5s re-probe poller, the auto-advance teardown hooks, and the no-trap way
    # out (dismiss button + Escape + the J4 admin remedy operable from the card).
    assert "setInterval" in ONB and "clearInterval(timer)" in ONB     # the 5s re-probe
    assert "data-ob-holding" in ONB and "_obDismiss" in ONB           # auto-advance teardown hooks
    assert "data-ob-dismiss" in ONB and '"Escape"' in ONB            # the way out
    assert "Open Settings" in ONB and "user-bar-settings" in ONB      # J4 admin remedy


def test_external_seams_preserved():
    # The headless-gate mount seams + the model-config auto-advance + the restart hooks survive.
    assert "window._orwellOnboardingMount" in ONB
    assert "window._orwellWelcomeMount" in ONB
    assert "orwell:models-changed" in ONB
    assert "window._orwellMarkRestart" in ONB


def test_healthy_case_proceed_chain_preserved():
    # #874 (2026-07-09): the setup-wizard confirm step is gone — the healthy case (a feed
    # resolves) proceeds straight to opening the interview + firing the producers' kickoff, with
    # no "mark welcome seen" bookkeeping and no intervening confirm click.
    route = ONB[ONB.index("async function route"):]
    assert "openFreshInterviewSession" in route
    assert "_orwellOpenGameAfterCasting" in route
    assert "markWelcomeSeen" not in ONB
    # the #874 no-feed notice still opens the real Settings (never starts the season by itself)
    assert "openSettings" in ONB
