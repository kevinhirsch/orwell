# UX Refactor Audit — Persistent Ledger

Subject: **Orwell** — immersive single-player Big Brother social-game web app (chat-centric "game build"; Python/FastAPI front-end + TypeScript engine over MCP). Visuals fully included. The conversation IS the game (ADR 0003); the Vault Wall (secret state never reaches the player) is absolute.

**Status legend:** `OPEN` → `VIEWED` (seen in telemetry) → `FIXED` (remediated, awaiting re-capture) → `VERIFIED` (re-seen clean).
**Severity:** `LAUNCH-BLOCKING UX` · `HIGH-PRIORITY POLISH` · `UX REFACTOR BACKLOG` · `OUT-OF-LANE` (non-experiential; deferred).

**Device matrix:** desktop = 1440×900, fine pointer · mobile = 390×844, touch, DPR≥2 · spot checks: small-Android 360, landscape, tablet 820/1024.
**Passes:** normal + `prefers-reduced-motion`. **Two windows on one clock** for same-viewport parity.

---

## Environment / rig (Phase 1)

| Item | Value |
|---|---|
| Engine | TS, built to `dist/main.js`; HTTP MCP on `ORWELL_ENGINE_PORT` (8765 here) |
| Front-end | `frontend/`, `uvicorn app:app`; `ORWELL_GAME_BUILD=1 AUTH_ENABLED=false LOCALHOST_BYPASS=true` |
| LLM | OpenRouter `deepseek-v4-pro` wired via `/api/model-endpoints` (key kept in gitignored env only — never committed) |
| Telemetry rig | `./.audit-telemetry/` (gitignored) — Playwright two-window × device matrix, video→ffmpeg filmstrip, mutation/event log, interaction traces, A/B + reduced-motion |
| Tooling | Node 22, Python 3.11, Playwright 1.60 + chromium, ffmpeg 6.1 |

---

## Findings index

| ID | Journey | Severity | Status | One-line |
|---|---|---|---|---|
| J1-01 | J1 | HIGH-PRIORITY POLISH | VIEWED | Raw LLM model slug "deepseek-v4-pro" leaks to player (session title in sidebar/header + composer indicator) |
| J1-02 | J1 | HIGH-PRIORITY POLISH | VIEWED | Composer placeholder reads "Message Orwell…" while narrator/header is "Big Brother" — brand/voice mismatch |
| J1-03 | J1 | LAUNCH-BLOCKING UX | VIEWED | Auto-sent "(production cue — begin the casting interview … do not wait for me to speak.)" stage-direction rendered in the player's transcript |
| J1-04 | J1 | HIGH-PRIORITY POLISH | VIEWED | "Your Cast Photo" card overlaps/occludes the streaming narration that explains it (figure-ground) |
| J1-05 | J1 | HIGH-PRIORITY POLISH | VIEWED | Narration says "the camera panel next to the chat box" — a desktop-spatial reference that breaks on mobile |
| J1-06 | J1 | HIGH-PRIORITY POLISH | VIEWED | Theme picker exposes 21+ themes; only ~5 are house themes — choice overload + brand dilution |
| J1-07 | J1 | UX REFACTOR BACKLOG | VIEWED | Settings exposes many inherited-workspace toggles irrelevant to a BB player (extraneous load) |
| J1-08 | J1 | HIGH-PRIORITY POLISH | VIEWED | "No file chosen" clips to "No fil…" in the cast-photo card on mobile (text overflow) |
| J1-09 | J1 | UX REFACTOR BACKLOG | VIEWED | Welcome modal has no visible dismiss/secondary action; Escape works but is undiscoverable |
| J1-10 | J1 | UX REFACTOR BACKLOG | VIEWED | Welcome card fills only ~10% of desktop viewport — vast dead space, low visual weight on large screens |
| J1-11 | J1 | UX REFACTOR BACKLOG | VIEWED | Welcome secondary paragraph is low-contrast/dimmed — WCAG 1.4.3 contrast candidate |
| J1-12 | J1 | UX REFACTOR BACKLOG | VIEWED | Mobile: settings + theme reachable only via hamburger→drawer→gear (extra steps; gear/theme not directly visible) |
| J1-13 | J1 | HIGH-PRIORITY POLISH | VIEWED | Cold-load loader window not yet visually verified; first paint is a long dark hold before welcome (status-visibility) |

