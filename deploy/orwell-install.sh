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
# Front-end bind host (feature 0067 / ADR 0007). DEFAULT 0.0.0.0 so a fresh install / rebuild stays
# reachable on the LAN — the common self-hosted case; orwell.sh prompts and passes the operator's
# choice through. 127.0.0.1 keeps loopback for a reverse-proxy / HTTPS / tunnel deploy. This value
# is PERSISTED to data/.env (write_config) so it survives reboots and rebuilds; the systemd unit's
# built-in default stays 127.0.0.1 (safe), and the EnvironmentFile value below overrides it.
# NOTE: enabling local HTTPS later (orwell-https.sh) idempotently re-pins this to 127.0.0.1 — the
# TLS terminator then becomes the only LAN entrypoint. That ordering is intentional and preserved.
ORWELL_BIND_HOST="${ORWELL_BIND_HOST:-0.0.0.0}"

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
    python3 python3-venv python3-pip qemu-guest-agent whiptail logrotate
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
  # Production hardening: the engine runs BUNDLED (dist/main.js + the 3 pinned native deps), so the
  # host needs only the RUNTIME tree after the build. Drop the dev/build chain (esbuild, vitest,
  # cucumber, …) so the deployed box doesn't carry its advisories (npm audit: all dev-chain — see
  # README "Dependency advisories"). Non-fatal; an update re-installs it to rebuild.
  npm prune --omit=dev || echo "WARN: npm prune --omit=dev failed (dev deps remain; harmless)"
}

