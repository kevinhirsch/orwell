#!/usr/bin/env bash
#
# deploy/smoke.sh — Orwell deploy smoke test (feature 0010).
#
# Validates the contract the one-liner install relies on, end-to-end and offline:
# build the engine, start it, probe the HTTP MCP surface, exercise the player
# game tools, prove channel isolation, then simulate an UPDATE (rebuild + restart)
# and re-probe. Runnable locally and in CI; the full Proxmox-LXC provisioning is
# the separate on-host test.
#
#   bash deploy/smoke.sh            # uses port 8799
#   ORWELL_ENGINE_PORT=9000 bash deploy/smoke.sh
set -uo pipefail

PORT="${ORWELL_ENGINE_PORT:-8799}"
BASE="http://127.0.0.1:${PORT}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

fails=0
ENGINE_PID=""
pass() { echo "  ok  — $*"; }
fail() { echo "  FAIL — $*"; fails=$((fails + 1)); }
have() { case "$1" in *"$2"*) return 0 ;; *) return 1 ;; esac; }
check() { # label  haystack  needle
  if have "$2" "$3"; then pass "$1"; else fail "$1 (missing: $3)"; fi
}
refute() { # label  haystack  needle-that-must-be-absent
  if have "$2" "$3"; then fail "$1 (leaked: $3)"; else pass "$1"; fi
}

# A dedicated save dir: the behavioral data-survival check (audit E80) reads it back across the
# simulated update, and the smoke never pollutes the checkout's default ./.orwell-data.
SMOKE_DATA_DIR="$(mktemp -d /tmp/orwell-smoke-data-XXXXXX)"

# B2 (DEPLOY-8): boot the engine in the SAME behavioral-flag configuration the installer ships, so
# the one true end-to-end gate actually exercises the shipped runtime (a regression reachable only
# when a living-house layer is active would otherwise stay invisible). Matches orwell-install.sh's
# write_config(); every layer is calibration-neutral-when-off and heavy-sim'd ON.
SHIPPED_FLAGS=(ORWELL_CAMPAIGNS=1 ORWELL_COMP_INTENT=1 ORWELL_TRAJECTORIES=1 ORWELL_TRIGGERS=1 ORWELL_SECRET_PACING=1 ORWELL_JURY_HOUSE=1 ORWELL_SEEDED_TIE_SURFACING=1 ORWELL_STRATEGIC_CADENCE=1 ORWELL_CONFESSIONAL_DEPTH=1 ORWELL_DEAL_DEPTH=1 ORWELL_NPC_DEAL_OFFERS=1)

start_engine() { # optional $1 = a shared token to enforce (B67/B71)
  env ORWELL_ENGINE_PORT="$PORT" ORWELL_DATA_DIR="$SMOKE_DATA_DIR" "${SHIPPED_FLAGS[@]}" ${1:+ORWELL_ENGINE_TOKEN="$1"} node dist/main.js >/tmp/orwell-smoke-engine.log 2>&1 &
  ENGINE_PID=$!
  for _ in $(seq 1 30); do
    if curl -fsS "${BASE}/health" >/dev/null 2>&1; then return 0; fi
    if ! kill -0 "$ENGINE_PID" 2>/dev/null; then echo "engine exited early:"; cat /tmp/orwell-smoke-engine.log; return 1; fi
    sleep 0.5
  done
  echo "engine did not become healthy:"; cat /tmp/orwell-smoke-engine.log; return 1
}
stop_engine() { [ -n "$ENGINE_PID" ] && kill "$ENGINE_PID" 2>/dev/null; wait "$ENGINE_PID" 2>/dev/null; ENGINE_PID=""; }
cleanup() { stop_engine; rm -rf "$SMOKE_DATA_DIR"; }
trap cleanup EXIT

pcall() { curl -s -X POST "${BASE}/player/call" -H 'content-type: application/json' -d "$1"; }

echo "==> [1/3] build engine"
npm run build >/tmp/orwell-smoke-build.log 2>&1 && [ -f dist/main.js ] \
  && pass "npm run build -> dist/main.js" || { fail "build"; cat /tmp/orwell-smoke-build.log; exit 1; }

echo "==> [2/3] start + probe"
start_engine || exit 1
pass "engine healthy on :${PORT}"

check  "GET /health ok"                 "$(curl -fsS "${BASE}/health")"          '"ok":true'

