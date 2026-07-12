"""#1375 — the rendered a11y gate's unit tests (browser-free).

Exercises the PURE pieces of `scripts/a11y_matrix.py` — the WCAG/APCA math, the axe run-options,
the XFAIL registry + ratchet discipline, the staging-reuse drift pin, and the CI wiring — with NO
Playwright/browser dependency anywhere in this file (mirrors `test_0114_theme_consistency.py`'s
discipline so this stays in the fast, parallel `fe-unit` lane rather than `fe-browser-tests`). The
rendered sweep itself runs in its own CI job (engine-staged) — see `.github/workflows`.

Roles only — no cast/game content in any fixture here.
"""
from __future__ import annotations

import os
import re
import sys
from pathlib import Path

import pytest

FRONTEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if FRONTEND_DIR not in sys.path:
    sys.path.insert(0, FRONTEND_DIR)

from scripts import a11y_matrix as A  # noqa: E402

REPO_ROOT = Path(FRONTEND_DIR).parent
WORKFLOWS = REPO_ROOT / ".github" / "workflows"


# ── vendored axe-core ─────────────────────────────────────────────────────────────────────
def test_axe_core_is_vendored_locally():
    """axe-core must ship IN-REPO (injected via Playwright, never a CDN/network fetch)."""
    assert A.VENDOR_AXE.exists(), f"vendored axe-core missing at {A.VENDOR_AXE}"
    src = A.VENDOR_AXE.read_text(encoding="utf-8")
    assert len(src) > 200_000, "vendored axe.min.js looks truncated"
    assert re.search(r"axe v\d+\.\d+", src[:200]), "axe version banner not found in vendored file"
    assert 'axe.version=' in src or 'version:"' in src, "axe global/version marker not present"


def test_axe_reader_loads_without_error():
    assert "axe" in A._axe_js()[:200]


