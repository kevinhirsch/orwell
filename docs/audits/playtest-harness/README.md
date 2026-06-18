# Orwell LLM Roleplay Playtest & Front-End Audit — Reusable Harness & Playbook

**Status:** living playbook · first authored 2026-06-18 · folds in a full multi-hour audit session.
**Audience:** a fresh agent (or human) re-running this audit from zero, with **egregious** procedural detail.
**One-line goal:** stand up the *real* stack, configure a *real* LLM, then **play the game as a consistent
persona through the actual front-end**, taking notes to debug, fixing in a batch, and re-running — iteratively.

> **You will be supplied an API key at the start.** Treat it as a session secret: store it ONLY in the
> git-ignored sandbox, configure it through the **Settings menu** (not env/source), never commit/screenshot/log
> it, and remind the operator to revoke it when done.

---

## 0. What this audit is (and what the template prompt got wrong)

The canonical audit brief (the "Postdoctoral HCI / Principal Front-End / Autonomous QA" prompt) is written for a
**different product** — a white-labeled job-application "workspace/applicant" portal with a `workspace/` front-door,
a Postgres+Alembic engine, `/api/applicant/*`, résumé/digest onboarding, and an `FR-`/`NFR-` denylist. **None of
that exists here.** This repo is **Orwell**, an immersive single-player *Big Brother* simulation:

- **Engine** = the TypeScript hexagonal core (`/src`), served over an HTTP MCP API (`npm start`, port **8765**).
  It owns game rules, outcomes, the Vault, and is the **single source of truth**.
- **Front-door** = the Python/FastAPI app in **`frontend/`** (a vendored AI-workspace PWA). The Big Brother game
  is **folded into the main chat**; the LLM narrates as game-master/NPCs by calling the engine's Vault-free tools.

So: keep the brief's **rigor and lenses** (spatial/Gestalt/cognitive-load, copy proofreading, autonomous visual
telemetry, the standup→capture→analyze→remediate→validate loop) but **retarget everything at `frontend/` + the TS
engine**. Ignore the `workspace/applicant`/Postgres/`FR-` specifics — they don't apply.

**Two audit dimensions, equally important:**
1. **Visual/UX/copy** — the front-end at Desktop **1440×900** and Mobile **375×812**, plus a copy/proofreading pass.
2. **LLM↔engine integration** — does the model **respect the engine** (the authority for every outcome) and stay
   in character? This is tested by **genuine persona roleplay**, not mechanical button-mashing (see §4, and the
   findings in §9 — this is where the deepest bugs live).

---

## 1. Prerequisites & network

- **API key**, supplied by the operator at the start (OpenRouter, OpenAI-compatible). Default model for this work:
  **`deepseek/deepseek-v4-pro`** (a stronger model than `-flash`; see §9 B6 for why the model matters).
- Outbound egress to: `registry.npmjs.org`, `pypi.org`, the Playwright CDN, and the provider (`openrouter.ai`).
  Probe first: `curl -s -o /dev/null -w "%{http_code}" --max-time 4 <url>`.
- Node 22, Python 3.11 venv, both already present in this repo's toolchain.

---

## 2. Phase 1 — stand up the stack (exact commands + the gotchas that bit us)

### 2a. The engine (TypeScript, port 8765)

```bash
cd /home/user/orwell
npm install --ignore-scripts        # GOTCHA: plain `npm install` fails — fastembed→onnxruntime-node's
                                    # postinstall tries to fetch libonnxruntime.so and dies (ENOENT).
                                    # We don't need it: embeddings fall back to a deterministic fake, and
                                    # esbuild's platform binary still installs. --ignore-scripts is the fix.
npm run build                       # bundles dist/main.js (+ dist/embedWorker.js)
ORWELL_ENGINE_PORT=8765 ORWELL_DATA_DIR="$PWD/.audit-telemetry/engine-data" node dist/main.js
```

- Run the engine with the harness's **`run_in_background: true`**, NOT a bare `&`. **GOTCHA (cost us 20 min):**
  a `&`-backgrounded process is a child of that Bash call's shell; when the tool call returns, the shell exits and
  the child is **reaped** (SIGHUP). The engine appears to die "randomly." `run_in_background` tracks it across calls.
