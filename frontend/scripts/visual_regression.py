#!/usr/bin/env python3
"""0113 — the visual-regression harness (screenshot matrix + off-screen detector + baselines).

Two tiers over a SPARSE matrix (full cross ≈ 840 shots is infeasible per-PR — see the design
note, `docs/features/0113-visual-regression-harness.md`):

  Tier A (chrome)  — ~6 surfaces (chat, status panel, gadget rail, decision card, casting,
                     settings) x 4 viewports x 5 house themes, at ONE canonical mid-week
                     state (~120 shots). Theme swap is CSS-only (a fresh page load with a
                     seeded `orwell-theme` localStorage value) — no extra replay turns between
                     themes; the state itself is parked once and iterated.
  Tier B (journey) — golden-replay walk shots at up to 7 beats (casting -> premiere -> HOH ->
                     nominations -> veto -> eviction -> finale) x 2 viewports (390/1440) at
                     the default theme (~14 shots). A beat the current committed fixture
                     doesn't reach (the golden path only walks to the week-1 roll — see 0108's
                     scope) is reported SKIPPED with a reason, never fabricated.

State source (owner-locked design, issue #1237): the 0108 golden-replay drive — key-free,
byte-deterministic, real engine + real FE — never an injected synthetic state. This module
reuses `scripts._golden_driver.GoldenDriver`'s boot/HTTP plumbing BY COMPOSITION (the same
casting script, week prompts, and decision auto-resolution the golden-path gate itself
replays) rather than re-driving the walk through its own copy of the wire protocol — the walk
LOOP here is a parallel, screenshot-interleaved copy of `GoldenDriver.walk()`'s casting +
week sections, calling the driver's `_turn`/`_pending`/`_decision_body`/`_quiesce_beats`
helpers directly so every HTTP request stays byte-identical to what the fixture was recorded
against (any drift would surface as a `GOLDEN-REPLAY-MISS`, the same hard failure 0108 uses).
If `_golden_driver.py`'s internals change shape, this walker needs a matching update — the
coupling is deliberate (DRY with 0108) and called out in the design note.

Every shot gets ONE DOM pass (`src/visual_geometry.py`'s `GEOMETRY_PROBE_JS`) for the
BLOCKING geometry detector (off-viewport / clipped-by-ancestor / zero-size / covered), plus a
pixel diff against any blessed baseline (`src/visual_pixeldiff.py`) — ADVISORY only, never
blocking. A missing baseline for a shot id is reported as an explicit SKIPPED-with-notice
pixel-compare entry, never a silent pass.

Usage:
    cd frontend && python3 scripts/visual_regression.py --tier all --out /tmp/visual-run

Playwright is imported LAZILY (inside functions, not at module import time) so this module —
and every pure helper it defines — can be imported and unit-tested without chromium/playwright
installed (see `tests/test_0113_visual_harness.py`, which imports only these pure pieces and
therefore never carries the literal string that flips `conftest.py`'s browser-lane marker).
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

from src.visual_geometry import GEOMETRY_PROBE_JS, classify_shot_geometry  # noqa: E402
from src.visual_manifest import baseline_bytes, encode_shot_id, load_manifest  # noqa: E402
from src.visual_pixeldiff import (  # noqa: E402
    MaskRect, PixelDiffResult, diff_images, load_image, make_triptych, summarize,
)

# ── the matrix (pure config — no browser needed to read/test these) ────────────────────

#: Fixed across every context for determinism (baseline vs. candidate must be pixel-comparable
#: — a DPI mismatch alone would manufacture a diff). 2x mirrors a typical retina capture.
DEVICE_SCALE_FACTOR = 2

# width, height
TIER_A_VIEWPORTS: List[Tuple[str, int, int]] = [
    ("phone-390", 390, 844),
    ("tablet-768", 768, 1024),
    ("laptop-1024", 1024, 768),
    ("wide-1440", 1440, 900),
]
TIER_B_VIEWPORTS: List[Tuple[str, int, int]] = [
    ("phone-390", 390, 844),
    ("wide-1440", 1440, 900),
]

#: The 5 house themes (0052) — source of truth is `static/js/theme.js`'s `THEMES` map
#: (`house: true` entries). Colors are copied here (not imported — this is a Python harness,
#: the FE ships no server-side theme registry) so a theme-palette edit that isn't mirrored
#: here shows up immediately as a Tier-A pixel diff against the last-blessed baseline — a
#: useful trip-wire, not a maintenance trap, since the whole point of Tier A is to catch
#: exactly that kind of visual drift.
HOUSE_THEME_COLORS: Dict[str, Dict[str, str]] = {
    "the-feed":    {"bg": "#050a05", "fg": "#9fe8a8", "panel": "#0a140b", "border": "#1f4a26", "red": "#ff3b30"},
    "telescreen":  {"bg": "#101418", "fg": "#d7e9ee", "panel": "#151c22", "border": "#2a3e4a", "red": "#56c8e8"},
    "room-101":    {"bg": "#232823", "fg": "#e8ece4", "panel": "#2b302b", "border": "#4a524a", "red": "#d92e2e"},
    "memory-wall": {"bg": "#0b0f16", "fg": "#c8d6ea", "panel": "#111827", "border": "#2c3a52", "red": "#e8b35a"},
    "sequester":   {"bg": "#170d10", "fg": "#e6d3c4", "panel": "#221318", "border": "#4a2a33", "red": "#c9a227"},
}
TIER_A_THEMES: List[str] = list(HOUSE_THEME_COLORS)

#: Tier A's 6 surfaces. `moment` selects WHEN in the walk it is captured: "casting" (during
#: the casting interview, pre-`started`) or "midweek" (the canonical parked beat below).
#: `ensure_js` / `open_js` are best-effort JS one-liners mirroring the same seams
#: `responsive_matrix.py` / `browser_smoke.py` already use to mount lazily-built panels.
TIER_A_SURFACES: Dict[str, Dict[str, object]] = {
    "casting":       {"moment": "casting", "primary_selector": "#chat-container"},
    "chat":          {"moment": "midweek", "primary_selector": "#chat-container"},
    "status-panel":  {"moment": "midweek", "primary_selector": "#orwell-status",
                      "ensure_js": "window._orwellStatusEnsure && window._orwellStatusEnsure()"},
    "gadget-rail":   {"moment": "midweek", "primary_selector": "#gadget-rail",
                      "open_js": "(document.querySelector('.gadget-rail-open,#gadget-rail-open')"
                                 "||{click(){}}).click()"},
    "decision-card": {"moment": "midweek", "primary_selector": "#orwell-decision-card"},
    "settings":      {"moment": "midweek", "primary_selector": "#settings-modal",
                      "open_js": "(document.getElementById('user-bar-settings')"
                                 "||document.getElementById('tool-settings-btn')"
                                 "||document.getElementById('rail-settings')"
                                 "||{click(){}}).click()"},
}

#: The mid-week engine phase Tier A parks at (HOH already resolved, nominees named, real
#: house texture on screen, the decision card live) — a representative "any given Tuesday".
TIER_A_CANONICAL_BEAT = "nominations"

#: Tier B's 7 target beats, in walk order. "finale" is not reached by the CURRENT committed
#: golden fixture (0108's scope stops at the week-1 roll) — it is a legitimate, documented
#: SKIP until a finale-covering fixture exists, never a fabricated shot.
TIER_B_BEATS: List[str] = ["casting", "premiere", "hoh", "nominations", "veto", "eviction", "finale"]

#: Engine `phase` -> Tier-B beat name for the beats reachable purely by watching phase.
#: "casting"/"premiere"/"hoh" are walk-MOMENT beats (see `VisualWalk._run_casting`), not
#: phase values, so they are handled explicitly rather than through this map.
PHASE_TO_BEAT: Dict[str, str] = {
    "nominations": "nominations",
    "veto-competition": "veto",
    "veto-ceremony": "veto",
    "eviction": "eviction",
    "finale": "finale",
}

#: A curated, generic registry probed on EVERY shot for the geometry sweep — not just the
#: shot's "hero" surface, since an off-screen/covered regression can appear anywhere on the
#: page (mirrors `responsive_matrix.py`'s GAME_SURFACES + CHROME registry).
GEOMETRY_REGISTRY: List[str] = [
    "#chat-container", "#chat-form", ".chat-input-bar", "#sidebar", "#orwell-status",
    "#orwell-presence", "#gadget-rail", "#orwell-decision-card", "#settings-modal",
    "#orwell-onboarding", "#orwell-notice-banner", "#orwell-retro", ".ow-window",
]

#: DELIBERATE overlay layers — a covering element inside any of these is the layering system
#: WORKING, never a "covered" finding (the first live run proved 219 of 223 covered-findings
#: were exactly this class). Curated the same way `responsive_matrix.py` curates its
#: non-finding cases (#740: "the OPEN drawer is a deliberate modal slide-over … a legitimate
#: non-finding"):
#:   - kit modal scrims + the gadget-rail drawer scrim (dimming the background is their job);
#:   - the boot loader (a transitional layer over everything, by design);
#:   - open modals/windows/sheets (settings, onboarding, any OrwellWindow/sheet — kit windows
#:     FLOAT over the page by design; the window-vs-composer collision rule stays
#:     `responsive_matrix.py`'s D2/#740 duty, deliberately not duplicated here);
#:   - the gadget rail (its open drawer covers the page on narrow tiers by design);
#:   - the decision card (it owns the above-composer slot — #933/#948).
OVERLAY_ALLOWLIST: List[str] = [
    ".ow-scrim", "[data-ow-scrim]", ".grail-scrim",
    "#app-loader", "#loader-wave",
    "#settings-modal", "#orwell-onboarding",
    ".ow-window", ".ow-sheet",
    "#gadget-rail", "#orwell-decision-card",
]

#: KNOWN geometry findings — finding-ID -> substring the formatted finding line must contain
#: (the EXACT registry pattern of `responsive_matrix.py`: a matching finding reports as xfail
#: instead of blocking; REMOVING an entry when its fix lands flips it back to a hard failure —
#: the gate ratchets; an xpass prints a nudge to remove the entry). Entries are only ever
#: added against a REAL, observed finding — never speculatively. The formatted line shape is
#: `{shot_id} {kind} {label}: {detail}` (see `finding_line`).
#: Each entry scopes BOTH the shot (a shot_id prefix — e.g. one tier/surface/viewport slice)
#: AND the finding substring, so a registered known-issue can never demote the same defect
#: appearing on a DIFFERENT shot or theme (review P1, PR #1244 — a bare substring registry
#: would silently absorb new regressions that happen to render the same line).
XFAIL: Dict[str, Dict[str, str]] = {
    # VIS-1 (first live run, 2026-07-08, tracked in issue #1245): the decision card's content
    # escapes its anchored sheet's overflow:hidden box by ~10-45px at the bottom on phone-390
    # during comp-round beats (tierB hoh + veto: el bottom 733/701 vs ancestor box 690) — the
    # card's lower edge is silently clipped. Remove this entry when the fix lands.
    "VIS-1": {"shot": "tierB:", "needle": "clipped-by-ancestor div#orwell-decision-card"},
    # VIS-2/2b (first live run, 2026-07-08, issue #1245): with the gadget-rail drawer OPEN at
    # tablet-768 the rail (and the status card inside it) measured entirely off the right
    # viewport edge — rect left 774 on a 768-wide viewport, i.e. translateX(100%) — under ONE
    # of the five themes only. Likely a mid-slide capture (the drawer's slide transition does
    # not honor the forced prefers-reduced-motion — itself a product nit), belt-and-suspendered
    # by the post-hook layout-stabilization wait; if it never recurs the xpass nudge says remove.
    "VIS-2": {"shot": "tierA:gadget-rail:tablet-768", "needle": "off-viewport aside#gadget-rail"},
    "VIS-2b": {"shot": "tierA:gadget-rail:tablet-768", "needle": "off-viewport section#orwell-status"},
}


def finding_line(shot_id: str, finding: dict) -> str:
    """The canonical one-line rendering of a geometry finding — the string XFAIL substrings
    match against (same contract as responsive_matrix.py's report lines)."""
    return (f"{shot_id} {finding.get('kind')} "
            f"{finding.get('label') or finding.get('selector')}: {finding.get('detail', '')}")


def split_xfail(shot_id: str, findings: List[dict]) -> Tuple[List[dict], List[dict]]:
    """(blocking, xfailed) — a finding whose formatted line contains a registered XFAIL
    substring is demoted to xfail (annotated with its finding id); everything else blocks."""
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


#: Best-effort selectors for known time-varying content (wall-clock displays, live cost
#: ticks, relative timestamps) — masked out of BOTH images before a pixel diff so a
#: legitimately moving clock can never manufacture a false regression. Extend this list as
#: the first blessed baseline set surfaces additional volatile elements (the bless step's
#: own eyeball pass is the intended feedback loop for tightening it).
MASK_SELECTORS: List[str] = [
    ".msg-time", ".timestamp", "[data-timestamp]", ".chat-meta-count",
    ".session-cost-display", "#os-clock", ".ow-titlebar-time", "[data-live-clock]",
]

MASK_PROBE_JS = r"""
(selectors) => {
  const out = [];
  for (const sel of selectors) {
    let els;
    try { els = document.querySelectorAll(sel); } catch (e) { continue; }
    for (const el of els) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0)
        out.push({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
    }
  }
  return out;
}
"""


def theme_seed_script(theme_name: str) -> str:
    """A JS snippet seeding `localStorage['orwell-theme']` BEFORE first paint (the same proven
    pattern `browser_smoke.py` uses for its frosted-off seed) — a CSS-only theme swap with no
    extra engine/replay turn. Raises KeyError for a non-house theme (a caller bug, not a
    runtime condition to swallow)."""
    c = HOUSE_THEME_COLORS[theme_name]
    colors_js = (
        f"{{ bg:'{c['bg']}', fg:'{c['fg']}', panel:'{c['panel']}', border:'{c['border']}', "
        f"red:'{c['red']}', house:true, _key:'{theme_name}' }}"
    )
    return (
        "try { localStorage.setItem('orwell-theme', JSON.stringify("
        f"{{ name: '{theme_name}', frosted: false, colors: {colors_js} }}"
        ")); } catch (e) {}"
    )


def shot_filename(shot_id: str) -> str:
    """The on-disk filename for a shot id — see `src.visual_manifest.encode_shot_id` for the
    colon<->double-underscore bijection (shared with the bless script so a blessed baseline's
    filename decodes back to the SAME shot id the harness used as its report key)."""
    return encode_shot_id(shot_id) + ".png"


def default_fixture() -> str:
    """The single committed golden fixture, resolved the same way `golden_path_replay.py`
    does — ambiguity (multiple candidates, no canonical `DEFAULT_FIXTURE`) is a hard failure,
    never a silent pick."""
    from src import golden_path as gp
    if os.path.isfile(gp.DEFAULT_FIXTURE):
        return gp.DEFAULT_FIXTURE
    import glob
    hits = sorted(glob.glob(os.path.join(os.path.dirname(gp.DEFAULT_FIXTURE), "golden_path_*.jsonl")))
    if len(hits) == 1:
        return hits[0]
    return gp.DEFAULT_FIXTURE


# ── the walker (needs a browser — Playwright imported lazily by the caller) ────────────────


class VisualWalk:
    """Drives ONE golden-replay walk, taking Tier A/B screenshots + geometry findings at the
    right moments. Constructed with an already-booted `GoldenDriver` (mode="replay") and a
    live Playwright `Browser`. See the module docstring for the composition rationale."""

    def __init__(self, driver, browser, out_dir: str, *, tier: str = "all") -> None:
        assert tier in ("a", "b", "all")
        self.driver = driver
        self.browser = browser
        self.out_dir = out_dir
        self.tier = tier
        self.shots_dir = os.path.join(out_dir, "shots")
        os.makedirs(self.shots_dir, exist_ok=True)
        self.geometry_findings: Dict[str, list] = {}   # blocking findings per shot
        self.geometry_xfails: Dict[str, list] = {}     # known (XFAIL-registered) findings per shot
        self.shots_meta: Dict[str, dict] = {}
        self.tier_a_report: List[dict] = []
        self.tier_b_report: List[dict] = []
        self.captured_beats: set = set()
        self.tier_a_captured = False
        self.errors: List[str] = []

    # ── low-level capture ────────────────────────────────────────────────────────────

    def _new_context(self, w: int, h: int, *, theme: Optional[str] = None):
        ctx = self.browser.new_context(
            viewport={"width": w, "height": h}, device_scale_factor=DEVICE_SCALE_FACTOR,
            reduced_motion="reduce",
        )
        if theme:
            ctx.add_init_script(theme_seed_script(theme))
        return ctx

    def _settle(self, page) -> None:
        page.wait_for_timeout(1200)
        try:
            page.evaluate("window._orwellStatusEnsure && window._orwellStatusEnsure()")
        except Exception:
            pass
        page.wait_for_timeout(300)

    def _probe_and_shoot(self, page, shot_id: str, w: int, h: int) -> list:
        raw = page.evaluate(GEOMETRY_PROBE_JS,
                            {"selectors": GEOMETRY_REGISTRY, "overlays": OVERLAY_ALLOWLIST})
        findings = classify_shot_geometry(raw, {"width": w, "height": h})
        blocking, xfailed = split_xfail(shot_id, findings)
        mask_rects = []
        try:
            mask_rects = page.evaluate(MASK_PROBE_JS, MASK_SELECTORS) or []
        except Exception:
            pass
        png_path = os.path.join(self.shots_dir, shot_filename(shot_id))
        page.screenshot(path=png_path)
        self.shots_meta[shot_id] = {
            "width": w, "height": h, "device_scale_factor": DEVICE_SCALE_FACTOR,
            "label": shot_id, "path": png_path,
            "masks": [{"left": r["left"] * DEVICE_SCALE_FACTOR, "top": r["top"] * DEVICE_SCALE_FACTOR,
                      "right": r["right"] * DEVICE_SCALE_FACTOR, "bottom": r["bottom"] * DEVICE_SCALE_FACTOR}
                     for r in mask_rects],
        }
        self.geometry_findings[shot_id] = blocking
        if xfailed:
            self.geometry_xfails[shot_id] = xfailed
        return blocking

    _LAYOUT_SNAP_JS = """
      (sels) => sels.map(s => {
        const el = document.querySelector(s);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)];
      })
    """

    def _wait_layout_stable(self, page, budget_polls: int = 10) -> None:
        """Poll the registry's rects until two consecutive reads agree (the same settle
        discipline responsive_matrix.py uses for the settings rail) — so a slide-in drawer or
        an entrance transition that ignores the forced reduced-motion can't be captured
        mid-flight and manufacture a phantom off-viewport/covered finding (the VIS-2 class).
        Bounded (~10 x 120ms) so a genuinely animating page still gets shot."""
        prev = None
        for _ in range(budget_polls):
            page.wait_for_timeout(120)
            try:
                snap = page.evaluate(self._LAYOUT_SNAP_JS, GEOMETRY_REGISTRY)
            except Exception:
                return
            if prev is not None and snap == prev:
                return
            prev = snap

    def _capture_one(self, shot_id: str, w: int, h: int, *, theme: Optional[str] = None,
                     hooks: Optional[List[str]] = None) -> list:
        ctx = self._new_context(w, h, theme=theme)
        try:
            page = ctx.new_page()
            page.goto(self.driver.fe, wait_until="domcontentloaded")
            self._settle(page)
            for hook in (hooks or []):
                try:
                    page.evaluate(hook)
                except Exception:
                    pass
                page.wait_for_timeout(400)
            self._wait_layout_stable(page)
            return self._probe_and_shoot(page, shot_id, w, h)
        finally:
            ctx.close()

    # ── Tier A ────────────────────────────────────────────────────────────────────────

    def _tier_a_sweep_surfaces(self, surface_ids: List[str]) -> None:
        if self.tier not in ("a", "all"):
            return
        for surf_id in surface_ids:
            surf = TIER_A_SURFACES[surf_id]
            hooks = [h for h in (surf.get("ensure_js"), surf.get("open_js")) if h]
            for vp_name, w, h in TIER_A_VIEWPORTS:
                for theme in TIER_A_THEMES:
                    shot_id = f"tierA:{surf_id}:{vp_name}:{theme}"
                    try:
                        self._capture_one(shot_id, w, h, theme=theme, hooks=hooks)
                    except Exception as e:  # noqa: BLE001 — a single shot failing must not sink the run
                        self.errors.append(f"{shot_id}: {e}")
            self.tier_a_report.append({
                "surface": surf_id, "status": "captured",
                "viewports": [v[0] for v in TIER_A_VIEWPORTS], "themes": TIER_A_THEMES,
            })

    def _run_tier_a_midweek_sweep(self) -> None:
        midweek = [s for s, v in TIER_A_SURFACES.items() if v["moment"] == "midweek"]
        self._tier_a_sweep_surfaces(midweek)
        self.tier_a_captured = True

    # ── Tier B ────────────────────────────────────────────────────────────────────────

    def _capture_beat(self, beat: str) -> None:
        if self.tier not in ("b", "all"):
            self.captured_beats.add(beat)  # still track for the phase-gate below
            return
        for vp_name, w, h in TIER_B_VIEWPORTS:
            shot_id = f"tierB:{beat}:{vp_name}"
            try:
                self._capture_one(shot_id, w, h)
            except Exception as e:  # noqa: BLE001
                self.errors.append(f"{shot_id}: {e}")
        self.tier_b_report.append({"beat": beat, "status": "captured",
                                   "viewports": [v[0] for v in TIER_B_VIEWPORTS]})
        self.captured_beats.add(beat)

    def _maybe_capture_phase_beat(self) -> None:
        st = self.driver._state()
        phase = st.get("phase")
        beat = PHASE_TO_BEAT.get(phase)
        if beat and beat not in self.captured_beats:
            self._capture_beat(beat)
        if (phase == "hoh-competition" and "hoh" not in self.captured_beats
                and "premiere" in self.captured_beats):
            self._capture_beat("hoh")
        if not self.tier_a_captured and TIER_A_CANONICAL_BEAT in self.captured_beats:
            self._run_tier_a_midweek_sweep()

    # ── the walk itself (a parallel copy of GoldenDriver.walk()'s shape — see module doc) ──

    def _run_casting(self) -> int:
        from scripts._golden_driver import CASTING_SCRIPT

        turn_no = 0
        started = False
        script = CASTING_SCRIPT + ["I'm ready. Let's start the season.", "Ready when you are."]
        for i, line in enumerate(script):
            turn_no += 1
            text = self.driver._turn(line)
            st = self.driver._note_state(turn_no, text)
            if i == 1 and "casting" not in self.captured_beats:
                # a representative mid-interview moment — after the player has said enough
                # that the chat has real content, before the interview concludes.
                self._tier_a_sweep_surfaces(["casting"])
                self._capture_beat("casting")
            if st.get("started"):
                started = True
                break
        if not started:
            raise RuntimeError(
                "casting never finalized during replay — cannot state-drive the visual "
                f"harness (see the FE/engine logs under {self.driver.work})")
        if "casting" not in self.captured_beats:
            self._tier_a_sweep_surfaces(["casting"])
            self._capture_beat("casting")
        self.driver._quiesce_beats("post-create")
        self._capture_beat("premiere")

        # Cast-authoring settle (mirrors 0108 invariant 4's wait): keeps the first week
        # prompt's rendered cast descriptions IDENTICAL to what the fixture recorded, so the
        # request key doesn't drift off a partially-authored cast.
        deadline = time.time() + 90
        while time.time() < deadline:
            try:
                health = self.driver._get(self.driver.fe, "/api/admin/health")
                comp = (health.get("orwell") or {}).get("castAuthoring") or health.get("castAuthoring") or {}
                if int(comp.get("total") or 15) and int(comp.get("authored") or 0) >= 13:
                    break
            except Exception:
                pass
            time.sleep(5)
        self.driver._quiesce_beats("post-authoring")
        return turn_no

    def _run_week(self, turn_no: int, turn_budget: int) -> None:
        from scripts._golden_driver import (
            PHASE_STALL_ABORT, PHASE_STALL_AFTER, PUSH_PROMPT, WEEK_PROMPTS,
        )

        prompt_i = 0
        prev_phase = None
        same_phase_turns = 0
        for _ in range(turn_budget):
            st = self.driver._state()
            pend = self.driver._pending() or (st.get("pending") or {})
            if pend.get("kind"):
                body = self.driver._decision_body(pend)
                if body is None:
                    self.errors.append(f"no fixed decision policy for pending kind "
                                       f"{pend.get('kind')!r} — walk stopped early")
                    return
                self.driver._post_json(self.driver.fe, "/api/orwell/decision", body)
                time.sleep(self.driver.settle)
                self.driver._quiesce_beats("post-decision", stable_polls=2, budget_s=20,
                                          poll_s=0.3, quiet=True)
                self._maybe_capture_phase_beat()
                continue
            turn_no += 1
            if same_phase_turns >= PHASE_STALL_AFTER:
                prompt = PUSH_PROMPT
            else:
                prompt = WEEK_PROMPTS[prompt_i % len(WEEK_PROMPTS)]
                prompt_i += 1
            text = self.driver._turn(prompt)
            st = self.driver._note_state(turn_no, text)
            phase = st.get("phase") or "?"
            same_phase_turns = same_phase_turns + 1 if phase == prev_phase else 0
            prev_phase = phase
            if same_phase_turns >= PHASE_STALL_ABORT:
                self.errors.append(f"phase {phase!r} stalled for {same_phase_turns} turns — "
                                   "aborting the walk early")
                break
            self._maybe_capture_phase_beat()
            if (st.get("week") or 1) >= 2:
                break

    def run(self, *, turn_budget: int) -> None:
        turn_no = self._run_casting()
        self._run_week(turn_no, turn_budget)
        if not self.tier_a_captured and self.tier in ("a", "all"):
            self.errors.append(
                f"Tier A never reached its canonical beat ({TIER_A_CANONICAL_BEAT!r}) "
                "within the turn budget — no midweek shots were fabricated")
        for beat in TIER_B_BEATS:
            if beat not in self.captured_beats:
                self.tier_b_report.append({
                    "beat": beat, "status": "skipped",
                    "reason": "not reached during this fixture's walk (the committed golden "
                              "path currently stops at the week-1 roll; a finale-covering "
                              "fixture would extend Tier B's reach)" if beat == "finale" else
                              "not reached within the turn budget",
                })

    # ── pixel diffs (post-walk; no browser needed) ─────────────────────────────────────

    def run_pixel_diffs(self, baselines_dir: str) -> List[PixelDiffResult]:
        manifest = load_manifest(baselines_dir)
        results: List[PixelDiffResult] = []
        diffs_dir = os.path.join(self.out_dir, "diffs")
        for shot_id, meta in sorted(self.shots_meta.items()):
            with open(meta["path"], "rb") as fh:
                candidate_img = load_image(fh.read())
            base_bytes = baseline_bytes(baselines_dir, shot_id, manifest)
            masks = [MaskRect(**m) for m in meta.get("masks", [])]
            if base_bytes is None:
                results.append(PixelDiffResult(
                    shot_id=shot_id, status="baseline-missing", candidate_size=candidate_img.size,
                    detail="no blessed baseline for this shot id — SKIPPED (never a silent "
                           "pass); bless one with scripts/visual_bless.py"))
                continue
            baseline_img = load_image(base_bytes)
            result, highlight = diff_images(baseline_img, candidate_img, shot_id=shot_id, masks=masks)
            results.append(result)
            if result.status in ("diff", "size-mismatch"):
                os.makedirs(diffs_dir, exist_ok=True)
                trip = make_triptych(
                    baseline_img if result.status == "diff" else None, candidate_img, highlight)
                trip.save(os.path.join(diffs_dir, shot_filename(shot_id)))
        return results


# ── orchestration ────────────────────────────────────────────────────────────────────────


def _write_report(out_dir: str, name: str, data: dict) -> str:
    path = os.path.join(out_dir, name)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=2, sort_keys=True)
        fh.write("\n")
    return path


