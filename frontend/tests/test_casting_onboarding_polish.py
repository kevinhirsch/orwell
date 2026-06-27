"""Casting / onboarding UX polish batch (#911, #912, #913) — SOURCE-PINS.

The FE pytest lane has no DOM runtime, so these pin the JS/CSS conventions; the
live DOM behaviour is exercised in frontend/scripts/browser_smoke.py. No fixture
names — roles only.

  • #911 — the setup wizard's titlebar minimize control rendered as a bare '–'
           glyph (a disabled placeholder shown only in the non-frosted/legacy
           chrome, where no CSS hid it). The kit now hides the disabled .ow-min
           placeholder outside the frosted theme.
  • #912 — CONFIRM-ONLY: the 'updateCasting' tool-beat chip reads as DIEGETIC
           production flavour ('🎬 Casting notes'), not a raw system/tool label.
  • #913 — the 'Choose Your Character' CTA was injected INLINE into chat-history
           (so it scrolled away + orphaned) AND was not removed on a verbal skip.
           It is now PINNED above the composer (the OrwellNotice zone) and a
           verbal-skip belt removes it.
"""
import os

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*parts):
    with open(os.path.join(FRONTEND, *parts), encoding="utf-8") as f:
        return f.read()


# ── #911 — the setup wizard's first button is a bare '–' ────────────────────────

def test_911_disabled_minimize_glyph_is_hidden_in_legacy_chrome():
    # The minimize control is ALWAYS built (the macOS cluster keeps its shape), and is `disabled`
    # on a non-minimizable window (e.g. the setup wizard). The frosted theme greys it to a
    # glyphless disc; the LEGACY (non-frosted) chrome must HIDE the disabled placeholder so its raw
    # '–' glyph never renders as a mystery "first button". The kit ships that fallback rule itself.
    kit = _read("static", "js", "orwellWindow.js")
    # the minimize button still carries the '–' glyph + the .ow-min class (cluster shape intact)
    assert "b.textContent = '–';" in kit
    assert "'ow-min tap-exempt'" in kit
    # the non-frosted fallback that hides the DISABLED placeholder (the #911 fix)
    assert "body:not(.theme-frosted) .ow-controls .ow-min[disabled] { display: none; }" in kit
    # the setup wizard is the named non-minimizable surface this guards
    onb = _read("static", "js", "orwellOnboarding.js")
    assert "minimizable: false" in onb


# ── #912 — the 'CASTING NOTES' tool-beat chip is diegetic, not a system label ───

def test_912_casting_beat_is_diegetic_production_flavour():
    # CONFIRM-ONLY: 'updateCasting' maps to in-fiction production b-roll ('🎬 Casting notes'),
    # NOT its raw camelCase tool name. The chip's uppercase styling (.agent-thread-tool) is the
    # universal slate/b-roll treatment shared by EVERY beat, so it reads as a film slate, not a
    # raw system label. Guard both halves: the diegetic label, and that the raw name never leaks.
    beats = _read("static", "js", "orwellToolBeats.js")
    # the clapperboard + human-readable production label
    assert "'updateCasting': '\\u{1F3AC} Casting notes'" in beats
    # the raw camelCase tool name is NEVER the rendered label (immersion bleed guard)
    assert "'updateCasting': 'updateCasting'" not in beats
    # the chip styling is the shared slate treatment (uppercase), applied to the whole family
    css = _read("static", "style.css")
    block = css[css.index(".agent-thread-tool {"):]
    assert "text-transform: uppercase;" in block[:block.index("}")]


# ── #913 — the 'Choose Your Character' CTA is pinned above the composer + skip-removed ──

def test_913_choose_character_cta_is_pinned_above_composer():
    # The CTA must NOT be appended inline into chat-history (where it scrolled out of the focal
    # zone and orphaned). It is hosted in the above-composer OrwellNotice zone (the same anchor
    # the decision card + game guide use), with a fail-open fallback to the legacy in-stream path.
    hs = _read("static", "js", "orwellHeadshot.js")
    show = hs[hs.index("function showPill"):hs.index("function removePill")]
    # primary path: the kit notice zone, gated on the composer anchor
    assert "window.OrwellNoticeKit.create({" in show
    assert 'document.querySelector(".chat-input-bar")' in show
    # fail-open fallback to the legacy in-stream append survives (the CTA must always reach)
    assert 'document.getElementById("chat-history")' in show
    # removePill tears down whichever host was used (kit notice OR the legacy wrapper)
    rm = hs[hs.index("function removePill"):hs.index("async function route")]
    assert "_pillNotice.hide()" in rm
    assert "p.remove()" in rm


def test_913_verbal_skip_removes_the_cta():
    # A purely VERBAL "skip the photo" (the model under-calls updateCasting and just acknowledges
    # in prose) must not leave the CTA pinned as a dead button. A client-side belt watches the
    # transcript and removes the pill on a verbal-skip phrase (error-correcting the model omission;
    # the engine stays the source of truth — recordPhotoStep("skipped") still fires).
    hs = _read("static", "js", "orwellHeadshot.js")
    assert "watchTranscriptForVerbalSkip" in hs
    assert "_looksLikeVerbalPhotoSkip" in hs
    # it removes the pill AND clears the step engine-side (never engine-authors content)
    skip_block = hs[hs.index("function watchTranscriptForVerbalSkip"):]
    assert "removePill();" in skip_block
    assert 'recordPhotoStep("skipped")' in skip_block
    # it watches the player's own message, pre-game only, and stops once the season starts
    assert ".msg-user:last-of-type" in skip_block
    assert "_maybePregame" in skip_block