- Health: `curl -s http://127.0.0.1:8765/health` → `{"ok":true,...,"embeddings":{"provider":"deterministic"}}`.
- Embeddings unset ⇒ deterministic fake (fine for the audit). The engine's tool transport is
  `POST /player/call` with `{"name":<tool>,"args":{...}}` and header `X-Orwell-User: <user>`.

### 2b. The front-door (Python/FastAPI, port 7000)

```bash
cd /home/user/orwell/frontend
python3 -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt   # first time only
# create a DETERMINISTIC admin account (auth on = realistic posture + unlocks admin-only settings):
ORWELL_ADMIN_USER=admin ORWELL_ADMIN_PASSWORD='<pick-one>' ORWELL_SKIP_ADMIN_PROMPT=1 \
  ORWELL_SKIP_RUN_HINT=1 ORWELL_DATA_DIR="$PWD/data" python setup.py
# run it (auth ON, loopback bypass OFF, the reduced game build, pointed at the engine):
ORWELL_GAME_BUILD=1 AUTH_ENABLED=true LOCALHOST_BYPASS=false \
  ORWELL_ENGINE_MCP_URL=http://127.0.0.1:8765 ORWELL_DATA_DIR="$PWD/data" \
  python -m uvicorn app:app --host 127.0.0.1 --port 7000
```

- Store the admin password in the git-ignored sandbox (`.audit-telemetry/.secrets.env`).
- Verify: `/login` → 200; `/` → 302 (redirect to login when unauthed); `POST /api/auth/login` with the creds → 200.
- Handshake: `GET /api/orwell/health` → `{"engine":true,...}`.
- **`frontend/data/` is git-ignored** (it holds the SQLite DB with the admin account + the model endpoint +
  **the API key**). The `.audit-telemetry/` sandbox is git-ignored too. The key never reaches a commit.

### 2c. Configure the model THROUGH the Settings menu (admin)

The Settings → AI "add endpoint" form posts to `POST /api/model-endpoints`; the default-model save posts to
`POST /api/auth/settings` (admin-only). Drive those (same store, same effect as clicking the menu):

```bash
# 1) register the provider endpoint (require_admin honored with auth on via the admin cookie):
curl -s -X POST http://127.0.0.1:7000/api/model-endpoints -b cookies.txt \
  -F "name=OpenRouter" -F "base_url=https://openrouter.ai/api/v1" -F "api_key=$OR_KEY" \
  -F "endpoint_kind=api" -F "model_type=llm" -F "require_models=true"     # returns {id: <endpoint_id>, models:[...]}
# 2) set the default chat model (admin-only):
curl -s -X POST http://127.0.0.1:7000/api/auth/settings -b cookies.txt -H 'Content-Type: application/json' \
  -d '{"default_endpoint_id":"<endpoint_id>","default_model":"deepseek/deepseek-v4-pro","default_model_fallbacks":[]}'
# confirm: GET /api/default-chat → {"model":"deepseek/deepseek-v4-pro", ...}
```

- **GOTCHA:** `POST /api/auth/settings` is **admin-only** and the loopback-bypass user is NOT admin — that's why we
  run real auth + a real admin account (§2b), not `LOCALHOST_BYPASS=true`.
- **GOTCHA:** `POST /api/session` (used by the API-driven scripts) wants **form fields** (`endpoint_id`, `model`,
  `skip_validation=true`), not JSON — JSON `{}` returns 400 and then `chat_stream` 404s on the bad session id.
- Validate inference cheaply: `POST $OR_BASE/chat/completions` with `max_tokens:10` → expect real content + a tiny
  `usage.cost`.

### 2d. Playwright, sandboxed (browser deps OUT of the project graph)

```bash
mkdir -p .audit-telemetry/shots && printf '\n.audit-telemetry/\n' >> .gitignore   # never commit telemetry
cd .audit-telemetry
printf '{"name":"audit","private":true,"type":"module"}\n' > package.json
npm install playwright@1.49 --prefix "$PWD" --no-audit --no-fund     # --prefix pins it LOCAL (see gotcha)
PLAYWRIGHT_BROWSERS_PATH="$PWD/.pw-browsers" node node_modules/playwright/cli.js install chromium
```

