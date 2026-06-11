#!/usr/bin/env bash
#
# orwell — update. Pulls, rebuilds the engine, refreshes front-end deps, and restarts services.
# It NEVER touches <app>/data, so the save (state + souls) is preserved (ties to #7).
#
# Run it EITHER on the Proxmox host (it locates the orwell LXC and updates INSIDE it) OR directly
# inside the container. On the host it mirrors deploy/orwell.sh's pct bridge; the app and its git
# checkout live in the LXC, never on the host (where there is no git / no app dir).
#
# Legacy-aware: a container provisioned BEFORE the bbai -> orwell rename (app in /opt/bbai with
# bbai-* services) is updated in place — the engine and front-end still honor the deprecated BBAI_*
# env, so its existing data/.env keeps working untouched.
set -euo pipefail

APP_DIR_EXPLICIT="${APP_DIR:-}"     # honor an explicit override; otherwise auto-detect below
BRANCH="${BRANCH:-main}"
# B71/ops A4 — pin + rollback:
#   REF=<sha|tag>          update to a PINNED ref instead of the branch tip
#   orwell-update.sh --rollback   return to the previous build (SHA + dist) recorded by the last update
# A4/ruling #17 — private-repo token (one-time setup / annual rotation for an EXISTING install):
#   orwell-update.sh --set-token  prompt for (or take GIT_TOKEN=) the deploy PAT, persist it into
#                                 data/.env, and wire the git credential helper — then exit.
REF="${REF:-}"
ROLLBACK=0; SET_TOKEN=0
[[ "${1:-}" == "--rollback" ]] && ROLLBACK=1
[[ "${1:-}" == "--set-token" ]] && SET_TOKEN=1
CT_HOSTNAME_SET="${CT_HOSTNAME:+1}"   # explicit override disables the legacy-name fallback
CT_HOSTNAME="${CT_HOSTNAME:-orwell}"

# First install dir found here: an explicit override, then the current path, then the legacy one.
find_app() {
  local d
  for d in "${APP_DIR_EXPLICIT:-}" /opt/orwell /opt/bbai; do
    [[ -n "$d" && -d "$d/.git" ]] && { printf '%s' "$d"; return 0; }
  done
  return 1
}

