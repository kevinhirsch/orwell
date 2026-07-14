"""Issue #773 — the OrwellElement kit ratchet (SOURCE-PINS).

The kit is ONE source of truth for the Apple-HIG atomic primitives (button / field /
check / radio / switch / select / slider), composable by every surface. These are
source-pinned convention checks (the FE has no DOM runtime in the pytest lane); the
visual correctness is verified by the rendered demo (static/element_kit_demo.html) +
browser_smoke.

Pins:
  • every documented primitive class exists, with its variants + states;
  • NO accent HUE on text/labels (the contract): the prominent button carries no
    --accent/--ow-accent; the kit text ink is --fg, never an accent;
  • the full Apple button state-set exists (hover / active / focus-visible / disabled);
  • the kit honors the a11y trio (reduced-transparency / contrast / reduced-motion);
  • the kit is the single source — the demo + the docs exist and reference it.
"""
import os
import re

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*p):
    with open(os.path.join(FRONTEND, *p), encoding="utf-8") as f:
        return f.read()


CSS = _read("static", "style.css")
# the element-kit region only — pins must verify the kit block, not stray app rules.
assert "── ELEMENT KIT ──" in CSS, "the ELEMENT KIT region marker is missing"
KIT = CSS[CSS.index("── ELEMENT KIT ──"):CSS.index("── END ELEMENT KIT ──")]


def test_element_kit_region_exists():
    assert "── ELEMENT KIT ──" in CSS and "── END ELEMENT KIT ──" in CSS


def test_button_full_apple_variant_set():
    # primary/prominent, secondary, plain/borderless, destructive, icon-only.
    for sel in (".ow-btn-prominent", ".ow-btn-secondary", ".ow-btn-plain",
                ".ow-btn-destructive", ".ow-btn-icon"):
        assert sel in CSS, sel


# ── WWDC25 310 button refinement (size ladder · tint-not-fill · concentric · group) ──

def test_size_ladder_shape_follows_size():
    # WWDC25 310: FIVE-size hierarchy; shape follows size — sm/md = rounded-rect,
    # lg/xl = capsule. The new -xl (extra-large) is the most-prominent-action size.
    for sel in (".ow-btn-sm", ".ow-btn-md", ".ow-btn-lg", ".ow-btn-xl"):
        assert sel in CSS, sel
    sm = re.search(r"\.ow-btn-sm\s*\{(.*?)\}", CSS, re.S).group(1)
    md = re.search(r"\.ow-btn-md\s*\{(.*?)\}", CSS, re.S).group(1)
    lg = re.search(r"\.ow-btn-lg\s*\{(.*?)\}", CSS, re.S).group(1)
    xl = re.search(r"\.ow-btn-xl\s*\{(.*?)\}", CSS, re.S).group(1)
    # sm/md → rounded-rect (the inner radius), lg/xl → capsule (the pill radius).
    assert "--ow-radius-inner" in sm and "--ow-radius-inner" in md
    assert "--ow-radius-pill" in lg and "--ow-radius-pill" in xl
    # 310: "avoid hard-coding the heights of controls" — size via padding + line-height,
    # never a fixed height/min-height on the size modifier.
    for body in (sm, md, lg, xl):
        assert "padding" in body and "line-height" in body
        # a standalone height/min-height (NOT line-height) is the hard-code 310 forbids.
        assert not re.search(r"(?<!line-)(?<!max-)(?<!min-)\bheight\s*:", body), \
            "size variant must NOT hard-code a height"


def test_prominent_is_tinted_glass_not_opaque_fill():
    # WWDC25 310 "tint, don't fill": prominent is a TRANSLUCENT tint over the glass
    # material, never an opaque solid plate. The tint token is translucent and the
    # backdrop blur is composed (the backdrop samples through).
    block = re.search(r"\.ow-btn-prominent\s*\{(.*?)\}", CSS, re.S).group(1)
    # the fill is the tint token (translucent), not a flat opaque color.
    assert "--ow-btn-tint-primary" in block
    # the primary tint default is translucent (rgba/transparent), NOT a solid hex/opaque.
    tint = re.search(r"--ow-btn-tint-primary:\s*([^;]+);", CSS).group(1)
    assert ("rgba(" in tint or "transparent" in tint), \
        f"primary tint must be translucent (tint-not-fill), got {tint!r}"
    # the kit button rides a backdrop sample (glass), not a painted plate.
    base = re.search(r"body\.theme-frosted \.ow-btn \{(.*?)\}", CSS, re.S).group(1)
    assert "backdrop-filter" in base


