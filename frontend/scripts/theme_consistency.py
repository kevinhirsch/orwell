#!/usr/bin/env python3
"""0114 — the theme-surface-consistency gate.

Owner-reported bug: surfaces render the WRONG polarity per theme — on the `light` theme some
windows/gadgets/sidebars stay dark; on `dark` some surfaces are mixed. Root cause: a surface
hardcodes a polarity-fixed color (e.g. `background:#1d2026`) instead of the active theme's own
token (`var(--panel)` / `var(--bg)`, the correct pattern already in use at, e.g.,
`.gadget-rail .ow-window { background: var(--panel, #1d2026); }`).

Builds on 0113's Playwright + GoldenDriver replay scaffolding (`docs/features/
0113-visual-regression-harness.md`) — the SAME state source (never an injected synthetic state),
composed by REUSING `scripts.visual_regression.VisualWalk` to drive the walk (casting -> premiere
-> week -> the `nominations` parked state) rather than re-deriving the wire protocol a second
time. This module owns only what's NEW: a theme sweep over BOTH base themes (`light`, `dark` —
the two named in the DoD; the classifier itself is theme-agnostic and works for any of the ~25
themes, see `src/theme_probe.py`) at two viewports, probing computed styles rather than pixels.

Two blocking checks per registered game-build surface (`.ow-window`, `.ow-sheet`, gadget-rail
children/cards, the sidebar(s), plus the headshot-studio portrait tiles — a real, fixed
`.hs-cand`/`.hs-preview`/`.hs-libitem` regression this gate's first live run found and this
change fixes, see the design note):

  - the classifier (`src/theme_probe.py:classify_theme_findings`) flags a surface whose
    composited background is far from BOTH the active theme's `--bg` and `--panel`;
  - the SAME `finding-id -> {shot substring, needle}` XFAIL ratchet pattern
    `scripts/visual_regression.py` uses — a known, filed finding is demoted to non-blocking until
    its fix lands; removing the entry flips it back to a hard failure.

Usage:
    cd frontend && python3 scripts/theme_consistency.py --out /tmp/theme-run

Playwright is imported LAZILY (inside functions) so the pure classifier stays importable/
unit-testable with no browser installed — same discipline as `visual_regression.py`.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from typing import Dict, List, Optional, Tuple

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.dirname(FRONTEND)
if FRONTEND not in sys.path:
    sys.path.insert(0, FRONTEND)

from src.theme_probe import THEME_PROBE_JS, classify_theme_findings  # noqa: E402

# ── the matrix (pure config — no browser needed to read/test these) ────────────────────

DEVICE_SCALE_FACTOR = 2

#: The two BASE presets named in the DoD (docs/features/0114-theme-surface-consistency.md).
#: Colors copied from `static/js/theme.js`'s `THEMES` map (the SAME trip-wire rationale
#: `visual_regression.py`'s `HOUSE_THEME_COLORS` documents: a Python harness has no server-side
#: theme registry to import, so a copy here is the deliberate, self-documenting source of truth
#: for what this gate seeds — a drift between the two shows up as a probe result, not a silent
#: miss, since the seeded colors ARE what --bg/--panel resolve to).
BASE_THEME_COLORS: Dict[str, Dict[str, str]] = {
    "dark":  {"bg": "#282c34", "fg": "#9cdef2", "panel": "#111111", "border": "#355a66", "red": "#e06c75"},
    "light": {"bg": "#f0ebe3", "fg": "#5a5248", "panel": "#faf6f0", "border": "#d4cdc2", "red": "#c47d5a"},
}
THEME_NAMES: List[str] = list(BASE_THEME_COLORS)

VIEWPORTS: List[Tuple[str, int, int]] = [
    ("phone-390", 390, 844),
    ("wide-1440", 1440, 900),
]

#: The registered game-build SURFACES (per the design note): the OrwellWindow kit windows, the
#: OrwellSheet kit, gadget-rail gadgets (the rail container's own children — including its
#: docked `.ow-window` cards), and the sidebar(s). PLUS `.hs-preview`/`.hs-cand`/`.hs-libitem` —
#: the headshot-studio portrait tiles (G26/G27/G28) this gate's first live run found hardcoding
#: `#0d0f14` instead of `var(--panel)` (fixed in `static/js/orwellHeadshot.js` — see the design
#: note's "offenders found" table). They are reachable game-build gadgets (portrait candidate
#: cards), not merely a window's own root background, so they are curated in explicitly rather
#: than left to a broad wildcard descendant walk (the same curation discipline
#: `responsive_matrix.py` / `visual_regression.py`'s `GEOMETRY_REGISTRY` already use).
THEME_REGISTRY: List[str] = [
    ".ow-window", ".ow-sheet",
    ".gadget-rail > *", ".gadget-rail .ow-window",
    "#sidebar", ".sidebar",
    ".hs-preview", ".hs-cand", ".hs-libitem",
]

#: KNOWN theme findings — same EXACT registry pattern as `visual_regression.py`'s `XFAIL`: a
#: finding-ID -> {shot prefix, formatted-line substring}. A match demotes a finding to xfail
#: instead of blocking; REMOVING an entry when its fix lands flips it back to a hard failure (the
#: gate only ratchets tighter); an entry that matches nothing this run prints an xpass removal
#: nudge. Entries are only ever added against a REAL, observed finding — never speculatively.
#: Empty at ship time: the one real finding this gate's first live audit produced (the headshot-
#: studio tiles) was fixed in the SAME change rather than parked here — see the design note.
XFAIL: Dict[str, Dict[str, str]] = {}


def finding_line(shot_id: str, finding: dict) -> str:
    """The canonical one-line rendering of a theme finding — the string XFAIL substrings match
    against (same contract as visual_regression.py's finding_line)."""
    return (f"{shot_id} {finding.get('kind')} "
            f"{finding.get('label') or finding.get('selector')}: {finding.get('detail', '')}")


def split_xfail(shot_id: str, findings: List[dict]) -> Tuple[List[dict], List[dict]]:
    """(blocking, xfailed) — a finding whose formatted line contains a registered XFAIL
    substring, scoped to a matching shot-id PREFIX, is demoted to xfail; everything else blocks.
    `shot_id` here is always the LIVE colon-delimited form (`theme:<name>:<viewport>:<moment>`)
    — never the on-disk `__`-encoded filename form (see `tests/test_0114_theme_consistency.py`'s
    contract test, guarding the exact 0113 bug where the scope substring was written against the
    encoded form and silently matched nothing)."""
    blocking, xfailed = [], []
    for f in findings:
        line = finding_line(shot_id, f)
        matched = next((fid for fid, ent in XFAIL.items()
                        if shot_id.startswith(ent["shot"]) and ent["needle"] in line), None)
        if matched:
            xfailed.append({**f, "xfail_id": matched})
        else:
            blocking.append(f)
    return blocking, xfailed


def theme_seed_script(theme_name: str) -> str:
    """A JS snippet seeding `localStorage['orwell-theme']` BEFORE first paint — the same proven
    pattern `visual_regression.py`'s `theme_seed_script` / `browser_smoke.py`'s frosted-off seed
    use — a CSS-only theme swap with no extra engine/replay turn."""
    c = BASE_THEME_COLORS[theme_name]
    colors_js = (
        f"{{ bg:'{c['bg']}', fg:'{c['fg']}', panel:'{c['panel']}', border:'{c['border']}', "
        f"red:'{c['red']}', _key:'{theme_name}' }}"
    )
    return (
        "try { localStorage.setItem('orwell-theme', JSON.stringify("
        f"{{ name: '{theme_name}', frosted: false, colors: {colors_js} }}"
        ")); } catch (e) {}"
    )


def default_fixture() -> str:
    """Resolved identically to `visual_regression.default_fixture` / `golden_path_replay.py`."""
    from scripts.visual_regression import default_fixture as _default
    return _default()


# ── the sweep (needs a browser — Playwright imported lazily by the caller) ─────────────────


class ThemeSweep:
    """Runs the theme-consistency probe over `THEME_NAMES` x `VIEWPORTS`, against an
    ALREADY-parked golden-replay state (see `run()` below — the walk-to-`nominations` is driven
    by composing `scripts.visual_regression.VisualWalk`, never re-derived here)."""

    def __init__(self, driver, browser, out_dir: str) -> None:
        self.driver = driver
        self.browser = browser
        self.out_dir = out_dir
        self.shots_dir = os.path.join(out_dir, "shots")
        os.makedirs(self.shots_dir, exist_ok=True)
        self.findings: Dict[str, list] = {}      # blocking findings per shot id
        self.xfails: Dict[str, list] = {}         # known (XFAIL-registered) findings per shot id
        self.tokens: Dict[str, dict] = {}         # the active --bg/--panel this shot resolved to
        self.errors: List[str] = []

    def _new_context(self, w: int, h: int, theme: str):
        ctx = self.browser.new_context(
            viewport={"width": w, "height": h}, device_scale_factor=DEVICE_SCALE_FACTOR,
            reduced_motion="reduce",
        )
        ctx.add_init_script(theme_seed_script(theme))
        return ctx

    def _settle(self, page) -> None:
        page.wait_for_timeout(1200)
        try:
            page.evaluate("window._orwellStatusEnsure && window._orwellStatusEnsure()")
        except Exception:
            pass
        page.wait_for_timeout(300)

    def _open_surfaces(self, page) -> None:
        """Best-effort JS hooks mounting/opening the panels the registry probes — mirrors the
        same `open_js`/`ensure_js` seams `visual_regression.py`'s Tier A surfaces use. Each hook
        is independent and swallowed on failure (a missing surface must not sink the whole
        sweep — it simply contributes no elements for that bucket)."""
        hooks = [
            # the gadget rail drawer
            "(document.querySelector('.gadget-rail-open,#gadget-rail-open')||{click(){}}).click()",
            # settings modal
            "(document.getElementById('user-bar-settings')"
            "||document.getElementById('tool-settings-btn')"
            "||document.getElementById('rail-settings')"
            "||{click(){}}).click()",
            # the Account tab inside settings — mounts the headshot studio (G28), the ONLY
            # reachable moment for `.hs-preview`/`.hs-cand`/`.hs-libitem` outside the ephemeral
            # pre-game "Choose Your Character" casting beat.
            "(document.querySelector('[data-settings-tab=\"account\"]')||{click(){}}).click()",
        ]
        for hook in hooks:
            try:
                page.evaluate(hook)
            except Exception:
                pass
            page.wait_for_timeout(350)
        # OrwellHeadshotStudio.mount() kicks off an ASYNC refreshStatus() fetch before its first
        # render() call — `.hs-preview` doesn't exist in the DOM until that fetch resolves, so a
        # fixed short sleep after the account-tab click is a flake risk (this is exactly what
        # cost the gate's first live audit a false-clean run: the fixed #0d0f14 bug went
        # unprobed because `.hs-preview` simply hadn't mounted yet). Poll instead, bounded.
        self._wait_for_selector(page, ".hs-preview, .ow-headshot-studio .hs-cand, "
                                       ".ow-headshot-studio .hs-libitem", budget_polls=15)

    def _wait_for_selector(self, page, selector: str, *, budget_polls: int, poll_ms: int = 200) -> None:
        """Best-effort bounded poll for a selector to exist — never raises (a surface that
        genuinely never mounts, e.g. an offline photo service, must not sink the sweep; it just
        contributes no elements for that bucket, same as every other best-effort hook here)."""
        for _ in range(budget_polls):
            try:
                if page.evaluate("(sel) => !!document.querySelector(sel)", selector):
                    return
            except Exception:
                return
            page.wait_for_timeout(poll_ms)

    _LAYOUT_SNAP_JS = """
      (sels) => sels.map(s => {
        const el = document.querySelector(s);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)];
      })
    """

    def _wait_layout_stable(self, page, budget_polls: int = 10) -> None:
        prev = None
        for _ in range(budget_polls):
            page.wait_for_timeout(120)
            try:
                snap = page.evaluate(self._LAYOUT_SNAP_JS, THEME_REGISTRY)
            except Exception:
                return
            if prev is not None and snap == prev:
                return
            prev = snap

    def _sweep_one(self, theme: str, vp_name: str, w: int, h: int) -> None:
        shot_id = f"theme:{theme}:{vp_name}:midweek"
        ctx = self._new_context(w, h, theme)
        try:
            page = ctx.new_page()
            page.goto(self.driver.fe, wait_until="domcontentloaded")
            self._settle(page)
            self._open_surfaces(page)
            self._wait_layout_stable(page)
            raw = page.evaluate(THEME_PROBE_JS, {"selectors": THEME_REGISTRY, "maxLayers": 6})
            findings = classify_theme_findings(raw.get("elements") or [], raw.get("tokens") or {})
            blocking, xfailed = split_xfail(shot_id, findings)
            self.findings[shot_id] = blocking
            if xfailed:
                self.xfails[shot_id] = xfailed
            self.tokens[shot_id] = raw.get("tokens") or {}
            page.screenshot(path=os.path.join(self.shots_dir, shot_id.replace(":", "__") + ".png"))
        except Exception as e:  # noqa: BLE001 — one theme/viewport failing must not sink the run
            self.errors.append(f"{shot_id}: {e}")
        finally:
            ctx.close()

    def run(self) -> None:
        for theme in THEME_NAMES:
            for vp_name, w, h in VIEWPORTS:
                self._sweep_one(theme, vp_name, w, h)


# ── orchestration ────────────────────────────────────────────────────────────────────────


def _write_report(out_dir: str, name: str, data: dict) -> str:
    path = os.path.join(out_dir, name)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=2, sort_keys=True)
        fh.write("\n")
    return path


