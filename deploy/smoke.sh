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

start_engine() { # optional $1 = a shared token to enforce (B67/B71)
  env ORWELL_ENGINE_PORT="$PORT" ${1:+ORWELL_ENGINE_TOKEN="$1"} node dist/main.js >/tmp/orwell-smoke-engine.log 2>&1 &
  ENGINE_PID=$!
  for _ in $(seq 1 30); do
    if curl -fsS "${BASE}/health" >/dev/null 2>&1; then return 0; fi
    if ! kill -0 "$ENGINE_PID" 2>/dev/null; then echo "engine exited early:"; cat /tmp/orwell-smoke-engine.log; return 1; fi
    sleep 0.5
  done
  echo "engine did not become healthy:"; cat /tmp/orwell-smoke-engine.log; return 1
}
stop_engine() { [ -n "$ENGINE_PID" ] && kill "$ENGINE_PID" 2>/dev/null; wait "$ENGINE_PID" 2>/dev/null; ENGINE_PID=""; }
cleanup() { stop_engine; }
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
check  "player tools: resolveCompetition" "$player_tools" 'resolveCompetition'
refute "player channel hides admin tool" "$player_tools" 'inspectNonVaultState'

admin_tools="$(curl -fsS "${BASE}/admin/tools")"
check  "admin tools: inspectNonVaultState" "$admin_tools" 'inspectNonVaultState'
refute "admin channel hides action tool" "$admin_tools" 'resolveCompetition'

check  "createCharacter -> started"     "$(pcall '{"name":"createCharacter","args":{"playerName":"Smoke"}}')" '"started":true'
state="$(pcall '{"name":"getGameState","args":{}}')"
check  "getGameState -> started"        "$state" '"started":true'
refute "house roster carries no soul"   "$state" '"soul"'
check  "getMomentPrompt -> systemPrompt" "$(pcall '{"name":"getMomentPrompt","args":{}}')" '"systemPrompt"'
runcomp="$(pcall '{"name":"runCompetition","args":{"type":"endurance"}}')"
check  "runCompetition -> winner (live house)" "$runcomp" '"winner"'
refute "runCompetition hides stats/scores"     "$runcomp" '"physical"'
comp='{"name":"resolveCompetition","args":{"type":"endurance","participants":[{"id":"player","stats":{"physical":0.5,"mental":0.5,"social":0.5}},{"id":"npc:1","stats":{"physical":0.6,"mental":0.5,"social":0.5}}],"intents":[],"seed":1}}'
check  "resolveCompetition -> winner"   "$(pcall "$comp")" '"winner"'
refute "competition result hides scores" "$(pcall "$comp")" '"score'

# Channel isolation: a player server must refuse an admin tool.
check  "player refuses admin tool"      "$(pcall '{"name":"inspectNonVaultState","args":{}}')" 'error'

echo "==> [3/3] simulate update (rebuild + restart), assert still healthy"
stop_engine
npm run build >/tmp/orwell-smoke-build2.log 2>&1 && pass "rebuild (update) succeeds" || fail "rebuild"
start_engine && pass "engine healthy after update" || fail "engine unhealthy after update"
# Data safety: the update script must never delete the save directory.
if grep -E '\brm\b' deploy/orwell-update.sh | grep -q 'data'; then
  fail "orwell-update.sh appears to delete data/"
else
  pass "orwell-update.sh never deletes data/ (save preserved)"
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
  ( cd frontend && env ORWELL_ENGINE_MCP_URL="$BASE" ORWELL_ENGINE_TOKEN="$SMOKE_TOKEN" \
      AUTH_ENABLED=false LOCALHOST_BYPASS=true \
      python3 -m uvicorn app:app --host 127.0.0.1 --port "$FE_PORT" >/tmp/orwell-smoke-fe.log 2>&1 & echo $! > /tmp/orwell-smoke-fe.pid )
  FE_PID="$(cat /tmp/orwell-smoke-fe.pid)"
  fe_up=0
  for _ in $(seq 1 40); do
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
