"""0113 — the visual-regression harness's pixel-diff detector (ADVISORY half).

Pure-Python, PIL-based (no vendored pixelmatch, no new heavyweight dependency — Pillow +
numpy are already pinned in `requirements.lock.txt` for the qrcode/admin-image paths). This
module never imports Playwright and never touches the filesystem beyond the paths it is
handed, so it is fully unit-testable with synthetic in-memory images
(`tests/test_0113_visual_harness.py`).

Per spec: a pixel diff never blocks the CI job (`visual_regression.py`'s exit code is driven
by geometry findings only) — this module's output is an advisory report + artifacts (a
before/after/diff triptych) surfaced in the job summary / PR comment.

Determinism note: masked regions (e.g. a wall-clock readout) are blacked out in BOTH images
before comparison, so a legitimately time-varying element can never manufacture a false diff.
"""
from __future__ import annotations

import io
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

from PIL import Image, ImageChops, ImageDraw

#: A pixel whose per-channel delta exceeds this (0-255) counts as "different". A small
#: tolerance absorbs benign anti-aliasing/compression jitter between two otherwise-identical
#: renders without needing a full perceptual/AA-aware algorithm (a deliberate, documented
#: simplification over the JS `pixelmatch` library's AA detection — see the design note).
DEFAULT_CHANNEL_THRESHOLD = 24

#: Above this fraction of differing pixels, the shot is flagged as a "diff" in the summary
#: (still advisory — never blocks). Below it, tiny incidental drift (font hinting, subpixel
#: rounding) is reported but not called out as a headline regression.
DEFAULT_DIFF_RATIO_FLAG = 0.001  # 0.1% of pixels


@dataclass
class MaskRect:
    """A region to blank out in BOTH images before diffing (device pixels, i.e. already
    scaled by deviceScaleFactor — the same space PNG bytes live in)."""
    left: int
    top: int
    right: int
    bottom: int
    reason: str = ""


@dataclass
class PixelDiffResult:
    shot_id: str
    status: str  # "match" | "diff" | "size-mismatch" | "baseline-missing"
    diff_ratio: float = 0.0
    differing_pixels: int = 0
    total_pixels: int = 0
    baseline_size: Optional[Tuple[int, int]] = None
    candidate_size: Optional[Tuple[int, int]] = None
    masks_applied: int = 0
    detail: str = ""

    def to_dict(self) -> Dict:
        return {
            "shot_id": self.shot_id,
            "status": self.status,
            "diff_ratio": round(self.diff_ratio, 6),
            "differing_pixels": self.differing_pixels,
            "total_pixels": self.total_pixels,
            "baseline_size": list(self.baseline_size) if self.baseline_size else None,
            "candidate_size": list(self.candidate_size) if self.candidate_size else None,
            "masks_applied": self.masks_applied,
            "detail": self.detail,
        }


def apply_masks(img: Image.Image, masks: List[MaskRect]) -> Image.Image:
    """Return a COPY of ``img`` with every mask rect filled solid black. Applied identically
    to both the baseline and the candidate before diffing, so a masked region can never
    contribute a pixel difference either way."""
    out = img.convert("RGB").copy()
    draw = ImageDraw.Draw(out)
    w, h = out.size
    for m in masks:
        left = max(0, min(int(m.left), w))
        top = max(0, min(int(m.top), h))
        right = max(0, min(int(m.right), w))
        bottom = max(0, min(int(m.bottom), h))
        if right > left and bottom > top:
            draw.rectangle([left, top, right - 1, bottom - 1], fill=(0, 0, 0))
    return out


