"""0113 — the visual-regression harness unit gates (browser-free).

These tests exercise the PURE pieces of the harness — the geometry classifier, the pixel-diff
math, the baseline manifest, and the harness's own report shaping — against synthetic
fixtures, with NO Playwright/browser dependency anywhere in this file (the literal string
that flips `conftest.py`'s structural browser-lane marker never appears here, so this file
stays in the fast, parallel `fe-unit` xdist lane rather than the serial `fe-browser-tests`
lane). A companion `test_0113_visual_harness_browser.py` proves the JS extraction snippet
itself against a real (but tiny, synthetic, engine-free) DOM — that one legitimately needs a
browser and carries the `browser` marker.

Roles only — no cast/game content in any fixture here.
"""
from __future__ import annotations

import json
import os
import pathlib
import sys

import pytest
from PIL import Image

FRONTEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if FRONTEND_DIR not in sys.path:
    sys.path.insert(0, FRONTEND_DIR)

from scripts import visual_regression as vr  # noqa: E402
from src import visual_geometry as vg  # noqa: E402
from src import visual_manifest as vm  # noqa: E402
from src import visual_pixeldiff as vp  # noqa: E402

VIEWPORT = {"width": 390, "height": 844}


def _el(selector="#thing", *, left, top, right, bottom, clipping=None, covered_by=None,
       self_or_desc=True):
    return {
        "selector": selector, "id": selector.lstrip("#"), "label": selector,
        "rect": {"left": left, "top": top, "right": right, "bottom": bottom,
                "width": right - left, "height": bottom - top},
        "clippingAncestor": clipping, "coveredBy": covered_by,
        "coveredBySelfOrDescendant": self_or_desc,
    }


# ── geometry classifier ────────────────────────────────────────────────────────────────


def test_geometry_classifier_clean_element_has_no_findings():
    el = _el(left=10, top=10, right=100, bottom=60)
    findings = vg.classify_shot_geometry([el], VIEWPORT)
    assert findings == []


def test_geometry_classifier_zero_size():
    el = _el(left=10, top=10, right=10, bottom=10)  # width=height=0
    findings = vg.classify_shot_geometry([el], VIEWPORT)
    assert len(findings) == 1
    assert findings[0]["kind"] == "zero-size"


def test_geometry_classifier_zero_size_short_circuits_other_checks():
    # a 0x0 element that is ALSO technically off-viewport and "covered" must report ONLY
    # zero-size — a degenerate element can't be meaningfully off-viewport/covered too.
    el = _el(left=-50, top=-50, right=-50, bottom=-50, covered_by="div.other", self_or_desc=False)
    findings = vg.classify_shot_geometry([el], VIEWPORT)
    assert [f["kind"] for f in findings] == ["zero-size"]


@pytest.mark.parametrize("rect", [
    dict(left=-200, top=10, right=-100, bottom=60),        # entirely left of the viewport
    dict(left=10, top=-200, right=100, bottom=-100),        # entirely above
    dict(left=500, top=10, right=600, bottom=60),           # entirely right (vw=390)
    dict(left=10, top=1000, right=100, bottom=1100),        # entirely below (vh=844)
])
def test_geometry_classifier_off_viewport(rect):
    el = _el(**rect)
    findings = vg.classify_shot_geometry([el], VIEWPORT)
    assert [f["kind"] for f in findings] == ["off-viewport"]


def test_geometry_classifier_partially_offscreen_is_not_flagged():
    # an element straddling the viewport edge (e.g. a drawer mid-slide) is legitimate —
    # only WHOLLY off-viewport elements are a finding.
    el = _el(left=-20, top=10, right=100, bottom=60)
    findings = vg.classify_shot_geometry([el], VIEWPORT)
    assert findings == []


def test_geometry_classifier_clipped_by_ancestor():
    ancestor_rect = {"left": 0, "top": 0, "right": 200, "bottom": 200,
                     "width": 200, "height": 200}
    el = _el(left=150, top=10, right=260, bottom=60,
             clipping={"label": "div#scroller", "rect": ancestor_rect})
    findings = vg.classify_shot_geometry([el], VIEWPORT)
    assert [f["kind"] for f in findings] == ["clipped-by-ancestor"]
    assert "div#scroller" in findings[0]["detail"]


