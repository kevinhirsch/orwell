# 2026-06-21 — Mirror-D harness: live two-window verification + I/O-logging audit

**Scope.** A repeatable harness that opens **two browser windows on the SAME game**, drives a live
turn, and captures — per window, timestamp-aligned — (a) the streamed SSE token timeline and (b) a
DOM filmstrip, so the two windows' transcripts can be **diffed for byte-identical lockstep** (the
"Messenger mirror" invariant). Plus a **50× concurrent smoke loop**. Plus a report-only audit of
**LLM I/O logging completeness** (`src/llm_trace.py`).

This is a DOC-ONLY / harness-only deliverable. No application code was edited. All scripts live under
`docs/audits/playtest-harness/`. Roles only; no game-entity names.

---

## 1. The harness

| File | Role |
|---|---|
| `playtest-harness/mirrorlib.mjs` | Shared lib: the in-page **fetch-tee + MutationObserver tap** (`MIRROR_TAP`, injected via `addInitScript` BEFORE any app JS), window lifecycle, settled-transcript reader, and the **divergence diff** (`diffTranscripts`). Reuses `rig.mjs` for context/auth/engine-snapshot. |
| `playtest-harness/mirror_filmstrip.mjs` | **Single run.** Two windows on one game; sends ONE turn from A (B is the passive mirror); records both windows' SSE timelines + DOM filmstrips to JSON; emits a **diff report** (byte-identical? first divergence with message-index + char-offset + timestamps?). On divergence, **reloads B to classify** the divergence as TRANSIENT (render-layer; reload reconciles) vs PERSISTENT (data-layer). |
| `playtest-harness/mirror_smoke50.mjs` | **50× concurrent loop.** Both windows act near-simultaneously each iteration; asserts engine-converged + transcript-byte-identical + no JS error + no unrecovered 409; aggregates pass/fail; on the FIRST divergence dumps that iteration's full filmstrip + SSE timeline for both windows. **Exits non-zero if any iteration diverges.** |
| `playtest-harness/fake_model_server.mjs` | **Stub-mode validation aid** (not the real audit path): a tiny OpenAI-compatible **streaming echo** server so `/api/chat_stream` produces real SSE deltas (reply + reasoning + usage + a terminal `finish_reason`) without a live key. Output is deterministic echo text, never real narration. |

### What the two capture rails record (both on a shared `Date.now()` wall clock)

- **(a) SSE token timeline** — the fetch tee clones the `/api/chat_stream` `ReadableStream` (app sees
  bytes UNCHANGED) and parses every `data:` line into `__mirror.sse[]`:
  `{ t, wall, kind, delta, thinking, type, tool, round, reason, raw }`. `kind` splits the channels:
  `reply` (delta, thinking falsy), `reasoning` (delta, thinking truthy), the typed events
  (`tool_start`/`tool_output`/`agent_step`/`metrics`/`finish`/`model_info`/`message_saved`), `done`,
  `eof`. So the harness reconstructs exactly what streamed and when.
- **(b) DOM filmstrip** — a `MutationObserver` on `#chat-history` (re-targets once the SPA mounts it)
  logs `mount`/`unmount`/`char` mutations into `__mirror.film[]`, each timestamped, so the two
  windows' render timelines align frame-for-frame.

### The diff (the mirror invariant)

`transcriptOf(page)` reads the **settled** rendered transcript per message
(`{i, cls, id, text}`, reasoning/footer/role chrome stripped — those are per-window UI, not the shared
transcript). `diffTranscripts(A, B)` returns `identical` or the **first divergence**: message index,
the two `msg-*` class strings, the intra-message char offset, and a ±context window. It works
identically on live narration, stub echo, error text, or a "no model" notice — the divergence logic
never depends on the text being real.

---

## 2. How to run

### Env contract (NEVER hardcode a key; never write a key to a tracked file)