- **GOTCHA:** without `--prefix "$PWD"`, npm walks up and installs Playwright into the **engine's** `package.json`/
  `node_modules` — polluting the project. If that happens: `git checkout package.json package-lock.json`, then
  reinstall local. Keep `PLAYWRIGHT_BROWSERS_PATH` inside the sandbox.
- **GOTCHA:** match the browser build to the pinned Playwright (1.49 ⇒ chromium build 1148). A mismatched download
  errors at launch; just run the `... cli.js install chromium` for the pinned version.

---

## 3. Reaching game state (no live job boards, etc. — this is Orwell)

- **Create a season fast (debug door):** `POST /api/orwell/new-game` is admin-gated and bypasses the in-chat
  casting interview — `{"playerName":"Avery Quinn","archetype":"social","strategyStyle":"social","seed":51000,
  "confirm":true}`. Great for populating the cast/HUD instantly. `confirm:true` replaces a started game.
- **The roster is engine truth:** `GET /api/orwell/state` → `house[].name` (e.g. Taylor Wong, Summer Mccann, …).
  **Memorize this list** — it is the yardstick for the most important bug class (the model inventing houseguests, §9 B4/B6).
- **GOTCHA — the desync that wasted a run:** creating a game via the debug door while a **casting-interview chat
  session** is open leaves the GM stuck re-casting ("I need to know who you are…"). FIX: start a **fresh chat
  session** (click `#sidebar-new-chat-btn`, or create one via API) — it picks up the live in-game moment prompt.
- **GOTCHA — send trigger:** in the composer, typing flips `.send-btn` `data-mode` from `newchat`→`send`; **Enter
  fires `chat_stream`** once there's text. Do NOT click "New Chat" then immediately Enter — the first Enter can be
  swallowed. (`playSession.mjs`/`gameLoopUI.mjs` handle this.)

---

## 4. Phase — the roleplay methodology (the heart of this audit)

**This is a free-text role-playing game. Embody a consistent identity and play it for real.** Pushing the game
along quickly and artificially (mechanical "continue / advance" nudges) **defeats the purpose** — it skips the
actual experience and won't surface persona/grounding bugs. Instead:

- **Pick a persona and keep it consistent.** Ours: *Avery Quinn — 30, debate coach from Dayton, OH; warm but
  calculating "kitchen spy"; social/relationship game; witty, self-aware voice; loyal to earned trust.* Write
  every player turn **in that voice, reacting to what the house actually said.**
- **Test, every turn:** (a) **persona consistency** — do NPCs keep distinct, stable voices across turns? does the
  GM honor your choices/backstory? (b) **engine grounding** — do the names/outcomes match the engine? (c) **leaks**
  — does any production machinery reach the chat? (d) **UI** — screenshot each beat; check overflow/overlap/contrast.
- **Don't fix mid-play.** Keep a running **defect log** (`/tmp/play/buglog.md`): id, severity, evidence. Fix in a
  batch at season end, then re-run.

### The interactive session daemon (`playSession.mjs`)

Browser automation is one-shot per script, but roleplay needs a **persistent** session you drive turn-by-turn. The
daemon keeps Chromium + the chat session alive and talks over a **file mailbox**:

```
write  /tmp/play/req.json  = {"n":<int>,"text":"<your in-character player line>"}
daemon sends it (agent mode), waits for the GM reply to FINISH, resolves any decision/ask_user card,
then writes /tmp/play/resp.json = {n, gm:<visible message>, leak:<match|null>, card, status:{week,phase,hoh,noms,pending}, shot}
plus a full-page screenshot at .audit-telemetry/shots/play/turn-NN.png
```

Per turn: write `req.json` with the next `n`; `until`-loop until `resp.json.n == n`; read the GM text; **compose
your next line in persona**; repeat. (See the committed `playSession.mjs`.)