def test_geometry_classifier_inside_clipping_ancestor_is_clean():
    ancestor_rect = {"left": 0, "top": 0, "right": 200, "bottom": 200,
                     "width": 200, "height": 200}
    el = _el(left=10, top=10, right=100, bottom=60,
             clipping={"label": "div#scroller", "rect": ancestor_rect})
    findings = vg.classify_shot_geometry([el], VIEWPORT)
    assert findings == []


def test_geometry_classifier_covered():
    el = _el(left=10, top=10, right=100, bottom=60,
             covered_by="div.modal-scrim", self_or_desc=False)
    findings = vg.classify_shot_geometry([el], VIEWPORT)
    assert [f["kind"] for f in findings] == ["covered"]
    assert "modal-scrim" in findings[0]["detail"]


def test_geometry_classifier_covered_by_own_descendant_is_clean():
    # elementFromPoint resolving to a CHILD (an icon inside a button) is normal, not a finding.
    el = _el(left=10, top=10, right=100, bottom=60,
             covered_by="span.icon", self_or_desc=True)
    findings = vg.classify_shot_geometry([el], VIEWPORT)
    assert findings == []


def test_geometry_classifier_covered_by_deliberate_overlay_is_clean():
    # a covering node the probe stamped coveredByOverlay (a modal scrim, the boot loader, an
    # open drawer, a kit window) is the layering system WORKING — never a finding. This was
    # the first live run's dominant false-positive class (219 of 223 covered-findings).
    el = _el(left=10, top=10, right=100, bottom=60,
             covered_by="div.ow-scrim", self_or_desc=False)
    el["coveredByOverlay"] = True
    findings = vg.classify_shot_geometry([el], VIEWPORT)
    assert findings == []


def test_geometry_classifier_covered_by_non_overlay_still_blocks():
    el = _el(left=10, top=10, right=100, bottom=60,
             covered_by="div.stray-panel", self_or_desc=False)
    el["coveredByOverlay"] = False
    findings = vg.classify_shot_geometry([el], VIEWPORT)
    assert [f["kind"] for f in findings] == ["covered"]


def test_geometry_classifier_multiple_elements_multiple_findings():
    els = [
        _el("#a", left=10, top=10, right=100, bottom=60),
        _el("#b", left=-999, top=10, right=-900, bottom=60),
        _el("#c", left=5, top=5, right=5, bottom=5),
    ]
    findings = vg.classify_shot_geometry(els, VIEWPORT)
    kinds = sorted(f["kind"] for f in findings)
    assert kinds == ["off-viewport", "zero-size"]


def test_geometry_probe_js_is_a_nonempty_function_string():
    # a lightweight sanity check that the extraction snippet is well-formed enough to be
    # injected — the REAL DOM behavior is proven in the companion browser test.
    assert "elementFromPoint" in vg.GEOMETRY_PROBE_JS
    assert "querySelectorAll" in vg.GEOMETRY_PROBE_JS


# ── pixel diff ──────────────────────────────────────────────────────────────────────────


def _solid(color, size=(40, 40)):
    return Image.new("RGB", size, color)


def test_pixeldiff_identical_images_match():
    a, b = _solid((10, 20, 30)), _solid((10, 20, 30))
    result, highlight = vp.diff_images(a, b, shot_id="s1")
    assert result.status == "match"
    assert result.diff_ratio == 0.0
    assert highlight is None


def test_pixeldiff_different_images_diff():
    a, b = _solid((0, 0, 0)), _solid((255, 255, 255))
    result, highlight = vp.diff_images(a, b, shot_id="s2")
    assert result.status == "diff"
    assert result.diff_ratio == pytest.approx(1.0)
    assert result.differing_pixels == result.total_pixels
    assert highlight is not None
    assert highlight.size == a.size


