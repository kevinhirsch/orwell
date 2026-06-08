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
  # Forward only an explicit APP_DIR override; let auto-detect run inside the container otherwise.
  pct exec "$CTID" -- bash -c "export ${APP_DIR_EXPLICIT:+APP_DIR='${APP_DIR_EXPLICIT}' }BRANCH='${BRANCH}'; bash /tmp/orwell-update.sh"
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

echo "==> restart services (${ENGINE_SVC}, ${FRONTEND_SVC})"
systemctl restart "$ENGINE_SVC" "$FRONTEND_SVC"
echo "==> update complete."
