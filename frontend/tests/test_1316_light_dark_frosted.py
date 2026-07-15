"""#1316 (P1) — Light + Dark as first-class base identities with a PROMINENT picker-level
glass control (not buried in Customize -> Font & Layout).

UPDATED for the frosted-tier COLLAPSE (owner ruling): the glass control is now ONE
user-facing choice — Glass (full) or Flat (normal). The old 'frosted' middle segment is
gone — it was glass material minus the SVG refraction, and the refraction ALREADY
auto-downgrades full→frosted on constrained devices (theme.js glassTierCeiling), so
frosted-as-a-manual-choice was invisible/redundant. 'frosted' now survives ONLY as the
automatic downgrade target; the resolution layer never yields it (a legacy saved 'frosted'
folds to Glass), so every theme's glass DEFAULT — light/dark included — is Glass ('full'),
which the auto-downgrade ceiling re-drops to frosted on a constrained device.

Source-pinned, JS/HTML-as-text like the sibling `test_739_glass_tint_toggle.py` /
`test_l32_l33_l34_theme_defaults.py` gates (the pytest lane has no DOM runtime; the
browser-smoke + responsive-matrix gates cover the live DOM).

What holds now:
  1. The compact segmented control, `#theme-glass-tier-quick` (Glass / Flat — matching the
     Customize ladder's full | normal EXACTLY), lives on the Browse/Presets tab (the FIRST
     tab you see opening Theme), bound to the ACTIVE theme's tier. It reuses the EXACT SAME
     `applyGlassTier` + `save()` persistence path as the Customize-tab `#theme-glass-tier`
     control — no new storage shape, no parallel state. theme.js's `_syncGlassTierControl`
     keeps BOTH controls in lockstep (`GLASS_TIER_CONTROL_IDS`) in BOTH directions, and the
     click-binding loop wires both identically. Glass is the pressed default segment.
  2. `light` and `dark` (the two named base-identity presets) carry no `glass`/`glassTier`
     override in THEMES, so `defaultGlassTierFor` resolves them through its shared default —
     now Glass ('full'), auto-downgrading to frosted per device (a regression guard: nobody
     should hard-pin either preset to a literal tier override without a deliberate decision).
  3. DEFAULT_THEME stays 'glass' — `test_l32_l33_l34_theme_defaults.py` hard-pins it plus a
     NEGATIVE guard forbidding `DEFAULT_THEME = 'dark'`. This file does not re-pin that; it
     proves light/dark's glass default + the collapsed 2-way control.
"""
import os
import re

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*rel):
    with open(os.path.join(FRONTEND, *rel), encoding="utf-8") as f:
        return f.read()


# ── HTML: the quick control lives on the Browse/Presets tab, defaults to Frosted ──────────


def test_quick_glass_control_exists_on_the_browse_tab():
    html = _read("static", "index.html")
    browse_m = re.search(
        r'<div id="theme-tab-browse"[^>]*>(.*?)<div id="theme-tab-customize"', html, re.S)
    assert browse_m, "could not locate the #theme-tab-browse (Presets) tab panel"
    browse = browse_m.group(1)
    assert 'id="theme-glass-tier-quick"' in browse, (
        "#1316: a quick glass/frosted control (#theme-glass-tier-quick) must live on the "
        "Browse/Presets tab, not only in Customize -> Font & Layout"
    )
    # It must NOT be the same element as the Customize-tab control (which stays there too).
    assert 'id="theme-glass-tier"' not in browse, (
        "#1316: the quick control is a SEPARATE element from the Customize-tab "
        "#theme-glass-tier control (they are kept in sync by theme.js, not literally the same "
        "DOM node)"
    )


