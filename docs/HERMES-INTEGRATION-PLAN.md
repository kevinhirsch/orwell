# Hermes → Orwell Phased Integration Plan (Phase 4 — GATE)

> **This is a document, not pre-authorization code.** It sequences the mandate-safe integrations from
> `docs/HERMES-INTEGRATION-MAP.md` into waves. **No code is integrated until Wave 1 is explicitly authorized.**
> Each wave must be green on orwell's existing mandate tests (`npm test` + `cd frontend && pytest tests/`) before
> the next begins. All harvested hermes material retains the **MIT © Nous Research 2025** notice.

## Executive summary
The five-specialist audit found that **orwell's Odysseus-lineage FE has independently built most of hermes'
provider, retrieval, compaction, caching, and usage machinery** — so the harvest is far smaller than hermes'
breadth suggests, and the flagship hermes behavior (the self-improving **user-modeling memory loop**) is a
direct **anti-sycophancy** violation that is **rejected wholesale** (its mandate-safe shapes already exist
natively in orwell). What remains is genuinely valuable but narrow:

- **One clear high-leverage win:** adopt hermes' **parallel isolated-subagent orchestration *pattern*** to
  enrich the *texture* of orwell's already-Vault-walled **off-screen society** — a direct hit on mandate
  priority #1 (off-screen richness), provably Vault-safe and anti-sycophantic.
- **One substantial optional capability:** the **multi-platform gateway** (play your game from Telegram/
  Discord/etc.) — Vault-safe by inheritance, but a real product-scope + effort decision with two load-bearing
  mitigations (server-side reasoning scrub; `pairing.py` identity binding).
- **Small hardening + reference patterns** otherwise.

## Wave plan

### Wave 1 — Off-screen texture enrichment (the headline fidelity win)  ★
- **Map entry:** A1. **Effort: Medium · Risk: Low-Medium · Leverage: High (mandate #1).**
- **Scope:** new FE-driven write-back `recordOffscreenSceneTexture(eventId, content)` (canonical four-place
  wiring) + a best-effort FE driver (modeled on `orwell_zeitgeist.py`) that fans out N parallel utility-LLM
  calls to voice the *texture* of scene skeletons the engine has already decided; surfaced to the player only
  via existing `rollOverhears`/`diffuseGossip` pathways.
- **Mandate-safety proof (must ship green):**
  - `McpServer.callTool` boundary test (template `worldSnapshotBoundary.test.ts`): the write-back cannot carry a
    relationship number, set a witness, or flip the hidden flag.
  - `tests/unit/expressiveNonCollapse.test.ts` + `frontend/tests/test_expressive_non_collapse.py` stay green
    (no descriptor ⇒ byte-identical deterministic fold).
  - `test:arch` + `tests/architecture/vault-boundary.test.ts` green (write-back lives under OUTWARD).
  - A per-turn/-tick generation budget cap (the `imageConstants.ts` pattern) so fan-out can't flood gossip or cost.
- **BDD coverage:** extend an off-screen-society `.feature` to assert (a) enriched scenes remain hidden until a
  pathway terminates at the player, and (b) richness threshold rises (ties to `src/engine/richness.ts`).
- **Why first:** highest leverage, self-contained, attaches to an existing seam, no product-scope question.

### Wave 2 — Hardening drop-ins  (can land in parallel with Wave 1)
- **Map entry:** B1. **Effort: Low · Risk: Low.**
- **Scope:** vendor `agent/redact.py` (broader secret masking) into FE logging; adopt the gateway SSRF/
  path-traversal URL guards as a shared helper (prereq-useful for Wave 3). Add the Nous MIT ACKNOWLEDGMENTS entry
  here (first harvested code).
- **Proof:** FE full suite green; a unit test that known secret shapes are masked in logs.

### Wave 3 — Multi-platform gateway  ◆ GATED ON A PRODUCT DECISION
- **Map entries:** A2 + A3 (pairing). **Effort: Medium-High · Risk: Medium · Leverage: High *if in scope*.**
- **Decision required before starting:** does orwell want players to reach their game off-browser (Telegram/
  Discord/etc.)? If "browser-only for now," **defer this wave** (the patterns are documented for later).
- **Scope (if authorized), in sub-steps, each green before the next:**
  1. `pairing.py` identity bridge → single `x-orwell-user` (the isolation linchpin) + its tests.
  2. Server-side reasoning/operator-aside **scrub chokepoint** (Python analog of `markdown.js`) + a boundary
     test that no reasoning/`npc:<id>`/operator-aside reaches outbound delivery.
  3. One platform adapter end-to-end (Telegram is simplest) behind the registry pattern, consuming the Vault-free
     MCP player channel; `PendingDecisionView` degraded to inline text prompts; `ORWELL_GAME_BUILD` tool-gating respected.
  4. Additional platforms as thin adapters.
- **Mandate-safety proof:** per-platform delivery boundary test (no Vault/reasoning leak); one-game-per-user
  test across two platform identities bound to one account; reuse the existing FE g15 / reasoning-scrub gates.
- **Note:** ties into ADR 0007 (public exposure) — coordinate auth posture.

### Reference adoptions (no dedicated wave — fold in opportunistically)
- C1 `[SILENT]`/`NO_REPLY` markers → when next touching `agent_loop.py` under-call correction.
- C2 `ContextEngine` ABC shape → only if/when `context_compactor.py` is refactored into a port (not needed now).
- C3 `ProviderProfile` declarative refactor → optional cleanup when provider sprawl bites (no capability gain).
- C4 commit-pinned MCP manifest discipline → doc convention for any future third-party MCP exposure.

## Explicitly rejected (do not implement) — see Map §D
The self-improving **memory/user-modeling loop** (background-review, Honcho/mem0/hindsight, `USER.md`, curator,
cron `usage` suggestions) · runtime memory-coupled compression · wall-clock cron as default · generic MCP
catalog/servers · `web/`+`ui-tui/` as player surfaces · skills self-creation. Each is named with its breached
mandate in the Map.

## Attribution obligations (carry through every wave)
- Add a **Nous Research (MIT, © 2025)** entry to `frontend/ACKNOWLEDGMENTS.md` + the license text under
  `frontend/licenses/` the first time any hermes code/pattern lands (Wave 1 or 2, whichever ships first).
- Retain the Nous MIT notice in the header of any file containing harvested code or a non-trivial lifted pattern.

## Standing invariants every wave must keep green
`npm test` (typecheck → build → unit/property/arch → BDD) · `cd frontend && python3 -m pytest tests/` (FULL
suite — g15 single-dispatcher, reasoning-scrub render contract, expressive-non-collapse) · `test:arch` +
`vault-boundary.test.ts` · the four-place write-back rule + a `callTool` boundary test for any new player tool ·
"game build on" treated as a deploy invariant (Map §F).

---

**GATE:** Awaiting authorization to begin **Wave 1** (off-screen texture enrichment). Waves are single-threaded
and gated — each green on orwell's existing mandate tests before the next. Wave 3 additionally needs the
browser-only-vs-multi-platform product decision.
