"""Lane G / G3 — sidebar coherence (ruling 2026-06-11).

Product-owner rulings, verbatim:
  "The buttons on the left hand sidebar have to make sense, as in they have
   to go somewhere, and they also all have to have equal padding"
  "for instance I don't think the tools button does anything"
  "buttons in the left hand side bar and buttons in general should have the
   same padding ... as The new chat and search buttons. those are the
   correct looking buttons."

Two pinned mechanisms:

1. PADDING — ONE standard. #sidebar carries a --sidebar-btn-pad token (8px,
   the New Chat / Search measure) and a single shared rule pads every sidebar
   button family from it. Per-button padding overrides in the sidebar region
   may not regrow.

2. DEAD AFFORDANCES — a section with <=1 visible row renders as a plain row
   (.section-no-collapse: chevron hidden, collapse toggle a no-op) and a
   section with no visible content hides outright (.section-empty). Under the
   game build (game-trim.css) every Tools child is trimmed, so its chevron
   was a button that visibly did nothing. Computed live in
   js/section-management.js; re-evaluated by a per-section MutationObserver.

The runtime half (computed padding uniform across all visible #sidebar
buttons; no chevron renders on a <=1-visible-child section) lives in
frontend/scripts/browser_smoke.py (the G3 block).
"""
import os
import re

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STYLE = os.path.join(FRONTEND, "static", "style.css")
SECTION_JS = os.path.join(FRONTEND, "static", "js", "section-management.js")
SMOKE = os.path.join(FRONTEND, "scripts", "browser_smoke.py")


def _read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


# ── 1. the padding standard ────────────────────────────────────────────────

def test_sidebar_padding_token_is_8px():
    css = _read(STYLE)
    assert re.search(r"#sidebar\s*\{\s*--sidebar-btn-pad:\s*8px;", css), (
        "#sidebar must define --sidebar-btn-pad: 8px — the New Chat / Search "
        ".list-item measure is THE sidebar padding standard (ruling G3)."
    )


def test_one_shared_rule_pads_every_sidebar_button_family():
    css = _read(STYLE)
    m = re.search(
        r"#sidebar \.list-item,\s*"
        r"#sidebar \.section-header-flex,\s*"
        r"#sidebar \.user-bar-btn,\s*"
        r"#sidebar \.user-bar-left\s*\{\s*"
        r"padding:\s*var\(--sidebar-btn-pad,\s*8px\);\s*\}",
        css,
    )
    assert m, (
        "The G3 shared rule (list-item / section-header-flex / user-bar-btn / "
        "user-bar-left, padding from --sidebar-btn-pad) must pad every sidebar "
        "button family — one rule, not per-button overrides."
    )


def test_user_bar_cluster_measures_the_standard_not_6px():
    css = _read(STYLE)
    # The pre-G3 state: .user-bar-btn at 6px and .user-bar-left at 6px 8px.
    for sel in (".user-bar-btn", ".user-bar-left"):
        block = re.search(re.escape(sel) + r"\s*\{([^}]*)\}", css).group(1)
        assert "padding: 6px" not in block, (
            f"{sel} regrew its own 6px padding — the bottom cluster measures "
            "the same standard as New Chat / Search (var(--sidebar-btn-pad))."
        )
        assert "--sidebar-btn-pad" in block, (
            f"{sel} must take its padding from the --sidebar-btn-pad token."
        )


def test_no_per_button_sidebar_padding_overrides_regrow():
    css = _read(STYLE)
    # The pre-G3 per-button overrides, removed in favor of the shared rule.
    assert not re.search(r"#tools-section \.list-item\s*\{[^}]*padding", css), (
        "#tools-section .list-item padding override regrew — the shared "
        "#sidebar .list-item rule owns sidebar row padding."
    )
    nc = re.search(
        r"#sidebar-search-btn,\s*#sidebar-new-chat-btn\s*\{([^}]*)\}", css
    ).group(1)
    assert "padding" not in nc, (
        "#sidebar-new-chat-btn/#sidebar-search-btn carry their own padding "
        "again — they are plain .list-item rows; the shared rule is the standard."
    )


def test_mobile_tracks_the_same_token():
    css = _read(STYLE)
    assert re.search(r"--sidebar-btn-pad:\s*12px 10px;", css), (
        "On mobile the standard is the touch-size 12px 10px — the token must "
        "be redefined there so the user-bar cluster matches the rows."
    )


# ── 2. dead affordances ────────────────────────────────────────────────────

def test_affordance_classes_are_computed_live():
    js = _read(SECTION_JS)
    assert "updateSectionAffordance" in js
    assert "section-no-collapse" in js and "section-empty" in js, (
        "section-management.js must compute .section-no-collapse / "
        ".section-empty — a chevron on a <=1-visible-row section is a dead "
        "affordance (ruling G3: every sidebar button visibly does something)."
    )
    assert "MutationObserver" in js, (
        "Affordances must re-evaluate live (UI-vis inline styles and async "
        "session rows change visibility after init)."
    )


def test_collapse_toggle_is_a_noop_on_plain_rows():
    js = _read(SECTION_JS)
    assert re.search(
        r"if \(section\.classList\.contains\('section-no-collapse'\)\) return;", js
    ), (
        "toggleCollapse must early-return on .section-no-collapse — hiding "
        "the chevron without disarming the title/section click would leave an "
        "invisible button that still fires."
    )


def test_css_hides_dead_chevrons_and_empty_sections():
    css = _read(STYLE)
    assert re.search(
        r"\.section\.section-no-collapse \.section-collapse-btn\s*\{\s*display:\s*none !important;", css
    ), (
        ".section-no-collapse must hide the chevron with !important (the "
        ".section.collapsed rule forces it visible with !important)."
    )
    assert re.search(
        r"\.section\.section-empty\s*\{\s*display:\s*none !important;", css
    ), "A section with no visible content must hide outright (.section-empty)."


def test_browser_smoke_carries_the_g3_runtime_gate():
    smoke = _read(SMOKE)
    assert "G3: every visible sidebar button measures the one 8px padding standard" in smoke
    assert "G3: no collapse chevron renders on a <=1-visible-child section" in smoke
    # Anchored directly after the F-3 kit-seam check, per the lane brief.
    f3 = smoke.index("F-3: the kit seam answers")
    g3 = smoke.index("G3 (sidebar coherence")
    assert g3 > f3, "the G3 smoke block sits after the F-3 kit-seam block"