prefetch_model() {
  # Prefetch the pinned embedding model (ADR 0004 / E86a) so engine boots are offline + fast.
  # Non-fatal: a fetch failure here just means the first boot tries again (and falls back to
  # deterministic recall if it still can't — the game never breaks on embeddings).
  step "embedding model prefetch (fastembed, pinned — ADR 0004)"
  cd "$APP_DIR"
  # A11: filter onnxruntime's harmless LXC `pthread_setaffinity_np … error code: 22` from the visible
  # output (it can't be silenced via fastembed-js's API; the pool just runs unpinned). Everything
  # else still surfaces.
  #
  # The trailing `|| true` inside the process substitution is LOAD-BEARING — do not "clean it up".
  # `grep -v` exits 1 when it filters out ALL of its input, and on an LXC the affinity warning is
  # often the ONLY thing the worker writes to stderr — so a SUCCESSFUL prefetch (node exits 0, model
  # cached) leaves grep matching nothing and exiting 1. Under `set -Eeuo pipefail`, errtrace (-E)
  # propagates the ERR trap into the process-substitution subshell, so that stray exit-1 fires on_err
  # and reports a bogus "INSTALL FAILED during: embedding model prefetch" for a prefetch that in fact
  # succeeded. Swallowing grep's no-match status keeps this step genuinely non-fatal (as intended).
  if ! node dist/embedWorker.js --prefetch --cache-dir "${DATA_DIR}/models" \
       2> >(grep -vE 'pthread_setaffinity_np.*error code: 22' >&2 || true); then
    echo "WARN: embedding model prefetch failed — the engine will retry at boot and fall back to deterministic recall meanwhile"
  fi
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
      # Front-end bind host (feature 0067 / ADR 0007). PERSISTED here so a fresh install / rebuild
      # stays reachable: 0.0.0.0 (the installer default) exposes the UI on the LAN; 127.0.0.1 keeps
      # it loopback-only for a reverse-proxy / HTTPS / tunnel deploy. The systemd unit's built-in
      # default is 127.0.0.1; THIS value overrides it (the unit's EnvironmentFile=-data/.env).
      # If local HTTPS is later enabled, orwell-https.sh idempotently re-pins this to 127.0.0.1.
      echo "ORWELL_BIND_HOST=${ORWELL_BIND_HOST}"
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
      # NPC campaigns (0085): the live game runs the strategic-campaign layer (hidden, adaptive
      # agendas that tilt nominations/votes — engine-tallied, Vault-sealed). DEFAULT OFF in code so
      # the seeded calibration gates stay byte-identical; the deploy opts in here.
      echo "ORWELL_CAMPAIGNS=1"
      # B2 (2026-07-05 activation): the rest of the built "living house" behavioral-fidelity layers
      # that shipped OPT-IN behind their own env flag but were never wired into the deploy — so on a
      # stock box no relationship arcs curdled (0087), no trigger secrets erupted (0091), no dormant
      # secret drip-fed on a paced cadence (0092), no jury grudges accumulated (0100), and no seeded
      # pre-show ties ever surfaced (0059 §5). Each ships its OWN calibration-neutral-when-off gate,
      # and all five + campaigns were heavy-sim'd ON together (juryReach band + calibrationGradient
      # active≥passive both hold). DEFAULT OFF in code so the seeded gates stay byte-identical; the
      # deploy opts in here. The God-Mode "Living house" dial (setBehavioralFlags) overrides any of
      # these per-sandbox at runtime; /health's `flags` block reports the boot state.
      echo "ORWELL_TRAJECTORIES=1"
      echo "ORWELL_TRIGGERS=1"
      echo "ORWELL_SECRET_PACING=1"
      echo "ORWELL_JURY_HOUSE=1"
      echo "ORWELL_SEEDED_TIE_SURFACING=1"
      # Strategic-drive off-screen cadence (0120): sharper/more-strategic houseguests initiate the
      # hidden off-screen scheming a touch more often (a slight, bounded variance — never a wild skew).
      # DEFAULT OFF in code so the seeded gates stay byte-identical; the deploy opts in here.
      echo "ORWELL_STRATEGIC_CADENCE=1"
      # Deeper, daily NPC confessionals (0122): the five triggered facets (plan / standing / grudge /
      # conversation aftermath / adjacent move) + the once-per-in-game-day sweep where most living NPCs
      # confess unless their game is bare. Vault-only (sealed from player + admin, unchanged from 0040).
      # DEFAULT OFF in code (+ additionally gated on the live in-game clock, pinned off in the golden
      # driver) so the seeded gates + golden fixture stay byte-identical; the deploy opts in here.
      echo "ORWELL_CONFESSIONAL_DEPTH=1"
      # Deal depth (0121): the two ACTIVE-obligation deal kinds (comp-throw / veto-save) + the reliability
      # rewards (loyalty streak, reliable-ally protection, and the diffusing "keeps their word" reputation).
      # DEFAULT OFF in code (+ pinned off in the golden driver so the fixture stays byte-identical); the FE
      # flag-gates the two new makeDeal kinds off /health's `flags.dealDepth`. The deploy opts in here.
      echo "ORWELL_DEAL_DEPTH=1"
      # NPC-initiated deal offers (0123): a motivated houseguest floats the player a deal at a lull
      # (accept => a real deal via the same spine; decline => a small hidden cooling). Grounded, Vault-safe,
      # bounded. DEFAULT OFF in code (+ only ever acts at a lull) so the seeded gates stay byte-identical;
      # the deploy opts in here.
      echo "ORWELL_NPC_DEAL_OFFERS=1"
      # Deeper character evolution (0124): independent distress/confidence axes, strategic-temperament
      # drift (a burned houseguest hardens, mean-reverting), and disposition-tuned reactivity (temperamental
      # houseguests are more sensitive + settle slower). Hidden layer only, CHARACTER byte-stable. DEFAULT
      # OFF in code so the seeded gates stay byte-identical; the deploy opts in here.
      echo "ORWELL_SOUL_DEPTH=1"
      # NPC competition intent (0006b, PO review 2026-06-28): in the live game every NPC carries a
      # derived compete/throw/play-safe intent (a nominee fights; a lay-low houseguest with a strong
      # ally throws to hand them power; a cautious target plays safe). DEFAULT OFF in code so the seeded
      # calibration gates stay byte-identical; the deploy opts in here.
      echo "ORWELL_COMP_INTENT=1"
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
  # data/.env is also the source of truth for the bind host (the unit reads it via EnvironmentFile).
  # On a re-run after HTTPS was enabled, .env holds 127.0.0.1 — the banner must reflect THAT, not
  # the env-supplied value — so read it back here.
  EFFECTIVE_BIND_HOST="$(sed -n 's/^ORWELL_BIND_HOST=//p' "${DATA_DIR}/.env" | tail -n1)"
  EFFECTIVE_BIND_HOST="${EFFECTIVE_BIND_HOST:-$ORWELL_BIND_HOST}"
  if [[ "$EFFECTIVE_PORT" != "$ORWELL_PORT" ]]; then
    echo "NOTE: data/.env pins ORWELL_PORT=${EFFECTIVE_PORT} (the env-supplied ${ORWELL_PORT} is ignored on a re-run; edit data/.env to change it)"
  fi
}