*(Specialist passes append J1-14+. Severity may be re-triaged after consolidation.)*

---

## Detailed entries

### J1-01 — Model slug leaks to the player  · HIGH-PRIORITY POLISH · VIEWED
- **Principle:** Nielsen H2 (match system↔real world) / immersion. The game build gates the model *picker* (`game-trim.css:69` hides `#model-select` for non-admins) but not the model *name*.
- **Consequence:** The Big Brother fiction is broken by a technical id. The session auto-title shows "deepseek-v4-pro 12:12:53 AM" in the **Chats sidebar** and (early) the chat header; the composer shows "deepseek-v4-p…". A player reads an LLM slug where a story label belongs.
- **Evidence:** desktop `runs/j1/desktop/normal/shots/06-theme-picker.png` (sidebar + header), `07…` (composer); mobile `…/mobile/normal/shots/06-composer-empty.png` (composer "deepseek-v4-p…"). Gating: `frontend/static/css/game-trim.css:69`.
- **Differential:** Not a harness/admin artifact — title + composer label are not admin-gated (only `#model-select` is). The header *is* later renamed to "Casting Interview", so the leak is persistent in **sidebar + composer**, transient in the header.
- **Confidence:** H. **Fix:** In game build, suppress the model name in composer/header and title game sessions in-fiction (e.g., "Casting Interview", "Big Brother — Week N").

### J1-02 — Composer placeholder "Message Orwell…" vs "Big Brother" voice · HIGH-PRIORITY POLISH · VIEWED
- **Principle:** Voice/tone consistency; match to real world. The composer placeholder is the inherited workspace brand ("Orwell"); the in-fiction interlocutor is "Big Brother"/the producers (header reads "Big Brother"/"Casting Interview").
- **Consequence:** Immersion wobble at the exact input the player uses every turn; mixed mental model of "who am I talking to."
- **Evidence:** desktop `07-composer-empty.png`, mobile `06-composer-empty.png` — placeholder "Message Orwell …".
- **Differential:** Could be intentional product branding, but it conflicts with the game header/narrator. Confidence: H. **Fix:** game-build composer placeholder → in-fiction ("Talk to the house…", or context-aware "Answer the producers…").

### J1-03 — Production-cue stage direction rendered in the transcript · LAUNCH-BLOCKING UX · VIEWED
- **Principle:** Vault/fourth-wall + content clarity. The onboarding kickoff auto-sends a message ("(production cue — begin the casting interview now. Reach out to me first, in character as the producers; do not wait for me to speak.)") through the normal submit path (`orwellOnboarding.js` ~417–429); it renders as a visible bubble.
- **Consequence:** The player's very first transcript line is a behind-the-scenes prompt instruction "spoken" by them. It exposes the scaffolding, is confusing (the player didn't type it), and damages the first-impression immersion the welcome just built.
- **Evidence:** mobile `06-composer-empty.png` + `05-casting-kickoff.png` (top bubble "(production cue — begin the casting interview now…)"). Visible at first paint of the interview.
- **Differential:** Confirmed render, not a desync — it persists in the transcript. **Confidence:** H. **Fix:** send the kickoff as a hidden/system trigger (not via the visible composer path), or style+suppress it as a non-rendered control message. Verify the auto-send doesn't enter `chat-history`.

### J1-04 — Cast-photo card occludes the narration explaining it · HIGH-PRIORITY POLISH · VIEWED
- **Principle:** Gestalt figure/ground + common region; progressive disclosure. The floating "Your Cast Photo" card overlays the streaming producer narration that describes the photo step.
- **Consequence:** The player reads a card and a half-hidden paragraph saying the same thing; the explanatory text is covered at the moment it's most needed.
- **Evidence:** desktop `07-composer-empty.png`, mobile `05-casting-kickoff.png` (card sits over "…camera panel next to the chat box … Skip for now").
- **Confidence:** H. **Fix:** dock the cast-photo affordance inline below the narration (in flow), or delay the card until the narration beat completes; don't float it over live text.