| Var | Meaning |
|---|---|
| `ORWELL_TEST_OPENROUTER_KEY` | The provider API key for the LIVE audit. Exported by the operator at run time; the harness reads it from ENV only. **Not consumed by the scripts directly** — it is wired into the FE via `POST /api/model-endpoints` (`base_url`+`api_key`) then `default_model`/`default_endpoint_id` (see below). |
| `ORWELL_TEST_MODEL` | e.g. `deepseek/deepseek-v4-pro` — the live model id, recorded into the report meta. |
| `BASE_URL` | FE base (default `http://127.0.0.1:7000`). |
| `ENGINE_URL` | Engine base (default `http://127.0.0.1:8765`). |
| `MIRROR_TURN` | (filmstrip) the turn text to send from A. |
| `MIRROR_N` | (smoke50) iteration count, default 50. |
| `MIRROR_SYNC_WAIT_MS` | per-turn cross-tab sync settle budget. |

### Boot the stack (two processes + optional stub model)

```bash
# 1. engine (HTTP MCP, port 8765)
cd /home/user/orwell
npm run build
ORWELL_ENGINE_PORT=8765 ORWELL_DATA_DIR=/tmp/mirror-engine-data node dist/main.js &

# 2. front-end (port 7000), auth disabled, pointed at the engine
cd frontend
ORWELL_ENGINE_MCP_URL=http://127.0.0.1:8765 AUTH_ENABLED=false LOCALHOST_BYPASS=true \
  DATA_DIR=/tmp/mirror-fe-data .venv/bin/python -m uvicorn app:app --host 127.0.0.1 --port 7000 &
```

**LIVE key path** (the real audit). With the key exported, register the provider + set defaults:

```bash
curl -s -X POST http://127.0.0.1:7000/api/model-endpoints \
  -F "base_url=https://openrouter.ai/api/v1" -F "name=live" \
  -F "api_key=$ORWELL_TEST_OPENROUTER_KEY" -F "endpoint_kind=api"
# then set default_model=$ORWELL_TEST_MODEL + default_endpoint_id=<returned id> in
# frontend/data (settings.json) — or rely on first-endpoint auto-default. Confirm:
curl -s http://127.0.0.1:7000/api/default-chat
```

**STUB path** (no key — validates the harness mechanics):

```bash
node docs/audits/playtest-harness/fake_model_server.mjs &           # :8011, OpenAI-compatible echo
curl -s -X POST http://127.0.0.1:7000/api/model-endpoints \
  -F "base_url=http://127.0.0.1:8011/v1" -F "name=fake-echo" -F "endpoint_kind=api"
# first endpoint auto-becomes the default; confirm with /api/default-chat
```

### Run

```bash
node docs/audits/playtest-harness/mirror_filmstrip.mjs        # single run + diff report
MIRROR_N=50 node docs/audits/playtest-harness/mirror_smoke50.mjs   # 50× concurrent loop
```

### Reading the output

- `shots/mirror/mirror-report.json` — the single-run report: `cp0_baseline`, `cp1_afterTurn`
  (`transcriptIdentical`, `firstDivergence`, `reloadReconcile.classification`), `sseTimeline.{A,B}`
  (`byKind`, `finishReasons`, `tools`, first/last wall ms), `filmstrip.{A,B}`, `jsErrors`, `net`.
  Plus full `sse-{A,B}.json`, `film-{A,B}.json`, `transcript-{A,B}.json`, and `A/B.png`.
- Console verdict prints `transcript identical: <bool>`, the first divergence (message index + char
  offset + ±context), the A-vs-B last-mutation wall times (timestamp alignment), and — on divergence
  — the TRANSIENT/PERSISTENT classification from the B reload.
- `shots/mirror50/smoke50.json` — `{N, problems, byKind:{engineDiverged, transcriptDiverged,
  jsErrors, unrecovered409}, results[]}`. Each diverging iteration also writes
  `shots/mirror50/diverge-it<N>/` with `diff.json`, both transcripts, both SSE timelines, both
  filmstrips, and both screenshots. Exit code is non-zero iff any iteration diverged.

---

## 3. Stub-mode validation result (no live key)

Booted the stack with the deterministic engine (`embeddings: deterministic`, `EchoNarrativePort`)
and the `fake_model_server.mjs` echo endpoint. Confirmed the harness drives a turn and captures both
windows' rails end-to-end, and that the divergence diff works on stubbed text.