def test_quick_control_is_the_collapsed_two_way_ladder():
    """The collapse (owner ruling): the quick control offers exactly the two user-facing
    tiers — Glass (full) and Flat (normal). 'frosted' is NOT a segment (it is only the
    automatic downgrade target). Both remaining tiers are still representable so the shared
    sync never leaves the control with no active state (the Greptile P2 failure shape)."""
    html = _read("static", "index.html")
    ctrl_m = re.search(
        r'<div id="theme-glass-tier-quick"[^>]*>(.*?)</div>\s*</div>', html, re.S)
    assert ctrl_m, "#theme-glass-tier-quick control body not found"
    body = ctrl_m.group(1)
    for tier in ("full", "normal"):
        assert f'data-tier="{tier}"' in body, (
            f"the quick control must carry a data-tier=\"{tier}\" segment so both "
            "user-facing tiers (Glass / Flat) are representable"
        )
    assert 'data-tier="frosted"' not in body, (
        "the collapsed quick control must NOT carry a frosted segment — frosted is no "
        "longer a manual choice"
    )


def test_quick_control_tiers_exactly_match_the_customize_ladder():
    """Both controls are driven by ONE sync writing ONE tier value — so their [data-tier]
    vocabularies must be identical sets, or some synced value is unrepresentable on one of
    them. Post-collapse that shared set is exactly {full, normal}."""
    html = _read("static", "index.html")

    def _tiers(ctrl_id):
        m = re.search(
            r'<div id="' + ctrl_id + r'"[^>]*>(.*?)</div>\s*</div>', html, re.S)
        assert m, f"#{ctrl_id} control body not found"
        return set(re.findall(r'data-tier="([a-z]+)"', m.group(1)))

    quick = _tiers("theme-glass-tier-quick")
    customize = _tiers("theme-glass-tier")
    assert quick == customize == {"full", "normal"}, (
        f"the two glass-tier controls must carry IDENTICAL tier sets "
        f"(quick={sorted(quick)}, customize={sorted(customize)}) — the collapsed set is "
        "{full, normal}; a mismatch makes some synced tier unrepresentable on one control"
    )


def test_quick_control_defaults_to_glass():
    html = _read("static", "index.html")
    ctrl_m = re.search(r'<div id="theme-glass-tier-quick"[^>]*>', html)
    assert ctrl_m, "#theme-glass-tier-quick control not found"
    assert 'data-value="full"' in ctrl_m.group(0), (
        "the quick control must default to Glass (data-value='full') — the single glass "
        "state after the frosted collapse"
    )
    body_m = re.search(
        r'<div id="theme-glass-tier-quick"[^>]*>(.*?)</div>\s*</div>', html, re.S)
    body = body_m.group(1)
    full_btn = re.search(r'data-tier="full"[^>]*>', body).group(0)
    assert 'aria-pressed="true"' in full_btn, (
        "Glass (full) must be the pressed default segment"
    )
    normal_btn = re.search(r'data-tier="normal"[^>]*>', body).group(0)
    assert 'aria-pressed="false"' in normal_btn, (
        "Flat (normal) must NOT be pressed by default — Glass keeps the default emphasis"
    )


def test_quick_control_reuses_the_shared_segmented_control_class():
    html = _read("static", "index.html")
    m = re.search(r'<div id="theme-glass-tier-quick"[^>]*>', html)
    assert m and 'class="theme-seg"' in m.group(0), (
        "#1316: the quick control must reuse the shared .theme-seg styling class "
        "(the same segmented-control look as #theme-glass-tier / #theme-glass-tint)"
    )


# ── CSS: the .theme-seg BASE styling must survive every tier (Greptile P1) ────────────────


