#!/usr/bin/env bash
# run_mirror_gate.sh — stand up the REAL stack (engine + deterministic fake model + front-end + a
# STARTED game) and run the two-window live-parity gate (mirror_live_parity.mjs) end to end.
#
# Model-independent: uses fake_model_server.mjs (deterministic streamed echo) so the gate needs NO
# API key and is reproducible/CI-fast. Proves the F5 "realtime two-window mirror parity" invariant
# (ADR 0012 §3.3 / refactor-roadmap R0). Exits non-zero when the windows diverge during streaming.
#
#   bash docs/audits/playtest-harness/run_mirror_gate.sh
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
HARNESS="$ROOT/docs/audits/playtest-harness"
SANDBOX="${MIRROR_SANDBOX:-$ROOT/.audit-telemetry}"
LOGS="$SANDBOX/logs"; mkdir -p "$LOGS"
ENGINE_PORT=8765; FE_PORT=7000; FAKE_PORT=8011
ADMIN_USER=admin; ADMIN_PW="mirror-gate-pw"   # stable throwaway local admin (never committed)
FE_DATA="$ROOT/frontend/data"                 # the dir the app actually reads (auth.json is hardcoded data/auth.json)
LIVE="${MIRROR_LIVE:-}"                        # MIRROR_LIVE=1 → real OpenRouter model (env ORWELL_TEST_OPENROUTER_KEY); else the deterministic fake
TOOLTURN="${MIRROR_TOOLTURN:-}"                 # MIRROR_TOOLTURN=1 → the tool-rich multi-round settled-parity gate (fake_model_server FAKE_SCRIPT=toolturn)
# Browser location — overridable so the same driver runs under CI (or any box) without editing it.
# Defaults match this sandbox's provisioning (global npm playwright + chromium under /opt/pw-browsers);
# a caller (e.g. the CI job) can point these elsewhere. Leave PW_CHROMIUM empty to let playwright
# auto-resolve the browser from PLAYWRIGHT_BROWSERS_PATH.
export PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-/opt/pw-browsers}"
export PW_CHROMIUM="${PW_CHROMIUM-/opt/pw-browsers/chromium}"
export BASE_URL="http://127.0.0.1:$FE_PORT"; export ENGINE_URL="http://127.0.0.1:$ENGINE_PORT"

PIDS=()
cleanup() {
  for p in "${PIDS[@]:-}"; do kill "$p" 2>/dev/null; done
  pkill -f 'fake_model_server.mjs' 2>/dev/null
  pkill -f "uvicorn app:app --host 127.0.0.1 --port $FE_PORT" 2>/dev/null
  pkill -f 'dist/main.js' 2>/dev/null
  return 0
}
trap cleanup EXIT
# defensive: clear strays from a prior aborted run before we bind the ports
pkill -9 -f 'fake_model_server.mjs' 2>/dev/null; pkill -9 -f "uvicorn app:app --host 127.0.0.1 --port $FE_PORT" 2>/dev/null; pkill -9 -f 'dist/main.js' 2>/dev/null; sleep 1 || true
say() { printf '\n\033[1;36m== %s\033[0m\n' "$*"; }
wait_http() { local url="$1" name="$2" n=0; until curl -sf -o /dev/null --max-time 3 "$url"; do n=$((n+1)); [ $n -ge 40 ] && { echo "!! $name never came up ($url)"; return 1; }; sleep 1; done; echo "ok: $name"; }

# 0) playwright resolvable for the harness's `import 'playwright'`. The rig only drives an EXISTING
#    chromium (executablePath=$PW_CHROMIUM), so we need just the JS driver — never a browser download.
#    Resolution order, most-portable first, so the SAME driver runs on this sandbox AND a clean CI
#    runner: (a) already resolvable? done. (b) a GLOBAL npm playwright to symlink in. (c) neither —
#    install it locally, no-save, browser-download skipped. package.json intentionally does NOT carry
#    playwright (it's not a runtime/engine dep); this keeps the gate self-contained regardless of host.
PW_VER="${MIRROR_PW_VERSION:-1.56.1}"   # match the chromium provisioned under $PLAYWRIGHT_BROWSERS_PATH
say "0) ensure playwright resolvable for the harness"
mkdir -p "$ROOT/node_modules"
pw_ok() { node -e "import('playwright').then(()=>process.exit(0)).catch(()=>process.exit(1))" >/dev/null 2>&1; }
if ! pw_ok; then
  PW_GLOBAL="$(npm root -g 2>/dev/null || true)"
  if [ -n "$PW_GLOBAL" ] && [ -d "$PW_GLOBAL/playwright" ]; then
    ln -sfn "$PW_GLOBAL/playwright" "$ROOT/node_modules/playwright"
    [ -d "$PW_GLOBAL/playwright-core" ] && ln -sfn "$PW_GLOBAL/playwright-core" "$ROOT/node_modules/playwright-core" 2>/dev/null || true
  fi
