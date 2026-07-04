# ORWELL — FINAL PRE-SHIP AUDIT · MERGED & RANKED (Phase 2)

7 agents · 41 raw findings · 0 fabricated. Ranked against the ship-gate rubric + the vision
brief. **Headline: the engine, FE client, integration, and adversarial surfaces are
blocker-free; 100% of the launch-threatening findings live in the model↔engine NARRATION SEAM
— exactly where the brief and the ship-gate predicted (every CI gate stubs the LLM). And the
two most damaging are <1hr fixes.**

Corroboration (independent agents → promoted): J-3 (live montage) ≡ PROMPT-1 (static: forced
tool_choice collapses the runway). J-11 (live casting truncation) ⊂ PROMPT-2 (static+probe:
budget seed truncates on GLM-4.7). BE-1 ≡ J-13 (roster staleness). BE-2 ≡ I-MAJOR-1/2 (silent
write-back swallow). Adversarial + backend independently PASS I1/I2/I4/I5/I10.

---

## A. SHIP-BLOCKERS (fix in 14 days no matter what)

Applying the rubric strictly (breaks a core invariant / makes the golden path unplayable or
un-Orwell on the real model). Note two are also the cheapest fixes in the whole audit.

### A1 — [J-2, Blocker, <1day] Marquee social action returns an empty non-narration
Core-loop failure. Player pulls the new HOH aside to plant a seed; GLM-4.7 burns 77s / ~9,800
tokens wandering rooms + analysis-paralysis ("is the hallway private?"), records the hidden
fold, and **ends the turn with only "The moment hangs for a beat… what do you want to do?"**
The game's one instrument (conversation) failed on its most important actor. Intermittent /
model-dependent, but triggered on a completely natural action.
- **Fix:** cap pre-narration tool exploration (1 `moveTo`/`whereabouts` + 1 `npcVoice`, then
  narrate); when the loop terminates on the step budget, the fallback MUST emit the narrated
  scene, never the bare prompt. Shares a root with A2. Where: `agent_loop.py` loop-termination.