# ── the axe run-options (level A/AA + ARIA, contrast owned by the sweep) ─────────────────────
def test_axe_options_cover_wcag_a_aa_and_aria():
    tags = set(A.AXE_OPTIONS["runOnly"]["values"])
    for required in ("wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "cat.aria"):
        assert required in tags, f"axe tag {required} missing from AXE_OPTIONS"


def test_axe_color_contrast_rule_disabled_to_avoid_double_counting():
    # The rendered contrast sweep owns contrast; axe's own color-contrast rule is off so the two
    # concerns never double-count (axe also returns 'incomplete' on glass it can't resolve).
    assert A.AXE_OPTIONS["rules"]["color-contrast"]["enabled"] is False


# ── WCAG relative-luminance / contrast-ratio math ───────────────────────────────────────────
def test_wcag_ratio_extremes():
    assert A._wcag_ratio([255, 255, 255], [0, 0, 0]) == pytest.approx(21.0, abs=0.01)
    assert A._wcag_ratio([0, 0, 0], [255, 255, 255]) == pytest.approx(21.0, abs=0.01)
    assert A._wcag_ratio([120, 120, 120], [120, 120, 120]) == pytest.approx(1.0, abs=1e-6)


def test_wcag_ratio_is_symmetric():
    a, b = [22, 25, 31], [24, 49, 64]
    assert A._wcag_ratio(a, b) == pytest.approx(A._wcag_ratio(b, a))


def test_wcag_known_aa_boundary():
    # #767676 grey on white is the canonical 4.54:1 (just passes AA normal text).
    assert A._wcag_ratio([118, 118, 118], [255, 255, 255]) == pytest.approx(4.54, abs=0.03)


# ── APCA (SA98G) polarity-aware lightness contrast ──────────────────────────────────────────
def test_apca_zero_when_equal():
    assert A._apca_lc([100, 100, 100], [100, 100, 100]) == pytest.approx(0.0, abs=1e-6)


def test_apca_polarity_sign():
    # Dark text on a light backdrop → POSITIVE Lc; light text on a dark backdrop → NEGATIVE.
    dark_on_light = A._apca_lc([0, 0, 0], [255, 255, 255])
    light_on_dark = A._apca_lc([255, 255, 255], [0, 0, 0])
    assert dark_on_light > 90 and light_on_dark < -90
    assert abs(dark_on_light) != abs(light_on_dark)  # SA98G is polarity-asymmetric by design


def test_over_composite_opaque_passthrough_and_blend():
    assert A._over([10, 20, 30, 1.0], [200, 200, 200]) == pytest.approx([10, 20, 30])
    mid = A._over([0, 0, 0, 0.5], [200, 200, 200])
    assert mid == pytest.approx([100, 100, 100])


# ── XFAIL registry + ratchet discipline ─────────────────────────────────────────────────────
def test_xfail_registry_is_well_formed():
    assert isinstance(A.XFAIL, dict) and A.XFAIL, "XFAIL registry must exist and be non-empty on main"
    needles = list(A.XFAIL.values())
    assert len(needles) == len(set(needles)), "duplicate XFAIL needles"
    for fid, needle in A.XFAIL.items():
        assert isinstance(fid, str) and fid, "each XFAIL entry needs a finding id"
        # Every needle is a stable finding-shape prefix — an axe rule or a contrast element.
        assert needle.startswith("a11y:") or needle.startswith("contrast:"), \
            f"XFAIL needle {needle!r} is not a recognised finding shape"


@pytest.fixture(autouse=True)
def _isolate_gate_globals():
    """classify_and_report reads module globals; snapshot + restore so tests don't bleed."""
    saved_found = dict(A.found)
    saved_hits = set(A.xfail_hits)
    yield
    A.found.clear(); A.found.update(saved_found)
    A.xfail_hits.clear(); A.xfail_hits.update(saved_hits)


def test_ratchet_unregistered_violation_fails_registered_passes():
    known_needle = next(iter(A.XFAIL.values()))
    # A line carrying a KNOWN needle → xfail → gate GREEN.
    A.found.clear(); A.xfail_hits.clear()
    A.record(f"{known_needle} — WCAG 1.30:1 < 4.5 (some detail)", "unit")
    assert A.classify_and_report() == 0, "a registered finding must xfail (green)"

    # A line carrying an UNKNOWN needle → hard fail → gate RED (the ratchet catching a new one).
    A.found.clear(); A.xfail_hits.clear()
    A.record("contrast:sidebar:span.brand-NEVER-SEEN — WCAG 2.10:1 < 4.5 (new fault)", "unit")
    assert A.classify_and_report() == 1, "an unregistered finding must fail (red)"


def test_indeterminate_findings_never_gate():
    A.found.clear(); A.xfail_hits.clear()
    A.record("contrast-indeterminate:orwell-status:'name' (textured backdrop — not gated)", "unit")
    assert A.classify_and_report() == 0, "indeterminate findings must never fail the gate"


# ── staging-reuse drift pin (can't diverge from the geometry gate's surface set) ────────────
def test_reuses_responsive_matrix_staging():
    # The gate must consume responsive_matrix's staging so it audits the IDENTICAL surface set the
    # geometry gate measures — never a forked copy that can drift.
    assert A.rm.__name__ == "responsive_matrix"
    for helper in ("boot_fe", "stage_game", "finish_game", "GAME_SURFACES",
                   "mount_endgame_card", "mount_retro", "mount_face_grid_card"):
        assert hasattr(A.rm, helper), f"responsive_matrix.{helper} not available to the a11y gate"
    # GAME_SURFACES flows straight into the contrast selector, so a newly-registered surface is
    # covered automatically.
    assert A.rm.GAME_SURFACES[0].lstrip("#[]*=\"") in A._CONTRAST_SELECTOR


def test_source_does_not_edit_responsive_matrix():
    # We CONSUME responsive_matrix; we must never have to fork it. (Belt: the import is a plain
    # module import, not a copy-paste of its body.)
    src = Path(A.__file__).read_text(encoding="utf-8")
    assert "import responsive_matrix as rm" in src


# ── CI wiring (the gate must actually run in CI, engine-staged) ──────────────────────────────
def test_ci_wires_the_a11y_gate():
    """Some workflow must invoke scripts/a11y_matrix.py engine-staged (mirrors fe-responsive)."""
    yamls = list(WORKFLOWS.glob("*.yml")) + list(WORKFLOWS.glob("*.yaml"))
    text = "\n".join(p.read_text(encoding="utf-8") for p in yamls)
    assert "scripts/a11y_matrix.py" in text, "no workflow runs scripts/a11y_matrix.py"
    # It must run engine-staged like fe-responsive (the game/endgame surfaces are the point).
    assert "ORWELL_MATRIX_ENGINE" in text and "ORWELL_MATRIX_FINISH" in text, \
        "the a11y gate must run engine-staged (ORWELL_MATRIX_ENGINE / ORWELL_MATRIX_FINISH)"
