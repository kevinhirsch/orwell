#!/usr/bin/env bash
#
# orwell — in-container install. Runs inside the LXC created by deploy/orwell.sh.
# Installs deps, clones, builds the engine, sets up the front-end, writes config, registers the
# systemd services — then VERIFIES the result (both units active + both health probes answering),
# so reaching the success banner is earned, never assumed.
#
# IDEMPOTENT: safe to re-run at any time — a re-run finishes a partial install without disturbing
# config, secrets, or game data. Every run appends to ${DATA_DIR}/install.log; on any failure the
# ERR trap names the step that died and how to resume, so a half-install can never masquerade as
# success (a real install once died silently between the engine build and service registration —
# the box answered "connection refused" with nothing explaining why; this framework is that fix).
set -Eeuo pipefail

REPO="${REPO:-https://github.com/kevinhirsch/orwell.git}"
BRANCH="${BRANCH:-main}"
APP_DIR="${APP_DIR:-/opt/orwell}"
DATA_DIR="${DATA_DIR:-/opt/orwell/data}"
# ORWELL_* are primary; BBAI_* are kept as a silent deprecated fallback.
ORWELL_PORT="${ORWELL_PORT:-${BBAI_PORT:-8080}}"
ORWELL_ENGINE_PORT="${ORWELL_ENGINE_PORT:-${BBAI_ENGINE_PORT:-8765}}"

# ── Guards (fail fast, with the reason) ────────────────────────────────────────────────────────
[[ "$(id -u)" -eq 0 ]] || { echo "ERROR: run as root (inside the orwell container)." >&2; exit 1; }
for _pv in "ORWELL_PORT=${ORWELL_PORT}" "ORWELL_ENGINE_PORT=${ORWELL_ENGINE_PORT}"; do
  _pn="${_pv%%=*}"; _pp="${_pv#*=}"
  [[ "$_pp" =~ ^[0-9]+$ ]] && (( _pp >= 1 && _pp <= 65535 )) \
    || { echo "ERROR: ${_pn}='${_pp}' is not a valid port (1-65535)." >&2; exit 1; }
done

# ── Presentation (inline — this installer is its own standalone file; it does not source the TUI
# lib, mirroring orwell.sh). Colour auto-disables off a TTY (the install runs over `pct exec` with
# no PTY, so the tee'd log stays plain ASCII) or when NO_COLOR / TERM=dumb. Pure echo; no input. ─
if [[ -t 1 && -z "${NO_COLOR:-}" && "${TERM:-}" != "dumb" ]]; then
  C_BOLD=$'\e[1m'; C_DIM=$'\e[2m'; C_GRN=$'\e[32m'; C_CYN=$'\e[36m'; C_OFF=$'\e[0m'
else
  C_BOLD=""; C_DIM=""; C_GRN=""; C_CYN=""; C_OFF=""
fi
banner() {
  printf '%s\n' \
"${C_CYN} _____ _____ _ _ _ _____ __    __    ${C_OFF}" \
"${C_CYN}|     |  _  | | | |   __|  |  |  |   ${C_OFF}" \
"${C_CYN}|  |  |    -| | | |   __|  |__|  |__ ${C_OFF}" \
"${C_CYN}|_____|__|__|_____|_____|_____|_____|${C_OFF}" \
"${C_BOLD}            O R W E L L${C_OFF}" \
"   ${C_DIM}${1:-}${C_OFF}"
  printf '\n'
}

# ── Failure observability ──────────────────────────────────────────────────────────────────────
# Each phase declares itself via step(); the ERR trap reports WHICH step died, where the log is,
# and that a plain re-run resumes. set -E makes the trap fire inside functions too.
STEP="startup"
step() { STEP="$1"; echo "${C_CYN}▸${C_OFF} $1"; }
on_err() {
  local rc=$? line=$1
  {
    echo ""
    echo "!!! INSTALL FAILED during: ${STEP} (line ${line}, exit ${rc})"
    echo "!!! Log: ${INSTALL_LOG}"
    echo "!!! This installer is idempotent — fix the cause above and re-run:"
    echo "!!!   bash ${APP_DIR}/deploy/orwell-install.sh"
  } >&2
  exit "$rc"
}
trap 'on_err $LINENO' ERR