| Assertion | Result | Requires live key? |
|---|---|---|
| Two windows open on one game; A sends a turn through the real composer | PASS | no |
| **SSE token timeline captured** (fetch tee) — A: 29 SSE events, `reply`+`reasoning` channels split (reply=105 ch, reasoning=113 ch) | PASS | no |
| **DOM filmstrip captured** — A: 36 mounts / 28 unmounts under `#chat-history` during stream | PASS | no |
| **Divergence diff fires** — on the welcome/empty state the diff correctly reported `msgs A=2 B=0` with the exact first-divergence record (message-count mismatch, full text context) | PASS | no |
| **Lockstep detected** — on the established-session re-run the diff reported `transcript identical: true (msgs A=4 B=4)`, engine converged (beat 2/2), B settled via sync | PASS | no |
| **Reload-reconcile classification** — B reload path exercised and labels TRANSIENT vs PERSISTENT | PASS | no |
| `finish_reason` (truncation) surfaced end-to-end — `FAKE_FINISH=length` proves the FE finish event path | PARTIAL — see §4 gap (the FE emits it but the TRACE drops it) | no |
| **Real narration** lockstep / faithfulness under a frontier model | NOT RUN | **yes** |
| **Concurrent two-window loop** (`mirror_smoke50.mjs`) — both windows act near-simultaneously, asserts engine-converged + transcript-identical + no 409 + no JS error | PASS at N=2 on the stub: both iterations CLEAN (`transcriptIdentical=true`, msgs 8/8 then 12/12, engine beat 2/2, 0 errors, 0 stale-409, exit 0) | partial (stub exercises the merge/sync code; real latency needs the key) |
| **Full N=50** concurrent parity under real model latency/variance | NOT RUN at N=50 (validated at N=2 on the stub) | yes (run with the live key for the authoritative divergence rate) |

**Captured behavior worth flagging** (the harness doing its job, not a harness bug): on the
**pre-game welcome state**, the passive mirror window B did **not** reflect A's first turn until it
re-loaded — engine state was identical across windows (`beatSeq` 2/2) but the rendered chat
transcript diverged (`A=2/4 msgs, B=0`). This is a **render-layer** gap (engine + persisted convo
intact; the live cross-tab CHAT-history merge lags in the welcome state), exactly the
TRANSIENT class the reload-reconcile step is built to name. Once the session was established, the
re-run came out byte-identical. The smoke50 loop is the tool to measure how often the concurrent
case diverges; run it at N=50 with the live key for the authoritative rate.

---

## 4. I/O-logging completeness audit (REPORT ONLY — `src/llm_trace.py`)

Owner directive: *"preserve ALL I/O in the logfiles — and I mean all."* Trace path: every model call
through the two chokepoints in `src/llm_core.py` is recorded by `llm_trace.record_llm_call`, sinking
to `data/llm-io.jsonl` (durable) + the `log_rings.LLMIO` ring (the /admin/status tail).

**What IS lossless** (verified empirically against 18 trace records from a driven turn): the
**request** carries the full `messages` (system + every turn) and the full `tools` schema array
(n=28 captured), `temperature`, `maxTokens`, `model`, `requestedModel`. The **streaming response**
(`kind:"stream"`, the chat/agent path) captures `text`, `reasoning` (17/17 records), `toolCalls`,
`usage` (17/17), `answeredBy`, `error`. The durable file is full-fidelity (the ring is the clipped
view). So for the primary narration path, content + reasoning + tools + usage are all preserved.

**Gaps found** (each a place trace capture is NOT lossless — file:line for the lead to fix):

