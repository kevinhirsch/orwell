# 0069 — Token economy: a metered LLM boundary, a reasoning budget & non-degrading context tiering

**Status:** 📝 Spec only · **gate: FE pytest** (a recorded deviation from the BDD-default, matching
0066/0033/0036/0055 — the `.feature` is the spec of record; the executable gate is the front-end pytest
suite named under Definition of Done, because the behaviour is entirely FE/adapter and is exercised
through `llm_core.py` / `agent_loop.py`, not a new Cucumber world).
**Executable spec:** [`0069-token-economy-and-context-budget.feature`](./0069-token-economy-and-context-budget.feature)
**Provenance:** ADR [`0010`](../decisions/0010-token-economy-architecture.md) (token economy as
architecture); the 2026-06-21 cost investigation (DeepSeek V4 Pro via OpenRouter).

## 1. Summary

Make the front-end's LLM spend **observable and governed** instead of invisible and ad-hoc — without
spending a single token the lean-context architecture (ADR 0003) doesn't need, and **never** trading
persisted detail for a lower bill (mandate #4). Four slices: **(A)** meter the one LLM boundary so every
call records its full token + cost envelope (and the context-% the player never sees); **(B)** resolve a
**token policy per call class** — reasoning effort, output cap, caching posture, context budget — and
finally *send* a `reasoning` budget (the largest, currently-unmanaged cost lever); **(C)** assemble the
prompt **stable-prefix-first** and pin provider stickiness per game session so the provider's automatic
cache actually hits; **(D)** let context **escalate toward the model's window before** lossy compaction,
so long games degrade in *cost*, not *memory*.

## 2. What exists today

- **Usage is half-captured.** OpenRouter returns the full envelope in the final SSE chunk; the parser
  reads only `prompt_tokens`/`completion_tokens` (`frontend/src/llm_core.py:1656`) and drops
  `cached_tokens`, `reasoning_tokens`, `cost`, `cost_details`. `context_percent` is computed but never
  surfaced (`agent_loop.py:1325-1328`); the sync ledger has no token fields (`orwell_sync_ledger.py`).
- **Reasoning is never sent.** The OpenAI-compatible payload (`llm_core.py:1361-1376`) carries no
  `reasoning` map — the reasoning model runs at default effort every turn, and output (mostly thinking)
  is ~89% of the per-call cost in the sampled logs.
- **Output caps are scattered constants** (narration 4096 `agent_loop.py:2545`; extractions 1500/1200/600
  `:1838/:1754/:2440`) with no shared call-class notion.
- **Caching is left to luck** — no `session_id`, no provider routing; the only `cache_control` wiring is
  Anthropic-only (`llm_core.py:688-707`). Nothing asserts the stable prefix is stable.
- **Context is capped then summarized away** — `0.60 × window` capped at **48K** (`context_budget.py:29-34`),
  then lossy compaction (`context_compactor.py`, ~85%). A 1M window is unused as a backup.

## 3. Scope

**In:**
- **(A)** Full usage-envelope capture at `llm_core.py` (input · cached · reasoning · output · cost ·
  cost_details · provider · context-%), threaded through `llm_trace.py` into a **Vault-free per-turn
  token/cost ledger** + an **admin-only** cost surface.
- **(B)** A central **call-class → token policy** resolver (`narration` · `utility-extraction` ·
  `casting` · `background-authoring`) and the wiring to *send* `reasoning` (effort/`max_tokens`) on the
  OpenAI-compatible path, applied per class. Existing output caps fold into the policy.
- **(C)** A **stable-prefix-first** prompt-assembly contract (system + tools + static framing first,
  byte-identical; volatile content last) and **per-canonical-session** provider stickiness (`session_id`,
  keyed off 0064).
- **(D)** **Tiered** context budget: lean by default, escalating toward the model window **before**
  `context_compactor` runs — opt-in behind a setting (default lean) so the seeded spine and the bill are
  both unchanged unless turned on.

**Out (clean follow-ups):**
- Per-game **budget caps / spend alerts** (soft-stop when a game exceeds a threshold) — Phase-2.
- **Provider pinning** (`allow_fallbacks:false` to a cache-capable host) — Phase-2 (availability trade).
- Routing the live model through the Anthropic endpoint for explicit `cache_control` — reserved for
  explicit-cache models only.
- Any **engine** change. This feature is FE/adapter-only; the closed set (outcomes, seeds, persistence,
  the Vault) is untouched (ADR 0005).

## 4. Design

- **A — Meter once, at the boundary.** Extend the streaming usage parse (`llm_core.py:1654-1672`) to read
  the whole `usage` object — `prompt_tokens_details.cached_tokens`,
  `completion_tokens_details.reasoning_tokens`, `cost`, `cost_details` — and the non-streaming path to
  read `data["usage"]`. Carry it on the existing `usage` SSE event → `llm_trace` → a new Vault-free
  ledger (counts + class + cost + context-%, **no content**). Surface per-turn + per-game on an admin
  page. **No behavior change** — pure observability.
- **B — Policy per class.** One resolver maps a call class to `{reasoning, max_tokens, caching,
  contextBudget}`. The call sites pass their class (narration vs. the auto-record/auto-deal extractions
  vs. casting vs. cast-authoring/zeitgeist) instead of bare `max_tokens`. The payload builder emits the
  `reasoning` map when the model supports thinking. Default-by-omission is forbidden — every class names
  its reasoning posture (narration low–medium to keep the Thinking accordion; extraction off/minimal).
- **C — Cache-friendly order + stickiness.** The system-prompt/moment-prompt assembly puts the stable
  prefix first and pushes per-turn variability (clock, `stateDelta`, the player's message) to the end, so
  the provider's prefix cache matches turn-to-turn. A stable `session_id` per canonical game session
  (0064) makes OpenRouter sticky-route from request #1, keeping the cache warm.
- **D — Tier, don't truncate.** `compute_input_token_budget` gains a tier above the 48K lean cap: when a
  turn's needed context exceeds the lean budget and the model window is large, raise the budget toward the
  window (to a configured ceiling) **before** `context_compactor` summarizes. Opt-in; default lean ⇒
  byte-identical budget + bill. Mandate #4 wins over cost, but only when needed and always metered (A).

## 5. Contracts (stack-agnostic)

```
capture: UsageEnvelope = { inputTokens, cachedTokens, reasoningTokens, outputTokens,
                           cost, costDetails?, provider?, contextPercent }   (Vault-free; no content)
class:   CallClass = narration | utility-extraction | casting | background-authoring
policy:  resolveTokenPolicy(class) -> { reasoning, maxTokens, caching, contextBudget }
send:    OpenAI-compatible payload gains `reasoning` (per policy) on thinking-capable models
order:   prompt = [ stablePrefix (system+tools+static, byte-identical) ] ++ [ volatile (delta, turn) ]
sticky:  session_id = canonical game session id (0064)  -> provider sticky routing
budget:  compute_input_token_budget(..., tier) -> lean default, escalate→window before compaction
ledger:  per-turn token/cost record (admin-only surface); player surfaces show NO token/cost/context
flag:    token tiering (D) opt-in (default lean ⇒ byte-identical); meter (A) always on
```

## 6. Definition of Done

- `frontend/tests/test_adr0010_usage_meter.py` — a streamed response with a usage chunk yields an
  envelope including `cached_tokens`, `reasoning_tokens`, and `cost` (not just prompt/completion); the
  non-streaming path reads `usage` too.
- `frontend/tests/test_adr0010_vault_free_ledger.py` — the token/cost record carries **no** message
  content and no secret field; **no** player-facing surface exposes a token, cost, or context figure
  (the cost surface is admin-only).
- `frontend/tests/test_adr0010_token_policy.py` — each call class resolves its expected reasoning effort
  + output cap (narration ≠ extraction); the OpenAI-compatible payload for a thinking model carries the
  `reasoning` map per policy; no class is default-by-omission.
- `frontend/tests/test_adr0010_cache_order.py` — two turns differing only in the player's latest message
  produce a **byte-identical** system-and-tools prefix; volatile content is last; a game session attaches
  a stable `session_id`.
- `frontend/tests/test_adr0010_context_tiering.py` — needed context above the lean budget on a large
  window escalates the budget toward the window **before** compaction; the lean default is unchanged when
  the tier is off; no persisted detail is dropped.
- The full FE suite stays green (`cd frontend && python3 -m pytest tests/`), and the engine gate is
  untouched (no engine files change). Calibration neutrality is inherent: the engine never sees token
  policy; a fixed-seed guard asserts flipping effort/caching/budget leaves seeded outcomes byte-identical.

## 7. Dependencies & traceability

- Governed by: ADR **0010**; bounded by the Vault Wall (0001), anti-sycophancy, and non-degradation (#4).
- Builds on: ADR 0003 (lean context), ADR 0005 (open-set/FE authority), 0064 (canonical session →
  `session_id`), 0065 (the Vault-free per-turn ledger pattern, `orwell_sync_ledger.py`).
- Followed by: the §3 **Out** items (per-game budget caps/alerts; provider pinning).

## 8. Implementer handoff & open questions

- **Build order A→D.** A is independent, zero-behavior-change, and unblocks tuning B/C/D against real
  numbers — ship it first and observe a few real games before sizing the rest.
- **Slice A is the "watch the context window" ask** — it's worth shipping alone even if B–D are deferred.
- **Keep the Thinking accordion fed.** Narration must keep emitting a (lighter) reasoning trace; B dials
  effort **down**, never off, for the `narration` class (the FE renders it via `roundReasoningText`).
- **Open (PO) — defaults to confirm** (mirrors ADR 0010 Open questions): the per-class reasoning efforts
  (esp. narration), the D escalation ceiling (`~0.85 × window`) and whether D is opt-in behind a flag,
  whether to add a per-game budget cap now (§3 Out), and whether to pin a cache-capable provider set (§3
  Out). All are **tuning/scope**, not architecture — they don't change the contracts in §5.