def test_pixeldiff_size_mismatch():
    a, b = _solid((0, 0, 0), (40, 40)), _solid((0, 0, 0), (50, 60))
    result, highlight = vp.diff_images(a, b, shot_id="s3")
    assert result.status == "size-mismatch"
    assert result.baseline_size == (40, 40)
    assert result.candidate_size == (50, 60)
    assert highlight is None


def test_pixeldiff_below_channel_threshold_is_not_a_diff():
    # a 1-value nudge per channel is well under the default threshold — benign AA jitter.
    a = Image.new("RGB", (20, 20), (100, 100, 100))
    b = Image.new("RGB", (20, 20), (101, 100, 100))
    result, _ = vp.diff_images(a, b, shot_id="s4")
    assert result.status == "match"


def test_pixeldiff_mask_suppresses_a_would_be_diff():
    # a "clock" region differs between baseline/candidate; masking it makes the shots match.
    a = _solid((10, 10, 10))
    b = a.copy()
    for x in range(30, 40):
        for y in range(30, 40):
            b.putpixel((x, y), (250, 250, 250))
    unmasked, _ = vp.diff_images(a, b, shot_id="s5")
    assert unmasked.status == "diff"
    masked, _ = vp.diff_images(a, b, shot_id="s5",
                               masks=[vp.MaskRect(left=25, top=25, right=45, bottom=45,
                                                  reason="wall clock")])
    assert masked.status == "match"
    assert masked.masks_applied == 1


def test_pixeldiff_mask_out_of_bounds_is_clamped_not_an_error():
    a, b = _solid((1, 2, 3)), _solid((1, 2, 3))
    result, _ = vp.diff_images(a, b, shot_id="s6",
                               masks=[vp.MaskRect(left=-100, top=-100, right=10000, bottom=10000)])
    assert result.status == "match"


def test_pixeldiff_summarize_schema():
    a, b = _solid((0, 0, 0)), _solid((255, 255, 255))
    r1, _ = vp.diff_images(a, b, shot_id="diff-one")
    r2, _ = vp.diff_images(a, a, shot_id="match-one")
    report = vp.summarize([r1, r2])
    assert report["total"] == 2
    assert report["by_status"] == {"diff": 1, "match": 1}
    assert {s["shot_id"] for s in report["shots"]} == {"diff-one", "match-one"}
    for shot in report["shots"]:
        for key in ("shot_id", "status", "diff_ratio", "differing_pixels", "total_pixels",
                    "masks_applied", "detail"):
            assert key in shot


def test_pixeldiff_triptych_has_three_panels_worth_of_width():
    a, b = _solid((0, 0, 0)), _solid((255, 255, 255))
    _result, highlight = vp.diff_images(a, b, shot_id="s7")
    trip = vp.make_triptych(a, b, highlight)
    # three 40px panels + 2x4px gutters = 128
    assert trip.size == (128, 40)


def test_pixeldiff_triptych_no_baseline_still_renders_a_labeled_placeholder():
    b = _solid((5, 5, 5))
    trip = vp.make_triptych(None, b, None)
    assert trip.size[0] > b.size[0]  # at least the placeholder + candidate panels


# ── baseline manifest / bless round-trip ──────────────────────────────────────────────────


def _make_png(path, color=(1, 2, 3), size=(10, 10)):
    Image.new("RGB", size, color).save(path)


