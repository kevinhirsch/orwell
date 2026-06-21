# OpenRouter / DeepSeek HTTP Conformance Audit — 2026-06-21

**Scope:** the Orwell front-end's OpenRouter/DeepSeek chat-completions integration, audited
for conformance against four OpenRouter API reference docs (Parameters, Errors & Debugging,
Streaming, Embeddings). **Read-only / DOC-ONLY** — no code changed.

**Live path under audit:** DeepSeek V4 Pro **streaming narration** + non-streaming
**utility/JSON extraction** via OpenRouter `POST /chat/completions`. The single LLM HTTP
boundary is `frontend/src/llm_core.py`; the streaming agent loop that consumes it is
`frontend/src/agent_loop.py`.

**Primary files inspected**
- `frontend/src/llm_core.py` — HTTP client, provider detection, payload builders, SSE parse loop, error/retry, usage capture.
- `frontend/src/agent_loop.py` — `stream_agent_loop` consumption of the SSE protocol, finish/error handling.
- `frontend/src/token_policy.py` — reasoning-budget resolver (the `reasoning` map source).
- `frontend/src/orwell_token_ledger.py`, `frontend/src/llm_trace.py` — usage/cost capture.
- `frontend/src/orwell_engine.py` — engine tool 409/stale-beat (separate from OpenRouter; noted for the error-handling contrast).
- `frontend/src/embeddings.py` (+ `rag_vector.py` / `memory_vector.py` / `embedding_lanes.py`) — embeddings subsystem.

---

## Executive summary

The integration is a **deliberately minimal** OpenAI-compatible client: it sends only
`model` / `messages` / `temperature` / `stream` (+ `reasoning`, `usage`, `provider`,
`max_tokens`, `tools`, `user`) and recovers structured output by **prompting + post-hoc JSON
parsing**, never by `response_format`. Within that surface the **reasoning map, usage/cost
capture, the `: OPENROUTER PROCESSING` keep-alive, the SSE `[DONE]` sentinel, and `data:`
no-space tolerance are all handled correctly.** The conformance risk is concentrated in
**error handling on the streaming path**, which is the live narration path.

**Tally (against the four docs, scoring only what the live path exercises):**

- **3 SUPPORTED-clean live-path-critical items:** the `reasoning` map (enabled:false / effort + multi-field readback), the `: OPENROUTER PROCESSING` keep-alive skip, usage/cost/cached/reasoning-token capture from the trailing chunk.
- **3 MISSING-that-matter (release-relevant):**
  1. **Mid-stream in-band SSE `error` chunk with `finish_reason:"error"` is not detected** on the OpenAI-compatible path — the live "text streams then disappears / turn ends blank with no error" symptom.
  2. **`Retry-After` (429/503) is ignored** — backoff is a fixed 0.5 s.
  3. **Typed moderation / guardrail / content-policy / provider errors are flattened** to a generic message; the structured `error.metadata` (reasons, flagged_input, provider_name, error_type) is dropped, so the player sees an opaque failure.
- **Several MISSING-but-NOTE (not exercised by the live path):** `debug:{echo_upstream_body}` (diagnostic only), `X-Generation-Id` capture, and the full parameter set (`top_p`/`top_k`/`seed`/`response_format`/`stop`/`tool_choice`/`parallel_tool_calls`/penalties/`min_p`/`logit_bias`/`logprobs`/`web_search_options`/`verbosity`) — the FE intentionally never sends these.
- **Embeddings: N/A** — intentionally local fastembed ONNX (ADR 0004); no FE code path calls OpenRouter `/embeddings`.

The headline: the engine and the happy path are conformant; the **streaming error contract is
the gap**, and item (1) is the one most likely to be the reported "generates then disappears."

---

## Doc 1 — Parameters (`/parameters`)

The OpenAI-compatible **streaming** payload is built at `llm_core.py:1462-1505`; the
**non-streaming** payload at `llm_core.py:1327-1348` (async) and `llm_core.py:1090-1104` (sync).

