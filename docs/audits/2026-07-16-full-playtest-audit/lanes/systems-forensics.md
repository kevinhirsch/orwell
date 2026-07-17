# Lane: Systems / Telemetry Forensics

> Source digest: `systems-forensics-2026-07-16.md` (banked lane-report digest, 2026-07-16 campaign; the
> digest notes "full report banked; see conversation for verbatim").
> Lens: operational/telemetry forensics over the debug bundle — provider topology, correction pipeline,
> token/latency accounting, config posture.

---

BOTTOM LINE: engine + 0031 integrity spine FLAWLESS all night (7,289 tool calls / 10 failed;
sandboxHealth clean, circuit closed). Damage concentrated in exactly two places, both settings/wiring not
architecture:

1. ZERO-FAILOVER LLM TOPOLOGY — `openrouter_provider={"only":["novita"],"allow_fallbacks":false}` +
   utility on `kwaipilot/kat-coder-air-v2.5` + ALL fallback lists empty + `reasoning-off` ineffective →
   every hiccup was a hard failure (genesis kill, judge timeout, dead premiere opener, 3x empty memory
   extraction, 13-min hang).
2. CORRECTION PIPELINE DETECTS BUT DOESN'T REPAIR — single-slot `_DESYNC_REGROUND` queue
   (`agent_loop.py:2910-2929`) dropped 17/24 queued prose corrections ("deferred"); the fabricated-HOH
   reground was deferred once + applied once but NEVER VOICED; the fabricated-removal reground queued
   AFTER the last message; no voiced-correction verification signal exists at all.

NEW DEFECTS N1-N9:

- N1 overseer gap-repair DOUBLE-REPORTING (28 reports / 13 belt fires / 13 engine folds) — inflates RED
  alarm 43 vs real 29.
- N2 `reasoning_budget "off"` INEFFECTIVE in production: 59,862 reasoning tokens billed across 147/180
  calls (~40% of output side); genesis died from length-cut (3000-token window entirely consumed by
  reasoning: in=1461, reasoning=2999, output=3000, finish=length). Authoring/judge llmIo records carry
  `callClass:None` — class-keyed policy may never attach.
- N3 single-slot correction queue (above).
- N4 UNBOUNDED NON-STREAM CALL: 13-minute (780,485ms) memory-extraction hang, `ok:true` —
  `agent_stream_timeout_seconds=300` guards streams only.
- N5 zero-failover topology (above).
- N6 PORTRAIT PRE-FINALIZE RACE: first NPC portrait wave ran DURING casting before genesis/identity
  finalize → ADR-0013 staleness scan → 9 regenerations + the 6 budget-refused `recordImageBeat`
  write-backs (beats lost, gens paid).
- N7 token-ledger blind spots: memory extraction + image generation unledgered; judges misattributed to
  background-authoring.
- N8 bundle redaction over-match: `ORWELL_SECRET_PACING` value redacted because name matches `/SECRET/`.
- N9 memory extraction runs on the NARRATOR model (missed by #1620 routing) + not game-session-aware
  (BB F16).

KEY TELEMETRY FACTS: E22 "narrated with no engine write" x22 of 23 turns. Overseer 82 reports:
gap-repair 28, faith:leak 8, advance-stall 6, faith:board 5, reinject-delta 8. `recordInteraction`
failureRate 13.3% (stale-409 fold drops, A-S3). `getGameState` 1,503 calls/hr (gadget poll load).
SearXNG misconfigured (`search_url=""`) — 12 connection-refused per search before DDG fallback.
`utility_model` captured as `qwen/qwen3.6-flash` but ALL runtime utility calls went to kwaipilot (live pin
changed back before capture). llmIo ring (200) evicted the whole casting/genesis window (starts
02:42:40).

WASTE LEDGER: ~$0.07-0.09 of $0.3242 (~25%) + ~30 min provider/wall: genesis-that-committed-nothing
$0.0223/6.5min; 15 empty authoring streams $0.021; 9 stale portrait regens (unmetered); judge/overseer
overhead $0.048 (15%) yielding ~0 verified corrections; cold-cache re-reads $0.024; spend split:
narration 64.5% / cast pipeline 20.5% / guard overhead 15%.

CONFIG CHANGES TODAY (owner's box):

1. unpin novita or allow_fallbacks (prefer ordered multi-provider — keeps cache affinity);
2. NEVER kwaipilot for utility — verify qwen3.6-flash stuck + re-run genesis on it;
3. pin `faithfulness_model` explicitly + fallbacks + surface "judge=inherited" on `/admin/status`;
4. populate ALL fallback chains;
5. raise background-authoring budget 3000→6000 or land reasoning-aware sizing (ADR 0010 #2);
6. fix search (provider=duckduckgo or real searx url);
7. verify `reasoning:{enabled:false}` reaches/honored by novita;
8. set `token_spend_alert_usd` nonzero;
9. DECIDE dark built-features: `ORWELL_MYTH_MAKING` (0101) + `ORWELL_VOTE_DEDUCTION` (0105) are built but
   OFF (missing from `deploy/orwell-env-defaults.sh`) — owner ruling needed; also
   FORESHADOW/MEMORY_CALLBACKS/SECRET_BARTER/GEN_COMPETITIONS/TIE_REVEAL/REACTIVE_TWISTS;
10. reconcile `tts_enabled`/`tts_provider`;
11. route memory extraction to utility + non-stream timeout + game-session-aware;
12. gate first portrait wave on identity-finalize.

OBSERVABILITY GAPS (→0112): per-class llmIo rings (genesis window evicted); capture reasoning field in
payloads; correlation IDs belt↔overseer↔engine; provider-of-record per call; "correction voiced"
signal; judge model+latency in guards rollup; per-turn image budget state; engine boot-flags block in
bundle; alarm dedupe.
