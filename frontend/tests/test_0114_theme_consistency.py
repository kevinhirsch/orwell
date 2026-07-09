"""0114 — the theme-surface-consistency gate's unit tests (browser-free).

Exercises the PURE pieces — the classifier (`src/theme_probe.py`) and the harness's own
matrix/XFAIL/report shaping (`scripts/theme_consistency.py`) — against synthetic fixtures, with
NO Playwright/browser dependency anywhere in this file (mirrors `test_0113_visual_harness.py`'s
discipline so this stays in the fast, parallel `fe-unit` lane rather than `fe-browser-tests`).

Roles only — no cast/game content in any fixture here.
"""
from __future__ import annotations

import os
import sys

FRONTEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if FRONTEND_DIR not in sys.path:
    sys.path.insert(0, FRONTEND_DIR)

from scripts import theme_consistency as tc  # noqa: E402
from src import theme_probe as tp  # noqa: E402

LIGHT_TOKENS = {"bg": "#f0ebe3", "panel": "#faf6f0"}
DARK_TOKENS = {"bg": "#282c34", "panel": "#111111"}


def _el(selector="#thing", *, layers, label=None):
    return {"selector": selector, "id": selector.lstrip("#"), "label": label or selector,
            "layers": layers}


# ── color parsing ────────────────────────────────────────────────────────────────────────


def test_parse_color_hex_6_digit():
    assert tp.parse_color("#f0ebe3") == (240.0, 235.0, 227.0, 1.0)


def test_parse_color_hex_3_digit():
    assert tp.parse_color("#abc") == (170.0, 187.0, 204.0, 1.0)


def test_parse_color_rgb():
    assert tp.parse_color("rgb(240, 235, 227)") == (240.0, 235.0, 227.0, 1.0)


def test_parse_color_rgba():
    assert tp.parse_color("rgba(13, 15, 20, 0.5)") == (13.0, 15.0, 20.0, 0.5)


def test_parse_color_transparent_keyword():
    assert tp.parse_color("transparent") == (0.0, 0.0, 0.0, 0.0)


def test_parse_color_empty_or_unparseable_is_none():
    assert tp.parse_color("") is None
    assert tp.parse_color(None) is None
    assert tp.parse_color("currentColor") is None


# ── compositing ──────────────────────────────────────────────────────────────────────────


def test_composite_layers_fully_opaque_own_layer_wins_outright():
    # the element's OWN opaque background (layers[0]) must win regardless of ancestors —
    # exactly the fixed orwellHeadshot.js #0d0f14 bug shape (the tile declared its own solid
    # color; nothing an ancestor does can rescue that).
    result = tp.composite_layers(["rgb(13, 15, 20)", "rgb(250, 246, 240)", "rgb(0, 0, 0)"])
    assert result == (13.0, 15.0, 20.0)


def test_composite_layers_fully_transparent_stack_is_none():
    result = tp.composite_layers(["transparent", "rgba(0, 0, 0, 0)", "transparent"])
    assert result is None


def test_composite_layers_transparent_element_inherits_ancestor():
    # the element itself declares nothing; the nearest real ancestor color wins.
    result = tp.composite_layers(["transparent", "rgb(17, 17, 17)"])
    assert result == (17.0, 17.0, 17.0)


def test_composite_layers_partial_alpha_blends_over_the_base():
    # a 50% white wash over a dark panel lightens it — not a full white takeover.
    result = tp.composite_layers(["rgba(255, 255, 255, 0.5)", "rgb(17, 17, 17)"])
    assert result == (136.0, 136.0, 136.0)


def test_composite_layers_unparseable_layers_are_skipped():
    result = tp.composite_layers(["currentColor", "rgb(17, 17, 17)"])
    assert result == (17.0, 17.0, 17.0)


# ── the classifier ───────────────────────────────────────────────────────────────────────


def test_classifier_flat_match_to_panel_is_clean():
    els = [_el(layers=["rgb(250, 246, 240)"])]  # == light's --panel exactly
    assert tp.classify_theme_findings(els, LIGHT_TOKENS) == []


