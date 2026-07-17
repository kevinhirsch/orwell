# Lane: QA Root-Cause Analysis

> Source digest: `qa-root-cause-2026-07-16.md` (banked lane-report digest, 2026-07-16 campaign).
> Lens: root-causing the owner's six named complaints against the same build (`2cb1052`) bundle —
> 200 `llmIo` records (02:42–03:56), session `7c951514` (64 messages), plus `rc` (release-candidate)
> diffs `f87eff68`/`5a55c06d`/`c8abd110`/`0138545d` read in full against the live telemetry.

---

## 1. SESSION RENAME — STILL-OPEN

Mint: game build names every chat "Casting interview" (`sessions.js:1810`, J2-08). Auto-namer
deliberately skips it (`needs_auto_name` `chat_helpers.py:4387-4396` treats it as custom). ONLY rename
trigger is restart-gated M1-7 (`orwellOnboarding.js:774-810`, `_orwellRestartArmed`) — NO
rename-on-game-start for season 1 (`session_manager.py:885-887`: "never renamed server-side"). #557
`paintTitle` only repaints top-bar. Second row = per-tab casting session (GAP-2-b1 by design re #1086);
reaper permanently exempts empty "casting interview" rows (`_GAME_SESSION_NAMES`
`session_manager.py:887`). FIX (S): rename canonical to "Season N" at the STARTED edge
(`do_create_character` success path `tool_implementations.py:4721+` or `apply_game_framing` active-edge;
reuse M1-7 name semantics). Also: reaper may collect empty non-canonical casting row once canonical
binding exists.

## 2. PRODUCER STALLS — 3 stacked causes

(a) Cast-authoring starvation: recs 0-22, 23 CASTING PRODUCER calls 26-40s, ~15 txt=0 (GLM routed JSON
into reasoning channel) — RC3/RC4/RC5 VERIFIED-FIXED-IN-SOURCE (#1662: genesis floor raise,
`recover_reasoning_channel_json`, 3x5 chunked sketch — `orwell_cast_genesis.py:532-617,817-852`).
Latency: NEEDS-LIVE-VERIFY.

(b) 90s finalize block: `run_genesis` AWAITED INLINE in `do_create_character`
(`tool_implementations.py:4698-4704`) — rec 32 = 70.3s sketch, spinner-only. REMAINS (by-design
fallback).

(c) Premiere opener silently died: rec 33 `ok=False` 4s no text — turn closed with no move-in narration;
owner's "WOW THANK YOU" msg WAS the manual push. STILL-OPEN (rc6 only makes failure truthfully classed;
#967/#969 cue-backoff covers interview opener only, not mid-turn follow-up death).

FIX: (S/M) auto-refire premiere cue via `_sendCueWithBackoff` (`orwellOnboarding.js:574`) when
post-`createCharacter` round yields no text; (S) diegetic "production hold" beat streamed during inline
genesis fallback.

Working belts (not the stall): headshot-on-file-framing 8/8 (`chat_helpers.py:3968-3977`),
casting-record-belt 3 (`agent_loop.py:7005`).

## 3. QUESTION-SAILING — STILL-OPEN (owner's MUST)

NO stop-on-question mandate exists. Prompt has: decision-card hard stops (`momentPrompts.ts:106-115`),
WANDERING-scoped hold (`:219-229`), pacing-is-engagement (`:204-217` rewards long scenes), casting
one-question-at-a-time (`:595-600`). Nothing general.

Bundle instances (8): rec 52 Stephanie "this room's got good energy, right?" → sails 1,605 chars; rec
134 Veronica "I assume you're making the rounds?" → "she continues"; rec 177 Teresa "What is WRONG with
you?" → 1,094 chars of other HGs. (Also 45/114/121/142; rec 88 is NPC→NPC — scope rule to
player-directed.)

FIX ladder: (S) prompt QUESTION DISCIPLINE rule beside WANDERING — "direct question TO THE PLAYER = live
invitation; finish that beat and END YOUR REPLY" — scoped to player-directed 2nd-person; STALES GOLDEN
(re-record same PR). (M) FE post-round draft pass per S2a `enforce_grounded_draft` pattern
(`chat_helpers.py:2542+`): truncate at question only when continuation CHANGES speaker/room; never
truncate engine-mandated beats. (L) turn-splitting — NOT recommended (fights F5/streaming/persistence).
(S) faith:pacing judge dimension for before/after measurement.

## 4. SPEAKER/OOC BUBBLES — machinery shipped, adoption failed. STILL-OPEN