def test_manifest_bless_round_trip(tmp_path):
    run_dir = tmp_path / "run1" / "shots"
    run_dir.mkdir(parents=True)
    _make_png(run_dir / "tierA__chat__phone-390__glass.png")
    _make_png(run_dir / "tierB__eviction__wide-1440.png", color=(9, 9, 9))

    baselines = tmp_path / "baselines"
    manifest = vm.bless_run(str(run_dir), str(baselines), source="ci-artifact:run-1")

    assert len(manifest.entries) == 2
    # on-disk filenames use "__" (see `visual_manifest.encode_shot_id`); the manifest's shot
    # ids decode back to the canonical colon-delimited form the harness's reports use.
    assert set(manifest.entries) == {"tierA:chat:phone-390:glass", "tierB:eviction:wide-1440"}
    for _shot_id, entry in manifest.entries.items():
        assert entry.sha256 == vm.sha256_file(str(baselines / entry.path))
        assert entry.source == "ci-artifact:run-1"

    on_disk = vm.load_manifest(str(baselines))
    assert on_disk.to_dict() == manifest.to_dict()

    # PNG bytes are actually retrievable through the manifest, byte-identical to the source.
    data = vm.baseline_bytes(str(baselines), "tierB:eviction:wide-1440", on_disk)
    assert data == (run_dir / "tierB__eviction__wide-1440.png").read_bytes()


def test_manifest_bless_is_idempotent_when_content_is_unchanged(tmp_path):
    run_dir = tmp_path / "run1" / "shots"
    run_dir.mkdir(parents=True)
    _make_png(run_dir / "shot-a.png")
    baselines = tmp_path / "baselines"

    m1 = vm.bless_run(str(run_dir), str(baselines), source="ci-artifact:1")
    m2 = vm.bless_run(str(run_dir), str(baselines), source="ci-artifact:2")
    delta = vm.diff_manifests(m1, m2)
    assert delta == {"added": [], "removed": [], "changed": []}
    # re-blessing still updates provenance even with no pixel change.
    assert m2.entries["shot-a"].source == "ci-artifact:2"


def test_manifest_bless_detects_added_removed_changed(tmp_path):
    run1 = tmp_path / "run1" / "shots"
    run1.mkdir(parents=True)
    _make_png(run1 / "keep.png", color=(1, 1, 1))
    _make_png(run1 / "drop.png", color=(2, 2, 2))
    baselines = tmp_path / "baselines"
    m1 = vm.bless_run(str(run1), str(baselines), source="ci-artifact:1")

    run2 = tmp_path / "run2" / "shots"
    run2.mkdir(parents=True)
    _make_png(run2 / "keep.png", color=(9, 9, 9))   # changed pixels
    _make_png(run2 / "new.png", color=(3, 3, 3))    # added
    # NB: bless_run only ADDS/UPDATES entries present in the new run dir — "drop.png" is not
    # in run2, so it stays in the manifest (a bless is additive-by-default; pruning stale
    # baseline ids is a deliberate separate operation, not implemented here to avoid an
    # accidental mass-delete from a partial run).
    m2 = vm.bless_run(str(run2), str(baselines), source="ci-artifact:2")
    delta = vm.diff_manifests(m1, m2)
    assert delta["added"] == ["new"]
    assert delta["changed"] == ["keep"]
    assert delta["removed"] == []


def test_manifest_bless_raises_on_empty_run_dir(tmp_path):
    empty = tmp_path / "empty"
    empty.mkdir()
    with pytest.raises(FileNotFoundError):
        vm.bless_run(str(empty), str(tmp_path / "baselines"), source="ci-artifact:x")


def test_manifest_bless_raises_on_missing_run_dir(tmp_path):
    with pytest.raises(FileNotFoundError):
        vm.bless_run(str(tmp_path / "does-not-exist"), str(tmp_path / "baselines"),
                    source="ci-artifact:x")


def test_manifest_load_of_absent_manifest_is_empty_not_an_error(tmp_path):
    m = vm.load_manifest(str(tmp_path / "nowhere"))
    assert m.entries == {}


def test_manifest_save_is_atomic_and_round_trips(tmp_path):
    baselines = tmp_path / "baselines"
    manifest = vm.Manifest(entries={
        "x": vm.BaselineEntry(shot_id="x", path="x.png", sha256="deadbeef"),
    })
    path = vm.save_manifest(str(baselines), manifest)
    assert os.path.isfile(path)
    with open(path) as fh:
        data = json.load(fh)
    assert data["format"] == vm.MANIFEST_FORMAT
    assert data["shots"]["x"]["sha256"] == "deadbeef"
    reloaded = vm.load_manifest(str(baselines))
    assert reloaded.entries["x"].sha256 == "deadbeef"


