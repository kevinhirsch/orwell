# Hermes → Orwell Integration — Evidence Inventory

> Working artifact for the hermes-agent → orwell integration audit. Survives `/compact`.
> Read-only through Phase 4; no integration code until the gate is authorized.

## Repos
- **TARGET — orwell**: `/home/user/orwell` · MIT © kevinhirsch 2026 · HEAD `2f16e86` (PR #502).
  TS hexagonal engine (16 ports) + Python/FastAPI player FE (`frontend/`).
- **SOURCE — hermes-agent**: `/tmp/hermes-agent` (read-only clone) · MIT © **Nous Research 2025** ·
  HEAD `745c4db`, last commit **2026-06-21** (extremely active). Python platform.

## Phase 0 findings (baseline)
1. **orwell's FE is a vendored fork lineage, but of _Odysseus_, not hermes.** `frontend/ACKNOWLEDGMENTS.md`
   states the FE is "a white-labeled build of the **Odysseus** self-hosted AI workspace" (MIT © 2025
   Odysseus Contributors), plus opencode / llmfit / Tongyi DeepResearch. **No hermes/Nous attribution
   exists yet.** ⇒ Any code harvested from hermes-agent is genuinely NEW third-party code and MUST add a
   fresh **Nous Research MIT notice + ACKNOWLEDGMENTS entry** (+ `frontend/licenses/` text).
2. **The FE already contains a large hermes-adjacent surface, gated off.** `ORWELL_GAME_BUILD` (default on)
   "restores the full inherited workspace" when `=0`. Inherited modules visible: `routes/memory_routes.py`,
   `routes/skills_routes.py`, `routes/research_routes.py`, `services/memory`, `src/context_compactor.py`,
   `src/context_budget.py`, `src/agent_loop.py`, `endpoint_resolver.py`, provider plumbing, cron-style
   `bg_jobs.py`. ⇒ Much of the "integration" is **fork-sync / selective re-enable**, not greenfield — and
   the inherited **memory / skills / user-modeling** surface is the live form of the rejected anti-pattern.
3. **hermes README confirms its own anti-pattern in plain words**: "builds a deepening model of who you are
   across sessions," Honcho **dialectic user modeling**, a closed **learning loop**. Direct anti-sycophancy
   collision — default verdict REJECT, salvage only a radically re-scoped, engine-owned, Vault-walled subset.
4. **Narration lives in the FE** (engine narrator is `EchoNarrativePort`; FE narrates via `getMomentPrompt`).
   So most hermes assets (Python: providers, gateway, subagents, cron, retrieval) attach **FE-side**, behind
   the FE's LLM resolution / non-Vault player adapter — not the TS engine core.

## The four mandates (the gate every candidate passes)
1. **Vault Wall** — secret/off-screen state reaches no one (incl. admin); structural at port/tool layer.
2. **Anti-sycophancy** — engine+seeded-RNG decide outcomes; LLM only narrates; NO user-modeling loop.
3. **Hexagonal purity** — pure core; side effects behind swappable ports.
4. **Non-degradation + fidelity** — persisted detail accumulates; off-screen society stays rich.

## Candidate inventory
> Populated from the Phase 1 parallel deep-dive (five specialists). One row per asset.

| # | Hermes asset (path) | What it is | Recency/evidence | Target orwell port/location | Integration type | Mandate-safety | Attribution | Confidence |
|---|---|---|---|---|---|---|---|---|
| _pending Phase 1 consolidation_ | | | | | | | | |

## Rejected anti-patterns (named, with the mandate breached)
- _pending — but pre-flagged: the memory/skills self-improving loop + Honcho user modeling (anti-sycophancy)._
