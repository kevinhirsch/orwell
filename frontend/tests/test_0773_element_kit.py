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