| Capability | Status | Evidence (file:line) | Notes / Gap |
|---|---|---|---|
| `temperature` | SUPPORTED | `llm_core.py:1467`, `:1336`, `:1098` | Always sent; popped for OpenAI fixed-temp models (`:1470`, `:1338`). Not clamped for OpenAI 0–2 range (fine for DeepSeek). |
| `max_tokens` / `max_completion_tokens` | SUPPORTED | `llm_core.py:1497-1499`, `:1346-1348`, `:1102-1104` | Correct key switch via `_uses_max_completion_tokens` (`:551`). DeepSeek gets `max_tokens`. |
| `reasoning` map (enabled / effort / max_tokens / exclude) | PARTIAL | `_apply_reasoning_budget` `llm_core.py:585-622`; resolver `token_policy.py:58-62, 90-99` | **enabled:false** and **{"effort": …}** are both sent correctly to OpenRouter. **`max_tokens` and `exclude` sub-keys are never emitted** — only `effort`/`enabled`. Not needed by the current call classes, so NOTE not defect. |
| `reasoning_effort` enum | PARTIAL | `token_policy.py:33-47` (`off/low/medium/high`); `llm_core.py:603, 620` | FE uses only `low/medium/high` (+ off). The doc enum adds `xhigh / minimal / none`; FE never offers those. For OpenRouter the map form is used, not the bare `reasoning_effort` field (that field is sent only on the OpenAI o-series path, `:619-620`). Acceptable for DeepSeek; the missing enum values are unused. |
| `tools` | SUPPORTED | `llm_core.py:1500-1501`; tool-call accumulation `:1902-1951` | Native tool calls accumulated across chunks, index-collision-hardened. |
| `tool_choice` | MISSING (NOTE) | — | Never sent. FE relies on the model choosing tools + an FE error-correction loop (CLAUDE.md `_auto_record_scene` / stall-nudge). Not a live-path defect — the design deliberately doesn't force tool choice. |
| `parallel_tool_calls` | MISSING (NOTE) | — | Never sent; provider default applies. Parallel calls are still parsed (`:1906-1924`). No impact. |
| `response_format` (json_object / json_schema structured outputs) | MISSING (NOTE, but consequential) | extraction via prompt + `agent_loop.py:1591` `_last_json_object_with_key`, `deep_research.py:864` `_parse_json_object` | The FE extracts JSON by **prompting for it and parsing the text**, never by `response_format`. This is robust to providers that don't support JSON mode, but it forgoes a guarantee OpenRouter+DeepSeek **do** support. See "Gaps that matter" #4 — adopting `response_format:{type:"json_object"}` on utility-extraction calls would harden the consequence-loop extraction that CLAUDE.md flags as failure-prone (`auto-record: no parseable JSON`). |
| `stop` | MISSING (NOTE) | — | Never sent. Not needed; the model stops naturally / on tool calls. |
| `seed` | MISSING (NOTE) | — | LLM `seed` never sent (the `seed` hits in the tree are **game** RNG seeds, e.g. `orwell_engine.py:374`, unrelated). Determinism isn't a narration goal. |
| `top_p` / `top_k` / `frequency_penalty` / `presence_penalty` / `repetition_penalty` / `min_p` / `top_a` | MISSING (NOTE) | — | None sent; provider defaults. No preset surface wires them for the game build. |
| `logit_bias` / `logprobs` / `top_logprobs` | MISSING (NOTE) | — | Never sent / never read. Out of scope for narration. |
| `web_search_options` | MISSING (NOTE) | — | The FE owns `web_search` as its **own** tool/provider (CLAUDE.md), not via OpenRouter's `web_search_options`. Intentional. |
| `verbosity` | MISSING (NOTE) | — | Never sent. No impact. |
| `include_reasoning` (deprecated) | N/A | — | Correctly not used; FE uses the modern `reasoning` map. |
| `usage:{include:true}` | SUPPORTED | streaming `llm_core.py:1481`; non-streaming `:1344-1345` | Sent only when metering (usage_sink present) — see Doc 3 usage row. |
| `provider` routing object + `allow_fallbacks` pin | SUPPORTED | `llm_core.py:1488-1496` | Admin `provider_opts` merged; high-token pin overlays `allow_fallbacks:false`. |
| `user` (session stickiness) | SUPPORTED | `llm_core.py:1486-1487` | Canonical session id → cache-warm provider stickiness. |

---

## Doc 2 — Errors & Debugging (`/errors`)

Pre-stream HTTP errors are handled at `llm_core.py:1749-1753` (streaming) and `:1363-1372`
(non-streaming). Friendly formatting is `_format_upstream_error` (`:507-546`).