def test_theme_seg_base_rules_are_not_frosted_scoped():
    """Greptile P1 (#1343): the segmented control's own job is to switch the glass tier, so
    its base layout/affordance must NOT be scoped under body.theme-frosted — with the frosted
    scoping, clicking Flat (normal) removed the body class and instantly stripped ALL styling
    from #theme-glass-tier-quick / #theme-glass-tier / #theme-glass-tint, in exactly the state
    the 3-way ladder just made representable. The base track, segment, hover, and selected-pill
    rules must all exist UNSCOPED (theme-independent, token-driven)."""
    css = _read("static", "style.css")
    # The base track rule: the selector starts the line (no body.theme-frosted prefix) and
    # carries the structural layout.
    m = re.search(r"^\.theme-seg\s*\{([^}]*)\}", css, re.M)
    assert m, "#1316/P1: an UNSCOPED base `.theme-seg` rule must exist"
    base = m.group(1)
    assert "display: inline-flex" in base, (
        "#1316/P1: the unscoped base must own the control's layout (inline-flex track)"
    )
    # Token-driven, 0114-safe: a subtle fg wash + the theme's own border token.
    assert "color-mix(in srgb, var(--fg)" in base
    assert "var(--border" in base, (
        "#1316/P1: the base border must ride the theme's --border token, not a fixed "
        "white rim (that's the frosted accent layer's job)"
    )
    # The glass MATERIAL must NOT live in the base — it belongs to the frosted accent layer
    # (backdrop-filter on a flat theme is both wrong and a perf cost).
    assert "backdrop-filter" not in base, (
        "#1316/P1: the unscoped base must carry no glass material — the frosted-only "
        "accent layer adds it"
    )
    # Base segment buttons + selected pill are unscoped too.
    assert re.search(r"^\.theme-seg > button,", css, re.M), (
        "#1316/P1: the segment-button rule must be unscoped"
    )
    assert re.search(r'^\.theme-seg > button\[aria-pressed="true"\],', css, re.M), (
        "#1316/P1: the selected-pill rule must be unscoped (the active state must render "
        "in every tier, including Flat)"
    )


def test_theme_seg_frosted_layer_is_purely_additive_material():
    """The frosted-scoped .theme-seg rule may only ADD the glass accent (backdrop-filter +
    luminous rim) on top of the unscoped base — it must never be the sole owner of layout
    (that's the P1 regression shape: the layout dying with the body class)."""
    css = _read("static", "style.css")
    m = re.search(r"^body\.theme-frosted \.theme-seg\s*\{([^}]*)\}", css, re.M)
    assert m, "the frosted-only .theme-seg accent layer must exist"
    frosted = m.group(1)
    assert "backdrop-filter" in frosted, "the frosted layer carries the glass material"
    assert "display" not in frosted, (
        "#1316/P1: layout must live in the unscoped base, never (only) in the frosted layer"
    )


# ── JS: both controls are kept in lockstep and share ONE apply+persist path ───────────────


def test_both_glass_tier_controls_are_tracked_together():
    js = _read("static", "js", "theme.js")
    assert "const GLASS_TIER_CONTROL_IDS = ['theme-glass-tier', 'theme-glass-tier-quick'];" in js, (
        "#1316: theme.js must track BOTH controls in one id list so a single sync/bind "
        "routine drives them identically"
    )


def test_sync_glass_tier_control_updates_every_tracked_control():
    js = _read("static", "js", "theme.js")
    m = re.search(r"function _syncGlassTierControl\(tier\)\s*\{(.*?)\n  \}", js, re.S)
    assert m, "_syncGlassTierControl body not found"
    body = m.group(1)
    assert "for (const id of GLASS_TIER_CONTROL_IDS)" in body, (
        "#1316: _syncGlassTierControl must loop over GLASS_TIER_CONTROL_IDS so picking "
        "either control updates the other"
    )


def test_sync_carries_the_normal_tier_to_both_controls():
    """The both-directions 'normal' round-trip (Greptile P2): the ONE sync accepts 'normal'
    as a first-class value and stamps it onto EVERY tracked control's dataset + buttons.
    Combined with the identical-tier-set pin above (both controls carry a
    data-tier="normal" segment), this makes 'normal' representable regardless of which
    control set it: Customize -> quick shows Flat pressed; quick's Flat -> Customize shows
    Off pressed — the same loop, symmetric by construction."""
    js = _read("static", "js", "theme.js")
    m = re.search(r"function _syncGlassTierControl\(tier\)\s*\{(.*?)\n  \}", js, re.S)
    assert m, "_syncGlassTierControl body not found"
    body = m.group(1)
    # 'normal' is a validated, accepted tier (not coerced away to the frosted fallback)...
    assert "tier === 'normal'" in body, (
        "#1316/P2: _syncGlassTierControl must accept 'normal' as a valid tier"
    )
    # ...and every tracked control gets its dataset.value + per-button aria-pressed stamped
    # from that same accepted value inside the shared loop.
    assert "ctrl.dataset.value = t;" in body
    assert "b.dataset.tier === t" in body
    assert re.search(r"setAttribute\('aria-pressed', on \? 'true' : 'false'\)", body), (
        "#1316/P2: the sync must press exactly the matching segment on every control"
    )