fi
if ! pw_ok; then
  say "0b) no resolvable playwright (no global) — installing locally (no-save, browser download skipped)"
  ( cd "$ROOT" && PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install --no-save --no-audit --no-fund "playwright@$PW_VER" >"$LOGS/pw-install.log" 2>&1 ) \
    || { echo "!! playwright install failed"; tail -30 "$LOGS/pw-install.log" 2>/dev/null; exit 1; }
fi
node -e "import('playwright').then(()=>console.log('playwright import ok')).catch(e=>{console.error(e);process.exit(1)})" || exit 1

# secrets file the rig reads for admin login (gitignored — see .gitignore add).
printf 'ADMIN_USER=%s\nADMIN_PW=%s\n' "$ADMIN_USER" "$ADMIN_PW" > "$HARNESS/.secrets.env"

# 1) engine
say "1) engine :$ENGINE_PORT"
rm -rf "$SANDBOX/engine-data"; mkdir -p "$SANDBOX/engine-data"
( cd "$ROOT" && ORWELL_ENGINE_PORT=$ENGINE_PORT ORWELL_DATA_DIR="$SANDBOX/engine-data" \
    exec node dist/main.js >"$LOGS/engine.log" 2>&1 ) & PIDS+=($!)
wait_http "$ENGINE_URL/health" engine || { tail -20 "$LOGS/engine.log"; exit 1; }

# 2) model: the deterministic fake (default) OR a real provider for the live pre-merge pass
if [ -z "$LIVE" ]; then
  say "2) fake model :$FAKE_PORT${TOOLTURN:+ (FAKE_SCRIPT=toolturn)}"
  ( FAKE_MODEL_PORT=$FAKE_PORT FAKE_SCRIPT="${TOOLTURN:+toolturn}" exec node "$HARNESS/fake_model_server.mjs" >"$LOGS/fake.log" 2>&1 ) & PIDS+=($!)
  wait_http "http://127.0.0.1:$FAKE_PORT/v1/models" fake-model || { tail "$LOGS/fake.log"; exit 1; }
else
  say "2) LIVE model (real provider; fake skipped)"
  [ -n "${ORWELL_TEST_OPENROUTER_KEY:-}" ] || { echo "!! MIRROR_LIVE=1 needs ORWELL_TEST_OPENROUTER_KEY in the env (runtime-only)"; exit 1; }
fi

# 3) front-end (auth ON + admin account → endpoints get owner=admin, dodging the owner-NULL 400 trap)
say "3) front-end :$FE_PORT"
# clean slate: a stale admin/session/endpoint from a prior run breaks login or canonical binding.
rm -f "$FE_DATA/auth.json" "$FE_DATA/sessions.json" "$FE_DATA/app.db" "$FE_DATA/settings.json"; mkdir -p "$FE_DATA"
( cd "$ROOT/frontend" && ORWELL_ADMIN_USER=$ADMIN_USER ORWELL_ADMIN_PASSWORD="$ADMIN_PW" \
    ORWELL_SKIP_ADMIN_PROMPT=1 ORWELL_SKIP_RUN_HINT=1 ORWELL_DATA_DIR="$FE_DATA" \
    .venv/bin/python setup.py >"$LOGS/fe-setup.log" 2>&1 )
( cd "$ROOT/frontend" && ORWELL_GAME_BUILD=1 AUTH_ENABLED=true LOCALHOST_BYPASS=false \
    ORWELL_ENGINE_MCP_URL="$ENGINE_URL" ORWELL_DATA_DIR="$FE_DATA" \
    exec .venv/bin/python -m uvicorn app:app --host 127.0.0.1 --port $FE_PORT >"$LOGS/fe.log" 2>&1 ) & PIDS+=($!)
wait_http "$BASE_URL/login" frontend || { tail -30 "$LOGS/fe.log"; exit 1; }