# ── Host → container bridge ────────────────────────────────────────────────────────────────────
# On a Proxmox host (pct present) the app lives inside the LXC, not here — so locate the orwell
# container and re-run this update inside it, exactly as deploy/orwell.sh runs the installer.
# Inside the container pct does not exist (and the app dir does), so this block is skipped and the
# update runs directly. Override the target with CTID=<id> or CT_HOSTNAME=<name>.
if command -v pct >/dev/null 2>&1 && ! find_app >/dev/null 2>&1; then
  CTID="${CTID:-$(pct list 2>/dev/null | awk -v n="$CT_HOSTNAME" 'NR>1 && $NF==n {print $1}' || true)}"
  # Legacy-aware: a pre-rename box may still run an LXC literally named "bbai".
  [[ -n "$CTID" || -n "$CT_HOSTNAME_SET" ]] || CTID="$(pct list 2>/dev/null | awk 'NR>1 && $NF=="bbai" {print $1}' || true)"
  [[ -n "$CTID" ]] || { echo "ERROR: no orwell LXC found (hostname '${CT_HOSTNAME}' or legacy 'bbai'). Set CTID=<id> and retry." >&2; exit 1; }
  [[ "$(printf '%s' "$CTID" | wc -w)" -eq 1 ]] || { echo "ERROR: multiple containers named '${CT_HOSTNAME}' (${CTID//$'\n'/ }). Set CTID=<id>." >&2; exit 1; }
  [[ "$(pct status "$CTID" 2>/dev/null)" == *running* ]] || { echo "ERROR: LXC ${CTID} is not running — start it first: pct start ${CTID}" >&2; exit 1; }

  echo "==> orwell lives in LXC ${CTID}; updating inside the container"
  # --set-token: capture the token on the host (prompt if interactive), then forward it via a
  # pushed root-only file — never on a pct exec command line (host ps) and never in a URL.
  if [[ $SET_TOKEN -eq 1 ]]; then
    if [[ -z "${GIT_TOKEN:-}" && -t 0 ]]; then
      read -rs -p "Deploy token (fine-grained PAT, Contents: Read-only on the repo): " GIT_TOKEN; echo
    fi
    [[ -n "${GIT_TOKEN:-}" ]] || { echo "ERROR: --set-token needs GIT_TOKEN=<pat> (or a TTY to prompt)." >&2; exit 1; }
    TMP_TOKEN="$(mktemp /tmp/orwell-token-XXXXXX)"
    chmod 600 "$TMP_TOKEN"
    printf 'GIT_TOKEN=%s\n' "$GIT_TOKEN" > "$TMP_TOKEN"
    pct push "$CTID" "$TMP_TOKEN" /tmp/orwell-token --perms 0600
    rm -f "$TMP_TOKEN"
  fi
  # LOCAL-COPY bridge (A4/ruling #17 — closes audit E84): never curl a branch tip from GitHub.
  # Run from a file → push THAT file; run via `bash -c "$(...)"` → push the running text
  # (BASH_EXECUTION_STRING); otherwise run the container's own checked-out copy (its first act
  # is `git pull`, so the staleness window is one update cycle — the E84 integrity shape).
  FWD_FLAG=""; [[ $ROLLBACK -eq 1 ]] && FWD_FLAG="--rollback"; [[ $SET_TOKEN -eq 1 ]] && FWD_FLAG="--set-token"
  FWD_ENV="export ${APP_DIR_EXPLICIT:+APP_DIR='${APP_DIR_EXPLICIT}' }BRANCH='${BRANCH}' REF='${REF}';"
  if [[ -n "${BASH_SOURCE[0]:-}" && -r "${BASH_SOURCE[0]:-}" ]]; then
    TMP_UPDATE="$(mktemp /tmp/orwell-update-XXXXXX.sh)"
    cp "${BASH_SOURCE[0]}" "$TMP_UPDATE"
    pct push "$CTID" "$TMP_UPDATE" /tmp/orwell-update.sh
    rm -f "$TMP_UPDATE"
    pct exec "$CTID" -- bash -c "${FWD_ENV} bash /tmp/orwell-update.sh ${FWD_FLAG}"
  elif [[ -n "${BASH_EXECUTION_STRING:-}" ]]; then
    TMP_UPDATE="$(mktemp /tmp/orwell-update-XXXXXX.sh)"
    printf '%s\n' "$BASH_EXECUTION_STRING" > "$TMP_UPDATE"
    pct push "$CTID" "$TMP_UPDATE" /tmp/orwell-update.sh
    rm -f "$TMP_UPDATE"
    pct exec "$CTID" -- bash -c "${FWD_ENV} bash /tmp/orwell-update.sh ${FWD_FLAG}"
  else
    pct exec "$CTID" -- bash -c "${FWD_ENV} for d in \"\${APP_DIR:-}\" /opt/orwell /opt/bbai; do
        [ -n \"\$d\" ] && [ -f \"\$d/deploy/orwell-update.sh\" ] && exec bash \"\$d/deploy/orwell-update.sh\" ${FWD_FLAG}
      done; echo 'ERROR: no in-container deploy/orwell-update.sh found' >&2; exit 1"
  fi
  exit 0
fi

# ── In-container (or direct) update ────────────────────────────────────────────────────────────
APP_DIR="$(find_app || true)"; APP_DIR="${APP_DIR:-/opt/orwell}"

# Service names follow the install: prefer orwell-*, fall back to the legacy bbai-* units when
# that's what is registered (a container provisioned before the rename).
unit_exists() { systemctl list-unit-files "$1" 2>/dev/null | grep -q "$1"; }
if unit_exists orwell-engine.service; then
  ENGINE_SVC="orwell-engine"; FRONTEND_SVC="orwell-frontend"
elif unit_exists bbai-engine.service; then
  ENGINE_SVC="bbai-engine"; FRONTEND_SVC="bbai-frontend"
else
  ENGINE_SVC="orwell-engine"; FRONTEND_SVC="orwell-frontend"
fi

PREV_FILE="${APP_DIR}/data/.update-prev"      # the last good SHA (data/ survives updates)
PREV_DIST="${APP_DIR}/dist.prev"              # the last good build output
ENV_FILE="${APP_DIR}/data/.env"

# Wire git to read GIT_TOKEN from data/.env at use time (A4/ruling #17). Idempotent; also the
# self-heal for installs that predate the private flip: once the token line exists, every
# `git fetch/pull` in this script just works — no re-prompt, no token in any URL/.git/config.
wire_credential_helper() {
  grep -qs '^GIT_TOKEN=' "$ENV_FILE" || return 0
  git config --system credential.helper \
    '!f(){ echo username=x-access-token; echo "password=$(sed -n s/^GIT_TOKEN=//p '"${APP_DIR}"'/data/.env)"; };f'
}

# F4 self-heal (hit on a real box, 2026-06-11): the installer chowns the checkout to the
# `orwell` user while this script runs git as ROOT — git >=2.35 refuses every fetch/reset with
# "dubious ownership" unless the path is marked safe. The fixed installer wires this at install
# time; the updater wires it too, BEFORE its first git call, so every box installed before the
# fix heals on its next update. (A box already wedged needs the one manual bootstrap —
# `git config --system --add safe.directory <APP_DIR>` — to fetch THIS version; never again
# after that.) Idempotent: added once.
wire_safe_directory() {
  git config --system --get-all safe.directory 2>/dev/null | grep -qx "$APP_DIR" \
    || git config --system --add safe.directory "$APP_DIR"
}
wire_safe_directory

# ── --set-token (A4): persist/rotate the deploy PAT, wire the helper, exit. ───────────────────
if [[ "$SET_TOKEN" -eq 1 ]]; then
  TOKEN="${GIT_TOKEN:-}"
  if [[ -z "$TOKEN" && -r /tmp/orwell-token ]]; then
    TOKEN="$(sed -n 's/^GIT_TOKEN=//p' /tmp/orwell-token | tail -1)"
    rm -f /tmp/orwell-token
  fi
  if [[ -z "$TOKEN" && -t 0 ]]; then
    read -rs -p "Deploy token (fine-grained PAT, Contents: Read-only on the repo): " TOKEN; echo
  fi
  [[ -n "$TOKEN" ]] || { echo "ERROR: --set-token needs GIT_TOKEN=<pat> (or a TTY to prompt)." >&2; exit 1; }
  mkdir -p "${APP_DIR}/data"
  touch "$ENV_FILE"; chmod 600 "$ENV_FILE"
  # Rotate in place: drop any previous GIT_TOKEN line, then append the new one.
  TMP_ENV="$(mktemp "${APP_DIR}/data/.env.XXXXXX")"
  grep -v '^GIT_TOKEN=' "$ENV_FILE" > "$TMP_ENV" || true
  printf 'GIT_TOKEN=%s\n' "$TOKEN" >> "$TMP_ENV"
  chmod 600 "$TMP_ENV"
  mv "$TMP_ENV" "$ENV_FILE"
  wire_credential_helper
  echo "==> deploy token saved to ${ENV_FILE} and git credential helper wired."
  echo "    Rotation: re-run 'orwell-update.sh --set-token' (fine-grained PATs cap at one year)."
  exit 0
fi

wire_credential_helper

# ── Rollback (B71/ops A4): return to the recorded previous SHA + its dist, then restart. ──────
if [[ "$ROLLBACK" -eq 1 ]]; then
  [[ -f "$PREV_FILE" ]] || { echo "ERROR: no previous update recorded (${PREV_FILE} missing) — nothing to roll back to." >&2; exit 1; }
  PREV_SHA="$(cat "$PREV_FILE")"
  echo "==> rolling back to ${PREV_SHA}"
  git -C "$APP_DIR" reset --hard "$PREV_SHA"
  if [[ -d "$PREV_DIST" ]]; then
    rm -rf "${APP_DIR}/dist"
    cp -a "$PREV_DIST" "${APP_DIR}/dist"
  else
    ( cd "$APP_DIR" && npm ci && npm run build )
  fi
  systemctl restart "$ENGINE_SVC" "$FRONTEND_SVC"
  echo "==> rollback complete (now on ${PREV_SHA})."
  exit 0
fi

echo "==> updating orwell in ${APP_DIR} (save in ${APP_DIR}/data is preserved)"
PREV_SHA="$(git -C "$APP_DIR" rev-parse HEAD)"
# Keep the running build so a failed update (or a later --rollback) can restore it untouched.
if [[ -d "${APP_DIR}/dist" ]]; then
  rm -rf "$PREV_DIST"
  cp -a "${APP_DIR}/dist" "$PREV_DIST"
fi

# Fetch + check out the TARGET (a pinned REF wins over the branch tip).
if [[ -n "$REF" ]]; then
  git -C "$APP_DIR" fetch origin "$REF" || git -C "$APP_DIR" fetch --tags origin
  TARGET="$REF"
else
  git -C "$APP_DIR" fetch --depth 1 origin "$BRANCH"
  TARGET="origin/${BRANCH}"
fi
git -C "$APP_DIR" reset --hard "$TARGET"

# Build BEFORE committing to the swap (B71/ops A4): a failed build must leave the services on the
# PREVIOUS checkout + build — never a new tree with a stale dist, never a restart into a broken build.
echo "==> rebuild engine (the update commits only if this succeeds)"
cd "$APP_DIR"
if ! (npm ci && npm run build); then
  echo "ERROR: build FAILED on ${TARGET} — reverting to ${PREV_SHA}; services were NOT restarted." >&2
  git -C "$APP_DIR" reset --hard "$PREV_SHA"
  if [[ -d "$PREV_DIST" ]]; then rm -rf "${APP_DIR}/dist"; cp -a "$PREV_DIST" "${APP_DIR}/dist"; fi
  echo "Hint: retry with REF=<known-good sha|tag>, or run 'orwell-update.sh --rollback' later." >&2
  exit 1
fi

# Refresh the pinned embedding model cache (ADR 0004 / E86a) — a no-op when already cached;
# non-fatal on failure (the engine falls back to deterministic recall and retries at boot).
echo "==> embedding model prefetch (no-op when cached)"
node "${APP_DIR}/dist/embedWorker.js" --prefetch --cache-dir "${APP_DIR}/data/models" \
  || echo "WARN: embedding model prefetch failed — engine will retry at boot"

echo "==> refresh front-end deps"
cd "${APP_DIR}/frontend"
# Pinned lockfile first (audit E83): updates re-install exactly what CI tested, never a blind
# re-resolution of unpinned ranges.
if [[ -f requirements.lock.txt ]]; then
  ./.venv/bin/pip install -q -r requirements.lock.txt
else
  ./.venv/bin/pip install -q -r requirements.txt
fi

# Record the rollback point only once the new build is in place.
mkdir -p "${APP_DIR}/data"
printf '%s' "$PREV_SHA" > "$PREV_FILE"


# Login health panel (ruling #21, 2026-06-11): greet interactive container shells with live
# health instead of a bare prompt. Time-bounded probes; guarded; can never block a login.
install -m 0755 "${APP_DIR}/deploy/orwell-login-panel.sh" /usr/local/bin/orwell-panel
if ! grep -qs 'orwell-panel' /etc/bash.bashrc; then
  cat >> /etc/bash.bashrc <<'PANEL'

# orwell login health panel (interactive shells only; guarded; never blocks)
case $- in *i*) [ -z "${ORWELL_PANEL_SHOWN:-}" ] && export ORWELL_PANEL_SHOWN=1 && /usr/local/bin/orwell-panel 2>/dev/null || true ;; esac
PANEL
fi