- **GOTCHA — the "Thinking" trap:** the naive "wait until message length is stable" latches onto the streaming
  **"Thinking ▅▄▃" placeholder** and captures mid-stream. The fixed `waitDone` waits for the completion **footer**
  (tok/s) AND a non-placeholder body. Use it.
- **Visible vs. reasoning:** strip `.thinking-content` (the collapsible `<think>` block, toggle in Settings →
  Appearance, **on by default**) before judging a leak — a leak in the **player-visible message** is the bug; a
  mention buried in hidden reasoning is secondary (but note it).

---

## 5. Defect taxonomy & verification techniques

| Class | How to detect |
|---|---|
| **Houseguest invention** (worst) | Compare every name the GM uses against `GET /api/orwell/state house[].name`. Any name not on the roster is fabricated. |
| **Engine bypass** (worst) | After the GM narrates an outcome (comp winner / nominee / evictee), read `GET /api/orwell/status`. If `hoh/noms/phase` didn't change, the model invented the result — the engine was never consulted. |
| **Machinery leak** | Regex the **visible** message (sans `.thinking-content`) for: `engine, advanceGame, game state/status, submitDecision, runCompetition, pending, "the player has", "let me check/record/see", "next beat"`. |
| **Decision double-surface** | A binding choice appearing as BOTH the structured `#orwell-decision-card` AND the model's `.ask-user-card`. |
| **Layout: overflow/overlap** | In-page: `scrollWidth>clientWidth`; element right-edge > viewport; a fixed element covering the composer/messages. `getBoundingClientRect` can lie when a `<button>` won't grow to wrapped text — compare `scrollHeight` vs `clientHeight` and **eyeball a crop** (see below). |
| **Copy** | space-before-punct, double-space, kebab slugs rendered as labels, leaked jargon. Dump `page.innerText` per surface and proofread. |
| **Console/page errors** | Collect `pageerror` + `console.error` per surface (some JS crashes surface as UI text). |

- **Screenshot reading:** full-page PNGs of a long chat scale to an unreadable thumbnail. **Crop** the region of
  interest with Pillow (the FE venv has it) and read the crop:
  `from PIL import Image; Image.open(p).crop((0,int(h*0.45),w,h)).save('crop.png')`.
- **Breakpoints:** capture Desktop 1440×900 + Mobile 375×812 for every state; on mobile the sidebar is a drawer
  behind `#hamburger-btn`.

---

## 6. The loop (per the campaign rhythm)

`stand up stack → configure key in Settings → roleplay a persona deep into a season → log every defect (don't
fix mid-play) → at season end, BATCH-fix at the right altitude → re-verify (re-capture / re-roleplay) → repeat.`

**Remediation altitude (front-end):** design tokens / `:root` in `style.css` → shared component classes → the
specific component's CSS/JS → (last resort) inline dimensions. **Engine-side** user-facing strings & the GM prompt
live in `src/engine/momentPrompts.ts` (rebuild + restart the engine after editing). Keep the diff minimal; reuse
existing classes. Validate: `node --check` edited JS, re-capture the surface, and run the green-increment gates
(`npm test` for the engine; `frontend` pytest for FE).

**Review surface:** focused commits on the working branch + a single PR (the diff *is* the review). End commit
messages with the repo's required trailers.

---

## 7. The harness scripts (in this folder — copy into `.audit-telemetry/` to run)

| Script | Purpose |
|---|---|
| `lib.mjs` | capture helpers: full-page PNGs at both breakpoints, the in-page **defect scan** (overflow/offscreen/whitespace/tap-targets), innerText dump, optional API login. |
| `playSession.mjs` | the **interactive roleplay daemon** (mailbox protocol, robust `waitDone`, decision/ask_user auto-resolve, per-turn leak check + screenshot). |
| `namesCheck.mjs` | single clean API turn that **forces a named scene** and checks GM names vs the engine roster. |
| `coreScenes.mjs` / `gameScenes.mjs` / `state1.mjs` | scripted captures of login/home/settings/themes and the game windows (cast, finale, decision card, social, diary, status HUD). |
| `gameLoopUI.mjs` | a *mechanical* through-the-UI driver (sends agent turns, answers cards/ask_user) — useful to confirm the engine integration works under explicit prompting, and to reach late states fast. **Not** a substitute for persona roleplay. |

