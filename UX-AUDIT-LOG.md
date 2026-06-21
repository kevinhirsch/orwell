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

### J1 consolidated additions (5 specialists, de-duped) — J1-14…J1-34

| ID | Sev | Status | Finding (principle → consequence) | Evidence / source |
|---|---|---|---|---|
| J1-14 | HIGH | VIEWED | Settings opens to **Account** tab, not Appearance (recognition/Hick) — wrong default for a zero-data player who wants look/feel. | flows-F3, visual-F8; `desktop/normal/shots/06-settings.png` |
| J1-15 | BACKLOG | VIEWED | **Redundant dual theme paths** (standalone `#tool-theme-btn` popup + Settings→Appearance "Theme" row + Shortcuts "Open Theme") — Tesler. | flows-F2; `07-theme-picker.png`, `06-settings-appearance.png` |
| J1-16 | LAUNCH-BLOCKING | VIEWED | **Session auto-titled "Casting Interview Production Cue"** in sidebar + header — the leaked cue propagates into a persistent player-facing label (match-to-real-world). Part of the J1-03 cluster but distinct (persists beyond transcript). | IA-F1, interaction-F3, content-#1; header/sidebar crops |
| J1-17 | BACKLOG | VIEWED | **Heavyweight Account IA** (Logout/Change Password/2FA) for "Unknown/User" single-player — enterprise furniture mismatched to task. | IA-F5; `06-settings-account.png` |
| J1-18 | HIGH | VIEWED | **Settings gear has no `aria-label`** (only `title`); icon-only nav recognition load (theme btn has aria-label, gear doesn't — inconsistent). WCAG 4.1.2. | IA-F3, content-#9; `index.html:1012` vs `:1009` |
| J1-19 | BACKLOG | VIEWED | **Duplicate profile-photo entry points** (casting card + Settings→Account) with near-identical copy — consistency/which-is-canonical. | IA-F6; `06-settings-account.png` |
| J1-20 | HIGH | VIEWED | **Under-animated marquee beats** — welcome entrance, welcome→casting, narration reveal are hard cuts/pop-ins (no staging/streaming); reduced-motion therefore only trivially compliant. Peak-end + game-feel. | visual-F3, interaction; frames `f_0003→f_0004`, `f_0037→f_0039`, narration mass flat from `f_0040` |
| J1-21 | HIGH | VIEWED | **Composer placeholder "Message Orwell…" contrast ~2.79:1** — WCAG 1.4.3 FAIL. | content-#5, visual-F4; `08-composer-empty.png` (sampled) |
| J1-22 | HIGH | VIEWED | **Streaming meta strip "tok/s · ⟳ 12%" contrast ~1.5–2:1** + tiny — the only "producers working / progress" feedback is near-invisible; also an OOC artifact in-fiction. WCAG 1.4.3. | visual-F4, interaction-F7, content-#8; `05-casting-kickoff.png` meta-row |
| J1-23 | HIGH | VIEWED | **No scrim / triple-stacked overlays** — cast-photo card (and theme popup over it) have no backdrop dim, so live narration competes for figure status; Settings modal proves the scrim exists. Gestalt figure/ground. | visual-F1/F6, interaction-F4/F8; `f_0041`, `f_0080`, `07-theme-picker.png`; contrast `f_0061` |
| J1-24 | BACKLOG | VIEWED | **Theme swatch dots vanish on dark tiles** (the feed/midnight) + abstract 3-dot preview undersells themes. Signifier quality. | visual-F7; `07-theme-picker.png` |
| J1-25 | LAUNCH-BLOCKING | VIEWED | **Cast Photo dialog: no `aria-modal`, no focus trap, background not inert** — focus escapes into chat (confirmed: mobile Escape landed on `body`). Welcome modal does this correctly — reuse it. WCAG 2.1.2/4.1.2. | content-#4; `orwellWindow.js:340-341`; `mobile/normal/mutation-event-log.jsonl` t=16743 |
| J1-26 | LAUNCH-BLOCKING | VIEWED | **Cast-photo portrait/library tiles are non-semantic clickable `<div>`s** (no role/tabindex/key handler/name) — keyboard- & SR-only players cannot pick/regenerate a portrait in OOBE. WCAG 2.1.1/4.1.2. | content-#3; `orwellHeadshot.js:272, 227` |
| J1-27 | HIGH | VIEWED | **Cast-photo status messages have no live region** ("Generating…/Upload failed/photo service offline" silent to SR). WCAG 4.1.3. | content-#6; `orwellHeadshot.js:242, 298` |
| J1-28 | HIGH | VIEWED | **Settings helper/description text contrast ~2.68:1** — WCAG 1.4.3 FAIL (toggle descriptions unreadable for low-vision). | content-#2; `06-settings-appearance.png` (sampled) |
| J1-29 | HIGH | VIEWED | **Loader: ~6s near-black, no spinner/skeleton/status text, no `role=status`/`aria-live`, ASCII-wave ignores reduced-motion.** H1 + WCAG 4.1.3 + 2.3.3. (Extends J1-13.) | interaction-F1, content-#10, visual-F9; `index.html:285-298`; `f_0001-0003`; trace 1555→7424ms |
| J1-30 | HIGH | VIEWED | **No "producers are thinking" pre-token state** between dismiss (7703ms) and first token — reads as lag after the player's only deliberate action. H1/Doherty. | interaction-F5; mutation-log gap 7703→11544ms |
| J1-31 | BACKLOG | VIEWED | **Welcome CTA: weak/inconsistent `:focus-visible` ring + empty `aria`** on the journey's first interactive element. WCAG 2.4.7/4.1.2 (minor — visible text mitigates). | interaction-F6; `trace.json` welcome_ctas `aria:""`; `f_0015` vs `04-welcome-overlay.png` |
| J1-32 | BACKLOG | VIEWED | **Redundant cast-photo lead** — title "Your Cast Photo" then body "**Your cast photo.** Upload…". Content concision. | content-#11; `orwellHeadshot.js:346` |
| J1-33 | BACKLOG | VIEWED | **Vocabulary drift** — Settings/Shortcuts say "sessions/conversations/Toggle Window" vs in-app "Chats". Consistency. | content-#12; `06-settings-shortcuts.png` |
| J1-34 | HIGH | VIEWED | **Casting-kickoff cognitive overload (composite)** — long live stream + leaked "You" cue + floating 4-option photo card overlapping the text, all at once, no lead-in. Sweller extraneous load at the marquee moment. | interaction-F4; `05-casting-kickoff.png` |

**Positives confirmed (keep as patterns):** welcome modal a11y is exemplary (`role=dialog`+`aria-modal`+focus-trap+inert+initial-focus, `orwellOnboarding.js:110-130,233,264-269`); `#chat-history` is `role=log aria-live=polite` with `aria-busy` gating the stream (`index.html:1064`, `chat.js:1117/3189`); two-window same-viewport parity is pixel-identical (0.0% — deterministic); welcome copy + "Meet the producers" CTA are strong, on-voice; mobile DPR2 is crisp.

### De-dup / cluster map
- **The kickoff-cue cluster** (the #1 launch-blocker, all 5 lenses): **J1-03** (visible "You" bubble) + **J1-16** (auto-title) + content-#1 + interaction-F2/F3 + IA-F1 → fix together.
- **Cast-photo surface cluster:** J1-04/J1-23 (scrim) + J1-25 (modal a11y) + J1-26 (tile semantics) + J1-27 (live region) + J1-08 (file clip) + J1-32 (lead) + J1-34 (overload) → fix together.
- **Contrast cluster:** J1-11 (welcome 2ndary — re-measured **PASS ~7.35:1**, drop) + J1-21 (placeholder FAIL) + J1-22 (meta FAIL) + J1-28 (settings helper FAIL).
- **OOC-artifact cluster:** J1-01 (model slug) + J1-22 (tok/s) + content-#8 (version/"Unknown/User").
- **Loader cluster:** J1-13 + J1-29.
- **Theme cluster:** J1-06 + IA-F4 (GPT/claude) + J1-24 (swatches) + J1-15 (dual paths).
- **Note:** J1-11 (welcome secondary contrast) was a *visual estimate*; content-a11y re-measured it at **~7.35:1 (PASS)** → **downgraded/closed**, no longer a finding. Differential resolved in favor of "not a defect."

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

## Journey 1 — remediation applied (gated set #1)

**Applied (status → FIXED, awaiting re-capture):**
| ID | Fix | File(s) |
|---|---|---|
| J1-03 | Skip `(Production cue …)` user turns in history render (live hide already via `sendHiddenCue`) | `chat.js` |
| J1-16 | Auto-title skips cue/control turns → titles from first real player message | `chat_helpers.py` |
| J1-26 | Portrait candidate + library tiles → real `<button>`s (`aria-label`/`aria-pressed`, focus-visible, focus-within reveal of delete) | `orwellHeadshot.js` |
| J1-27 | Singleton SR `role=status aria-live=polite` live region for portrait status | `orwellHeadshot.js` |
| J1-08 | File input → themed `<label>` button + visually-hidden native input (kills "No fil…chosen") | `orwellHeadshot.js` |
| J1-18 | Settings gear `aria-label="Settings"` | `index.html` |
| J1-29 | Loader `role=status aria-label="Loading the house"` (attribute name, **no injected child node**) + `prefers-reduced-motion` guard on the wave | `index.html` |
| J1-21 | Composer placeholder contrast 35%→60% alpha (~4.7:1) | `style.css` |
| J1-28 | `.vis-hint` toggle-desc 30%→62% alpha (~5:1). **Contrast-only** — the `10px`→`--fs-2xs` floor bump reflowed the panel; deferred (sub-floor ships on `main` too). | `style.css` |
| **J1-35** | **NEW** (found during validation): danger-zone "Reset" button nowrap-overflows at 390px (`space-between` flex row, default `flex-shrink:1` squeezed it below its content) → `flex-shrink:0`. Borderline on `main`; any index.html perturbation tipped it. | `index.html` |

**Deferred — needs scoped work (NOT in this set):**
- **J1-25** (cast-photo dialog focus-trap/`aria-modal`/inert) — LAUNCH-BLOCKING a11y, but forcing the whole `.ow-*` window kit modal would break the floating-window/lingering model; needs a per-window `modal` option. → next gated set.
- **J1-22** (hide tok/s meta strip in game build), **J1-01/J1-02** (model slug + composer voice), **J1-04/J1-23** (cast-photo scrim), **J1-06** (theme scoping), **J1-14** (settings default tab), **J1-05/J1-09/J1-10/J1-12/J1-17/J1-20/J1-24/J1-30/J1-31/J1-32/J1-33/J1-34** → Phase-4 backlog / later gated sets.

**Validation (this set):**
- Local pytest **1663 passed**; the 2 pytest + the browser-smoke failures **reproduce on the pre-change baseline** (stash-compare) — artifacts of the shared dev `frontend/data/` (a casting game in progress + the OpenRouter endpoint) the engine-down/zero-data smoke assumes absent. **Not regressions** (confirmed clean on CI's clean checkout).
- **CI clean checkout caught a real regression**: `responsive_matrix` `phone-390+settings nowrap-overflow: Reset`. Binary-searched it to index.html (pure `main` passes 3/3; my other files innocent — matrix passes with them). Root cause = J1-35 (borderline `flex-shrink` squeeze), not the a11y attrs. **Fixed** with `flex-shrink:0`; matrix now **43 pass · 0 FAIL** locally (2 runs). J1-29 reworked to an attribute-only `aria-label` (no child node) as defense-in-depth.
- Post-merge: visual re-capture of the fixed surfaces is the remaining validation step.

## Journey 2 — capture-phase findings (lead, live-LLM walkthrough)

**Status: CAPTURE IN PROGRESS.** Device matrix running (desktop/mobile × normal/reduce, each reset to true
zero-data; driver `.audit-telemetry/run_j2_matrix.sh`). The entries below are the **lead's own direct
observations** from the live-LLM validation walks (OpenRouter `deepseek-v4-pro`); the 5-specialist fan-out over
the full matrix artifact set will ADD to this. Logged as observed (not deferred to consolidation).

| ID | Sev | Status | Finding |
|---|---|---|---|
| J2-01 | LAUNCH-BLOCKING (candidate) | VIEWED | **Casting finalize is non-deterministic — the model can deflect an explicit player readiness signal and keep interviewing, so the season fails to start.** Identical cooperative answers + "I'm ready, put me in the house": one run deflected ("you skipped the question again"), state stayed `character-creation` (never started); other runs finalized at turn-4 / persona / ready1. The FE safety-net (`agent_loop.py` `_CASTING_FORCE_LEVEL = len(_CASTING_NUDGES) = 2`) needs ~3 readiness *lull* turns to FORCE `createCharacter`; a single "put me in the house" only NUDGES. |
| J2-02 | HIGH (root-cause of J2-01) | VIEWED | **`createCharacter` is dropped from the tools actually SENT to the model during casting** — present in `relevant_tools` (candidate pool) but absent from `tool_names` in `[agent-debug]`. It IS in `ORWELL_GAME_TOOLS`, passed as `pinned_tools` when `engine_available` (`chat_routes.py:1190`) and unioned into `_relevant_tools` (`agent_loop.py:2560`), yet filtered out of the final schema. So the finalize NUDGES ("call createCharacter NOW") are unactionable; only the deterministic force (model-bypassing) can start the season. |
| J2-03 | LOW (content) | VIEWED | **Casting front-loads the name ask; a biography-first answer is re-asked every turn.** Producer asks "what do the feeds call you?" right after the photo and re-asks until a literal name is given (a rich "I'm a bartender from Chicago" loops). Model handles it gracefully (escalating mild exasperation — good in-fiction, steelman), but a player answering naturally can loop 1–3 turns before realizing only a *name* advances. |
| J2-04 | LOW (IA/a11y — needs confirm) | OPEN | **Two cast-roster controls with overlapping matchers; the icon-rail mirror `#rail-cast` is present-but-HIDDEN while the sidebar is expanded.** `[id*='cast']` resolves to 2 elements (`#rail-cast` hidden mirror *first* in DOM order + the visible `#sidebar-cast-btn`). Player clicks the visible one fine — but verify the hidden mirror is `aria-hidden`/not tab-focusable, else SR/keyboard users hit a dead control. Confirm in responsive captures. |
| J2-05 | MEDIUM (mobile IA) | VIEWED | **Cast roster unreachable on mobile without first opening the nav drawer.** At the premiere on 390px, `#sidebar-cast-btn` (a `div[role=button]` in the sidebar) is `:hidden` — the mobile sidebar is collapsed by default, so the "who's who" reference is hamburger → drawer → Cast (≥2 taps, off-screen). Reproduced: mobile/normal reached premiere (`house:15`) but the roster step could not run (button not visible). Same pattern as J1-12 (mobile settings/theme behind drawer). Steelman: drawer-nav is standard mobile IA — but the cast reference is *most* needed on mobile precisely while meeting 15 strangers. |
| J2-06 | LOW (a11y, minor) | VIEWED | **Portrait-tile delete `×` tap target 36–38px wide** on the cast-photo studio (height 44 OK; width < the app's own `--tap-min:44px` token). Passes WCAG 2.5.8 AA (24×24) but misses the project target and the AAA 2.5.5 44×44. Seen on android-360 (36), tablet-820 (37), landscape (38). Minor — the `×` only appears once portrait candidates exist (not on the skip path). |

**Verified WORKING (steelman / negative findings — do NOT "fix"):** casting profile recording (`updateCasting`) accrues name/backstory/strategy/motivation/persona correctly; the cast roster opens via `#sidebar-cast-btn` and renders all 15 houseguests (`tiles:87`); the premiere is reliably reached with cooperative answers and the premiere tutorial card (`#orwell-premiere-tutorial`) is present; the #457 hardening middleware (TrustedHost / rate-limit) does not break loopback capture (FE root 200 for `127.0.0.1`+`localhost` Hosts). **Spot-check viewports (android-360 / tablet-820 / landscape-844×390):** the pre-game welcome card and cast-photo studio card show **no H/V overflow** (even on the 390px-tall landscape) and primary buttons are ≥44px — the J1 fixes + responsive kit hold on odd viewports (`runs/j2-spot-*` geometry, 0 page-errors).

**Methodology caveats (rig, not product):** Playwright `networkidle` never settles against the app (persistent polling) → use `domcontentloaded` + explicit settle. The J2 `_settle` waits on `chat-history[aria-busy]` + `chatModule.hasActiveStream` (≤45–75s, reasoning model is slow). Finalize timing varies run-to-run (LLM non-determinism) — J2-01 reproduced across ≥2 of the validation walks.

### Detailed entries — J2

#### J2-01 — Casting finalize non-deterministic; explicit readiness can be deflected · LAUNCH-BLOCKING (candidate) · VIEWED
- **Principle + consequence:** Nielsen *User control & freedom* + Doherty — the single highest-stakes conversion gate (getting INTO the game) can stall *after* the player explicitly asks to start. A player who says "put me in the house" once and is met with another interview question reads it as the game ignoring them; worst case it feels like a soft-lock.
- **Differential diagnosis:** (a) *scenario artifact* — RULED OUT: reproduced with a cooperative player giving a literal name + full answers; (b) *hard soft-lock* — RULED OUT: the season DOES start eventually (the per-user force counter persists across turns; reached premiere at turn-4 / persona / ready1 in other runs); (c) **model under-call + shallow safety-net escalation** — CONFIRMED: model declines to self-call `createCharacter` (see J2-02) and the deterministic force needs `_clv ≥ 2` (i.e. ~3 readiness lulls).
- **Evidence:** validation runs v2 (deflected, `started:False`), v3 (finalized turn-4), v4/desktop-normal (finalized at `persona`). `frontend/src/agent_loop.py:3705-3758` (fallback), `:1488-1496` (nudge rungs / force level), `:1528-1541` (`_player_turn_is_lull`).
- **Confidence:** HIGH it occurs; MEDIUM on frequency (LLM variance). **Severity pending** the specialist read + whether a single readiness push *should* force (product call).

#### J2-02 — `createCharacter` absent from the sent tool schema during casting · HIGH (root-cause) · VIEWED
- **Principle + consequence:** structural — the narration model is told (by prompt + nudges) to "call createCharacter NOW" but the function is **not in its tool list**, so compliance is impossible; the game can only start via the model-bypassing deterministic force. Brittle, and it defeats the documented "always able to call createCharacter" pinning.
- **Evidence:** `[agent-debug]` lines — `relevant_tools=[…,'createCharacter',…]` but `tool_names=[…15 tools, NO createCharacter/updateCasting…]`. Pin path: `tool_schemas.py:1740 ORWELL_GAME_TOOLS` (contains it) → `chat_routes.py:1190 pinned_tools=(… if engine_available)` → `agent_loop.py:2560 _relevant_tools.update(pinned_tools)`. The drop is downstream of the union (final schema build: `disabled_tools` filter / schema lookup / cap — TBD).
- **Next:** code-trace the final schema array construction to find where the pinned game tools are filtered. (Remediation-phase.)

#### J2-03 — Casting front-loads the name ask; biography-first answers loop · LOW (content) · VIEWED
- **Principle + consequence:** *Match between system and the real world* / input affordance — "what do the feeds call you?" invites a persona answer, but only a literal **name** advances; a natural answer loops 1–3 turns. The model's graceful, in-character re-asking (mild exasperation) is a **steelman positive** (texture, not a break), so this is expectation-setting, not a defect.
- **Evidence:** producer replies across v1 ("That's a lot of biography and not one syllable of a name"), repeated re-asks until a name lands.

#### J2-04 — Duplicate cast-roster control; hidden icon-rail mirror · LOW (IA/a11y) · OPEN (needs confirm)
- **Principle + consequence:** consistency + WCAG 4.1.2 — a present-but-hidden duplicate control (`#rail-cast`, `data-rail-source="sidebar-cast-btn"`) sits *first* in DOM order while the visible `#sidebar-cast-btn` is the real target. Sighted pointer users are unaffected; the risk is a hidden-but-focusable dead control for keyboard/SR users.
- **Evidence:** rig click on `[id*='cast']` resolved to 2 elements, picked the hidden `#rail-cast` (Playwright "element is not visible"). `orwellCast.js:23 BTN_ID="sidebar-cast-btn"` (display toggled by live-poll); `sidebar-layout.js` icon-rail.
- **Verify:** check `tabindex`/`aria-hidden` on `#rail-cast` while the sidebar is expanded (desktop) in the matrix captures.

#### J2-05 — Cast roster buried behind the mobile drawer at the premiere · MEDIUM (mobile IA) · VIEWED
- **Principle + consequence:** *Recognition over recall* / accessibility of key info — the cast "who's who" is the player's memory aid for 15 brand-new houseguests, and on mobile it's hidden behind hamburger → drawer (≥2 taps, off-screen) exactly when it's most needed (premiere introductions). On desktop the visible `#sidebar-cast-btn` is one click; mobile loses that.
- **Evidence:** `j2-mobile-normal` reached `premiere`/`house:15` but `#sidebar-cast-btn:visible` timed out (button `:hidden` in the collapsed mobile sidebar); element is `div[role=button][tabindex=0] id="sidebar-cast-btn" data-a11y-enhanced="1"`. Desktop/normal opened it fine (`tiles:87`).
- **Relationship:** instance of the J1-12 "mobile key surfaces behind drawer" pattern → consider a premiere-week persistent cast affordance on mobile (Phase-4 backlog candidate).
- **Confidence:** HIGH (reproduced desktop-vs-mobile).

## Journey progress

- [x] **J1 — First launch → main menu / settings / zero-data** — DONE: 34 findings logged; gated remediation set #1 (9 fixes incl. launch-blockers J1-03/J1-16 + cast-photo a11y + contrast + J1-35 390px hardening) **merged to main in PR #449** (CI green). Deferred to later sets: J1-25 (cast-photo modal trap), J1-22, and the visual/IA backlog (J1-01/02/04/05/06/09/10/12/14/17/20/23/24/30/31/32/33/34).
- [ ] **J2 — Onboarding → first understanding (casting interview, premiere, meeting houseguests)** — **CAPTURE DONE; FAN-OUT IN PROGRESS.** Device matrix (4 reset-fresh live-LLM walks: desktop/mobile × normal/reduce, all reached premiere, 0 errors) + 3 spot checks (android-360/tablet-820/landscape, 0 errors). Lead findings **J2-01…J2-06 logged**. 5 specialists dispatched over the full matrix (running); two-window parity + `f6bbf99` re-sync queued after. Then consolidate → gated remediation set.
- [ ] **J3 — Core loop → playing a round (lingering, talking, live narration, reveals)**
- [ ] **J4 — Resolution & edges (nomination/veto/vote/eviction/finale, meta-progression, empty/loading/error)**

Each journey: capture → fan out to 5 specialists → synthesize/de-dupe → consolidated remediation → **GATE (peer review)** → validate → compact → advance.