# Privileged UI port (<1024): reconcile the CAP_NET_BIND_SERVICE drop-in against the CURRENT
# ORWELL_PORT in data/.env (mirrors orwell-install.sh — the install may predate this fix, or the
# operator may have changed the port since). The hardened unit (E85) drops all capabilities, so
# without this a non-root uvicorn can never bind a port below 1024 and the FE crash-loops.
UI_PORT="$(sed -n 's/^ORWELL_PORT=//p' "$ENV_FILE" 2>/dev/null | tail -n1)"
UI_PORT="${UI_PORT:-8080}"
FRONTEND_DROPIN="/etc/systemd/system/${FRONTEND_SVC}.service.d/10-privileged-port.conf"
if [[ "$UI_PORT" =~ ^[0-9]+$ ]] && (( UI_PORT < 1024 )); then
  echo "==> ORWELL_PORT=${UI_PORT} is privileged (<1024): ensuring CAP_NET_BIND_SERVICE (drop-in)"
  mkdir -p "${FRONTEND_DROPIN%/*}"
  cat > "$FRONTEND_DROPIN" <<EOF
# Written by orwell-update.sh: ORWELL_PORT=${UI_PORT} is a privileged port (<1024).
# The base unit's empty CapabilityBoundingSet= is the audited default (E85); this grants the
# single capability a non-root bind below 1024 requires. Removed when the port moves >=1024.
[Service]
AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE
EOF
else
  rm -f "$FRONTEND_DROPIN"
fi
systemctl daemon-reload

echo "==> restart services (${ENGINE_SVC}, ${FRONTEND_SVC})"
systemctl restart "$ENGINE_SVC" "$FRONTEND_SVC"
echo "==> update complete ($(git -C "$APP_DIR" rev-parse --short HEAD)); previous build kept for --rollback."
