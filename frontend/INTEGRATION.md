# Vendored: Orwell — Orwell's player front-end + LLM/agent tier

## What this is

A vendored copy of **Orwell** (https://github.com/kevinhirsch/orwell, MIT —
see [`LICENSE`](./LICENSE) and [`ACKNOWLEDGMENTS.md`](./ACKNOWLEDGMENTS.md), retained intact).
Orwell is a self-hosted AI workspace: **Python (FastAPI) backend + vanilla-JS PWA**, with a
multi-provider LLM connection (Ollama, OpenAI, OpenRouter, Anthropic, llama.cpp, vLLM) and an
**agent** built on opencode / MCP.

We reuse it as Orwell's **player front-end + LLM-connection + agent tier** rather than building
those from scratch.

## Role in Orwell (polyglot, two tiers)

- **Orwell core** = the TypeScript hexagonal **engine** (`/src`) — game rules, the Vault, ports.
  Stays the single source of truth.
- **`frontend/`** (this) = a **Python service** — the UI + LLM connection + agent. Runs as its
  **own process**, separate from the Node engine.
- They meet over a **permissioned boundary** (below) — the MCP boundary the design always
  planned; the narrative LLM was always meant to sit behind a port.

## Quarantine (important)

`frontend/` is intentionally **outside** Orwell's TypeScript tooling — `tsconfig.json`
(`include: src, tests, features`), Vitest (`tests/**`), Cucumber (`docs/features`), and
dependency-cruiser (`src`) do **not** touch it. The Vault-Wall architecture test is unaffected.
Treat `frontend/` as a separate app with its own deps (`requirements.txt`, its own
`package.json`).

## MVP keep-set

**Chat UI + multi-provider LLM connection + agent (MCP/tooling).** The agent is the
integration linchpin — it's what drives the game.

## Integration plan (the refactor — next)

1. The Orwell engine exposes the game as a permissioned **MCP server**: `getVisibleStateFor`,
   `recordInteraction`, `runCompetition`, `surfaceInformationTo` (the tools in
   `CLAUDE.md` / the spec). These return **only visible-projection data**.
2. Point Orwell's agent (`routes/mcp_routes.py`, `mcp_servers/`) at that MCP server as a
   tool backend; the LLM narrates *Big Brother* by calling the engine tools.
3. **The Vault Wall holds by construction:** `frontend/` never imports `VaultStore` and only
   receives visible projections over the boundary — the model can't leak what it never gets.
4. Build the BB-specific surfaces (narrated scene view, Diary Room, house/houseguest panels)
   on top of the chat shell.

## Wired now: the game IS the main chat

The Big Brother game is folded into the **main chat** — there is no separate game page. The
standalone `/orwell` slice has been retired; onboarding and in-character play happen in the real
app, so they inherit its session, streaming, SSE sync, and provider plumbing for free.

- **`src/orwell_engine.py`** — thin async client to the engine's HTTP MCP player channel
  (`ORWELL_ENGINE_MCP_URL`, default `http://127.0.0.1:8765`): `createCharacter`, `getGameState`,
  `getMomentPrompt`. Consumes only Vault-free results.
- **`routes/orwell_routes.py`** — the onboarding + state seam: `GET /api/orwell/{health,state,moment}`
  and `POST /api/orwell/new-game` (runs OOBE). **No bespoke chat route** — chat is the main chat.
- **In-character main chat** — `routes/chat_helpers.py:build_chat_context` prepends the engine's
  **managed per-moment game-master system prompt** (`getMomentPrompt`) to the main chat's system
  message whenever a game is in progress. This is what makes every turn speak as the game master,
  across both the streaming and non-streaming paths (they share `build_chat_context`). Best-effort
  and Vault-free; if the engine is down the chat simply isn't framed (no disruption).
- **First-class onboarding** — `static/js/orwellOnboarding.js` overlays character creation in the
  main app when `GET /api/orwell/state` reports no active game; on submit it `POST`s
  `/api/orwell/new-game` and dissolves into the chat. It **fails open** (engine down → never blocks
  the chat).
- **Cross-device sync comes free** — because play is the main chat, the existing session +
  SSE sync (`session_events` / `sessionSync`) already covers a game session across devices.

### Try it

1. Run the **engine**: from the repo root, `npm run build && ORWELL_ENGINE_PORT=8765 npm start`.
2. Run **Orwell** (this app) and log in; ensure a **default chat model** is set in settings.
3. You'll be asked to **create your houseguest** before the chat; then just chat — every turn is
   in-character. Open the same account on a second device to see the session sync.

