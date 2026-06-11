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
apt-get install -y -qq curl git gnupg build-essential ca-certificates python3 python3-venv python3-pip qemu-guest-agent

# ── Private-repo credential (A4/ruling #17) ────────────────────────────────────────────────────
# GIT_TOKEN (a fine-grained PAT, Contents: Read-only) is persisted ONCE into data/.env — the file
# every reset preserves — and git reads it at use time via a credential helper. It never lives in
# the remote URL or .git/config; rotation = edit one line of .env (or orwell-update.sh --set-token).
mkdir -p "$DATA_DIR"
if [[ -n "${GIT_TOKEN:-}" ]] && ! grep -qs '^GIT_TOKEN=' "${DATA_DIR}/.env"; then
  touch "${DATA_DIR}/.env"; chmod 600 "${DATA_DIR}/.env"
  printf 'GIT_TOKEN=%s\n' "$GIT_TOKEN" >> "${DATA_DIR}/.env"
fi
if grep -qs '^GIT_TOKEN=' "${DATA_DIR}/.env"; then
  echo "==> git credential helper (token read from ${DATA_DIR}/.env at use time)"
  git config --system credential.helper \
    '!f(){ echo username=x-access-token; echo "password=$(sed -n s/^GIT_TOKEN=//p '"${DATA_DIR}"'/.env)"; };f'
fi

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
  # No `curl | bash` as root (audit E84): add the NodeSource apt repo by hand — fetch only the
  # signing KEY, then let apt's signature verification gate every package install.
  install -d -m 755 /usr/share/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
    | gpg --dearmor --yes -o /usr/share/keyrings/nodesource.gpg
  echo "deb [signed-by=/usr/share/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" \
    > /etc/apt/sources.list.d/nodesource.list
  apt-get update -qq
  apt-get install -y -qq nodejs
fi

echo "==> checkout orwell -> ${APP_DIR}"
# init+fetch+reset (not clone): ${APP_DIR} may already hold data/.env (the seeded GIT_TOKEN) —
# clone refuses a non-empty dir. The credential helper above supplies auth on a private repo.
if [[ ! -d "${APP_DIR}/.git" ]]; then
  mkdir -p "$APP_DIR"
  git -C "$APP_DIR" init -q
fi
git -C "$APP_DIR" remote set-url origin "$REPO" 2>/dev/null || git -C "$APP_DIR" remote add origin "$REPO"
git -C "$APP_DIR" fetch --depth 1 origin "$BRANCH"
git -C "$APP_DIR" reset --hard "origin/${BRANCH}"
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

# Prefetch the pinned embedding model (ADR 0004 / E86a) so engine boots are offline + fast.
# Non-fatal: a fetch failure here just means the first boot tries again (and falls back to
# deterministic recall if it still can't — the game never breaks on embeddings).
echo "==> embedding model prefetch (fastembed, pinned — ADR 0004)"
node dist/embedWorker.js --prefetch --cache-dir "${DATA_DIR}/models" \
  || echo "WARN: embedding model prefetch failed — the engine will retry at boot and fall back to deterministic recall meanwhile"

echo "==> front-end (orwell) deps"
cd "${APP_DIR}/frontend"
python3 -m venv .venv
./.venv/bin/pip install -q --upgrade pip
# Pinned lockfile first (audit E83): reproducible installs, no blind re-resolution per update.
if [[ -f requirements.lock.txt ]]; then
  ./.venv/bin/pip install -q -r requirements.lock.txt
else
  ./.venv/bin/pip install -q -r requirements.txt
fi

