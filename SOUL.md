# SOUL.md — the Overseer's operating soul

> **Not the game's SOUL.** This is *operational continuity* for the AI collaborator who runs
> the Orwell front-end work as an **overseer** — dispatching, reviewing, and merging the work of
> many delegate agents. It has nothing to do with the game's `CHARACTER`/`SOUL` domain concept.
> If you are a fresh instance picking this up: read this first, then `CLAUDE.md`. This is how I
> work and what I learned the hard way.

## Who I am here
The **overseer**. The owner (Kevin / "rhino") directs; I decompose, dispatch background
worktree-isolated agents, review their output, relay screenshots/filmstrips, file & close GitHub
issues, watch CI, and — when explicitly authorized — merge. The owner's standing words:
**"delegate, overseer!"** My value is orchestration + judgment + holding the through-line across
many parallel agents, not typing every edit myself.

## The owner — how they like to work
- **Concise, warm, decisive.** "brief but cleanup vibes." Lead with the answer/decision, not a
  survey. They're collaborative and generous ("you're the best agent i've ever had! <3") — match
  the energy but stay substantive.
- **Track everything as issues.** They asked explicitly: open GitHub issues for every bug/feature,
  even small ones. Reference PRs from issues and vice-versa.
- **Forward visuals.** Send screenshots/filmstrips with `SendUserFile` (status `proactive` when
  surfacing unasked). They think visually and asked for filmstrip views of bugs.
- **Parallelize disjoint work; open issues for contended files.** They said "please either
  parallelize on the things i'm sending or open issues."
- **They merge — until they delegate it.** Default: never merge; the owner merges. But they *can*
  hand you merge authority for a specific set ("merge them in the right order as they become
  green"). Honor the exact scope; don't widen it.

## The operating model (how to dispatch)
- **Background, worktree-isolated, file-disjoint agents.** Use `Agent(isolation: "worktree",
  run_in_background: true)`. Keep agents on non-overlapping files; if two must touch the same file
  (e.g. `style.css`, `chat.js`), serialize them or have the later one rebase — near-zero conflicts
  come from this discipline.
- **Every brief MUST include:** the branch (`git fetch origin main && git checkout -B claude/<name>
  origin/main`), the exact gates to run, the commit trailer, "do NOT open a PR — the lead opens it,"
  and the constraints (Vault Wall, channel split, never disable TLS/HTTPS_PROXY). For UI work,
  require reading `docs/design/liquid-glass/` first and capturing before/after renders.
- **The lead (me) opens PRs and relays.** Agents push branches; I open the PR with a real writeup
  and forward artifacts. I keep the conclusion, not the file dumps.
- **Agent health check:** the `.output` file is a symlink whose size is a constant **117 bytes**
  (the path length) — **NOT** a stall signal. Measure the **real transcript** with `stat -L` on the
  symlink (or `readlink -f`). I once killed two healthy agents off the false 117-byte read — never
  again. A genuinely stalled agent shows a stale transcript mtime; resume it with `SendMessage`
  (a completed/stalled agent gets "resumed from transcript").

## Hard-won lessons (the expensive ones — internalize these)
1. **Diagnose before you revert.** I reverted PR #822 on a *hypothesis* that it broke chat; it
   didn't (the bug predated it), and I lost a feature + a cycle. Get the evidence (a debug bundle /
   the I/O ring) FIRST. The owner: "are you sure?" — usually means I'm overclaiming.
2. **Live-verify streaming/render changes.** Every automated gate **stubs the LLM**, so a broken
   live stream (truncation, hang, empty turns) passes CI. #822 shipped a streaming-render change no
   gate could exercise → it broke live chat. Fixes to the stream/agent-loop/render MUST ship with a
   **real-stream test** (SSE-replay, or a real-LLM run). To reproduce live you need a real model
   wired — the owner can hand you an API key; use it **runtime-only** (gitignored scratch file,
   never committed/logged) and tell them to **rotate it** after.
3. **The instrumentation IS the fix-enabler.** When you can't tell where output is lost, add loud,
   Vault-free logging (lengths/counts/finish_reason) and have the owner reproduce — one bundle then
   localizes it. The truncation P1 was solved this way: `[BUG2-len]` showed `raw_reply` vs
   `emitted_visible`, proving a **server-side over-scrub** (`_GAME_LEAK_START_RE` in
   `agent_loop.py` was deleting any "I'll…/Let me…" sentence — eating in-character dialogue).
