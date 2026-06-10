#!/usr/bin/env bash
#
# orwell — in-container install. Runs inside the LXC created by deploy/orwell.sh.
# Installs deps, clones, builds the engine, sets up the front-end, writes config, and registers
# systemd services for the engine (MCP server) and the orwell front-end.
set -euo pipefail

REPO="${REPO:-https://github.com/kevinhirsch/orwell.git}"
BRANCH="${BRANCH:-main}"
APP_DIR="${APP_DIR:-/opt/orwell}"
DATA_DIR="${DATA_DIR:-/opt/orwell/data}"
# ORWELL_* are primary; BBAI_* are kept as a silent deprecated fallback.
ORWELL_PORT="${ORWELL_PORT:-${BBAI_PORT:-8080}}"
ORWELL_ENGINE_PORT="${ORWELL_ENGINE_PORT:-${BBAI_ENGINE_PORT:-8765}}"

echo "==> apt deps"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl git build-essential ca-certificates python3 python3-venv python3-pip qemu-guest-agent

# Proxmox guest tools (qemu-guest-agent). It's a VM-only transport (virtio-serial), absent in an
# LXC — so install it always, but ENABLE it only when that transport exists (a real VM). On an LXC
# the host manages the guest directly, so the agent stays installed-but-dormant (no failed unit).
if [[ -e /dev/virtio-ports/org.qemu.guest_agent.0 ]]; then
  echo "==> enabling qemu-guest-agent (VM transport detected)"
  systemctl enable --now qemu-guest-agent 2>/dev/null || true
else
  echo "==> qemu-guest-agent installed (LXC: dormant — host manages the guest directly)"
fi

echo "==> Node 22"
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v | cut -d. -f1 | tr -d v)" -lt 22 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -qq nodejs
fi

echo "==> clone orwell -> ${APP_DIR}"
if [[ -d "${APP_DIR}/.git" ]]; then
  git -C "$APP_DIR" fetch --depth 1 origin "$BRANCH"
  git -C "$APP_DIR" reset --hard "origin/${BRANCH}"
else
  git clone --depth 1 -b "$BRANCH" "$REPO" "$APP_DIR"
fi
mkdir -p "$DATA_DIR"
mkdir -p "${APP_DIR}/frontend/data"   # orwell SQLite DB lives here (sqlite:///./data/app.db)

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

echo "==> front-end (orwell) deps"
cd "${APP_DIR}/frontend"
python3 -m venv .venv
./.venv/bin/pip install -q --upgrade pip
./.venv/bin/pip install -q -r requirements.txt

echo "==> config"
if [[ ! -f "${DATA_DIR}/.env" ]]; then
  cp "${APP_DIR}/frontend/.env.example" "${DATA_DIR}/.env" 2>/dev/null || touch "${DATA_DIR}/.env"
  {
    echo ""
    echo "# --- orwell ---"
    echo "# front-end UI port"
    echo "ORWELL_PORT=${ORWELL_PORT}"
    echo "# engine MCP server port (loopback)"
    echo "ORWELL_ENGINE_PORT=${ORWELL_ENGINE_PORT}"
    echo "# front-end -> engine MCP endpoint"
    echo "ORWELL_ENGINE_MCP_URL=http://127.0.0.1:${ORWELL_ENGINE_PORT}"
    # Engine auth ON by default (B67/ops A1): one shared secret in this file equips BOTH services
    # (the engine enforces it; the front-end sends it) — even co-located behind loopback.
    echo "# shared secret: the engine requires it on every tool route; the front-end sends it"
    echo "ORWELL_ENGINE_TOKEN=$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
    # engine save dir — pin it INSIDE data/ so saves live where docs, update, and the
    # factory-reset script all expect (the engine default is ./.orwell-data, which hid the
    # save outside data/ and made factory-reset miss it). Preserved across updates (data/ is
    # gitignored); scrubbed by orwell-factory-reset.sh.
    echo "ORWELL_DATA_DIR=${DATA_DIR}/saves"
    # LLM provider (B72/ops A3): write the names the FRONT-END actually consumes — LLM_HOSTS
    # (OpenAI-compatible endpoints, e.g. Ollama's /v1) and OPENAI_API_KEY — so "configured" is a
    # real signal, not a key nothing reads. Secrets only ever live here, in the container.
    if [[ -n "${OLLAMA_HOST:-}" ]]; then
      _llm_host="${OLLAMA_HOST#http://}"; _llm_host="${_llm_host#https://}"
      echo "LLM_HOSTS=${_llm_host}"
    elif [[ -n "${OPENAI_API_KEY:-}" ]]; then
      echo "OPENAI_API_KEY=${OPENAI_API_KEY}"
      [[ -n "${LLM_HOSTS:-}" ]] && echo "LLM_HOSTS=${LLM_HOSTS}"
    else
      echo "# LLM: configure under Settings -> Services/AI after first login (admin), or set"
      echo "# LLM_HOSTS=<host:port of an OpenAI-compatible endpoint>  and/or  OPENAI_API_KEY=..."
    fi
  } >> "${DATA_DIR}/.env"
  chmod 600 "${DATA_DIR}/.env"
fi

echo "==> least-privilege user (B72/ops A5)"
id -u orwell >/dev/null 2>&1 || useradd -r -s /usr/sbin/nologin -d /opt/orwell orwell
mkdir -p "${DATA_DIR}/saves" "${APP_DIR}/frontend/data"
chown -R orwell:orwell "${APP_DIR}"

echo "==> systemd services"
install -m 644 "${APP_DIR}/deploy/systemd/orwell-engine.service"   /etc/systemd/system/orwell-engine.service
install -m 644 "${APP_DIR}/deploy/systemd/orwell-frontend.service" /etc/systemd/system/orwell-frontend.service
systemctl daemon-reload
systemctl enable --now orwell-engine orwell-frontend

echo "==> orwell installed at ${APP_DIR} (data: ${DATA_DIR}). UI: http://0.0.0.0:${ORWELL_PORT}"