def test_classifier_flat_match_to_bg_is_clean():
    els = [_el(layers=["rgb(240, 235, 227)"])]  # == light's --bg exactly
    assert tp.classify_theme_findings(els, LIGHT_TOKENS) == []


def test_classifier_inherits_nothing_declared_is_clean():
    els = [_el(layers=["transparent"])]
    assert tp.classify_theme_findings(els, LIGHT_TOKENS) == []


def test_classifier_subtle_wash_over_panel_is_not_flagged():
    # the class of tint several game-build surfaces legitimately use (a 5% white wash meant to
    # lighten a chip slightly) — must stay well under the offender threshold on EITHER theme.
    wash = ["rgba(255, 255, 255, 0.05)", "rgb(17, 17, 17)"]  # dark theme panel
    assert tp.classify_theme_findings([_el(layers=wash)], DARK_TOKENS) == []
    wash_light = ["rgba(255, 255, 255, 0.05)", "rgb(250, 246, 240)"]  # light theme panel
    assert tp.classify_theme_findings([_el(layers=wash_light)], LIGHT_TOKENS) == []


def test_classifier_foreign_fixed_dark_on_light_theme_is_flagged():
    # the EXACT regression this gate's first live audit found and this change fixed: a
    # hardcoded #0d0f14 tile (orwellHeadshot.js's .hs-cand/.hs-preview/.hs-libitem, pre-fix)
    # rendered against the `light` preset's near-white panel/bg.
    els = [_el(selector=".hs-cand", layers=["rgb(13, 15, 20)"])]
    findings = tp.classify_theme_findings(els, LIGHT_TOKENS)
    assert len(findings) == 1
    assert findings[0]["kind"] == "foreign-polarity"
    assert findings[0]["selector"] == ".hs-cand"


def test_classifier_same_foreign_fixed_color_on_dark_theme_is_clean():
    # the asymmetry is the whole point: #0d0f14 happens to sit close to the DARK theme's own
    # --panel (#111111), so it is legitimately not a finding there — the bug is polarity-
    # specific, and the classifier must not over-fire on the theme where it happens to look ok.
    els = [_el(layers=["rgb(13, 15, 20)"])]
    assert tp.classify_theme_findings(els, DARK_TOKENS) == []


def test_classifier_missing_tokens_returns_no_findings():
    els = [_el(layers=["rgb(13, 15, 20)"])]
    assert tp.classify_theme_findings(els, {}) == []


def test_classifier_multiple_elements_multiple_findings():
    els = [
        _el(selector=".a", layers=["rgb(13, 15, 20)"]),
        _el(selector=".b", layers=["rgb(250, 246, 240)"]),  # clean
        _el(selector=".c", layers=["rgb(5, 5, 5)"]),
    ]
    findings = tp.classify_theme_findings(els, LIGHT_TOKENS)
    assert {f["selector"] for f in findings} == {".a", ".c"}


def test_theme_probe_js_is_a_nonempty_function_string():
    assert tp.THEME_PROBE_JS.strip().startswith("(")
    assert "getComputedStyle" in tp.THEME_PROBE_JS
    assert "--bg" in tp.THEME_PROBE_JS and "--panel" in tp.THEME_PROBE_JS


# ── theme_consistency.py's own matrix / XFAIL / report shaping ─────────────────────────────


def test_base_theme_count_matches_the_design():
    assert set(tc.THEME_NAMES) == {"light", "dark"}


def test_base_theme_colors_are_well_formed():
    for name, colors in tc.BASE_THEME_COLORS.items():
        for key in ("bg", "fg", "panel", "border", "red"):
            assert tp.parse_color(colors[key]) is not None, f"{name}.{key} must parse as a color"


def test_viewport_count_matches_the_design():
    assert [v[0] for v in tc.VIEWPORTS] == ["phone-390", "wide-1440"]


def test_theme_seed_script_is_valid_looking_js_for_every_base_theme():
    for name in tc.THEME_NAMES:
        js = tc.theme_seed_script(name)
        assert "localStorage.setItem('orwell-theme'" in js
        assert f"name: '{name}'" in js


def test_theme_seed_script_unknown_theme_raises():
    try:
        tc.theme_seed_script("not-a-real-theme")
        assert False, "expected a KeyError for an unregistered theme"
    except KeyError:
        pass