| Capability | Status | Evidence (file:line) | Notes / Gap |
|---|---|---|---|
| ErrorResponse `{error:{code,message,metadata}}` shape | PARTIAL | `_format_upstream_error` `llm_core.py:521-530` | Pulls `error.message`/`error.detail` only. **`error.code` and `error.metadata` are dropped** (moderation reasons, provider_name, raw, error_type all lost). |
| HTTP 400/401/402/403/408/429/502/503 | PARTIAL | `:532-546` | 401/403 → "rejected the API key"/"denied access"; 429 → "rate-limited"; ≥500 → "outage". **402 (payment_required) and 408 (timeout) get the generic `HTTP {status}` branch** — no payment/timeout-specific copy. Retry set is `(429,502,503,504)` (`:1369`) — **402/408/403 never retried** (correct for 402/403; 408 arguably should be). |
| **Retry-After header on 429/503** | **MISSING (matters)** | retry sleeps fixed `LLMConfig.RETRY_DELAY` at `:1370`, `:1410`, `:1416`; no `r.headers.get("retry-after")` anywhere | Backoff ignores the server's `Retry-After`. A 429 with a multi-second `Retry-After` is retried after 0.5 s and likely 429s again, burning the 3-retry budget. See "Gaps that matter" #2. |
| Moderation errors (`metadata.reasons` / `flagged_input`) | MISSING (matters) | not parsed; `_format_upstream_error` only reads `message` | A 403/400 moderation block surfaces as a generic key/access message; the player never learns the input was flagged. See "Gaps that matter" #3. |
| Guardrail 403 errors | PARTIAL | `:534` generic "denied access (403)" | Surfaced as access-denied; guardrail-specific metadata dropped. |
| Provider errors (`metadata.provider_name` / `raw`) | MISSING (NOTE→matters) | not parsed | The upstream provider name + raw body are lost; debugging a provider-specific failure relies on logs only. |
| "No content generated" / cold-start retry | PARTIAL | non-stream retries 5xx (`:1369`); **streaming has no empty-body retry** | A streaming round that yields zero content (cold start / empty completion) is **not retried** and produces a blank turn. Ties to the "disappears" symptom. |
| **Mid-stream SSE error (top-level `error` in a chunk + `choices[].finish_reason:"error"`)** | **MISSING (matters most)** | OpenAI-compat stream loop `llm_core.py:1755-1962` has **no** `j.get("error")` / `finish_reason=="error"` branch. (The `evt=="error"` handler at `:1681` is **Anthropic-only**.) `finish_reason` is captured generically at `:1769-1771` and only `"length"` is actioned (`agent_loop.py:4461`). | When OpenRouter sends an in-band error after streaming starts, the FE sets `_finish_reason="error"`, emits no delta, and ends with a normal `[DONE]` + `finish` event. The agent loop ignores `reason=="error"` (only `"length"` → `truncated`). Result: **silent truncation / blank-end with no error surfaced** — the prime suspect for "text generates then disappears." See "Gaps that matter" #1. |
| Typed `error.metadata.error_type` codes (context_length_exceeded, rate_limit_exceeded, provider_overloaded, content_policy_violation, refusal, timeout, …) | MISSING (matters) | never read on any path | Even on a pre-stream error the metadata is dropped; on a mid-stream error it isn't detected at all. No typed dispatch (e.g. context_length_exceeded → trim+retry; provider_overloaded → fallback). |
| Non-streaming partial-content error (`choices[].error` + `finish_reason:"error"`) | MISSING (NOTE) | non-stream parse `:1397-1398` reads only `message` via `_openai_message_text` | A non-stream 200 carrying a per-choice `error` would parse to empty text and `_openai_message_text` returns `""`; the embedded error is ignored. Low frequency on the non-stream utility path but unhandled. |
| `debug:{echo_upstream_body:true}` (streaming-only first-chunk echo) | MISSING (NOTE) | referenced only in a docstring `llm_core.py:599-600`; never sent | A genuinely useful diagnostic for verifying the exact upstream body (esp. the reasoning map), but **optional** — not a release gap. |
| `X-Generation-Id` response header | MISSING (NOTE) | `r.headers` never read on the chat path | Capturing it would let support correlate a failed turn with an OpenRouter generation for refunds/debugging. Optional. |

---

## Doc 3 — Streaming (`/streaming`)

OpenAI-compatible stream loop: `llm_core.py:1685-1983`. Consumed by `agent_loop.py:3140-3376`.