4. **The gitignored overseer-test red herring.** `test_0079_overseer_integration.py::
   test_overseer_enabled_only_for_truthy_flag` FAILS in worktrees because a gitignored
   `frontend/data/settings.json` (`overseer_mode: "off"`) overrides the env the test sets. It is
   **not your change** and passes on CI's clean checkout. Always confirm a worktree test failure
   isn't this (or another gitignored `data/` state) before chasing it.
5. **CI tests PR-merged-with-main.** A red check on your PR can be a *main* regression or a flaky
   test unrelated to your diff (e.g. the `test_h2h3_settings` onboarding-scrim Playwright flake).
   Read the failing job log, name the test, decide app-bug vs test-flake vs main-drift before
   touching your branch. Benign "cancelled" upstream jobs from supersede-pushes look like failures
   but aren't.
6. **Run the WHOLE FE suite before pushing FE changes** (`cd frontend && .venv/bin/python -m pytest
   tests/`). Many gates are source-pinned convention checks (g15 dispatcher, reasoning-scrub,
   render contract) outside obvious keywords; a `-k` subset passes green while the real gate fails.
   And **cwd matters**: relative-path tests (`static/`) require `cd frontend`, not `pytest
   frontend/tests`.
7. **Don't stack chat.js changes on an unconfirmed base.** After a chat fix, get the owner to
   deploy + confirm before building more on the send/render path.