def test_finding_line_shape_is_stable_for_registry_matching():
    line = tc.finding_line("theme:light:wide-1440:midweek", {
        "kind": "foreign-polarity", "label": "div.hs-cand", "detail": "rendered bg rgb(13,15,20) is 689 from ..."})
    assert line == ("theme:light:wide-1440:midweek foreign-polarity div.hs-cand: "
                    "rendered bg rgb(13,15,20) is 689 from ...")


def test_split_xfail_demotes_a_registered_finding_and_blocks_the_rest():
    finding = {"kind": "foreign-polarity", "selector": ".hs-cand", "id": None,
              "label": "div.hs-cand", "detail": "rendered bg rgb(13,15,20) is 689 from --bg/--panel"}
    novel = {"kind": "foreign-polarity", "selector": "#sidebar", "id": "sidebar",
            "label": "nav#sidebar", "detail": "rendered bg rgb(1,1,1) is 700 from --bg/--panel"}
    fake_registry = {"TS-1": {"shot": "theme:light:", "needle": "div.hs-cand"}}
    orig = tc.XFAIL
    tc.XFAIL = fake_registry
    try:
        blocking, xfailed = tc.split_xfail("theme:light:wide-1440:midweek", [finding, novel])
        assert blocking == [novel]
        assert len(xfailed) == 1 and xfailed[0]["xfail_id"] == "TS-1"
    finally:
        tc.XFAIL = orig


def test_split_xfail_with_no_registry_match_blocks_everything():
    finding = {"kind": "foreign-polarity", "selector": "#x", "id": "x", "label": "div#x",
              "detail": "rendered bg rgb(1,1,1) is 700 from --bg/--panel"}
    blocking, xfailed = tc.split_xfail("theme:dark:phone-390:midweek", [finding])
    assert blocking == [finding]
    assert xfailed == []


def test_xfail_scope_does_not_demote_the_same_defect_on_another_shot():
    finding = {"kind": "foreign-polarity", "selector": ".hs-cand", "id": None,
              "label": "div.hs-cand", "detail": "rendered bg rgb(13,15,20) is 689 from --bg/--panel"}
    fake_registry = {"TS-1": {"shot": "theme:light:wide-1440:", "needle": "div.hs-cand"}}
    orig = tc.XFAIL
    tc.XFAIL = fake_registry
    try:
        # the SAME finding text, but on a DIFFERENT shot (phone-390, not wide-1440) — the
        # registry entry's shot-prefix scope must not demote it.
        blocking, xfailed = tc.split_xfail("theme:light:phone-390:midweek", [finding])
        assert xfailed == [] and blocking == [finding]
    finally:
        tc.XFAIL = orig


def test_every_xfail_entry_has_a_finding_id_and_live_form_scope():
    """0113 shipped a bug where an XFAIL scope was written in the on-disk `__`-encoded filename
    form instead of the live colon-delimited shot id — it silently matched nothing (the PR #1244
    review P1 fix). `theme_consistency.XFAIL` is empty at ship time (the one real finding this
    gate's first audit produced was fixed in the same change, not parked here) — this test both
    documents the contract for any FUTURE entry and, via the synthetic case below, proves the
    live-form assertion actually catches the encoded-form mistake rather than trivially passing
    on an empty dict."""
    for fid, ent in tc.XFAIL.items():
        assert isinstance(ent, dict) and set(ent) == {"shot", "needle"}
        assert isinstance(ent["needle"], str) and len(ent["needle"]) > 5
        assert isinstance(ent["shot"], str) and len(ent["shot"]) >= 6
        assert ent["shot"].startswith("theme:"), \
            f"XFAIL {fid!r} shot scope {ent['shot']!r} is not a live-format shot-id prefix"
        assert "__" not in ent["shot"], \
            f"XFAIL {fid!r} shot scope {ent['shot']!r} uses the filename encoding, not the shot id"