def _write_summary_md(out_dir: str, *, tier: str, wall_seconds: float,
                      geometry_findings: Dict[str, list], pixel_results: List[PixelDiffResult],
                      tier_a_report: list, tier_b_report: list, errors: list,
                      geometry_xfails: Optional[Dict[str, list]] = None) -> str:
    geometry_xfails = geometry_xfails or {}
    total_findings = sum(len(v) for v in geometry_findings.values())
    total_xfails = sum(len(v) for v in geometry_xfails.values())
    lines = [
        "# Visual regression run — summary",
        "",
        f"- tier: `{tier}`",
        f"- wall time: {wall_seconds:.1f}s",
        f"- shots: {len(geometry_findings)}",
        f"- geometry findings: **{total_findings}** ({'BLOCKING' if total_findings else 'clean'})"
        + (f" · {total_xfails} xfail (known findings)" if total_xfails else ""),
        f"- pixel comparisons: {len(pixel_results)} "
        f"({sum(1 for r in pixel_results if r.status == 'diff')} diff, "
        f"{sum(1 for r in pixel_results if r.status == 'baseline-missing')} no-baseline, "
        f"{sum(1 for r in pixel_results if r.status == 'match')} match) — advisory only",
        "",
    ]
    if errors:
        lines += ["## Harness errors", ""] + [f"- {e}" for e in errors] + [""]
    if total_findings:
        lines += ["## Geometry findings (blocking)", ""]
        for shot_id, findings in sorted(geometry_findings.items()):
            for f in findings:
                lines.append(f"- `{shot_id}` — **{f['kind']}** {f.get('label') or f.get('selector')}: {f['detail']}")
        lines.append("")
    if total_xfails:
        lines += ["## Known findings (XFAIL — non-blocking; remove the registry entry when fixed)", ""]
        for shot_id, findings in sorted(geometry_xfails.items()):
            for f in findings:
                lines.append(f"- `[{f.get('xfail_id')}]` `{shot_id}` — {f['kind']} "
                             f"{f.get('label') or f.get('selector')}: {f['detail']}")
        lines.append("")
    missing = [r for r in pixel_results if r.status == "baseline-missing"]
    if missing:
        lines += ["## Shots with no blessed baseline (SKIPPED, not compared)", ""]
        lines += [f"- `{r.shot_id}`" for r in missing]
        lines.append("")
    diffs = [r for r in pixel_results if r.status in ("diff", "size-mismatch")]
    if diffs:
        lines += ["## Pixel diffs (advisory)", ""]
        for r in diffs:
            lines.append(f"- `{r.shot_id}` — {r.status}: {r.detail}")
        lines.append("")
    lines += ["## Tier A surfaces", ""] + [f"- {row}" for row in tier_a_report] + [""]
    lines += ["## Tier B beats", ""] + [f"- {row}" for row in tier_b_report] + [""]
    path = os.path.join(out_dir, "summary.md")
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines))
    return path


