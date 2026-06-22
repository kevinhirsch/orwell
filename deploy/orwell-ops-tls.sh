#!/usr/bin/env bash
#
# orwell — ops runner: "Local HTTPS" apply/disable (feature 0074, ADR 0014).
#
# Started by orwell-ops-tls.service when the admin "Local HTTPS" card drops the existence-only flag
# data/ops/tls-requested. This is the privileged box side of the UI-driven local-TLS flow. The route
# layer has ALREADY validated the proposed config at request time (sanitised host names, fail closed);
# this script only translates what the wizard wrote into deploy/orwell-https.sh flags and runs it.
#
# DELIBERATELY ROOT (see the unit's comments): orwell-https.sh edits data/.env, apt-installs caddy,
# writes /etc/caddy/Caddyfile, enables a systemd service, and restarts the FE — none of which the
# E85-hardened web tier (User=orwell, empty capability set) can do. Containment is by DESIGN: only this
# one fixed script path runs; the flag is existence-only (its content is never read), and the side
# inputs the web tier writes are config DATA, never interpolated into any command.
#
# Side inputs the route layer wrote under data/ops/ (the contract; names are load-bearing):
#   tls-requested      existence-only flag (removed by the unit's ExecStartPre)
#   tls.json           {action:"apply"|"disable", mode, localNames:[…], domains:[…], dnsProvider, hasToken, ts}
#   tls-dns-token      0600; the DNS provider API token — CONSUMED + SHREDDED here, never logged
# Outputs:
#   tls-status.json    live progress (via orwell-ops-progress.sh) the admin page reads
#   ops-tls.log        the appended run log the status page tails (StandardOutput=append)
#
# THE DNS TOKEN IS A SECRET: it is never echoed to stdout/stderr (this whole script's output is the
# public run log), never written anywhere but its 0600 file, and is handed to orwell-https.sh via an
# ENV var (not argv) then SHREDDED. Re-runnable / idempotent.
set -Eeuo pipefail

find_app() {
  local d
  for d in "${APP_DIR:-}" /opt/orwell /opt/bbai; do
    [[ -n "$d" && -d "$d/.git" ]] && { printf '%s' "$d"; return 0; }
  done
  return 1
}
APP_DIR="$(find_app || true)"; APP_DIR="${APP_DIR:-/opt/orwell}"
DATA_DIR="${ORWELL_DATA_DIR:-${APP_DIR%/}/data}"
OPS_DIR="${DATA_DIR%/}/ops"
CONFIG_FILE="${OPS_DIR}/tls.json"
TOKEN_FILE="${OPS_DIR}/tls-dns-token"
FLAG_FILE="${OPS_DIR}/tls-requested"
HTTPS_SH="${APP_DIR%/}/deploy/orwell-https.sh"

# ── ops-progress lane (best-effort; missing helper ⇒ no-op stubs) ─────────────────────────────────
__here="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd || true)"
for __pf in "${__here}/orwell-ops-progress.sh" /opt/orwell/deploy/orwell-ops-progress.sh /opt/bbai/deploy/orwell-ops-progress.sh; do
  if [[ -n "${__pf:-}" && -r "$__pf" ]]; then . "$__pf"; break; fi
done
type ops_progress_init >/dev/null 2>&1 || { ops_progress_init() { :; }; ops_progress_step() { :; }; ops_progress_done() { :; }; ops_progress_fail() { :; }; }
export ORWELL_OPS_DIR="${OPS_DIR}"

shred_token() {
  [[ -e "$TOKEN_FILE" ]] || return 0
  if command -v shred >/dev/null 2>&1; then
    shred -u "$TOKEN_FILE" 2>/dev/null || { dd if=/dev/zero of="$TOKEN_FILE" bs=1024 count=1 conv=notrunc 2>/dev/null || true; rm -f "$TOKEN_FILE"; }
  else
    dd if=/dev/zero of="$TOKEN_FILE" bs=1024 count=1 conv=notrunc 2>/dev/null || true
    rm -f "$TOKEN_FILE"
  fi
}
cleanup_side_files() { shred_token; rm -f "$CONFIG_FILE" "$FLAG_FILE" 2>/dev/null || true; }
trap 'rc=$?; if [[ "$rc" -ne 0 ]]; then ops_progress_fail "local-HTTPS apply exited with code $rc — see ops-tls.log"; fi; cleanup_side_files' EXIT

