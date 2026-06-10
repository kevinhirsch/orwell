#!/usr/bin/env bash
#
# deploy/orwell-doctor.sh — diagnose and (by default) FIX a deployed Orwell instance.
#
# Inside the container:
#   bash deploy/orwell-doctor.sh             # diagnose; restart whatever is unhealthy; verify
#   bash deploy/orwell-doctor.sh --status    # diagnose only — no restarts
#   bash deploy/orwell-doctor.sh --bounce    # unconditional restart of engine + front-end; verify
#
# From the PROXMOX HOST (same bridge as orwell-update.sh / orwell-factory-reset.sh — it
# locates the orwell LXC by hostname "orwell", override with CTID=<id> / CT_HOSTNAME=<name>,
# and re-runs itself inside, forwarding the flag):
#   bash -c "$(curl -fsSL https://raw.githubusercontent.com/kevinhirsch/orwell/main/deploy/orwell-doctor.sh)"
#   bash -c "$(curl -fsSL .../deploy/orwell-doctor.sh)" -- --status
#   CTID=112 bash -c "$(curl -fsSL .../deploy/orwell-doctor.sh)" -- --bounce
#
# For the systemd install (orwell-install.sh): units orwell-engine / orwell-frontend
# (legacy bbai-* detected automatically), app in /opt/orwell or legacy /opt/bbai
# (override: ORWELL_HOME), config in <app>/data/.env. Exit 0 = healthy at the end;
# non-zero = still broken (the script prints the failing unit's recent journal so you
# can see why).
#
# What "healthy" means here, end to end:
#   1. both units active;
#   2. the engine answers /health on its loopback port;
#   3. the engine actually SERVES tools (a getGameState probe answers — "no active game"
#      for a probe user is the expected healthy reply);
#   4. the front-end answers /api/orwell/health and reports engine:true — i.e. the two
#      tiers agree (catches a wrong ORWELL_ENGINE_MCP_URL even when both processes run).
set -uo pipefail

MODE="${1:---fix}"
BRANCH="${BRANCH:-main}"
CT_HOSTNAME="${CT_HOSTNAME:-orwell}"
die() { echo "ERROR: $*" >&2; exit 1; }

# First REAL install found: an explicit override, then the current path, then the legacy one.
# The marker is the git checkout (`<app>/.git`), exactly like orwell-update.sh /
# orwell-factory-reset.sh — a bare directory is NOT an install (a leftover empty /opt/orwell
# on the Proxmox host must not stop the bridge; that bug ran the doctor on the host itself).
find_app() {
  local d
  for d in "${ORWELL_HOME:-}" "${APP_DIR:-}" /opt/orwell /opt/bbai; do
    [[ -n "$d" && -d "$d/.git" ]] && { echo "$d"; return 0; }
  done
  return 1
}

# ── Host → container bridge ─────────────────────────────────────────────────────────────
# On a Proxmox host (pct present, no app dir) locate the orwell LXC and re-run this script
# inside it, forwarding the mode flag. Same pattern as orwell-factory-reset.sh. When run
# from a local file, push THAT file (no network, no branch drift); when run via
# `bash -c "$(curl ...)"` there is no file, so fetch the script from ${BRANCH}.
if command -v pct >/dev/null 2>&1 && ! find_app >/dev/null 2>&1; then
  CTID="${CTID:-$(pct list 2>/dev/null | awk -v n="$CT_HOSTNAME" 'NR>1 && $NF==n {print $1}' || true)}"
  [[ -n "$CTID" ]] || die "no orwell LXC found (hostname '${CT_HOSTNAME}'). Set CTID=<id> and retry."
  [[ "$(printf '%s' "$CTID" | wc -w)" -eq 1 ]] || die "multiple containers named '${CT_HOSTNAME}' (${CTID//$'\n'/ }). Set CTID=<id>."
  [[ "$(pct status "$CTID" 2>/dev/null)" == *running* ]] || die "LXC ${CTID} is not running — start it first: pct start ${CTID}"

  echo "==> orwell lives in LXC ${CTID}; running the doctor inside the container"
  TMP_DOC="$(mktemp /tmp/orwell-doctor-XXXXXX.sh)"
  if [[ -n "${BASH_SOURCE[0]:-}" && -r "${BASH_SOURCE[0]:-}" ]]; then
    cp "${BASH_SOURCE[0]}" "$TMP_DOC"
  else
    curl -fsSL "https://raw.githubusercontent.com/kevinhirsch/orwell/${BRANCH}/deploy/orwell-doctor.sh" -o "$TMP_DOC" \
      || die "could not fetch orwell-doctor.sh from branch '${BRANCH}'"
  fi
  pct push "$CTID" "$TMP_DOC" /tmp/orwell-doctor.sh || die "pct push into LXC ${CTID} failed"
  rm -f "$TMP_DOC"
  pct exec "$CTID" -- bash /tmp/orwell-doctor.sh "$MODE"
  exit $?
