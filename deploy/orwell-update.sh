#!/usr/bin/env bash
#
# orwell — update. Run inside the container, or via the host one-liner.
# Pulls, rebuilds the engine, refreshes front-end deps, and restarts the services.
# It NEVER touches ${APP_DIR}/data, so the save (state + souls) is preserved (ties to #7).
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/orwell}"
BRANCH="${BRANCH:-main}"

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