### Driving the game (agent action tools)

In **agent mode**, the model can also *act* on the game, not just narrate it — the engine's
Vault-free player tools are exposed as function-calling tools (`src/tool_schemas.py` +
`src/tool_implementations.py` + `src/tool_execution.py`, relayed via `src/orwell_engine.py`):

- **`getGameState`** — week/phase, the player card, the house roster (names only).
- **`runCompetition`** — the **engine** resolves a competition over the live house from its OWN
  hidden stats and returns only the winner's name (no stats/scores ever cross the wall). The model
  requests it, the engine decides — anti-sycophancy holds.
- **`recordInteraction`** — record a player-present scene as a game event (player knowledge).
- **`surfaceInformationTo`** — move a fact into the player's knowledge via a named in-game pathway.

The engine enforces the Vault Wall on every result, so the model can drive the game without ever
seeing secret state.

**Still managed by the engine, not here:** game state lives in the engine process (in-memory
today; persistence is feature 0007). The deep loop (competitions, nominations, votes driving the
phase/moment) is the engine's weekly-loop work (feature 0011) — the main chat picks up those
moments automatically as the engine advances them.

## What was trimmed (footprint only — no application code removed)

Removed to keep the repo lean; none of it affects chat/agent:
- demo media (`docs/*.gif|*.webm`), marketing docs (`docs/`, `ROADMAP`/`SECURITY`/`THREAT_MODEL`/`CONTRIBUTING`),
- deployment scaffolding (`docker/`, `docker-compose*`, `Dockerfile`, build/start/launch/install scripts, `*.service`, `.github/`),
- Orwell's own `tests/`,
- heavy document-export libs (`static/lib/{xlsx,docx,mammoth,html2pdf}*`).

The Python app and front-end JS are intact and coherent.

## Deferred: the deep code-level prune (do against a *running* Python env)

A leaner cut down to **just chat + LLM + agent** — dropping the email, calendar, contacts,
research, cookbook/hwfit, compare, documents/editor, gallery, notes, tasks, voice (tts/stt),
youtube, webhooks, search, shell, and memory/skills verticals (their `routes/` + `services/` +
`static/js/` + `app.py` wiring + `index.html` script tags) — is the next pass. Because it edits
the 1,111-line `app.py` and the front-end shell, it must be **verified against a running
instance** (Python deps installed, config set), not done blind.

## Running Orwell standalone (reference)

See [`README.md`](./README.md) and `requirements.txt` (FastAPI + uvicorn); `.env.example`
documents config. During the refactor we'll run it as the Orwell front-end service.

## The golden-path gate (0108 — record once, replay in CI)

The model↔engine seam has a real-model regression gate: one recorded run of the golden path
(casting → premiere → Week 1 → eviction → week roll) replays deterministically against the
real engine + real FE on every PR — no API key (`.github/workflows/ci.yml` job
`golden-path`), with a secret-gated nightly re-record (`golden-nightly.yml`). The seam is
`src/golden_path.py`, wrapped inside `llm_core.stream_llm_with_fallback` / `llm_call_async`
(byte-identical when neither env var is set).

- **Regenerate the fixture** (required whenever a prompt/tool-schema change makes the replay
  miss — that miss is the gate working):
  `cd frontend && OPENROUTER_API_KEY=sk-… ORWELL_GOLDEN_RECORD=1 python3 scripts/golden_path_record.py`
  then commit `tests/golden/golden_path_glm-5.2.jsonl` (defaults record the owner's two-tier
  pair: GLM 5.2 narration + Qwen 3.6 Flash utility). The nightly's uploaded artifact is the
  same thing pre-baked: download, eyeball the invariant diff, commit. **One driver run at a
  time** — `frontend/data` is shared state; the driver pre-flight scrubs stale cross-run
  state (canonical binding, old golden sessions/endpoints) before boot.
- **Run the PR gate locally**: `python3 scripts/golden_path_replay.py --runs 2`.
- The fixture is Vault-free by construction and leak-scanned on both record and replay
  (`golden_path.fixture_leak_scan`); format 2 is **self-describing** (leading `meta` line +
  per-record `writer` stamps) and `fixture_integrity_scan` fails any multi-writer or
  off-declared-model fixture — the mid-run resolution-flip class that silently contaminated
  the first GLM recording. A new LLM-behavioral fix still needs a hand live-verify
  first (SOUL lesson 19) — this gate stops the *same* bug being re-discovered by hand.