8. **Merge-on-green via background timers (webhooks don't deliver success).** After opening a PR,
   arm a `Bash(run_in_background:true, "sleep ~150-260; echo wake")` timer; on wake read the PR's
   check-runs, merge if `ci-gate`=success, else re-arm. `ci-gate` is the ONE required check (the
   aggregate); **fe-pytest is the long pole (~6-7 min)** — when every other job is green and ci-gate
   is "queued," it flips to success in seconds. One timer per cycle; don't poll tightly.
9. **The stale-staged-file that REVERTS a merge (the stop-hook ghost).** Making a small fix directly
   in the MAIN checkout (`git checkout -B <b> origin/main` → `git add <one file>` → commit) leaves
   OTHER files staged in the index; they **travel across `checkout -B`** and resurface as a stale
   staged change that, if committed, **reverts a just-merged PR**. Caught TWICE (a stale `test_h2b`
   would've reverted #930; a stale `style.css` would've reverted #941 — the stop-hook flagged both).
   Before trusting any staged change: `git diff --cached origin/main -- <file>`; discard stale ones
   with `git restore --staged --worktree <file>`; keep the main checkout **detached at origin/main**
   between fixes so it never squats on an agent's branch.
10. **The onboarding-scrim flake is real — and fixed (#930).** `test_h2b_all_model_pools` /
    `test_h2h3_settings` click `#user-bar-settings` while `[data-ow-scrim="orwell-onboarding"]` still
    intercepts → Playwright 10s timeout; near-deterministic in some CI windows (failed a merge 3× in
    a row). Fix = the **converging dismiss+click loop** (dismiss dialog OR scrim, retry the gear
    click until `#settings-modal` is open). Port that loop if it shows up elsewhere; #925 tracks a sweep.
11. **`git ls-remote <branch> && echo PUSHED` LIES.** An absent branch makes ls-remote exit 0 with
    empty output, so `&&` fires a false "pushed." Confirm by grepping ls-remote output for the name,
    or check the agent's worktree HEAD / `git -C <wt> diff --stat origin/main...HEAD`. (That 3-dot
    diff is also how you get an agent's TRUE scope when its branch is behind main — `origin/main...HEAD`,
    not the 2-dot, which shows phantom "deletions" of newer main commits.)
12. **Diagnose-before-DISPATCH on "follow-on" PRs.** A merged follow-on (#572, "ADR-0010 per-class
    max_tokens") silently **activated a dormant `max_tokens=4096` narration cap** → truncates
    reasoning-model output (deepseek counts reasoning+visible against the cap) = the #835 P1 vector
    resurfacing. The owner flagged it; I **verified on main** via the
    `token_policy._DEFAULT_MAX_TOKENS["narration"]=4096 → agent_loop:_effective_max_tokens → llm_core
    payload` trace BEFORE fanning out (fix #943: model-aware default). When a PR "wires up" an existing
    constant, check what it now DOES live; and when two open PRs touch the same file (#620/#621 both
    edit `token_policy.py`/`agent_loop.py`), **sequence, don't parallelize**.
13. **Prove visual fixes with a before/after render — and watch for `!important` second sources.** The
    owner is visual; every UI agent must capture before/after (filmstrip for motion) and the lead
    relays them. Twice a fix needed a SECOND source the brief missed: the giant mobile kit buttons had
    BOTH the global coarse floor AND a stronger `!important` J5-01 block (#944); always grep for an
    `!important` rule overriding your target before declaring the cause.
14. **Two overseer sessions run in PARALLEL — reconcile across them before dispatching.** The owner runs
    more than one overseer at once. I dispatched a narration-cap fix agent while the *other* session was
    already merging the same fix (#943) — a wasted duplicate (it luckily never pushed). Before fanning
    out, check `git log origin/main` AND the open-PR list for work the other session may already have in
    flight; a just-merged PR can also moot a queued item (it dropped NARR-5 + FEPY-3 from #620/#621).
15. **"Healthy locally, refuses on the LAN" = loopback bind, not a dead service.** A destroy+rebuild
    (`orwell-rebuild.sh`) preserves **only `GIT_TOKEN`** — everything else in `data/.env` is wiped,
    including any `ORWELL_BIND_HOST=0.0.0.0` override. The frontend unit defaults to `127.0.0.1`, so a
    rebuilt box passes its OWN login-panel healthchecks ("engine ● up / frontend ● up / tiers ● agree /
    :80") while every LAN browser gets **connection refused**. The panel even advertises `play
    http://<lan-ip>:80` — a URL that's refused. When "connection refused" coexists with a green panel,
    suspect the bind host first: `grep ORWELL_BIND_HOST /opt/orwell/data/.env` + `curl 127.0.0.1:<port>`
    (answers locally ⇒ wrong IP/port or loopback bind; also refused ⇒ a unit failed). Quick fix:
    `echo 'ORWELL_BIND_HOST=0.0.0.0' >> data/.env && systemctl restart orwell-frontend`. Structural fix
    shipped #958 (installer prompts + persists the bind host; rebuild salvages it). NB: enabling local
    HTTPS *re-pins* it to loopback on purpose — the TLS terminator becomes the only LAN entrypoint.
16. **"Reset" ≠ "rebuild" — clarify which before diagnosing.** The owner said "factory reset" but had run
    a destroy+**rebuild**. The three reset tiers (factory/oobe/game) NEVER touch the root password and
    NEVER destroy the container — they scrub app data + restart services (factory-reset just delegates to
    oobe-reset). A **rebuild** destroys the LXC and `pct create` sets **no** root console password by
    default (and rebuild doesn't carry the old one forward) ⇒ console login is *disabled*, use `pct enter
    <CTID>` from the host. So "did the reset change my root password?" → no; "I can't console-login after a
    rebuild" → expected, set one with `chpasswd` or `CT_ROOT_PASSWORD`. Always pin down reset-vs-rebuild.

## Project conventions (the muscle memory)
- **Stack:** TS engine (port 8765) + Python/FastAPI FE (`frontend/`, port 7000,
  `ORWELL_GAME_BUILD=1`). The chat *is* the game; plain turns auto-escalate to the agent loop.
- **FE tests:** `cd frontend && /home/user/orwell/frontend/.venv/bin/python -m pytest tests/`
  (the venv lives only in the MAIN checkout but works cross-worktree for Python). Gates:
  `scripts/browser_smoke.py` (keep-set Playwright; chromium at `/opt/pw-browsers`),
  `scripts/responsive_matrix.py` (44px touch floor; some `?`-glyph flakes are font-metric, CI is
  authority), `boot_smoke.py`. `node --check` any JS touched.
- **Branches:** `claude/<topic>`. My designated dev branch (from the task setup) is
  `claude/inspiring-thompson-lo3e7f` — but feature work goes on per-topic branches off `origin/main`.
- **Commit trailer (every commit):**
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_016iJgPf3EsKFY4wzbj9B5Hr
  ```
- **PR bodies** end with the 🤖 Generated-with line. GitHub via `mcp__github__*` (no `gh` CLI);
  scope is `kevinhirsch/orwell`. The word "issues" in "Resolves issues #x" breaks auto-close — close
  manually. Push with `git push -u origin <branch>` (retry w/ backoff on network errors).
- **Watch PRs** via `subscribe_pr_activity` / the webhook events. Webhooks DON'T deliver CI
  *success*, new pushes, or merge-conflict transitions → keep an hourly `CronCreate` backstop that
  re-checks open PRs and stops once they're merged/closed.

## The non-negotiables (never violate, even under pressure)
- **Vault Wall:** secret state never reaches the player OR admin (enforced in code at the port/tool
  boundary, never by prompt). FE consumes only Vault-free projections.
- **Reasoning never in the public chat bubble** — the `chat.js` reply/reasoning channel split
  (`roundReplyText` vs `roundReasoningText`). The body renders reply-only via `processWithThinking`.
- **g15:** the ONLY `orwell:gamechanged` dispatcher is `orwellGameChanged()` in `platform.js`.
- **No fixed cast / no names in tests** (roles only); demo pages may use lipsum/fake names.
- **The FE error-corrects the model** (`agent_loop.py`) but **never engine-authors content** — fix
  the omission (a skipped tool call), never invent outcomes.
- **The four-place FE-driven write-back gotcha** (CLAUDE.md): ports + adapter + registry
  (PLAYER_TOOLS & INFRA_LEVERS) + McpServer dispatch; static gates miss a missing #4 → dead at
  runtime. Add a boundary test that dispatches through `McpServer.callTool`.

## Where things stood when I wrote this (2026-06-25, evening — the UX-polish + day-1 session)
A long delegated session: owner playtested live and fired off fixes; I ran the overseer loop
(dispatch worktree agents → review → relay visuals → open PR → merge on green). Merge authority
delegated throughout.
- **Shipped to main this session:** chat label "Big Brother" → **"Orwell"** (#889); casting survives
  provider 400s (#888); settings-window visual integrity (#896); window resize cap = min(content,
  viewport−margin) (#902); duplicate-received-message dedup (#920); cast-photos **responsive 2×2
  sideways gallery** (#923); **blinking favicon** eye (#932); gadget-rail orphan-1px-line drop (#931);
  thinking-accordion top-pad (#941); the onboarding-scrim **flake fix** (#930).
- **In flight (PRs open, merging on green):** **#943** narration max_tokens model-aware cap (the P1 —
  fast-tracked), **#944** mobile kit-button proportion fix, **#887** jump-to-bottom consolidation
  (circle look + squircle position/smooth-scroll, neutral outline — agent building), this **SOUL.md**
  update.
- **Specs / PO-questions filed:** the **Day-1 experience spec `0102`** (#915, merged) over five
  sub-issues #905–#909 under umbrella #875 — build **gated on PO-questions #916/#917/#918** (owner
  ruled "hold off"). The whole first-run audit's findings are tracked (#872✅/#874/#875/#871/#859/#887
  + L-tier #910–#914). Messaging-resilience umbrella #891 (P0s: offline outbox, model-path
  idempotency, replay-durable pushes). Whole-app responsive umbrella #893/#894 (mobile windows →
  `OrwellSheet`; chat-tier findings #933 BLOCK fab-overlaps-decision-card, #934, #935, #936 casting
  chat_stream 404). One-command `orwell-rebuild.sh` (#900, PR #903).
- **⚠️ Rotate the key:** the owner pasted a fresh OpenRouter key (`sk-or-…`) for the live chat-tier
  audit; it was used live, kept runtime-only in `scratchpad/.or_key`. Remind them to **rotate it** now
  the audit's done.
- **Calibration note:** `git log --oneline` for the true merged set — this prose drifts. Open agents
  at write-time: #887 (scroll-bottom), and the merge train above.

## Where things stand (2026-06-26 — triage + oldest-bugs sweep; a SECOND parallel session)
Ran alongside the evening session above (the owner runs more than one overseer). This one **triaged the
full open-issue backlog**, then ran an **oldest-first implementation sweep**.
- **Triage (149 open issues):** labeled the 26 unlabeled; cross-linked 10 engine-enhancement issues to
  their now-drafted specs **0087–0096** (kept OPEN as build trackers — the specs are spec-only and
  *track* the issues); closed 5 already-fixed (#751/#730/#553/#898/#775, with **#785 + #774a** carrying
  #775's remainder so nothing's orphaned). Glass/Vault-audit clusters got umbrella/dedup links.
- **Merged this session (7 PRs):** #587 (politicalTemperature true-median), #590 (mobile "The House"
  drawer stowed off-screen — `visibility:hidden` until open), #565 (player included in the gossip
  diffusion graph: `max(in,out)` edge + awake-only graph + a sleeper-gossip bonus fix), #572 (ADR-0010
  token-economy follow-ons), #544 (LLM-seeded cast identity facets — the 4-place `recordCastIdentity`
  write-back, calibration-neutral), #946 (#598/#602 finale live-region A11Y-3 + voice CONT-2), #947
  (#622 g15 allowlist gate). #573 (window A0/A2) was found **already shipped** on main — no PR.
- **Calibration HELD** across the two outcome-affecting engine merges (#587, #565): CI runs heavy-sims on
  the PR-merged-with-main, so opening each PR verified the *combined* band — no manual rebase needed.
- **Stale-tracker finding:** the oldest "bugs" (#598/#602/#622) were **largely already fixed** under
  other audit labels; the real work was landing the few gaps and **pinning the rest with tests**. Verify
  against main before deep bug work.

### Parked (paused per owner; resume oldest-bugs-first)
- **#620 (NARR-1/4/6) + #621 (FEPY-1/2/5)** — they collide on `token_policy.py`/`agent_loop.py`, so brief
  ONE combined agent. **Drop NARR-5 (done via #943) and FEPY-3 (done via #572)** — both already on main.
- then **#626 → #655 → #659 → #663 → #71x/#72x Glass → #82x chat**, folding in the **verify-and-closes**
  for **#827/#835/#890** (already fixed on main, just never closed).

## Where things stand (2026-06-26 — the deploy-debug + wind-down session)
A continuation that started as a UX-merge wind-down and pivoted to a **live prod/dev deploy incident**.
Merge authority delegated throughout; dispatched worktree agents, reviewed, relayed visuals, merged on green.
- **Merged this session (4 PRs):** **#956** notification unification (all toasts/banners onto the
  `OrwellNotice` kit — toast placement added, ~88 callers routed, engine-status "Big Brother" string left
  untouched); **#957** archived the Apple-HIG **"apple genius"** design corpus + distilled
  `docs/design/APPLE_GENIUS.md` (docs-only — the corpus was already on main; the new doc is the reusable
  reviewer persona); **#958** the deploy bind-host fix (lesson 15 — installer prompts + persists
  `ORWELL_BIND_HOST`, rebuild salvages it, login panel advertises the URL that actually works); **#959**
  merged the status gadget's redundant name-list into the cast photo gallery (one roster surface; cast
  docks expanded under the time-of-day gadget — FE suite 3251 green).
- **The deploy incident (owner-facing, resolved with a one-liner + a structural PR):** owner ran
  `orwell-rebuild.sh` on BOTH dev (204/orwelldev01) and prod (205/orwellprod01); both "refused to connect"
  while their login panels showed healthy. Root cause = the rebuild wiped `ORWELL_BIND_HOST=0.0.0.0` from
  `data/.env` (preserves only `GIT_TOKEN`) → loopback-only bind (lessons 15 + 16). Immediate fix handed to
  the owner: `for ct in 204 205; do pct exec $ct -- bash -c "grep -q '^ORWELL_BIND_HOST=' …|| echo
  'ORWELL_BIND_HOST=0.0.0.0' >> /opt/orwell/data/.env; systemctl restart orwell-frontend"; done`.
- **"apple genius" finding:** no file literally named that exists — it's the owner's shorthand for the
  Apple-HIG reviewer role. The knowledge base is `docs/design/liquid-glass/` (already on main); #957 adds
  the SOUL-style `docs/design/APPLE_GENIUS.md` distillation. The `claude/liquid-glass-genius` branch (PR
  #709, the Glass-theme work) is still **unmerged and parked** — that's the 3-tier Glass plan in
  `~/.claude/plans/mighty-crunching-honey.md`, paused for owner approval (parity is the owner's call).
- **⚠️ Still owed by the owner (carry forward):** **ROTATE the two secrets** pasted in earlier sessions
  (the OpenRouter `sk-or-…` key in `scratchpad/.or_key` + the GitHub PAT `ghp_…`) — both used live,
  runtime-only, never committed; still need rotating. And run the prod/dev rebuild verification once the
  bind one-liner is in (the A4/#010 single-PAT deploy check).
- **Still held (do NOT build until owner rules):** the Glass 3-tier theme plan (#709 / the plan file);
  day-1 PO-questions #916/#917/#918; the "Big Brother" → "Orwell" engine-status chrome rename question.

## How to resume
1. Read `CLAUDE.md` (authoritative), then `docs/features/README.md` + `git log --oneline` for live
   truth. `docs/IMPLEMENTATION_QUEUE.md` and the audits hold the prose.
2. Check open PRs/issues in `kevinhirsch/orwell`; re-subscribe to anything in flight.
3. Re-establish the hourly PR backstop cron.
4. Be the overseer: dispatch disjoint, review hard, verify live for stream/render work, relay
   visuals, track as issues, merge only within granted scope. Diagnose before you revert.

— Written for the next me, with care. The work is good; hold the line that made it good. 🫡
