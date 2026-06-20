# 2026-06-19 — E2E Smoke-Test & HCI Audit (pre-launch)

> 📋 **Audit record** · 2026-06-19 · E2E smoke & HCI (pre-launch) · **Status:** Historical record

**Method:** real stack (TS engine on 8765 + Python/FastAPI FE on 7000), real LLM
(`deepseek/deepseek-v4-pro` via OpenRouter, configured through Settings), driven headless
under Playwright with **autonomous visual telemetry** (full-page PNGs → vision ingest).
Reuses the committed harness in `docs/audits/playtest-harness/`. Run plan:
`docs/audits/playtest-harness/2026-06-19-e2e-smoke-test-plan.md`.
**Deliverable posture:** DOC-ONLY — findings + proposed fixes; no product-code edited this run.
**Lenses:** spatial equilibrium / game-feel, Gestalt (proximity, figure-ground), cognitive
load + affordance (Norman/Gibson/Sweller), architecture/WCAG 2.1 AA.

**Triage key:** **[BLOCK]** launch-blocking · **[POLISH]** high-priority polish.

---

## State 1 — Initial Instantiation (login, zero-data landing, settings)

**Artifacts:** `s1-login-{desktop,mobile}`, `s1-landing-{desktop,mobile}`,
`s1-settings-{ai,appearance,account,system,shortcuts}-{desktop,mobile}`.

**What's good:** the login card is clean, centered, on-brand (👁 Orwell wordmark, subtle grid
bg, version pinned bottom-right). The Settings window is well-structured — a left rail
(Add Models / AI Defaults / Search / Appearance / Shortcuts / Account / ADMIN) with grouped,
labelled sections; AI Defaults correctly shows the configured OpenRouter / deepseek-v4-pro;
Appearance exposes granular Chat-Area / Chat-Bar / Sidebar toggles with helpful sublabels.
No overflow or tap-target failures in the automated scan on these surfaces.

### Findings

| ID | Sev | Finding | Evidence | Proposed direction |
|---|---|---|---|---|
| **S1-1** | **BLOCK** | **Zero-data landing overlaps the casting card on top of the welcome message** — the first screen a new player sees renders the "Casting headshot / make your portrait" card *over* the welcome block ("The house is waiting." + "Tip: The Diary Room is private — the house never hears it."), so both texts collide and are unreadable (figure-ground violation). The automated overflow scan misses it (z-stack overlap, not horizontal overflow). | `s1-landing-desktop.png`; innerText confirms both blocks co-occupy the empty-chat center region. | When the casting/onboarding inline card mounts in the empty-chat state, suppress the `.welcome-message` block (or push the card into normal message flow below it). Altitude: the empty-chat/welcome controller in `chat`/`init.js` + the casting-card mount. Mutually exclusive: welcome OR inline onboarding card, never stacked. |
| **S1-2** | POLISH | **Console 404 spam in the game build** — the client unconditionally polls `/api/orwell/avatar` (19×/load), `/api/tts/stats` and `/api/stt/stats` (8× each); all 404 in the reduced build. TTS/STT are trimmed; avatar 404s when none set. | FE access log; `tts-ai.js`, `voiceRecorder.js`, `orwellAvatar.js`, `orwellHeadshot.js`. | Gate these pollers behind their feature flags in game build, and have `/api/orwell/avatar` return 204/a default instead of 404 when unset. |
| **S1-3** | POLISH | **Raw, unstyled `<input type=file>`** ("Choose File / No file chosen") in the casting-headshot card breaks the themed dark aesthetic (default OS chrome, light box). | `s1-landing-desktop.png` (the card). | Wrap the file input in a styled label/button matching the theme (`.btn`/upload-control pattern); hide the native input. |
| **S1-4** | POLISH | Login password field renders a **clear (ⓧ) glyph while empty** — ambiguous affordance (reads as an action with nothing to clear). A reveal-eye toggle would signify better. | `s1-login-desktop.png`. | Swap to a show/hide eye toggle, or hide the clear glyph until the field is non-empty. |
| S1-5 | NOTE | Hidden workspace copy still ships in `index.html` ("Import a .txt … suggests candidate memories you can approve") — game-trimmed (not visible), but present in the DOM. Low risk. | `index.html:306`. | Confirm game-trim hides it; optionally strip from the game build template. |

*(Mobile login/landing/settings parity captured; the S1-1 overlap reproduces on mobile too.)*

---

## State 2 — Onboarding / Casting interview (live, Persona 1: "Marisol Vega", social-butterfly)

Driven live through the real chat against `deepseek/deepseek-v4-pro`. **Methodology note:** the
*raw* model stream contains the model's tool-planning reasoning (it names `updateCasting`
etc.), but the **rendered UI correctly hides it** — leak triage must read the rendered DOM
(`viewSession`), not the raw stream. With that correction, **no machinery leak reached the
player** across casting.

**What's good (keep):** the casting interview is a genuine strength. It is **incremental and
engine-grounded** — each answer is recorded via `updateCasting` (engine `casting.known`
populated: name, backstory, motivation, `personaArchetype=social-butterfly`,
`strategyStyle=social`, 4 interview notes); the engine computes `ready`/`missing`/`next`; the
producer voice is warm, specific, and reacts to the player's actual answers. Tool calls render
as a **tidy "✓ 📋 CASTING NOTES done" chip**, not raw machinery. The model used **real roster
names and invented zero houseguests** on move-in (clears the playbook's worst flash-era bug,
B4). Auto-naming the session from the player's line ("People Are My Whole Thing") is a nice touch.