def test_destructive_is_red_tint_not_overpowering_solid():
    # WWDC25 310: destructive red sits at SECONDARY prominence — a red TINT over glass,
    # "a level of prominence that doesn't overpower nearby controls", NOT an opaque plate.
    block = re.search(r"body\.theme-frosted \.ow-btn-destructive\s*\{(.*?)\}",
                      CSS, re.S).group(1)
    assert "--ow-btn-tint-danger" in block          # the translucent red tint
    danger_tint = re.search(r"--ow-btn-tint-danger:\s*([^;]+);", CSS).group(1)
    assert "transparent" in danger_tint, \
        f"destructive must be a TRANSLUCENT red tint, got {danger_tint!r}"
    # the loud opaque-red plate is an OPT-IN escape hatch only (a final irreversible act).
    assert ".ow-btn-destructive-solid" in CSS


def test_concentric_nesting_modifier_with_fallback():
    # WWDC25 356: concentric inner radius = parent − padding, with a standalone FALLBACK.
    block = re.search(r"\.ow-btn-concentric\s*\{(.*?)\}", CSS, re.S).group(1)
    assert "--ow-parent-radius" in block            # parent radius
    assert "--ow-parent-inset" in block             # the padding subtracted
    assert "fallback" in block.lower()              # the standalone fallback radius


def test_grouped_glass_shares_one_backdrop_sample():
    # WWDC25 310 (NSGlassEffectContainerView): adjacent glass shares ONE backdrop sample
    # ("glass can't directly sample other glass"). The group carries the backdrop-filter;
    # its member buttons DROP their own sample and ride the group's.
    grp = re.search(r"body\.theme-frosted \.ow-btn-group\s*\{(.*?)\}",
                    CSS, re.S).group(1)
    assert "backdrop-filter: var(--ow-btn-glass" in grp   # the ONE shared sample
    member = re.search(r"body\.theme-frosted \.ow-btn-group > \.ow-btn\s*\{(.*?)\}",
                       CSS, re.S).group(1)
    assert "backdrop-filter: none" in member             # members ride the group's sample


def test_button_floats_soft_shadow_and_specular_rim():
    # the depth/parity fix: a Liquid Glass button FLOATS — a soft cast drop shadow + a
    # full-perimeter specular rim (the lit glass edge), composed on the base .ow-btn.
    assert "--ow-btn-shadow:" in CSS and "--ow-btn-rim:" in CSS
    base = re.search(r"body\.theme-frosted \.ow-btn \{(.*?)\}", CSS, re.S).group(1)
    assert "--ow-btn-shadow" in base and "--ow-btn-rim" in base


def test_button_full_apple_state_set():
    # hover (lift), pressed/active (iOS dim+scale), focus-visible (ring), disabled.
    assert ".ow-btn:hover" in KIT
    assert ".ow-btn:active" in KIT and "scale(0.97)" in KIT          # iOS press scale
    assert ".ow-btn:focus-visible" in KIT
    assert (".ow-btn:disabled" in KIT and ".ow-btn[disabled]" in KIT
            and ".ow-btn.is-disabled" in KIT)


def test_destructive_is_system_red_with_legible_label():
    block = re.search(r"\.ow-btn-destructive\s*\{(.*?)\}", KIT, re.S)
    assert block, "no .ow-btn-destructive block"
    body = block.group(1)
    # system-red FILL via the semantic danger token (NOT the theme accent)…
    assert "--ow-danger" in body
    # …and a legible on-red label (white/on-danger), not an accent-hued label.
    assert "--ow-on-danger" in body
    assert "--accent" not in body and "--ow-accent" not in body


def test_field_primitive_with_focus_invalid_placeholder():
    assert ".ow-field" in KIT
    assert ".ow-field:focus" in KIT
    assert (".ow-field[aria-invalid=\"true\"]" in KIT or ".ow-field.is-invalid" in KIT)
    assert ".ow-field::placeholder" in KIT


def test_check_and_radio_primitives():
    assert ".ow-check" in KIT and ".ow-radio" in KIT
    # accent ONLY when checked (the box/ring is neutral at rest).
    assert ".ow-check:checked" in KIT and ".ow-radio:checked" in KIT
    assert ".ow-check:focus-visible" in KIT and ".ow-radio:focus-visible" in KIT