### J1-05 — Narration references desktop UI geography on mobile · HIGH-PRIORITY POLISH · VIEWED
- **Principle:** Gulf of evaluation (Norman); match to real world. Narration: "See that little camera panel next to the chat box? 📷". On mobile (390px) there is no panel "next to" the composer.
- **Consequence:** The instruction points at UI that isn't where it says on mobile → the player hunts for a control that isn't there.
- **Evidence:** mobile `05-casting-kickoff.png`, `06-composer-empty.png` (narration text vs mobile layout).
- **Differential:** Content/engine-prompt issue surfacing as a UX mismatch — the moment prompt hard-codes desktop spatial language. **Confidence:** M-H. **Fix:** make the photo affordance the diegetic anchor (the card itself, wherever it renders) and avoid spatial deixis in copy; OR ensure a consistent camera affordance position across breakpoints. *(Likely [Out-of-lane] for the engine prompt wording — but the FE placement contract is in-lane.)*

### J1-06 — Theme picker: 21+ themes, ~5 house themes · HIGH-PRIORITY POLISH · VIEWED
- **Principle:** Hick's law (choice overload); brand/immersion coherence; recognition. The picker shows house themes (the feed, telescreen, room 101, memory wall, sequester) **plus** many inherited workspace themes (original, light, midnight, paper, cyberpunk, retrowave, forest, ocean, urne, copper, terminal, organs, lavender, GPT, claude, cute).
- **Consequence:** The curated 5 house themes (0052) are diluted by 16+ off-brand options; "GPT/claude/cute" shatter the Big Brother fiction.
- **Evidence:** desktop `06-theme-picker.png` (full grid).
- **Confidence:** H. **Fix:** in game build, scope the default theme grid to the 5 house themes (keep Customize for power users); or visually section "House themes" first.

### J1-07 — Settings exposes irrelevant inherited toggles · UX REFACTOR BACKLOG · VIEWED
- **Principle:** Tesler's conservation of complexity / extraneous cognitive load; relevance. Appearance shows Chat-Area, Chat-Bar (Agent/Chat switcher, Attach Files), Sidebar brand-name toggles, Text-only Emojis, etc. — workspace controls, several meaningless for a single-player narrative game.
- **Consequence:** A first-timer scanning Settings wades through chat-workspace plumbing to find the few game-relevant controls (theme/density/reduced-motion).
- **Evidence:** desktop `05-settings-appearance.png`.
- **Confidence:** M. **Fix (backlog):** curate a game-build Settings set; hide/relegate workspace-only toggles.

### J1-08 — "No file chosen" clipped on mobile · HIGH-PRIORITY POLISH · VIEWED
- **Principle:** Reflow (WCAG 1.4.10) / no clipping. The native file input label truncates to "No fil…" in the cast-photo card at 390px.
- **Consequence:** Minor, but reads as broken; the file-state text is unreadable.
- **Evidence:** mobile `05-casting-kickoff.png`.
- **Confidence:** H. **Fix:** custom file-control layout that wraps/abbreviates gracefully, or hide the native "no file chosen" text.

### J1-09 — Welcome has no visible escape hatch · UX REFACTOR BACKLOG · VIEWED
- **Principle:** Nielsen H3 (user control/freedom) + discoverability. Single CTA "Meet the producers", `dismiss:false`; Escape dismisses but is undiscoverable; no way to reach settings/model/theme before committing.
- **Consequence:** A player who wants to set theme/model first (or just look around) has no signposted path; the only forward door is the interview.
- **Evidence:** `trace.json` welcome_ctas (one CTA, dismiss:false); `03-welcome-overlay.png`.
- **Differential:** Single-funnel is arguably intended (steelman: focus). **Confidence:** M. **Fix (backlog):** add a low-emphasis "Settings"/"Look around first" affordance, or confirm intent.