def test_both_controls_are_bound_through_the_same_handler_loop():
    js = _read("static", "js", "theme.js")
    m = re.search(
        r"for \(const _gtId of GLASS_TIER_CONTROL_IDS\)\s*\{(.*?)\n  \}", js, re.S)
    assert m, "#1316: the glass-tier click-binding loop over GLASS_TIER_CONTROL_IDS was not found"
    handler = m.group(1)
    # Apply + sync + persist — the EXACT same path the pre-#1316 single control used.
    assert "applyGlassTier(tier)" in handler
    assert "_syncGlassTierControl(tier)" in handler
    assert "_saveFull(s.name, s.colors)" in handler, (
        "#1316: choosing a tier from EITHER control must persist through the same "
        "save() path (no parallel storage)"
    )


def test_getopts_still_reads_the_customize_tab_control_which_stays_synced():
    """_getOpts() reads #theme-glass-tier specifically (unchanged) — this only works because
    _syncGlassTierControl (pinned above) always keeps it mirrored to whichever control the
    player actually clicked, including the new quick control."""
    js = _read("static", "js", "theme.js")
    assert "const gt = document.getElementById('theme-glass-tier');" in js
    assert "if (gt && gt.dataset.value) opts.glassTier = gt.dataset.value;" in js


# ── Light + Dark default to Glass (post-collapse: frosted is no longer a resolved tier) ────


def test_light_and_dark_presets_carry_no_glass_override():
    js = _read("static", "js", "theme.js")
    body = re.search(r"export const THEMES = \{(.*?)\n\};", js, re.S).group(1)
    for name in ("light", "dark"):
        m = re.search(r"^\s*" + name + r":\s*\{([^}]*)\}", body, re.M)
        assert m, f"{name} theme entry not found in THEMES"
        entry = m.group(1)
        assert "glass:" not in entry and "glassTier:" not in entry, (
            f"#1316: {name} must carry no glass/glassTier override so it resolves through "
            "defaultGlassTierFor's shared default, not a hardcoded tier"
        )


def test_default_glass_tier_for_light_and_dark_is_glass():
    js = _read("static", "js", "theme.js")
    # defaultGlassTierFor (post-collapse): 'glass' (or an explicit glass/full flag) -> full;
    # explicit 'normal' -> normal; everything else (incl. light/dark) -> full. 'frosted' is
    # no longer a resolved tier — it survives only as the applyGlassTier auto-downgrade
    # target, so the resolution layer must NEVER return it.
    m = re.search(r"function defaultGlassTierFor\([^)]*\)\s*\{(.*?)\n\}", js, re.S)
    assert m, "defaultGlassTierFor body not found"
    body = m.group(1)
    assert "return 'frosted'" not in body, (
        "defaultGlassTierFor must not resolve to 'frosted' — the collapse maps every "
        "theme's glass default to Glass ('full'); the ceiling handles the per-device drop"
    )
    # light/dark are neither 'glass' nor glass/full-flagged nor 'normal', so they fall
    # through every branch to the Glass ('full') default — the ACTUAL path a brand-new
    # player choosing Light or Dark takes (auto-downgraded to frosted on a constrained device).
    assert "name === 'glass'" in body
    assert "t.glassTier === 'normal'" in body


def test_light_and_dark_are_real_named_presets_in_the_picker():
    js = _read("static", "js", "theme.js")
    assert re.search(r"^\s*dark:\s*\{", js, re.M), "dark preset must exist"
    assert re.search(r"^\s*light:\s*\{", js, re.M), "light preset must exist"
