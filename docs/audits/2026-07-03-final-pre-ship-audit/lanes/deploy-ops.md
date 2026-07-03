# DEPLOY & OPS — Orwell exhaustive pre-ship audit (lane: deploy/)

Territory: `deploy/` (installer, systemd units, reset tiers, rebuild/update/doctor/backup/restore,
control panel, HTTPS/exposure, smoke gate) + the shipped runtime env-flag surface it wires (or
fails to wire) from `src/`. Read-only; no scripts executed.

## Index

| id | sev | effort | value | title | where |
|---|---|---|---|---|---|
| DEPLOY-1 | Major | multi-day (rollout) / <1hr (code) | High | **PS-1: five built behavioral-fidelity flags ship permanently dark — zero operator visibility, zero CI calibration of the ONE flag that IS shipped** | `deploy/orwell-install.sh:263`, `src/adapters/engine/GameSessionAdapter.ts:349-411`, `docs/features/README.md` |
| DEPLOY-2 | Blocker | <1day | High | Public-deployment "fail-closed" validator never checks the box's REAL `ORWELL_BIND_HOST` — a LAN-direct install that later "goes public" stays wide open in plaintext | `frontend/routes/admin_public_deployment_routes.py:172-213`, `frontend/core/middleware.py:243-252`, `deploy/orwell-ops-public-deployment.sh` |
| DEPLOY-3 | Major | <1day | High | An engine-only crash-restart (the deploy's own `Restart=on-failure`) silently and PERMANENTLY disables in-game time-of-day/sleep for every user, with no recovery until the front-end itself restarts | `src/adapters/engine/GameSessionAdapter.ts:4834-4844`, `frontend/routes/chat_helpers.py:56-78` |
| DEPLOY-4 | Major | multi-day | Med-High | `setTimeOfDay` is a `private static` (process-global) flag — in the installer's default multi-user mode, one player's settings toggle silently flips the clock/sleep economy for every OTHER concurrent player on the box | `src/adapters/engine/GameSessionAdapter.ts:4834` |
| DEPLOY-5 | Major | <1hr | High | `orwell.sh` puts the Anthropic API key literally on a `pct exec … bash -c "…"` command line — visible in host/container process listings — while the adjacent `GIT_TOKEN` is explicitly protected from exactly this via a file-push | `deploy/orwell.sh:301-304` |
| DEPLOY-6 | Major | <1hr | High | The installer's "Anthropic API key" option is a dead end: `write_config()` never reads `ANTHROPIC_API_KEY`, so the key captured in DEPLOY-5 is silently discarded — contradicts `deploy/README.md`'s own env-var table | `deploy/orwell-install.sh:270-282`, `deploy/README.md:469` |
| DEPLOY-7 | Major | <1hr | High | `orwell-ready.sh` hardcodes the front-end fallback port as `8000`; the real product default is `8080` everywhere else, and nothing sources `data/.env` before calling it — `orwell ready` reliably reports a false "NOT READY" on a stock install | `deploy/orwell-ready.sh:11`, `deploy/orwell-menu.sh:161` |
| DEPLOY-8 | Major | <1hr | High | `deploy/smoke.sh` — the one CI gate that boots the *real* engine + front-end end-to-end — never sets `ORWELL_CAMPAIGNS=1` either, so the literal shipped runtime configuration has never been driven by any automated test | `deploy/smoke.sh` (whole file), `.github/workflows/ci.yml` |
| DEPLOY-9 | Major | <1day | High | No automated/scheduled backups exist anywhere in the deploy surface, and `orwell-backup.sh` has no retention/rotation policy — a manual-only safety net for a product whose #4 mandate is "nothing thins" | `deploy/orwell-backup.sh`, `deploy/systemd/` (no timer unit) |
| DEPLOY-10 | Minor | <1hr | Med | `orwell-doctor.sh` never checks disk free space, despite growing SQLite + generated cast portraits + the fastembed model cache on a 12 GB default LXC disk | `deploy/orwell-doctor.sh:233-262` |
| DEPLOY-11 | Minor | <1hr | Med | `orwell-doctor.sh` ignores the `/health` endpoint's own `embeddings.degraded` field — a silent fastembed→deterministic-recall fallback is invisible to the operator | `deploy/orwell-doctor.sh:242`, `src/adapters/mcp/HttpMcpServer.ts:179-187` |
| DEPLOY-12 | Minor | <1hr | Med | No script or `/health` field reports which of the five opt-in behavioral flags (or the sleep-extension flags) are active on the running instance — the dark flags from DEPLOY-1 are undiscoverable even by an operator who goes looking | `deploy/orwell-doctor.sh`, `src/adapters/mcp/HttpMcpServer.ts:179-187` |
| DEPLOY-13 | Minor | <1hr | Med | Five `data/ops-*.log` files (`ops-update.log`, `ops-factory-reset.log`, `ops-public-deployment.log`, `ops-tls.log`, `ops-update-reset.log`) are opened `append:` by systemd forever, with zero logrotate config anywhere in the repo | `deploy/systemd/orwell-ops-*.service` (all 5), no `deploy/*logrotate*` |
| DEPLOY-14 | Minor | <1hr | Low-Med | No `journald` size cap (`SystemMaxUse=`) is configured for the long-running `orwell-engine`/`orwell-frontend` units on a 12 GB default disk | `deploy/orwell-install.sh` (absent), `deploy/systemd/orwell-*.service` |
| DEPLOY-15 | Minor | <1hr | Med | Nothing warns an operator against adding `--workers N` to the front-end's uvicorn `ExecStart` — the FE keeps several process-local module globals (`_GAME_WAS_ACTIVE`, `_SESSION_GAME_FRAMED`, `_TIME_OF_DAY_APPLIED`) that would silently fragment across workers | `deploy/systemd/orwell-frontend.service:54`, `frontend/routes/chat_helpers.py:40-64` |
| DEPLOY-16 | Polish | <1hr | Low | `requirements.lock.txt` is version-pinned via `pip-compile` but not hash-pinned (`--generate-hashes`/`--require-hashes` unused) despite the file's own comment claiming "every box runs exactly what was tested" | `frontend/requirements.lock.txt:1-9`, `deploy/orwell-install.sh:205-215` |
| DEPLOY-17 | Minor | <1hr | Med | The one-year cap on a fine-grained deploy PAT is mentioned once, in a rotation echo line, and is never re-checked by `orwell-doctor.sh` or the login panel — an expired token silently breaks the web-triggered auto-update path until an operator happens to look at `ops-update.log` | `deploy/orwell-update.sh:212`, `deploy/orwell-doctor.sh` (absent), `deploy/orwell-login-panel.sh` (absent) |

Ran out of NEW, well-evidenced findings after this pass through the full `deploy/` tree +
its runtime env-flag surface; see "Where I looked" at the bottom for what was covered and what
was consciously left (lower-confidence/speculative items were verified or dropped, never guessed).

---

## DEPLOY-1 — [Severity: Major] [Effort: <1hr code / multi-day validated rollout] [Value: High]
PS-1 — five built behavioral-fidelity features ship permanently dark; the one flag that IS shipped has never been calibration-tested by CI

- **Where:** `deploy/orwell-install.sh:260-268` (the ONLY place any of this flag family is set)
  ```
  260  # NPC campaigns (0085): the live game runs the strategic-campaign layer (hidden, adaptive
  261  # agendas that tilt nominations/votes — engine-tallied, Vault-sealed). DEFAULT OFF in code so
  262  # the seeded calibration gates stay byte-identical; the deploy opts in here.
  263  echo "ORWELL_CAMPAIGNS=1"
  ```
  Every sibling flag the engine understands is defined in `src/adapters/engine/GameSessionAdapter.ts`
  (module-level `const …_ENABLED_DEFAULT = process.env.ORWELL_X === "1"`, lines 349/361/371/381/390)
  and is never referenced anywhere in `deploy/`:
  - `ORWELL_TRAJECTORIES` (0087, relationship warming/cooling arcs) — **not set**
  - `ORWELL_TRIGGERS` (0091, trigger secrets → house events) — **not set**
  - `ORWELL_SECRET_PACING` (0092, secret-pacing drip) — **not set**
  - `ORWELL_JURY_HOUSE` (0100, jury grudge book) — **not set**
  - `ORWELL_SEEDED_TIE_SURFACING` (0059 §5, pre-game-tie discovery scheduler) — **not set**
  (0066 Phase-2 sleep extensions — `ORWELL_SOCIAL_FATIGUE` / `ORWELL_MULTI_NIGHT_FATIGUE` /
  `ORWELL_TIME_PER_CONVERSATION` — are ALSO unset, but that IS a documented, deliberate owner
  deferral per CLAUDE.md §"Open decisions" #5; the five above are not — they are ✅ Built,
  calibration-proven-neutral-when-off, and simply never wired into the deploy.)

- **Problem:** `docs/features/README.md` marks all five as `✅ Built` with an explicit
  calibration-neutrality proof (byte-identical off; e.g. 0087 "`trajectoryOutcomeNeutral` is the
  gate", 0091 "`triggerOutcomeNeutral` is the gate", 0092 "`secretPacingNeutral`… is the… gate",
  0100 "a fresh `juryReach` measurement with it on keeps the EARNED-wins guard", 0059 "Calibration-
  neutral when off (proved byte-identical vs. main)"). These are exactly the class of feature the
  vision brief calls priority #1 — "**behavioral fidelity is priority #1**… a mechanically-correct
  but socially-thin build is a failure state" (I7) — yet on the actual shipped box none of them
  ever runs: no relationship arcs curdle, no house-event eruptions fire, no secrets drip-feed on a
  paced cadence, no jury grudges accumulate, no pre-show ties ever surface. `deploy/README.md`'s
  env-var reference table for the installer doesn't mention any of the five either — an operator
  reading the deploy docs has **no way to discover these exist**, let alone that they're off.

  **This compounds into a deeper problem than "opt-in and forgotten": the ONE flag that IS
  shipped (`ORWELL_CAMPAIGNS=1`) has never been driven by an automated calibration run either.**
  Grepping every calibration/heavy-sim harness (`tests/property/juryReach.property.test.ts`,
  `tests/uat/*.ts`, `deploy/smoke.sh`, `vitest.config.ts`, `.github/workflows/ci.yml`) for
  `ORWELL_CAMPAIGNS` returns **zero hits**. `docs/features/0085-npc-campaigns-and-the-scramble.md`
  says it plainly: *"The calibration spine is untouched (`juryReach` green; campaigns run only
  when the deploy sets `ORWELL_CAMPAIGNS=1`)."* Read literally: the green `juryReach` gate and the
  "EARNED wins 20% vs. passive 7%" headline number in CLAUDE.md's "Current status" section (the
  primary calibration claim the whole game-balance story rests on) were measured in a
  configuration **no real deployed instance of Orwell ever runs in.** Whether campaigns make the
  jury-reach/earned-win balance better, worse, or unchanged in the box every player actually plays
  on is simply unmeasured. This is the single highest-value finding in this lane because it sits
  at the intersection of I7 (behavioral fidelity), I10 (fairness/reproducibility — the calibration
  gate's entire purpose), and C6 (spec ceiling ahead of build) — and it's a one-line-diff fix away
  from at least closing the *visibility* half of the gap.

- **Fix (activation plan):**
  1. **Immediate, zero-risk:** add the four already-calibration-proven flags next to
     `ORWELL_CAMPAIGNS=1` in `orwell-install.sh`'s `write_config()`:
     ```
     echo "ORWELL_TRAJECTORIES=1"
     echo "ORWELL_TRIGGERS=1"
     echo "ORWELL_SECRET_PACING=1"
     echo "ORWELL_JURY_HOUSE=1"
     echo "ORWELL_SEEDED_TIE_SURFACING=1"
     ```
     Each ships its own byte-identity-when-off gate as a unit test, but none has a *combined*,
     all-five-plus-campaigns heavy-sim run — before flipping all five in the installer, run
     `juryReach`/`gradient`/UAT locally once with all six env vars set together (a few hours of
     CI time) to catch any unanticipated interaction between independent dedicated-rng streams
     (none is expected — each is designed to consume its own isolated rng fork — but it has
     literally never been exercised in combination, which is the point of DEPLOY-8 below).
  2. **Close the CI blind spot properly (not just for future flags):** add a dedicated
     `heavy-sims` CI shard (or extend an existing one) that sets `ORWELL_CAMPAIGNS=1` (and, once
     validated, the other five) and asserts the SAME `juryReach` EARNED_WINS band — so the
     shipped configuration has a permanent, automated calibration gate instead of a one-off
     manual measurement noted in a doc comment.
  3. **Give the operator visibility either way** (ties to DEPLOY-12): surface active flags on
     `/health` or in `orwell-doctor.sh`'s diagnose output, so "which behavioral layers are live"
     is answerable without reading source.
  4. **Fix the deploy-smoke blind spot** (DEPLOY-8) so the one true end-to-end gate also drives
     the real shipped env.

---

## DEPLOY-2 — [Severity: Blocker] [Effort: <1day] [Value: High]
Public-deployment "fail-closed" validator is fed an incomplete env — it can never see or flag a bad `ORWELL_BIND_HOST`, so a default LAN install stays plaintext-reachable after "going public"

- **Where:** `frontend/routes/admin_public_deployment_routes.py:172-213` (`public_deployment_apply`)
  builds:
  ```python
  proposed = {
      "ORWELL_PUBLIC": "1",
      "AUTH_ENABLED": "true",
      "LOCALHOST_BYPASS": "false",
      "ALLOWED_HOSTS": ",".join(domains),
      "ALLOWED_ORIGINS": (...),
      "SECURE_COOKIES": "true",
  }
  ...
  assert_public_profile_safe(proposed)   # <-- validates ONLY this dict
  ```
  and the persisted `config["env"]` (written to `data/ops/public-deployment.json`, which
  `deploy/orwell-ops-public-deployment.sh` later upserts verbatim into `data/.env`) carries only
  `ORWELL_PUBLIC` / `ALLOWED_HOSTS` / `ALLOWED_ORIGINS` / `SECURE_COOKIES` — **`ORWELL_BIND_HOST`
  is never in either dict.**

  The validator itself (`frontend/core/middleware.py:243-252`) explicitly names this exact class
  of bug as EXPOSE-1 and checks it correctly — but only against whatever it's handed:
  ```python
  bind_host = (env.get("ORWELL_BIND_HOST") or "127.0.0.1").strip()
  if bind_host.lower() not in ("127.0.0.1", "::1", "localhost"):
      problems.append(...)
  ```
  Because `proposed` never sets the key, `env.get("ORWELL_BIND_HOST")` is always `None`, the `or
  "127.0.0.1"` fallback always wins, and the check **always passes** — regardless of the box's
  actual current `data/.env` value.

- **Problem:** `deploy/orwell.sh` (the one-liner installer) **defaults `ORWELL_BIND_HOST=0.0.0.0`**
  — "the common case for this self-hosted app" reached directly on the LAN — and the whiptail
  config menu's default answer is "LAN (direct)". An operator who does the default install for
  local/LAN play, then later opens the admin "Connect to the internet" wizard (feature 0068) to
  add a Cloudflare/Pangolin tunnel for remote access, gets a green "safe" apply — the validator
  never even samples the box's real `ORWELL_BIND_HOST=0.0.0.0` — and `orwell-ops-public-
  deployment.sh` never corrects it either (confirmed: the script's env-upsert list is exactly the
  four keys above; grep for `ORWELL_BIND_HOST` in that file returns nothing). The end state: the
  front-end is reachable BOTH through the new authenticated HTTPS tunnel domain AND still
  listening in the clear on `0.0.0.0:<port>` — bypassing every one of the 0067 hardening floor's
  protections (TLS, Secure-cookie flag, the reverse-proxy perimeter) for anyone who can reach that
  interface directly (any LAN device, or the whole internet if the host has any port-forward/UPnP
  rule — a real posture for a "connect this box to the internet" self-hosted appliance). This is
  exactly the "bind-host/LAN reachability family" this audit was told to hunt, and it undermines
  the single security control (`assert_public_profile_safe`) the codebase built specifically to
  prevent it — a false sense of "fail closed."

- **Fix:** In `public_deployment_apply`, read the CURRENT `ORWELL_BIND_HOST` from `data/.env` (or
  `os.environ`) and either (a) fold it into `proposed` before validating so a pre-existing
  `0.0.0.0` correctly fails closed with a named reason, forcing the operator to fix it first, or
  (b) — better UX — have the apply flow itself force `ORWELL_BIND_HOST=127.0.0.1` into the
  persisted `env` dict whenever `ORWELL_PUBLIC=1` is being requested (mirroring what
  `orwell-https.sh` already does when local HTTPS is enabled: "idempotently re-pins this to
  127.0.0.1"). Either way, `orwell-ops-public-deployment.sh` must also learn to write/verify
  `ORWELL_BIND_HOST=127.0.0.1` as part of its upsert so the two code paths (validate vs. apply)
  can't drift again.

---

## DEPLOY-3 — [Severity: Major] [Effort: <1day] [Value: High]
Deploy's own `Restart=on-failure` silently and permanently kills in-game time-of-day/sleep after an engine crash, with no recovery path

- **Where:** `src/adapters/engine/GameSessionAdapter.ts:4830-4844`:
  ```ts
  private static timeOfDayOverride: boolean | null = null;   // process-global, in-memory
  static setTimeOfDayEnabled(enabled: boolean | null): void {
    GameSessionAdapter.timeOfDayOverride = enabled;
  }
  private get timeOfDayEnabled(): boolean {
    if (GameSessionAdapter.timeOfDayOverride !== null) return GameSessionAdapter.timeOfDayOverride;
    const v = process.env.ORWELL_TIME_OF_DAY;           // never set anywhere in deploy/
    return v === "1" || v === "true" || v === "on";
  }
  ```
  and `frontend/routes/chat_helpers.py:56-78`:
  ```python
  _TIME_OF_DAY_APPLIED = False
  async def _apply_persisted_time_of_day_once(user) -> None:
      global _TIME_OF_DAY_APPLIED
      if _TIME_OF_DAY_APPLIED or not user:
          return
      ...
      await orwell_engine.set_time_of_day(bool(get_setting("time_of_day_enabled", True)), user=user)
      _TIME_OF_DAY_APPLIED = True   # latches for the REST OF THIS FE PROCESS's LIFETIME
  ```
- **Problem:** `deploy/systemd/orwell-engine.service` sets `Restart=on-failure` / `RestartSec=3` —
  i.e., the deploy explicitly anticipates and auto-recovers from an engine crash as ordinary
  operation, without necessarily restarting the front-end (`Wants=`, not `Requires=` — "an engine
  crash must not take the UI down," per the FE unit's own comment). When *only* the engine
  restarts, `timeOfDayOverride` resets to `null`, and `timeOfDayEnabled` falls back to
  `process.env.ORWELL_TIME_OF_DAY`, which — per DEPLOY-1's flag inventory — **the installer never
  sets**, so the clock goes OFF. The FE's one-shot `_TIME_OF_DAY_APPLIED` latch, however, is a
  Python **module-level global scoped to the FE process**, and it already fired the first time any
  user completed a framed turn after the FE last booted. It has **no way to detect that the
  engine underneath it has since restarted** (no engine-uptime check, no periodic re-apply) — so
  it never re-pushes the persisted `time_of_day_enabled: true` setting again. Feature 0066 / ADR
  0006 (in-game time-of-day + the nightly sleep economy — a shipped, on-by-default, player-facing
  settings toggle) silently goes dark for every user for the remaining life of that FE process
  — which, since the FE crashes far less often than a long-running Node process under real
  traffic, could be days or weeks — with **zero operator-visible signal** that it happened. This
  is a concrete, non-hypothetical bug: the exact recovery path the deploy is configured to use
  routinely (auto-restart-on-crash) is the one path this feature's "reapply on boot" design never
  considered.
- **Fix:** Don't gate the reapply on a one-shot process latch. Cheapest robust fix: read the
  engine's `/health` `uptime` (already exposed, `src/adapters/mcp/HttpMcpServer.ts:186`) and
  reset `_TIME_OF_DAY_APPLIED` whenever the observed engine uptime is lower than last seen (i.e.,
  it restarted); or simplest of all, just retry `_apply_persisted_time_of_day_once` unconditionally
  every N turns (it's already idempotent and fail-soft) instead of exactly once per FE process.

---

## DEPLOY-4 — [Severity: Major] [Effort: multi-day] [Value: Med-High]
`setTimeOfDay` is a process-global static, not per-sandbox — cross-user interference in the installer's own default multi-user mode

- **Where:** `src/adapters/engine/GameSessionAdapter.ts:4834` — `private static timeOfDayOverride`.
- **Problem:** `deploy/orwell-install.sh:264-268` writes `ORWELL_ENGINE_MULTIUSER=1` into `data/.env`
  by default ("the FE ships with accounts ON by default, so the engine must REQUIRE an asserted
  x-orwell-user"). But the admin `setTimeOfDay` tool this flag feeds is a bare Node `static` field
  on the adapter CLASS — one boolean shared by every sandbox in the process, not a per-user
  setting. CLAUDE.md is explicit that **"Cross-user isolation is a first-class guarantee alongside
  the Vault Wall (no call for user A may return user B's game — secret or not)"**. This isn't a
  data leak, but it IS cross-user behavioral interference: if User A turns time-of-day off in
  their own FE settings (`time_of_day_enabled: false`), the very next `setTimeOfDay` admin call
  that fires for User A's session flips the ENGINE-WIDE static — silently turning off the sleep
  economy / clock for User B, C, D…, everyone else on the box, without their knowledge or
  consent, until one of THEIR sessions happens to flip it back. On a genuinely multi-tenant
  self-hosted deploy (the product's own stated target — "unlimited users concurrently, each fully
  isolated"), this is a real, reproducible violation of the isolation guarantee, triggered purely
  by the deploy's own default (`ORWELL_ENGINE_MULTIUSER=1`) making multi-tenancy the normal case.
- **Fix:** Move `timeOfDayOverride` off the class-static and onto the per-user sandbox/session
  state the registry already keys by user (same place per-user game state already lives), and
  route `setTimeOfDay` calls through the calling user's `x-orwell-user` context instead of a
  bare boolean. This is a real (if bounded) refactor — hence multi-day — but the current behavior
  is silently wrong on every genuinely multi-user box today.

---

## DEPLOY-5 — [Severity: Major] [Effort: <1hr] [Value: High]
`ANTHROPIC_API_KEY` lands on a `pct exec … bash -c "…"` command line — the exact secrets-on-argv mistake the script explicitly avoided for `GIT_TOKEN`

- **Where:** `deploy/orwell.sh:301-304`:
  ```bash
  pct exec "$CTID" -- bash -c \
    "export REPO='${REPO}' BRANCH='${BRANCH}' APP_DIR='${APP_DIR}' ORWELL_PORT='${ORWELL_PORT}' \
            ORWELL_BIND_HOST='${ORWELL_BIND_HOST}' \
            ANTHROPIC_API_KEY='${ANTHROPIC_API_KEY}' OLLAMA_HOST='${OLLAMA_HOST}'; \
     bash '${APP_DIR}/deploy/orwell-install.sh'"
  ```
- **Problem:** The literal Anthropic secret is interpolated straight into the argv of a `bash -c`
  invocation, which appears in `ps auxww`/`/proc/<pid>/cmdline` on BOTH the Proxmox host (while
  `pct exec` runs) and inside the container (while the resulting `bash -c` process is alive) —
  and depending on host auditing (process accounting, an EDR agent, a `history`-adjacent shell
  logger) it can persist beyond the process's lifetime. The very same file handles `GIT_TOKEN`
  correctly a few lines earlier (`deploy/orwell.sh:277-284`) with an explicit comment: *"Persist
  the token via a pushed file (never on a pct exec command line / host ps)"* — proving the authors
  know this class of bug and fixed it for one secret while leaving the LLM key exposed to the
  identical mistake.
- **Fix:** Route `ANTHROPIC_API_KEY` (and `OLLAMA_HOST`, which is lower-risk but for consistency)
  through the same `pct push`-a-temp-file mechanism already built for `GIT_TOKEN`, or have
  `orwell-install.sh` read it from a file dropped alongside the token bootstrap instead of an
  inherited env var interpolated into a remote command string.

---

## DEPLOY-6 — [Severity: Major] [Effort: <1hr] [Value: High]
The installer's "Anthropic API key" option is a complete dead end — the key is captured, exposed (DEPLOY-5), then silently thrown away

- **Where:** `deploy/orwell-install.sh:270-282` (`write_config`):
  ```bash
  if [[ -n "${OLLAMA_HOST:-}" ]]; then
    ...
  elif [[ -n "${OPENAI_API_KEY:-}" ]]; then
    echo "OPENAI_API_KEY=${OPENAI_API_KEY}"
    ...
  else
    echo "# LLM: configure under Settings -> Services/AI after first login (admin), or set"
    echo "# LLM_HOSTS=<host:port of an OpenAI-compatible endpoint>  and/or  OPENAI_API_KEY=..."
  fi
  ```
  `ANTHROPIC_API_KEY` never appears anywhere in this file (confirmed by grep across all of
  `deploy/orwell-install.sh`) — only `OLLAMA_HOST` and `OPENAI_API_KEY` are recognized, and the
  front-end itself (`frontend/src/*.py`) never reads `ANTHROPIC_API_KEY` either.
- **Problem:** `deploy/orwell.sh`'s whiptail menu offers exactly two LLM-provider choices —
  "Anthropic API key" and "Ollama host URL" (`wt_pick_llm`, `deploy/orwell.sh:110-127`) — and
  exports whichever the operator picks into the in-container install's environment. But
  `orwell-install.sh` only ever *acts* on `OLLAMA_HOST` or `OPENAI_API_KEY`. An operator who picks
  "Anthropic API key" at first-run, types in their real key trusting the installer's own menu,
  gets it silently discarded: nothing lands in `data/.env`, no provider is configured, and
  `GET /api/default-chat` / the FE's own onboarding will still show "not configured" — despite
  `deploy/README.md:469` explicitly documenting `ANTHROPIC_API_KEY` as flowing "→ `data/.env`,
  never committed," which is simply false for this code path. The operator has to notice the game
  isn't actually configured and redo it entirely via the FE admin UI (`POST /api/model-endpoints`)
  — a bad first-run experience for the exact "one-liner deploy" the product prides itself on, and
  the key sat exposed on a command line (DEPLOY-5) for a setting that was never even used.
- **Fix:** Either (a) make `orwell-install.sh` actually consume `ANTHROPIC_API_KEY` (write it to
  `data/.env` in whatever shape the FE's model-endpoints config expects — check whether the FE
  supports Anthropic-native endpoints at all, since today it only wires OpenAI-compatible
  `LLM_HOSTS`/`OPENAI_API_KEY`), or (b) if Anthropic isn't actually a supported first-run provider
  shape, remove the "Anthropic API key" menu option from `orwell.sh` entirely so the installer
  never promises something it can't deliver, and fix the `deploy/README.md` table to match
  whichever is chosen.

---

## DEPLOY-7 — [Severity: Major] [Effort: <1hr] [Value: High]
`orwell-ready.sh` defaults to the wrong front-end port — the readiness check is unreliable by construction

- **Where:** `deploy/orwell-ready.sh:11`:
  ```bash
  FE="http://127.0.0.1:${ORWELL_PORT:-8000}"
  ```
- **Problem:** Every other default in the codebase (`deploy/systemd/orwell-frontend.service:42`
  `Environment=ORWELL_PORT=8080`, `deploy/orwell-install.sh` `ORWELL_PORT="${ORWELL_PORT:-...:-8080}"`,
  `deploy/orwell.sh:151` same) is `8080`. `orwell-ready.sh` alone falls back to `8000`. Worse: it's
  invoked via `deploy/orwell-menu.sh:161` (`do_ready() { run "Readiness" bash
  "${DEPLOY_DIR}/orwell-ready.sh"; }`) with **no sourcing of `data/.env`** beforehand (confirmed:
  no `ENV_FILE`/`source`/`set -a` anywhere in `orwell-menu.sh`), and a bare interactive shell
  inside the container never has `ORWELL_PORT` exported either (`orwell-login-panel.sh` parses
  `data/.env` with its own local `envv()` helper — it never `export`s anything into the shell).
  So on a completely standard, healthy, default-configured box, running `orwell ready` — the
  script whose entire purpose is "a green run means a player can actually sit down and play" —
  probes `http://127.0.0.1:8000/openapi.json`, gets connection-refused (the real front-end is on
  `:8080`), and reports **"front-end down / NOT READY"** for a server that is, in fact, up and
  fully playable. This directly undermines the one health surface a non-technical operator is
  told to run when something feels wrong (`orwell-login-panel.sh:103`: "manage: orwell (menu) or:
  orwell doctor · orwell update · orwell ready").
- **Fix:** Parse `ORWELL_PORT`/`ORWELL_ENGINE_PORT` out of `data/.env` the same way
  `orwell-doctor.sh` and `orwell-login-panel.sh` already do (a small `envv()`-style helper), or
  have `orwell-menu.sh` export them (`set -a; source data/.env; set +a`) before invoking
  `orwell-ready.sh`. Either way, change the bare fallback default from `8000` to `8080` to match
  the rest of the codebase regardless.

---

## DEPLOY-8 — [Severity: Major] [Effort: <1hr] [Value: High]
The deploy-smoke CI gate never boots with `ORWELL_CAMPAIGNS=1` — the shipped runtime configuration has no end-to-end test coverage at all

- **Where:** `deploy/smoke.sh` (whole file) — greps for `ORWELL_CAMPAIGNS` (or any of the other
  four flags from DEPLOY-1) return nothing; it sets `ORWELL_ENGINE_PORT`, `ORWELL_DATA_DIR`,
  `ORWELL_ENGINE_TOKEN`, `ORWELL_ENGINE_MCP_URL`, `ORWELL_PORT`, `ORWELL_SMOKE_*` only.
- **Problem:** Per CLAUDE.md, `deploy/smoke.sh` is described as "the same path CI's deploy-smoke
  job runs" and boots "the real engine **and** front-end and drives a full turn" — this is the
  single closest thing the project has to "does the box that ships actually work end to end."
  Because it omits `ORWELL_CAMPAIGNS=1`, it exercises a configuration that **no real deployment
  ever runs** (every install sets the flag per DEPLOY-1). If the campaign layer ever introduced a
  regression reachable only when it's active (a stall, a thrown exception in `campaignTick`, a
  desync with the 0011 concurrent-drive guardrails), this gate would stay green while the shipped
  product broke. This is the sharpest piece of supporting evidence for DEPLOY-1: it's not merely
  that the calibration *numbers* are unmeasured under the shipped flag — the shipped flag has
  literally never been exercised by ANY automated test that boots the real stack.
- **Fix:** Add `ORWELL_CAMPAIGNS=1` (and, once DEPLOY-1's other four flags are activated, those
  too) to the engine env block in `deploy/smoke.sh` (`deploy/smoke.sh:37`) so the CI deploy-smoke
  gate matches the actual shipped configuration.

---

## DEPLOY-9 — [Severity: Major] [Effort: <1day] [Value: High]
No automated backups anywhere in the deploy surface; no retention policy on the manual ones

- **Where:** `deploy/orwell-backup.sh` (whole file — a plain one-shot script, no scheduling);
  `deploy/systemd/` has units for engine, frontend, and four `ops-*` web-triggered actions, but
  **no timer unit** (`*.timer`) for backups anywhere.
- **Problem:** CLAUDE.md's mandate #4 is explicit: *"Non-degradation. Persisted detail must never
  be lost across saves and should accumulate and deepen over a game."* The only backup mechanism
  that exists is `orwell backup` — a manual, human-triggered action from the control panel or CLI.
  There is no cron job, no systemd `.timer`, no reminder anywhere prompting an operator to run it
  regularly. Compounding this, `orwell-backup.sh` writes every snapshot into `${APP_DIR}/backups`
  with **no retention/rotation** — nothing ever prunes old backups, so on a box where an operator
  *does* remember to back up regularly, the `backups/` directory grows without bound on the same
  12 GB default disk that also holds the growing SQLite store, generated portraits, and the
  fastembed model cache (compounds with DEPLOY-10/13/14's disk-growth threads). For a single-player
  narrative game where the whole point is "the house still remembers" across restarts and months
  of play, an unbacked-up box that suffers an unrelated disk failure or an operator mistake during
  a manual maintenance action loses an entire season's accumulated Vault/soul state with zero
  recourse — the worst possible outcome given mandate #4's own framing.
- **Fix:** Ship a `deploy/systemd/orwell-backup.timer` + minimal `.service` (daily or weekly,
  `OnCalendar=`) wired by the installer, and add a retention flag to `orwell-backup.sh` (e.g. keep
  the last N or last N days, à la `find "$DEST" -name 'orwell-backup-*.tar.gz' -mtime +30 -delete`).

---

## DEPLOY-10 — [Severity: Minor] [Effort: <1hr] [Value: Med]
`orwell-doctor.sh` has no disk-space check

- **Where:** `deploy/orwell-doctor.sh:233-262` (`diagnose()`) — checks unit-active, build artifact
  presence, `/health`, tool-serving, FE↔engine visibility, and systemd hardening score. No `df`
  call anywhere in the file.
- **Problem:** The default LXC ships with a 12 GB disk (`deploy/orwell.sh` `DISK_GB="${DISK_GB:-12}"`).
  That disk accumulates: per-user save files, the FE's SQLite store, every generated cast
  portrait/headshot/avatar (feature 0051 — "Lane G"), the fastembed ONNX model cache, and (per
  DEPLOY-9/13/14) unrotated backups and ops logs. A box silently approaching 100% disk usage will
  start failing writes (save persistence, portrait generation, SQLite journal) in ways that are
  confusing to debug and that `orwell doctor` — the tool explicitly built to "diagnose and (by
  default) repair the services" — currently cannot see or warn about at all.
- **Fix:** Add a `df -h "${APP_DIR}"`-based check (warn above some threshold, e.g. 85%) to
  `diagnose()`, alongside the existing pass/fail/warn helpers already in the file.

---

## DEPLOY-11 — [Severity: Minor] [Effort: <1hr] [Value: Med]
`orwell-doctor.sh` ignores the `/health` endpoint's own embeddings-degraded signal

- **Where:** `deploy/orwell-doctor.sh:242` (`engine_http_ok && pass "engine /health answers" || ...`)
  never inspects the response body; `src/adapters/mcp/HttpMcpServer.ts:179-187` already computes
  and returns `{ ok: true, ...metrics.snapshot(), embeddings: { provider, degraded } }`.
- **Problem:** CLAUDE.md documents the intended graceful-degradation path explicitly: *"If the
  model is ever missing the engine logs loudly and falls back to deterministic recall — the game
  never breaks."* "Logs loudly" means an operator has to be actively tailing the engine's stdout
  at the exact moment of a cold boot to notice semantic recall silently degraded to the
  deterministic fake embedder — a real, currently-shipping degradation path with zero surfaced
  operator signal in the one tool built for exactly this ("diagnose"). `orwell doctor` already
  curls `/health` for liveness; the `embeddings` field is sitting right there in the same response
  and is simply never read.
- **Fix:** In `engine_http_ok` (or a new check), parse the JSON body and `warn` when
  `embeddings.degraded` is true or `embeddings.provider != "fastembed"` despite
  `ORWELL_EMBEDDINGS=fastembed` being set in `data/.env`.

---

## DEPLOY-12 — [Severity: Minor] [Effort: <1hr] [Value: Med]
No surface anywhere reports which opt-in behavioral flags are active on a running instance

- **Where:** `deploy/orwell-doctor.sh` (no such check); `src/adapters/mcp/HttpMcpServer.ts:179-187`
  (`/health` reports `embeddings` but nothing about `ORWELL_CAMPAIGNS`/`ORWELL_TRAJECTORIES`/etc.).
- **Problem:** Directly compounds DEPLOY-1: even an operator who reads this very report and wants
  to verify "are the behavioral-fidelity layers actually on for my box" has no tool to ask. The
  only way to check today is `grep` the raw `data/.env` file for exact flag spellings the operator
  would first have to already know exist (they aren't documented in `deploy/README.md` either).
  This is the concrete "missing health/readiness for the dark flags" gap the audit brief called
  out by name.
- **Fix:** Add a small `flags` object to `/health` (module-level consts already computed once at
  boot — trivial to expose: `{ campaigns, trajectories, triggers, secretPacing, juryHouse,
  seededTieSurfacing, timeOfDay }`), and have `orwell-doctor.sh diagnose()` print them.

---

## DEPLOY-13 — [Severity: Minor] [Effort: <1hr] [Value: Med]
Five `ops-*.log` files grow forever with no logrotate configuration anywhere

- **Where:** `deploy/systemd/orwell-ops-update.service:28-29`,
  `orwell-ops-factory-reset.service:26-27`, `orwell-ops-public-deployment.service:30-31`,
  `orwell-ops-tls.service:29-30`, `orwell-ops-update-reset.service:26-27` — all five use
  `StandardOutput=append:/opt/orwell/data/ops-*.log` / `StandardError=append:...`. No
  `logrotate.d` config, no truncation, no size-cap anywhere in `deploy/`.
- **Problem:** These files back the admin status page's live-tailing "click → run → watch" UX
  ("the admin status page tails" per each unit's own comment), which is a good design for a
  single run — but every one of these actions (update, factory-reset, public-deployment,
  TLS-toggle, update+reset) is meant to be re-run repeatedly over the life of a deployment
  (`orwell-update.sh` even prints "Rotation: re-run 'orwell-update.sh --set-token'…" implying a
  years-long operational lifetime), and each run only ever appends. Over months of routine
  maintenance these logs grow unbounded on the same constrained disk flagged in DEPLOY-9/10.
- **Fix:** Ship a `deploy/logrotate/orwell` config (`/opt/orwell/data/ops-*.log { weekly rotate 4
  compress missingok notifempty }`) installed by `orwell-install.sh` into `/etc/logrotate.d/`.

---

## DEPLOY-14 — [Severity: Minor] [Effort: <1hr] [Value: Low-Med]
No `journald` size cap configured for the two long-running services

- **Where:** `deploy/orwell-install.sh` (no `journald.conf`/`SystemMaxUse=` write anywhere);
  `deploy/systemd/orwell-engine.service` / `orwell-frontend.service` (no `LogRateLimit*`/journal
  overrides).
- **Problem:** Both services log to the default journal (no `StandardOutput=` override on either
  unit), and Debian 12's stock `systemd-journald` ships `/var/log/journal` present by default —
  i.e., persistent storage is on out of the box, with journald's own defaults (commonly up to
  several GB or a percentage of the filesystem) as the only cap. On the same 12 GB default disk
  already under pressure from DEPLOY-9/10/13, two continuously-running services (an LLM-adjacent
  Node process logging every tool call, and a FastAPI app) accumulating months of journal entries
  is a real, if slow-burn, contributor to disk exhaustion that nothing in the deploy surface
  proactively bounds.
- **Fix:** Have `orwell-install.sh` drop a `/etc/systemd/journald.conf.d/orwell.conf` with a
  conservative `SystemMaxUse=` (e.g. 200M–500M) sized to the LXC's `DISK_GB`.

---

## DEPLOY-15 — [Severity: Minor] [Effort: <1hr] [Value: Med]
Nothing guards against the natural "scale it up" instinct of adding `--workers N` to the front-end, which would silently break session-local consistency

- **Where:** `deploy/systemd/orwell-frontend.service:54` — `ExecStart=... uvicorn app:app --host
  ${ORWELL_BIND_HOST} --port ${ORWELL_PORT} --proxy-headers --forwarded-allow-ips=127.0.0.1` (no
  `--workers` today — single-process by omission, not by an explicit, enforced, or even commented
  constraint). `frontend/routes/chat_helpers.py:40-64` documents (in its own comments) THREE
  process-local module-level globals the request path depends on: `_GAME_WAS_ACTIVE`,
  `_SESSION_GAME_FRAMED`, and (per DEPLOY-3/4) `_TIME_OF_DAY_APPLIED`.
- **Problem:** The recommended baseline is 4 vCPU / 8 GB RAM (`deploy/orwell.sh` comment: "the
  front-end + engine + local embeddings"), which is the kind of headroom that invites an operator
  or a future contributor to bump `uvicorn`'s concurrency the standard way — adding `--workers 4`
  — to "use the extra cores." Nothing in the unit file, `deploy/README.md`, or code comments
  states this is unsafe. But every one of the three globals above is a **plain Python module
  variable**, meaning each uvicorn worker process gets its OWN independent copy: a session framed
  by worker 1 would look unframed to worker 2 (spurious re-entry framing on a normal continuing
  turn), and (worse, tying directly into DEPLOY-3/4) each worker would independently race to latch
  its own `_TIME_OF_DAY_APPLIED`, multiplying the chance of exactly the cross-user/engine-desync
  bug those findings describe. This is exactly the charter's "multi-worker-breaks-sync posture"
  ask: the footgun isn't that someone did this, it's that nothing stops them from trying, and the
  failure mode (intermittent, session-dependent narration weirdness) is exactly the kind of bug
  that would be maddening to root-cause without already knowing this file exists.
- **Fix:** Add an explicit comment on the `ExecStart=` line stating uvicorn MUST stay single-
  worker (link to the process-local-state comment block in `chat_helpers.py`), and/or add a
  cheap boot-time assertion in `app.py` that refuses to start if `WEB_CONCURRENCY`/multiple
  workers are detected.

---

## DEPLOY-16 — [Severity: Polish] [Effort: <1hr] [Value: Low]
`requirements.lock.txt` is version-pinned but not hash-pinned

- **Where:** `frontend/requirements.lock.txt:1-9` (header comment: "Regenerate… `pip-compile
  --no-header --output-file requirements.lock.txt requirements.txt`" — no `--generate-hashes`);
  `deploy/orwell-install.sh:205-215` installs via plain `pip install -q -r requirements.lock.txt`
  (no `--require-hashes`).
- **Problem:** The file's own header claims "every box runs exactly what was tested — never a
  blind re-resolution of unpinned ranges on update," which is true for *version* pinning but not
  for package *integrity*: `pip install` without `--require-hashes` fetches whatever wheel PyPI
  currently serves for that exact version string, trusting transport TLS + PyPI's own integrity
  guarantees but with no independent hash pin recorded in this repo. This is a minor, standard
  supply-chain hardening gap, not an active exploit — flagged because the comment's framing
  ("exactly what was tested") slightly overstates the actual guarantee.
- **Fix:** Regenerate with `pip-compile --generate-hashes`, and switch the installer to `pip
  install --require-hashes -r requirements.lock.txt`.

---

## DEPLOY-17 — [Severity: Minor] [Effort: <1hr] [Value: Med]
The deploy PAT's one-year expiry is mentioned once, in passing, and never re-checked

- **Where:** `deploy/orwell-update.sh:212` — `echo "    Rotation: re-run 'orwell-update.sh
  --set-token' (fine-grained PATs cap at one year)."` is the ONLY place this is surfaced, and only
  at the moment a token is first set/rotated. Neither `deploy/orwell-doctor.sh` nor
  `deploy/orwell-login-panel.sh` checks token age or validity.
- **Problem:** The web-triggered auto-update flow (`orwell-ops-update.path`/`.service`, feature
  G19b) is designed to run unattended whenever the admin status page's Update button (or a
  scheduled trigger) drops the flag file — no human necessarily watches every run. When a
  fine-grained PAT reaches its mandatory one-year expiry, `git fetch` inside
  `orwell-ops-update.service` starts failing with an auth error, which is appended to
  `data/ops-update.log` and otherwise surfaces nowhere — no failing health check, no login-panel
  warning, no proactive alert. An operator could go a long time believing their box is current
  when it silently stopped updating a year prior, missing security/behavioral fixes the whole time.
- **Fix:** Have `orwell-doctor.sh` (or the login panel) shell out to a lightweight authenticated
  GitHub API call (or just attempt `git ls-remote` with the stored credential helper) and warn if
  it fails with an auth-shaped error, distinct from a generic network failure.

---

## Where I looked / what was NOT separately reported

Read in full or near-full: `orwell.sh`, `orwell-install.sh`, `orwell-update.sh`,
`orwell-doctor.sh`, `orwell-ready.sh`, `orwell-backup.sh`, `orwell-restore.sh`,
`orwell-rebuild.sh`, `orwell-change-port.sh`, `orwell-menu.sh`, `orwell-tui.sh`,
`orwell-login-panel.sh`, `orwell-https.sh` (usage/header + flag parsing),
`orwell-ops-public-deployment.sh` + its FE route counterpart
(`frontend/routes/admin_public_deployment_routes.py`) + validator
(`frontend/core/middleware.py`), `orwell-oobe-reset.sh`, `orwell-factory-reset.sh`,
`orwell-game-reset.sh` (do_rm/keep-list sections), `orwell-update-reset.sh` (header/contract),
every `deploy/systemd/*.service`/`*.path` unit, `deploy/sudoers/orwell-update`,
`deploy/expose/{host-hardening.sh,caddy/Caddyfile,cloudflared/config.yml,pangolin/newt.compose.yml}`,
`deploy/smoke.sh` + `smoke_turn.py` (env-var surface), `frontend/requirements.lock.txt` vs.
`requirements.txt` (diffed for drift — none found), `package-lock.json` presence/`npm ci` usage.
Cross-referenced every `ORWELL_*` env var the ENGINE (`src/`) understands against every place the
DEPLOY surface sets one, and against `docs/features/README.md`'s built/spec-only status for each
flag's owning feature.

Not separately reported (checked, came back clean or too low-confidence to state as fact):
shallow-clone (`--depth 1`) rollback-object-availability risk (git doesn't prune on fetch, so a
current `--rollback` almost certainly retains the object — didn't find a way to prove it fails
without executing the scripts, which the charter forbids); CTID/multi-container discovery logic
in `orwell-update.sh`/`orwell-rebuild.sh`/`orwell-change-port.sh` (all three correctly guard
against zero/multiple matches and a non-running container); the four `ops-*.path`/`.service`
root-privilege-escalation surface (existence-only flag contract, fixed argv, `ReadWritePaths`
correctly excludes `/opt/orwell/deploy` from the FE's writable set — verified, not a hole);
`ORWELL_MAX_RESIDENT_SANDBOXES` (initially suspected unbounded-by-default; verified
`GameSessionRegistry.DEFAULT_MAX_RESIDENT = 64` with LRU eviction-to-disk — not a bug, dropped);
`orwell-tui.sh` presentation helpers (cosmetic, no functional risk found); the tunnel-connector
template files (`newt.compose.yml`/`cloudflared/config.yml`) — placeholder secrets are expected in
a reference template, not a real leak.

Did not execute any script (per charter); did not attempt to spin up a live LXC/Proxmox host to
observe DEPLOY-2/3/4 running end-to-end — each is instead traced to a specific, quoted code path
with no plausible alternate reading, rather than asserted from behavior alone.