All scripts read secrets from `.audit-telemetry/.secrets.env` (`ADMIN_USER/ADMIN_PW/OR_KEY/OR_BASE/OR_MODEL`) and
write to `.audit-telemetry/shots/`. They are committed here **as reference tooling**; the runtime sandbox, browsers,
secrets, and screenshots stay git-ignored.

---

## 8. Operational gotchas (hard-won)

- **Container restarts** wipe all running processes (engine/FE/daemon) and in-memory engine game state (FE chat
  sessions + the model config persist in `frontend/data`). On restart: re-`run_in_background` the engine + FE,
  re-login admin, recreate the season. Committed code is safe; push often.
- **`pkill` returns 144** (the signal it sent) and can abort a chained command — run `pkill` on its own line, then
  the next step separately.
- **Don't poll** for background tasks — `until <cond>; do sleep 2; done` as a `run_in_background` job, then act on
  the completion notification. Foreground `sleep 75` is blocked by the harness.
- **The `.welcome-active` composer** sits ~30vh up the page (empty chat) vs bottom-pinned (active chat) — anything
  anchored to the bottom must read `--composer-clearance` (kept synced by `init.js`) and be welcome-state-aware.

---

## 9. Findings ledger — 2026-06-18 run (deepseek-v4-flash)

**Fixed & verified this run (PR #290):** "Bedroom b"→"Bedroom B" (`orwellPresence.roomLabel`); theme kebab labels
(`theme.js`); orphaned settings subtitle (`index.html`); "Wants a word" chip text-overflow (`orwellSocial.js`);
GM machinery leak — hard *NEVER NAME THE MACHINERY* + no-operator-asides rule (`momentPrompts.ts`); presence strip
**docked into the sidebar** as "Where you are" chrome + bottom-slot composer-clearance (`orwellPresence/orwellSlots/
init`); **NAMES ARE FIXED** rule — move-in now uses the real roster (`momentPrompts.ts`).

**Open (fix in the next batch):**

| ID | Sev | Finding | Direction |
|---|---|---|---|
| **B6** | **CRITICAL** | In **immersive** roleplay the model narrates the *entire* game — incl. who wins HOH — as fiction and **never consults the engine** (engine stayed `premiere`/`hoh:None` while the GM crowned the player). Defeats engine-authority/anti-sycophancy. | **Not** engine-driven progression (that flattens the dynamic DM nuance the operator wants). Instead: let the model DM within **defined constraints + guardrails**, with **engine error-correction** — e.g. it may NOT narrate a comp/nom/vote result until it has the engine's result; the engine validates and corrects drift (names, outcomes). **Try `deepseek-v4-pro`** (flash was too eager to improv / too weak to obey). |
| B5 | High | Model narrates progression but doesn't `advance` on in-character cues (only on mechanical "run the competition" prompts). | Same fix family as B6. |
| B4 | High | Still invents **new** houseguests mid-scene ("Dante Cross, ex-military") despite NAMES-ARE-FIXED; the fake name then persists. | Roster-validate names (engine error-correction), and/or stronger model. |
| B1 | Med | Residual operator-aside preambles ("let me check…", "the player has…") on some replies. | Stronger model; optional FE strip of a leading meta-sentence. |
| B2 | Med | Binding decisions double-surface (structured card + `ask_user`). | Decide which surface owns binding commitment (ADR 0003 → the structured card). |
| B3 | Med | Eviction sub-loop can loop on `advance` at the goodbye-message stage. | Investigate the advance/pending handshake. |

**What's GOOD (keep):** the casting → move-in experience and the **persona layer** are excellent — distinct,
consistent NPC voices across turns (Taylor warm/perceptive, Cassandra cold/analytical, Summer the silent grinder),
the GM tracks threads and honors the player's backstory, and with the fixes there were **zero machinery leaks** in
a clean 7-turn run. The dynamic, nuanced DM quality is the thing worth protecting — the fix must add guardrails
**around** it, not replace it.
