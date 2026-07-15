"""OWN-3/4/5/6 — the pre-game cast-photo dialog (2026-07-14 theme-visual audit §9).

#1638 total kit migration. The 2026-07-14 first pass composed BOTH the legacy .hs-btn pill
AND .ow-btn, and fought style.css's dark-slab rule with an injected !important
counter-fight. This migration finishes the job:

  - OWN-3: the dark-slab polarity is fixed at the ROOT in style.css — #orwell-headshot now
    paints the sanctioned opaque near-white LIGHT plate (the #orwell-retro treatment), the
    F-S2-A opacity mandate is preserved (no backdrop blur), and the kit's blanket dark-ink
    rules carry the ink with NO id-scoped light-ink exception (those were deleted). The
    injected !important counter-fight in orwellHeadshot.js is gone.
  - The action buttons are the kit's .ow-btn + the right variant (prominent / secondary /
    plain / destructive) — no .hs-btn pill remains; the dead .hs-btn/.hs-btn-ghost CSS was
    deleted. Every element id + handler is preserved.
  - OWN-6: the dialog body no longer re-opens with "Your cast photo." under the
    "Your Cast Photo" titlebar — only the informative remainder stays.
  - OWN-5a: the studio's disabled buttons carry the app's OPAQUE disabled treatment
    (the VM-17 pattern: fixed #d6d6d9 fill + #57575c ink + cursor not-allowed), retargeted
    to .ow-btn[disabled].
  - OWN-5b: the SELECTED candidate tile carries the kit's system-blue ring (--ow-ios-blue,
    3px) via OUTLINE — the accent border-color is clobbered under frosted by the generic
    .ow-window .ow-body button:not(.ow-btn) rule's higher specificity.
  - OWN-4: candidate tiles rendered as ~4.5:1 letterbox strips although .hs-cand declares
    aspect-ratio:1 — the app-wide button{height:32px} reset (an EXPLICIT height defeats
    aspect-ratio) was the measured root cause; height:auto re-arms it.

Roles only — no character names.
"""
import os
import re

FE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

CHROME_INK = "#16191f"          # the kit dark chrome ink (dark-on-light)
LIGHT_PLATE = (248, 250, 252)   # the sanctioned opaque light plate rgb
AA_NORMAL = 4.5


def _read(*rel):
    with open(os.path.join(FE, *rel), encoding="utf-8") as f:
        return f.read()


def _js():
    return _read("static", "js", "orwellHeadshot.js")


def _css():
    return _read("static", "style.css")


def _css_no_comments():
    return re.sub(r"/\*.*?\*/", "", _css(), flags=re.S)


# ── WCAG contrast (mirrors test_1601_chat_light_glass.py / test_s6_4_on_accent_contrast.py) ──
def _hex_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def _lin(c):
    c /= 255.0
    return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4