player_tools="$(curl -fsS "${BASE}/player/tools")"
check  "player tools: createCharacter"  "$player_tools" 'createCharacter'
check  "player tools: getMomentPrompt"  "$player_tools" 'getMomentPrompt'
check  "player tools: runCompetition"   "$player_tools" 'runCompetition'
# E20: the caller-supplied-stats resolver is gone — runCompetition is the single authority.
refute "player channel hides resolveCompetition (E20)" "$player_tools" 'resolveCompetition'
refute "player channel hides admin tool" "$player_tools" 'inspectNonVaultState'

admin_tools="$(curl -fsS "${BASE}/admin/tools")"
check  "admin tools: inspectNonVaultState" "$admin_tools" 'inspectNonVaultState'
refute "admin channel hides action tool" "$admin_tools" 'resolveCompetition'

check  "createCharacter -> started"     "$(pcall '{"name":"createCharacter","args":{"playerName":"Smoke"}}')" '"started":true'
state="$(pcall '{"name":"getGameState","args":{}}')"
check  "getGameState -> started"        "$state" '"started":true'
refute "house roster carries no soul"   "$state" '"soul"'
# Hidden-layer refutes (audit E80): no relationship/stat NUMBER may reach a player surface —
# the full key set, not just "physical". The bare key is sanctioned in exactly one place: the
# 0050 casting card's qualitative tier words ("physical":"standout") — so the refute targets
# numeric values, the actual leak shape.
for leak in physical mental social trust affinity threat; do
  if printf '%s' "$state" | grep -Eq "\"${leak}\": *-?[0-9]"; then
    fail "getGameState hides hidden layer (\"${leak}\": <number>)"
  else
    pass "getGameState hides hidden layer (\"${leak}\": <number>)"
  fi
done
check  "getMomentPrompt -> systemPrompt" "$(pcall '{"name":"getMomentPrompt","args":{}}')" '"systemPrompt"'
runcomp="$(pcall '{"name":"runCompetition","args":{"type":"endurance"}}')"
check  "runCompetition -> winner (live house)" "$runcomp" '"winner"'
for leak in '"physical":' '"mental":' '"social":' '"score' '"trust":' '"affinity":' '"threat":'; do
  refute "runCompetition hides stats/scores (${leak})" "$runcomp" "$leak"
done
# E20: a direct caller-supplied-stats resolution must be REFUSED, not resolved.
comp='{"name":"resolveCompetition","args":{"type":"endurance","participants":[{"id":"player","stats":{"physical":0.5,"mental":0.5,"social":0.5}},{"id":"npc:1","stats":{"physical":0.6,"mental":0.5,"social":0.5}}],"intents":[],"seed":1}}'
compres="$(pcall "$comp")"
check  "resolveCompetition is refused (E20)" "$compres" 'error'
refute "refused resolveCompetition returns no winner" "$compres" '"winner"'

# Channel isolation: a player server must refuse an admin tool.
check  "player refuses admin tool"      "$(pcall '{"name":"inspectNonVaultState","args":{}}')" 'error'

echo "==> [3/3] simulate update (rebuild + restart), assert still healthy"
stop_engine
npm run build >/tmp/orwell-smoke-build2.log 2>&1 && pass "rebuild (update) succeeds" || fail "rebuild"
start_engine && pass "engine healthy after update" || fail "engine unhealthy after update"
# Data safety, BEHAVIORALLY (audit E80): the game created before the "update" must still be
# there after the restart — the restarted engine reads the SAVE back from disk, not memory.
post_update_state="$(pcall '{"name":"getGameState","args":{}}')"
check  "the save survives the update (game resumes from disk)" "$post_update_state" '"started":true'
if find "$SMOKE_DATA_DIR" -name 'v*.json' 2>/dev/null | grep -q .; then
  pass "durable save files exist on disk"
else
  fail "no durable save files found under the data dir"
fi
# Belt: the update script must never delete the save directory (textual sweep).
if grep -E '\brm\b' deploy/orwell-update.sh | grep -q 'data'; then
  fail "orwell-update.sh appears to delete data/"
else
  pass "orwell-update.sh never deletes data/ (save preserved)"
fi

# ── whiptail control panel (orwell-menu.sh + orwell-tui.sh) ────────────────────────────────────
# The shared lib must source cleanly and export the helpers; the menu must degrade to plain help
# off a TTY, so CI / automation / the pct-exec bridge (no PTY) never block on a dialog.
if bash -c 'set -e; . deploy/orwell-tui.sh; type tui_active wt_menu wt_password wt_confirm_phrase >/dev/null'; then
  pass "orwell-tui.sh sources and exports the whiptail helpers"