### Findings

| ID | Sev | Finding | Evidence | Proposed direction |
|---|---|---|---|---|
| **S2-1** | POLISH | **Model under-finalizes casting.** With `casting.ready=true`, the model kept re-interviewing for optional fields and only called `createCharacter` after **two explicit "lock it in"** cues — so entering the house depends on the model deciding to finalize. | Turns 4–5: `started:false` after a clear "put me in the house"; started only on the 2nd hard cue. | When `casting.ready=true`, surface a **structural "Enter the house" affordance** (button on the casting card / onboarding) that calls `createCharacter` directly — don't leave finalization solely model-driven. Mirrors the FE's existing `advanceGame` error-correction philosophy (0055). |

---

## State 3 — Core gameplay loop (live HUD, narration, presence)

**Artifacts:** `game1-desktop`, `game1-rail`, `game1-chat`, `cast1-desktop`.

**What's good (keep):**
- **The gadget-rail HUD (0054) is clean and correct** — "The house" gadget with collapse /
  side-swap / close; a "Week 1 Premiere" card showing the player's standing (HOH/Noms/Veto —);
  the full real roster (16/16); and a "Where you are" presence card (room + adjacency + who's
  nearby). **Vault-safe**: only public facts — no stats, threat, or soul numbers.
- **Narration richness** hits the behavioral-fidelity mandate: distinct, vivid NPC voices on
  the move-in tour (Carla the bartender, Ivy the firefighter "running calculations on all of
  us", Erica organizing the fridge), real names throughout, hidden-trait *hints* without leaks.
- **Engine grounding/discipline is strong on `-pro`**: the move-in turn drove 11 engine tool
  calls (advance/state/record); the board progresses through the engine, not model fiat.

### Findings

| ID | Sev | Finding | Evidence | Proposed direction |
|---|---|---|---|---|
| S3-1 | NOTE | HUD roster header reads "The house · 16/16" above a list that visually shows the 15 NPCs (the player is the separate "You" block) — the 16 count appears to include the player. Mild ambiguity. | `game1-rail.png`. | Either label "15 houseguests" for the NPC list, or include the player row, so the count matches the visible list. |

---

## ★ Engine integration — the centerpiece finding (core-loop failure)

This is the deepest, most important class of defect and the reason the whole hexagonal
architecture exists. **It reproduced on the very first competition, live, on `deepseek-v4-pro`.**

### S3-CORE — [BLOCK] The model bypasses the engine on competition resolution: invents an outcome AND a houseguest

**Sequence (week 1 HOH competition, played authentically):**
1. The engine raised a real decision, `pending: comp-intent` (compete / throw / play-safe).
2. The player declared "play it safe" **in chat**.
3. The model's own reasoning said *"The player has chosen play-safe … Let me submit that
   decision and then advance the game"* — **but it never called `submitDecision`.** The engine
   stayed `phase: hoh-competition, hoh: None, pending: comp-intent` (unresolved).
4. The model then **narrated the entire competition as fiction** and announced a winner:
   **"CASSIDY HOLLOWAY — you are the first Head of Household!"** … "Cassidy — corporate
   strategist, thirty-one. You remember her card from the memory wall." A fabricated NPC
   (Tasha) even reacts to the fabricated HOH.

**Two violations in one turn — both player-facing (`bug-cassidy-crop.png`):**
- **Engine bypass / anti-sycophancy (the playbook's B6).** The outcome was authored by the
  narrator, not the engine. The engine never resolved the comp; narration and ground truth
  desynced (narration: Cassidy HOH; engine: still no HOH).
- **Houseguest invention (the playbook's B4), CRITICAL.** "Cassidy Holloway" is **not on the
  roster** (Shelby Love, Josie Costa, Tasha Marshall, Jaxon Hunter, Tyler Hensley, Erica Haley,
  Arjun Shepherd, Pablo Hartman, Tristan Miranda, Carla Everett, Weston Yang, Ivy Serrano,
  Vincent Norman, Lila Holland, Ciara Woods). The model fabricated a brand-new houseguest —
  with invented continuity ("her card from the memory wall") — and crowned her.

**Proof the engine is correct and the model is the failure point:** submitting the *same*
decision through the **structured route** (`POST /api/orwell/decision {kind:"comp-intent",
choice:["play-safe"]}`) resolved it instantly and correctly — **"Pablo Hartman wins Head of
Household"** (real roster member), engine advanced to `nominations` with `hoh: Pablo Hartman`.
The engine is flawless. The defect is entirely in the narration→engine handoff.

**Why this is launch-blocking:** the product's entire promise is "the deterministic core
decides, the LLM only narrates" (anti-sycophancy) and "names are fixed" (no fabricated cast).
This single turn broke both, in the most visible possible place (crowning the first HOH), on
the strongest configured model. Earlier turns grounded names correctly — invention appears
**specifically when the model improvises an outcome the engine should own**, which is the exact
moment the guardrails must bind.

**Why the existing guardrails miss it:** the FE error-correction (0055 `_auto_record_scene`,
the progression stall-nudge) covers *recording social scenes* and *nudging `advanceGame` on a
lull* — it does **not** force `submitDecision` when the engine has a **pending player decision**
(comp-intent, etc.) that the model narrated past. Substantive (non-lull) turns also skip the
nudge.

**Proposed direction (engine error-correction, keep the dynamic DM — owner's ruling):**
1. **Pending-decision interlock (highest priority).** When the engine reports a `pending`
   player decision, the FE must **block the model from narrating past it** until it is
   resolved: detect the player's intent from the turn and call `submitDecision` itself
   (extraction call, same pattern as `_auto_record_scene`), or surface the **structured
   decision card** for that pending and require commitment before further narration. The
   engine result is then the only outcome the model may narrate.
2. **Roster validation / name error-correction.** After each narrated turn, validate
   capitalized person-names in the **visible** body against `GET /api/orwell/state house[].name`;
   on a non-roster "houseguest", flag/repair (re-ground the model to the real roster). At
   minimum, never let a fabricated name enter a *ceremony outcome*.
3. **Outcome guard.** The model must not emit a comp/nomination/veto/eviction *result* until
   the corresponding engine event exists (the playbook's "runCompetition only previews — you
   MUST advance" rule, enforced structurally rather than by prompt alone).

**Corroboration — the fabrication persists and compounds (HUD vs chat contradict).** On the
next turn the engine (driven by the structured resolution + the model's own `advanceGame`)
correctly progressed: HOH **Pablo Hartman** nominated **Vincent Norman** and **Weston Yang**,
phase → veto-competition. The HUD reflects this exactly (`reconcile-rail.png`). But the chat
narration **doubled down on the fiction** — it re-introduced "Cassidy Holloway" as HOH and had
her speak to the player (`reconcile` split: visible body contains "Cassidy", not "Pablo").
Result: the two primary surfaces now describe **different games** — the HUD says Pablo
Hartman/Vincent/Weston; the story says Cassidy Holloway. A first-time player cannot tell which
is real. This shows the failure is not a one-turn slip: once the model authors an outcome the
engine owns, it maintains a **divergent parallel narrative** that drifts further from ground
truth every turn. The pending-decision interlock (fix #1) must therefore also **re-ground the
model to engine state at the top of every turn** (it already receives the visible projection;
the gap is that it isn't *bound* to it for ceremony facts).

*(Recovery for the audit: comp-intent and subsequent ceremonies are driven via the structured
route — real HOH Pablo Hartman, noms Vincent Norman/Weston Yang — so the engine-backed UI
surfaces, HUD, decision cards, finale and retrospective can still be captured authentically,
even though the chat narration has diverged.)*

---

## State 4 — Resolution & endgame (decision card, eviction, finale, retrospective, new-season)

Driven via the structured route + engine `advanceGame` to a full season completion (the player,
Marisol, was evicted mid-game and correctly served as a **juror** — the player-loss + juror path
works). Final 2: Arjun Shepherd & Weston Yang; **winner Arjun Shepherd** (13 weeks).

**What's good (keep):**
- **The structured decision card** (`decision-card-only.png`) is excellent: clear title,
  real-roster options, the copy "**Your selection only — never read from prose**", and a
  binding **Confirm**. This is the correct anti-sycophancy surface.
- **Secret-ballot staged reveal (E12)** works — eviction events render anonymized ("a vote to
  evict Vincent Norman", repeated per ballot), with per-voter attribution only unsealed
  post-season.
- **The post-season UI is rich and entirely engine-true** (`postseason-rail.png`): a per-juror
  finale vote reveal (incl. "Marisol Vega votes for Arjun Shepherd" — the player's real juror
  vote), "Arjun Shepherd wins the season over Weston Yang", a "🔒 Open the Producer's Vault"
  retrospective unseal ("the hidden story they never showed you — scheming, confessionals, the
  twist that never fired"), and an "A new season" card with **Keep this houseguest** /
  **Recast from scratch** (0056/0057).
- **The retrospective (0048) unseals the Vault correctly** — alliances, conflicts, gossip, and
  confessionals (e.g. "[confessional Ciara Woods] I need Pablo Hartman gone — they're my biggest
  threat. Josie Costa is the one I actually trust.") — a true post-season reveal of the hidden
  layer, only after the game is over.

### Findings

| ID | Sev | Finding | Evidence | Proposed direction |
|---|---|---|---|---|
| **S4-1** | **BLOCK** | **The decision card is dispatched ONLY by `chat.js` parsing the agent's `advanceGame` output** (`chat.js:2237`); the status HUD shows the pending but offers **no way to act on it**. So when the model narrates past a pending (S3-CORE), the player is **stuck** — the HUD says "eviction / vote" but there is no control to vote, and no structured fallback. Confirmed: with a real `pending: eviction-vote` for the player, no decision card rendered until manually dispatched. | `orwellStatusPanel.js` (no decision handling); `orwellDecision.js:11`; engine `pending.by=player` with no card. | Have the **status poller** also dispatch `orwell:pending` (or surface a "Resolve decision" affordance in the HUD) whenever the engine reports a player `pending` — so the structured card is reachable independent of the chat agent. This is the structural escape hatch that makes S3-CORE non-fatal. |
| **S4-2** | POLISH | **Status/finale projections go stale at season end.** `GET /api/orwell/status` never reports `finished`/`winner` (kept returning `phase: finale`), and `finaleView` returns `null` after the season ends — even though the engine reports `finished:true, moment:post-season` and `recap`/`retrospective` have the winner. The FE recovers via `/api/orwell/state` (`moment:post-season`) to show the retrospective, but a `status`-driven HUD would hang on "finale". | `status` vs `getGameState`/`recap` mismatch. | Surface `finished`/`winner`/`post-season` on the `status` projection (and have `finaleView` return the final result, not null, once decided) so every client agrees the season ended. |
| S4-3 | POLISH | The new-season "This season's portrait" reuses the same raw `<input type=file>` as S1-3. | `postseason-rail.png`. | Same fix as S1-3 (styled upload control). |

---

## State 5 — Multi-season run (3 sequential seasons, 3 distinct personas)

Played three sequential seasons via the restart door, each with a distinct human-authored
persona — all cast **live** through the interview:
1. **S1 — Marisol Vega** (social-butterfly) → full season → winner Arjun Shepherd, Marisol on the jury.
2. **S2 — Derek Cross** (comp-beast) → full season (Derek evicted → juror) → post-season.
3. **S3 — Nadia Okafor** (paranoid-strategist) → cast + started.

**What's good (keep) — the multi-season machinery is solid:**
- **The restart door is clean** (`registry.resetUser` via `POST /api/orwell/next-season`,
  keep=false / "Recast from scratch"): season number increments 1→2→3 (surfaced as a
  "Season N" badge, `s2-rail.png`/`s3-rail.png`), the game resets to a fresh
  `character-creation`, and **no prior-season state bleeds through** (HUD, roster, player all
  fresh).
- **Distinct casts every season, zero carryover** (0004 replayability / 0007
  non-degradation): S1 (Shelby Love, Josie Costa, Tasha Marshall…), S2 (Angela Reeves, Axel
  Stanley, Hector Chandler…), S3 (Ezra Clark, Leah Liu, Eli Quintero…) — no overlapping names
  or identities across seasons.
- **Casting works consistently across archetypes** — social-butterfly, comp-beast, and
  paranoid-strategist each produced a coherent, engine-recorded casting file.
- **The next-season door correctly refuses** a recast while a season is in progress
  ("the current season is not over yet") — the completion guard works.

### Findings

| ID | Sev | Finding | Evidence | Proposed direction |
|---|---|---|---|---|
| S5-1 | POLISH | The **S2-1 under-finalize** pattern is consistent across seasons (each `createCharacter` needed an explicit "lock it in"). | S1, S2 casting. | Same as S2-1 (structural "Enter the house" when `casting.ready`). |
| S5-2 | NOTE | The **S3-CORE engine-bypass bug is season-agnostic** — it will recur on every season's first competition unless the pending-decision interlock lands. | (inferred; S3-CORE reproduced live). | Fixing S3-CORE fixes all seasons. |

**Both restart paths validated:**
- **Recast from scratch** (keep=false): S1→S2→S3, fresh casting interview each time, distinct casts.
- **Keep the houseguest (0056)** (keep=true): S3→S4 carried **Nadia Okafor** forward, **skipped
  casting** (straight to `premiere`), and generated a fresh cast (London Montoya, Zara Morrow…).
  Season number 1→2→3→4 throughout; the next-season door refuses while a season is live.

---

## Summary & triage (launch is next week)

**The headline:** the **engine and every engine-backed surface are excellent** — casting, the
gadget-rail HUD, the structured decision card, secret-ballot reveal, finale, the retrospective
Vault-unseal, and the whole multi-season restart machinery are correct, Vault-safe, and
well-designed. The narration quality (voices, social texture, real-name grounding on
introductions) is genuinely strong. **The single critical defect is the narration→engine
handoff**: when the model should *commit a decision the engine owns*, it instead improvises the
outcome (and sometimes a houseguest), bypassing the engine and desyncing the game.

*(Note: State 6 — responsive, themes, windowing, Producer's Vault, WCAG — is appended below
this summary; its findings are folded into the triage here.)*

> **Round-4 status (synced `main`, 2026-06-20):** S3-CORE **FIXED**; S1-1 **likely addressed** by
> the onboarding redesign; **S6-2 STILL PRESENT**; S4-1 unverified on synced main. See State 8.

### [Launch-Blocking]
- **S3-CORE** — *(original)* model bypasses the engine on decision resolution; invents outcomes
  and houseguests; desync compounds. **→ FIXED on synced `main`** (State 8): the premiere
  engine-truth gate makes the model defer to the engine; the first HOH resolved to a real roster
  member with no fabrication/desync.
- **S6-2** — the **Cast window covers the left sidebar** and intercepts its clicks (default slot at
  x=14 over the 240px sidebar). **→ STILL PRESENT on synced `main`** (narrowed to w=360 by the 0064
  layout sync but not moved off the sidebar). browser_smoke only stopped flagging it because it now
  parks the window before the sidebar click.
- **S4-1** — the structured decision card is only reachable through the chat agent; the status HUD
  offers no fallback. *(Less critical now that S3-CORE is fixed, but the structural escape hatch is
  still worth adding; not re-verified on synced main.)*
- **S1-1** — *(original)* zero-data landing overlaps the casting card on the welcome message. **→
  Likely addressed on synced `main`** by the onboarding redesign (welcome modal + non-dismissable
  cast-photo window; browser_smoke's "cast-photo window does not overlap the welcome brand mark"
  passes). Worth a fresh-onboarding visual confirm.

### [High-Priority Polish]
- **S2-1 / S5-1** — model under-finalizes casting; add a structural "Enter the house" when ready.
- **S4-2** — `status`/`finaleView` projections go stale at season end (no `finished`/`winner`).
- **S6-1** — HUD roster header (`.os-roster-h`) renders below the 11px legibility floor
  (9.1–10.4px) at ≤1024px viewports.
- **S6-3** — raw internal pathway id (`overheard:offscreen:strategy:1358:7985649`) leaks into the
  player-facing retrospective.
- **S6-4** — primary red button (white-on-`#e06c75`) is 3.20:1 — below WCAG AA for normal text.
- **S7-1** — the Settings modal is not a focus trap and doesn't take focus on open (a11y / WCAG 2.4.3).
- **S1-2** — game-build console 404 spam (`avatar`, `tts/stats`, `stt/stats`).
- **S1-3 / S4-3** — raw unstyled `<input type=file>` across casting / account / new-season.
- **S1-4** — login password field shows a clear glyph while empty.
- **S3-1** — HUD "16/16" count vs the visible 15-NPC list ambiguity.

### Coverage (this audit)
Login · zero-data landing · settings (AI/Appearance/Account/System/Shortcuts) · theme picker ·
live casting (×3 archetypes) · core gameplay + narration grounding · the gadget-rail HUD +
presence · live decision flow + structured decision card · eviction/secret-ballot · finale ·
retrospective + Producer's Vault unseal · new-season · **4 seasons** (recast ×3 + keep-character)
· responsive matrix (6 viewports + 200% font) · 5 house themes · windowing (collapse/swap/mobile
drawer/diary) · mobile gameplay · copy proofread · WCAG AA contrast · CI gates
(`responsive_matrix.py`, `browser_smoke.py`).

### Priority invariants — verified PASS at runtime (State 7, do not regress)
- **Vault Wall (#1 mandate):** player channel exposes no secret state; `seasonRetrospective`
  refuses while live; **admin/God Mode is walled** (refuses Vault tools); the **GM prompt fed to
  the LLM carries no Vault data** (vocabulary only, zero numeric soul/relationship values).
- **Cross-user isolation (0021):** each user gets an isolated sandbox; no leakage across users.
- **Diary Room OOC isolation (0002/0014):** diary `witnessSet:['player']`; NPCs never surface it;
  the player channel can't inspect NPC views (self-pinned `getVisibleStateFor`).

### What to protect (do not regress)
The casting interview, the gadget-rail HUD + presence, the decision-card copy ("your selection
only — never read from prose"), the secret-ballot reveal, the retrospective Vault-unseal, and
the multi-season restart/replayability. These are the product's strengths.

---

## State 6 — Responsive, house themes, windowing, mobile, copy (deeper sweep)

### Responsive matrix (the canonical `responsive_matrix.py` gate, run live)
**38 pass · 5 FAIL** across 320/390/820/1024/1366/1440 + the 200%-root-font pass. The layout
is genuinely responsive: **no horizontal overflow, no surface overlap, tap-target floors met,
settings-rail orientation correct, 200%-font integrity holds.** The 5 failures are all the
**same** legibility defect:

| ID | Sev | Finding | Evidence | Proposed direction |
|---|---|---|---|---|
| **S6-1** | POLISH | **Sub-floor font in the HUD roster header.** `.os-roster-h` ("The house · N/16") is `font-size: .8em` *relative* to a `--fs-xs` (~12px) parent → ~9.1–10.4px at ≤1024px viewports, below the `--fs-2xs` 11px legibility floor (S10 token contract). | matrix FAILs at tiny-320 (9.1px), phone-390 (9.2px), tablet-820 (10.0px), laptop-1024 (10.4px); `orwellStatusPanel.js:138`. | Set `.os-roster-h` to `font-size: var(--fs-2xs)` (or `max(.8em, var(--fs-2xs))`) so it never drops below the floor. |

### House themes (0052) — all 5 apply cleanly
`the-feed` (green CRT), `telescreen` (cyan), `room-101` (neutral), `memory-wall` (amber/blue),
`sequester` (warm). Each applies the `house-theme--<key>` frost treatment without breaking
layout; foreground/background pairs are high-contrast (e.g. the-feed `#9fe8a8` on `#050a05`;
sequester `#e6d3c4` on `#170d10`) and read well. No theme-specific defects found.

### Windowing / gadget rail (0054) — interactions work
Rail **collapse → right-edge icon strip**, **side-swap** (rail moves left), and the **mobile
drawer** (content behind a FAB at ≤768px) all function. Diary Room opens with its correct
"private & out-of-character — the house never hears this" label; presence mounts. No window
defects observed beyond S4-1 (the decision card's chat-only trigger).

### Mobile gameplay (375×812) — clean
Narration is readable, the composer + model indicator + send are reachable, the Season badge
shows, and the rail collapses to a FAB drawer. Move-in narration grounded correctly to the S3
roster (Desiree, Eli, Esme). No overflow or clipping.

### Copy & runtime hygiene
- **Copy is clean**: no space-before-punct, double-space, `FR-/NFR-` jargon, `undefined`/
  `[object Object]`, or engine-machinery strings in the rendered live-game or settings text.
  (The s1 automated "double-space" flags were false positives from theme-name concatenation.)
- **Zero `pageerror`/`console.error` on the live game surface.** (The only console noise is the
  S1-2 game-build 404 polling, pre-game.)

### Windowing defect — the Cast window covers the sidebar (also breaks a CI gate)

| ID | Sev | Finding | Evidence | Proposed direction |
|---|---|---|---|---|
| **S6-2** | **BLOCK** | **The Cast window's default slot overlaps the entire left sidebar and intercepts its clicks.** Opened via `_orwellCastEnsure()` at desktop 1440, `#orwell-cast` mounts at x=14, width 560 (spanning x=14–574) over the 240px sidebar (x=0–240). `document.elementFromPoint` at the sidebar's `#session-sort-btn` (x=205) returns the cast window's `.oc-ph` — so New Chat / Search / Diary Room / Cast / Chats / sort are all **covered and unclickable** while the Cast window is open. This is **why `frontend/scripts/browser_smoke.py` fails** (test H6 `page.click("#session-sort-btn")` times out — "subtree intercepts pointer events"). | `cast-overlap.png`; measured `castOverlapsSidebar:true`, `elementAtSortBtn:"oc-ph"`; `browser_smoke.py:969` timeout. | The cast window's default slot must clear the sidebar — anchor it to the right/content area (offset x ≥ sidebar width, like the retrospective/HUD), or open it centered in the content column. The slot system should account for the 240px sidebar so no top-left-slotted window lands under it. **Re-run `browser_smoke.py` to confirm green.** |

### Post-season — the Producer's Vault (0048) unseal

The deep retrospective works: "📼 The season, watched back" → "👑 Samir Grant won (week 14)" →
per-juror finale votes (attributed post-season per E12: "Nadia Okafor votes for Samir Grant",
"Eli Quintero votes for Axel Solis"…) → "🔒 The Producer's Vault" unsealing the hidden layer
(showmances, strategy talks, confessionals — "[confessional Axel Solis] I need Bridget Liu gone
… Luke Rasmussen is the one I actually trust"). All real roster; only post-season; Vault Wall
honored until the game ends.

| ID | Sev | Finding | Evidence | Proposed direction |
|---|---|---|---|---|
| **S6-3** | POLISH | **Raw internal pathway id leaks into player-facing retrospective copy.** A "surfacing" line reads: *"surfaced to Samir Grant via `overheard:offscreen:strategy:1358:7985649`"* — a raw provenance/pathway identifier (channel:kind:timestamps) shown verbatim to the player. | `producers-vault.png`. | Humanize the pathway in the retrospective renderer (e.g. "overheard off-screen") — map the structured provenance to prose; never print the raw `channel:kind:id` token. |

### WCAG 2.1 AA contrast (computed)

Body/panel text and **all 5 house themes pass AA with wide margins** (12–15:1). Two
sub-threshold cases on the brand red:

| ID | Sev | Finding | Evidence | Proposed direction |
|---|---|---|---|---|
| **S6-4** | POLISH | **Primary red button fails AA for normal text.** White (`#fff`) on the brand red (`#e06c75`) = **3.20:1** (AA needs 4.5; passes only as ≥18px/bold "large" text). Affects "Sign In", and likely "Confirm — this is binding" and "Make AI studio portraits". Accent-red-as-text (`#e06c75` on `#282c34`) = **4.38:1**, also just under 4.5 for normal text. Dark text on that red is 5.91:1. | computed contrast ratios. | Either darken the brand red a touch (toward ~4.5:1 on white) or use dark button text on red CTAs; reserve `#e06c75`-as-text for ≥large sizes. House themes need no change. |

### Settings (system / shortcuts) + theme picker
System and Shortcuts tabs render clean (no copy smells). The Theme picker is well-structured
(Themes / Customize tabs, a labeled swatch grid incl. the 5 house themes + workspace presets).
No defects.

---

## State 7 — Priority invariants: Vault Wall & cross-user isolation (runtime probes)

The two non-negotiable structural guarantees, verified at runtime on the live game. **Both hold
— no findings.** This is the most important result in the audit.

### Vault Wall (priority #1) — PASS
- **Player channel:** `getGameState`/`gameStatus`/`whereabouts`/`socialRead` expose only public
  persona (name, status, archetype, public background, appearance) and the player's **own**
  qualitative casting card (`strengths: {physical:"scrappy", mental:"standout"}` — tier words,
  no numbers). **No** trust/threat/affinity/soul/confessional/privateStrategy/numeric stats.
- **`seasonRetrospective` refuses while the season is live** → `{"result": null}`. The Vault
  unseal is post-season only; mid-game it returns nothing.
- **Admin / God Mode is walled from the Vault** (the mandate): `inspectNonVaultState` returns
  only `{week, phase, houseguests, config}` (no sentinels), and the admin channel **refuses**
  Vault-reading tools — `seasonRetrospective` on `/admin/call` → *"tool not available on channel
  admin/God Mode"*.
- **The GM moment prompt fed to the LLM is Vault-free DATA.** It contains the *vocabulary* of
  the rules ("never reveal hidden content", "the soul of the show", "reading a threat",
  "keeping it builds trust") but **zero numeric relationship/soul values and no confessional
  content** — confirmed by scanning for `trust|threat|affinity|suspicion: <number>` (NONE). The
  model genuinely "cannot leak what it never receives."

### Cross-user isolation (0021) — PASS
A fresh user (`auditor2`) gets a **separate, empty sandbox** ("no active game for this user");
its response contains **neither** the admin player ("Nadia") **nor** the admin roster ("London
Montoya"). No call for one user returns another user's game — secret or not.

### Diary Room OOC isolation (0002/0014) — PASS
A marked diary entry (`diaryRoom {entry}`) is recorded with `witnessSet: ['player']` and
`hidden:false`. It appears only in the **player's** own visible state/knowledge; `npcVoice` for
an NPC does **not** surface it. On the player channel, `getVisibleStateFor` is intentionally
**self-pinned** (`PlayerSurface.ts:43` → `getVisibleStateFor(this.player)`; `forEntity` is always
`"player"` regardless of any `id` passed) — the player channel cannot inspect an NPC's view, which
closes a leak vector by design. *(Minor NOTE: the tool silently ignores an `id` arg rather than
rejecting it — a harmless API-clarity nit, not a leak.)*

### Accessibility (keyboard / focus / ARIA)

| ID | Sev | Finding | Evidence | Proposed direction |
|---|---|---|---|---|
| **S7-1** | POLISH | **The Settings modal is not a focus trap and doesn't take focus on open** (WCAG 2.4.3 / dialog pattern). After opening Settings, Tab walks the **background page** — `#export-dl-btn`, the chat composer `#message`, `#model-picker-btn`, the gadget-rail buttons, the roster — for ~12 tabs before reaching the modal's own controls. A keyboard/SR user can interact with content behind the open dialog. | focus trail (16 tabs) — first 12 land outside `#settings-modal`. | On open, move focus to the modal's first control and trap Tab/Shift+Tab within it (`role="dialog" aria-modal="true"` + a focus-trap), restoring focus to the opener on close. Apply to the legacy modal family (the OrwellWindow kit already returns focus on close). |

**A11y positives:** all 21 visible buttons have an accessible name (text/aria-label/title); no
`<img>` missing `alt`; Settings closes on Escape. House-theme + body text all pass AA contrast
(State 6). The Customize theme tab (color pickers, harmony generator, font) renders cleanly.

### Error handling — engine offline (F5) — PASS
With the engine unreachable (`/api/orwell/health` → `engine:false`), the onboarding overlay
shows a polished, on-brand holding screen — **"The house is dark — Big Brother will return. The
game engine isn't reachable right now — this screen will clear the moment the feeds come back."**
with a "Continue anyway" dismiss (`onboarding-f5.png`). Graceful degradation; no defect.

---

## State 8 — Re-audit against synced `main` (round 4, 2026-06-20)

The branch was **synced with current `main`** (merged 235 commits; PR #320 updated). `main` had
advanced heavily since the audit's base (79a498c), incl. **0064 window/HUD layout sync**,
**premiere "meet every houseguest"**, **pacing "social runway between ceremonies"**, **admin LLM
I/O trace**, SQLite persistence, and a **redesigned onboarding** (a "Welcome to the house" modal +
a non-dismissable "Your Cast Photo" gating window; chat locked until a photo is secured). Engine
rebuilt + stack restarted on the synced code; the prior `findings` re-checked.

### Confirmed FIXED / improved by `main`
- **★ S3-CORE (the centerpiece launch-blocker) is FIXED.** Re-tested live at the first HOH comp on
  synced main: the merged premiere work feeds an **engine-truth gate** into the moment prompt
  (*"PREMIERE — MEET EVERYONE (engine truth): N of 16 met. The first HOH must NOT begin until this
  is complete."*) and the model now **respects the engine and defers to the pending decision
  instead of fabricating**. On declaring intent it said "everyone declares their intent… let's make
  it official" (no fabricated outcome); on confirming, it **resolved through the engine** — engine
  advanced to `veto-competition` with **HOH = Wendy Mueller** (a *real* roster member, npc:14) and
  real nominees (Zara Morrow, Melissa Abbott), **pending cleared, no desync**. The visible
  narration named the real HOH, invented **zero** houseguests, and carried **no machinery leak**.
  The old "fabricate Cassidy Holloway + desync" failure mode did not reproduce. *(One game, one
  comp — strong evidence; worth a broader playtest sweep to confirm consistency, but the structural
  guardrail is clearly in place.)*
- **Persistence across engine restart now works** — Season 4 (kept character "Nadia") survived a
  full engine restart on the same data dir (the merged SQLite store), where before it was
  in-memory only.
- The onboarding redesign adds a proper **cast-photo gating window** (kit `OrwellWindow`,
  non-dismissable, title-cased) and explicitly tests "the cast-photo window does not overlap the
  welcome brand mark" — addressing the *spirit* of **S1-1** (see re-check note below).

### Still PRESENT on synced `main` (re-confirmed)
| ID | Sev | Status | Evidence (synced main) |
|---|---|---|---|
| **S6-2** | **BLOCK** | **STILL PRESENT** — the 0064 layout sync **narrowed** the Cast window (x=14, **w=360** vs 560 before) but did **not** move it off the sidebar; it still mounts at x=14 over the 240px sidebar and `elementFromPoint` at `#session-sort-btn` returns `oc-portrait`. browser_smoke stopped flagging it only because the test now **parks** the window before the sidebar click — the open-window overlap remains. | `cast-overlap.png` (re-captured); `castOverlapsSidebar:true`. |
| **S6-1** | POLISH | **STILL PRESENT** — HUD roster header (now "The House · N/16") is 9.1–10.4px at ≤1024px (below the 11px floor). | `responsive_matrix.py` re-run: 34 pass / 9 FAIL. |

### New finding (from the merged onboarding redesign)
| ID | Sev | Finding | Evidence | Proposed direction |
|---|---|---|---|---|
| **S8-1** | POLISH | **The welcome modal's "Got it" button is below the touch-target floor** — 61×**32**px at coarse-pointer viewports (the contract floor is 36px height). New "Welcome to the house — premiere week" modal. | `responsive_matrix.py` re-run: `touch: 'Got it' 61x32` at tiny-320 / phone-390. | Bump the "Got it" button to ≥36px height (min-height) on coarse pointers. |

### Re-verified PASS on synced `main`
- **Vault Wall** holds after the `VaultStore`/`VisibleStateService`/`registry` changes: player
  `getGameState` has no sentinels; `seasonRetrospective` refuses while live; admin channel refuses
  Vault tools; GM prompt carries no numeric Vault data.
- **Engine-offline (F5) holding card** still mounts ("The house is dark") — browser_smoke's 3
  "engine-down holding card" failures in the standalone run are **false negatives** (timing/setup);
  the card works in a direct dead-engine boot.

### Gate caveat (regression-net hole)
`responsive_matrix.py` only catches **S6-1/S8-1 when a game is staged** (`ORWELL_MATRIX_ENGINE`
set). A chrome-only CI run (no engine) wouldn't render the HUD roster header or the welcome modal,
so these slip through — the gate has a hole for engine-staged surfaces. browser_smoke surfaced 4
failures in the standalone run (3 false-negative holding-card + 1 `G3` collapse-chevron on a
≤1-child `sessions-section`); the chevron one is worth a quick look but is low impact.

---

## State 9 — FE/BE sync & realtime streamed-text filtering (round 5, **fixes applied**)

This round shifts from DOC-ONLY to **finding & resolving**, building on **PR #408** ("persist
clean-channel reasoning + unify the resume renderer"), which I merged into this branch as the
foundation. #408 unified the reasoning *channel* (`thinking:true`) across the live / resume /
history renderers + persistence. Two complementary fixes were applied on top, plus a backlog of
lower-severity sync items.

### ✅ Fixed this round (code, tested)

| ID | Area | Fix | Files |
|---|---|---|---|
| **F1** | **Realtime content-channel flash** | The model also leaks planning as *normal reply text* (operator openers "Let me…", raw `npc:<id>` ids), scrubbed by `processWithThinking` (L6b) in the game build. Every streaming render path must use that *same* renderer per-delta or the leak flashes visible until the final render. The **live reply-after-thinking** path rendered raw `mdToHtml`; it now routes through `processWithThinking` like the no-thinking path and the final render. (Extends #408's render unification to the last inconsistent path.) | `frontend/static/js/chat.js` (liveReply renderer) |
| **F2** | **Decision-card dismiss vs `gamechanged` race** | The rearm reset the dismissal flag on *any* pending, so a game change (e.g. another device advancing) re-mounted the very card the player just dismissed. It now keys the dismissal to the pending's **signature** (`kind|option-ids|prompt`): a genuinely new decision re-arms; the same one stays dismissed. | `frontend/static/js/orwellDecision.js` |

**Verification:** new source-level tests (`frontend/tests/test_realtime_filter_and_decision_sync.py`)
+ #408's `test_reasoning_persistence_sync.py` pass; the render/chat/thinking/scrub/decision/stream
subset is **186 passed, 2 skipped, 0 regressions**. Live confirmation: a turn whose raw stream
carried a content-channel planning preamble ("The player is in the kitchen… Let me check…")
rendered a **clean** body (no preamble, no "Let me check", no raw `npc:` id) — the scrub runs in
realtime. `node --check` clean on both edited files.

**Methodology note (corrects a sub-agent mis-read):** the *primary* stream's content renderer
already routes per-delta through `processWithThinking` (chat.js:1355), so it scrubs in realtime —
the flash was specific to the **reply-after-thinking** sub-path (chat.js:1310, raw `mdToHtml`),
now fixed. The DSML/tool-call markup is halted server-side (`tool_parsing.py` /
`agent_loop.py`) — solid, no client risk.

### Backlog — sync findings NOT yet resolved (lower severity; documented for follow-up)

| ID | Sev | Finding | Direction |
|---|---|---|---|
| **F3** | POLISH | **Status projection omits `finished`/`winner`** (= the old S4-2): a status-only client hangs on "finale" post-season; FE recovers only via `/state`. | Add `finished`/`winner`/`post-season` to the `gameStatus` projection (Vault-safe post-season), and gate the status panel on `started && !finished`. |
| **F4** | POLISH | **SSE drop doesn't reconcile the pollers** — after a dropped stream / `run-started` from another device, the HUD lags up to the 20 s poll cadence. | On `run-started`/`run-done`, fire an immediate status/state re-fetch instead of waiting for the next poll. |
| **F5** | LOW | **Pending cache can survive a key-omitting engine response** (`orwell_engine.remember_pending`): only clears on a truthy `pending`; an older engine omitting the key leaves a stale card on reload. | Treat an omitted `pending` as cache-clear, or require the engine to always send `pending` (incl. `null`). |
| **F6** | LOW | **Stall watchdog can false-fire** during a legitimate 25 s+ tool call (60 s threshold vs the engine's 30 s read timeout). | Reset the watchdog on `tool_start`/`tool_end` events, not just deltas. |
| **F7** | LOW | **Forced-advance race** (`agent_loop.py`): the FE's last-resort `advanceGame` can double-advance if another device advances between the state read and the POST. | Re-read the beat immediately before the forced POST; skip if it already moved. |

**Verified clean (no race):** the **0064 Messenger turn-queue** serialization — concurrent game
turns chain via `prev_task` and never stomp; **optimistic UI** — the FE never renders a user
bubble before the server confirms (a failed send leaves the text in the composer).