def _lum(rgb):
    r, g, b = (_lin(x) for x in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def _contrast(fg, bg):
    l1, l2 = _lum(fg), _lum(bg)
    hi, lo = max(l1, l2), min(l1, l2)
    return (hi + 0.05) / (lo + 0.05)


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


# ── OWN-5a: opaque disabled treatment (the VM-17 pattern), retargeted to .ow-btn ──

def test_own5_disabled_rule_is_the_vm17_opaque_pattern():
    js = _js()
    m = re.search(r"\.ow-headshot-studio \.ow-btn\[disabled\][^{]*\{([^}]*)\}", js)
    assert m, "the injected disabled rule has moved or been removed (must target .ow-btn now)"
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


# ── OWN-3: the frosted dialog rides the ONE light family — fixed at the ROOT ───

def test_own3_frosted_dialog_is_the_opaque_light_plate_in_style_css():
    css = _css()
    # the opaque-light plate (the #orwell-retro sanctioned treatment): light fill, no blur —
    # now painted directly in style.css (the F-S2-A rule), NOT the injected sheet.
    m = re.search(
        r"body\.theme-frosted #orwell-headshot\.ow-window[^{]*\{([^}]*)\}", css
    )
    assert m, "OWN-3: the frosted light-plate rule is missing from style.css"
    body = m.group(1)
    assert "background-color: rgba(248, 250, 252, 0.97) !important" in body, (
        "OWN-3: the dialog must paint the sanctioned opaque LIGHT plate (not the dark --panel slab)"
    )
    assert "backdrop-filter: none !important" in body, (
        "OWN-3 keeps the F-S2-A opacity mandate: a gating dialog over live narration must not "
        "let text bleed through (opaque plate, no blur) — only the POLARITY flips"
    )
    # the plate also backs the titlebar + body children (so a surviving backdrop-filter can't leak)
    head = css[m.start():m.start(1)]
    assert ".ow-titlebar" in head and ".ow-body" in head, (
        "OWN-3: the titlebar + body children must be backed by the same light plate"
    )


def test_own3_dark_slab_and_light_ink_exceptions_are_gone():
    """The migration deleted the dark-slab fill AND the id-scoped light-ink exceptions, and the
    injected !important counter-fight in orwellHeadshot.js."""
    css = _css()
    # no #orwell-headshot rule paints the old dark slab or the light #eef1f4 exception ink
    for m in re.finditer(r"(#orwell-headshot[^{}]*)\{([^{}]*)\}", css):
        sel, body = m.group(1), m.group(2)
        assert "#eef1f4" not in body, (
            f"OWN-3: the light-ink exception (#eef1f4) must be gone from '{sel.strip()}' — "
            "the window is light now, so the blanket kit dark-ink rules carry the ink"
        )
        assert "var(--win-bg" not in body and "var(--panel" not in body, (
            f"OWN-3: the dark --win-bg/--panel slab fill must be gone from '{sel.strip()}'"
        )
    # the injected sheet no longer fights style.css with an !important light override
    js = _js()
    m = re.search(r"s\.textContent = `(.*?)`;", js, re.S)
    assert m, "the injected CSS template has moved"
    css_inject = m.group(1)
    assert "background-color: rgba(248, 250, 252, 0.97)" not in css_inject, (
        "OWN-3: the injected !important light counter-fight must be removed — the light plate "
        "lives at the root in style.css now"
    )


def test_own3_light_dialog_ink_clears_AA_contrast():
    """Contrast/polarity assertion (mirrors test_1601_chat_light_glass.py): the kit dark chrome
    ink #16191f on the opaque light plate rgb(248,250,252) must clear AA — proving the flipped
    polarity is legible, not merely light-on-light."""
    ratio = _contrast(_hex_rgb(CHROME_INK), LIGHT_PLATE)
    assert ratio >= AA_NORMAL, (
        f"OWN-3: dark ink {CHROME_INK} on the light plate {LIGHT_PLATE} is {ratio:.2f}:1 (< AA {AA_NORMAL})"
    )
    # and the blanket kit titlebar rule really does paint that dark ink (no surviving light exception)
    css_nc = _css_no_comments()
    assert re.search(
        r"body\.theme-frosted \.ow-titlebar[^{}]*\{[^{}]*color:\s*#16191f", css_nc
    ), "the blanket kit titlebar rule must paint the dark chrome ink (it now carries the headshot titlebar)"


def test_own3_every_headshot_surface_rule_is_frosted_scoped_only():
    """Flat/normal must stay byte-identical: every #orwell-headshot surface/ink rule in style.css
    rides body.theme-frosted — no unscoped surface rule may darken/lighten the flat-tier window."""
    css_nc = _css_no_comments()
    for m in re.finditer(r"([^{}]+)\{([^{}]*)\}", css_nc):
        sel_list, body = m.group(1), m.group(2)
        for sel in sel_list.split(","):
            sel = sel.strip()
            if "#orwell-headshot" not in sel:
                continue
            # layout-only helpers (width/max-height) are fine unscoped; surface/ink rules are not
            if re.search(r"background|backdrop-filter|--fg|(?<!text-)color", body):
                assert sel.startswith("body.theme-frosted"), (
                    f"OWN-3: '{sel}' paints surface/ink but is not frosted-scoped — the flat tier must stay untouched"
                )


# ── the kit migration (#1638): studio buttons ARE the kit — no legacy .hs-btn ──

def test_studio_buttons_are_the_kit_no_legacy_pill():
    js = _js()
    # primary actions → prominent
    assert 'class="ow-btn ow-btn-prominent" id="hs-use"' in js
    assert 'class="ow-btn ow-btn-prominent" id="hs-studio"' in js
    # skip/cancel → plain
    assert 'class="ow-btn ow-btn-plain" id="hs-skip"' in js, "Skip for now → .ow-btn-plain"
    # destructive (removes the portrait) → destructive
    assert 'class="ow-btn ow-btn-destructive" id="hs-remove"' in js, "Remove → .ow-btn-destructive"
    # the remaining actions → secondary
    for sid in ("hs-more", "hs-new", "hs-exact", "hs-redo"):
        assert re.search(r'class="ow-btn ow-btn-secondary"[^>]*id="' + sid + '"', js), (
            f"#{sid} must be a kit .ow-btn-secondary"
        )
    # the file-picker label composes the kit secondary look + keeps ONLY .hs-filebtn (its 44px pin)
    assert 'class="hs-filebtn ow-btn ow-btn-secondary"' in js
    # no button/label element carries the legacy .hs-btn class token, and the dead CSS rule is gone
    assert not re.search(r'class="[^"]*\bhs-btn\b', js), "no element may still carry the legacy .hs-btn class"
    assert not re.search(r"\.ow-headshot-studio \.hs-btn\b", js), "the dead .hs-btn CSS rule must be removed"
    assert ".ow-headshot-studio .hs-btn-ghost" not in js, "the dead .hs-btn-ghost CSS rule must be removed"


def test_ids_and_handlers_preserved():
    """Migration-only: every element id + its click handler is byte-identical."""
    js = _js()
    for sid in ("hs-use", "hs-more", "hs-new", "hs-studio", "hs-exact", "hs-skip",
                "hs-redo", "hs-remove", "hs-file"):
        assert 'id="' + sid + '"' in js, f"element id #{sid} must be preserved"
    # handler wirings unchanged
    assert '#hs-use").addEventListener("click", finalizeSelected)' in js
    assert '#hs-remove").addEventListener("click", removeAll)' in js
    assert '#hs-studio").addEventListener("click", studioGenerate)' in js
    assert '#hs-exact").addEventListener("click", useExact)' in js
