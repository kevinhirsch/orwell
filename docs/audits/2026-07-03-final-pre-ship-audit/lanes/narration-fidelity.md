# NARR — Narration Grounding / Faithfulness (exhaustive pre-ship audit v2)

**Lens:** narration over a deterministic engine as a grounding/faithfulness problem (GLM-4.7,
reasoning=low, via OpenRouter — ADR 0016). Evidence base: the live real-model season transcript
(journey run, session `8fd2bc9d`, 2026-07-03 00:39–01:03; extracted to `audit2/journey-raw.txt`),
`journey-debug-bundle.json` (engine truth + FE log tail + recentErrors), the engine save snapshots
(`audit/journey-engine-data/64656661756c74/v000200.json`), the prompt pipeline
(`src/engine/momentPrompts.ts`), the FE guard/scrub/degradation pipeline
(`frontend/routes/chat_helpers.py`, `frontend/src/agent_loop.py`, `frontend/src/llm_core.py`,
`frontend/src/token_policy.py`, `frontend/src/settings.py`, `frontend/src/context_budget.py`,
`frontend/static/js/chat.js` error paths), and 2 live OpenRouter probes (model + per-endpoint caps;
key never printed). Dedupe honored: phantom-houseguest (J-1), empty-narration (J-2), montage (J-3),
casting truncation (J-11) are NOT re-reported — findings below are new mechanisms, new vectors, or
root-cause refinements the v1 pass did not have.

**Measured context facts (for several findings below):**
- `BASE_GAME_MASTER_PROMPT` = 38,482 chars ≈ **9.6k tokens** (~90 imperative rules). Moment
  fragments: premiere ≈1.5k tok, eviction ≈0.8k, veto-comp ≈0.4k. Live roster block ≈16.5k chars
  ≈ **4.1–5k tokens** (16 HGs × facets). Full live system stack ≈ **15–17k tokens** before
  barriers/directives; ~33–34 tool schemas on the wire.
- Live telemetry (the J-2 turn): **input_tokens 402,805 over 12 rounds ≈ 33.6k tokens/round**,
  output 9,861 tok, 77s, `round_texts` = `''`×12.
- OpenRouter live probe: `z-ai/glm-4.7` is served by **9 sub-providers** (DeepInfra, StreamLake,
  AtlasCloud, Novita, Venice, Z.AI, Google, Phala, Cerebras) with heterogeneous ctx (131k–204,800)
  and max output (**16,384 on Venice**, 40,960 on Cerebras, 131k+ elsewhere).
- Live-run guard telemetry (`logs.recentErrors`): **6× "pre-emission guard HELD a phantom
  closed-set outcome"**, 1× wrong-nominee hold, **2× beat-signature desync** — in ONE
  casting→week-2 run.

## Index

