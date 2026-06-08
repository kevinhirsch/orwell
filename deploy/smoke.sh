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

start_engine() {
  ORWELL_ENGINE_PORT="$PORT" node dist/main.js >/tmp/orwell-smoke-engine.log 2>&1 &
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
if grep -qE 'rm[[:space:]].*data|rm -rf' deploy/orwell-update.sh; then
  fail "orwell-update.sh appears to delete data/"
else
  pass "orwell-update.sh never deletes data/ (save preserved)"
fi

echo
if [ "$fails" -eq 0 ]; then echo "SMOKE PASSED"; exit 0; else echo "SMOKE FAILED ($fails)"; exit 1; fi
