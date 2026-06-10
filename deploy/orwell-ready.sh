#!/usr/bin/env bash
#
# orwell-ready.sh (B72/ops A8) — READINESS, not just liveness: a green run means a player can
# actually sit down and play. Checks: the engine answers, the front-end answers, and an LLM is
# genuinely configured (the front-end reports at least one usable model).
#
# Exit 0 = ready · 1 = not ready (each failing check is named).
set -uo pipefail

ENGINE="${ORWELL_ENGINE_MCP_URL:-http://127.0.0.1:${ORWELL_ENGINE_PORT:-8765}}"
FE="http://127.0.0.1:${ORWELL_PORT:-8000}"
fails=0
ok()   { echo "  ok  — $*"; }
bad()  { echo "  NOT READY — $*"; fails=$((fails + 1)); }

curl -fsS --max-time 5 "${ENGINE%/}/health" >/dev/null 2>&1 \
  && ok "engine reachable (${ENGINE})" || bad "engine unreachable (${ENGINE})"

curl -fsS --max-time 5 "${FE}/openapi.json" >/dev/null 2>&1 \
  && ok "front-end up (${FE})" || bad "front-end down (${FE})"

# LLM configured: the FE's model listing must expose at least one ONLINE model. The route shape
# is {items:[{models:[...], offline}]} (the onboarding gate uses the same probe).
models="$(curl -fsS --max-time 10 "${FE}/api/models" 2>/dev/null || true)"
if printf '%s' "$models" | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(1)
items = d.get('items') or []
usable = any((i.get('models') and not i.get('offline')) for i in items if isinstance(i, dict))
sys.exit(0 if usable else 1)
" 2>/dev/null; then
  ok "an LLM is configured and online"
else
  bad "no usable LLM (configure under Settings -> Services/AI, or set LLM_HOSTS/OPENAI_API_KEY in data/.env)"
fi

echo
if [[ "$fails" -eq 0 ]]; then echo "READY"; exit 0; else echo "NOT READY (${fails})"; exit 1; fi