### J1-10 — Welcome card tiny on desktop (~10% fill) · UX REFACTOR BACKLOG · VIEWED
- **Principle:** Visual hierarchy / use of space. 420×295 card in 1440×900 = ~10% area; vast empty dark field.
- **Consequence:** The product's first impression reads as sparse/under-confident on desktop; weak visual anchor.
- **Evidence:** `trace.json` welcome_geometry desktop {fill:10} vs mobile {fill:30}; `03-welcome-overlay.png`.
- **Differential:** Cinematic minimalism (steelman). **Confidence:** M. **Fix (backlog):** add atmospheric framing (house imagery/vignette/eyes motif) or scale the card/typography up on ≥1024.

### J1-11 — Welcome secondary text low contrast · UX REFACTOR BACKLOG · VIEWED
- **Principle:** WCAG 1.4.3 (contrast ≥4.5:1). The "producers are due any minute…" paragraph is visibly dimmer than the primary line.
- **Consequence:** Harder to read for low-vision users / bright environments.
- **Evidence:** `03-welcome-overlay.png` (visual estimate — needs token/ratio confirmation).
- **Confidence:** M (estimate). **Fix:** verify the muted-fg token ratio on `--panel`; lift to AA.

### J1-12 — Mobile settings/theme behind drawer · UX REFACTOR BACKLOG · VIEWED
- **Principle:** Wayfinding / Fitts. On mobile the gear (`#user-bar-settings`) and theme (`#tool-theme-btn`) live in the collapsed sidebar — not visible; reachable only via hamburger→drawer.
- **Consequence:** +1–2 taps and a hidden affordance for the two most-likely first-launch controls.
- **Evidence:** capture log (both "not visible" on mobile); hamburger present in `05/06` mobile shots.
- **Differential:** Standard mobile nav pattern (steelman: acceptable). **Confidence:** H (behavior), M (severity). **Fix (backlog):** confirm the drawer is the intended path; ensure the hamburger is obvious during onboarding.

### J1-13 — Loader / first-paint hold · HIGH-PRIORITY POLISH · VIEWED (needs frame confirm)
- **Principle:** Nielsen H1 (system status visibility) / Doherty. First paint is a dark field; welcome appears only after ~6s of probes in capture.
- **Consequence:** A multi-second dark screen with no status risks reading as "broken/blank" on first launch.
- **Evidence:** filmstrip first frames near-black; `02-loader.png` (to confirm whether `#app-loader` spinner shows). Needs frame-level read by visual specialist.
- **Confidence:** M. **Fix:** ensure the loader/spinner is visible during the probe window; cap perceived wait.

---

## Cross-reference with main (other auditors land UX fixes fast — re-checked each journey)

- Another auditor's **live-walkthrough log LW1–LW15** lives in `docs/audits/2026-06-10-full-product-audit.md` (~L1901). Reconciliation:
  - **LW1** (unstyled native file input on casting/headshot gate + Settings pic) [#411, marked fixed] **overlaps my J1-08** ("No file chosen" clipping). → **Re-verify J1-08 against current main before fixing**; only report if it still reproduces on 390px.
  - LW9 (stale prose after silent forced-advance), LW10 (pre-jury eviction has no terminal recap — *largest open gap*), LW11 (eviction night pacing), LW12 (premiere welcome/tutorial lingers into HOH) → **carry into J3/J4** audit; do not duplicate.
  - LW13/LW14 verified clear; LW2–LW8 fixed.
- **#436 WCAG/polish cluster** touched `settings.js, style.css, orwellStatusPanel.js, orwellRetrospective.js, login.html`. My J1 captures predate it → reconcile any settings/contrast finding against current source.
- Last integrated main: `ae12c5c` (will re-fetch before remediation + each new journey).

## Journey progress

- [ ] **J1 — First launch → main menu / settings / zero-data**
- [ ] **J2 — Onboarding → first understanding (casting interview, premiere, meeting houseguests)**
- [ ] **J3 — Core loop → playing a round (lingering, talking, live narration, reveals)**
- [ ] **J4 — Resolution & edges (nomination/veto/vote/eviction/finale, meta-progression, empty/loading/error)**

Each journey: capture → fan out to 5 specialists → synthesize/de-dupe → consolidated remediation → **GATE (peer review)** → validate → compact → advance.