## The visual-regression harness (0113 — screenshot matrix + off-screen detector + baselines)

A pixel-level sibling to the golden-path gate, tracking issue #1237. Rides the SAME committed
golden fixture (`ORWELL_GOLDEN_REPLAY`, key-free, deterministic) to park a real engine + real FE
walk at a canonical mid-week state (Tier A: 6 surfaces x 4 viewports x 5 house themes, ~120
shots) and at up to 7 journey beats (Tier B: casting → premiere → hoh → nominations → veto →
eviction → finale, x 2 viewports, ~14 shots — `finale` reports SKIPPED until a finale-covering
fixture is recorded, never fabricated). Two independent checks per shot:

- **Geometry/off-screen detector (BLOCKING)** — one DOM pass, off-viewport / clipped-by-ancestor
  / zero-size / covered. Pure classification lives in `src/visual_geometry.py`
  (`classify_shot_geometry`, unit-testable with no browser); the extraction JS is
  `GEOMETRY_PROBE_JS` in the same module.
- **Pixel diff vs. blessed baselines (ADVISORY)** — pure PIL (`src/visual_pixeldiff.py`), no new
  heavyweight dependency. A shot id with no blessed baseline reports `baseline-missing`
  (explicit, never a silent pass). Masks (`MaskRect`) blank out known time-varying regions (a
  wall-clock readout) in both images before comparison.

- **Run it**: `cd frontend && python3 scripts/visual_regression.py --tier all --out /tmp/visual-run`
  (needs `npm run build` at the repo root first, and `playwright install chromium`).
- **Bless a new baseline set**: `python3 scripts/visual_bless.py --run /tmp/visual-run --source "ci-artifact:<run-id>"`
  — one command, works on any conforming run directory (a local run or an unpacked CI artifact).
  **Policy: bless from CI artifacts, not local renders** (font/AA drift between machines would
  otherwise poison the baseline for everyone else) — the script prints a reminder but does not
  refuse (it can't structurally verify provenance).
- Baselines live in `tests/visual/baselines/` (PNGs + `manifest.json`, committed — the repo is
  private). CI job `visual-regression` is DORMANT (an explicit notice, never a silent pass) until
  the same golden fixture the `golden-path` job needs is committed; an empty baselines set is a
  legitimate first run (every shot advisory-skips its pixel compare; geometry still blocks).
- Design note: `docs/features/0113-visual-regression-harness.md`. Extends
  `scripts/responsive_matrix.py` (Stream S, ruling #16) without duplicating its
  overflow/overlap/tap-target duties.

## The responsive contract (Stream S — ruling #16; binding)

`static/css/responsive-tokens.css` (loaded **before** `style.css`) is the one responsive
mechanism. The rules, enforced by `tests/test_s_responsive_mechanism.py` (source gate) and
`scripts/responsive_matrix.py` (runtime gate, in CI):

- **Breakpoints are tokens**: every `@media` width is one of **480 / 768 / 1024 / 1440**
  (complements 481/769/1025/1441 for `min-width` pairs). Container tiers: **360 / 620**.
  Viewport queries are for *page chrome only* — anything draggable or dockable responds to
  `@container`.
- **JS never compares `innerWidth` to a literal** — use `isNarrow()` / `isBelowMedium()` /
  `onNarrowChange()` from `static/js/platform.js` (matchMedia-backed; kills the 768
  off-by-one that was written four different ways).
- **Type sits on the rem scale** (`--fs-2xs` … `--fs-xl`); the floor for any UI text is
  `--fs-2xs` (~11px). The root font is fluid (`clamp()`), so rem surfaces breathe and the
  density classes actually work; `text-size-adjust: 100%` is set.
- **Touch**: one `(pointer: coarse)` floor on `--tap-min` (44px height / 36px width) for
  buttons, role=button, selects, and settings tabs; `.tap-exempt` opts out.
- **Installed app**: real maskable icons (192/512 + 180 apple) are precached and asserted
  by the gate; the `display-mode: standalone` tier pads fixed chrome with
  `env(safe-area-inset-*)`. A vendored update must not regress the manifest/SW posture.
- **The matrix gate ratchets**: known failures live in `responsive_matrix.py`'s `XFAIL`
  registry keyed by finding ID; landing a finding removes its entry in the same PR.