# Persist every run (the original failure had no post-mortem artifact: pct exec output scrolls
# away). Secrets never hit stdout — tokens are generated straight into data/.env below.
mkdir -p "$DATA_DIR"
INSTALL_LOG="${DATA_DIR}/install.log"
exec > >(tee -a "$INSTALL_LOG") 2>&1
banner "in-container install"
echo "${C_DIM}── run $(date -Is) · branch ${BRANCH} · UI port ${ORWELL_PORT} · log ${INSTALL_LOG}${C_OFF}"
echo

# ── Phases ──────────────────────────────────────────────────────────────────────────────────────

apt_deps() {
  step "apt deps"
  export DEBIAN_FRONTEND=noninteractive
  # One retry: a transient mirror/DNS hiccup at the very first step shouldn't kill an install.
  apt-get update -qq || { echo "apt update failed — retrying in 5s"; sleep 5; apt-get update -qq; }
  apt-get install -y -qq curl git gnupg build-essential ca-certificates \
    python3 python3-venv python3-pip qemu-guest-agent whiptail
}

git_credential() {
  # ── Private-repo credential (A4/ruling #17) ──────────────────────────────────────────────────
  # GIT_TOKEN (a fine-grained PAT, Contents: Read-only) is persisted ONCE into data/.env — the
  # file every reset preserves — and git reads it at use time via a credential helper. It never
  # lives in the remote URL or .git/config; rotation = edit one line of .env (or
  # orwell-update.sh --set-token).
  if [[ -n "${GIT_TOKEN:-}" ]] && ! grep -qs '^GIT_TOKEN=' "${DATA_DIR}/.env"; then
    touch "${DATA_DIR}/.env"; chmod 600 "${DATA_DIR}/.env"
    printf 'GIT_TOKEN=%s\n' "$GIT_TOKEN" >> "${DATA_DIR}/.env"
  fi
  if grep -qs '^GIT_TOKEN=' "${DATA_DIR}/.env"; then
    step "git credential helper (token read from ${DATA_DIR}/.env at use time)"
    git config --system credential.helper \
      '!f(){ echo username=x-access-token; echo "password=$(sed -n s/^GIT_TOKEN=//p '"${DATA_DIR}"'/.env)"; };f'
  fi
}

guest_agent() {
  # Proxmox guest tools (qemu-guest-agent). It's a VM-only transport (virtio-serial), absent in
  # an LXC — so install it always, but ENABLE it only when that transport exists (a real VM). On
  # an LXC the host manages the guest directly, so the agent stays installed-but-dormant (no
  # failed unit).
  if [[ -e /dev/virtio-ports/org.qemu.guest_agent.0 ]]; then
    step "enabling qemu-guest-agent (VM transport detected)"
    systemctl enable --now qemu-guest-agent 2>/dev/null || true
  else
    step "qemu-guest-agent installed (LXC: dormant — host manages the guest directly)"
  fi
}

node22() {
  step "Node 22"
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
}

checkout() {
  step "checkout orwell -> ${APP_DIR}"
  # init+fetch+reset (not clone): ${APP_DIR} may already hold data/.env (the seeded GIT_TOKEN) —
  # clone refuses a non-empty dir. The credential helper above supplies auth on a private repo.
  if [[ ! -d "${APP_DIR}/.git" ]]; then
    mkdir -p "$APP_DIR"
    git -C "$APP_DIR" init -q
  fi
  # The ownership step below hands the checkout to the `orwell` user while updates run git as
  # root — without this, git >=2.35 refuses every later fetch with "dubious ownership" (the
  # update path would be dead on arrival on a real box). Idempotent: added once.
  git config --system --get-all safe.directory 2>/dev/null | grep -qx "$APP_DIR" \
    || git config --system --add safe.directory "$APP_DIR"
  git -C "$APP_DIR" remote set-url origin "$REPO" 2>/dev/null || git -C "$APP_DIR" remote add origin "$REPO"
  git -C "$APP_DIR" fetch --depth 1 origin "$BRANCH"
  git -C "$APP_DIR" reset --hard "origin/${BRANCH}"
  mkdir -p "$DATA_DIR"
  mkdir -p "${APP_DIR}/frontend/data"   # orwell SQLite DB lives here (sqlite:///./data/app.db)
}

