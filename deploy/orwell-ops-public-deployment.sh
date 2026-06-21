#!/usr/bin/env bash
#
# orwell — ops runner: "Connect to the internet" / public deployment (feature 0068, ADR 0007).
#
# Started by orwell-ops-public-deployment.service when the admin "Connect to the internet" wizard
# drops the existence-only flag data/ops/public-deployment-requested. This is the privileged box
# side of the UI-driven public-exposure flow (0067 is the hardening floor it applies). The route
# layer has ALREADY validated the proposed env at request time (assert_public_profile_safe — fail
# closed); this script only APPLIES what the wizard wrote, idempotently.
#
# DELIBERATELY ROOT (the unit's own comments carry the WHY): it must edit data/.env, apt-install +
# `cloudflared service install`, enable a systemd service, and restart the FE — every one of which
# the E85-hardened web tier (User=orwell, empty capability set) structurally cannot do. Containment
# is by DESIGN: only this one fixed script path ever runs; the flag is existence-only (its content
# is never read), and the side inputs the web tier writes are config DATA, never interpolated into
# any command.
#
# Side inputs the route layer wrote under data/ops/ (the contract; names are load-bearing):
#   public-deployment-requested   existence-only flag (removed by the unit's ExecStartPre)
#   public-deployment.json        {action:"apply"|"disconnect", env:{…}, domains:[…], hasToken, ts}
#   cloudflared-token             0600; the raw connector token — CONSUMED + SHREDDED here, never logged
# Outputs:
#   public-deployment-status.json live progress (via orwell-ops-progress.sh) the admin page reads
#   ops-public-deployment.log     the appended run log the status page tails (StandardOutput=append)
#
# THE TOKEN IS A SECRET: it is never echoed to stdout/stderr (this whole script's output is the
# public run log), never written anywhere but its 0600 file, and is SHREDDED the moment cloudflared
# has consumed it. Re-runnable / idempotent: a second run upserts the same keys and no-ops the rest.
set -Eeuo pipefail

# First install dir found: an explicit override, then the current path, then the legacy one. The
# units hard-code /opt/orwell, but honor APP_DIR for a dev checkout / test.
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
ENV_FILE="${DATA_DIR%/}/.env"
CONFIG_FILE="${OPS_DIR}/public-deployment.json"
TOKEN_FILE="${OPS_DIR}/cloudflared-token"
FLAG_FILE="${OPS_DIR}/public-deployment-requested"

# ── ops-progress lane: step-by-step progress to data/ops/public-deployment-status.json ───────────
# The admin "Public deployment" card reads this back as a live timeline. Best-effort; a missing
# helper ⇒ no-op stubs that never abort the run.
__here="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd || true)"
for __pf in "${__here}/orwell-ops-progress.sh" /opt/orwell/deploy/orwell-ops-progress.sh /opt/bbai/deploy/orwell-ops-progress.sh; do
  if [[ -n "${__pf:-}" && -r "$__pf" ]]; then . "$__pf"; break; fi
done
type ops_progress_init >/dev/null 2>&1 || { ops_progress_init() { :; }; ops_progress_step() { :; }; ops_progress_done() { :; }; ops_progress_fail() { :; }; }
export ORWELL_OPS_DIR="${OPS_DIR}"

# Always leave a terminal record + clean up the side files, however we exit. The trap stamps a
# FAILURE if any command tripped pipefail; the success path clears it before ops_progress_done.
cleanup_side_files() { rm -f "$CONFIG_FILE" "$TOKEN_FILE" "$FLAG_FILE" 2>/dev/null || true; }
trap 'rc=$?; if [[ "$rc" -ne 0 ]]; then ops_progress_fail "public-deployment exited with code $rc — see ops-public-deployment.log"; fi; cleanup_side_files' EXIT

# Service names follow the install: prefer orwell-*, fall back to the legacy bbai-* units.
unit_exists() { systemctl list-unit-files "$1" 2>/dev/null | grep -q "$1"; }
if unit_exists orwell-frontend.service; then
  FRONTEND_SVC="orwell-frontend"
elif unit_exists bbai-frontend.service; then
  FRONTEND_SVC="bbai-frontend"
else
  FRONTEND_SVC="orwell-frontend"
fi