def _write_summary_md(out_dir: str, *, wall_seconds: float, findings: Dict[str, list],
                      xfails: Dict[str, list], tokens: Dict[str, dict], errors: list) -> str:
    total = sum(len(v) for v in findings.values())
    total_xfail = sum(len(v) for v in xfails.values())
    lines = [
        "# Theme-surface-consistency run — summary", "",
        f"- wall time: {wall_seconds:.1f}s",
        f"- shots: {len(tokens)}",
        f"- themes: {', '.join(THEME_NAMES)}",
        f"- findings: **{total}** ({'BLOCKING' if total else 'clean'})"
        + (f" · {total_xfail} xfail (known)" if total_xfail else ""),
        "",
    ]
    if errors:
        lines += ["## Harness errors", ""] + [f"- {e}" for e in errors] + [""]
    if total:
        lines += ["## Findings (blocking)", ""]
        for shot_id, fs in sorted(findings.items()):
            for f in fs:
                lines.append(f"- `{shot_id}` — **{f['kind']}** {f.get('label') or f.get('selector')}: {f['detail']}")
        lines.append("")
    if total_xfail:
        lines += ["## Known findings (XFAIL — non-blocking; remove the entry when fixed)", ""]
        for shot_id, fs in sorted(xfails.items()):
            for f in fs:
                lines.append(f"- `[{f.get('xfail_id')}]` `{shot_id}` — {f['kind']} "
                             f"{f.get('label') or f.get('selector')}: {f['detail']}")
        lines.append("")
    lines += ["## Active theme tokens resolved per shot", ""]
    for shot_id, tok in sorted(tokens.items()):
        lines.append(f"- `{shot_id}` — bg={tok.get('bg')!r} panel={tok.get('panel')!r}")
    lines.append("")
    path = os.path.join(out_dir, "summary.md")
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines))
    return path