# ── missing-baseline ⇒ notice, never a silent pass ─────────────────────────────────────────


def test_missing_baseline_is_reported_not_silently_skipped():
    baselines_empty = None  # simulate via baseline_bytes directly against an empty dir
    import tempfile
    with tempfile.TemporaryDirectory() as d:
        result = vm.baseline_bytes(d, "no-such-shot")
        assert result is None  # the harness's caller must treat this as SKIPPED-with-notice


def test_visual_walk_pixel_diff_reports_missing_baseline_explicitly(tmp_path):
    """End-to-end (still browser-free) through `VisualWalk.run_pixel_diffs`: a shot with no
    blessed baseline must show up as an EXPLICIT `baseline-missing` entry with a human-
    readable notice, never silently omitted from the report or silently marked as a pass."""
    out_dir = tmp_path / "run"
    (out_dir / "shots").mkdir(parents=True)
    shot_path = out_dir / "shots" / "tierA__settings__phone-390__glass.png"
    _make_png(shot_path, color=(7, 7, 7), size=(20, 20))

    class _StubDriver:  # VisualWalk only touches .fe in construction paths we don't hit here
        fe = "http://unused"

    walk = vr.VisualWalk(_StubDriver(), browser=None, out_dir=str(out_dir), tier="a")
    walk.shots_meta["tierA:settings:phone-390:glass"] = {
        "width": 20, "height": 20, "device_scale_factor": 1, "label": "x",
        "path": str(shot_path), "masks": [],
    }
    empty_baselines = tmp_path / "no-baselines-yet"
    results = walk.run_pixel_diffs(str(empty_baselines))
    assert len(results) == 1
    assert results[0].status == "baseline-missing"
    assert "SKIPPED" in results[0].detail
    assert "no blessed baseline" in results[0].detail


def test_visual_walk_pixel_diff_flags_a_real_diff_against_a_blessed_baseline(tmp_path):
    out_dir = tmp_path / "run"
    (out_dir / "shots").mkdir(parents=True)
    shot_path = out_dir / "shots" / "tierB__eviction__wide-1440.png"
    _make_png(shot_path, color=(200, 10, 10), size=(20, 20))

    baselines = tmp_path / "baselines"
    baselines.mkdir()
    base_shots = tmp_path / "prior-run" / "shots"
    base_shots.mkdir(parents=True)
    _make_png(base_shots / "tierB__eviction__wide-1440.png", color=(10, 10, 10), size=(20, 20))
    vm.bless_run(str(base_shots), str(baselines), source="ci-artifact:seed")

    class _StubDriver:
        fe = "http://unused"

    walk = vr.VisualWalk(_StubDriver(), browser=None, out_dir=str(out_dir), tier="b")
    walk.shots_meta["tierB:eviction:wide-1440"] = {
        "width": 20, "height": 20, "device_scale_factor": 1, "label": "x",
        "path": str(shot_path), "masks": [],
    }
    results = walk.run_pixel_diffs(str(baselines))
    assert results[0].status == "diff"
    # the advisory triptych artifact must land on disk for the PR before/after/diff view.
    assert (out_dir / "diffs" / "tierB__eviction__wide-1440.png").is_file()


# ── report shaping (schema) ────────────────────────────────────────────────────────────────