# ── Read the side config (tolerant parse) ────────────────────────────────────────────────────────
# python3 is always present on a real install (the FE is Python). Pull the action + every env key
# the route layer proposed. NEVER the token (that lives only in its 0600 file). A missing/garbage
# config is a hard fail — we will not guess what the admin asked for.
[[ -r "$CONFIG_FILE" ]] || { ops_progress_init "public-deployment" 4; ops_progress_fail "no public-deployment.json side config found"; echo "ERROR: ${CONFIG_FILE} missing" >&2; exit 1; }

ACTION="$(python3 - "$CONFIG_FILE" <<'PY' 2>/dev/null || true
import json, sys
try:
    with open(sys.argv[1], encoding="utf-8") as fh:
        cfg = json.load(fh)
    print(str(cfg.get("action", "")).strip())
except Exception:
    print("")
PY
)"
[[ "$ACTION" == "apply" || "$ACTION" == "disconnect" ]] || { ops_progress_init "public-deployment" 4; ops_progress_fail "unknown or missing action in public-deployment.json"; echo "ERROR: action must be apply|disconnect (got '${ACTION}')" >&2; exit 1; }

# Emit the env map as KEY=VALUE lines (only for action=apply). Values are config data; quoting on
# the .env write below keeps any spaces/special chars literal.
read_env_pairs() {
  python3 - "$CONFIG_FILE" <<'PY' 2>/dev/null || true
import json, sys
try:
    with open(sys.argv[1], encoding="utf-8") as fh:
        cfg = json.load(fh)
    env = cfg.get("env") or {}
    if isinstance(env, dict):
        for k, v in env.items():
            k = str(k).strip()
            if k and k.replace("_", "").isalnum():
                print(f"{k}={v}")
except Exception:
    pass
PY
}

# ── .env upsert (idempotent; mirrors orwell-update.sh's --set-token rotate-in-place) ─────────────
# Replace an existing `KEY=` line in place, else append. data/.env stays mode 600. A tmp + mv keeps
# the file intact if something trips mid-write; every OTHER line is preserved untouched.
upsert_env() {
  local key="$1" value="$2"
  mkdir -p "$DATA_DIR"
  touch "$ENV_FILE"; chmod 600 "$ENV_FILE"
  local tmp; tmp="$(mktemp "${DATA_DIR}/.env.XXXXXX")"
  grep -v "^${key}=" "$ENV_FILE" > "$tmp" 2>/dev/null || true
  printf '%s=%s\n' "$key" "$value" >> "$tmp"
  chmod 600 "$tmp"
  mv -f "$tmp" "$ENV_FILE"
}

# Remove a key entirely from data/.env (used by disconnect; also tmp + mv, mode preserved).
remove_env_key() {
  local key="$1"
  [[ -f "$ENV_FILE" ]] || return 0
  local tmp; tmp="$(mktemp "${DATA_DIR}/.env.XXXXXX")"
  grep -v "^${key}=" "$ENV_FILE" > "$tmp" 2>/dev/null || true
  chmod 600 "$tmp"
  mv -f "$tmp" "$ENV_FILE"
}

# ── cloudflared install (idempotent) — apt via the Cloudflare repo, .deb fallback ────────────────
# Already present ⇒ no-op. apt path first (the Cloudflare pkg repo); if the repo can't be reached we
# fall back to the published .deb for the host arch. NEVER touches the token.
install_cloudflared() {
  command -v cloudflared >/dev/null 2>&1 && { echo "==> cloudflared already installed"; return 0; }
  echo "==> installing cloudflared"
  export DEBIAN_FRONTEND=noninteractive
  local keyring="/usr/share/keyrings/cloudflare-main.gpg"
  local listfile="/etc/apt/sources.list.d/cloudflared.list"
  if mkdir -p --mode=0755 /usr/share/keyrings 2>/dev/null \
     && curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg 2>/dev/null | tee "$keyring" >/dev/null \
     && echo "deb [signed-by=${keyring}] https://pkg.cloudflare.com/cloudflared any main" > "$listfile" \
     && apt-get update -y >/dev/null 2>&1 \
     && apt-get install -y cloudflared >/dev/null 2>&1; then
    echo "==> cloudflared installed from the Cloudflare apt repo"
    return 0
  fi
  echo "WARN: apt repo path unavailable — falling back to the .deb release"
  local arch deb
  arch="$(dpkg --print-architecture 2>/dev/null || echo amd64)"
  deb="$(mktemp /tmp/cloudflared-XXXXXX.deb)"
  if curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${arch}.deb" -o "$deb" \
     && apt-get install -y "$deb" >/dev/null 2>&1; then
    rm -f "$deb"
    echo "==> cloudflared installed from the .deb release"
    return 0
  fi
  rm -f "$deb"
  echo "ERROR: could not install cloudflared (apt repo and .deb both failed)" >&2
  return 1
}