def run(args: argparse.Namespace) -> int:
    from scripts._golden_driver import GoldenDriver, fixture_models
    from scripts.visual_regression import VisualWalk
    from src import golden_path as gp

    fixture = args.fixture or default_fixture()
    if not os.path.isfile(fixture):
        print(f"FAIL: no golden fixture at {fixture}\n{gp.REGENERATE_HINT}")
        return 2
    integrity = gp.fixture_integrity_scan(fixture)
    if integrity:
        print("FAIL: committed fixture fails the integrity scan:")
        for v in integrity[:20]:
            print("  -", v)
        return 2

    os.makedirs(args.out, exist_ok=True)
    model, utility_model = fixture_models(fixture)
    driver = GoldenDriver(mode="replay", fixture=fixture, model=model, utility_model=utility_model,
                          engine_port=args.engine_port, fe_port=args.fe_port,
                          turn_timeout=180, turn_budget=args.turn_budget)

    t0 = time.time()
    sweep: Optional[ThemeSweep] = None
    walk_errors: List[str] = []
    try:
        driver.scrub_stale_state()
        driver.boot()
        driver.configure_model()
        driver.preseed()
        driver.session = driver._post_form(driver.fe, "/api/session", {
            "name": "golden-path", "endpoint_id": getattr(driver, "endpoint_id", ""),
            "model": driver.model, "skip_validation": "true",
        }).get("id") or ""
        if not driver.session:
            print("FAIL: could not create a chat session")
            return 2

        from playwright.sync_api import sync_playwright
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            try:
                # Drive the SAME golden-replay walk 0113 uses (casting -> premiere -> week ->
                # the `nominations` parked state) by COMPOSING VisualWalk rather than
                # re-deriving the wire protocol — tier="b" so its own screenshot/geometry side
                # effects stay minimal (a handful of journey-beat shots we don't otherwise use);
                # what we need from it is only the walk itself.
                walk = VisualWalk(driver, browser, os.path.join(args.out, "_walk"), tier="b")
                walk.run(turn_budget=args.turn_budget)
                walk_errors = list(walk.errors)

                sweep = ThemeSweep(driver, browser, args.out)
                sweep.run()
            finally:
                browser.close()
    finally:
        driver.shutdown()
    wall = time.time() - t0

    assert sweep is not None
    all_errors = walk_errors + sweep.errors
    total_xfails = sum(len(v) for v in sweep.xfails.values())
    matched_ids = {f.get("xfail_id") for v in sweep.xfails.values() for f in v}
    xpasses = sorted(set(XFAIL) - matched_ids)
    report = {
        "format": 1, "wall_seconds": wall, "themes": THEME_NAMES,
        "total_shots": len(sweep.tokens),
        "total_findings": sum(len(v) for v in sweep.findings.values()),
        "total_xfails": total_xfails,
        "shots": sweep.findings, "xfails": sweep.xfails, "xpasses": xpasses,
        "tokens": sweep.tokens, "errors": all_errors,
    }
    _write_report(args.out, "theme_report.json", report)
    _write_summary_md(args.out, wall_seconds=wall, findings=sweep.findings,
                      xfails=sweep.xfails, tokens=sweep.tokens, errors=all_errors)

    total_findings = report["total_findings"]
    print(f"\n==== theme-consistency: {len(sweep.tokens)} shots · "
          f"{total_findings} finding(s) · {total_xfails} xfail (known) · {wall:.1f}s")
    if xpasses:
        print("  (xpass — consider removing the XFAIL entries: " + ", ".join(xpasses) + ")")
    if all_errors:
        print(f"  ({len(all_errors)} harness error(s) — see summary.md)")
    # Harness errors BLOCK too — same never-a-silent-pass rule 0113's visual_regression.py uses:
    # a capture/setup failure landing zero shots must never let this required job pass quietly.
    return 1 if (total_findings or all_errors) else 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", required=True, help="output directory for shots + reports")
    ap.add_argument("--fixture", default="", help="golden fixture override (default: the "
                    "single committed frontend/tests/golden/golden_path_*.jsonl)")
    ap.add_argument("--turn-budget", type=int, default=90)
    ap.add_argument("--engine-port", type=int, default=8986)
    ap.add_argument("--fe-port", type=int, default=7986)
    args = ap.parse_args()
    return run(args)


if __name__ == "__main__":
    sys.exit(main())