def test_switch_primitive_ios():
    assert ".ow-switch" in KIT and ".ow-switch-track" in KIT
    assert "input:checked + .ow-switch-track" in KIT
    # ON track = the sanctioned system blue.
    assert "--ow-ios-blue" in KIT
    assert ".ow-switch input:focus-visible + .ow-switch-track" in KIT


def test_select_primitive_fixes_dark_on_dark():
    assert "select.ow-select" in KIT
    # the option list is pinned to legible tokens (the admin dark-on-dark fix).
    assert "select.ow-select option" in KIT and "--select-option" in KIT
    assert "select.ow-select:focus-visible" in KIT


def test_slider_primitive_system_green_glass_thumb():
    assert "input[type=\"range\"].ow-slider" in KIT
    assert "--ow-ios-green" in KIT                                   # system-green track
    assert "::-webkit-slider-thumb" in KIT and "::-moz-range-thumb" in KIT
    assert "input[type=\"range\"].ow-slider:focus-visible" in KIT


def test_focus_ring_is_system_blue_not_theme_accent():
    # the kit focus ring is Apple system blue, a fixed a11y color — NOT --accent.
    assert "--ow-focus-ring" in KIT
    m = re.search(r"--ow-focus-ring:\s*([^;]+);", KIT)
    assert m and "--accent" not in m.group(1)


def test_no_accent_hue_on_text_anywhere_in_kit():
    # the contract: no kit primitive paints its TEXT/label with the theme accent hue.
    # `color:` declarations in the kit must use --fg / control-ink / on-danger / a
    # neutral — never --accent / --ow-accent / --red.
    for m in re.finditer(r"(?<![-\w])color:\s*([^;]+);", KIT):
        val = m.group(1)
        assert "--accent" not in val and "--ow-accent" not in val and "var(--red" not in val, \
            f"accent hue on text in the kit: {val!r}"


def test_kit_honors_a11y_trio():
    assert "prefers-reduced-transparency: reduce" in KIT
    assert "prefers-contrast: more" in KIT
    assert "prefers-reduced-motion: reduce" in KIT


def test_controls_are_glass_default_riding_one_plane():
    # the kit controls ride the parent material (a neutral translucent fill +
    # backdrop blur), they don't stack a hued second glass slab.
    assert "--ow-control-fill" in KIT
    assert "backdrop-filter: var(--ow-btn-glass" in KIT


def test_control_ink_is_neutral_dark_not_light_fg():
    # the kit control ink is the canonical neutral chrome dark ink (#16191f), NOT the
    # theme's light --fg (which on a naked glass surface is light-on-light — the #726
    # bug). The fill/rim basis is the same neutral, so controls are legible everywhere.
    m = re.search(r"--ow-control-ink:\s*([^;]+);", KIT)
    assert m and "16191f" in m.group(1)
    assert "--ow-control-fill: color-mix(in srgb, #16191f" in KIT


def test_glass_technique_luminous_rim_composed():
    # the field + select carry the soft luminous specular-edge rim (the pure-CSS
    # equivalent of the kube.io feBlend rim-light), composing --ow-glass-rim — the
    # SAME edge token the app's glass chrome uses (not a reinvented value).
    field = re.search(r"\.ow-field\s*\{(.*?)\}", KIT, re.S)
    assert field and "--ow-glass-rim" in field.group(1)


def test_transient_knob_takes_real_svg_refraction_at_full_glass():
    # the switch thumb + slider thumb are the sanctioned transient-glass knobs — at
    # Full Glass they take the app's #owlg-thumb concave lip-bezel SVG refraction
    # (composed from liquidGlass.js, kube.io #switch port), gated on body.glass-full,
    # with the reduced-transparency solid-white fallback.
    assert "body.glass-full .ow-switch .ow-switch-track::before" in KIT
    assert "url(\"#owlg-thumb\")" in KIT
    # the refraction is Full-Glass gated (perf cap) — NOT applied at plain Frosted.
    assert "body.glass-full input[type=\"range\"].ow-slider::-webkit-slider-thumb" in KIT


def test_demo_and_docs_exist_and_reference_the_kit():
    demo = _read("static", "element_kit_demo.html")
    for sel in ("ow-btn-prominent", "ow-btn-destructive", "ow-field", "ow-check",
                "ow-radio", "ow-switch", "ow-select", "ow-slider"):
        assert sel in demo, f"demo missing {sel}"
    # WWDC25 310/356 additions are visible in the demo: the size ladder, the tinted
    # (accent) prominent, the destructive, and a button group.
    for sel in ("ow-btn-sm", "ow-btn-md", "ow-btn-lg", "ow-btn-xl",
                "ow-btn-group", "ow-btn-concentric", "--ow-btn-tint-primary"):
        assert sel in demo, f"demo missing WWDC-310 example: {sel}"


