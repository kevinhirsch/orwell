# ORWELL — FINAL PRE-SHIP AUDIT (v2, exhaustive) · RANKED MASTER

**Scope:** 33 specialist lanes + a live 2-window red-team + two real-model playthroughs +
key-free telemetry across every surface × state × {desktop, mobile}. ~900 findings. The exact
count + full normalized appendix + dedup clusters are in `MASTER_APPENDIX.md`; every finding's
detail is in `scratchpad/audit2/<lane>.md`. This file is the ranked judgment layer.

Ranked against the ship-gate rubric (breaks the real-model golden path / a core invariant =
blocker) and the vision brief (I1–I10, C1–C6).

---

## THE TWO THESES (everything rolls up to these)

**THESIS 1 — Orwell is more finished than it plays. The engine computes it; the player can't
feel it.** The single most-corroborated result in the audit (5+ lanes): a large tranche of
*built, tested* product is **switched off or never delivered to the player**. The living-house
features ship dark (installer sets only `ORWELL_CAMPAIGNS`), the hidden 259-event layer reaches
the player only at a truncated post-season unseal, the marquee social verbs (confide / ally /
expose / trade-secret) have no on-ramp and — worse — the **player literally cannot play offense**
(can't move a third-party edge, can't form alliances), the Diary Room producer-invite is dead
code, and the docs *mislabel what's built* so nobody knows to turn it on. **The highest-value
work is activation and delivery, not building.** (Nuance, live-proven: delivery isn't *uniformly*
dead — the deep playthrough traced a real overhear→player pathway and live NPC-NPC gossip. It's
*unreliable*, which is a cheaper fix than "unbuilt.")

**THESIS 2 — The game is a workspace wearing a costume, and the costume leaks everywhere.** The
second-most-corroborated theme (12+ instances, 4 live Blockers): the vendored chat-workspace
bleeds through the fiction constantly — a tool-manifest the model will recite on request, "New
Chat / Search / model pill / msg counter" chrome, raw `[Error]`/`/help`/"Reached the N-step
limit" strings typewritten *as the narrator*, the reasoning accordion unscrubbed, a live "Run
code" button, the GM prompt itself instructing the model to name "the Vault / God Mode." **The
Vault Wall (secret STATE) held against a full live red-team — zero secret content ever crossed.**
Every leak is machinery *naming*, not secret-state exposure — a different, cheaper fix class than
an I1 breach.

**Two structural multipliers behind both:**
- **`AUTH_ENABLED=false` silently disables ~half the grounding + sync + security subsystems** —
  beatSeq CAS, stateDelta, time-of-day, token ledger, two-tab suppressor, faithfulness corrector,
  AND several security gates. This is the *local* posture, so it colors every local playtest.
- **Every CI gate stubs the LLM**, so the entire model↔engine seam — where ALL the blockers live —
  ships green and unverified. Feature 0108 (real-model golden-path gate) is the systemic cure.

---

## A. SHIP-BLOCKERS (must fix in 14 days — breaks a core invariant or the golden path)