def test_live_form_scope_actually_matches_while_encoded_form_does_not():
    """The synthetic proof the previous test's empty-registry loop can't provide on its own:
    a LIVE-form shot prefix matches the real shot id split_xfail is called with; the SAME
    entry written in the `__`-encoded filename form (the 0113 mistake) does not."""
    finding = {"kind": "foreign-polarity", "selector": ".hs-cand", "id": None,
              "label": "div.hs-cand", "detail": "rendered bg rgb(13,15,20) is 689 from --bg/--panel"}
    shot_id = "theme:light:wide-1440:midweek"
    orig = tc.XFAIL
    try:
        tc.XFAIL = {"TS-1": {"shot": "theme:light:", "needle": "div.hs-cand"}}
        _, xfailed_live = tc.split_xfail(shot_id, [dict(finding)])
        assert len(xfailed_live) == 1, "a live-form shot prefix must match the live shot id"

        tc.XFAIL = {"TS-1": {"shot": "theme__light__", "needle": "div.hs-cand"}}
        blocking_encoded, xfailed_encoded = tc.split_xfail(shot_id, [dict(finding)])
        assert xfailed_encoded == [] and blocking_encoded == [finding], (
            "an encoded-form scope must NOT match the live shot id — this is the exact 0113 "
            "bug class this test guards against")
    finally:
        tc.XFAIL = orig


def test_theme_registry_covers_the_named_surface_families():
    reg = " ".join(tc.THEME_REGISTRY)
    assert ".ow-window" in reg
    assert ".ow-sheet" in reg
    assert "gadget-rail" in reg
    assert "sidebar" in reg.lower()


def test_open_surfaces_polls_for_async_mounted_headshot_tiles_not_a_fixed_sleep():
    """Live verification (see the design note's 'Harness gotcha') caught a real false-negative:
    OrwellHeadshotStudio.mount() kicks off an async fetch before its first render(), so
    `.hs-preview` doesn't exist yet right after the account-tab click — a fixed short sleep let
    the first live sweep report a false-clean 0 findings against a still-buggy file. This pins
    that `_open_surfaces` polls (bounded) for the tile to exist rather than trusting a sleep."""
    import pathlib
    src = (pathlib.Path(__file__).parents[1] / "scripts" / "theme_consistency.py").read_text()
    assert "_wait_for_selector" in src
    assert ".hs-preview" in src and "budget_polls" in src


def test_write_report_and_summary_produce_expected_files(tmp_path):
    out = str(tmp_path)
    findings = {"theme:light:wide-1440:midweek": [
        {"kind": "foreign-polarity", "selector": ".x", "id": None, "label": "div.x", "detail": "d"}]}
    tokens = {"theme:light:wide-1440:midweek": {"bg": "#f0ebe3", "panel": "#faf6f0"}}
    report_path = tc._write_report(out, "theme_report.json", {
        "format": 1, "total_findings": 1, "shots": findings})
    summary_path = tc._write_summary_md(out, wall_seconds=1.2, findings=findings, xfails={},
                                        tokens=tokens, errors=[])
    assert os.path.isfile(report_path) and os.path.isfile(summary_path)
    summary = open(summary_path, encoding="utf-8").read()
    assert "BLOCKING" in summary
    assert "foreign-polarity" in summary


def test_write_summary_reports_clean_run_as_clean(tmp_path):
    summary_path = tc._write_summary_md(str(tmp_path), wall_seconds=0.5, findings={}, xfails={},
                                        tokens={"theme:dark:phone-390:midweek": {"bg": "x", "panel": "y"}},
                                        errors=[])
    summary = open(summary_path, encoding="utf-8").read()
    assert "clean" in summary
    assert "BLOCKING" not in summary


def test_harness_errors_block_the_exit_code():
    """Mirrors visual_regression.py's same rule (PR #1244 review P1): a capture/setup failure
    must fail the process even with zero findings — never a silent pass."""
    import pathlib
    src = (pathlib.Path(__file__).parents[1] / "scripts" / "theme_consistency.py").read_text()
    assert "return 1 if (total_findings or all_errors) else 0" in src


def test_shot_id_scheme_is_the_documented_colon_form():
    # theme:<name>:<viewport>:<moment> — the form every XFAIL entry and report key must use.
    import re
    assert re.match(r"^theme:[a-z]+:[a-z0-9-]+:[a-z]+$", "theme:light:wide-1440:midweek")
