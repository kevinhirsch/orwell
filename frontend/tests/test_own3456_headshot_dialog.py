"""OWN-3/4/5/6 — the pre-game cast-photo dialog (2026-07-14 theme-visual audit §9).

Source-pinned convention checks over orwellHeadshot.js's injected CSS + markup, in the
style of test_wavec_a11y_contrast_focus.py. All four findings were reproduced with a
DOM-measured Playwright probe (real style.css + real window kit + the real pill->mount
path) before fixing; these pins hold the fixes:

  - OWN-6: the dialog body no longer re-opens with "Your cast photo." under the
    "Your Cast Photo" titlebar — only the informative remainder stays.
  - OWN-5a: the studio's disabled buttons carry the app's OPAQUE disabled treatment
    (the VM-17 pattern: fixed #d6d6d9 fill + #57575c ink + cursor not-allowed), never
    the ambiguous transparent/opacity composite (the deeper pin, with contrast math,
    lives in test_wavec_a11y_contrast_focus.py).
  - OWN-5b: the SELECTED candidate tile carries the kit's system-blue ring
    (--ow-ios-blue, 3px) via OUTLINE — the old accent border-color was measured
    CLOBBERED under frosted by the generic .ow-window .ow-body button rule's higher
    specificity, so no selection affordance survived.
  - OWN-4: candidate tiles rendered as ~4.5:1 letterbox strips although .hs-cand
    declares aspect-ratio:1 — the app-wide button{height:32px} reset (an EXPLICIT
    height defeats aspect-ratio) was the measured root cause; height:auto re-arms it
    (measured square 144.5x144.5 at 1440 / 116x116 at 390 post-fix).
  - OWN-3: under body.theme-frosted the dialog rides the ONE light family — the
    sanctioned opaque-LIGHT plate (#orwell-retro's pattern) + the kit dark chrome ink
    (#16191f), neutralizing the style.css dark-slab/light-ink exception rules by the
    same selectors from the later-injected sheet. Flat/normal tier untouched (every
    OWN-3 rule is body.theme-frosted-scoped).

Roles only — no character names.
"""
import os
import re

FE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*rel):
    with open(os.path.join(FE, *rel), encoding="utf-8") as f:
        return f.read()


def _js():
    return _read("static", "js", "orwellHeadshot.js")


# ── OWN-6: no duplicated lead-in under the identical title ─────────────────────

def test_own6_lead_drops_the_duplicated_title_leadin():
    js = _js()
    assert 'title: "Your Cast Photo"' in js, "the window title is the one place the name lives"
    assert "Your cast photo.</b>" not in js and "<b>Your cast photo" not in js, (
        "OWN-6: the body copy must not re-open with the title ('Your cast photo. ...')"
    )
    # the informative remainder stays
    assert "Upload a photo of yourself or generate one with AI" in js
    assert "the interview picks right back up" in js


# ── OWN-5a: opaque disabled treatment (the VM-17 pattern) in the injected CSS ──

def test_own5_disabled_rule_is_the_vm17_opaque_pattern():
    js = _js()
    m = re.search(r"\.ow-headshot-studio \.hs-btn\[disabled\][^{]*\{([^}]*)\}", js)
    assert m, "the injected disabled rule has moved or been removed"
    body = m.group(1)
    for needle in ("opacity: 1", "background: #d6d6d9", "color: #57575c", "cursor: not-allowed"):
        assert needle in body, f"OWN-5: the disabled rule must carry '{needle}' (the VM-17 opaque pattern)"
    assert "background: transparent" not in body, (
        "OWN-5: the old transparent-fill disabled treatment was the ambiguous grey-on-grey sighting"
    )


# ── OWN-5b: unmistakable selection ring on the picked tile ─────────────────────

def test_own5_selected_tile_carries_the_system_blue_ring():
    js = _js()
    m = re.search(r"\.ow-headshot-studio \.hs-cand\.sel\s*\{([^}]*)\}", js)
    assert m, "the .hs-cand.sel rule has moved or been removed"
    body = m.group(1)
    assert "--ow-ios-blue" in body, "OWN-5: the selection affordance must use the kit's system blue"
    assert re.search(r"outline:\s*3px solid var\(--ow-ios-blue", body), (
        "OWN-5: the ring must be a 3px OUTLINE — border/box-shadow are clobbered under frosted "
        "by the generic .ow-window .ow-body button rule's higher specificity (measured)"
    )