**A0 — THE MODEL-LEVEL KNOWLEDGE WALL DOES NOT EXIST (new #1, two live playthroughs).** J2-1 /
CAST-1 / DEEP-22. NPCs are omniscient of the entire chat: in both real seasons an NPC recited the
player's *private bedroom secret* and — worse — the player's **Diary Room** plan verbatim, with the
Vault proving **zero pathway existed**. The Diary Room has NO in-game pathway to any NPC (mandate);
this is a structural I3/Vault-adjacent breach. **The social-deduction game — the entire point — is
impossible while this holds:** nothing you tell anyone is private, so scheming, secrets, and
information-asymmetry irony all collapse. Fix: the narrator must receive a per-NPC *knowledge
manifest* (only what that NPC witnessed or was told) and be structurally barred from voicing the
player's DR/private content; add a post-hoc scan that rejects an NPC referencing an un-pathwayed
fact. This is the highest-value single fix in the audit — it's what makes the game a *game*.

**A1 — Cast-authoring RENAMES the cast mid-premiere (the phantom-houseguest root).** DEEP-1/J-1/
BB-1. The async cast-authoring write-back races the premiere: the player meets a name, then the
NPC is silently renamed minutes later; the GM then "corrects" the player about the game's own
prior words. Not a hallucination — an **engine concurrency bug**. Fix: never author *public*
names; finish authoring in prewarm before the first intro (season-start serialize/reconcile).

**A2 — The model FABRICATES closed-set outcomes wholesale — even when the engine is UP.** DEEP-2 +
J2-2/J2-3 (escalated). Not just on an engine blip: in the 2nd playthrough the model told the player
they **won HOH three times** with zero tool calls (engine truth: dropped mid-comp, an NPC won), plus
a phantom eviction, an invented competition, and an `ask_user`-faked nomination ceremony. And the
**pre-emission outcome guard is ineffective** (J2-3): it excises only the winner *sentence* and ships
the surrounding phantom scene — it deletes the one falsifiable tell and keeps the lie. Separately, on
an engine blip the FE fails *open* and narrates a fake eviction with no alert. Anti-sycophancy (I2)
is not actually enforced at the seam. Fix: (a) a hard circuit-breaker halting the turn in-persona when
a required engine call fails or wasn't made; (b) make the guard reject the whole phantom scene, not
one sentence; (c) forbid narrating any board change without the corresponding committed lever result.

**A3 — Two-window desync + duplicate LLM responses (F1–F5, the #1 ship bar) — LIVE-REPORTED.**
CON-1/2/4/5, integration-#1, PERSIST-9. beatSeq CAS inert under auth-off; no idempotencyKey on
advance/submit/decision; per-user desync baseline clobbered by concurrent windows. *(Focused fix
agent dispatched.)*

**A4 — Reasoning (raw chain-of-thought) leaks into the player bubble on an empty body.** NARR-1/4,
PROMPT2-6, INT-3. The empty-body fallback is deepseek-shaped; on GLM (true CoT channel) it
re-emits raw thinking as the visible reply, past both scrub and outcome guard. Plus the thinking
accordion is architecturally unscrubbed. Fix: never route the reasoning channel to the body;
scrub the accordion; repair the empty-body fallback for GLM.

**A5 — Tool-manifest recitation + the prompt authoring machinery leaks.** ADV2-1/2/3. "List your
tools" → full manifest incl. workspace tools, 3× zero-refusal; and `momentPrompts.ts:205-215`
*instructs* the model to name "the Vault/God Mode." Fix: remove the workspace tools from the
game-build narrator toolset; delete the machinery-naming instruction; add Vault/God-Mode/admin to
both scrubs.

**A6 — Session-detach + fabricated-eviction's sibling: the ungated "new chat" hazard.** FE2-1/
INT-1. The logo, "New Chat," rail "+", and empty-composer Send all silently detach the player
from their live season with no recovery. Fix: gate/guard all session-switch entry points under
the game build; confirm before abandoning a live game.

**A7 — Secret-ballot attribution leaks.** SG-3, DEEP-7, BB-12. Eviction narration + deal-break
reveals mint per-voter "X broke a vote deal with you" events, de-anonymizing the E12 sealed
ballot before the retrospective. Fix: wire the `witnessed` hook so ballot attribution stays
Vault-sealed until 0048.

**A8 — Mobile is broken (one root).** RESP-1/2, VM-1/2, orwellWindow.js `max-width:64vw` with no
mobile override → every kit window renders as a clipped ~250px sliver top-left; the **theme
picker is unusable on a phone** (zero swatches). Fix: route kit windows → OrwellSheet under the
mobile breakpoint (the sheet CSS exists, orphaned on legacy nodes).

**A9 — The `max_tokens` truncation seed (6× corroborated).** settings.py:196-199 seeds
narration=4096/casting=2048, overriding token_policy's model-aware `None`; GLM counts reasoning
against the cap → empty body / mid-sentence casting truncation. Fix: drop the seed / reasoning-off
for casting. *(Cheapest high-impact fix in the audit — <1hr.)*

**A10 — Security cluster (before public exposure, ADR 0007).** SEC-1..8: unauthenticated
`/api/auth/setup` admin-race, gateway webhook impersonation, tool_security fail-open →
unauthenticated bash/python, `debug-bundle?vault=1` = zero-auth Vault spoiler dump under auth-off,
admin/player token collapse. Most hinge on auth-off/unconfigured posture (the official installer
closes several) but the fail-open patterns are real. Fix: gate each before the public flip; the
public-deploy validator must check bind-host + token separation + gateway secret.

> **The dark-features activation (THESIS 1) is not a "blocker" but is the single highest-value
> ship action:** turn on the 5 built behavioral-fidelity flags (with a calibration re-check —
> note they've *never* been heavy-sim'd even in the shipped `CAMPAIGNS=1` config), fix the
> `storyFacts` delivery seam so surfaced facts reach the narrator per turn (SOC-1/4 — also kills
> the hallucination root), and give them an admin dial. This is what makes the house feel alive.

---

## B. HIGHEST-VALUE QUICK WINS (ranked by value-per-hour; most are <1hr)

1. **A9 max_tokens seed** — <1hr, 6× corroborated, unblocks casting richness + narration.
2. **Flip the dark-feature flags** (installer `.env` + admin dial) — <1hr + a calibration run;
   the biggest felt-quality jump available (THESIS 1).
3. **`storyFacts` per-turn delivery** (SOC-1/4) — feed grounded surfaced facts to the narrator;
   simultaneously makes the house feel alive AND removes the hallucination incentive.
4. **Confessional variety one-liner** (BB-2/SG-8, orchestrator.ts:690 passes no rng/voice/nameOf →
   41/41 identical templates + literal "player" token) — <1hr, saves the retrospective payoff.
5. **Un-truncate the retrospective** (slice(-40) → full; render `juryVotes`) — the season's #1
   payoff, currently dropping ~600 of ~650 rows.
6. **Strip workspace machinery** — remove `update_plan`/workspace tools from the game narrator;
   gate the model pill / msg counter / New-Chat-Search nav / "Run code" button / raw-error &
   step-limit toasts under `ORWELL_GAME_BUILD`; scrub the reasoning accordion. (A cluster of ~12
   small gated-string fixes, each <1hr, that collectively close THESIS 2.)
7. **Mobile window kit → OrwellSheet** (A8) — one CSS/kit fix clears most mobile majors.
8. **Fix `set_theme` lever** — validate against the real 5 house themes + glass (not 6 fictional
   presets that always 400) so the model can invoke the flagship 0052 identity themes.
9. **`clamp01` NaN guard** (PERSIST-2/BE-101) — one-line systemic fix stopping NaN writes into the
   permanent relationship layer.
10. **Decision-card idempotency + beatSeq** (part of A3) — stops duplicate responses + double-apply.
11. **Engine-down / error copy in-persona** (FLOW-1/CA/microcopy) — replace the raw `/help`
    chatbot fallback rendered as the narrator with a diegetic "the feeds cut away" line.
12. **Deals gadget "A houseguest" fallback** (4× hit) — the one social-memory aid is unreadable.
13. **Ceremony one-beat-per-turn guard** (J-3 cluster, 3 roots: forced-tool_choice binding-blind,
    engine self-advance past nominations, runway regex false-positives) — restores the social
    runway + the set-pieces.
14. **Stale premiere welcome card dismissal** (4× hit) — expire on gate-complete.
15. **`ORWELL_BIND_HOST` in the public-deploy validator** (deploy Blocker) — one check closes the
    plaintext-reachable-when-public hole.

*(The appendix carries the full ranked ~900. The clusters above each represent multiple lane
findings that collapse to one fix.)*

## C. EVERYTHING ELSE — by layer (exhaustive detail in the lane files)
- **Narration/prompt seam** (`prompt-deep`, `prompt-eng2`, `narration`, `narration-fidelity`): the
  420-line GM prompt re-sent every turn (ADR-0003 inversion, ~33k input tok/round), voice
  homogenization (npcVoice under-called, no fingerprint in roster), casting opens on a config
  button, ask_user specified 3 contradictory ways, sycophancy channel in "pacing IS engagement,"
  49 belts inventoried with misfire modes.
- **Social/BB spirit** (`social-game`, `bb-nerd`, `product-spirit`, `product-gaps`, `endgame`,
  `comp-variety`): player-can't-play-offense, gossip can't actually distort, NPCs never throw,
  no 3-part final HOH, no HOH-room reveal, ceremonies missing ritual language, shallow comp
  library, dead ambient house-event pool, no winner moment, evicted-player dead tail, dead
  reserve twists.
- **Engine/persistence** (`backend-deep`, `be-deep2`, `persistence`, `consistency`): NaN/dim-mismatch
  corruption, non-degradation checkpoint doesn't cover the 15 newest dims, fake-embedding pin race,
  SQLite vector index never persisted, jury-tilt side channel, outcome-guard short-circuit.
- **FE/UX/visual** (`frontend-deep`, `fe-deep2`, `ux-*`, `responsive`, `transient-animation`,
  `ux-visual-motion`, `performance`): z-index/spacing tokens bypassed, unbounded history + poll
  storm + 3.2MB bundle, contrast failures (measured), ceremonies hard-pop, card-stacking, IA
  workspace bleed, keyboard/AT gaps.
- **Ops/docs/tests** (`deploy-ops`, `doc-drift`, `test-gaps`, `settings-admin`, `security`): the
  activation plan, 6 mislabeled features, the stubbed-LLM blind-spot map, no admin dials, the
  security cluster, ADR-0006 restart bug, no backups/rotation.

## D. POST-LAUNCH (real, but shouldn't gate a 14-day ship)
The 420-line prompt refactor (risky to touch pre-ship; do with its own live-verify), the perf
architecture pass (eventsSince on hot paths, delta persistence, bundle-split — real but not
player-blocking short of a very long session), comp-library expansion + new BB formats, the
evicted-player jury-house play, cross-season stats/history, the full R1–R7 refactor roadmap, and
0108 as the permanent gate (do right after the A-tier belts land — it's what keeps this fixed).

## Coverage honesty
Two live seasons both froze at ~week 2 (one on the engine-unreachable blocker A2), so I5 memory
accumulation across a real week boundary and the endgame/finale/jury were audited from source +
the unsealed vault, not played to completion. Reduced-motion telemetry captured but not yet
lens-audited. The security lane didn't exhaustively cover every admin route. These are the known
edges; none change the ranking.