| id | sev | effort | value | title | where |
|---|---|---|---|---|---|
| NARR-1 | Major | <1hr | High | Seeded `max_tokens_budget.narration=4096` re-introduces the exact reasoning-truncation vector token_policy warns about | settings.py:196-199 vs token_policy.py:56-66 |
| NARR-2 | Major | <1hr | High | Casting cap 2048 at reasoning=medium truncates the longest casting turn (the premiere-reveal handoff) | settings.py:199, token_policy.py:59 |
| NARR-3 | Major | <1hr | High | ADR 0016 "pin the provider + assert reasoning suppressed" is NOT enforced — 9 heterogeneous sub-providers, no pin, no assert | settings.py:230, llm_core.py; OpenRouter probe |
| NARR-4 | Major | <1hr | High | FEPY-2 empty-body recovery re-emits RAW REASONING into the player bubble, unscrubbed and unguarded, in game mode | agent_loop.py:3490-3494 + 6337-6341 |
| NARR-5 | Major | <1hr | High | Mid-stream provider errors (429/timeout) render raw `[Error: …]` in the GM bubble — no game-build gating on the `json.error` path | agent_loop.py:4478 → chat.js:3058-3066 |
| NARR-6 | Major | <1day | High | Forced `tool_choice:advanceGame` at eviction structurally produces prose-less rounds → the E12 staged ballot reveal collapses to a one-shot summary | agent_loop.py:4180-4229; live log tail |
| NARR-7 | Major | <1day | High | Belt-key mismatch class: writers key `user or "default"`, readers key `owner or ""` — F14 eviction-drain + ADR 0011 peer-advance dead in the no-auth posture | chat_helpers.py:2316 vs agent_loop.py:4785,4916 |
| NARR-8 | Major | <1hr | High | The 0065 E2 stateDelta "Since your last turn" feed is DEAD single-tenant (`user is None` ⇒ None) | chat_helpers.py:1963-1968 |
| NARR-9 | Major | <1day | High | Time-of-day/sleep economy dormant out-of-box in the no-auth posture: engine default OFF, deploy never sets env, FE apply requires `user` | GameSessionAdapter.ts:4844, chat_helpers.py:72 |
| NARR-10 | Minor | <1hr | Med | Token ledger (finish_reason / reasoning-token telemetry) skipped when `owner` is None — truncation observability blind where it's needed | agent_loop.py:6367 |
| NARR-11 | Major | multi-day | High | Instruction saturation: ~16k-token system stack, ~90 rules; live run shows rule-recall failure at reasoning=low (6 phantom holds, montage, invention) | momentPrompts.ts:39-459; live telemetry |
| NARR-12 | Minor | <1hr | High | Sentence-drop repair missing: guard/scrub drops leave "home.The voting has finished." concatenation + orphaned `**` markdown | agent_loop.py:2963-2967, 3009-3030 |
| NARR-13 | Minor | <1hr | Med | Evicted-location guard's room regex omits `dining room` and `hallway` (claims to mirror house.ts; doesn't) | chat_helpers.py:1661-1664 vs house.ts:10-21 |
| NARR-14 | Minor | <1hr | Med | Leak-scrub tool-word list covers 14 of ~30 live tools — asides naming moveTo/confide/formAlliance/etc. pass | agent_loop.py:2892-2896 |
| NARR-15 | Minor | <1day | Med | Closed-set guard bypass phrasings: replacement-nominee, veto-used, "survives the vote", metaphoric HOH | chat_helpers.py:999-1077 |
| NARR-16 | Minor | <1hr | High | Faithfulness judge (0081) ships default OFF — the entire non-closed-set contradiction space is unpatrolled | settings.py:281, faithfulness.py:43-84 |
| NARR-17 | Minor | <1day | Med | Casting prompt orders "move straight into the premiere" on a turn with no roster context and no grounding tools — the prompt-authored root of the phantom-houseguest vector | momentPrompts.ts:559-561; CASTING_TOOLS agent_loop.py:120-123 |
| NARR-18 | Minor | <1hr | Med | Whole-house ceremony beats recorded with witnessSet=[player,+beat participants] only, with duplicate ids — the attending house never "witnessed" the eviction reveal | registry.ts:304-312; save v000200 `season:215` |
| NARR-19 | Minor | <1hr | Med | Vote-confirmation phrasing asserts the outcome ("You've chosen to send Maeve O'Shea home") before a reveal that evicts someone else | eviction moment prompt momentPrompts.ts:676-709; live transcript |
| NARR-20 | Minor | <1hr | Med | OOC producer asides stream unwrapped (no ((…)) ) and the FE has no wrap fallback — asides render as spoken narration | BASE prompt momentPrompts.ts:199-204; live transcript |
| NARR-21 | Minor | <1hr | Med | Extra workspace machinery on the live-game wire: `tail_serve_output`, `ui_control` (+ tool-RAG selecting create_document/manage_notes on game turns) | live log tail `tools_sent=33/34`; agent_loop tool selection |
| NARR-22 | Minor | <1hr | Med | Mid-stream inline `<think>` after first content is NOT routed to the thinking channel — inline-reasoning sub-providers leak think-text into the body | llm_core.py:2134-2179 |
| NARR-23 | Polish | <1hr | Low | `_THINKING_MODEL_PATTERNS` lacks "glm" — a stray leading `</think>` from a flaky sub-provider streams into the body | llm_core.py:643-651, 2176 |
| NARR-24 | Minor | <1hr | Med | npcVoice called twice identically in one turn; runaway threshold 15 — pre-narration tool waste directly feeds the J-2 empty-turn class | live tool_events; agent_loop.py:3551-3560 |
| NARR-25 | Minor | <1hr | Med | Guard logs key "user=None" — desync warnings untraceable to a game in multi-window/multi-user triage | chat_helpers.py:1614-1617 etc. |
| NARR-26 | Polish | <1hr | Low | Premiere/HUD narration counts on `houseguests remaining` — good; but the premiere STILL-TO-MEET observable line exposes raw `archetype` token to the producer voice | momentPrompts.ts:1004-1018 |
| NARR-27 | Minor | <1day | Med | 6 pre-emission phantom holds + 2 desyncs in ONE run: the guard is load-bearing at every ceremony, not a backstop — no alerting/threshold telemetry exists | logs.recentErrors; chat_helpers.py:1580-1621 |
| NARR-28 | Polish | <1hr | Low | `momentForPhase` maps any "final*" to jury-finale before "evict*" — `final-eviction` gets the jury prompt, not the eviction prompt | momentPrompts.ts:800-812 |

---

## Findings

### [NARR-1] [Severity: Major] [Effort: <1hr] [Value: High]
Seeded `max_tokens_budget.narration = 4096` re-introduces the exact truncation vector the code default was written to remove
- Where: `frontend/src/settings.py:196-199` (`"narration": 4096`) vs `frontend/src/token_policy.py:56-66` (`_DEFAULT_MAX_TOKENS["narration"] = None  # ⇒ model-aware cap … "A flat constant here re-introduced the #835 truncation vector for reasoning models"`).
- Problem: token_policy deliberately defaults narration/casting to `None` so the call site substitutes a model-sized cap, because **reasoning tokens count against `max_tokens`** and a flat cap truncates narration mid-reply (#835/#620 NARR-5). But `DEFAULT_SETTINGS.max_tokens_budget` seeds an explicit in-band override of **4096**, and "an explicit, in-band override always wins" — so the shipped live cap IS the flat constant. GLM-4.7 at reasoning=low interleaves thinking that bills against this same 4096; live evidence: the 5-intro premiere turn truncated mid-sentence ("…a boyish grin that hasn't quite faded despite the") — the known J-11 symptom, now with the config mechanism. This is the same seed-kills-the-code-default trap #1007 documented for background-authoring (settings.py:200-204's own comment explains the trap), reproduced for the two player-facing classes. Differential: not a model defect (GLM max output is 131k on most providers — live probe), not the Continue-affordance's job (that's the symptom net). Confidence high.
- Fix: delete the `narration`/`casting` entries from the `max_tokens_budget` seed (absent ⇒ code default `None` ⇒ model-aware cap), or raise narration to ≥ 8192 with a comment binding it to reasoning-inclusive billing. Add a source-pin test that the seeded map does not override a class whose token_policy default is `None`.

### [NARR-2] [Severity: Major] [Effort: <1hr] [Value: High]
Casting cap 2048 (reasoning=medium) truncates the longest casting turn — the casting→premiere reveal
- Where: `frontend/src/settings.py:199` (`"casting": 2048`), reasoning_budget `"casting": "medium"` (settings.py:178).
- Problem: casting runs reasoning **medium** (more thinking tokens than narration's low) under a **2048** total cap. The single longest casting-class output is the finalize turn (producer reveal + the model's habit of rolling into premiere prose — see NARR-17): reasoning + reveal comfortably exceeds 2048, producing mid-sentence cut-offs at the game's first impression. Same mechanism as NARR-1; token_policy's own default for casting is `None` for exactly this reason.
- Fix: same as NARR-1 (remove the seed or ≥ 6144); alternatively cap the finalize turn's scope (NARR-17) so casting turns stay short by construction.

### [NARR-3] [Severity: Major] [Effort: <1hr] [Value: High]
ADR 0016's "Pin the provider and assert reasoning is actually suppressed/sized" is not enforced anywhere
- Where: `frontend/src/settings.py:230` (`"openrouter_provider": {}` — "Default {} = OpenRouter's normal price-based load balancing"), `settings.py:215` (`token_pin_threshold_tokens: 0` = off, and it is a cache-pin, not a conformance pin); no assert in `llm_core.py` / `agent_loop.py` that reasoning arrived on the reasoning channel.
- Problem: ADR 0016 (docs/decisions/0016 §A) explicitly warns "reasoning control is flaky on some OpenRouter sub-providers (e.g. Cerebras)" and directs: pin + assert. Live probe: `z-ai/glm-4.7` currently routes across **9 sub-providers** with heterogeneous windows (131k–204.8k), output caps (**Venice 16,384**; Cerebras 40,960), and quantizations. Consequences: (a) per-turn provider hopping = turn-to-turn narration/persona quality drift and variable reasoning-channel conformance (the I9 leak surface NARR-22/23 depend on); (b) if an admin ever raises the narration cap past 16,384, Venice-routed turns fail or clamp; (c) the FE's discovered `context_length` was 128,000 in the live run (a low-tier provider's window), silently shrinking the input budget derivation. The `model_actual` telemetry exists (`z-ai/glm-4.7-20251222`) but the sub-provider is only recorded in the (owner-gated, NARR-10) token ledger. Differential: NOT the tool_choice rejecter gate (`_model_honors_forced_tool_choice` handles a different axis).
- Fix: ship an OOB `openrouter_provider` preset for the game build — e.g. `{"order": ["z-ai", "deepinfra"], "allow_fallbacks": true}` (keeps availability, biases conformant providers) — and add a cheap runtime assert: on a narration turn with reasoning != off, if `reasoning_chars == 0` AND the body contains `<think` (or `reasoning_chars/output` ratio is anomalous), log a WARN naming the provider so flaky routing is visible. Both are config/log-only, no gameplay change.