def test_write_report_and_summary_produce_expected_files(tmp_path):
    out = tmp_path / "out"
    out.mkdir()
    geometry_findings = {"tierA:chat:phone-390:glass": [
        {"kind": "off-viewport", "selector": "#x", "id": "x", "label": "#x", "detail": "..."}
    ]}
    a, b = _solid((0, 0, 0)), _solid((255, 255, 255))
    result, _ = vp.diff_images(a, b, shot_id="tierA:chat:phone-390:glass")

    geo_path = vr._write_report(str(out), "geometry_report.json", {
        "format": 1, "tier": "a", "wall_seconds": 12.3, "total_shots": 1,
        "total_findings": 1, "shots": geometry_findings, "tier_a": [], "tier_b": [], "errors": [],
    })
    px_path = vr._write_report(str(out), "pixel_report.json", {
        "format": 1, "policy": "advisory", **vp.summarize([result]),
    })
    md_path = vr._write_summary_md(str(out), tier="a", wall_seconds=12.3,
                                   geometry_findings=geometry_findings, pixel_results=[result],
                                   tier_a_report=[{"surface": "chat", "status": "captured"}],
                                   tier_b_report=[], errors=[])

    assert os.path.isfile(geo_path) and os.path.isfile(px_path) and os.path.isfile(md_path)
    with open(geo_path) as fh:
        geo = json.load(fh)
    assert geo["total_findings"] == 1
    assert geo["shots"]["tierA:chat:phone-390:glass"][0]["kind"] == "off-viewport"
    with open(px_path) as fh:
        px = json.load(fh)
    assert px["policy"] == "advisory"
    assert px["total"] == 1
    md = open(md_path).read()
    assert "geometry findings" in md.lower()
    assert "BLOCKING" in md  # a non-empty geometry findings set must read as blocking in prose


def test_write_summary_reports_clean_run_as_clean(tmp_path):
    out = tmp_path / "out"
    out.mkdir()
    md_path = vr._write_summary_md(str(out), tier="all", wall_seconds=1.0,
                                   geometry_findings={}, pixel_results=[],
                                   tier_a_report=[], tier_b_report=[], errors=[])
    md = open(md_path).read()
    assert "clean" in md.lower()


# ── matrix config sanity (pure config, still worth a regression test) ─────────────────────


def test_house_theme_count_matches_the_design():
    # 0052's five house themes, per the design note's "5 house themes" axis.
    assert len(vr.HOUSE_THEME_COLORS) == 5
    assert set(vr.HOUSE_THEME_COLORS) == {
        "the-feed", "telescreen", "room-101", "memory-wall", "sequester"}


def test_theme_seed_script_is_valid_looking_js_for_every_house_theme():
    for name in vr.HOUSE_THEME_COLORS:
        script = vr.theme_seed_script(name)
        assert "orwell-theme" in script
        assert name in script
        assert vr.HOUSE_THEME_COLORS[name]["bg"] in script


def test_theme_seed_script_unknown_theme_raises():
    with pytest.raises(KeyError):
        vr.theme_seed_script("not-a-real-theme")


def test_tier_a_surface_count_matches_the_design():
    assert len(vr.TIER_A_SURFACES) == 6


def test_tier_a_viewport_count_matches_the_design():
    assert len(vr.TIER_A_VIEWPORTS) == 4


def test_tier_b_viewport_count_matches_the_design():
    assert len(vr.TIER_B_VIEWPORTS) == 2


def test_tier_b_beat_count_matches_the_design():
    assert len(vr.TIER_B_BEATS) == 7


def test_phase_to_beat_targets_are_all_declared_tier_b_beats():
    assert set(vr.PHASE_TO_BEAT.values()) <= set(vr.TIER_B_BEATS)


def test_shot_filename_is_filesystem_safe():
    name = vr.shot_filename("tierA:chat:phone-390:the-feed")
    assert ":" not in name
    assert name.endswith(".png")


def test_tier_a_surfaces_declare_a_known_moment():
    for surf_id, surf in vr.TIER_A_SURFACES.items():
        assert surf["moment"] in ("casting", "midweek"), surf_id


# ── the XFAIL registry (the responsive_matrix ratchet pattern) ────────────────────────────


def test_split_xfail_demotes_a_registered_finding_and_blocks_the_rest():
    shot = "tierB:hoh:phone-390"
    registered = {"kind": "clipped-by-ancestor", "selector": "#orwell-decision-card",
                 "id": "orwell-decision-card", "label": "div#orwell-decision-card",
                 "detail": "ancestor=section#orwell-decision-sheet ..."}
    novel = {"kind": "covered", "selector": "#sidebar", "id": "sidebar",
            "label": "nav#sidebar", "detail": "covered by div.stray"}
    blocking, xfailed = vr.split_xfail(shot, [registered, novel])
    assert [f["kind"] for f in blocking] == ["covered"]
    assert len(xfailed) == 1
    assert xfailed[0]["xfail_id"] == "VIS-1"


