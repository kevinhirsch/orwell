"""M2-8 (road-to-market; audit B6 / r-11) — curate the game build's theme list.

The game build's "Show all themes" reveal used to list EVERY inherited workspace theme,
including off-brand names ("GPT", "claude", "organs", "cute") that shatter the Big Brother
fiction. M2-8 curates the game-build VIEW to an on-brand allowlist (core six + approved
atmospheric extras) while leaving the themes themselves intact — the full inherited set still
renders under ORWELL_GAME_BUILD=0, and Customize stays for power users.

Source-pinned: CI can't drive the live theme picker here, so we pin the WIRING by reading
static/js/theme.js — the allowlist, the off-brand denylist, and the game-build filter.
"""
import os
import re

FE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# The off-brand names r-11 flagged as breaking the fantasy — dropped from the game-build view.
OFF_BRAND = ("gpt", "claude", "organs", "cute")
# The curated on-brand set: the core six (glass default + five 0052 house themes) …
CORE_SIX = ("glass", "the-feed", "telescreen", "room-101", "memory-wall", "sequester")


def _read(rel):
    with open(os.path.join(FE, rel), encoding="utf-8") as fh:
        return fh.read()


def _allowlist_block(js):
    """The literal contents of the GAME_BUILD_THEME_ALLOWLIST Set(...) declaration."""
    m = re.search(
        r"const GAME_BUILD_THEME_ALLOWLIST = new Set\(\[(.*?)\]\)", js, re.DOTALL
    )
    assert m, "GAME_BUILD_THEME_ALLOWLIST must be declared as a Set literal in theme.js"
    return m.group(1)


def _allowlist_ids(js):
    return set(re.findall(r"'([^']+)'", _allowlist_block(js)))


def test_m2_8_allowlist_contains_the_core_six():
    ids = _allowlist_ids(_read("static/js/theme.js"))
    for name in CORE_SIX:
        assert name in ids, (
            f"the game-build theme allowlist must include the core theme '{name}' "
            "(glass default + the five 0052 house themes)."
        )


def test_m2_8_off_brand_themes_are_not_in_the_allowlist():
    ids = _allowlist_ids(_read("static/js/theme.js"))
    for name in OFF_BRAND:
        assert name not in ids, (
            f"'{name}' is an off-brand name that breaks the Big Brother fiction (r-11) — "
            "it must NOT be in the curated game-build allowlist."
        )


def test_m2_8_off_brand_themes_are_explicitly_denylisted():
    js = _read("static/js/theme.js")
    m = re.search(r"const GAME_BUILD_THEME_DENYLIST = new Set\(\[(.*?)\]\)", js, re.DOTALL)
    assert m, "the off-brand denylist must be declared for documentation + the source gate."
    deny = set(re.findall(r"'([^']+)'", m.group(1)))
    assert deny == set(OFF_BRAND), (
        "the game-build denylist must be exactly the r-11 off-brand names "
        f"{sorted(OFF_BRAND)}, got {sorted(deny)}."
    )


def test_m2_8_dropped_themes_still_exist_in_the_full_theme_set():
    """Curate the VIEW, do NOT delete themes — every dropped theme is still a real preset
    so ORWELL_GAME_BUILD=0 restores the full inherited set."""
    js = _read("static/js/theme.js")
    themes_block = js[js.index("const THEMES") : js.index("const DEFAULT_THEME")]
    for name in OFF_BRAND:
        # Preset keys are hyphen-safe bare identifiers or quoted; match the definition line.
        assert re.search(rf"(?m)^\s*{re.escape(name)}:\s*\{{", themes_block), (
            f"dropped theme '{name}' must remain defined in THEMES so it survives "
            "ORWELL_GAME_BUILD=0 (curate the view, never delete the theme)."
        )


def test_m2_8_game_build_render_filters_to_the_allowlist():
    js = _read("static/js/theme.js")
    # The game-build branch curates the rendered entries against the allowlist, keeping the
    # active pick visible so a power user's current theme is never hidden.
    assert "GAME_BUILD_THEME_ALLOWLIST.has(n)" in js, (
        "the game-build render branch must filter entries through the allowlist."
    )
    assert "n === activeName" in js, (
        "the active theme must stay visible even if it isn't on the allowlist "
        "(never hide a power user's current pick)."
    )


def test_m2_8_full_set_renders_outside_the_game_build():
    """The non-game-build branch renders every entry unfiltered (ORWELL_GAME_BUILD=0)."""
    js = _read("static/js/theme.js")
    # The else branch of the `if (_gameBuild)` block maps over the raw _entries with no
    # allowlist filter applied.
    marker = "} else {"
    start = js.index(marker, js.index("if (_gameBuild)")) + len(marker)
    else_branch = js[start:]
    else_branch = else_branch[: else_branch.index("}")]
    assert "_entries.map(_swatch)" in else_branch, (
        "outside the game build the picker must render the full inherited theme set."
    )


def test_m2_8_customize_stays_for_power_users():
    """Curation touches the preset picker only — the Customize path is untouched."""
    js = _read("static/js/theme.js")
    assert "_loadCustomThemes" in js and "themeUserGrid" in js, (
        "custom / Customize themes remain available for power users."
    )