build_engine() {
  step "build engine"
  cd "$APP_DIR"
  npm ci
  # Engine contract (provided by the implementer): `npm run build` + `npm start`. Verify it's
  # present before building, so a not-yet-runnable checkout fails clearly instead of
  # half-installing.
  if ! node -e "const s=require('${APP_DIR}/package.json').scripts||{};process.exit((s.build&&s.start)?0:1)"; then
    echo "ERROR: engine 'build'/'start' scripts not found in package.json."
    echo "       The engine entrypoint is pending; re-run once it has landed on '${BRANCH}'."
    exit 1
  fi
  npm run build
}

prefetch_model() {
  # Prefetch the pinned embedding model (ADR 0004 / E86a) so engine boots are offline + fast.
  # Non-fatal: a fetch failure here just means the first boot tries again (and falls back to
  # deterministic recall if it still can't — the game never breaks on embeddings).
  step "embedding model prefetch (fastembed, pinned — ADR 0004)"
  cd "$APP_DIR"
  node dist/embedWorker.js --prefetch --cache-dir "${DATA_DIR}/models" \
    || echo "WARN: embedding model prefetch failed — the engine will retry at boot and fall back to deterministic recall meanwhile"
}

frontend_deps() {
  step "front-end (orwell) deps"
  cd "${APP_DIR}/frontend"
  python3 -m venv .venv
  ./.venv/bin/pip install -q --upgrade pip
  # Pinned lockfile first (audit E83): reproducible installs, no blind re-resolution per update.
  if [[ -f requirements.lock.txt ]]; then
    ./.venv/bin/pip install -q -r requirements.lock.txt
  else
    ./.venv/bin/pip install -q -r requirements.txt
  fi
}

write_config() {
  step "config"
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
      # Engine auth ON by default (B67/ops A1): one shared secret in this file equips BOTH
      # services (the engine enforces it; the front-end sends it) — even co-located behind
      # loopback.
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
      # embedding provider (fastembed, version-pinned). The model is prefetched above into
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
      # (OpenAI-compatible endpoints, e.g. Ollama's /v1) and OPENAI_API_KEY — so "configured" is
      # a real signal, not a key nothing reads. Secrets only ever live here, in the container.
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
  # From here on, data/.env is the source of truth for the ports — a re-run with a different
  # env-supplied ORWELL_PORT must NOT drift the drop-in/verification away from what the unit
  # actually reads (its EnvironmentFile). Operators change ports by editing .env.
  EFFECTIVE_PORT="$(sed -n 's/^ORWELL_PORT=//p' "${DATA_DIR}/.env" | tail -n1)"
  EFFECTIVE_PORT="${EFFECTIVE_PORT:-$ORWELL_PORT}"
  EFFECTIVE_ENGINE_PORT="$(sed -n 's/^ORWELL_ENGINE_PORT=//p' "${DATA_DIR}/.env" | tail -n1)"
  EFFECTIVE_ENGINE_PORT="${EFFECTIVE_ENGINE_PORT:-$ORWELL_ENGINE_PORT}"
  if [[ "$EFFECTIVE_PORT" != "$ORWELL_PORT" ]]; then
    echo "NOTE: data/.env pins ORWELL_PORT=${EFFECTIVE_PORT} (the env-supplied ${ORWELL_PORT} is ignored on a re-run; edit data/.env to change it)"
  fi
}

