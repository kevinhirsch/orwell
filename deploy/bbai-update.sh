#!/usr/bin/env bash
#
# bbai — update (DRAFT scaffold). Run inside the container, or via the host one-liner.
# Pulls, rebuilds the engine, refreshes front-end deps, and restarts the services.
# It NEVER touches ${APP_DIR}/data, so the save (state + souls) is preserved (ties to #7).
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/bbai}"
BRANCH="${BRANCH:-main}"

echo "==> updating bbai in ${APP_DIR} (save in ${APP_DIR}/data is preserved)"
git -C "$APP_DIR" fetch --depth 1 origin "$BRANCH"
git -C "$APP_DIR" reset --hard "origin/${BRANCH}"

echo "==> rebuild engine"
cd "$APP_DIR"
npm ci
# TODO(0009): npm run build

echo "==> refresh front-end deps"
cd "${APP_DIR}/frontend"
./.venv/bin/pip install -q -r requirements.txt

echo "==> restart services"
if systemctl restart bbai-engine bbai-frontend 2>/dev/null; then
  echo "==> update complete."
else
  echo "NOTE: restart skipped — services not yet defined/running (app run commands TODO)."
fi