| Capability | Status | Evidence (file:line) | Notes / Gap |
|---|---|---|---|
| SSE `data: ` prefix parse | SUPPORTED | `llm_core.py:1762-1763` | Tolerates `data:` with **no space** (`line[5:].strip()`), per the SSE spec — a deliberate fix for gateways that omit the space. |
| `[DONE]` sentinel | SUPPORTED | `:1764-1759` | Flushes routed content, emits accumulated tool calls + `finish`, then `data: [DONE]`. Also handles end-of-stream with **no** explicit `[DONE]` (`:1964-1970`). |
| **`: OPENROUTER PROCESSING` keep-alive comment** | **SUPPORTED** | `:1755-1762` | A `:`-prefixed comment line is non-empty and doesn't `startswith("data:")`, so it falls through the only branch and is ignored — no error, no mis-parse. `httpx.aiter_lines()` frames it as its own line. Correct. |
| Usage stats in final chunk (cost / cached / reasoning tokens) | SUPPORTED | `:1797-1832`; ledger `orwell_token_ledger.py:121-139`; agent accumulation `agent_loop.py:3210-3235` | Reads `prompt_tokens`/`completion_tokens` + `prompt_tokens_details.cached_tokens` + `completion_tokens_details.reasoning_tokens` + `cost`/`cost_details`. Guards against usage-on-final-delta shapes (`:1790-1797`). Solid. |
| Reasoning-delta readback (all provider field names) | SUPPORTED | streaming `:1841` (`reasoning_content`/`reasoning`/`thinking`); non-stream `_openai_message_text` `:403-409` | Reads every variant → routed to the thinking channel (kept out of the public bubble per CLAUDE.md). |
| Stream cancellation via connection abort | PARTIAL | `agent_loop.py:3152-3154` wall-clock deadline `break`; no explicit client-disconnect abort of the upstream | The agent loop breaks on its own deadline, and `async with client.stream(...)` closes the upstream on generator GC. There is **no explicit detection of the downstream client disconnecting** to proactively abort the OpenRouter request (DeepSeek supports cancellation). Cost-leak risk on abandoned turns, but not a correctness defect. |
| Pre-stream error (status != 200 before body) | SUPPORTED | `:1749-1753` | Reads the body, formats friendly, yields `event: error`, returns. |
| Mid-stream error (after content) | MISSING (matters) | see Doc 2 mid-stream row | The in-band error chunk is not detected; see "Gaps that matter" #1. |
| `stream_options:{include_usage}` vs OpenRouter `usage:{include}` | SUPPORTED | `:1474-1481` | Correctly sends `usage:{include:true}` for OpenRouter (knows `stream_options` is a no-op there) and `stream_options` for others. |

---

## Doc 4 — Embeddings (`/embeddings`)

| Capability | Status | Evidence | Notes |
|---|---|---|---|
| `POST /embeddings`, batch input, image input, `/embeddings/models` | **N/A — intentional** | `frontend/src/embeddings.py` (+ `rag_vector.py`, `memory_vector.py`, `embedding_lanes.py`) contain **no** OpenRouter/`/chat/completions`/`base_url` reference; engine uses local fastembed ONNX per ADR 0004 | No FE code path calls OpenRouter embeddings. Correctly out of scope — **not a gap**. |

---

## Gaps that matter for release (ordered by live-path impact)

### 1. Mid-stream SSE error with `finish_reason:"error"` is undetected → silent truncation ("text generates then disappears")
**Where:** OpenAI-compatible stream loop `frontend/src/llm_core.py:1755-1962`; finish handling
`agent_loop.py:3205-3209` + `:4457-4463`.
**Symptom:** OpenRouter/DeepSeek can emit a chunk carrying a top-level `error` object with
`choices[0].finish_reason:"error"` **after** streaming has begun (e.g. provider_overloaded,
content_policy_violation, timeout). The parser captures `_finish_reason="error"` generically
(`:1769-1771`) but emits no delta and closes with a normal `[DONE]`; the agent loop only acts
on `finish_reason=="length"` (→ `truncated`), so `"error"` falls through with **no error event
and no Continue affordance**. The player sees prose stop mid-stream (or a blank turn) with no
explanation. This is the most probable cause of the reported "generates then disappears."
**Fix sketch:** In the OpenAI-compat loop, after `json.loads(data)` (`:1764`), detect a chunk-level
`j.get("error")` **and** `choices[0].finish_reason=="error"`. Emit `event: error` with the typed
`error.metadata.error_type` + message (so the fallback chain and the FE can react), flush any
already-streamed content, and `return` cleanly instead of falling to `[DONE]`. In the agent loop,
extend `:4461` to also surface a user-visible error (or a Continue) when `_round_finish_reason ==
"error"`. Note: a *post-content* error mid-stream won't trigger the fallback chain
(`_stream_llm_with_fallback_impl` only retries pre-content) — that is acceptable, but the player
must at least be told the turn ended on an error.