def test_split_xfail_with_no_registry_match_blocks_everything():
    shot = "tierA:chat:wide-1440:glass"
    f = {"kind": "zero-size", "selector": "#x", "id": "x", "label": "div#x", "detail": "0x0"}
    blocking, xfailed = vr.split_xfail(shot, [f])
    assert blocking == [f]
    assert xfailed == []


def test_finding_line_shape_is_stable_for_registry_matching():
    # the XFAIL substrings match against THIS exact shape — a reshape silently defuses the
    # whole registry, so the shape itself is pinned.
    line = vr.finding_line("tierB:veto:phone-390", {
        "kind": "clipped-by-ancestor", "label": "div#orwell-decision-card",
        "detail": "ancestor=section#x"})
    assert line == ("tierB:veto:phone-390 clipped-by-ancestor div#orwell-decision-card: "
                    "ancestor=section#x")
    assert vr.XFAIL["VIS-1"]["needle"] in line


def test_every_xfail_entry_has_a_finding_id_and_nonempty_needle():
    for fid, ent in vr.XFAIL.items():
        assert fid.startswith("VIS-"), f"XFAIL id {fid!r} must carry a real finding id"
        assert isinstance(ent, dict) and set(ent) == {"shot", "needle"}
        assert isinstance(ent["needle"], str) and len(ent["needle"]) > 8
        # the SHOT scope is mandatory (review P1, PR #1244): a bare substring registry would
        # demote the same defect appearing on a different shot/theme.
        assert isinstance(ent["shot"], str) and len(ent["shot"]) >= 6
        # ...and it must be a LIVE-format prefix (second review P1, PR #1244): live shot ids
        # are colon-separated (`tierA:{surface}:{viewport}:{theme}` / `tierB:{beat}:{viewport}`);
        # `__` is only the on-disk filename encoding (`encode_shot_id`). A registry entry written
        # in filename form never matches `shot_id.startswith(...)`, so the known finding
        # silently keeps blocking CI.
        assert ent["shot"].startswith(("tierA:", "tierB:")), \
            f"XFAIL {fid!r} shot scope {ent['shot']!r} is not a live-format shot-id prefix"
        assert "__" not in ent["shot"], \
            f"XFAIL {fid!r} shot scope {ent['shot']!r} uses the filename encoding, not the shot id"


def test_xfail_scope_does_not_demote_the_same_defect_on_another_shot():
    registered = {"kind": "clipped-by-ancestor", "selector": "#orwell-decision-card",
                  "id": "orwell-decision-card", "label": "div#orwell-decision-card",
                  "detail": "ancestor=section#orwell-decision-sheet ..."}
    blocking, xfailed = vr.split_xfail("tierA:chat:wide-1440:glass", [registered])
    assert xfailed == [] and len(blocking) == 1, \
        "an XFAIL entry must be scoped to its shot — the same defect elsewhere must BLOCK"


def test_overlay_allowlist_covers_the_known_deliberate_layers():
    # the curated layers the first live run proved are by-design coverers — losing one from
    # the allowlist reintroduces ~a hundred false positives at a stroke.
    for sel in (".ow-scrim", ".grail-scrim", "#app-loader", "#settings-modal",
                "#orwell-onboarding", "#gadget-rail", "#orwell-decision-card"):
        assert sel in vr.OVERLAY_ALLOWLIST


def test_harness_errors_block_the_exit_code():
    """Review P1 (PR #1244): a capture/setup failure recorded into walk.errors must fail the
    process even with zero geometry findings — otherwise a wedged run lets the required CI job
    pass as if the visual checks ran (the never-a-silent-pass rule)."""
    src = (pathlib.Path(__file__).parents[1] / "scripts" / "visual_regression.py").read_text()
    assert "return 1 if (total_findings or walk.errors) else 0" in src