def diff_images(baseline: Image.Image, candidate: Image.Image, *, shot_id: str,
                masks: Optional[List[MaskRect]] = None,
                channel_threshold: int = DEFAULT_CHANNEL_THRESHOLD,
                diff_ratio_flag: float = DEFAULT_DIFF_RATIO_FLAG,
                ) -> Tuple[PixelDiffResult, Optional[Image.Image]]:
    """Compare two in-memory images. Returns (result, diff_highlight_image_or_None).

    The highlight image (same size as the inputs) is fully transparent except differing
    pixels, painted solid red — the "diff" third of the before/after/diff triptych.
    """
    masks = masks or []
    if baseline.size != candidate.size:
        return PixelDiffResult(
            shot_id=shot_id, status="size-mismatch",
            baseline_size=baseline.size, candidate_size=candidate.size,
            detail=f"baseline {baseline.size} != candidate {candidate.size} "
                   "(a viewport/DPI/layout regression, or a stale baseline)",
        ), None

    b = apply_masks(baseline, masks)
    c = apply_masks(candidate, masks)

    diff = ImageChops.difference(b, c)
    # Per-pixel max channel delta >= threshold counts as "different". Computed via
    # numpy-free PIL ops: split channels, take the pointwise max, then threshold.
    r, g, bch = diff.split()
    rmax = ImageChops.lighter(ImageChops.lighter(r, g), bch)
    mask_img = rmax.point(lambda p: 255 if p >= channel_threshold else 0)

    total = b.size[0] * b.size[1]
    # getbbox()/histogram avoids materializing a full numpy array for the common (mostly-
    # identical) case; histogram()[255] on the 1-bit-ish mask gives the differing-pixel count.
    hist = mask_img.histogram()
    differing = int(hist[255]) if len(hist) > 255 else sum(1 for v in mask_img.getdata() if v)
    ratio = (differing / total) if total else 0.0

    highlight = None
    if differing:
        highlight = Image.new("RGBA", b.size, (0, 0, 0, 0))
        red_layer = Image.new("RGBA", b.size, (255, 0, 64, 200))
        highlight.paste(red_layer, (0, 0), mask_img)

    # A shot is only HEADLINED as "diff" past the ratio flag (review P1, PR #1244 — a single
    # anti-aliased pixel above channel_threshold must not spam the advisory report); the exact
    # ratio/differing counts still report either way.
    status = "diff" if ratio > diff_ratio_flag else "match"
    return PixelDiffResult(
        shot_id=shot_id, status=status, diff_ratio=ratio, differing_pixels=differing,
        total_pixels=total, baseline_size=baseline.size, candidate_size=candidate.size,
        masks_applied=len(masks),
        detail=("" if not differing else f"{differing}/{total} px differ ({ratio:.4%})"),
    ), highlight


def load_image(data: bytes) -> Image.Image:
    return Image.open(io.BytesIO(data)).convert("RGB")


def make_triptych(baseline: Optional[Image.Image], candidate: Image.Image,
                  highlight: Optional[Image.Image]) -> Image.Image:
    """Stitch before/after/diff side by side (equal-height, left-to-right) for a PR artifact.
    A missing baseline renders as a labeled gray panel rather than omitting the frame, so the
    triptych shape stays consistent for a first-ever (no-baseline-yet) shot."""
    panels: List[Image.Image] = []
    h = candidate.size[1]

    def _panel(img: Optional[Image.Image], label_text: str) -> Image.Image:
        if img is None:
            ph = Image.new("RGB", candidate.size, (40, 40, 40))
            d = ImageDraw.Draw(ph)
            d.text((8, 8), label_text, fill=(220, 220, 220))
            return ph
        if img.size[1] != h:
            ratio = h / img.size[1]
            img = img.resize((max(1, int(img.size[0] * ratio)), h))
        return img.convert("RGB")

    panels.append(_panel(baseline, "no baseline"))
    panels.append(_panel(candidate, "candidate"))
    if highlight is not None:
        hl_rgb = Image.new("RGB", highlight.size, (20, 20, 20))
        hl_rgb.paste(highlight, (0, 0), highlight)
        panels.append(_panel(hl_rgb, "diff"))
    else:
        panels.append(_panel(None, "no diff"))

    total_w = sum(p.size[0] for p in panels) + 4 * (len(panels) - 1)
    out = Image.new("RGB", (total_w, h), (10, 10, 10))
    x = 0
    for p in panels:
        out.paste(p, (x, 0))
        x += p.size[0] + 4
    return out


def summarize(results: List[PixelDiffResult]) -> Dict:
    by_status: Dict[str, int] = {}
    for r in results:
        by_status[r.status] = by_status.get(r.status, 0) + 1
    return {
        "total": len(results),
        "by_status": by_status,
        "shots": [r.to_dict() for r in results],
    }
