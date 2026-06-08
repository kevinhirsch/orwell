#!/usr/bin/env bash
#
# bbai — in-container install (DRAFT scaffold). Runs inside the LXC created by deploy/bbai.sh.
# Installs deps, clones, builds the engine, sets up the front-end, writes config, and registers
# systemd services. App build/run specifics are TODO until feature 0009 + front-end wiring land.
set -euo pipefail

REPO="${REPO:-https://github.com/kevinhirsch/bbai.git}"
BRANCH="${BRANCH:-main}"
APP_DIR="${APP_DIR:-/opt/bbai}"
DATA_DIR="${DATA_DIR:-/opt/bbai/data}"
BBAI_PORT="${BBAI_PORT:-8080}"

echo "==> apt deps"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl git build-essential ca-certificates python3 python3-venv python3-pip

echo "==> Node 22"
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v | cut -d. -f1 | tr -d v)" -lt 22 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -qq nodejs
fi

echo "==> clone bbai -> ${APP_DIR}"
if [[ -d "${APP_DIR}/.git" ]]; then
  git -C "$APP_DIR" fetch --depth 1 origin "$BRANCH"
  git -C "$APP_DIR" reset --hard "origin/${BRANCH}"
else
  git clone --depth 1 -b "$BRANCH" "$REPO" "$APP_DIR"
fi
mkdir -p "$DATA_DIR"

echo "==> build engine"
cd "$APP_DIR"
npm ci
# TODO(0009): the engine needs `npm run build` + a `bbai-engine` start entrypoint (the MCP server).
#   Today it runs via tsx with no build/start script. Uncomment once 0009 lands:
# npm run build

echo "==> front-end (odysseus) deps"
cd "${APP_DIR}/frontend"
python3 -m venv .venv
./.venv/bin/pip install -q --upgrade pip
./.venv/bin/pip install -q -r requirements.txt

echo "==> config"
if [[ ! -f "${DATA_DIR}/.env" ]]; then
  cp "${APP_DIR}/frontend/.env.example" "${DATA_DIR}/.env" 2>/dev/null || touch "${DATA_DIR}/.env"
  {
    echo ""
    echo "# --- bbai (set these) ---"
    echo "BBAI_PORT=${BBAI_PORT}"
    echo "# LLM: set OLLAMA_HOST=http://127.0.0.1:11434  OR  ANTHROPIC_API_KEY=..."
    echo "# Engine MCP endpoint (TODO 0009): e.g. BBAI_ENGINE_MCP=stdio or http://127.0.0.1:8765"
  } >> "${DATA_DIR}/.env"
fi

echo "==> systemd services"
install -m 644 "${APP_DIR}/deploy/systemd/bbai-engine.service"   /etc/systemd/system/bbai-engine.service
install -m 644 "${APP_DIR}/deploy/systemd/bbai-frontend.service" /etc/systemd/system/bbai-frontend.service
systemctl daemon-reload
if systemctl enable --now bbai-engine bbai-frontend 2>/dev/null; then
  echo "==> services started"
else
  echo "NOTE: services not started — app run commands are TODO (0009 engine start + front-end wiring)."
fi

echo "==> bbai installed at ${APP_DIR} (data: ${DATA_DIR}). UI port: ${BBAI_PORT} (once wired)."