def run(args: argparse.Namespace) -> int:
    from scripts._golden_driver import GoldenDriver, fixture_models
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
    walk: Optional[VisualWalk] = None
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
                walk = VisualWalk(driver, browser, args.out, tier=args.tier)
                walk.run(turn_budget=args.turn_budget)
            finally:
                browser.close()
    finally:
        driver.shutdown()
    wall = time.time() - t0

    assert walk is not None
    pixel_results = walk.run_pixel_diffs(args.baselines)

    total_xfails = sum(len(v) for v in walk.geometry_xfails.values())
    # xpass nudge (the responsive_matrix ratchet): a registered XFAIL id that matched NOTHING
    # this run may be fixed — print the removal nudge so the registry only ever shrinks.
    matched_ids = {f.get("xfail_id") for v in walk.geometry_xfails.values() for f in v}
    xpasses = sorted(set(XFAIL) - matched_ids)
    geometry_report = {
        "format": 1, "tier": args.tier, "wall_seconds": wall,
        "total_shots": len(walk.shots_meta),
        "total_findings": sum(len(v) for v in walk.geometry_findings.values()),
        "total_xfails": total_xfails,
        "shots": walk.geometry_findings,
        "xfails": walk.geometry_xfails,
        "xpasses": xpasses,
        "tier_a": walk.tier_a_report, "tier_b": walk.tier_b_report,
        "errors": walk.errors,
    }
    pixel_report = {"format": 1, "policy": "advisory — never blocks; a missing baseline is "
                    "reported SKIPPED, never a silent pass", **summarize(pixel_results)}
    _write_report(args.out, "geometry_report.json", geometry_report)
    _write_report(args.out, "pixel_report.json", pixel_report)
    # A shots manifest carrying per-shot dims — consumed by scripts/visual_bless.py so a
    # blessed baseline records the same width/height/dsf metadata this run captured with.
    _write_report(args.out, "shots_manifest.json", {
        sid: {k: v for k, v in meta.items() if k != "path"} for sid, meta in walk.shots_meta.items()
    })
    _write_summary_md(args.out, tier=args.tier, wall_seconds=wall,
                      geometry_findings=walk.geometry_findings, pixel_results=pixel_results,
                      tier_a_report=walk.tier_a_report, tier_b_report=walk.tier_b_report,
                      errors=walk.errors, geometry_xfails=walk.geometry_xfails)

    total_findings = geometry_report["total_findings"]
    print(f"\n==== visual-regression: {len(walk.shots_meta)} shots · "
          f"{total_findings} geometry finding(s) · {total_xfails} xfail (known) · "
          f"{sum(1 for r in pixel_results if r.status == 'diff')} pixel diff(s) · "
          f"{sum(1 for r in pixel_results if r.status == 'baseline-missing')} no-baseline · "
          f"{wall:.1f}s")
    if xpasses:
        print("  (xpass — consider removing the XFAIL entries: " + ", ".join(xpasses) + ")")
    if walk.errors:
        print(f"  ({len(walk.errors)} harness error(s) — see summary.md)")
    # Harness errors BLOCK too (review P1, PR #1244): a capture/setup failure that lands zero
    # shots must never let the required CI job pass as if the visual checks ran — the same
    # never-a-silent-pass rule the missing-baseline notice follows.
    return 1 if (total_findings or walk.errors) else 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--tier", choices=["a", "b", "all"], default="all")
    ap.add_argument("--out", required=True, help="output directory for shots + reports")
    ap.add_argument("--baselines", default=os.path.join(FRONTEND, "tests", "visual", "baselines"))
    ap.add_argument("--report", choices=["json"], default="json",
                    help="machine report format (only json is currently supported)")
    ap.add_argument("--fixture", default="", help="golden fixture override (default: the "
                    "single committed frontend/tests/golden/golden_path_*.jsonl)")
    ap.add_argument("--turn-budget", type=int, default=90)
    ap.add_argument("--engine-port", type=int, default=8985)
    ap.add_argument("--fe-port", type=int, default=7985)
    args = ap.parse_args()
    return run(args)


if __name__ == "__main__":
    sys.exit(main())