def test_docs_document_sizes_prominence_and_concentric_group():
    doc_path = os.path.join(os.path.dirname(FRONTEND), "docs", "design",
                            "liquid-glass", "ELEMENT_KIT.md")
    with open(doc_path, encoding="utf-8") as f:
        doc = f.read()
    # the size ladder + the tint-prominence mapping + concentric/group usage, cited.
    assert "310" in doc and "356" in doc
    for token in ("ow-btn-xl", "ow-btn-group", "ow-btn-concentric",
                  "tint", "prominence"):
        assert token in doc, f"doc missing {token}"
    # the docs file lives beside the liquid-glass references.
    doc_path = os.path.join(os.path.dirname(FRONTEND), "docs", "design",
                            "liquid-glass", "ELEMENT_KIT.md")
    assert os.path.exists(doc_path), "docs/design/liquid-glass/ELEMENT_KIT.md missing"
    with open(doc_path, encoding="utf-8") as f:
        doc = f.read()
    assert ".ow-field" in doc and ".ow-btn-destructive" in doc and ".ow-switch" in doc


# ── the full kit reference: composite kits, not just atomic elements ──────────────

DEMO = _read("static", "element_kit_demo.html")
DRIVER = _read("static", "js", "orwellElements.js")


def test_demo_is_a_full_kit_reference_with_composite_sections():
    # the demo headlines BOTH tiers: atomic elements AND the composite kits.
    assert "Atomic elements" in DEMO and "Composite kits" in DEMO
    # a headed section per composite kit (window / notice / gadget / decision).
    for heading in ("Windows — OrwellWindowKit", "Notifications — OrwellNoticeKit",
                    "Gadgets — OrwellGadgetKit", "Decision — OrwellDecision"):
        assert heading in DEMO, f"demo missing composite section: {heading}"


def test_demo_window_section_shows_types_traffic_lights_and_titlebar():
    # window types/states noted + the macOS traffic-light controls swatch (rest + hover).
    assert "modal" in DEMO and "dockable" in DEMO
    assert "ow-controls" in DEMO and "ow-min" in DEMO and "ow-close" in DEMO
    # live instantiation through the kit seam.
    assert "OrwellWindowKit.create" in DRIVER


def test_demo_notice_section_severities_banner_and_chat_hint():
    # the driver instantiates every severity + the top banner + the chat-hint.
    assert "OrwellNoticeKit.create" in DRIVER
    for sev in ('"info"', '"warn"', '"error"'):
        assert sev in DRIVER, f"driver missing severity {sev}"
    assert '"top-banner"' in DRIVER          # the top system banner placement
    assert "orwell-chat-hint" in DRIVER      # the OrwellChatHint composition


def test_demo_gadget_and_decision_present():
    assert "OrwellGadgetKit.create" in DRIVER
    assert "og-card" in DEMO or "og-head" in DEMO or "OrwellGadgetKit" in DEMO
    # the decision card composes the kit's .odec-* classes with a prompt + actions.
    assert "orwell-decision-card" in DEMO
    for cls in ("odec-prompt", "odec-opt", "odec-confirm"):
        assert cls in DEMO, f"decision demo missing .{cls}"


def test_demo_shows_all_gadget_kinds():
    # the owner's ask: ALL gadget kinds present, not one generic card. The driver
    # instantiates every real player-tier gadget type via the kit.
    for title in ('"House Status"', '"Your Deals"', '"Where You Are"',
                  '"Nightfall"', '"Cast"', '"Alliances"'):
        assert title in DRIVER, f"gadget driver missing {title}"
    # the demo's gadget section is revealed (the .og-card default is display:none).
    assert "og-card { position: static !important; display: block" in DEMO


def test_demo_switch_is_real_liquid_glass():
    # the .ow-switch knob must take the REAL #owlg-thumb SVG refraction — which only
    # exists if liquidGlass.js is loaded on the demo page (it generates the filter).
    assert "/static/js/liquidGlass.js" in DEMO, "demo must load liquidGlass.js for switch refraction"
    # and the kit CSS still references that filter on the switch knob at Full Glass.
    assert 'url("#owlg-thumb")' in KIT
    assert "body.glass-full .ow-switch .ow-switch-track::before" in KIT
    # the demo shows a switch off + on (verifiable).
    assert "ow-switch" in DEMO


