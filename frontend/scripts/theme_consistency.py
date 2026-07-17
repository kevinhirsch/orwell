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

#: The registered game-build SURFACE ROOTS — the FULL window/gadget/sidebar/notice/slate
#: inventory (enumerated from source: the `OrwellWindow` kit windows, the `OrwellGadget` kit
#: cards + the `orwellGadgetRail.js` `REGISTRY`, the `OrwellNotice`/`OrwellSheet` kits, the
#: sidebar chrome, the in-chat ceremony slates, and the `orwellHeadshot.js` studio tiles). The
#: owner reports the wrong-polarity problem as PERVASIVE across "windows and gadgets and
#: sidebars", so this probes every surface family, not a curated few (the earlier 3-surface cut
#: gave false confidence). Each entry is a surface ROOT whose OWN background should derive from
#: the active theme's `--panel` (floating surfaces) or `--bg` (the onboarding first-run card, by
#: design) — the classifier accepts EITHER, see the design note's "--bg vs --panel" section.
#:
#: Grouped by family (all probed on every shot; a selector that matches nothing this shot simply
#: contributes no elements — best-effort, like `visual_regression.py`'s `GEOMETRY_REGISTRY`):
THEME_REGISTRY: List[str] = [
    # ── floating kit windows (OrwellWindow) — cast, memory, dossier, finale, retro, settings,
    #    headshot; `.ow-window` catches every one that is currently mounted/open ──
    ".ow-window", ".ow-sheet",
    "#orwell-cast", "#orwell-memory", "#orwell-dossier",
    "#orwell-finale", "#orwell-retro", "#settings-modal", "#orwell-headshot",
    # ── gadget-rail: the container, its rows, and every OrwellGadget CARD (og-card) — status,
    #    deals, presence, night, cast-pin (the rail REGISTRY) ──
    "#gadget-rail", ".gadget-rail", ".gadget-rail > *", ".gadget-rail .ow-window",
    ".og-card",
    "#orwell-status", "#orwell-deals", "#orwell-presence", "#orwell-night", "#orwell-cast-pin",
    # ── sidebar chrome ──
    "#sidebar", ".sidebar", ".sidebar-header", ".sidebar-user-bar",
    # ── above-composer notice cards (OrwellNotice) — the room strip + the decision card ──
    ".on-card", "#orwell-room-strip", "#orwell-decision-card",
    # ── in-chat ceremony slates (M4-6) — HOH/nominations/veto/eviction reveal cards ──
    ".ow-cslate",
    # ── headshot-studio portrait tiles (G26/G27/G28) — the first live audit's real offender ──
    ".hs-preview", ".hs-cand", ".hs-libitem",
]

#: Registry selectors that are LEGITIMATELY absent at the committed fixture's parked state — a 0
#: match count for these is EXPECTED, not a harness regression (documented in the design note's
#: inventory table). Every OTHER selector must be reached on at least one shot, or the opener has
#: regressed and a "0 findings" would be a false-clean — `_coverage_guard` turns that into a
#: blocking harness error (the never-a-silent-pass rule applied to REACH, not just findings).
EXPECTED_UNREACHED: Dict[str, str] = {
    "#orwell-finale": "endgame-only window; the Week-1 fixture never reaches the finale beat",
    "#orwell-retro": "post-season retrospective; not reached by the Week-1 fixture",
    "#orwell-headshot": "the PRE-GAME casting-card window id; in-game the studio mounts inside "
                        "Settings→Account, whose preview tile (.hs-preview) IS reached",
    ".hs-cand": "the generate-3-options AI candidate tiles — only mount after a portrait "
                "generation; carry the identical fixed rule as .hs-preview (reached)",
    ".hs-libitem": "the headshot-library tiles — only mount once a prior generation has been "
                   "SAVED to the library, which the Week-1 golden fixture never does (the library "
                   "is empty at this beat); carry the identical fixed rule as .hs-preview (reached), "
                   "which covers the orwellHeadshot.js token fix",
    ".gadget-rail .ow-window": "gadgets render as .og-card (reached=5), not docked .ow-window",
    "#orwell-decision-card": "the live-decision affordance (orwellDecision.js CARD_ID) is created "
                             "ONLY while a pending decision is on the board. This sweep probes the "
                             "walk's TERMINAL parked state (VisualWalk._run_week breaks at week>=2), "
                             "and the committed golden fixture terminates at a Week-2 day-1 SOCIAL "
                             "beat with no pending, so no card is live there. State-gated, not an "
                             "open-hook the sweep can trigger (never a synthetic state); the "
                             "decision-card render path is unchanged. Revisit (remove this entry) if "
                             "a decision-bearing terminal beat is ever re-recorded — the classifier "
                             "still theme-probes the card whenever it IS present.",
    ".ow-sheet": "the anchored action-sheet (#753) that HOSTS #orwell-decision-card above the "
                 "composer — it mounts only alongside a live decision, so it is absent for the "
                 "exact same reason as #orwell-decision-card at this fixture's terminal social beat "
                 "(the two are coupled: the sheet is the card's host). Not a sheet-kit regression.",
    ".ow-cslate": "ceremony slates render only from a VISIBLE advanceGame/submitDecision tool "
                  "event (orwellToolBeats.orwellCeremonySlate); in the 2026-07-17 fixture the "
                  "pre-nominations advances were committed by the FE stall belt (silent — no chat "
                  "tool event), so no slate exists in scrollback at the parked midweek beat. "
                  "Fixture-content-dependent reach, not a render regression (the slate path is "
                  "unchanged and still theme-probed whenever present). Revisit (remove this "
                  "entry) when a fixture whose model calls a ceremony advance visibly before "
                  "nominations lands.",
}