fi

APP_DIR="$(find_app || echo "${ORWELL_HOME:-/opt/orwell}")"
ENV_FILE="${APP_DIR}/data/.env"

fails=0
pass() { echo "  ok   — $*"; }
warn() { echo "  warn — $*"; }
fail() { echo "  FAIL — $*"; fails=$((fails + 1)); }

# ---- service names (legacy-aware, mirrors orwell-update.sh) -------------------------
if systemctl list-unit-files 2>/dev/null | grep -q '^bbai-engine\.service'; then
  ENGINE_SVC="bbai-engine"; FRONTEND_SVC="bbai-frontend"
else
  ENGINE_SVC="orwell-engine"; FRONTEND_SVC="orwell-frontend"
fi

# ---- config ---------------------------------------------------------------------------
ENGINE_PORT="8765"; FE_PORT=""; MCP_URL=""
if [[ -f "$ENV_FILE" ]]; then
  pass "config: ${ENV_FILE}"
  # shellcheck disable=SC2046
  ENGINE_PORT="$(grep -E '^ORWELL_ENGINE_PORT=' "$ENV_FILE" | tail -1 | cut -d= -f2- || true)"
  FE_PORT="$(grep -E '^ORWELL_PORT=' "$ENV_FILE" | tail -1 | cut -d= -f2- || true)"
  MCP_URL="$(grep -E '^ORWELL_ENGINE_MCP_URL=' "$ENV_FILE" | tail -1 | cut -d= -f2- || true)"
  ENGINE_PORT="${ENGINE_PORT:-8765}"
else
  warn "config: ${ENV_FILE} not found (using defaults; set ORWELL_HOME if installed elsewhere)"
fi
ENGINE_BASE="http://127.0.0.1:${ENGINE_PORT}"
[[ -n "$FE_PORT" ]] && FE_BASE="http://127.0.0.1:${FE_PORT}" || FE_BASE=""

# The classic silent misconfig: the front-end pointed at a port the engine doesn't listen on.
if [[ -n "$MCP_URL" ]] && ! grep -q ":${ENGINE_PORT}" <<<"$MCP_URL"; then
  fail "ORWELL_ENGINE_MCP_URL (${MCP_URL}) does not match ORWELL_ENGINE_PORT (${ENGINE_PORT}) — fix ${ENV_FILE}"
fi

# ---- probes ---------------------------------------------------------------------------
unit_active() { systemctl is-active --quiet "$1" 2>/dev/null; }

engine_http_ok() { curl -fsS -m 3 "${ENGINE_BASE}/health" 2>/dev/null | grep -q '"ok":true'; }

# A reachable engine must SERVE tools. For a probe user the healthy reply is the structured
# "no active game" refusal (404) — connection-refused/timeouts mean down.
engine_serves_tools() {
  local out
  out="$(curl -s -m 5 -X POST "${ENGINE_BASE}/player/call" \
          -H 'content-type: application/json' -H 'X-Orwell-User: __doctor__' \
          -d '{"name":"getGameState","args":{}}' 2>/dev/null)" || return 1
  grep -Eq '"result"|no active game' <<<"$out"
}

fe_http_ok() { [[ -n "$FE_BASE" ]] && curl -fsS -m 5 "${FE_BASE}/api/orwell/health" >/dev/null 2>&1; }

fe_sees_engine() {
  [[ -n "$FE_BASE" ]] && curl -fsS -m 5 "${FE_BASE}/api/orwell/health" 2>/dev/null | grep -q '"engine":\s*true'
}

wait_for() { # label  probe-fn  tries
  local label="$1" probe="$2" tries="${3:-30}"
  for _ in $(seq 1 "$tries"); do
    if "$probe"; then pass "$label"; return 0; fi
    sleep 0.5
  done
  fail "$label"
  return 1
}