def test_demo_driver_is_demo_only_not_shipped():
    # the driver must NOT be referenced by the real app shell (index.html) — it is a
    # demo-page-only file. It is loaded ONLY by the demo page.
    assert "orwellElements.js" in DEMO
    index = _read("static", "index.html")
    assert "orwellElements.js" not in index, "demo driver must not ship in the app shell"


# ── 2026-07-14 theme-visual-audit demo-fidelity pins (KIT-G-03 / KIT-G-04 / KIT-F-04 / KIT-F-07) ──

def _no_comments_css(s):
    """CSS/HTML sources minus /* … */ and <!-- … --> comments (pins must bind
    DECLARATIONS, never the explanatory prose that names the forbidden token)."""
    return re.sub(r"<!--.*?-->", "", re.sub(r"/\*.*?\*/", "", s, flags=re.S), flags=re.S)


def _no_comments_js(s):
    """JS source minus // line comments and /* … */ blocks."""
    return re.sub(r"(^|\s)//[^\n]*", r"\1", re.sub(r"/\*.*?\*/", "", s, flags=re.S))


def test_demo_section_cards_are_solid_no_glass_on_glass():
    # KIT-G-04: the demo's section wrappers must be SOLID — a wrapper carrying its own
    # backdrop-filter around independently-sampling kit controls is the exact
    # "never glass on glass" anti-pattern the corpus forbids (§1). No demo-chrome rule
    # may reintroduce a backdrop sample: the page's own CSS carries NO backdrop-filter
    # DECLARATION at all (the kit surfaces get theirs from style.css / the kit modules).
    assert "backdrop-filter" not in _no_comments_css(DEMO), (
        "KIT-G-04: the demo page's own CSS must not compose backdrop-filter — "
        "solid section cards only (glass-on-glass anti-pattern)"
    )
    card = re.search(r"\.ek-card\s*\{(.*?)\}", _no_comments_css(DEMO), re.S)
    assert card, ".ek-card rule missing from the demo"
    assert re.search(r"background:\s*#[0-9a-fA-F]{3,8}\s*;", card.group(1)), (
        "KIT-G-04: .ek-card must carry an opaque (hex) fill, not a translucent color-mix"
    )


def test_demo_live_windows_float_on_the_wallpaper_not_in_a_card():
    # KIT-G-04/G-03: the live windows host sits OUTSIDE the solid section cards, directly
    # over the wallpaper, so the window/modal glass samples the REAL backdrop (glass over
    # a solid plate shows no refraction at all — the tier A/B would be unverifiable).
    assert re.search(r'<div class="ek-wins ek-onwall" id="ek-windows">', DEMO), (
        "the #ek-windows host must wear .ek-onwall (floated on the wallpaper)"
    )
    assert '<div class="ek-wins" id="ek-windows">' not in DEMO, (
        "the old in-card #ek-windows host must not come back"
    )
    # …and the host is NOT nested inside any section card (source-order check: the
    # windows section closes before the host opens).
    host = DEMO.index('id="ek-windows"')
    last_section_open = DEMO.rfind("<section", 0, host)
    last_section_close = DEMO.rfind("</section>", 0, host)
    assert last_section_close > last_section_open, (
        "KIT-G-04: #ek-windows must sit outside the <section class=ek-card> wrappers"
    )


def test_demo_busy_backdrop_is_default_and_deep_linkable():
    # KIT-G-03: the demo defaults to a BUSY, photo-like backdrop (the smooth pastel wash
    # measured glass-vs-frosted A/B diffs <=14/255 — too smooth to bend). Structure layers
    # in CSS + a seeded canvas noise tile from the driver; #bg=busy|smooth deep-link.
    assert "body.ek-bg-busy" in DEMO and "repeating-linear-gradient" in DEMO
    assert "--ek-noise-tile" in DEMO and "--ek-noise-tile" in DRIVER
    assert 'data-bg="busy"' in DEMO and 'data-bg="smooth"' in DEMO
    # busy is the DEFAULT (the driver's hash fallback), and the tile is seeded so every
    # screenshot sees the same texture.
    assert re.search(r'return \(m && VALID_BG\[m\[1\]\]\) \? m\[1\] : "busy"', DRIVER), (
        "KIT-G-03: the driver's bg hash fallback must be 'busy'"
    )
    assert "getContext" in DRIVER and "toDataURL" in DRIVER, (
        "KIT-G-03: the driver must synthesize the canvas noise tile"
    )
    # flat keeps its dark backdrop — the busy rule must carry the :not(.ek-flat) guard.
    assert "body.ek-bg-busy:not(.ek-flat)" in DEMO