def _aggregate_coverage(coverage: Dict[str, dict]) -> Dict[str, int]:
    """The max match-count per selector across all shots — the single 'proves reach' aggregate
    shared by `coverage_gaps` (the blocking check) and `_write_summary_md` (the human table), so
    the two can never drift."""
    agg: Dict[str, int] = {}
    for cov in coverage.values():
        for sel, n in cov.items():
            agg[sel] = max(agg.get(sel, 0), n)
    return agg


def exit_code(total_findings: int, all_errors: list) -> int:
    """Never-a-silent-pass: harness/coverage errors block the process too, exactly like theme
    findings — a capture/setup failure must fail even with zero findings (mirrors
    visual_regression.py, PR #1244 review P1)."""
    return 1 if (total_findings or all_errors) else 0


def coverage_gaps(coverage: Dict[str, dict]) -> List[str]:
    """Registry selectors that matched NOTHING on ANY shot AND are not in EXPECTED_UNREACHED —
    i.e. a surface the opener was supposed to reach but didn't (the opener regressed). Returns a
    list of harness-error strings; empty when every expected-reachable surface was probed."""
    agg = _aggregate_coverage(coverage)
    gaps = []
    for sel in THEME_REGISTRY:
        if agg.get(sel, 0) <= 0 and sel not in EXPECTED_UNREACHED:
            gaps.append(f"surface never reached by the opener: {sel!r} (0 matches on every shot) "
                        "— a '0 findings' here would be a false-clean; fix the open hook or, if "
                        "it is legitimately absent at this beat, add it to EXPECTED_UNREACHED "
                        "with a reason")
    return gaps


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
        self.coverage: Dict[str, dict] = {}       # per-shot {selector: match count} — proves reach
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
        except Exception as e:
            self.errors.append(f"_orwellStatusEnsure failed (non-fatal): {e}")
        page.wait_for_timeout(300)

    def _open_surfaces(self, page) -> None:
        """Best-effort JS hooks opening the FULL game window/gadget/sidebar inventory the
        registry probes — mirrors the `open_js`/`ensure_js` seams `visual_regression.py`'s Tier A
        surfaces use, extended to every surface family. Each hook is independent and swallowed on
        failure (a missing/unreachable surface must not sink the sweep — it simply contributes no
        elements for that bucket, best-effort like every hook here).

        Beat-reachability (see the design note's inventory table) — this sweep probes at the
        parked golden-walk state (the fixture rolls through Week-1 HOH→noms→veto→eviction into
        Week-2 HOH), so on the fresh-load sweep the following are reachable and probed:
          - sidebar chrome                       — always on screen
          - gadget rail + status/deals/presence/night/cast/cast-pin cards — the rail drawer opens
          - cast window (#orwell-cast)           — the sidebar "Cast" button
          - memory wall (#orwell-memory)         — the sidebar "What You Know" button
          - dossier (#orwell-dossier)            — clicking a cast tile (a door into a houseguest)
          - decision card (#orwell-decision-card)— live at the parked HOH-intent beat
          - room strip (#orwell-room-strip)      — the above-composer presence notice
          - ceremony slates (.ow-cslate)         — Week-1 HOH/noms/veto/eviction cards in scrollback
          - settings + headshot studio           — the gear → Account tab
        Genuinely NOT reached by the committed fixture (documented, never fabricated — the same
        honesty as 0113's finale skip): the FINALE window content (#orwell-finale, endgame only)
        and the post-season RETROSPECTIVE (#orwell-retro) — their beats are past the fixture's
        Week-1 walk. Their gadget-rail cards may still mount empty and get probed as `.og-card`;
        the windows themselves self-extend the moment a finale-covering fixture lands.
        """
        # Sidebar-button / API hooks FIRST (before the settings modal + its scrim, which would
        # otherwise inert the background and block these clicks). JS .click() fires the handler
        # even when the control is visually collapsed (mobile), so this is robust across viewports.
        open_hooks = [
            # the gadget-rail drawer (mounts status/deals/presence/night/cast/cast-pin cards)
            "(document.querySelector('.gadget-rail-open,#gadget-rail-open')||{click(){}}).click()",
            # cast window
            "(document.getElementById('sidebar-cast-btn')||{click(){}}).click()",
            # memory wall ("What You Know")
            "(document.getElementById('sidebar-memory-btn')||{click(){}}).click()",
        ]
        for hook in open_hooks:
            try:
                page.evaluate(hook)
            except Exception as e:
                self.errors.append(f"open-hook failed (non-fatal): {hook[:40]}...: {e}")
            page.wait_for_timeout(300)
        # dossier: a door opened FROM the cast window — wait for a cast tile to mount (the roster
        # is fetched async), then open the shared dossier handler on the first houseguest. Poll,
        # never a fixed sleep (the async-mount lesson below).
        self._wait_for_selector(page, "#orwell-cast .oc-hg", budget_polls=15)
        try:
            page.evaluate(
                "(() => { const t = document.querySelector('#orwell-cast .oc-hg');"
                " if (t) t.click(); })()")
        except Exception as e:
            self.errors.append(f"open-hook failed (non-fatal): dossier click...: {e}")
        page.wait_for_timeout(400)
        # settings modal + Account tab LAST (its scrim would block the sidebar clicks above).
        for hook in (
            "(document.getElementById('user-bar-settings')"
            "||document.getElementById('tool-settings-btn')"
            "||document.getElementById('rail-settings')||{click(){}}).click()",
            "(document.querySelector('[data-settings-tab=\"account\"]')||{click(){}}).click()",
        ):
            try:
                page.evaluate(hook)
            except Exception as e:
                self.errors.append(f"open-hook failed (non-fatal): {hook[:40]}...: {e}")
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
            except Exception as e:
                self.errors.append(f"open-hook failed (non-fatal): wait_for_selector({selector[:40]}...): {e}")
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
            except Exception as e:
                self.errors.append(f"_wait_layout_stable failed (non-fatal): {e}")
                return
            if prev is not None and snap == prev:
                return
            prev = snap

    def _sweep_one(self, theme: str, vp_name: str, w: int, h: int) -> None:
        shot_id = f"theme:{theme}:{vp_name}:midweek"
        ctx = None
        try:
            ctx = self._new_context(w, h, theme)
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
            # per-selector RAW presence counts (dedup-INDEPENDENT) — proves the sweep actually
            # REACHED each surface. The classification probe de-duplicates by element identity
            # (`seen`), so a window matched by the broad `.ow-window` selector would show 0 under
            # its own `#orwell-cast` id — misleading. This separate `querySelectorAll(sel).length`
            # pass counts true DOM presence per selector, so a genuinely un-opened surface reads
            # as 0 while an opened one (even if classified under a broader selector) reads > 0.
            self.coverage[shot_id] = page.evaluate(
                "(sels) => { const o = {}; for (const s of sels) {"
                " try { o[s] = document.querySelectorAll(s).length; } catch (e) { o[s] = -1; } }"
                " return o; }", THEME_REGISTRY)
            page.screenshot(path=os.path.join(self.shots_dir, shot_id.replace(":", "__") + ".png"))
        except Exception as e:  # noqa: BLE001 — one theme/viewport failing must not sink the run
            self.errors.append(f"{shot_id}: {e}")
        finally:
            if ctx is not None:
                try:
                    ctx.close()
                except Exception as e:  # noqa: BLE001 — a teardown failure must not sink the run either
                    self.errors.append(f"{shot_id}: ctx.close failed (non-fatal): {e}")

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
                      xfails: Dict[str, list], tokens: Dict[str, dict], errors: list,
                      coverage: Optional[Dict[str, dict]] = None) -> str:
    coverage = coverage or {}
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
    # Surface COVERAGE — the max match count each registry selector reached across all shots.
    # Proves "0 findings" is meaningful (the surface was actually opened + probed), not a
    # false-clean from an un-opened surface. A selector at 0 everywhere is flagged NOT REACHED.
    if coverage:
        agg = _aggregate_coverage(coverage)
        lines += ["## Surface coverage (max matches across shots — proves reach)", ""]
        for sel in THEME_REGISTRY:
            n = agg.get(sel, 0)
            if n:
                mark = ""
            elif sel in EXPECTED_UNREACHED:
                mark = f"  (expected-absent: {EXPECTED_UNREACHED[sel]})"
            else:
                mark = "  ❌ NOT REACHED (opener regressed — blocks)"
            lines.append(f"- `{sel}` — {n}{mark}")
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
        # The fixture is recorded with the browser-parity cast pre-warm landed BEFORE the
        # interview (the premiere freezes the authored cast) — this walk must match, or the
        # finalize turn's continuation misses the fixture (the 2026-07-17 CI failure).
        driver.prewarm()
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
    # Coverage guard: an EXPECTED-reachable surface that matched nothing on any shot means the
    # opener regressed — a "0 findings" would be a false-clean. Fold those into the blocking
    # error set (same never-a-silent-pass rule as a capture failure).
    coverage_errors = coverage_gaps(sweep.coverage)
    all_errors = walk_errors + sweep.errors + coverage_errors
    total_xfails = sum(len(v) for v in sweep.xfails.values())
    matched_ids = {f.get("xfail_id") for v in sweep.xfails.values() for f in v}
    xpasses = sorted(set(XFAIL) - matched_ids)
    report = {
        "format": 1, "wall_seconds": wall, "themes": THEME_NAMES,
        "total_shots": len(sweep.tokens),
        "total_findings": sum(len(v) for v in sweep.findings.values()),
        "total_xfails": total_xfails,
        "shots": sweep.findings, "xfails": sweep.xfails, "xpasses": xpasses,
        "tokens": sweep.tokens, "coverage": sweep.coverage, "errors": all_errors,
    }
    _write_report(args.out, "theme_report.json", report)
    _write_summary_md(args.out, wall_seconds=wall, findings=sweep.findings,
                      xfails=sweep.xfails, tokens=sweep.tokens, errors=all_errors,
                      coverage=sweep.coverage)

    total_findings = report["total_findings"]
    print(f"\n==== theme-consistency: {len(sweep.tokens)} shots · "
          f"{total_findings} finding(s) · {total_xfails} xfail (known) · {wall:.1f}s")
    if xpasses:
        print("  (xpass — REMOVE the now-stale XFAIL entries: " + ", ".join(xpasses) + ")")
    if all_errors:
        print(f"  ({len(all_errors)} harness error(s) — see summary.md)")
    # Harness errors BLOCK too — same never-a-silent-pass rule 0113's visual_regression.py uses:
    # a capture/setup failure landing zero shots must never let this required job pass quietly.
    # An XPASS blocks too (stronger than 0113's advisory nudge): a registered XFAIL that no longer
    # matches means the known finding was fixed, so the stale entry MUST be removed or it would
    # silently re-demote the same defect if it regresses — the ratchet only tightens.
    return exit_code(total_findings, all_errors + [f"xpass: {x}" for x in xpasses])


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