# Shred the connector token the moment it has been consumed. shred -u where available; otherwise
# overwrite-then-remove. Called from a trap-safe spot AND idempotent (no-op if already gone).
shred_token() {
  [[ -e "$TOKEN_FILE" ]] || return 0
  if command -v shred >/dev/null 2>&1; then
    shred -u "$TOKEN_FILE" 2>/dev/null || { dd if=/dev/zero of="$TOKEN_FILE" bs=1024 count=1 conv=notrunc 2>/dev/null || true; rm -f "$TOKEN_FILE"; }
  else
    dd if=/dev/zero of="$TOKEN_FILE" bs=1024 count=1 conv=notrunc 2>/dev/null || true
    rm -f "$TOKEN_FILE"
  fi
}

# ── apply ────────────────────────────────────────────────────────────────────────────────────────
do_apply() {
  ops_progress_init "public-deployment" 4
  echo "==> public deployment: applying the public profile"

  ops_progress_step 1 "writing public-profile env"
  # Upsert each proposed key (ORWELL_PUBLIC, ALLOWED_HOSTS, ALLOWED_ORIGINS, SECURE_COOKIES).
  local pairs; pairs="$(read_env_pairs)"
  if [[ -n "$pairs" ]]; then
    while IFS= read -r line; do
      [[ -z "$line" ]] && continue
      local k="${line%%=*}" v="${line#*=}"
      upsert_env "$k" "$v"
    done <<< "$pairs"
  fi
  # The 0067 floor is non-negotiable on the public profile: force auth ON and the localhost bypass
  # OFF regardless of what the config carried — a public box must never run open or with the dev
  # bypass live. Idempotent upserts.
  upsert_env "AUTH_ENABLED" "true"
  upsert_env "LOCALHOST_BYPASS" "false"

  # The connector token (if the wizard pasted one): install + run cloudflared, then SHRED it.
  if [[ -f "$TOKEN_FILE" ]]; then
    ops_progress_step 2 "installing the tunnel connector"
    install_cloudflared
    echo "==> registering the cloudflared connector service"
    # The token is read from its 0600 file straight into the install argv — never echoed. The
    # command's own stdout can include the token on some versions, so it is silenced.
    if cloudflared service install "$(cat "$TOKEN_FILE")" >/dev/null 2>&1; then
      echo "==> cloudflared service installed"
    else
      echo "WARN: 'cloudflared service install' returned non-zero (it may already be installed)"
    fi
    shred_token
    echo "==> connector token consumed and shredded"
    systemctl enable --now cloudflared >/dev/null 2>&1 || echo "WARN: could not enable --now cloudflared"
  else
    ops_progress_step 2 "no connector token supplied — env applied only"
    echo "==> no connector token present; applied the public env without (re)installing the tunnel"
  fi

  ops_progress_step 3 "restarting the front-end to apply"
  echo "==> restart ${FRONTEND_SVC} (the new env is boot-read)"
  systemctl restart "$FRONTEND_SVC"

  trap 'cleanup_side_files' EXIT
  ops_progress_done "public deployment applied — front-end restarting"
  echo "==> public deployment applied."
}

# ── disconnect ───────────────────────────────────────────────────────────────────────────────────
do_disconnect() {
  ops_progress_init "public-deployment" 3
  echo "==> public deployment: disconnecting (back to LAN-only)"

  ops_progress_step 1 "disabling public mode in .env"
  # Flip ORWELL_PUBLIC off by removing the line (absent ⇒ the non-public default).
  remove_env_key "ORWELL_PUBLIC"

  ops_progress_step 2 "stopping the tunnel connector"
  # Stop + disable the connector but LEAVE it installed (a later reconnect needs no reinstall).
  systemctl disable --now cloudflared >/dev/null 2>&1 || echo "==> cloudflared not active (nothing to stop)"

  ops_progress_step 3 "restarting the front-end to apply"
  echo "==> restart ${FRONTEND_SVC}"
  systemctl restart "$FRONTEND_SVC"

  trap 'cleanup_side_files' EXIT
  ops_progress_done "disconnected — LAN-only restored"
  echo "==> disconnected."
}

case "$ACTION" in
  apply)      do_apply ;;
  disconnect) do_disconnect ;;
esac