ownership() {
  step "least-privilege user (B72/ops A5)"
  id -u orwell >/dev/null 2>&1 || useradd -r -s /usr/sbin/nologin -d /opt/orwell orwell
  mkdir -p "${DATA_DIR}/saves" "${APP_DIR}/frontend/data"
  # DATA_DIR is chowned explicitly: it defaults inside APP_DIR but is overridable to a path
  # outside it — and the engine (running as `orwell`) must always be able to write saves/models.
  chown -R orwell:orwell "${APP_DIR}" "${DATA_DIR}"
  # G19b — web-triggered maintenance: the FE (E85-hardened: User=orwell, every capability
  # dropped — no systemctl) requests an update by dropping a FLAG FILE in data/ops/; the
  # root-side orwell-ops-update.path unit consumes it. The flag dir must be orwell-WRITABLE
  # (the web tier writes the flag; the flag's content is ignored — existence only) and the
  # live run log FE-readable: the admin status page tails any data/*.log (G1b). The log is
  # touched, never `install`ed — a re-run must not truncate the run history.
  install -d -m 750 "${DATA_DIR}/ops"
  chown orwell:orwell "${DATA_DIR}/ops"
  rm -f "${DATA_DIR}/ops/update-requested"   # a stale pre-install request must not fire mid-install
  rm -f "${DATA_DIR}/ops/factory-reset-requested"  # likewise: no stale OOBE-reset request fires mid-install
  rm -f "${DATA_DIR}/ops/update-reset-requested"   # likewise: no stale Update+Reset request fires mid-install
  rm -f "${DATA_DIR}/ops/public-deployment-requested"  # likewise: no stale Connect request fires mid-install
  touch "${DATA_DIR}/ops-update.log"
  chmod 644 "${DATA_DIR}/ops-update.log"
  # The OOBE-reset trigger (admin "Factory Reset (OOBE)" button) appends to its own live log,
  # tailed by the same admin status page viewer. Touched, never `install`ed (keep the history).
  touch "${DATA_DIR}/ops-factory-reset.log"
  chmod 644 "${DATA_DIR}/ops-factory-reset.log"
  # The combined Update + Reset trigger (admin "Update + Reset" button) likewise appends to its own
  # live log, tailed by the same viewer. Touched, never `install`ed (keep the run history).
  touch "${DATA_DIR}/ops-update-reset.log"
  chmod 644 "${DATA_DIR}/ops-update-reset.log"
  # The public-deployment trigger (admin "Connect to the internet" wizard, feature 0068) appends to
  # its own live log, tailed by the same viewer. Touched, never `install`ed (keep the run history).
  touch "${DATA_DIR}/ops-public-deployment.log"
  chmod 644 "${DATA_DIR}/ops-public-deployment.log"
}

