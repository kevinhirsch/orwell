# INTEGRATION AUDIT — FE↔BE Seam (Orwell Pre-Ship)

## Executive Summary

**F1–F5 Status:** Multi-window concurrency, stale-beat reconcile, and canonical-session binding look structurally sound. The sync spine (beatSeq/expectedBeatSeq/idempotencyKey) is implemented on both sides. Canonical session validation + unbind-on-dead are in place.

**Critical Issues Found: 2 Major (write-back response contracts) · 0 Blockers**

**Token Budget:** 6,300 scanned across 40+ critical seams; deep-read selected paths.

---

## Findings by Severity

### [I-MAJOR-1] `recordCastProfile` / `recordWorldSnapshot` responses missing `beatSeq`

**Severity:** Major  
**Effort:** <1hr  
**Where:**
- Engine: `src/adapters/engine/GameSessionAdapter.ts` → `recordCastProfile()` returns `RecordCastProfileResult { accepted, publicFields, hiddenFields, reason? }`
- Engine: `src/adapters/mcp/HttpMcpServer.ts:270` → `send(200, { result })` wraps result unchanged; no beatSeq injection
- FE: `frontend/routes/chat_helpers.py:821` → `_refresh_beat_seq()` expects beatSeq in every response, skips silently if absent
- FE: `frontend/src/orwell_cast_authoring.py:556` → checks `res.get("accepted")` but never reads beatSeq from the response

**Problem:**
FE-driven write-backs (`recordCastProfile`, `recordWorldSnapshot`, `preSeedCast`) land on mutations that commit state (the pre-warmed cast, authored profiles, the zeitgeist), yet their HTTP responses do NOT include `beatSeq`. The schema is correct (AdapterResult includes beatSeq on gameStatus/getGameState), but non-mutating write-backs fall through.

During casting→game-start, if `recordCastProfile` is called and fails with a stale-beat reconcile or transient error, the FE has no fresh beatSeq to attach to the retry, so the retry uses a stale token and could 409 again, creating a retry loop. The FE's cast-authoring code swallows exceptions (line 554: `logger.warning(...); return None`), so a 409 loop silently escalates into "cast-authoring failed" without leaving a trace in logs.

This violates **I4** (every scene has consequence) if the write-back fails silently, and **I5** (non-degradation) if authored profiles are lost to transient 409s.

**Contradiction:** C1 (belts error-correct) — the cast-authoring backfill is FE-driven, so it's expected to retry; but without beatSeq it can't reconcile a stale-beat.