### [NARR-4] [Severity: Major] [Effort: <1hr] [Value: High]
The FEPY-2 empty-body recovery re-emits RAW REASONING into the player-visible bubble in game mode — bypassing the leak scrub AND the outcome guard
- Where: `frontend/src/agent_loop.py:3490-3494` (`return round_reasoning, f'data: {json.dumps({"delta": round_reasoning})}…'`), yielded raw at 6337-6341 (post-loop, after every scrub/guard has run).
- Problem: when a turn ends with empty body + non-empty reasoning + no tools, the FEPY-2 branch re-emits the whole reasoning buffer as a **non-thinking body delta** and persists it as the message. On GLM at reasoning=low the reasoning channel routinely carries tool planning, roster analysis and outcome deliberation (live run: many rounds with `raw_reply=0 reasoning>0`; the J-2 turn's `thinking` began "The player wants to pull Lorenzo aside… I need to: 1. Check the game state…"). That text emitted as body = machinery, third-person player reference, and potentially pre-commit outcome talk in the fiction — an I9 break by construction, and it dodges `_scrub_game_leak` and `_pre_emission_outcome_guard` because it is yielded after the loop. The branch was designed for the workspace/Flash case, not the game frame. Differential: distinct from the true-empty branch (which correctly uses the in-fiction producer line); distinct from J-2 (double-blank guard fired there because tools HAD run). Confidence high on mechanism; the trigger shape (no tools at all + all tokens in reasoning) is the rarer path — but the live logs show GLM regularly routes 100% of a round's tokens to reasoning, so it is one no-tool lull turn away.
- Fix: in `game_mode`, route the FEPY-2 recovery through `_scrub_game_leak` + the pre-emission guard before yielding — or better, treat game-mode empty-body-with-reasoning the same as true-empty (producer line + retry affordance) and keep the reasoning in the accordion only.

### [NARR-5] [Severity: Major] [Effort: <1hr] [Value: High]
Mid-stream provider failure (429 / timeout / mid-stream error) renders a raw `[Error: …]` inside the GM bubble — the one degradation path with no game-build gating
- Where: `frontend/src/agent_loop.py:4470-4478` (FEPY-1 emits `{"error": str(err_msg)}`) → `frontend/static/js/chat.js:3058-3066` (`errDiv.textContent = `[Error: ${json.error}]`` — no `isGameBuild()` branch). Contrast chat.js:1672-1690 where the `event: error` path IS gated ("Big Brother cuts to a brief technical interlude…").
- Problem: trace of the 429/timeout journey: `stream_llm` yields `event: error` frames pre-content (gated, fine) — but a mid-round upstream error after content, a read-timeout inside a later agent round, or `finish_reason:"error"` arrives via the FEPY-1 `json.error` path, and chat.js prints the raw provider text ("OpenRouter rate-limited the request (429)…", "Read timeout") in-body, styled as an error but inside the fiction, naming the provider (I9 + C2). `stream_llm_with_fallback` only fails over pre-content, so a mid-stream 429 has no retry — the player gets half a scene + machinery text.
- Fix: in chat.js's `json.error` branch, mirror the existing gate: `isGameBuild()` ⇒ the diegetic interlude line (+ the existing `truncated`-type Continue affordance so the player has one-tap recourse); keep the raw text for the workspace build and console.

### [NARR-6] [Severity: Major] [Effort: <1day] [Value: High]
Forcing `tool_choice: advanceGame` at eviction guarantees the call but suppresses the prose — the E12 staged ballot reveal structurally collapses
- Where: `frontend/src/agent_loop.py:4180-4229` (#1154/ADR 0016 §D force) + live FE log tail: eviction turn rounds 1–6 each `advanceGame`, **`raw_reply=0`** every round; `loop-breaker tripped … sig='advanceGame:{}'`; round 7 (force-answer, `tools_sent=0`) then narrated the ENTIRE reveal + tally in one block. `round_texts: ['',''…]`.
- Problem (traced mechanism): when `tool_choice` names a function, GLM emits ONLY the tool call — no accompanying prose (observed on every forced round). The eviction reveal is designed as one anonymized ballot per advanceGame, voiced with tension (momentPrompts.ts:676-709, `_eviction_reveal_steer`). Under the force, each round consumes a ballot silently; the per-beat steer note can't win because the NEXT round is forced again; the loop-breaker eventually strips all tools, and the model dumps a montage summary — from history, with no board access. In this run the summary happened to be correct (engine truth `producerVault.evictionVotes` = 10–3 Jada, matching), but the design (drama per ballot) is structurally defeated, and the final narration round is the one round that CANNOT re-read the engine. Differential: this is not the model under-calling (the old scar) — it is the new belt over-winning; not an engine bug (the engine dripped ballots correctly, `season:215…` beats in the save).
- Fix: after a forced `advanceGame` returns an eviction-stage beat, force the next round to PROSE (`tool_choice:"none"` — GLM honors it) so the ballot is voiced before the next drain; or have the FE emit the engine's own `event.content` ("a vote to evict X") as a body line per drained beat (engine-authored text, so no invention risk). Cap forced advances per eviction turn at 1–2 so the reveal spans player turns as designed.

### [NARR-7] [Severity: Major] [Effort: <1day] [Value: High]
The belt-store key mismatch (`user or "default"` writer vs `owner or ""` readers) leaves grounding belts dead in the single-user/no-auth posture
- Where: writer `frontend/routes/chat_helpers.py:2316` (`_LAST_FRAMED_BEAT_KEY[user or "default"]` — the #1154 fix); readers `frontend/src/agent_loop.py:4785` (`.get(owner or "")` — the F14 eviction-drain allowance) and `agent_loop.py:4916` (`.get(owner or "")` — ADR 0011 peer-advance). The in-code comment at chat_helpers.py:2313-2315 admits "the legacy peer-advance / stall-nudge readers still key on `owner or ''` — a separate, pre-existing matter".
- Problem: under `AUTH_ENABLED=false` (the documented "legitimate home deploy", and the posture of every live audit run — the log tail shows `user=None` / `user=default` side by side), the readers look up a key that is never written: `_framed_phase` resolves None, so (a) the F14 eviction-drain allowance never fires (the eviction wedge it exists to break is unprotected exactly where the ship-gate's worst seam lives), and (b) the peer-advance detector is inert, so a decision-card POST from a second window mid-turn reads as "no progress" and re-triggers the stall machinery (the "20-step loop" class F9 fixed for auth-on). #1154 fixed only the force-gate reader. Differential: masked in the live run because the #1154 forced tool_choice (which uses the fixed key) drained the eviction anyway — remove or kill-switch the force and the wedge returns with no net.
- Fix: one shared `def belt_key(owner): return owner or "default"` used by every `_LAST_FRAMED_BEAT_KEY` / stall-store reader and writer; a source-pin test asserting no `or ""` key remains.

### [NARR-8] [Severity: Major] [Effort: <1hr] [Value: High]
The 0065 Part E2 stateDelta "Since your last turn" feed is dead single-tenant
- Where: `frontend/routes/chat_helpers.py:1963-1968` — `_maybe_delta_line`: `if user is None … return None`.
- Problem: the O(Δ) freshness line — the tight "what changed since your last turn" diff that makes staleness self-evident to the model — is unconditionally skipped when `user` is None, i.e. in the whole AUTH_ENABLED=false posture. The #1045 fix migrated the desync-signature stores to `_desync_key(user)` (canonical-session fallback) for exactly this reason but left this reader on raw `user`. VIEWED: no "Since your last turn" line in any live-run framing; every guard log says `user=None` while the game ran under the engine's "default" sandbox. The model therefore re-grounds only from the full context block, and cross-window/decision-card mutations reach it a turn later — a direct contributor to the phantom-outcome attempts the pre-emission guard then has to hold (6 holds in one run).
- Fix: key `_LAST_BEAT_SEQ` reads/writes and the `state_delta` call on `_desync_key(user)`, mirroring #1045. One-line change + a test in the #1045 family.

### [NARR-9] [Severity: Major] [Effort: <1day] [Value: High]
The in-game clock (ADR 0006) is dormant out-of-box in the no-auth posture — so the model never receives the time-of-day fact all its TIME DISCIPLINE rules reference
- Where: engine default OFF — `src/adapters/engine/GameSessionAdapter.ts:4844` (`ORWELL_TIME_OF_DAY` env, unset ⇒ off; no deploy file sets it — grep of `deploy/` finds nothing); FE apply `frontend/routes/chat_helpers.py:67-80` returns early `if _TIME_OF_DAY_APPLIED or not user` — dead when `user` is None.
- Problem (omission-fidelity): `renderGameContext` emits the "Time of day: X (engine truth…)" line only when `view.timeOfDay` exists (momentPrompts.ts:1042-1044); BASE + the social/nominations moments carry ~15 lines of "honor the IN-GAME TIME OF DAY the GAME CONTEXT reports" discipline. With the clock dormant, that anchor never appears: the model free-runs the hour (premiere "first-night buzz" was fine, but the anti-"fresh morning" rules are unanchored), the night-presence economy and rest cue never engage, and the HUD night status stays hidden. VIEWED: no `timeOfDay` in any live-run state read; `time_of_day_enabled: True` in FE settings yet never applied. Auth-on deploys work (first real user applies it once) — the local/LAN posture silently loses the whole 0066 feature.
- Fix: (a) drop the `not user` guard — apply with `user=None` (the engine maps anon → "default" sandbox, same as every other call), or apply at FE boot when `AUTH_ENABLED=false`; (b) set `ORWELL_TIME_OF_DAY=1` in the deploy systemd unit so the deploy default matches the ADR ("the deploy turns it on" is currently untrue).

### [NARR-10] [Severity: Minor] [Effort: <1hr] [Value: Med]
Token-ledger telemetry (appliedMaxTokens / finish_reason / reasoning tokens / provider) is skipped when `owner` is None
- Where: `frontend/src/agent_loop.py:6367` — `if _is_live_game and owner:`.
- Problem: the exact observability that would surface NARR-1 (finish_reason="length" truncations), NARR-3 (which sub-provider served each turn), and reasoning-token sizing is never recorded in the single-user posture — the admin token-economy meter reads empty, and truncation regressions are invisible. Same `owner`-gate class as NARR-7/8/9.
- Fix: fall back to the canonical game-session key (the code already resolves `_canon_session`); record under `"default"` when owner is None.

### [NARR-11] [Severity: Major] [Effort: multi-day] [Value: High]
Instruction saturation: a ~16k-token, ~90-rule system stack that GLM-4.7 at reasoning=low demonstrably cannot hold
- Where: `src/engine/momentPrompts.ts:39-459` (BASE = 38,482 chars ≈ 9.6k tokens), + moment fragment (up to 1.5k) + GAME CONTEXT (≈5-6k with a 16-HG roster) + up to six appended directives (barrier, location, premiere, re-ground, delta, movement — chat_helpers.py:2334-2403) + `GAME_AGENT_PREAMBLE` + ~33 tool schemas. Measured live: ~33.6k input tokens PER ROUND (402,805 over one 12-round turn).
- Problem: the run shows systematic rule-recall failure exactly where the density is highest: 6 pre-emission phantom-outcome holds + 1 wrong-nominee hold + 2 beat-signature desyncs (recentErrors), houseguest invention at the premiere, montage over the anti-montage section, unwrapped OOC asides, fabricated runCompetition participants — each is a rule stated (often twice) in BASE. This is the classic long-instruction degradation the charter names (instruction-forgetting past ~8-12k), amplified by reasoning=low (less budget to re-derive constraints). It also costs: every round re-sends the stack (caching mitigates cost but not attention). Differential: not a Vault/engine problem (engine held everywhere — the guards caught the drift); not fixable by ADDING rules (each incident historically added a paragraph: #1127, LW9, F16, #1045 — the stack is the accreted scar tissue and is now part of the disease).
- Fix (direction): per-moment BASE variants — casting/premiere/ceremony/social builds that include only the rule families the beat can exercise (the eviction turn does not need the casting-seal, showmance, HOH-music, or self-eviction sections; the premiere does not need eviction-tally law). Target ≤ 5k tokens of instructions per turn. Keep the always-on invariants (names-fixed, outcomes-are-the-game's, machinery-invisible) in every variant. Measure with a rule-recall A/B (the 0107/0108 owed live verification is the natural harness).

### [NARR-12] [Severity: Minor] [Effort: <1hr] [Value: High]
Dropped-sentence seams: the scrub/guard removes sentences but never repairs the join — concatenation artifacts and orphaned markdown ship to the player
- Where: `frontend/src/agent_loop.py:2963-2967` (`_scrub_game_leak` re-joins surviving parts verbatim), 3009-3030 (`_pre_emission_outcome_guard` drops sentence parts). VIEWED live: veto-ceremony turn `raw_reply=855 → emitted_visible=639` and eviction turn `1584 → 1327` (silent mid-narration holes); shipped text "…send **Maeve O'Shea** home.The voting has finished.", a dangling `**` on its own line in the reveal.
- Problem: when a sentence is dropped mid-paragraph, the preceding delimiter and the following capital collide ("home.The"), and any `**`/quote opened in a dropped (or surviving) sentence loses its pair — the v1 "broken markdown" finding (J-5) blamed round-joins, but the log-tail deltas prove the guard/scrub drop path produces the same artifact class inside a single round. The player reads a glitch at the season's peak beat.
- Fix: on any drop, insert a single space (or `\n\n` when the drop crossed a paragraph) between the surviving neighbors, and run a cheap balance pass on the final turn text (close unmatched `**`/`*`/`"`). Both are presentation-only; no jurisdiction change.

### [NARR-13] [Severity: Minor] [Effort: <1hr] [Value: Med]
The evicted-in-a-room guard's floor plan omits `dining room` and `hallway`
- Where: `frontend/routes/chat_helpers.py:1661-1664` — `_HOUSE_ROOM_WORDS_RE = kitchen|living room|lounge|backyard|bedrooms?|bathroom|hoh room|head of household|storage room` with the comment "mirrors src/domain/house.ts". `src/domain/house.ts:10-21` also has `dining-room` and `hallway` (both real, walkable, and heavily used — the live run's hallway held 6 houseguests).
- Problem: "Jada wanders into the dining room" / "Jada is lingering in the hallway" after her eviction passes the triple gate (no recognized house-room word), so the one impossibility class the ruling says must be scrubbed pre-emission ships for two of the twelve rooms. Regex drift from the floor plan is silent — nothing pins them together.
- Fix: add `dining[\s-]?room|hallway|hall\b` to the regex, and add a unit test that iterates `HOUSE_ROOMS` (minus diary-room) asserting each display name matches `_HOUSE_ROOM_WORDS_RE`.

### [NARR-14] [Severity: Minor] [Effort: <1hr] [Value: Med]
The operator-aside scrub knows 14 tool names of the ~30 the narrator can actually call
- Where: `frontend/src/agent_loop.py:2892-2896` (`_GAME_TOOL_WORDS`) vs the live toolset (registry PLAYER_TOOLS minus INFRA; `tools_sent=33` in the run): missing `moveTo`, `markHouseguestMet`, `premiereIntros`, `confide`, `exposeSecret`, `tradeSecret`, `socialInitiatives`, `formAlliance`, `joinAlliance`, `diaryRoom`, `seasonRecap`, `seasonRetrospective`, `askProducers`, `renderScene`, `requestSelfEviction`, `stateDelta`, `ask_user`, `update_plan`.
- Problem: a leaked planning sentence naming any un-listed tool ("Let me confide-check her first", "I'll call formAlliance so it's real", "the update_plan is refreshed") passes the sentence scrub — the verb-based patterns catch some shapes ("let me record/advance/…") but the tool-noun net has holes for exactly the newer social levers GLM plans around most.
- Fix: build `_GAME_TOOL_WORDS` from the live tool schema names at module init (the loop already has the list) instead of a hand-copied tuple; keep the regex compile once per process.

### [NARR-15] [Severity: Minor] [Effort: <1day] [Value: Med]
Concrete closed-set bypass phrasings the guard regexes don't cover
- Where: `frontend/routes/chat_helpers.py:999-1077` (the seven `_CLAIM_*` detectors).
- Problem (contradiction vectors that can ship): (a) **replacement nominee** — "Lorenzo names Klaus as the replacement" / "Klaus takes Maeve's seat on the block" matches neither `_CLAIM_NOMINATED_RE` ("on the block" catches the second, not the first) nor anything veto-side; (b) **veto used/not used** — "Shea pulls Jada off the block" / "Shea saves herself" asserts `veto.used` (only the veto WINNER is policed); (c) **survival claims** — "Maeve survives the vote" is a result claim with no evict-word; (d) **metaphoric HOH** — "the key is Lorenzo's this week", "power changes hands to X" (only "wins HOH/new HOH" match). Each is a board-contradiction the player can catch against the HUD. All were near-missed live (the model tried multiple phantom phrasings; 6 were held, meaning its paraphrase space is broad).
- Fix: add narrow patterns for (a)-(c) — "names X as (the )?replacement", "pull(s|ed)? \w+ off the block", "sav(es|ed) (himself|herself|themselves)", "survives the (vote|eviction)" — paired with the existing signature fields (`noms`, `vetoUsed`, `evicted`); leave (d) to the faithfulness judge (NARR-16) rather than metaphor-regexing (ADR 0005 conservatism).

### [NARR-16] [Severity: Minor] [Effort: <1hr] [Value: High]
The 0081 faithfulness judge ships default OFF — the entire non-closed-set contradiction space has no net at all
- Where: `frontend/src/settings.py:281` (`"faithfulness_mode": "off"`), `frontend/src/faithfulness.py:43-84` (off/shadow/active; off = never runs).
- Problem: everything the regex guards constitutionally cannot touch — invented biography detail, who-was-present-in-a-past-scene claims, "as you told Mila yesterday" (never said), relationship-history assertions, wrong-room color for living houseguests — is exactly the space the LLM judge was built for (`_faith_check` verifies against a Vault-free projection), and it is inert OOB. The one live season produced a phantom houseguest and shifting room placements; the post-turn roster/presence checks catch a subset (names, presence verbs) a turn late. With GLM-4.7-Flash as the near-free utility lane, shadow mode costs pennies and produces the telemetry the ship decision needs (ADR 0016's own owed verification list).
- Fix: flip the shipped default to `"shadow"` for the game build (judge + log, zero player-visible change), review a week of verdicts, then decide `active` per-class. Keep `off` for the workspace build.

### [NARR-17] [Severity: Minor] [Effort: <1day] [Value: Med]
The casting prompt orders the model to narrate the premiere on a turn that has no roster, no whereabouts tool, and no premiere rules — the prompt-authored root of the phantom-houseguest vector
- Where: `src/engine/momentPrompts.ts:559-561` ("THE REVEAL — … confirm who they're cast as, **then move straight into the premiere**"); `CASTING_TOOLS` (`frontend/src/agent_loop.py:120-123`) = {updateCasting, createCharacter, getGameState, gameStatus, ask_user, generate_image, web_search} — no `whereabouts`, no `premiereIntros`, no `markHouseguestMet`; the casting-frame GAME CONTEXT has no roster (renderGameContext pre-game branch, momentPrompts.ts:838-869).
- Problem (root-cause refinement of the known J-1, not a re-report): the live premiere opening — "Audrey Duran is out in the backyard" (no such houseguest), Julian placed in the living room vs engine backyard — was written on the **casting** turn, mid-turn after `createCharacter` returned, under the casting system prompt. Every grounding defense (the roster block, "call whereabouts BEFORE you describe ANY room", the premiere STILL-TO-MEET list, `markHouseguestMet`) arrives only on the NEXT framed turn. The prompt line "move straight into the premiere" affirmatively pushes the model into the one narration it cannot ground. The engine adapter returns a casting card, not placements.
- Fix: change the reveal instruction to END the turn at the handoff ("read the casting card back, tell them the doors open when they're ready, and STOP — the premiere opens next turn"), and/or have the FE cut the agent loop after a successful `createCharacter` (stream the card, end turn) so the first premiere prose is always written under the premiere frame. Either is a two-line change; both together are belt+prompt.

### [NARR-18] [Severity: Minor] [Effort: <1hr] [Value: Med]
Whole-house ceremony beats are recorded with witnessSet = [player, beat participants] — the attending house never "witnessed" the reveal, and participant ids duplicate
- Where: `src/composition/registry.ts:304-312` (`witnessSet: [PLAYER, ...ev.participants.filter(p => p !== PLAYER)]`); VIEWED in the live save (`v000200.json`): ballot beat `season:215` has `witnessSet: ["player","npc:6","npc:6","npc:6"]`.
- Problem: an eviction reveal is definitionally a whole-house event (BASE prompt: "the WHOLE house gathers"), but the recorded event's witness set is the player + the nominee(s) the ballots touched — so the knowledge layer says 13 attending houseguests never witnessed the vote reveal. Downstream, `npcVoice`'s "what THEY know" and any recall built on witnessed events under-informs NPC dialogue about the season's most public facts (an I3/I6 fidelity gap: an NPC who "wasn't a witness" to an eviction they stood in the room for). The duplicated ids are harmless but show no dedup/validation on the seam.
- Fix: for weekly-loop beats of whole-house kinds (comp results, ceremonies, ballots, eviction result), witness the full active roster (the engine knows it); dedup the set at record time.

### [NARR-19] [Severity: Minor] [Effort: <1hr] [Value: Med]
The vote-confirmation line asserts the outcome — "You've chosen to send Maeve O'Shea home" right before the house evicts Jada
- Where: live transcript (eviction turn round 1: `submitDecision` + "Your vote is cast. You've chosen to send **Maeve O'Shea** home."); eviction moment prompt `src/engine/momentPrompts.ts:676-709` (has tally law, no vote-confirmation phrasing rule).
- Problem: "send X home" states a committed departure as the effect of the player's single vote. Two beats later Jada leaves — the juxtaposition reads as either a contradiction or (worse) that the player's vote should have decided it. The claim regexes rightly let it stream (`votes to evict` + evictee-identity check passed — Maeve wasn't evicted, but the sentence is future/intent-shaped). It's a phrasing trap the model will hit every eviction (confirm-then-blindside is the game's signature moment; the confirmation must not pre-write the ending).
- Fix: one line in the eviction moment prompt: "When confirming the player's ballot, say their VOTE is cast ('your vote to evict X is in') — never that X is going home / being sent home; one vote decides nothing."

### [NARR-20] [Severity: Minor] [Effort: <1hr] [Value: Med]
OOC producer asides ship unwrapped — the ((…)) channel-marking rule is prompt-only and the FE has no fallback
- Where: BASE `src/engine/momentPrompts.ts:199-204` (MARK YOUR OWN OOC ANSWERS); VIEWED live: the phantom probe answer "There's no Audrey in the house, I'm afraid — you might be mixing up names. But you've got three people in the backyard…" rendered as plain narration, unwrapped.
- Problem: channel discipline (producer aside vs in-room speech) is enforced only by prompt wording — exactly the enforcement class the mandate says not to rely on. When the model answers a meta/logistics/complaint input in plain prose, the renderer can't style it as an aside, so production-voice fact corrections read as diegetic narration (and here, as the game gaslighting the player — the aside also violated its own "never blame the player" spirit, but the render channel is the fixable half).
- Fix: FE fallback — when the player's message classified OOC (the framing already computes this for the aside rules) and the reply is unwrapped, wrap the whole reply in the aside style server-side before persist/stream. Cheap, presentation-only, reversible.

### [NARR-21] [Severity: Minor] [Effort: <1hr] [Value: Med]
Beyond `update_plan` (known), the live-game wire still carries `tail_serve_output` and `ui_control`, and workspace tool-RAG runs on game turns
- Where: live log tail — `tools_sent=33/34 tool_names=['ui_control','ask_user','update_plan','tail_serve_output','getGameState',…]`; `[tool-rag] Keyword fallback selected: ['create_document','manage_notes']` (and once a full email-tool set) logged on game turns.
- Problem: each extra workspace tool is (a) schema tokens on every round, (b) a surface the narrator can wander into mid-fiction (a `ui_control` call from the GM would be an I9/C2 break), (c) evidence the game-mode tool filter is allow-listing more than the game contract (GAME_AGENT_PREAMBLE describes engine tools only). The tool-RAG keyword pass also spends latency selecting workspace tools that then (correctly) aren't sent — wasted per-turn work.
- Fix: under `ORWELL_GAME_BUILD` + live game, hard-pin the toolset to the engine tools + {ask_user, web_search, generate_image}; skip the tool-RAG selection entirely on framed game turns.

### [NARR-22] [Severity: Minor] [Effort: <1hr] [Value: Med]
Mid-stream inline `<think>` is only detected before the first content token — interleaved-thinking leaks from non-conformant sub-providers go to the body
- Where: `frontend/src/llm_core.py:2134-2179` — the `<think>` auto-detect requires `not _first_content_sent` (and `_in_think_tag`); once any visible content has streamed, a later `<think>…</think>` block in `content` streams as body text.
- Problem: GLM-4.7's signature behavior is INTERLEAVED thinking — reasoning between tool calls, i.e. mid-turn, after content may have streamed. On the conformant providers this arrives on the `reasoning` field (safe); on a provider that inlines it into `content` (the ADR's flaky-sub-provider caveat, NARR-3), the inline block lands mid-body. The FE render-side `processWithThinking` may recover some, but the server-side split — the by-construction guarantee the FE conventions document — has this gap, and the persisted message keeps the think-text.
- Fix: make the `<think` detector stateful across the whole stream (enter think-routing whenever a chunk contains `<think`, exit on `</think>`), not just before first content. Pairs with the NARR-3 provider pin as belt+suspenders.

### [NARR-23] [Severity: Polish] [Effort: <1hr] [Value: Low]
`_THINKING_MODEL_PATTERNS` lacks "glm" — the stray-leading-`</think>` repair never arms for the shipped narrator
- Where: `frontend/src/llm_core.py:643-651` (`_THINKING_MODEL_PATTERNS = ("qwen3","qwq","deepseek-r1",…)`), used at 1968/2176 to repair a reply that opens with a bare `</think>`.
- Problem: some backends emit `</think>` with no opener as the first token; the repair is gated on `_thinking_model`, which is False for `z-ai/glm-4.7*`, so that token (plus any preceding reasoning) would stream into the body. Low probability, but the shipped OOB narrator is exactly a thinking model.
- Fix: add `"glm-4"` (and `"glm-5"` future-proofing) to the pattern tuple.

### [NARR-24] [Severity: Minor] [Effort: <1hr] [Value: Med]
Duplicate identical lever calls burn the turn budget the narration then runs out of — `npcVoice(npc:8)` ×2 in one turn; runaway threshold is 15
- Where: live tool_events (the J-2 Lorenzo turn: rounds 10 and 11 fetched byte-identical `npcVoice {"id":"npc:8"}`; also `moveTo` ×4 wandering); `frontend/src/agent_loop.py:3551-3560` (`_detect_runaway_call` threshold=15); the loop-breaker fires only at 6 REPEATED rounds of the same signature.
- Problem: identical read-only lever calls within one turn return identical data; each costs a full ~33k-token round. In the observed blocker-class turn the model spent its rounds on redundant reads and never narrated. A per-turn memo for idempotent read tools (npcVoice, whereabouts, gameStatus, getGameState with same args) would return the cached result instantly WITHOUT consuming a round, converting wander-loops into fast no-ops and leaving rounds for prose.
- Fix: memoize read-only tool results per (tool,args) within a turn in the agent loop's tool dispatch; on a repeat, append the prior result + a one-line note ("you already hold this — narrate now"). Keep mutating tools exempt.

### [NARR-25] [Severity: Minor] [Effort: <1hr] [Value: Low]
Desync/guard telemetry logs `user=None` — incidents can't be attributed to a game/session
- Where: e.g. `frontend/routes/chat_helpers.py:1614-1617` and every guard WARN in the live bundle ("… HELD a phantom closed-set outcome for user=None").
- Problem: the guards already resolve a stable identity (`_desync_key` = canonical session) but log the raw `user`. In any multi-window or multi-user triage the highest-signal telemetry in the product (phantom holds, desyncs) is unattributable; counting holds-per-game (NARR-27) is impossible from logs.
- Fix: log `_desync_key(user)` (short-hash it) alongside `user`.

### [NARR-26] [Severity: Polish] [Effort: <1hr] [Value: Low]
The premiere STILL-TO-MEET lines hand the producer voice the raw archetype token first
- Where: `src/engine/momentPrompts.ts:1004-1018` — `observable()` starts `bits` with `fi.archetype` (the comment argues it helps voice "the energy that READS as that type").
- Problem: F3/#1016 demoted the archetype in the ROSTER lines to a fenced "private voice cue, never said aloud" because leading with it made the model narrate the scouting report; the premiere list re-leads with the bare token, unfenced, on exactly the beat (introductions) where the label-leak temptation is highest ("Klaus, our comp-beast…" class). Inconsistent with the roster's own hard-won framing.
- Fix: move `fi.archetype` to the tail of `bits` wrapped in the same "(private cue, never said aloud: …)" fence the roster uses.

### [NARR-27] [Severity: Minor] [Effort: <1day] [Value: Med]
The pre-emission guard held 6 phantom closed-set outcomes + 1 wrong-nominee + 2 desyncs in ONE season run — load-bearing, with zero aggregation or alerting
- Where: `journey-debug-bundle.json logs.recentErrors` (timestamps cluster at the noms and eviction windows); `chat_helpers.py:1580-1621` (each hold is a lone WARN).
- Problem: at reasoning=low, GLM attempts a phantom board claim at roughly every ceremony; the guard (correctly) drops them, at the cost of NARR-12's visible seams and re-ground turns. Nothing counts these per game, so there is no regression signal if a model/prompt change doubles the rate — the single most predictive metric for the product's worst failure class (I2 breaks) is being discarded. This is also the calibration input the ADR 0016 A/B (GLM vs DeepSeek craft control) needs.
- Fix: counter per canonical session (holds, desyncs, re-grounds) in the existing sync ledger (`orwell_sync_ledger.py` is the natural home), surfaced on /admin/status; WARN→INFO once counted.

### [NARR-28] [Severity: Polish] [Effort: <1hr] [Value: Low]
`momentForPhase` routes `final-eviction` to the jury-finale prompt, not the eviction prompt
- Where: `src/engine/momentPrompts.ts:800-812` — `if (p.includes("jury") || p.includes("final")) return "jury-finale";` runs BEFORE `if (p.includes("evict"))`; `_EVICTION_PHASES` in chat_helpers includes `final-eviction` as an eviction phase (the FE guard side treats it as eviction).
- Problem: the final-3 eviction beat (an HOH's live choice + a walk-out — eviction mechanics) gets the jury-finale framing ("the jury's votes are already cast…"), which affirmatively tells the model NOT to re-ask decisions and to treat votes as cast — wrong for a beat where the HOH's binding choice may be the player's. Engine truth prevents real damage (pendings still gate), but the moment framing contradicts the beat, and prompt/guard disagree about what phase family this is.
- Fix: order the `evict` check before the `final` check (or add an explicit `"final-eviction": eviction` mapping).

---

## What held up (calibration — stated plainly)
- **Engine authority + Vault Wall held everywhere observed**: outcomes (HOH loss despite Compete, the 10–3 blindside) came from the engine; the narrated tally matched `producerVault.evictionVotes` exactly (10–3, 13 legal voters); no hidden state, per-voter attribution, or numbers reached any player-visible text in the run.
- **Persona/voice stability (I6) held across the run** — Lorenzo (blunt, clipped, scoreboard-first), Julian (deadpan wedding planner), etc., matched their stored voice fingerprints each appearance; no vocation/backstory drift found in the transcript (the roster-identity block is doing its job).
- The pre-emission guard family fail-opens correctly, never held creative prose in the run, and every hold it made was a genuine phantom.

## Where I looked / did not look
Looked: the full live-season transcript + FE log tail + engine saves + producerVault cross-checks; momentPrompts.ts end-to-end; chat_helpers.py guard/barrier/framing pipeline; agent_loop.py scrub/guard/belt/degradation/empty paths; llm_core.py streaming + reasoning channel + error paths; token_policy/settings/context_budget; chat.js error rendering; registry.ts event seam; house.ts floor plan; 2 live OpenRouter probes. NOT covered: the casting-photo/portrait lane, TTS, the admin surfaces, multi-window mirror parity (other lanes), the retrospective/unsealing beats (no post-season run available), and NPC-NPC offscreen texture quality (needs a longer season).