### A2 — [J-4, Major→Blocker-tier, <1hr] `update_plan` workspace tool renders a game-objective TODO dashboard to the player
The narrator called `update_plan` with a literal checklist ("- [ ] First eviction vote / -
[ ] Power of Veto competition") that renders a live **docked plan window** — a spoiler
walkthrough of future game structure. Violates I9 (machinery invisible) + ADR 0003 ("don't
improve the game into a dashboard") **on the visible surface**, and its token cost contributed
to A1. Elevated to blocker tier: a core-invariant violation the player sees, and the single
highest value-per-hour fix in the audit.
- **Fix:** remove `update_plan` (+ any workspace agent/plan tools) from the game-build narrator
  toolset; suppress the docked plan window under `ORWELL_GAME_BUILD`. Where: `agent_loop.py:409`,
  `chat.js:2923`, `orwellToolBeats.js:59`.

### A3 — [J-1, Major→Blocker-tier, <1day] Premiere invents a phantom houseguest, then gaslights the player
On the highest-stakes "15 strangers become distinct people" beat (first 5 min), the opening
narration described **"Audrey Duran"** — not in the 16-cast — because the model narrated a
who-is-present scene BEFORE calling `whereabouts`/`premiereIntros`. When the player acted on
it, the game replied *"there's no Audrey… you might be mixing up names"* — blaming the player
for the game's own hallucination. Violates I2 (no invented content) + I6 (people make sense);
the mandate names this exact failure ("a name you make up is an instant, immersion-shattering
contradiction"). Guardrail is prompt-wording only — the thing the mandate says never to rely on.
- **Fix:** a hard belt that forces `whereabouts`/`premiereIntros` and injects the real
  present-set BEFORE the first premiere room narration may stream. Where: premiere seam;
  `momentPrompts.ts:304-309,618`.

### A4 — [J-3 ≡ PROMPT-1, Major×2 corroborated → Blocker-tier, <1hr] Forced `tool_choice` collapses the social runway; every ceremony montages
Two agents, one root. PROMPT-1 (static): during a spectator ceremony hold, `_hold_for_social`
sets `moment→social` but leaves `phase=nominations`, so ADR 0016's default-on forced-
`tool_choice` gate reads the phase and forces `advanceGame` — **re-opening the exact force-march
#1127 fixed.** J-3 (live): confirmed — HOH-crown→full-noms in one turn, veto fully resolved in
one, eviction→tally→goodbye→Week-2→next-comp in one/two; **zero social runway**, no ceremony as
an isolated set-piece, and the designed staged anonymized ballot reveal (E12) was skipped. This
guts what the owner calls the heart of the game ("the social play is the best part / lingering
IS play"). Reaches all beats, so not "unplayable" — but un-Orwell, and the fix is trivial.
- **Fix (two parts):** (1) PROMPT-1 <1hr — the force gate must respect the `social` hold (check
  the held moment, not raw `phase`), so a spectator/social window can't force `advanceGame`.
  (2) J-3 — disallow multiple `advanceGame` across a ceremony boundary in one turn; one
  set-piece per turn with a runway beat between; ensure the staged ballot reveal renders.
  Where: `agent_loop.py:4180-4229` + `chat_helpers._hold_for_social`; advance-chaining belts.

> **Verify-then-promote (config check, <1hr):** confirm the **narration-faithfulness default is
> `shadow`, not `adopt`, at ship** — active `adopt` writes `recordInteraction` on the model's
> behalf, an I2 risk (flagged by PROMPT-AI cross-territory). If it ships `adopt`, that's a
> ship-blocker; if `shadow`, close it.

---

## B. HIGHEST-VALUE QUICK WINS (high severity ÷ low effort — the list to work first)

Ranked by value-per-hour. Note A2 and A4-part-1 above are ALSO <1hr — do them first of all.

1. **[PROMPT-2, Major, <1hr]** `max_tokens_budget` seed re-introduces the reasoning-truncation
   vector (SOUL lesson 18, **live-probed on GLM-4.7**). `settings.py:196-205` seeds
   narration=4096/casting=2048, overriding `token_policy`'s deliberate model-aware `None`;
   reasoning counts against the cap → empty body / `finish=length` (casting burns ~894 reasoning
   tokens before any body). This is J-11's live mid-sentence intro truncation and threatens G4
   (rich cast). And `CASTING_REGISTER_NOTE` papers a **structural** truncation with prompt
   **wording** (I9). **Fix:** drop the settings.py seed (honor token_policy's model-aware default)
   AND/OR set reasoning OFF for `background-authoring`/casting (structured extraction, not a
   reasoning task).
2. **[J-9, Minor→Major-value, <1day]** Binding `eviction-vote` pending not rendered as a decision
   card — the model narrated "now it's your turn" but emitted no vote card; player had to free-text
   "I vote to evict Maeve." A first-timer can stall at the week's climax. **Fix:** render binding
   pendings (eviction-vote, goodbye-message…) as a card from engine pending state regardless of
   whether the model calls `ask_user`. (Structural belt — kills a class, not one instance.)
3. **[J-8, Minor, <1hr]** Workspace machinery visible in-fiction: **"z glm-4.7" model pill**, "·
   NN msgs" counter, "New Chat/Search/Chats" nav. Direct I9 bleed. **Fix:** hide all three under
   `ORWELL_GAME_BUILD`.
4. **[a11y-perf A11YPERF-1..5, Major(adjudicated Minor), <1hr total]** 5 uncleaned `setInterval`s
   (gadget rail, chat-gate, cast, headshot, modalManager — worst: modalManager rescans every 1s
   forever). *Adjudication: these are wasted-cycle timers, not the unbounded memory/DOM growth the
   agent's I5 cite implies (DOM is clean) — so Minor, not Major. But one fix (assign to a module
   var; `clearInterval` on modal/session close) clears all five.* **Fix:** clear on teardown.
5. **[J-6, Minor, <1hr]** Stale "Welcome / Meet the house →" onboarding card persists after 16/16
   met (both desktop + mobile), stacking with the live comp card → click ambiguity. **Fix:**
   expire it when the meet-everyone gate completes.
6. **[J-7, Minor, <1hr]** Non-binding comp-round card shows compete/throw/play-safe buttons while
   its own body says "your approach is already locked." Misleads the player into re-declaring.
   **Fix:** when `binding=false`, render color + a single "continue" only.
7. **[J-5, Minor, <1hr]** Multi-beat turns concatenate with broken markdown ("…send Maeve
   home.The voting has finished.", dangling `**`) + a "Ready to keep pushing?" false-prompt the
   narration answers itself. **Fix:** join round texts with a paragraph break; self-close each
   beat's markdown; suppress a rhetorical "ready?" when the same turn resolves the beat.
8. **[I-MAJOR-1, Major(adjudicated latent), <1hr]** Write-backs (`recordCastProfile`/
   `recordWorldSnapshot`/`preSeedCast`) omit `beatSeq` in their HTTP response → a transient 409
   retries with a stale token → silent loop → lost cast-authoring. *Adjudication: latent, NOT
   currently biting — the live journey got a rich 16-cast — so a hardening quick-win, not a
   blocker.* **Fix:** echo `beatSeq` on every write-back response; have the caller attach it on retry.
9. **[BE-2 ≡ I-MAJOR-2, Minor, <1hr]** FE best-effort write-back callers swallow exceptions with
   no debug log → failures invisible to live-verify (and `recordWorldSnapshot` has no checked
   response schema). **Fix:** log a Vault-free warning with the tool + reason on every swallow.
10. **[J-12, Minor, <1hr]** "11 of 15 met" counter + "the comp can't begin until you've met
    everyone" reads like a quest tracker (machinery tell, mild force-march vs "lingering is play").
    **Fix:** make it diegetic ("a few faces you still haven't crossed"); don't frame the comp as
    blocked-until-complete.

---

## C. EVERYTHING ELSE (exhaustive, grouped by layer, scored)

### Narration / AI seam
- **[PROMPT-3, Minor, <1hr]** First-name matching in 3 belts mis-marks premiere intros and can
  DROP a legitimate active houseguest who shares an evicted one's first name (suppression, I2/I9).
  Fix: match on id, not first name; confirm cast first-name uniqueness in CharacterFactory.
- **[PROMPT-4, Minor, <1hr]** E22 fallback force-records OOC `((…))` HUD asides as in-game scenes
  → an aside with no NPC pathway lands in the event store (I3/I4). Fix: exclude `((…))` from the
  auto-record path.
- **[PROMPT-5, Minor, <1hr]** 2-turn runway hold ignores off-vocabulary readiness signals (misses
  `_RUNWAY_READY_RE`) → holds the player against the prompt + their wish (C4). Fix: broaden the
  readiness match / honor an explicit "let's go."
- **[J-10, Minor, <1hr]** Model fabricates `runCompetition` participantIds (incl. the player);
  harmless (engine ignores caller participants + uses the locked field) but shows roster desync.
  Fix: have the veto moment prompt read `veto.players` before narrating who competes.
- **[J-11, Polish, <1hr]** Casting loops one question 3×; 5-intro turn truncates mid-sentence
  (root = PROMPT-2). Fix: accept a "ready" signal after 1–2 probes; cap voiced-intros-per-turn.
- **[PROMPT-6, Polish, <1day]** Stacked grounding directives dilute the frame + fight ADR 0003
  ("prefer removing context"). Fix: consolidate/trim `apply_game_framing`.

### FE / transient
- **[J-13 ≡ BE-1, Minor, <1hr]** `/api/orwell/roster` intermittently returns empty (mid-mutation
  read); `_LAST_ROSTER`/`_last_good_roster` not invalidated on eviction/season-end. Cast/HUD flash
  risk. Fix: cover the HUD path with the last-good fallback on every path; invalidate on game-over.
- **[FE-1, Minor, <1hr]** Duplicate `isNarrow()` in orwellGadgetRail.js:238 & orwellCastPin.js:33
  (drift vs platform.js canonical). Fix: import the canonical.
- **[A11YPERF-6, Minor, <1day]** Focus-ring contrast over bright glass. *Conflict to resolve: agent
  says the ring is "red"; ELEMENT_KIT pins it to system-blue `#0a84ff`. Likely the agent saw the
  `aria-invalid` red ring, not the focus ring.* Fix: verify the focus ring is the blue token; if a
  contrast gap exists over bright glass, add the scrim/backstop.
- **[FE-2 / J-* Polish]** Dead `addCopyBtn_unused()` in codeRunner.js:93; A11YPERF-7 (6px drag
  handle tap target); A11YPERF-8 (post-modal listener accumulation). Fix: remove/patch.

### Engine / backend / boundary
- **[ADV-2, Polish, <1hr]** `producerVault` skips the FE "unseal" confirmation if hit directly over
  HTTP (admin-only, NOT a Vault leak — intent alignment). Fix: require the unseal token server-side.
- **[ADV-4, Polish, <1hr]** Consequence shape-guard accepts empty `edges:[]` and silently no-ops
  (audit E31). Fix: 400 at the HTTP boundary.
- **[ADV-1, Minor, <1hr]** Presence witness-zone scoping logs-but-doesn't-throw with no
  zoneProvider (byte-identical/safe, but silent). Fix: surface a wired-wrong signal.
- **[BE-3, Polish, <1day]** Health metrics don't bound tool-name length. Fix: clamp.

---

## D. POST-LAUNCH (real, but honestly shouldn't/can't gate a 14-day ship)

- **[ADV-3, Minor]** Pre-game off-screen tick timing edge case (pool counting before `started`
  hydrates) — needs a repro rig; turn-driven default makes it rare.
- **PROMPT-6 / grounding-directive consolidation** — a prompt-hygiene refactor, safer as a
  fast-follow with its own live-verify (touching `apply_game_framing` pre-ship is risky).
- **A11YPERF perf polish** beyond the interval-clear quick win (listener hygiene, drag-handle
  target) — real, not player-blocking.
- **The recurring root, not a single bug — file as the strategic item:** every launch-threatening
  finding here is a GLM-4.7 narration-seam behavior that a stubbed CI gate cannot see. **Feature
  0108 (real-model golden-path gate) is the actual fix** — it converts this 7-agent manual pass
  into a repeatable gate so we stop re-discovering this class by hand. Prioritize it right after
  the A-tier belts land.

---

## Coverage honesty (what this audit did NOT exhaustively cover)
- **Live real-model prompt-INJECTION against the Vault Wall** was not exhaustively run
  (adversarial went static; journey saw no leak in normal play). The Wall is structurally sound
  (backend+adversarial+prompt-ai all PASS I1), but a dedicated injection pass is a worthwhile
  pre-ship follow-up.
- **Multi-window F1–F5 under the real model** was audited structurally (integration) + the
  ship-gate's prior two-window audit; not re-driven live this pass.
- Only ONE live season was played (one seed, one cast). J-1/J-2 are model-behavior-dependent and
  may vary by seed/turn — the fixes are robustness belts, which is the right response to intermittence.