### 2. `Retry-After` (429/503) ignored — fixed 0.5 s backoff
**Where:** `frontend/src/llm_core.py:1369-1370` (non-stream retry), `:1410`, `:1416`; no header read.
**Symptom:** A 429/503 from OpenRouter typically carries `Retry-After` (seconds). The client always
sleeps `LLMConfig.RETRY_DELAY = 0.5` and retries, so a rate-limit with a several-second window is
re-hit almost immediately, exhausting the 3-attempt budget and surfacing a hard failure that a
correctly-timed single retry would have avoided. (Streaming has no retry at all on 429/503 beyond
the host-cooldown — it yields `event: error` immediately, which is acceptable but also doesn't read
`Retry-After`.)
**Fix sketch:** In `_llm_call_async_impl`, when `r.status_code in (429, 503)`, read
`r.headers.get("retry-after")` (parse integer-seconds; ignore HTTP-date form or cap it), clamp to a
sane max (e.g. ≤ the remaining call budget), and `await asyncio.sleep(that)` instead of the fixed
delay. Keep the fixed delay as the fallback when the header is absent or unparseable.

### 3. Typed moderation / guardrail / content-policy / provider errors flattened to a generic message
**Where:** `_format_upstream_error` `frontend/src/llm_core.py:507-546` (reads only `error.message`).
**Symptom:** OpenRouter returns rich `error.metadata` — moderation `reasons` + `flagged_input`,
guardrail details, `provider_name` + raw upstream body, and a typed `error_type`. All of it is
dropped; the player/admin sees "denied access (403)" or "HTTP 400" with no actionable cause. For a
narration product this matters: a content-policy block on player input is indistinguishable from a
dead key.
**Fix sketch:** In `_format_upstream_error`, after extracting `error.message`, also read
`error.code`, `error.metadata.error_type`, `error.metadata.reasons` / `flagged_input` (moderation),
and `error.metadata.provider_name` / `raw` (provider). Compose a specific sentence per `error_type`
(e.g. content_policy_violation → "the provider's moderation flagged the input"; provider_overloaded
→ "the upstream provider is overloaded"). Surface `error_type` as a machine field on the yielded
`event: error` so the agent loop / FE can branch (e.g. context_length_exceeded → trim-and-retry;
provider_overloaded → trigger the fallback chain). Pairs naturally with Gap #1's mid-stream detection.

### 4. (Lower priority, consequence-loop hardening) Utility/JSON extraction does not use `response_format`
**Where:** extraction relies on prompt + post-hoc parse — `agent_loop.py:1591` `_last_json_object_with_key`,
`deep_research.py:864` `_parse_json_object`; no `response_format` is ever added to the payload.
**Symptom:** CLAUDE.md documents a recurring failure (`auto-record: no parseable JSON (len=0)`) on the
constrained-extraction path that drives the consequence loop. OpenRouter + DeepSeek support
`response_format:{type:"json_object"}` (JSON mode) and structured outputs; not using it leaves
extraction at the mercy of the model wrapping JSON in prose/reasoning.
**Fix sketch:** On the **utility-extraction** call class only (non-streaming, `llm_call_async`), add
`response_format:{type:"json_object"}` to the OpenAI-compatible payload for OpenRouter when the call
is a constrained extraction (the prompts already forbid prose). Keep the post-hoc parser as the
fallback for providers that ignore the field. This is a reliability hardening, not a conformance
defect — sequence it after #1–#3.

---

## Items confirmed correct (no action)

- `: OPENROUTER PROCESSING` keep-alive comment lines are safely ignored (`llm_core.py:1755-1762`).
- `[DONE]` sentinel + no-space `data:` tolerance (`:1762-1764`).
- `reasoning` map: `{"enabled":false}` for explicit-off and `{"effort":…}` for on, OpenRouter-targeted (`:605-622`); multi-field reasoning **readback** on both stream and non-stream (`:1841`, `:403-409`).
- Usage/cost/cached/reasoning-token capture from the trailing chunk + ledger plumbing (`:1797-1832`, `orwell_token_ledger.py:121-139`).
- Pre-stream HTTP error handling + friendly auth/rate-limit/outage copy (`:1749-1753`, `:507-546`).
- Engine tool 409 `stale-beat` handling is robust and **separate** from OpenRouter (`orwell_engine.py:79-81, 187-208`) — the structured-error pattern there is exactly what the OpenRouter error path (Gaps #1/#3) should emulate.
- OpenRouter embeddings: intentionally N/A (local fastembed, ADR 0004).
