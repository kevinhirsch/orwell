# Hermes → Orwell Integration — Evidence Inventory

> Working artifact for the hermes-agent → orwell integration audit. Survives `/compact`.
> Read-only through Phase 4; no integration code until the gate is authorized.
> **Phase 1 (five-specialist deep-dive) consolidated below; lead-adjudicated.**

## Repos
- **TARGET — orwell**: `/home/user/orwell` · MIT © kevinhirsch 2026 · HEAD `2f16e86`.
  TS hexagonal engine (16 ports) + Python/FastAPI player FE (`frontend/`, an *Odysseus* white-label).
- **SOURCE — hermes-agent**: `/tmp/hermes-agent` (read-only) · MIT © **Nous Research 2025** ·
  HEAD `2b3a4f0`, last commit **2026-06-21** (extremely active; `cli.py` alone ~690KB). Python platform.

## Phase 0 findings (baseline)
1. **orwell's FE is a white-labeled _Odysseus_ workspace** (a hermes-adjacent lineage), not a hermes fork.
   No hermes/Nous attribution exists yet ⇒ any harvested hermes code MUST add a fresh **Nous Research MIT
   notice + ACKNOWLEDGMENTS entry** (+ `frontend/licenses/` text).
2. **The FE already contains a large hermes-adjacent surface, gated off** by `ORWELL_GAME_BUILD` (default on).
   Much of the "integration" is therefore **fork-sync / selective pattern re-enable** — and the inherited
   **memory/skills/user-modeling** surface is the live form of the rejected anti-pattern.
3. **hermes README confirms its own anti-pattern**: "builds a deepening model of who you are," Honcho
   dialectic **user modeling**, a closed **learning loop**. Direct anti-sycophancy collision.
4. **Narration lives in the FE** (engine narrator is `EchoNarrativePort`; FE narrates via `getMomentPrompt`).
   ⇒ Most hermes assets attach **FE-side**, behind the FE's LLM resolution / non-Vault player adapter.

## The four mandates (the gate every candidate passes)
1. **Vault Wall** — secret/off-screen state reaches no one (incl. admin); structural at port/tool layer.
2. **Anti-sycophancy** — engine + seeded RNG decide outcomes; LLM only narrates; NO user-modeling loop.
3. **Hexagonal purity** — pure core; side effects behind swappable ports.
4. **Non-degradation + fidelity** — persisted detail accumulates; off-screen society stays rich.

## Two factual disputes — lead-adjudicated (verified in source)
- **FTS5 session search** → orwell **ALREADY HAS IT** (`frontend/src/session_search.py`, `chat_messages_fts
  MATCH`). Scout's "additive" claim is wrong. ⇒ **DUPLICATION.**
- **Context compaction** → orwell **ALREADY HAS IT** (`context_compactor.py` @ 0.85 threshold + adaptive
  `context_budget.py`). ⇒ **DUPLICATION**; hermes' runtime compressor is memory-provider-coupled (anti-pattern).
- **Provider profile / prompt caching / reasoning quirks** → orwell `llm_core.py` already does Anthropic
  `cache_control: ephemeral`, `max_completion_tokens`/temperature quirks, OpenRouter `reasoning:{enabled:false}`.
  ⇒ Scout's "top candidate" is **mostly DUPLICATION**; only a declarative-profile refactor is residual.

## Consolidated candidate inventory
> Verdict legend: **WIN** (additive, mandate-safe) · **OPTIONAL** (real but scope/effort call) ·
> **HARDENING** (small drop-in) · **PATTERN** (reference only, no code) · **DUP** (orwell already has it) ·
> **REJECT** (mandate breach / out of scope). All hermes code carries **Nous MIT** attribution.