# 4) admin login + point the default model at the fake server (or the real provider when LIVE)
if [ -z "$LIVE" ]; then
  EP_NAME=Fake;       EP_BASE="http://127.0.0.1:$FAKE_PORT/v1";   EP_KEY=fake-key;                        EP_MODEL="fake/echo-stream"
else
  EP_NAME=OpenRouter; EP_BASE="https://openrouter.ai/api/v1";     EP_KEY="$ORWELL_TEST_OPENROUTER_KEY";    EP_MODEL="${MIRROR_LIVE_MODEL:-deepseek/deepseek-v4-pro}"
fi
say "4) configure model → $EP_NAME ($EP_MODEL)"
CK="$SANDBOX/cookies.txt"
curl -s -c "$CK" -X POST "$BASE_URL/api/auth/login" -H 'Content-Type: application/json' \
  -d "{\"username\":\"$ADMIN_USER\",\"password\":\"$ADMIN_PW\"}" -o "$LOGS/login.json"
EP=$(curl -s -b "$CK" -X POST "$BASE_URL/api/model-endpoints" \
  -F "name=$EP_NAME" -F "base_url=$EP_BASE" -F "api_key=$EP_KEY" \
  -F "endpoint_kind=api" -F "model_type=llm" -F "require_models=true" | tee "$LOGS/endpoint.json" \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{console.log(JSON.parse(s).id||'')}catch(_){console.log('')}})")
echo "endpoint id: ${EP:-<none>}"
curl -s -b "$CK" -X POST "$BASE_URL/api/auth/settings" -H 'Content-Type: application/json' \
  -d "{\"default_endpoint_id\":\"$EP\",\"default_model\":\"$EP_MODEL\",\"default_model_fallbacks\":[]}" -o "$LOGS/settings.json"
curl -s -b "$CK" "$BASE_URL/api/default-chat" -o "$LOGS/default-chat.json"; echo "default-chat: $(cat "$LOGS/default-chat.json")"

# 5) seed a STARTED season (debug door) so canonical keying engages and B mirrors live
say "5) seed started game"
curl -s -b "$CK" -X POST "$BASE_URL/api/orwell/new-game" -H 'Content-Type: application/json' \
  -d '{"playerName":"Avery Quinn","archetype":"social","strategyStyle":"social","seed":51000,"confirm":true}' -o "$LOGS/new-game.json"
echo "new-game: $(head -c 200 "$LOGS/new-game.json")"
curl -s -b "$CK" "$BASE_URL/api/orwell/state" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const j=JSON.parse(s);console.log('started=',j.started,'house=',(j.house||[]).length,'beat=',j.beatSeq)}catch(e){console.log('state parse err')}})"

# 6) run the gate — MIRROR_HUD=1 selects the HUD-parity gate (F5 status/gadget half, 0064 §B/D);
#    MIRROR_TOOLTURN=1 selects the tool-rich multi-round settled-parity gate (H1/H2 — needs the
#    fake model booted with FAKE_SCRIPT=toolturn, step 2 above); default is the chat-render
#    live-parity gate (F5 chat-render half, R2 / ADR 0015).
if [ -n "${MIRROR_HUD:-}" ]; then
  say "6) MIRROR HUD-PARITY GATE (F5 status/gadget half · 0064 §B/D)"
  cd "$ROOT" && node "$HARNESS/mirror_hud_parity.mjs"
  GATE=$?
  echo ""; echo "gate exit: $GATE  (0=PASS B's HUD mirrors A's mutation off the push · 1=FAIL stale-until-poll · 2=precondition unmet)"
elif [ -n "$TOOLTURN" ]; then
  say "6) MIRROR TOOL-TURN (multi-round) PARITY GATE (H1/H2 — dedup/orphan across a tool-rich turn)"
  cd "$ROOT" && node "$HARNESS/mirror_toolturn_parity.mjs"
  GATE=$?
  echo ""; echo "gate exit: $GATE  (0=PASS no dup/orphan across two windows on a tool-rich turn · 1=FAIL · 2=precondition unmet)"
else
  say "6) MIRROR LIVE-PARITY GATE"
  cd "$ROOT" && node "$HARNESS/mirror_live_parity.mjs"
  GATE=$?
  echo ""; echo "gate exit: $GATE  (0=PASS windows mirror live · 1=FAIL diverge · 2=precondition unmet)"
fi
exit $GATE