systemd_services() {
  step "systemd services"
  install -m 644 "${APP_DIR}/deploy/systemd/orwell-engine.service"   /etc/systemd/system/orwell-engine.service
  install -m 644 "${APP_DIR}/deploy/systemd/orwell-frontend.service" /etc/systemd/system/orwell-frontend.service
  # G19b — the web-triggered-update seam: the E85-hardened FE cannot systemctl or self-update,
  # so the web tier drops the flag data/ops/update-requested and the root-side PATH unit runs
  # the one fixed update script, output appended live to data/ops-update.log (the admin status
  # page tails it). Root-by-design — the WHY is documented in the unit files themselves.
  install -m 644 "${APP_DIR}/deploy/systemd/orwell-ops-update.path"    /etc/systemd/system/orwell-ops-update.path
  install -m 644 "${APP_DIR}/deploy/systemd/orwell-ops-update.service" /etc/systemd/system/orwell-ops-update.service
  # Same G19b seam for the admin "Factory Reset (OOBE)" button: the web tier drops the flag
  # data/ops/factory-reset-requested and this root-side PATH unit runs the one fixed reset
  # script (orwell-oobe-reset.sh --yes), output appended live to data/ops-factory-reset.log.
  install -m 644 "${APP_DIR}/deploy/systemd/orwell-ops-factory-reset.path"    /etc/systemd/system/orwell-ops-factory-reset.path
  install -m 644 "${APP_DIR}/deploy/systemd/orwell-ops-factory-reset.service" /etc/systemd/system/orwell-ops-factory-reset.service
  # Same G19b seam for the admin "Update + Reset" button: the web tier drops the flag
  # data/ops/update-reset-requested and this root-side PATH unit runs the one fixed combined script
  # (orwell-update-reset.sh --yes — update with restart suppressed, then OOBE reset with the single
  # final restart), output appended live to data/ops-update-reset.log.
  install -m 644 "${APP_DIR}/deploy/systemd/orwell-ops-update-reset.path"    /etc/systemd/system/orwell-ops-update-reset.path
  install -m 644 "${APP_DIR}/deploy/systemd/orwell-ops-update-reset.service" /etc/systemd/system/orwell-ops-update-reset.service
  # Same G19b seam for the admin "Connect to the internet" wizard (feature 0068): the web tier drops
  # the flag data/ops/public-deployment-requested and this root-side PATH unit runs the one fixed
  # public-deployment script (orwell-ops-public-deployment.sh — .env upsert + cloudflared install/run
  # + FE restart + token shred), output appended live to data/ops-public-deployment.log.
  install -m 644 "${APP_DIR}/deploy/systemd/orwell-ops-public-deployment.path"    /etc/systemd/system/orwell-ops-public-deployment.path
  install -m 644 "${APP_DIR}/deploy/systemd/orwell-ops-public-deployment.service" /etc/systemd/system/orwell-ops-public-deployment.service

  # Privileged UI port (<1024, e.g. 80): the hardened unit (E85) runs uvicorn as the non-root
  # `orwell` user with ALL capabilities dropped — it structurally cannot bind a port below 1024
  # (the bind fails, the unit crash-loops, the UI is "connection refused"). Grant exactly the one
  # capability needed via a drop-in, keyed on the EFFECTIVE port (data/.env — what the unit will
  # actually read), written only when needed and removed otherwise, so the audited base unit
  # stays byte-stable and the default 8080 posture keeps the empty bounding set.
  FRONTEND_DROPIN="/etc/systemd/system/orwell-frontend.service.d/10-privileged-port.conf"
  if [[ "${EFFECTIVE_PORT}" =~ ^[0-9]+$ ]] && (( EFFECTIVE_PORT < 1024 )); then
    echo "==> ORWELL_PORT=${EFFECTIVE_PORT} is privileged (<1024): granting CAP_NET_BIND_SERVICE (drop-in)"
    mkdir -p "${FRONTEND_DROPIN%/*}"
    cat > "$FRONTEND_DROPIN" <<EOF
# Written by orwell-install.sh: ORWELL_PORT=${EFFECTIVE_PORT} is a privileged port (<1024).
# The base unit's empty CapabilityBoundingSet= is the audited default (E85); this grants the
# single capability a non-root bind below 1024 requires. Removed when the port moves >=1024.
[Service]
AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE
EOF
  else
    rm -f "$FRONTEND_DROPIN"
  fi

  # OPTIONAL — the admin "Update" button's DIRECT path (ORWELL_UPDATE_SUDO=1): a tightly-scoped
  # sudoers drop-in letting the non-root `orwell` FE user run EXACTLY the one fixed update script.
  # OFF by default: the recommended door is the root-side flag trigger (orwell-ops-update.path,
  # above), which needs no sudo. Only install this when the operator opts into the detached-Popen
  # path. The drop-in is validated with `visudo -c` before it is trusted (a bad sudoers file can
  # lock out sudo entirely). NOTE: NoNewPrivileges=yes in the FE unit blocks setuid sudo — the
  # operator must also add a drop-in clearing it (deploy/README.md); the flag trigger avoids this.
  if [[ "${ORWELL_UPDATE_SUDO:-0}" == "1" ]]; then
    step "admin-update sudoers drop-in (ORWELL_UPDATE_SUDO=1)"
    local sudoers_tmp="/etc/sudoers.d/.orwell-update.tmp"
    install -m 0440 "${APP_DIR}/deploy/sudoers/orwell-update" "$sudoers_tmp"
    if visudo -cf "$sudoers_tmp" >/dev/null 2>&1; then
      mv -f "$sudoers_tmp" /etc/sudoers.d/orwell-update
      echo "==> installed /etc/sudoers.d/orwell-update (scoped to orwell-update.sh)"
    else
      rm -f "$sudoers_tmp"
      echo "WARNING: deploy/sudoers/orwell-update failed visudo -c — NOT installed" >&2
    fi
  fi

  systemctl daemon-reload
  systemctl enable --now orwell-engine orwell-frontend
  # The ops TRIGGERS are path units (their services are started by the watcher, never enabled).
  systemctl enable --now orwell-ops-update.path orwell-ops-factory-reset.path orwell-ops-update-reset.path orwell-ops-public-deployment.path
  # `enable --now` is a no-op on already-running units — a re-run must pick up the fresh build
  # and any unit/drop-in change, so restart explicitly (cheap on first install: just started).
  systemctl restart orwell-engine orwell-frontend orwell-ops-update.path orwell-ops-factory-reset.path orwell-ops-update-reset.path orwell-ops-public-deployment.path
}