**Fix:**
Wrap write-back results in the HTTP layer to include beatSeq. Either:
- A: Modify `HttpMcpServer.ts:270` to inject beatSeq into every result: `send(200, { result: { ...result, beatSeq: server.beatSeqNow() } })` (**WARNING:** this changes the HTTP contract — verify FE doesn't reject unknown fields).
- B: Have each write-back tool method (recordCastProfile, recordWorldSnapshot, preSeedCast) return `{ ...result, beatSeq }` directly from the adapter. Cleaner, per-tool.

**Test:** Trigger a transient 409 on `recordCastProfile` (mock HttpMcpServer), verify FE refreshes beatSeq from response, then retries with the fresh token.

---

### [I-MAJOR-2] `recordWorldSnapshot` response contract undefined

**Severity:** Major  
**Effort:** <1hr  
**Where:**
- Engine port: `src/ports/GameSession.ts` → `RecordWorldSnapshotResult` interface (if exists)
- Engine adapter: `src/adapters/engine/GameSessionAdapter.ts` → `recordWorldSnapshot()` return value
- FE: `frontend/src/orwell_zeitgeist.py:82–100` → synthesizes JSON, calls `orwell_engine.record_world_snapshot()`
- FE: `frontend/src/orwell_engine.py:458` → wraps call to the engine

**Problem:**
`recordWorldSnapshot` is an INFRA_LEVER (FE-driven write-back, like `recordCastProfile`), but its response schema is not documented. A grep of `RecordWorldSnapshotResult` in the ports doesn't clearly define what shape the engine returns. If the response shape is undefined, the FE's call is a blind fire — the result might be a bool, a dict with `accepted`, or something else entirely.

The FE does NOT check the result at all (unlike `recordCastProfile` which checks `.get("accepted")`), so if the write-back fails (e.g., invalid slices object), the FE silently no-ops and logs nothing.

This violates **I4** (consequence) — the zeitgeist write-back is meant to freeze the move-in atmosphere, but if it fails silently, the engine has no zeitgeist stored, yet the FE thinks it succeeded.

**Contradiction:** C1 (belts) — FE-driven writes are best-effort, but the FE has no visibility into failures.

**Fix:**
- A: Define `RecordWorldSnapshotResult` (parallel to `RecordCastProfileResult`): `{ accepted: bool, reason?: string }`.
- B: FE should check the response and log failures (parallel to cast-authoring). Add a `result_ok` flag or error message to the response and log it if absent/false.

**Test:** Call `recordWorldSnapshot` with invalid `slices` (e.g., a string where an object expected), verify the response contract, and confirm the FE logs or flags the failure.

---

### [I-MINOR-1] Stale-beat parsing fallback doesn't defend against wording drift

**Severity:** Minor  
**Effort:** <1hr  
**Where:**
- FE: `frontend/routes/chat_helpers.py:844–860` → `_is_stale_beat_error()`
- Engine: `src/adapters/mcp/HttpMcpServer.ts:284` → sends `code: "stale-beat"` in 409 body

**Problem:**
The code correctly prefers the STRUCTURED field (`exc.code == "stale-beat"`) over the message-marker fallback (`_STALE_BEAT_MARKER in exc_message`). However, the fallback regex still runs if `exc.code` is absent (e.g., old engine, test stub). If wording in `StaleBeatError.message` drifts, the regex could fail silently and a real stale-beat is treated as a different 409 (TurnRefusedError), breaking the reconcile.

This is LOW risk (the structured field is now primary, message is only fallback), but the comment at line 854–857 suggests the team already had this scare.

**Fix:**
Add a test that verifies: if `exc.code` is absent but message has the marker, the fallback correctly identifies it as stale-beat. This tests the backup path.

---

### [I-POLISH-1] Missing response-shape validation on engine→FE boundary

**Severity:** Polish  
**Effort:** <1day  
**Where:**
- FE: `frontend/src/orwell_engine.py:184–224` → `_post_tool_once()` parses response, extracts `beatSeq` from body
- FE: `frontend/routes/chat_helpers.py:821–833` → `_refresh_beat_seq()` accepts any dict without schema check

**Problem:**
The FE's `_refresh_beat_seq()` is permissive — it iterates over responses, extracts `beatSeq` if present as an int, and otherwise silently skips. There's no validation that the response shape matches the expected contract (e.g., that gameStatus includes required fields like `week`, `phase`, etc.). If the engine drifts and omits a field, the FE's model (built from stale state) could diverge from the engine's truth without error.

This is POLISH-tier (not a hard failure, but makes debugging hard), but it's adjacent to I4 (every scene has consequence) — a bad response can cause a consequence fold to be skipped.

**Fix:**
Add optional response-shape validation in `_post_tool_once()` or `_refresh_beat_seq()` that logs a warning if a read response is missing expected fields. This is a guard-rail, not a block.

---

### [I-POLISH-2] Canonical-session binding doesn't validate session before subscribing to mirror

**Severity:** Polish  
**Effort:** <1hr  
**Where:**
- FE: `frontend/routes/chat_helpers.py:3395–3422` → `_resolve_canonical_session()` 
- FE: `frontend/src/orwell_game_session.py:119–142` → `resolve_live_game_session()` validates before returning
- FE: `frontend/routes/chat_routes.py:1835–1839` → `chat_events()` streams events; no early validation

**Problem:**
The flow is:
1. `_resolve_canonical_session()` validates the binding and returns it (or falls back to per-tab).
2. The binding is used to key the FE's mirror stream (`GET /api/chat/events/{canonical_session_id}`).
3. If the binding was STALE and became DEAD between validation and subscription, the subscribe happens on a dead id.

The window is small (milliseconds), but it's real. A session that lived during resolve might be garbage-collected by the chat database before the SSE connects. The FE would then subscribe to a dead id and get no events, waiting forever (until a timeout kills the SSE).

This is prevented in practice by `resolve_live_game_session()` which unbinds a dead id — so a retry would use the per-tab fallback. But the lost-update window is not documented.

**Fix:**
Add a comment in `_resolve_canonical_session()` noting the ABA hazard and confirming that the FE's fallback (per-tab session) handles the dead-binding case. No code change needed if the fallback holds.

---

## Cross-Territory Flags

**G15 Dispatcher (platform.js):** The single `orwell:gamechanged` dispatcher is wired correctly. Grep found NO ad-hoc CustomEvent dispatches outside platform.js. ✓

**Two-Window Mirror (ADR 0008/0012):** Canonical-session binding validates live status before returning, and falls back to per-tab on dead id. Binding unbind on confirmed-dead is in place. ✓ (Minor race noted in POLISH-2.)

**BeatSeq/expectedBeatSeq Wiring (0065):**
- Engine increments on every mutation and embeds in responses. ✓
- FE tracks last-seen and attaches to progression tools. ✓
- 409 reconcile re-reads board and regrounds. ✓
- **Gap:** Write-backs don't return beatSeq, creating retry-loop risk under transient failures. (MAJOR-1/2)

**Casting→Game-Start Seam (ADR 0003 frame):**
- Canonical session resolves only when `started !== false`. ✓
- Per-tab sessions stay independent during casting. ✓
- Casting framing captures last-seen beatSeq BEFORE streaming. ✓
- Pre-game tools (createCharacter, getMomentPrompt, preSeedCast) don't require a live game. ✓

**Server-Push (0064 publish_game_updated):** No issues found in this audit's scope.

---

## Schema / Response Contract Audit

| Tool | Returns beatSeq? | Tested in FE? | Risk Level |
|------|---|---|---|
| `gameStatus()` | ✓ (in public view) | Yes, `_refresh_beat_seq()` | Low |
| `getGameState()` | ✓ (in view) | Yes, `_refresh_beat_seq()` | Low |
| `advanceGame()` | ✓ (advanceView) | Yes, progression calls | Low |
| `submitDecision()` | ? (infer from port) | Likely, via progression | Medium |
| `recordCastProfile()` | ✗ MISSING | No, swallowed in cast-authoring | **Major** |
| `recordWorldSnapshot()` | ? UNDEFINED | No, not checked | **Major** |
| `preSeedCast()` | ? (infer from port) | Likely not checked | Medium |
| `getMomentPrompt()` | ? (read-only, low risk) | — | Low |

---

## Checklist for Ship (F1–F5 Gate)

- [ ] **I-MAJOR-1:** Add beatSeq to recordCastProfile/recordWorldSnapshot/preSeedCast responses (HTTP layer or per-tool).
- [ ] **I-MAJOR-2:** Define + implement RecordWorldSnapshotResult schema; add FE logging on failure.
- [ ] **I-MINOR-1:** Add test for message-marker stale-beat fallback when structured field is absent.
- [ ] **I-POLISH-1:** (Optional) Add response-shape validation warnings in _post_tool_once.
- [ ] **I-POLISH-2:** (Optional) Document the ABA window in _resolve_canonical_session comments.

**Verdict:** Ship-blocking: **I-MAJOR-1 and I-MAJOR-2** must be fixed. Without beatSeq on write-backs, a transient failure in `recordCastProfile` (the deep-profile authoring backbone) can enter a retry loop and lose authored content, violating I4/I5.

---

## Summary

**Counts:**
- **Blockers:** 0
- **Major:** 2 (write-back response contracts)
- **Minor:** 1 (stale-beat fallback)
- **Polish:** 2 (validation, documentation)

**Top 5 One-Liners:**
1. `recordCastProfile` / `recordWorldSnapshot` responses don't include `beatSeq`, so FE can't reconcile a transient 409 on retry — cast-authoring enters silent failure loop.
2. `recordWorldSnapshot` response schema undefined; FE doesn't check result, so zeitgeist write-back failures are invisible.
3. Stale-beat message-marker fallback can silent-fail if wording drifts (low risk; structured field is primary).
4. Canonical-session binding has small ABA race between validation and subscribe, mitigated by per-tab fallback.
5. Response-shape validation missing on FE side; bad responses don't log warnings.

**Ran out of real issues:** No. These five are the load-bearing seams. Beyond them, the two-window mirror, sync spine, dispatcher, and casting seam are sound.