[[ -r "$CONFIG_FILE" ]] || { ops_progress_init "tls" 3; ops_progress_fail "no tls.json side config found"; echo "ERROR: ${CONFIG_FILE} missing" >&2; exit 1; }
[[ -x "$HTTPS_SH" || -r "$HTTPS_SH" ]] || { ops_progress_init "tls" 3; ops_progress_fail "deploy/orwell-https.sh not found"; echo "ERROR: ${HTTPS_SH} missing" >&2; exit 1; }

# Parse the non-secret config (tolerant). NEVER reads the token (that lives only in its 0600 file).
read_cfg() {
  python3 - "$CONFIG_FILE" "$1" <<'PY' 2>/dev/null || true
import json, sys
try:
    with open(sys.argv[1], encoding="utf-8") as fh:
        cfg = json.load(fh)
except Exception:
    sys.exit(0)
key = sys.argv[2]
val = cfg.get(key)
if isinstance(val, list):
    print(",".join(str(x).strip() for x in val if str(x).strip()))
elif val is not None:
    print(str(val).strip())
PY
}

ACTION="$(read_cfg action)"
[[ "$ACTION" == "apply" || "$ACTION" == "disable" ]] || { ops_progress_init "tls" 3; ops_progress_fail "unknown or missing action in tls.json"; echo "ERROR: action must be apply|disable (got '${ACTION}')" >&2; exit 1; }

if [[ "$ACTION" == "disable" ]]; then
  ops_progress_init "tls" 2
  ops_progress_step 1 "disabling the local HTTPS terminator"
  echo "==> local HTTPS: disabling (back to plain HTTP)"
  bash "$HTTPS_SH" --disable --yes
  trap 'cleanup_side_files' EXIT
  ops_progress_done "local HTTPS disabled"
  exit 0
fi

# action=apply
ops_progress_init "tls" 3
LOCAL_NAMES="$(read_cfg localNames)"
DOMAINS="$(read_cfg domains)"
DNS_PROVIDER="$(read_cfg dnsProvider)"

ARGS=(--mode local --yes)
[[ -n "$LOCAL_NAMES"  ]] && ARGS+=(--local-names "$LOCAL_NAMES")
[[ -n "$DOMAINS"      ]] && ARGS+=(--domains "$DOMAINS")
[[ -n "$DNS_PROVIDER" ]] && ARGS+=(--dns-provider "$DNS_PROVIDER")

ops_progress_step 1 "applying local HTTPS profile"
echo "==> local HTTPS: applying (names: ${LOCAL_NAMES:-none}${DOMAINS:+, domain: ${DOMAINS}})"

# The DNS token (if the wizard pasted one) is passed via the ENV (never argv → never in `ps`), then
# shredded. orwell-https.sh reads ORWELL_TLS_DNS_API_TOKEN from the environment.
if [[ -f "$TOKEN_FILE" ]]; then
  ops_progress_step 2 "configuring the publicly-trusted (DNS-01) upgrade"
  ORWELL_TLS_DNS_API_TOKEN="$(cat "$TOKEN_FILE")" bash "$HTTPS_SH" "${ARGS[@]}"
  shred_token
  echo "==> DNS API token consumed and shredded"
else
  ops_progress_step 2 "local names only (no DNS token supplied)"
  bash "$HTTPS_SH" "${ARGS[@]}"
fi

trap 'cleanup_side_files' EXIT
ops_progress_done "local HTTPS applied — front-end restarting"
echo "==> local HTTPS applied."