else
  fail "orwell-tui.sh failed to source / is missing a helper"
fi
if ORWELL_NONINTERACTIVE=1 bash deploy/orwell-menu.sh --help >/dev/null 2>&1 \
   && ORWELL_NONINTERACTIVE=1 bash deploy/orwell-menu.sh </dev/null >/dev/null 2>&1; then
  pass "orwell-menu.sh degrades to help off a TTY (no dialog blocks automation)"
else
  fail "orwell-menu.sh did not run headlessly"
fi
# The destructive resets must still refuse to run unattended without --yes (the TUI is opt-in).
if ORWELL_NONINTERACTIVE=1 APP_DIR="$PWD" bash deploy/orwell-menu.sh reset-game </dev/null >/dev/null 2>&1; then
  fail "orwell-menu.sh reset-game ran WITHOUT --yes (must refuse unattended)"
else
  pass "orwell-menu.sh reset-game refuses unattended without --yes"
fi

# ── [A4] private-repo credential helper: git reads GIT_TOKEN from data/.env at use time ────────
# Proves the EXACT helper line the installer/update wire: against a token-required remote, git
# asks the helper and gets x-access-token + the .env token — no URL or .git/config credential.
echo "==> [A4] git credential helper reads the deploy token from data/.env"
A4_DIR="$(mktemp -d /tmp/orwell-smoke-a4-XXXXXX)"
(
  set -e
  mkdir -p "${A4_DIR}/app/data" "${A4_DIR}/repo"
  printf 'GIT_TOKEN=%s\n' "smoke-pat-$(date +%s)" > "${A4_DIR}/app/data/.env"
  git -C "${A4_DIR}/repo" init -q
  # The same helper command the deploy scripts configure (repo-local here, --system on the box).
  git -C "${A4_DIR}/repo" config credential.helper \
    '!f(){ echo username=x-access-token; echo "password=$(sed -n s/^GIT_TOKEN=//p '"${A4_DIR}/app"'/data/.env)"; };f'
  # Isolate from the machine's own helpers/prompts: this must pass on the configured line alone.
  out="$(printf 'protocol=https\nhost=github.com\npath=kevinhirsch/orwell.git\n\n' \
    | env HOME="$A4_DIR" GIT_CONFIG_NOSYSTEM=1 GIT_TERMINAL_PROMPT=0 GIT_ASKPASS=true \
      git -C "${A4_DIR}/repo" credential fill 2>/dev/null)"
  tok="$(sed -n 's/^GIT_TOKEN=//p' "${A4_DIR}/app/data/.env")"
  case "$out" in *"username=x-access-token"*) : ;; *) echo "MISSING-USERNAME"; exit 1 ;; esac
  case "$out" in *"password=${tok}"*) : ;; *) echo "MISSING-PASSWORD"; exit 1 ;; esac
) >/tmp/orwell-smoke-a4.log 2>&1 \
  && pass "credential helper supplies x-access-token + the .env token to git" \
  || fail "credential helper did not supply the token (see /tmp/orwell-smoke-a4.log)"
rm -rf "$A4_DIR"
# And the A4 lint: no deploy script may fetch branch tips from raw.githubusercontent (E84) —
# the bootstrap one-liner in comments/docs is the single sanctioned exception.
if grep -n 'raw\.githubusercontent\.com' $(git ls-files 'deploy/*.sh' 'deploy/**/*.sh') | grep -Ev '^[^:]+:[0-9]+:[[:space:]]*#' | grep -v 'grep' | grep -q .; then
  fail "a deploy script still fetches raw branch tips from GitHub (E84)"
else
  pass "no deploy script fetches branch tips from GitHub (E84 closed)"
fi
# ── [A11] the benign-noise stderr filter must never be able to fail the prefetch step ───────────
# Regression guard for a real prod break: the embedding-model prefetch pipes the worker's stderr
# through a `grep -v <affinity noise>` filter, and `grep -v` exits 1 when it filters out ALL input —
# and on an LXC that benign affinity line is often the ONLY stderr a SUCCESSFUL prefetch emits. Under
# orwell-install.sh's `set -Eeuo pipefail`, errtrace propagated that stray exit-1 into the ERR trap
# and reported a bogus "INSTALL FAILED during: embedding model prefetch" for a prefetch that in fact
# succeeded (node exited 0, model cached). The fix is a `|| true` inside the process substitution;
# assert it stays on every script that runs the filter so a future edit can't silently bring it back.
if grep -h "grep -vE 'pthread_setaffinity_np" deploy/orwell-install.sh deploy/orwell-update.sh \
   | grep -v '|| true' | grep -q .; then
  fail "an embedding-prefetch noise filter lacks the '|| true' guard — its no-match exit can fail the step (A11)"