| # | Hermes asset (path) | What it is | Target orwell seam | Type | Verdict | Mandate note |
|---|---|---|---|---|---|---|
| 1 | `tools/delegate_tool.py` (parallel isolated subagent fan-out) — **pattern only** | Spawn N isolated children, parent sees only summaries | FE-driven write-back enriching `src/engine/offscreen.ts` scene `content`, surfaced via existing `rollOverhears`/`diffuseGossip` | net-new (pattern-port) | **WIN ★** | Safe: enrichment is *downstream* of the hidden-event boundary; public personas only; engine commits pair+nature+seeded magnitude *before* prose (ADR 0005); `expressiveNonCollapse` is the standing gate |
| 2 | `gateway/platforms/base.py` + `platform_registry.py` + `pairing.py` + `delivery.py` + `stream_dispatch.py` | Single-process multi-messaging-platform fan-out (Telegram/Discord/Slack/WhatsApp/Signal) | NEW non-Vault player adapter beside `frontend/` consuming the player MCP channel | adapt | **OPTIONAL** | Vault-safe by inheritance (FE already Vault-free). Load-bearing: (a) server-side reasoning/operator-aside scrub chokepoint, (b) `pairing.py` → single `x-orwell-user` (else one human → many games = isolation breach), (c) decision-card text degradation, (d) respect `ORWELL_GAME_BUILD` tool-gating |
| 3 | `gateway/pairing.py` | OWASP/NIST code-pairing (salted SHA-256, TTL, rate-limit, lockout) | Platform→orwell-account identity bridge (prereq for #2) | adapt (near-verbatim) | **OPTIONAL** (bundled w/ #2) | No Vault contact; must resolve to a single orwell account |
| 4 | `agent/redact.py` + gateway SSRF/path-traversal guards | Vendor-prefix + query-param secret masking; URL/path guards | FE logging + any new outward fetch path | drop-in | **HARDENING** | Generic defensive hardening; no mandate surface |
| 5 | `providers/base.py` `ProviderProfile` + `plugins/model-providers/*` + `agent/prompt_caching.py` | Declarative per-provider profile registry | FE `endpoint_resolver.py` / `llm_core.py` provider branches | refactor | **OPTIONAL (cleanup)** | Capability already present in orwell; value is only code-cleanliness + easier provider adds. Not an early wave |
| 6 | `gateway/response_filters.py` `[SILENT]`/`NO_REPLY` markers | Intentional-silence sentinel for "model chose not to emit" | FE agent-loop error-correction (`agent_loop.py`) | pattern | **PATTERN** | Aligns with FE's existing under-call correction |
| 7 | `agent/context_engine.py` `ContextEngine` ABC | Pluggable "what to do as context fills" port (head/tail protect, REFERENCE-ONLY preamble) | If/when orwell refactors `context_compactor.py` into a port | pattern | **PATTERN** | The "latest message wins / summary is reference" preamble is anti-sycophancy-*aligned*; FE-transcript only, never engine state |
| 8 | `optional-mcps/*` manifest schema | Commit-pinned, review-gated MCP catalog manifests | Doc convention for ADR 0007 public exposure | pattern | **PATTERN** | The *discipline* only; the bundled servers are out of scope |
| — | `tools/session_search_tool.py` + `hermes_state.py` FTS5 | Lexical session recall | — | — | **DUP** | orwell `session_search.py` already does this |
| — | `agent/context_compressor.py` / `conversation_compression.py` | Runtime context compaction | — | — | **DUP / REJECT** | orwell `context_compactor.py`+`context_budget.py` already do it; hermes' is memory-provider-coupled (anti-pattern) |
| — | `agent/{account_usage,billing_view,credits_tracker}.py` | Provider balance/usage surfacing | — | — | **DUP** (mostly) | orwell `orwell_token_ledger.py` (ADR 0010) covers per-turn cost; provider-balance fetch is a minor ops nicety, reimplement if wanted |
| — | `cron/scheduler.py` + `scheduler_provider.py` | Wall-clock cron + suggestion engine | — | — | **REJECT** | Violates "the house must NOT live while the player is away" (`ORWELL_WATCHER_TICK_MS=0` default). Ops-only at most; the `usage` suggestion source is part of the self-improvement loop |
| — | `web/` (React/Vite) + `ui-tui/` + `tui_gateway/` | Operator dashboard + terminal client | — | — | **REJECT** | Same Odysseus lineage orwell already forked; chat IS the UI (ADR 0003, 0022 deferred); lifting = dashboard-ification (#4) + re-introducing the gated workspace |
| — | `skills/` + `agent/skill_*` + `agent/curator.py` | Model-authored markdown skills + curator | — | — | **REJECT** | orwell isn't a general agent; mandate-safe forms already native (`competitionLibrary.ts` read-only, `SoulStore.ts`) |

## Rejected anti-patterns (named, with the mandate breached)
1. **The memory / user-modeling self-improvement loop** — `agent/background_review.py` (forks the agent after
   every turn to ask "what has the user revealed about themselves / how do they want you to behave," writes
   `USER.md`/memory, reinjects next session), `agent/memory_provider.py` + `plugins/memory/{honcho,mem0,
   hindsight}`, `tools/memory_tool.py`, the `curator`, and the cron `usage` suggestion source. **Breaches
   Mandate #2 (anti-sycophancy)** — its entire purpose is to model the human and adapt to please — **and #1
   (Vault)** (model-authored persisted state + external services outside the boundary). The mandate-safe
   shapes (NPC memory, read-only catalog) already exist natively. **REJECT WHOLESALE.**
2. **Runtime memory-coupled context compression** (`conversation_compression.py` notifies memory providers,
   rotates sessions) — **#4 non-degradation / #1 Vault** (a second persisted-truth store rivaling the engine).
3. **Wall-clock cron as default** — the "house must not live while the player is away" ruling.
4. **Generic MCP catalog/servers** (`optional-mcps`) — **#1** permission-boundary (new outward deps).
5. **`web/` + `ui-tui/` as player surfaces** — **#4** dashboard-ification + inherited-workspace re-exposure.
6. **Skills self-creation** — general-agent capability; ADR 0003 (engine decides) + #2.

## Deploy invariant flagged by the guardian
The memory/skills surface is walled **at runtime** (`ORWELL_GAME_BUILD` drop-set: routes unmounted, context
injection off, JS stripped) — **not compile-time**. So "game build on" is a **deploy invariant**, not a
Vault-grade structural guarantee. `ORWELL_GAME_BUILD=0` silently re-exposes every anti-pattern surface.
