#!/usr/bin/env bash
#
# orwell — update. Pulls, rebuilds the engine, refreshes front-end deps, and restarts services.
# It NEVER touches ${APP_DIR}/data, so the save (state + souls) is preserved (ties to #7).
#
# Run it EITHER on the Proxmox host (it locates the orwell LXC and updates INSIDE it) OR directly
# inside the container. On the host it mirrors deploy/orwell.sh's pct bridge; the app and its git
# checkout live in the LXC, never on the host (where there is no git / no ${APP_DIR}).
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/orwell}"
BRANCH="${BRANCH:-main}"
CT_HOSTNAME="${CT_HOSTNAME:-orwell}"

# ── Host → container bridge ────────────────────────────────────────────────────────────────────
# On a Proxmox host (pct present) the app lives inside the LXC, not here — so locate the orwell
# container and re-run this update inside it, exactly as deploy/orwell.sh runs the installer.
# Inside the container pct does not exist (and ${APP_DIR}/.git does), so this block is skipped and
# the update runs directly. Override the target with CTID=<id> or CT_HOSTNAME=<name>.
if command -v pct >/dev/null 2>&1 && [[ ! -d "${APP_DIR}/.git" ]]; then
  CTID="${CTID:-$(pct list 2>/dev/null | awk -v n="$CT_HOSTNAME" 'NR>1 && $NF==n {print $1}' || true)}"
  [[ -n "$CTID" ]] || { echo "ERROR: no orwell LXC found (hostname '${CT_HOSTNAME}'). Set CTID=<id> and retry." >&2; exit 1; }
  [[ "$(printf '%s' "$CTID" | wc -w)" -eq 1 ]] || { echo "ERROR: multiple containers named '${CT_HOSTNAME}' (${CTID//$'\n'/ }). Set CTID=<id>." >&2; exit 1; }
  [[ "$(pct status "$CTID" 2>/dev/null)" == *running* ]] || { echo "ERROR: LXC ${CTID} is not running — start it first: pct start ${CTID}" >&2; exit 1; }

  echo "==> orwell lives in LXC ${CTID}; updating inside the container"
  # The container already has curl; fetch on the host (always has curl) and push the script in, so
  # we always run the latest update logic regardless of the container's currently-installed copy.
  TMP_UPDATE="$(mktemp /tmp/orwell-update-XXXXXX.sh)"
  curl -fsSL "https://raw.githubusercontent.com/kevinhirsch/orwell/${BRANCH}/deploy/orwell-update.sh" -o "$TMP_UPDATE"
  pct push "$CTID" "$TMP_UPDATE" /tmp/orwell-update.sh
  rm -f "$TMP_UPDATE"
  pct exec "$CTID" -- bash -c "export APP_DIR='${APP_DIR}' BRANCH='${BRANCH}'; bash /tmp/orwell-update.sh"
  exit 0
fi

echo "==> updating orwell in ${APP_DIR} (save in ${APP_DIR}/data is preserved)"
git -C "$APP_DIR" fetch --depth 1 origin "$BRANCH"
git -C "$APP_DIR" reset --hard "origin/${BRANCH}"

echo "==> rebuild engine"
cd "$APP_DIR"
npm ci
npm run build

echo "==> refresh front-end deps"
cd "${APP_DIR}/frontend"
./.venv/bin/pip install -q -r requirements.txt

echo "==> restart services"
systemctl restart orwell-engine orwell-frontend
echo "==> update complete."
