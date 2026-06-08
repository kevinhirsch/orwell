#!/usr/bin/env bash
#
# bbai — in-container install. Runs inside the LXC created by deploy/bbai.sh.
# Installs deps, clones, builds the engine, sets up the front-end, writes config, and registers
# systemd services for the engine (MCP server) and the odysseus front-end.
set -euo pipefail

REPO="${REPO:-https://github.com/kevinhirsch/bbai.git}"
BRANCH="${BRANCH:-main}"
APP_DIR="${APP_DIR:-/opt/bbai}"
DATA_DIR="${DATA_DIR:-/opt/bbai/data}"
BBAI_PORT="${BBAI_PORT:-8080}"
BBAI_ENGINE_PORT="${BBAI_ENGINE_PORT:-8765}"

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
# Engine contract (provided by the implementer): `npm run build` + `npm start`. Verify it's
# present before building, so a not-yet-runnable checkout fails clearly instead of half-installing.
if ! node -e "const s=require('${APP_DIR}/package.json').scripts||{};process.exit((s.build&&s.start)?0:1)"; then
  echo "ERROR: engine 'build'/'start' scripts not found in package.json."
  echo "       The engine entrypoint is pending; re-run once it has landed on '${BRANCH}'."
  exit 1
fi
npm run build

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
    echo "# --- bbai ---"
    echo "# front-end UI port"
    echo "BBAI_PORT=${BBAI_PORT}"
    echo "# engine MCP server port (loopback)"
    echo "BBAI_ENGINE_PORT=${BBAI_ENGINE_PORT}"
    echo "# front-end -> engine MCP endpoint"
    echo "BBAI_ENGINE_MCP_URL=http://127.0.0.1:${BBAI_ENGINE_PORT}"
    # LLM provider: written through from the host installer's prompt when supplied; otherwise a
    # commented hint. Secrets only ever live here, in the container — never in the repo.
    if [[ -n "${ANTHROPIC_API_KEY:-}" ]]; then
      echo "ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}"
    elif [[ -n "${OLLAMA_HOST:-}" ]]; then
      echo "OLLAMA_HOST=${OLLAMA_HOST}"
    else
      echo "# LLM (pick one): OLLAMA_HOST=http://127.0.0.1:11434  OR  ANTHROPIC_API_KEY=..."
    fi
  } >> "${DATA_DIR}/.env"
  chmod 600 "${DATA_DIR}/.env"
fi

echo "==> systemd services"
install -m 644 "${APP_DIR}/deploy/systemd/bbai-engine.service"   /etc/systemd/system/bbai-engine.service
install -m 644 "${APP_DIR}/deploy/systemd/bbai-frontend.service" /etc/systemd/system/bbai-frontend.service
systemctl daemon-reload
systemctl enable --now bbai-engine bbai-frontend

echo "==> bbai installed at ${APP_DIR} (data: ${DATA_DIR}). UI: http://0.0.0.0:${BBAI_PORT}"