journal_tail() {
  echo "---- last 25 journal lines: $1 ----"
  journalctl -u "$1" -n 25 --no-pager 2>/dev/null || echo "(journalctl unavailable — run as root?)"
  echo "-----------------------------------"
}

diagnose() {
  echo "==> diagnose (engine=${ENGINE_SVC} :${ENGINE_PORT}, frontend=${FRONTEND_SVC}${FE_PORT:+ :${FE_PORT}})"
  unit_active "$ENGINE_SVC"   && pass "unit active: ${ENGINE_SVC}"   || fail "unit active: ${ENGINE_SVC}"
  unit_active "$FRONTEND_SVC" && pass "unit active: ${FRONTEND_SVC}" || fail "unit active: ${FRONTEND_SVC}"
  [[ -f "${APP_DIR}/dist/main.js" ]] && pass "build artifact: dist/main.js" || fail "build artifact missing — run: bash ${APP_DIR}/deploy/orwell-update.sh"
  engine_http_ok       && pass "engine /health answers"        || fail "engine /health answers (${ENGINE_BASE}/health)"
  engine_serves_tools  && pass "engine serves player tools"    || fail "engine serves player tools"
  if [[ -n "$FE_BASE" ]]; then
    fe_http_ok       && pass "front-end answers /api/orwell/health" || fail "front-end answers /api/orwell/health (${FE_BASE})"
    fe_sees_engine   && pass "front-end sees the engine (engine:true)" \
                     || fail "front-end CANNOT see the engine — check ORWELL_ENGINE_MCP_URL in ${ENV_FILE}"
  else
    warn "ORWELL_PORT not set in ${ENV_FILE} — skipping front-end probes"
  fi
}

bounce() {
  if [[ $EUID -ne 0 ]]; then
    echo "Restarting services needs root. Re-run:  sudo bash $0 ${MODE}"
    exit 2
  fi
  # If the unit doesn't exist on THIS machine, restarting (and waiting) is meaningless: either
  # orwell isn't installed here, or you are on the Proxmox host and the app lives in the LXC.
  if ! systemctl cat "$ENGINE_SVC" >/dev/null 2>&1; then
    fail "unit ${ENGINE_SVC} is not installed on this machine"
    echo "  -> If orwell runs in an LXC: run this script on the Proxmox host (it bridges via pct;"
    echo "     set CTID=<id> if the container is not named '${CT_HOSTNAME}')."
    echo "  -> If this IS the right machine: install first — bash deploy/orwell-install.sh"
    return 1
  fi
  echo "==> bounce: engine first, then front-end (front-end depends on the engine)"
  systemctl restart "$ENGINE_SVC"
  wait_for "engine healthy after restart" engine_http_ok 40 || { journal_tail "$ENGINE_SVC"; return 1; }
  wait_for "engine serves tools after restart" engine_serves_tools 20 || { journal_tail "$ENGINE_SVC"; return 1; }
  systemctl restart "$FRONTEND_SVC"
  if [[ -n "$FE_BASE" ]]; then
    wait_for "front-end healthy after restart" fe_http_ok 40 || { journal_tail "$FRONTEND_SVC"; return 1; }
    wait_for "front-end sees the engine" fe_sees_engine 20 || { journal_tail "$FRONTEND_SVC"; journal_tail "$ENGINE_SVC"; return 1; }
  fi
  return 0
}

# ---- main ------------------------------------------------------------------------------
case "$MODE" in
  --status)
    diagnose
    ;;
  --bounce)
    diagnose
    fails=0  # the pre-bounce picture is informational; the verdict is post-bounce health
    bounce || true
    ;;
  --fix|*)
    diagnose
    if [[ $fails -gt 0 ]]; then
      echo "==> ${fails} problem(s) found — bouncing"
      fails=0
      bounce || true
    else
      echo "==> everything healthy — nothing to fix (use --bounce to force a restart)"
    fi
    ;;
esac

echo
if [[ $fails -eq 0 ]]; then
  echo "VERDICT: healthy."
else
  echo "VERDICT: still broken (${fails} failing check(s) — journals above)."
  echo "Next steps:"
  echo "  journalctl -u ${ENGINE_SVC} -n 100 --no-pager     # engine crash reason"
  echo "  journalctl -u ${FRONTEND_SVC} -n 100 --no-pager   # front-end crash reason"
  echo "  bash ${APP_DIR}/deploy/orwell-update.sh            # rebuild + restart from git"
fi
exit "$fails"
