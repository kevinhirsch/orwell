# 2026-06-19 — E2E Smoke-Test & HCI Audit (pre-launch)

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

---

## Summary & triage (launch is next week)

**The headline:** the **engine and every engine-backed surface are excellent** — casting, the
gadget-rail HUD, the structured decision card, secret-ballot reveal, finale, the retrospective
Vault-unseal, and the whole multi-season restart machinery are correct, Vault-safe, and
well-designed. The narration quality (voices, social texture, real-name grounding on
introductions) is genuinely strong. **The single critical defect is the narration→engine
handoff**: when the model should *commit a decision the engine owns*, it instead improvises the
outcome (and sometimes a houseguest), bypassing the engine and desyncing the game.

### [Launch-Blocking]
- **S3-CORE** — model bypasses the engine on decision resolution; invents outcomes and
  houseguests; narration/engine desync compounds across turns. *(The core-loop bug; fix via the
  pending-decision interlock + roster validation + outcome guard.)*
- **S4-1** — the structured decision card is only reachable through the chat agent; the status
  HUD offers no fallback, so when S3-CORE fires the player is **stuck** with a pending decision
  and no control. *(The structural escape hatch that de-fangs S3-CORE.)*
- **S1-1** — the very first screen (zero-data landing) overlaps the casting card on top of the
  welcome message — unreadable text-over-text for every first-time user.

### [High-Priority Polish]
- **S2-1 / S5-1** — model under-finalizes casting; add a structural "Enter the house" when ready.
- **S4-2** — `status`/`finaleView` projections go stale at season end (no `finished`/`winner`).
- **S1-2** — game-build console 404 spam (`avatar`, `tts/stats`, `stt/stats`).
- **S1-3 / S4-3** — raw unstyled `<input type=file>` across casting / account / new-season.
- **S1-4** — login password field shows a clear glyph while empty.
- **S3-1** — HUD "16/16" count vs the visible 15-NPC list ambiguity.

### What to protect (do not regress)
The casting interview, the gadget-rail HUD + presence, the decision-card copy ("your selection
only — never read from prose"), the secret-ballot reveal, the retrospective Vault-unseal, and
the multi-season restart/replayability. These are the product's strengths.

