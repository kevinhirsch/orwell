// Orwell season progress (feature 0057, chunk 2) — the two quiet HUD indicators.
//
//   A. The season PROGRESS BAR — a text-less, ≤5px bar pinned to the very bottom of the
//      viewport (BELOW the chat composer), full viewport width, painted in the theme accent.
//      It fills left→right to show how far through the CURRENT season the player is:
//      ~0% on move-in → 100% when the finale completes. It advances ONLY on the cadenced game
//      moves (weeks, evictions, ceremonies) — lingering / socializing does NOT move it. The
//      percentage is a MONOTONE function of evictions-so-far + the within-week ceremony phase,
//      forced to 100% on the terminal post-season state, computed entirely FE-side from the
//      engine's Vault-free projection (/status + /state). Carries no secret. Resets toward 0
//      when a new season starts (the engine week returns to 1).
//
//   B. The "Season N" CHIP — a quiet corner element shown ONLY when the user is past season 1
//      (GET /api/orwell/season). Season 1 shows nothing.
//
// Game-build only. Honors prefers-reduced-motion. Fails OPEN: any error simply leaves the bar
// where it was (and hides it pre-game). Refreshes on the `orwell:gamechanged` window event.
(function () {
  "use strict";

  function gameBuild() {
    return !!(document.body && document.body.hasAttribute("data-game-build"));
  }
  if (!gameBuild()) return; // never in the full inherited workspace

  const BAR_ID = "orwell-season-progress";
  const CHIP_ID = "orwell-season-chip";
  const POLL_MS = 20000;
  const ready = (fn) =>
    document.readyState === "loading"
      ? document.addEventListener("DOMContentLoaded", fn, { once: true })
      : fn();

  // The cast: 1 player + 15 NPCs = 16 → Final 2 means 14 evictions over the season. The bar's
  // denominator is the number of cadenced "outs" from move-in to the crown.
  const CAST_SIZE = 16;
  const FINAL_SIZE = 2;
  const TOTAL_EVICTIONS = CAST_SIZE - FINAL_SIZE; // 14

  // Within a week, the ceremony cadence advances the bar a FRACTION of one eviction-step, so the
  // fill creeps forward beat-by-beat (HOH → noms → veto comp → veto ceremony → eviction) instead
  // of only jumping on eviction night. Each value is "fraction of this week already traversed".
  // Capped below 1.0 so a within-week beat never reads as the eviction itself (that is the count).
  const PHASE_FRACTION = {
    "setup": 0.0, "premiere": 0.0,
    "hoh-competition": 0.0, "nominations": 0.2,
    "veto-competition": 0.4, "veto-draw": 0.4,
    "veto-ceremony": 0.6,
    "eviction": 0.8, "eviction-reveal": 0.85, "eviction-goodbye": 0.85,
    "final-eviction": 0.9, "finale": 0.95, "jury": 0.95, "jury-finale": 0.95,
    "social": 0.0, "twist-reveal": 0.5,
  };

  let _timer = null;
  let _lastPct = 0; // monotone within a season — never let a transient read pull the fill backward

  async function jget(url) {
    const r = await fetch(url, { credentials: "same-origin" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  }
  async function jgetSafe(url) {
    try { return await jget(url); } catch (_) { return null; }
  }

  // ── the bar ────────────────────────────────────────────────────────────────
  function ensureBar() {
    let bar = document.getElementById(BAR_ID);
    if (bar) return bar;
    const css = document.createElement("style");
    css.id = BAR_ID + "-css";
    css.textContent = `
      /* left:0/right:0 (NOT 100vw) so the bar spans the viewport width WITHOUT adding a
         horizontal scrollbar — 100vw includes the scrollbar gutter and would overflow. */
      #${BAR_ID} {
        position: fixed; left: 0; right: 0; bottom: 0; z-index: 60;
        height: 4px;
        pointer-events: none; display: none;
        background: color-mix(in srgb, var(--accent, var(--accent-primary, #6d4aff)) 16%, transparent);
      }
      #${BAR_ID} > .osp-fill {
        height: 100%; width: 0%;
        background: var(--accent, var(--accent-primary, #6d4aff));
        transition: width .5s ease-out;
        will-change: width;
      }
      @media (prefers-reduced-motion: reduce) {
        #${BAR_ID} > .osp-fill { transition: none; }
      }`;
    document.head.appendChild(css);

    bar = document.createElement("div");
    bar.id = BAR_ID;
    bar.setAttribute("role", "progressbar");
    bar.setAttribute("aria-label", "Season progress");
    bar.setAttribute("aria-valuemin", "0");
    bar.setAttribute("aria-valuemax", "100");
    // J4-14: aria-description is a draft ARIA 1.3 attribute with inconsistent AT
    // support; aria-describedby + a visually-hidden span is the WCAG 1.2-safe path.
    const desc = document.createElement("span");
    desc.id = BAR_ID + "-desc";
    desc.style.cssText = "position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;";
    desc.textContent = "Advances as houseguests are evicted";
    bar.setAttribute("aria-describedby", BAR_ID + "-desc");
    const fill = document.createElement("div");
    fill.className = "osp-fill";
    bar.appendChild(fill);
    bar.appendChild(desc);
    document.body.appendChild(bar);
    return bar;
  }

  function hideBar() {
    const bar = document.getElementById(BAR_ID);
    if (bar) bar.style.display = "none";
  }

  function paint(pct) {
    const bar = ensureBar();
    const clamped = Math.max(0, Math.min(100, pct));
    bar.style.display = "block";
    bar.setAttribute("aria-valuenow", String(Math.round(clamped)));
    const fill = bar.querySelector(".osp-fill");
    if (fill) fill.style.width = clamped + "%";
  }

  // The monotone progress %, FE-computed from the Vault-free projection. Evictions-so-far is the
  // cadence backbone; the within-week ceremony phase adds the fractional creep. Forced to 100%
  // the moment the season is over (moment === "post-season").
  function computePct(status, state) {
    // Terminal: the finale completed — the level is cleared.
    const moment = state && state.moment;
    if (moment === "post-season") return 100;

    // Evictions so far = NPCs no longer "active" + the player if they're out. (Jurors and
    // evictees both count as "out" — they've left the active house; the count is public.)
    let out = 0;
    const house = state && Array.isArray(state.house) ? state.house : [];
    for (const h of house) if (h && h.status && h.status !== "active") out += 1;
    // #555/#556: an in-session season hand-off can leave the engine projection carrying the PRIOR
    // season's terminal player.status into a pristine new season. Mirror orwellStatusPanel's
    // seatStale(): the player's "out" status is real only if the season is finished, past week 1,
    // or someone else is already out — otherwise it's stale and must NOT inflate the bar (~7%).
    const finished = !!(status && status.finished);
    const week = (status && typeof status.week === "number") ? status.week : 0;
    const seatStale = !(finished || week > 1 || out > 0);
    const playerOut = state && state.player && state.player.status
      && state.player.status !== "active" && !seatStale;
    if (playerOut) out += 1;

    // Within-week fraction from the ceremony phase (status.phase is the live ceremony beat).
    const phase = (status && status.phase) || (state && state.phase) || "";
    const frac = PHASE_FRACTION[phase] != null ? PHASE_FRACTION[phase] : 0;

    // Each eviction is one step of TOTAL_EVICTIONS; the within-week phase adds a partial step.
    const steps = Math.min(out, TOTAL_EVICTIONS) + Math.min(frac, 0.99);
    const pct = (steps / TOTAL_EVICTIONS) * 100;
    return Math.max(0, Math.min(100, pct));
  }

  // ── the chip ─────────────────────────────────────────────────────────────
  function ensureChip() {
    let chip = document.getElementById(CHIP_ID);
    if (chip) return chip;
    const css = document.createElement("style");
    css.id = CHIP_ID + "-css";
    css.textContent = `
      #${CHIP_ID} {
        position: fixed; top: 8px; right: 10px; z-index: 58;
        display: none; pointer-events: none;
        padding: 2px 9px; border-radius: 999px;
        font-family: var(--mono, monospace);
        font-size: 11px; font-weight: 600; letter-spacing: .04em;
        color: color-mix(in srgb, var(--accent, var(--accent-primary, #9cdef2)) 88%, var(--fg, #cfd8e3));
        background: color-mix(in srgb, var(--panel, #161616) 78%, transparent);
        border: 1px solid color-mix(in srgb, var(--accent, var(--accent-primary, #355a66)) 38%, transparent);
        opacity: .82;
      }`;
    document.head.appendChild(css);
    chip = document.createElement("div");
    chip.id = CHIP_ID;
    chip.setAttribute("aria-label", "Season number");
    document.body.appendChild(chip);
    return chip;
  }

  // The chip floats top-right, but the top row is shared: the 0054 gadget rail (right edge, full
  // height, desktop), the chat-top-bar "More"/export control, and the chat title (#current-meta).
  // Sit the chip just LEFT of any obstacle its box truly intersects; if the row is too crowded to
  // fit it (mobile: title + export leave no 80px gap), DROP it just below the top bar instead of
  // jamming it over the title. Recomputed on show, on resize, and when the rail toggles.
  function positionChip(chip) {
    const W = window.innerWidth;
    chip.style.top = "8px";
    chip.style.right = "10px";
    const narrow = window.matchMedia && window.matchMedia("(max-width: 768px)").matches;
    if (narrow) {
      // The mobile top bar (hamburger + chat title + export, across ~375px) has no reliable 80px
      // gap — drop the chip just BELOW the bar at the right corner rather than thread/jam it among
      // the controls (where it had grazed the chat title). It rides quietly over the chat scroll.
      const bar = document.querySelector(".chat-top-bar");
      const barBottom = bar ? Math.round(bar.getBoundingClientRect().bottom) : 44;
      chip.style.top = (barBottom + 6) + "px";
      return;
    }
    // Desktop: the only right-edge obstacle is the 0054 gadget rail (full height). Sit the chip just
    // LEFT of it when it holds the right edge; otherwise the right corner is clear.
    const onLeft = document.body && document.body.getAttribute("data-gadget-side") === "left";
    const rail = document.getElementById("gadget-rail");
    if (rail && !onLeft) {
      const r = rail.getBoundingClientRect();
      if (r.width > 0 && r.right >= W - 2 && r.left < W - 4 && r.top < 27) {
        chip.style.right = (Math.round(W - r.left) + 8) + "px";
      }
    }
  }

  function paintChip(season) {
    const chip = ensureChip();
    if (typeof season === "number" && season >= 2) {
      chip.textContent = "Season " + season;
      // UX-6: reflect the live season in the accessible name (was a static "Season number").
      chip.setAttribute("aria-label", "Season " + season);
      chip.style.display = "block";
      positionChip(chip); // clear the gadget rail (avoids the reported header overlap)
    } else {
      chip.style.display = "none"; // season 1 shows nothing (B)
    }
  }

  // Reposition the chip live when the rail toggles (collapse / side-swap) or the window resizes,
  // so it never drifts back under the rail. The gadget rail can MOUNT LATER than our first paint,
  // so: (a) a settle-ramp re-places the chip as layout lands, and (b) the rail observer is attached
  // the first time the rail exists (not just at init, when it may still be null).
  let _railObserved = false;
  function _ensureRailObserver(reflow) {
    if (_railObserved || typeof MutationObserver === "undefined") return;
    const rail = document.getElementById("gadget-rail");
    if (!rail) return;
    const mo = new MutationObserver(reflow);
    mo.observe(rail, { attributes: true, attributeFilter: ["data-collapsed", "style", "class"] });
    if (document.body) mo.observe(document.body, { attributes: true, attributeFilter: ["data-gadget-side"] });
    _railObserved = true;
  }
  function _watchChipPosition() {
    const reflow = () => {
      const c = document.getElementById(CHIP_ID);
      if (c && c.style.display !== "none") positionChip(c);
      _ensureRailObserver(reflow); // attach once the rail has mounted
    };
    window.addEventListener("resize", reflow);
    // The rail usually mounts within the first second; re-place across the settle so the chip
    // never gets stuck at the default corner because it measured before the rail existed.
    [120, 500, 1200, 3000].forEach((ms) => setTimeout(reflow, ms));
    _ensureRailObserver(reflow);
  }

  // ── the chat title (#557) ───────────────────────────────────────────────────
  // The session is named "Casting interview" at casting and never renamed server-side, so the
  // top-bar title (#current-meta) stayed stuck on it for the whole game. Once the season is LIVE
  // we paint a season/week-based title here (the same poll that drives the bar/chip), so the
  // title advances past casting. Pre-game we leave the casting title untouched. FE-only; no
  // gamechanged dispatch — this only reads the Vault-free projection and sets DOM text.
  function paintTitle(started, status, state, season) {
    const metaEl = document.getElementById("current-meta");
    if (!metaEl) return;
    if (!started) return; // pre-game: keep the casting title
    const postSeason = state && state.moment === "post-season";
    const seasonPrefix = (typeof season === "number" && season >= 2) ? ("Season " + season + " · ") : "";
    let title;
    if (postSeason) {
      title = seasonPrefix + "Finale";
    } else {
      const week = (status && status.week) || (state && state.week) || 1;
      title = seasonPrefix + "Week " + week;
    }
    if (metaEl.textContent !== title) metaEl.textContent = title;
  }

  // ── the refresh cycle ─────────────────────────────────────────────────────
  async function refresh() {
    // The chip is independent of game state — show "Season N" whenever N ≥ 2.
    const seasonResp = await jgetSafe("/api/orwell/season");
    const seasonNum = seasonResp && typeof seasonResp.season === "number" ? seasonResp.season : 1;
    paintChip(seasonNum);

    const status = await jgetSafe("/api/orwell/status");
    const state = await jgetSafe("/api/orwell/state");

    // Pre-game (no started season) → no bar. Treat an honest {started:false} as pre-game.
    const started = (status && status.started !== false && typeof status.week === "number" && status.week >= 1) ||
                    (state && state.started === true);
    paintTitle(started, status, state, seasonNum);
    if (!started) {
      _lastPct = 0;
      hideBar();
      return;
    }

    let pct = computePct(status, state);
    // Reset toward 0 for a NEW season: the engine week returning to 1 (and not post-season) means
    // a fresh house, so the bar is allowed to drop back. Otherwise the fill is MONOTONE within a
    // season — a transient under-read never pulls it backward.
    const week = (status && status.week) || (state && state.week) || 0;
    const postSeason = state && state.moment === "post-season";
    if (week <= 1 && !postSeason && pct < _lastPct) {
      _lastPct = pct; // genuine new-season reset
    } else if (pct < _lastPct) {
      pct = _lastPct; // hold the monotone floor
    } else {
      _lastPct = pct;
    }
    paint(pct);
  }

  function start() {
    _watchChipPosition();
    refresh();
    if (_timer) clearInterval(_timer);
    const tick = async () => {
      if (!document.hidden) await refresh();
      _timer = setTimeout(tick, POLL_MS);
    };
    _timer = setTimeout(tick, POLL_MS);
  }

  // Onboarding / any flow that changes the game triggers an immediate refresh.
  window.orwellRefreshSeasonProgress = refresh;
  window.addEventListener("orwell:gamechanged", refresh);

  // Seam for the headless gate.
  window._orwellSeasonProgressEnsure = () => { ensureBar(); ensureChip(); return true; };

  ready(start);
})();