else
  pass "embedding-prefetch noise filter keeps the '|| true' guard (A11; a good prefetch can't fail it)"
fi

# ── [4/4] the SYSTEM works (B71/ops A7): engine auth ON + the real front-end + a real turn ──────
# A green engine alone is compatible with a broken FE; this stage boots the actual app against a
# token-enforcing engine (proving B67 end-to-end) and drives create → advance → decision.
echo "==> [4/4] end-to-end: token-enforcing engine + the real front-end + one full turn"
if python3 -c "import uvicorn, httpx, fastapi" >/dev/null 2>&1; then
  SMOKE_TOKEN="smoke-$(date +%s)"
  FE_PORT="${ORWELL_PORT:-8798}"
  # Pre-flight: the FE port must be FREE — a stale process would answer our probes and make this
  # stage "verify" the wrong build (exactly the false-positive this stage exists to kill).
  if curl -fsS -o /dev/null --max-time 2 "http://127.0.0.1:${FE_PORT}/openapi.json" 2>/dev/null; then
    fail "port ${FE_PORT} is already in use — refusing to smoke against a stale front-end"
    echo; echo "SMOKE FAILED ($fails)"; exit 1
  fi
  stop_engine
  start_engine "$SMOKE_TOKEN" || exit 1
  # Without the token the engine refuses; with it, it serves (the B67 contract).
  no_auth="$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASE}/player/call" -H 'content-type: application/json' -d '{"name":"getGameState"}')"
  [ "$no_auth" = "401" ] && pass "tokenless call is refused (401)" || fail "tokenless call returned ${no_auth}, wanted 401"

  mkdir -p frontend/data  # a fresh checkout has none
  # AUTH_ENABLED=false + LOCALHOST_BYPASS=true (the boot_smoke convention): this stage proves the
  # FE<->engine seam under engine auth — the FE's own account system has its own tests.
  # ORWELL_ENRICHMENT_POLICY=soft (2026-07-11): the smoke wires no LLM, and the strict enrichment
  # policy (the prod default) would refuse the /new-game creation this stage drives — pin legacy soft.
  ( cd frontend && env ORWELL_ENGINE_MCP_URL="$BASE" ORWELL_ENGINE_TOKEN="$SMOKE_TOKEN" \
      AUTH_ENABLED=false LOCALHOST_BYPASS=true ORWELL_ENRICHMENT_POLICY=soft \
      python3 -m uvicorn app:app --host 127.0.0.1 --port "$FE_PORT" >/tmp/orwell-smoke-fe.log 2>&1 & echo $! > /tmp/orwell-smoke-fe.pid )
  FE_PID="$(cat /tmp/orwell-smoke-fe.pid)"
  fe_up=0
  # The FastAPI app imports a lot; on a loaded / lower-core (parallel self-hosted) runner the cold
  # boot can take well over 20s. Wait up to 120s (240 × 0.5s) — still bails immediately if the
  # process dies. A slow boot must not flake the smoke (it did on the self-hosted pool, #669).
  for _ in $(seq 1 240); do
    curl -fsS "http://127.0.0.1:${FE_PORT}/openapi.json" >/dev/null 2>&1 && { fe_up=1; break; }
    kill -0 "$FE_PID" 2>/dev/null || break
    sleep 0.5
  done
  if [ "$fe_up" = "1" ]; then
    pass "front-end boots on :${FE_PORT}"
    turn="$(ORWELL_SMOKE_FE="http://127.0.0.1:${FE_PORT}" ORWELL_SMOKE_ENGINE="$BASE" ORWELL_SMOKE_TOKEN="$SMOKE_TOKEN" python3 deploy/smoke_turn.py 2>&1)"
    echo "$turn" | sed 's/^/    /'
    have "$turn" "TURN OK" && pass "create → advance → decision completes through the system" \
      || fail "the full turn did not complete"
  else
    fail "front-end did not boot (see /tmp/orwell-smoke-fe.log)"
  fi
  kill "$FE_PID" 2>/dev/null; wait "$FE_PID" 2>/dev/null
else
  echo "  skip — front-end deps (uvicorn/httpx/fastapi) not importable here; CI installs them"
fi

echo
if [ "$fails" -eq 0 ]; then echo "SMOKE PASSED"; exit 0; else echo "SMOKE FAILED ($fails)"; exit 1; fi