ownership() {
  step "least-privilege user (B72/ops A5)"
  id -u orwell >/dev/null 2>&1 || useradd -r -s /usr/sbin/nologin -d /opt/orwell orwell
  mkdir -p "${DATA_DIR}/saves" "${APP_DIR}/frontend/data"
  # DEPLOY-9: the backup DIR must exist and be orwell-writable before orwell-backup.timer's first
  # scheduled run (orwell-backup.service runs as User=orwell) — created here so the chown -R below
  # covers it, same as every other app-owned directory.
  mkdir -p "${APP_DIR}/backups"
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
  # The local-HTTPS trigger (admin "Local HTTPS" card, feature 0074) appends to its own live log,
  # tailed by the same viewer. Touched, never `install`ed (keep the run history).
  touch "${DATA_DIR}/ops-tls.log"
  chmod 644 "${DATA_DIR}/ops-tls.log"
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
  # Same G19b seam for the admin "Local HTTPS" card (feature 0074 / ADR 0014): the web tier drops the
  # flag data/ops/tls-requested and this root-side PATH unit runs the one fixed local-HTTPS script
  # (orwell-ops-tls.sh → orwell-https.sh — .env upsert + caddy install/run + Caddyfile + FE restart +
  # DNS-token shred), output appended live to data/ops-tls.log.
  install -m 644 "${APP_DIR}/deploy/systemd/orwell-ops-tls.path"    /etc/systemd/system/orwell-ops-tls.path
  install -m 644 "${APP_DIR}/deploy/systemd/orwell-ops-tls.service" /etc/systemd/system/orwell-ops-tls.service
  # DEPLOY-9: a daily backup + retention prune (orwell-backup.sh already handles the pruning; the
  # timer just supplies the schedule). No [Install] on the .service — same pattern as the ops
  # triggers above — only the .timer is ever enabled directly.
  install -m 644 "${APP_DIR}/deploy/systemd/orwell-backup.service" /etc/systemd/system/orwell-backup.service
  install -m 644 "${APP_DIR}/deploy/systemd/orwell-backup.timer"   /etc/systemd/system/orwell-backup.timer

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
  systemctl enable --now orwell-ops-update.path orwell-ops-factory-reset.path orwell-ops-update-reset.path orwell-ops-public-deployment.path orwell-ops-tls.path
  # DEPLOY-9: enable the backup TIMER (never the .service directly — no [Install] section, same
  # as the ops path units above).
  systemctl enable --now orwell-backup.timer
  # `enable --now` is a no-op on already-running units — a re-run must pick up the fresh build
  # and any unit/drop-in change, so restart explicitly (cheap on first install: just started).
  systemctl restart orwell-engine orwell-frontend orwell-ops-update.path orwell-ops-factory-reset.path orwell-ops-update-reset.path orwell-ops-public-deployment.path orwell-ops-tls.path
  # Restarting the timer just resets its next-fire countdown (harmless) — it does NOT run a
  # backup immediately, so a re-run/update never triggers an out-of-schedule snapshot.
  systemctl restart orwell-backup.timer
}