| # | Gap | Location | Detail |
|---|---|---|---|
| G1 | **Mid-stream `finish_reason` is dropped.** `stream_llm` emits `data: {"type":"finish","reason":"length"}` before `[DONE]` (the truncation/cutoff signal), but `StreamAccumulator.observe()` has no `type=="finish"` branch, so it never reaches the record. **Verified: 0/18 records carry any finish field**, even with `FAKE_FINISH=length`. | `src/llm_trace.py:152-186` (`observe` — handles `tool_calls`/`usage`/`fallback`/`delta`, not `finish`); emitted at `src/llm_core.py:1773-1774`. | The owner's explicit "all in/out" misses *why a reply stopped* — the single most diagnostic field for truncation/verbosity-overflow bugs. Add a `finish` branch (set `self.finish_reason`) and surface it in `response()` + `record_llm_call`. |
| G2 | **Non-streaming utility calls capture TEXT ONLY — no reasoning, usage only when metered.** `_llm_call_async_impl` returns a bare string, so the `kind:"call"` record's response is `{"text": ..., "usage": _usage or None}`. The provider's `reasoning_content`/`reasoning` (which the impl *reads* but discards) is never traced, and `usage` is `None` unless the caller passed `call_class`+`user`. **Verified: the 1 `call` record had `usage:null`.** | `src/llm_core.py:1281-1284` (record uses `{"text": text, ...}`); reasoning read+dropped at `src/llm_core.py:404-406`. | Utility/extraction/background-authoring calls (casting profile, scene extraction, zeitgeist) leave their reasoning + token cost untraced. To be lossless, `_llm_call_async_impl` must return (text, reasoning, usage) and the wrapper record all three. |
| G3 | **Per-record hard size cap silently replaces the record with a stub.** A record whose JSON line exceeds `_MAX_RECORD_BYTES` (512 KB) is rewritten to `{"request":{"truncated":true,...},"response":{"truncated":true}}` — the entire request+response is **discarded**, not field-trimmed. | `src/llm_trace.py:77` (`_MAX_RECORD_BYTES`), `:302-310` (`_append_trace_file`). | A long system prompt + large tool schema + long reasoning can exceed 512 KB and vanish wholesale. The comment says "trim the heaviest fields rather than drop the record," but it drops BOTH whole fields. For "all I/O," either raise/remove the cap or trim only the largest single field and keep the rest. |
| G4 | **Trace is gate-able OFF and ON by default-but-toggleable.** `enabled()` reads `llm_trace_enabled` (default True) — an admin can disable it, after which `record_llm_call` is a near-zero passthrough and **nothing** is written. | `src/llm_trace.py:80-85`, `:237-238`; setting default `src/settings.py:224`. | Not a bug, but "preserve ALL I/O" is only true while the toggle is on. If the directive means *always*, the off-switch should be removed or the default made non-overridable. (Flagging per the directive; lead's call.) |
| G5 | **Retention auto-trims by horizon (default 7 days).** Records older than `log_retention_days` (default 7) are deleted by `_maybe_auto_trim`/`trim_logs`. | `src/llm_trace.py:74` (`_DEFAULT_RETENTION_DAYS=7`), `:415-443`, `:455-468`. | "Archive it off after a period" is the intended behavior, so this is by design — but it means I/O is preserved only for the horizon. If "all" means "forever," set the default to `0` (keep everything). Flagging for the owner's horizon decision. |
| G6 | **No turn-correlation id across the multi-call agent loop.** One player turn drives N model calls (one per tool round — `stream_agent_loop` calls `stream_llm_with_fallback` per round). Each is traced as an independent record with no shared turn/round id, and the FE-orchestrated events between calls (`agent_step`, `tool_start`/`tool_output`) are **not** in the trace at all (they never pass through `stream_llm`). | `src/agent_loop.py:3139` (per-round call); `agent_step`/tool events emitted in `agent_loop.py` (e.g. `:3497`, `:2603-2605`) outside any traced call. | The trace has the raw model I/O but not the loop's decision boundaries, so reconstructing "what the turn actually did" from the log requires guessing which records belong together. To make the turn replayable from logs, add a correlation id (and optionally a lightweight loop-event record). |

**Net:** the streaming narration path is close to lossless for content/reasoning/tools/usage. The
clear must-fix for the owner's "all I/O" bar is **G1 (finish_reason)** and **G2 (utility-call
reasoning + usage)**; **G3 (512 KB whole-record drop)** is the silent data-loss footgun;
**G4/G5/G6** are policy/structure decisions for the owner.

---

## 5. Limitations / notes

- `ffmpeg` is absent on this host, so the harness uses the **SSE timeline + DOM MutationObserver
  filmstrip** (not a video filmstrip) — this is strictly higher-fidelity for the byte-diff goal
  (every delta + every mutation, vs sampled frames) and needs no external binary.
- The stub `fake_model_server.mjs` does not exercise tool-calling round-trips (it returns plain
  content). The live model will drive the multi-round agent loop; the SSE tap already records
  `tool_start`/`tool_output`/`agent_step` when they occur.
- The harness drives turns through the **real composer** (`#message` + send button / Enter), not an
  API shortcut, so it exercises the genuine player path.