Exists: `(( ))` OOC producer asides — `.msg-ooc-producer` `chat.js:1784`, `ooc-producer-aside` badge
`markdown.js:1086-1140`, leading aside splits two bubbles (`_segmentLeadingOocAside`
`markdown.js:250-264` #970); prompt mandates marker (`:245-250`); WORKED (msg 35). M3-2
`@[Full Name]` speaker rows w/ portrait chips (`markdown.js:884-909,1015-1030`).

ROOT CAUSE: prompt says speaker tags OPTIONAL ("you MAY", `momentPrompts.ts:371-382`); GLM-4.7 emitted
ZERO `@[...]` tags in 40+ replies — wrote natural **Stephanie Briggs** ... style instead. Mid-reply
`(( ))` not split (only whole-reply/leading).

FIX: (M, primary) FE fallback parser — `extractSpeakerTags` also recognizes line-leading
`**Exact Roster Name**` (roster available to transform) → same `.ow-speaker-line` machinery. No prompt
change, no golden churn, retroactive. (S) prompt MAY→ALWAYS (stales golden). Full per-register bubbles
ride `_segmentLeadingOocAside` precedent (L) — after cheap wins.

## 5. MULTI-CONVERSATION — recommend HIDE-NOT-COLLAPSE

Canonical binding: `orwell_game_session.py:26-142` (one `{user:session_id}`, first-writer-wins);
`_resolve_canonical_session` (`chat_helpers.py:4952-4979`) converges tabs ONLY once started; casting
per-tab by design (#1086). Mirror = ONE id, two windows (ADR 0012). True collapse breaks 5 seams: casting
per-tab (#1086), pre-bind second-tab (#987), per-season fresh-row history (M1-7/E65), delete-must-unbind
(#1085), resume/mirror live-binding — all under F1-F5.

SAFE VERSION (M, UI): game build auto-selects canonical session, hides session list + new-chat behind
"Past seasons" drawer; substrate untouched; restarts present as "New season". + complaint-1 rename =
kills the whole confusion, ~zero invariant risk.

## 6. RED ALARMS — mixed; the mix was itself the bug

Emitters: `_faith_check` `agent_loop.py:2997-3150` (`faith:<dim>` = DETECTED slips `:3084-3088`,
`faith:<lever>:<dim>` = corrections `:3135-3138`, `faith:call-failed` = real guard-down `:3067`).
`_compute_alarms` `admin_health_routes.py:1417+`.

14 of 15 = guard WORKING (10 real slips caught: 6 leaks, 4 board contradictions). 1 real guard-down:
judge timeout 12,001ms logged `ok:true` empty (rec 132 @03:20:04) — nothing intercepted that turn.

11 desyncs = REAL DEFECT CHAIN: un-retried `advanceGame` `StaleBeatError` (@03:00:42) → beat never
advanced → ENGINE SAT IN phase:premiere ALL SESSION while narrator ran a FABRICATED HOH COMPETITION
(msgs 52-55 "Jasmine's winning wall", `toolsCalled:[]`) → 8 board desyncs + 3 `recordInteraction` folds
DROPPED on stale-409s (the A-S3 latent).

rc1/rc2 (#1664) VERIFIED-FIXED-IN-SOURCE: S1a stale-409'd `advanceGame` re-fires once (idempotent); S1b
lull-independent escalation forces `tool_choice=advanceGame`; S2b judge fails CLOSED on timeout w/
ungrounded closed-set claim (`_faith_guard_down_p0` `agent_loop.py:2939-2994`); S2a/S7
`enforce_grounded_draft` in-turn block→re-prompt→replace + pre-ceremony board-absence cut
(`_unbacked_outcome_absent`). rc6 (#1663): truthful ok/failClass; counts `recordInteraction` stales;
`sync:dropped-fold` alarm @1; S6d splits guard-down vs corrected-slip alarm. ALL NEEDS-LIVE-VERIFY (gates
stub the LLM; fault paths never exercised vs live GLM). Caveat: #1664 says "STALES GOLDEN: yes" but
fixture last commit 943b06b6 (pre-rc) — green because wire directives are fault-path-only; first live
fault-path replay unproven.

## Five-for-ship (ranked)

1. Question-sailing prompt mandate + faith:pacing (S + golden re-record)
2. LIVE-VERIFY rc1/rc2 progression+interdiction chain vs live GLM (the fabricated-HOH class is the
   game-breaker)
3. Speaker-chip fallback parser for natural **Name** style (M, no golden churn)
4. Rename-on-season-start + hide session machinery (S+M)
5. Casting finalize resilience: premiere-cue refire + production-hold beat (S/M)