echo "==> config"
# The token bootstrap above may already have created .env with just GIT_TOKEN — key the
# "first install" config block on the app config being absent, not on the file existing.
if ! grep -qs '^ORWELL_PORT=' "${DATA_DIR}/.env"; then
  [[ -s "${DATA_DIR}/.env" ]] || cp "${APP_DIR}/frontend/.env.example" "${DATA_DIR}/.env" 2>/dev/null || touch "${DATA_DIR}/.env"
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
    # Audit E27: a SEPARATE secret for the admin/God-Mode channel — one shared bearer must not
    # grant both any-user impersonation AND God Mode. The engine demands this one on /admin/*
    # (the player token is refused there); the front-end sends it on admin calls only.
    echo "# admin/God-Mode secret: required on /admin/* (the player token is refused there)"
    echo "ORWELL_ENGINE_ADMIN_TOKEN=$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
    # engine save dir — pin it INSIDE data/ so saves live where docs, update, and the
    # factory-reset script all expect (the engine default is ./.orwell-data, which hid the
    # save outside data/ and made factory-reset miss it). Preserved across updates (data/ is
    # gitignored); scrubbed by orwell-factory-reset.sh.
    echo "ORWELL_DATA_DIR=${DATA_DIR}/saves"
    # Semantic recall (ADR 0004 / audit E86a): the deploy default is the REAL local-ONNX
    # embedding provider (fastembed, version-pinned). The model is prefetched below into
    # data/models (offline thereafter; preserved by updates and both reset scripts). If the
    # model is ever missing the engine logs loudly and falls back to deterministic recall —
    # the game never breaks.
    echo "ORWELL_EMBEDDINGS=fastembed"
    echo "ORWELL_EMBED_CACHE=${DATA_DIR}/models"
    # Multi-user identity (audit E32): the FE ships with accounts ON by default, so the engine
    # must REQUIRE an asserted x-orwell-user — never silently collapse anonymous callers into a
    # shared "default" sandbox (cross-user isolation, feature 0021).
    echo "# engine multi-user mode: every request must assert its x-orwell-user"
    echo "ORWELL_ENGINE_MULTIUSER=1"
    echo "# behind TLS? also set SECURE_COOKIES=true (front-end session cookies get the Secure flag)"
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

# Privileged UI port (<1024, e.g. 80): the hardened unit (E85) runs uvicorn as the non-root
# `orwell` user with ALL capabilities dropped — it structurally cannot bind a port below 1024
# (the bind fails, the unit crash-loops, the UI is "connection refused"). Grant exactly the one
# capability needed via a drop-in, written only when needed and removed otherwise, so the
# audited base unit stays byte-stable and the default 8080 posture keeps the empty bounding set.
FRONTEND_DROPIN="/etc/systemd/system/orwell-frontend.service.d/10-privileged-port.conf"
if [[ "${ORWELL_PORT}" =~ ^[0-9]+$ ]] && (( ORWELL_PORT < 1024 )); then
  echo "==> ORWELL_PORT=${ORWELL_PORT} is privileged (<1024): granting CAP_NET_BIND_SERVICE (drop-in)"
  mkdir -p "${FRONTEND_DROPIN%/*}"
  cat > "$FRONTEND_DROPIN" <<EOF
# Written by orwell-install.sh: ORWELL_PORT=${ORWELL_PORT} is a privileged port (<1024).
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
systemctl enable --now orwell-engine orwell-frontend

# Login health panel (ruling #21, 2026-06-11): greet interactive container shells with live
# health instead of a bare prompt. Time-bounded probes; guarded; can never block a login.
install -m 0755 "${APP_DIR}/deploy/orwell-login-panel.sh" /usr/local/bin/orwell-panel
if ! grep -qs 'orwell-panel' /etc/bash.bashrc; then
  cat >> /etc/bash.bashrc <<'PANEL'

# orwell login health panel (interactive shells only; guarded; never blocks)
case $- in *i*) [ -z "${ORWELL_PANEL_SHOWN:-}" ] && export ORWELL_PANEL_SHOWN=1 && /usr/local/bin/orwell-panel 2>/dev/null || true ;; esac
PANEL
fi


echo "==> orwell installed at ${APP_DIR} (data: ${DATA_DIR}). UI: http://0.0.0.0:${ORWELL_PORT}"
