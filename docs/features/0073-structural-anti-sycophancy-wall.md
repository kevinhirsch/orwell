# 0073 — Structural anti-sycophancy wall: make the game-build boundary a CI gate

**Status:** spec (BDD-first). **Priority:** Wave 3 of the Hermes→Orwell integration
(`docs/HERMES-INTEGRATION-PLAN.md`) — independent hardening; can land before or after 0071/0072.
**Provenance:** orwell-native — no hermes code lifted. Closes the asymmetry identified in the
integration audit (2026-06-22): the Vault Wall is structural/compile-time (dependency-cruiser fails
the build on any forbidden import); the anti-sycophancy wall is runtime/env-gated (`ORWELL_GAME_BUILD`
default-on, but silent when flipped to `0`).

## Why

The Vault Wall is proven at **build time**: dependency-cruiser rejects any module that imports
`VaultStore`/`VectorIndex`/`SoulProvider`, making a leak a CI failure on the PR that introduced it.
The anti-sycophancy wall has no equivalent — it is enforced only at runtime by `game_build_enabled()`
reading an env flag. A developer who sets `ORWELL_GAME_BUILD=0` to debug silently re-exposes:

- **Drop-set routes** (`memory`, `rag`, `skills`, `email`, `documents`, `deep_research`, etc.) via
  `mount_optional` — the router is conditionally registered, not absent.
- **Context injection** (`front_end_context_sources`) — memory/RAG/skills/web injection into the
  chat preface, which would rival the engine's narrator framing and reintroduce the user-modelling
  surface the game build is supposed to wall.
- **Drop-set JS** (`dropped_script_srcs` / `strip_dropped_scripts`) — the JS files for the dropped
  verticals are physically deleted from the shipped tree, but the strip logic remains as a guard;
  new accidental `<script>` tags for deleted files would return 404 silently rather than being
  caught.
- **Tool manifest leakage** — any inherited-workspace tool whose MCP surface the game build should
  gate (0072 multi-platform gateway) could become reachable if a new tool is added to the FE
  without going through `mount_optional`.

The integration waves (0070–0072) add new outward surfaces. Each one is **only as safe as the
game-build wall**: the multi-platform gateway (0072) specifically needs the wall proven before it
ships, because a messaging platform has no in-browser accordion to hide reasoning and no admin to
notice a leaked feature.

## The shape

A **dedicated pytest gate** (`frontend/tests/test_game_build_wall.py`) that:

1. **Pin-tests the wall with `ORWELL_GAME_BUILD=1` forced inside the test body** (monkeypatching
   `game_build_enabled` / setting the env var before the module-under-test is imported) so the
   gate passes the correct assertion regardless of the ambient CI environment. CI cannot accidentally
   run with the wall off and still pass.

2. **Set-purity assertion** (static, no I/O):
   - `GAME_DROP_SET ∩ GAME_KEEP_SET = ∅` — no feature can be simultaneously kept and dropped.
   - Every name in `GAME_DROP_SET` returns `is_feature_enabled(name) == False` under game build.
   - Every name in `GAME_KEEP_SET` returns `is_feature_enabled(name) == True` regardless of game
     build state.

3. **Context-injection assertion** (pure function call, no I/O):
   - `front_end_context_sources()` under game build returns all `False` for every key — no
     inherited-workspace context ever injects into the chat preface.

4. **JS-strip assertion** (pure function call, no I/O):
   - `dropped_script_srcs()` under game build includes every entry in `GAME_DROP_SCRIPTS`.
   - `strip_dropped_scripts(html)` removes every drop-set `<script>` src from synthetic HTML that
     contains them all, and leaves a non-drop-set `<script>` untouched.

5. **HTTP-level route gate** (live server, analogous to `boot_smoke.py`):
   - Boots the FE with `ORWELL_GAME_BUILD=1` and verifies a representative set of well-known
     drop-set API endpoints return **404** (not 200, not 403, not 500).
   - Verifies a keep-set endpoint (e.g. `/health` or `/api/game`) returns something other than 404.
   - This is the structural equivalent of dependency-cruiser for the Python tier: a forbidden route
     is provably absent at the transport level.

6. **CI wiring**: the `game_build_wall` step is added to the frontend CI job (beside `boot_smoke`
   and `browser_smoke`), running the HTTP gate with `ORWELL_GAME_BUILD=1` forced via the subprocess
   environment. It is a **required** step — the frontend CI job cannot pass with the wall broken.

## Invariants (BDD/unit)

- **Set purity.** No feature is in both `GAME_DROP_SET` and `GAME_KEEP_SET`; every drop-set feature
  returns `is_feature_enabled == False` under game build.
- **Context injection is zeroed.** `front_end_context_sources()` is all-false for every inherited
  source under game build; `web` auto-injection is off even though `web_search` is a keep-set tool
  (the tool call vs. automatic preface injection distinction — see `front_end_context_sources` note
  in `settings.py`).
- **JS strip is complete.** Every entry in `GAME_DROP_SCRIPTS` appears in `dropped_script_srcs()`
  under game build; synthetic HTML containing them all is fully stripped.
- **Drop-set routes are absent at HTTP.** Under game build, the representative drop-set endpoints
  return 404 (the path is never registered, not merely guarded).
- **Keep-set routes are present.** A keep-set health/game endpoint is reachable.
- **Gate is env-pinned.** The test body forces `ORWELL_GAME_BUILD=1` and cannot pass with the wall
  accidentally disabled in the ambient environment.
- **No mandate surface touched.** This spec adds tests only; it does not alter game logic, engine
  tools, narration, or any Vault surface.

## Implementer handoff / open questions

- **Representative drop-set endpoints for the HTTP gate.** Pick 2–3 stable paths that are clearly
  in the drop-set (e.g. `/api/memory/search`, `/api/rag/query`, `/api/skills/list`) and unlikely
  to be repurposed. Document them in the test so future maintainers know why they are there.
- **Keep-set health endpoint.** `/health` (if it exists) or any stable keep-set route; confirm
  with `boot_smoke.py`'s existing probe.
- **Engine stub.** The HTTP gate must start the FE without a live engine; either mock `ORWELL_ENGINE_MCP_URL`
  to a non-existent address (the FE should start regardless) or reuse the existing `boot_smoke.py`
  startup fixture.
- **CI job ordering.** `game_build_wall` can run in parallel with `browser_smoke` (it's a fast
  HTTP-only smoke); it should run after `boot_smoke` confirms the FE starts at all.
- **Future proofing.** When a new inherited-workspace vertical is added to `GAME_DROP_SET`, the
  HTTP gate's representative list need not be exhaustive — the set-purity + context-injection
  assertions cover it structurally. Add an HTTP probe only for verticals with novel routing
  patterns.
