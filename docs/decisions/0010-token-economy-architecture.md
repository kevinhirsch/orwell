# 0010 — Token economy as architecture: a metered LLM boundary, a reasoning budget, cache-friendly prompts, and non-degrading context tiering

> **Status:** **Proposed** (2026-06-21; mechanism to be built BDD/TDD-first as feature 0069).
> **Source:** The 2026-06-21 cost investigation against the live game (DeepSeek V4 Pro via OpenRouter):
> the OpenRouter request logs show a steady stream of small-input / large-output narration calls, and a
> code trace found the spend is (a) **half-measured** — the usage envelope OpenRouter already returns is
> mostly discarded — and (b) governed by **scattered constants**, with the single largest lever
> (reasoning tokens) never controlled at all.
> **Refines:** the 2026-06-10 "remediation principles" (do not add machinery the game doesn't need) and
> the lean-context posture of ADR 0003.
> **Builds on:** ADR 0003 (the conversation is the game — minimal context, recall not remember), ADR 0005
> (split authority by openness — token policy is an open-set/FE concern, never the closed set), 0064
> (the canonical game session — the key for cache stickiness), 0065 (the LLM↔engine sync spine — the
> sibling Vault-free per-turn ledger pattern, `orwell_sync_ledger.py`).
> **Inherits / bounded by:** the Vault Wall (mandate #2), anti-sycophancy (mandate #3), and
> **non-degradation (mandate #4)** — which this record treats as the *binding* constraint on any token
> saving: we never trade away persisted detail to lower a bill.

## Context

Every player turn and every background task in the game is an LLM call made through **one front-end
seam** (`frontend/src/llm_core.py`). The engine is unaffected — narration happens in the FE
(`getMomentPrompt`), and the LLM only voices facts (ADR 0003). So **the entire token economy is an
FE/adapter concern**, and today it is neither observed nor governed as a system:

1. **Spend is half-measured.** OpenRouter now returns the full usage envelope in the final SSE chunk —
   `prompt_tokens`, `completion_tokens`, `prompt_tokens_details.cached_tokens`,
   `completion_tokens_details.reasoning_tokens`, `usage.cost`, `usage.cost_details` — automatically (the
   `include_usage` flag is deprecated/no-op). The stream parser reads exactly **two** of them
   (`llm_core.py:1656`: `prompt_tokens` / `completion_tokens`); **cache hits, reasoning spend, and cost
   are dropped on the floor.** `context_percent` is computed but only as post-round telemetry, never
   surfaced (`agent_loop.py:1325-1328`); the per-turn sync ledger records **no** token fields by design
   (`orwell_sync_ledger.py`). You cannot tune what you cannot see.
2. **The biggest lever is unmanaged.** DeepSeek V4 Pro is a reasoning model. In the sampled calls,
   output (≈2,400 tok, mostly thinking) dwarfs input (≈565 tok) and costs ~2× per token — **output is
   ~89% of the per-call bill.** Yet `reasoning` is **only ever parsed from responses, never sent**: the
   OpenAI-compatible payload builder (`llm_core.py:1361-1376`) emits `model/messages/temperature/stream/
   max_tokens/tools` and nothing else, so the model runs at its **default reasoning effort on every
   beat**.
3. **Caching is left to chance.** DeepSeek caching on OpenRouter is automatic, prefix-based, and has no
   write premium — but it only hits when the *leading* span of the prompt is byte-identical across
   turns and the same provider serves them. The FE sends **no `session_id` and no provider routing**, so
   stickiness is luck, and nothing asserts the stable prefix (system + tool schemas) is actually stable.
   The only explicit-cache wiring that exists is Anthropic-only (`llm_core.py:688-707`) — a path the
   game's provider doesn't use.
4. **Output caps are scattered magic numbers.** `max_tokens` is set ad hoc per call site (4096 for
   narration `agent_loop.py:2545`; 1500/1200/600 for the various extractions `:1838/:1754/:2440`), with
   no shared notion of *call class* — so there is no single place to reason about, or change, the policy
   for "a narration turn" vs. "a background extraction."
5. **Context is capped, then thrown away.** The input budget auto-derives to `0.60 × context_length`
   but is hard-capped at **48K** (`context_budget.py:29-34`); past the window's edge the system falls
   into **lossy** self-summarization (`context_compactor.py`, ~85% trigger). A 1M-context model's
   capacity is unused — so the failure mode under a long game is *degradation* (summarized-away detail),
   which is exactly mandate #4's prohibition.

None of these is a bug to patch in place. The shape of the problem is architectural: **there is no seam
that owns "what we spend, on what call class, and how much context we carry."** This record creates one.

## Decision

Make the token economy a **first-class, observed, policy-driven** property of the single LLM boundary —
and frame every saving as subordinate to non-degradation. Concretely, four architectural moves, each
landing as a slice of feature 0069:

- **A — The metered boundary.** Capture the **whole** usage envelope at `llm_core.py` (input, cached,
  reasoning, output, cost, cost_details, provider, and context-%), thread it through `llm_trace.py`, and
  record it to a **Vault-free per-turn token/cost ledger** (the sibling of `orwell_sync_ledger.py`)
  surfaced **admin-side only**. This is the "watch the context window" deliverable and the precondition
  for everything else.
- **B — Token policy per call class.** Replace the scattered constants with one resolver that, given a
  **call class** (`narration` · `utility-extraction` · `casting` · `background-authoring`), returns its
  **reasoning effort, output cap, caching posture, and context budget**. Wire `reasoning` into the
  OpenAI-compatible payload and apply the policy per class. Reasoning is governed, never default-by-
  omission; narration **dials down** (it still feeds the "Thinking" accordion — the FE convention), the
  extraction/utility classes run reasoning **minimal or off**.
- **C — Cache-friendly, lean-first assembly.** Make prompt order a contract: the **stable prefix**
  (system + tool schemas + static framing) is assembled first and held **byte-identical** across turns;
  volatile content (the clock, the per-turn delta, the player's message) goes **last**. Pin provider
  **stickiness per canonical game session** (`session_id`, keyed off 0064) so the automatic cache stays
  warm from turn #1. The Anthropic `cache_control` path stays reserved for explicit-cache models.
- **D — Non-degrading context tiering.** Turn the 48K hard cap into a **tier**: the default stays lean
  (recall from the store, not accumulate the chat — ADR 0003), but when a turn genuinely needs more,
  **escalate the budget up toward the model's window** *before* invoking lossy compaction — so mandate
  #4 wins over cost, but only when needed, and always under the meter (A).

### Principles (binding)

1. **Measured or unmanaged.** Nothing is optimized that isn't first captured at the one boundary. The
   full envelope is recorded every call (counts + cost + class + context-%), never a subset.
2. **Token economy is policy, not scattered constants.** Reasoning effort, output cap, caching posture,
   and context budget are resolved per **call class** from one place — changeable without touching call
   sites.
3. **Reasoning is the primary budgeted resource.** It is governed per class and **never** runs at the
   provider default by omission. Narration dials down (keeps the Thinking accordion); utility/extraction
   runs reasoning minimal or off.
4. **Lean-first, cache-friendly order (reinforces ADR 0003).** The stable prefix is byte-identical and
   first; volatile content is last; provider stickiness is per game session. Caching is provider-
   automatic for the live model; explicit `cache_control` is reserved for explicit-cache models.
5. **The big window is a non-degradation backup, not a default (mandate #4).** Default context stays
   lean; escalate toward the model's window before any lossy summarization; persisted detail is **never**
   dropped to save tokens.
6. **Vault-free and calibration-neutral by construction (mandates #2/#3).** Token telemetry carries
   counts and class labels, **never** message content or secret state, and is admin-only. Token policy is
   FE/adapter-only: changing effort, caching, or budget may change **cost and latency**, and can **never**
   move a seeded engine outcome. The player is never shown a token, cost, or context number.

## Litmus test

> Does this let us **see** every token we spend (input / cached / reasoning / output / cost) and govern
> it by call class — without ever showing the player a number, **degrading persisted memory to save
> tokens**, or perturbing a single seeded outcome? If any of those break, it is the wrong shape, even if
> the bill drops.

## Consequences

- A new **feature spec (0069)** carries the executable Gherkin and the build, sliced A→D in that order
  (A is visible, zero-behavior-change, and unblocks the rest; B is the largest cost win; C is a free
  extra given A; D matters only once games run long enough to hit compaction).
- The admin gains a real **cost/usage surface** (per turn and per game): input/cached/reasoning/output,
  cost, cache-hit %, and context-%. The player gains nothing visible — by design (Principle 6).
- Per-call-class policy lives in a constants/settings module (like `temperatureConstants.ts` on the
  engine side) so magnitudes retune without code change.
- Expected first-order effect: governing reasoning (B) is the dominant saving on the current in/out
  ratio; caching (C) trims the input slice (~11% of spend) for free; tiering (D) *raises* cost in the
  rare long-game case in exchange for honoring non-degradation — which is the correct trade.

## Alternatives considered

- **Status quo — patch the parser, sprinkle a `max_tokens`.** Rejected: leaves spend invisible and the
  largest lever (reasoning) unmanaged; re-creates the scattered-constant problem.
- **One global token budget knob.** Rejected: call classes have wildly different profiles (a 2,400-token
  narration vs. a 150-token JSON extraction). One knob either starves narration or wastes tokens on
  extraction. Policy must be per class.
- **Aggressive context compaction to cut tokens.** Rejected: lossy, and a direct violation of
  non-degradation (#4). The architecture already prefers recall over accumulation (ADR 0003); the right
  backup is a *bigger window*, not a smaller memory.
- **Route DeepSeek through OpenRouter's Anthropic endpoint for explicit `cache_control`.** Rejected for
  the live model — its caching is already automatic; the format hop adds surface for no gain. Reserved
  for explicit-cache (Claude-class) models, where `cache_control` is the only way to cache.
- **Disable reasoning entirely on narration.** Rejected: the game surfaces the reasoning trace as the
  "Thinking" accordion (the FE channel convention). Dial down, don't kill.

## Testability (BDD/TDD-first)

FE/adapter-only ⇒ the gate is the front-end pytest suite (the recorded-deviation pattern of ADRs
0008/0009 and feature 0066), named in feature 0069's Definition of Done. Structural where possible:

- **Metered boundary (A).** A streamed response carrying a usage chunk yields a captured envelope that
  includes `cached_tokens`, `reasoning_tokens`, and `cost` — not just prompt/completion.
- **Vault-free telemetry (Principle 6).** A sentinel asserts the token/cost record contains **no**
  message content and no secret field, and that cost/token figures appear on **no** player-facing surface.
- **Policy per class (B).** Each call class resolves its expected reasoning effort + output cap;
  narration ≠ extraction; the OpenAI-compatible payload for a reasoning model carries the `reasoning`
  map per policy (and no class runs at default-by-omission).
- **Cache-friendly order (C).** For two turns differing only in the player's latest message, the
  system-and-tools prefix sent to the model is **byte-identical**; volatile content is last; a game
  session attaches a stable `session_id`.
- **Non-degrading tiering (D).** When needed context exceeds the lean budget on a large-context model,
  the computed budget escalates toward the window **before** compaction triggers; the lean default is
  unchanged; no persisted detail is dropped.
- **Calibration neutrality (Principle 6).** Under a fixed seed, flipping reasoning effort / caching /
  budget leaves every seeded engine outcome byte-identical (inherent — the engine never sees token
  policy — and asserted as a guard).

## Open questions (PO — to confirm before/while building)

1. **Reasoning-effort per class (tuning, not architecture).** Proposed defaults: narration = **low–
   medium** (keep a light Thinking trace), utility-extraction = **off/minimal**, casting = **medium**,
   background-authoring = **low**. Confirm the narration setting in particular — it trades thinking depth
   (narrative quality) against the dominant cost line.
2. **Context-tiering ceiling (D).** The lean default stays (`0.60 × window`, cap 48K). Escalation ceiling
   before lossy compaction — e.g. `0.85 × window` — and whether D is **opt-in** behind a setting/flag
   (default lean) like 0066's `ORWELL_TIME_OF_DAY`, given it can raise cost on long games.
3. **Cost surface scope.** Admin-only per-turn + per-game cost/usage is in scope. Is a per-game **budget
   cap / alert** (warn or soft-stop when a game exceeds $X) wanted now, or a Phase-2 follow-up?
4. **Provider routing (C).** Stickiness via `session_id` is in scope. Do we also **pin** an allowed
   provider set (e.g. require a cache-capable DeepSeek host, `allow_fallbacks:false`) to avoid being
   routed to a non-caching endpoint — accepting reduced availability for predictable cache hits?

## Traceability

- Source: the 2026-06-21 cost investigation (OpenRouter logs + the `llm_core.py`/`agent_loop.py` trace).
- Refines: ADR 0003 (lean context) and the 2026-06-10 remediation principles.
- Builds on: ADR 0005 (open-set/FE authority), 0064 (canonical session), 0065 (the Vault-free per-turn
  ledger pattern).
- Bounded by: the Vault Wall (0001), anti-sycophancy, and **non-degradation** (mandate #4).
- Followed by: feature **0069** (`docs/features/0069-token-economy-and-context-budget.md`), built A→D.