# ── OWN-4: square tiles — height:auto re-arms the declared aspect-ratio ────────

def test_own4_tiles_pin_height_auto_beside_aspect_ratio():
    js = _js()
    m = re.search(r"\.ow-headshot-studio \.hs-cand\s*\{(.*?)\}", js, re.S)
    assert m, "the .hs-cand rule has moved or been removed"
    body = m.group(1)
    assert "aspect-ratio: 1" in body, "the square intent must stay declared"
    assert "height: auto" in body, (
        "OWN-4: without height:auto the app-wide button{height:32px} reset defeats "
        "aspect-ratio and the tiles collapse into letterbox strips (measured 144.5x32)"
    )


# ── OWN-3: the frosted dialog rides the ONE light family (flat untouched) ──────

def test_own3_frosted_dialog_is_the_opaque_light_plate_with_dark_ink():
    js = _js()
    # the opaque-light plate (the #orwell-retro sanctioned treatment): light fill, no blur
    m = re.search(
        r"body\.theme-frosted #orwell-headshot\.ow-window[^{]*\{([^}]*)\}", js
    )
    assert m, "OWN-3: the frosted light-plate override is missing from the injected CSS"
    body = m.group(1)
    assert "background-color: rgba(248, 250, 252, 0.97) !important" in body, (
        "OWN-3: the dialog must paint the sanctioned opaque LIGHT plate (not the dark --panel slab)"
    )
    assert "backdrop-filter: none !important" in body, (
        "OWN-3 keeps the F-S2-A opacity mandate: a gating dialog over live narration must not "
        "let text bleed through (opaque plate, no blur) — only the POLARITY flips"
    )
    # the kit dark chrome ink is re-asserted for the titlebar AND the body copy
    assert re.search(
        r"body\.theme-frosted #orwell-headshot \.ow-titlebar,[^{]*\{[^}]*color: #16191f !important",
        js,
    ), "OWN-3: the titlebar must return to the kit dark chrome ink (#16191f)"
    assert re.search(
        r"body\.theme-frosted #orwell-headshot \.ow-body,\s*body\.theme-frosted #orwell-headshot \.ow-body \* \{\s*--fg: #16191f;",
        js,
    ), "OWN-3: the body must re-join the kit dark-ink --fg redefine"


def test_own3_every_light_family_rule_is_frosted_scoped_only():
    """Flat/normal must stay byte-identical: every OWN-3 surface/ink override rides
    body.theme-frosted — no unscoped #orwell-headshot surface rule may exist in the
    injected CSS."""
    js = _js()
    m = re.search(r"s\.textContent = `(.*?)`;", js, re.S)
    assert m, "the injected CSS template has moved"
    css = m.group(1)
    for sel_line in re.findall(r"^[ \t]*([^/\n{}]+)\{", css, re.M):
        for sel in sel_line.split(","):
            sel = sel.strip()
            if "#orwell-headshot ." in sel or "#orwell-headshot.ow-window" in sel:
                assert sel.startswith("body.theme-frosted"), (
                    f"OWN-3: '{sel}' must be frosted-scoped so the flat tier stays untouched"
                )


# ── the kit composition (#775): studio buttons carry the literal kit classes ───

def test_studio_buttons_compose_the_kit_classes():
    js = _js()
    assert 'class="hs-btn ow-btn ow-btn-prominent" id="hs-use"' in js
    assert 'class="hs-btn ow-btn ow-btn-prominent" id="hs-studio"' in js
    for ghost_id in ("hs-more", "hs-new", "hs-exact", "hs-skip", "hs-redo", "hs-remove"):
        assert re.search(
            r'class="hs-btn hs-btn-ghost ow-btn ow-btn-secondary"[^>]*id="' + ghost_id + '"', js
        ), f"#{ghost_id} must compose ow-btn ow-btn-secondary (kit chrome under frosted)"
    assert 'class="hs-btn hs-btn-ghost hs-filebtn ow-btn ow-btn-secondary"' in js, (
        "the file-picker label must compose the kit secondary look too"
    )