login_panel() {
  # Login health panel (ruling #21, 2026-06-11): greet interactive container shells with live
  # health instead of a bare prompt. Time-bounded probes; guarded; can never block a login.
  step "login health panel"
  install -m 0755 "${APP_DIR}/deploy/orwell-login-panel.sh" /usr/local/bin/orwell-panel
  if ! grep -qs 'orwell-panel' /etc/bash.bashrc; then
    cat >> /etc/bash.bashrc <<'PANEL'

# orwell login health panel (interactive shells only; guarded; never blocks)
case $- in *i*) [ -z "${ORWELL_PANEL_SHOWN:-}" ] && export ORWELL_PANEL_SHOWN=1 && /usr/local/bin/orwell-panel 2>/dev/null || true ;; esac
PANEL
  fi

  # Control-panel launcher: `orwell` opens the whiptail maintenance menu (deploy/orwell-menu.sh).
  cat > /usr/local/bin/orwell <<LAUNCH
#!/usr/bin/env bash
exec bash "${APP_DIR}/deploy/orwell-menu.sh" "\$@"
LAUNCH
  chmod 0755 /usr/local/bin/orwell
}

verify_install() {
  # The success banner is EARNED: both units active and both health endpoints answering (the
  # same probes smoke.sh and the login panel use). Without this, a partial install that limps
  # to the end claims success and the first symptom is a player's "connection refused".
  step "verify install"
  local ok_engine="" ok_ui="" i
  for i in $(seq 1 30); do
    [[ -z "$ok_engine" ]] && curl -fsS --max-time 2 "http://127.0.0.1:${EFFECTIVE_ENGINE_PORT}/health" 2>/dev/null | grep -q '"ok":true' && ok_engine=1
    [[ -z "$ok_ui" ]] && curl -fsS -o /dev/null --max-time 2 "http://127.0.0.1:${EFFECTIVE_PORT}/openapi.json" 2>/dev/null && ok_ui=1
    [[ -n "$ok_engine" && -n "$ok_ui" ]] && break
    sleep 1
  done
  local failed=""
  systemctl is-active --quiet orwell-engine   || failed="${failed} orwell-engine(unit)"
  systemctl is-active --quiet orwell-frontend || failed="${failed} orwell-frontend(unit)"
  [[ -n "$ok_engine" ]] || failed="${failed} engine(:${EFFECTIVE_ENGINE_PORT}/health)"
  [[ -n "$ok_ui" ]]     || failed="${failed} frontend(:${EFFECTIVE_PORT}/openapi.json)"
  if [[ -n "$failed" ]]; then
    echo "ERROR: install verification failed:${failed}" >&2
    for u in orwell-engine orwell-frontend; do
      echo "--- systemctl status ${u} (tail) ---" >&2
      systemctl --no-pager -l status "$u" 2>&1 | tail -n 8 >&2 || true
      echo "--- journalctl -u ${u} (tail) ---" >&2
      journalctl -u "$u" -n 12 --no-pager 2>&1 >&2 || true
    done
    exit 1
  fi
  echo "${C_GRN}✓${C_OFF} verified: both services active; engine + UI answering"
}

main() {
  apt_deps
  git_credential
  guest_agent
  node22
  checkout
  build_engine
  prefetch_model
  frontend_deps
  write_config
  ownership
  systemd_services
  login_panel
  verify_install

  # A browsable address, not 0.0.0.0 (a real operator was pointed at the wrong host by the old
  # message). hostname -I is the container's address; fall back if it's somehow empty.
  local ip
  ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  echo
  echo "${C_GRN}╶───────────────────────────────────────────────────────────╴${C_OFF}"
  echo "  ${C_BOLD}${C_GRN}orwell is installed and running.${C_OFF}"
  echo "  ${C_BOLD}play:${C_OFF}    http://${ip:-<container-ip>}:${EFFECTIVE_PORT}"
  echo "  ${C_DIM}app:${C_OFF}     ${APP_DIR}   ${C_DIM}data:${C_OFF} ${DATA_DIR}"
  echo "  ${C_DIM}manage:${C_OFF}  ${C_BOLD}orwell${C_OFF} ${C_DIM}(control panel)${C_OFF}   ${C_DIM}health:${C_OFF} orwell-panel"
  echo "${C_GRN}╶───────────────────────────────────────────────────────────╴${C_OFF}"
}

main "$@"