log_management() {
  # DEPLOY-13 (2026-07-05 ops-hygiene close-out): the five G19b ops-*.log files
  # (data/ops-update.log, ops-factory-reset.log, ops-update-reset.log, ops-public-deployment.log,
  # ops-tls.log) are appended forever with no rotation. Install the shipped logrotate config
  # verbatim (idempotent — logrotate.d configs are just files, safe to overwrite on a re-run).
  step "log rotation (DEPLOY-13)"
  install -m 644 "${APP_DIR}/deploy/logrotate/orwell" /etc/logrotate.d/orwell

  # DEPLOY-14 (2026-07-05 ops-hygiene close-out): journald has no size cap for the two
  # long-running services on the same disk — Debian ships persistent journal storage on by
  # default with only journald's own (often multi-GB) default as the ceiling. A conservative
  # cap sized to the LXC's disk; SIZE is overridable (e.g. a bigger custom DISK_GB deploy).
  # `journalctl --vacuum-size` is applied by `systemctl restart systemd-journald` picking up the
  # new SystemMaxUse= at next rotation — no immediate destructive vacuum here.
  local journal_cap="${ORWELL_JOURNAL_MAX_USE:-300M}"
  mkdir -p /etc/systemd/journald.conf.d
  cat > /etc/systemd/journald.conf.d/orwell.conf <<EOF
# Written by orwell-install.sh (DEPLOY-14): cap persistent journal storage so orwell-engine /
# orwell-frontend's continuous logging can't slow-burn toward disk exhaustion on a small LXC
# disk. Override by editing this file and running: systemctl restart systemd-journald
[Journal]
SystemMaxUse=${journal_cap}
EOF
  systemctl restart systemd-journald 2>/dev/null || true
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

  # `pct enter` minimal login shells omit /usr/local/bin from PATH, so `orwell` isn't found.
  # Drop an idempotent profile.d snippet that ensures it's on PATH for login shells.
  if [ ! -f /etc/profile.d/orwell-path.sh ]; then
    cat > /etc/profile.d/orwell-path.sh <<'PATHSH'
# orwell: ensure /usr/local/bin is on PATH (pct enter minimal login shells omit it)
case ":${PATH}:" in *:/usr/local/bin:*) ;; *) PATH="/usr/local/bin:${PATH}" ;; esac
PATHSH
    chmod 0644 /etc/profile.d/orwell-path.sh
  fi
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
  log_management
  login_panel
  verify_install

  # A browsable address, not 0.0.0.0 (a real operator was pointed at the wrong host by the old
  # message). hostname -I is the container's address; fall back if it's somehow empty.
  local ip
  ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  echo
  echo "${C_GRN}╶───────────────────────────────────────────────────────────╴${C_OFF}"
  echo "  ${C_BOLD}${C_GRN}orwell is installed and running.${C_OFF}"
  if [[ "${EFFECTIVE_BIND_HOST:-0.0.0.0}" == "127.0.0.1" ]]; then
    # Loopback bind (proxy/HTTPS/tunnel): the LAN IP is refused — advertise loopback, not the IP.
    echo "  ${C_BOLD}play:${C_OFF}    http://127.0.0.1:${EFFECTIVE_PORT}   ${C_DIM}(loopback — reach it via your reverse proxy / HTTPS / tunnel)${C_OFF}"
  else
    echo "  ${C_BOLD}play:${C_OFF}    http://${ip:-<container-ip>}:${EFFECTIVE_PORT}"
  fi
  echo "  ${C_DIM}app:${C_OFF}     ${APP_DIR}   ${C_DIM}data:${C_OFF} ${DATA_DIR}"
  echo "  ${C_DIM}manage:${C_OFF}  ${C_BOLD}orwell${C_OFF} ${C_DIM}(control panel)${C_OFF}   ${C_DIM}health:${C_OFF} orwell-panel"
  echo "${C_GRN}╶───────────────────────────────────────────────────────────╴${C_OFF}"
}

main "$@"