def test_demo_status_gadget_mounts_the_real_panel_id():
    # KIT-F-04: orwellStatusPanel.js scopes its injected row CSS to the literal
    # #orwell-status; the old demo mount (ek-g-status) never matched it, so the rows
    # rendered run-together ("HOHYou"). The swatch mounts under the REAL id…
    assert '"orwell-status"' in DRIVER, "the demo status gadget must mount as id orwell-status"
    assert "ek-g-status" not in _no_comments_js(DRIVER), (
        "the mismatched ek-g-status mount must not come back"
    )
    # …opts out of collapse persistence (same-origin localStorage — the demo must never
    # read/write the app's own collapse key for this id)…
    m = re.search(r'id: "orwell-status".*?persistCollapsed:\s*false', DRIVER, re.S)
    assert m, "the demo orwell-status gadget must set persistCollapsed: false"
    # …and injects the row CSS under the SAME guard id the real panel uses.
    assert 'st.id = "orwell-status-css"' in DRIVER


def test_demo_status_css_copy_stays_in_sync_with_the_panel():
    # KIT-F-04 tripwire: the demo's injected status CSS is a DELIBERATE COPY of the
    # subset of rules the swatch composes — every copied rule must still exist,
    # declaration-for-declaration, in orwellStatusPanel.js (whitespace-insensitive).
    panel = _read("static", "js", "orwellStatusPanel.js")
    panel_norm = " ".join(panel.split())
    m = re.search(r'st\.textContent = `(.*?)`;', DRIVER, re.S)
    assert m, "the demo's injected status-CSS block not found in the driver"
    rules = re.findall(r'([^{}]+\{[^{}]*\})', m.group(1))
    assert len(rules) >= 8, f"expected the copied rule set, found {len(rules)}"
    for rule in rules:
        norm = " ".join(rule.split())
        assert norm in panel_norm, (
            "KIT-F-04: demo status-CSS copy drifted from orwellStatusPanel.js — "
            f"update the copy in orwellElements.js in the same change: {norm[:80]}…"
        )


def test_demo_traffic_swatches_ride_a_real_titlebar_context():
    # KIT-F-07: the glyph reveal rides an ANCESTOR rule (.ow-titlebar:hover …::before) in
    # style.css — the old swatch forced BUTTON opacity, which never revealed the ::before
    # glyphs. The swatch must wrap the cluster in a real .ow-titlebar…
    assert re.search(r'<div class="ow-titlebar[^"]*"><div class="ow-controls', DEMO), (
        "each traffic swatch must nest .ow-controls inside a real .ow-titlebar context"
    )
    assert "opacity: 1 !important" not in DEMO, (
        "the old broken glyph force (button opacity) must not come back"
    )
    # …force the app's own reveal for the still (the ::before color flip)…
    assert re.search(
        r"\.ek-traffic-hot \.ow-controls \.ow-close::before[\s\S]{0,200}?"
        r"color:\s*rgba\(0,\s*0,\s*0,\s*0?\.6\)", DEMO), (
        "the hot swatch must mirror style.css's ::before color reveal"
    )
    # …and show BOTH window-focus states, colors byte-matched to style.css (sync tripwire).
    assert "ek-traffic-focused" in DEMO and "ek-traffic-unfocused" in DEMO
    for hexc in ("#ff5f57", "#febc2e", "#28c840"):
        assert hexc in DEMO, f"swatch missing the focused traffic-light color {hexc}"
        assert hexc in CSS, f"style.css no longer uses {hexc} — update the demo copy too"
    # the demo copy explains that grey = unfocused BY DESIGN.
    assert re.search(r"unfocused[^<]*grey|grey[^<]*unfocused", DEMO, re.I), (
        "the demo copy must note that unfocused windows show grey lights by design"
    )


def test_demo_windows_are_forced_focused_for_the_reference():
    # KIT-F-07: 2 of 3 live demo windows rendered permanently-grey lights (the kit keeps
    # ONE window focused). The driver forces .ow-focused on all three so the reference
    # shows the colored cluster; the unfocused state has its own labeled swatch.
    assert re.search(r'classList\.add\("ow-focused"\)', DRIVER), (
        "the demo driver must force .ow-focused on the live demo windows"
    )
