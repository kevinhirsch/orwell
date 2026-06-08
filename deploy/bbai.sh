#!/usr/bin/env bash
#
# bbai — one-liner Proxmox LXC installer.
#
# On the Proxmox host shell:
#   bash -c "$(curl -fsSL https://raw.githubusercontent.com/kevinhirsch/bbai/main/deploy/bbai.sh)"
#
# Creates a Debian LXC and installs bbai — the TypeScript engine (MCP server) and the odysseus
# front-end — as systemd services (engine contract: `npm run build` / `npm start`).
#
# UX: a community-scripts-style config menu (Use Defaults vs Advanced) with every field
# pre-populated, shown when run on a TTY; otherwise it runs non-interactively with defaults.
# Every setting can also be supplied / overridden via env, e.g.:
#   CTID=104 CORES=4 RAM_MB=4096 DISK_GB=12 STORAGE=local-lvm BRANCH=main \
#     bash -c "$(curl -fsSL .../deploy/bbai.sh)"
# Pass --default (or set USE_DEFAULTS=1 / BBAI_NONINTERACTIVE=1) to skip the menu.
set -euo pipefail

TITLE="bbai installer"
msg()  { echo -e "==> $*"; }
die()  { echo "ERROR: $*" >&2; exit 1; }

case "${1:-}" in
  -h|--help)
    sed -n '3,16p' "${BASH_SOURCE[0]:-/dev/null}" 2>/dev/null | sed 's/^# \{0,1\}//'
    exit 0 ;;
  -d|--default|--defaults) USE_DEFAULTS=1 ;;
esac

[[ "$(id -u)" -eq 0 ]] || die "run this on the Proxmox host as root."
command -v pct   >/dev/null 2>&1 || die "this must run on a Proxmox VE host (pct not found)."
command -v pveam >/dev/null 2>&1 || die "this must run on a Proxmox VE host (pveam not found)."

# ── Helpers ──────────────────────────────────────────────────────────────────────────────────
# First active storage that supports a content type (rootdir for the CT rootfs, vztmpl for the
# template). Empty if none — callers fall back to a sensible literal.
storage_for() { pvesm status --content "$1" 2>/dev/null | awk 'NR>1 && $3=="active"{print $1; exit}' || true; }

# Newest debian-12-standard template names available in the appliance catalog (oldest→newest).
available_debian12() {
  pveam available --section system 2>/dev/null | awk '{print $2}' \
    | grep -E '^debian-12-standard' | sort -V || true
}

interactive() {
  [[ -t 0 && -t 1 ]] && command -v whiptail >/dev/null 2>&1 \
    && [[ -z "${BBAI_NONINTERACTIVE:-}" && -z "${USE_DEFAULTS:-}" ]]
}

wt_input() {  # var "prompt" default
  local __var="$1" __val
  __val="$(whiptail --title "$TITLE" --inputbox "$2" 10 72 "$3" 3>&1 1>&2 2>&3)" || die "cancelled."
  printf -v "$__var" '%s' "${__val:-$3}"
}

wt_pick_storage() {  # var content default
  local __var="$1" content="$2" def="$3" rows args=() s sel
  mapfile -t rows < <(pvesm status --content "$content" 2>/dev/null | awk 'NR>1{print $1}')
  if [[ ${#rows[@]} -le 1 ]]; then printf -v "$__var" '%s' "${rows[0]:-$def}"; return; fi
  for s in "${rows[@]}"; do args+=("$s" "$content"); done
  sel="$(whiptail --title "$TITLE" --default-item "$def" --menu \
        "Select storage for: $content" 18 60 8 "${args[@]}" 3>&1 1>&2 2>&3)" || die "cancelled."
  printf -v "$__var" '%s' "$sel"
}

wt_pick_template() {  # advanced-mode OS template chooser (newest highlighted)
  msg "refreshing template catalog"; pveam update >/dev/null 2>&1 || true
  local rows args=() t sel
  mapfile -t rows < <(available_debian12)
  [[ ${#rows[@]} -gt 0 ]] || return 0
  for t in "${rows[@]}"; do args+=("$t" ""); done
  sel="$(whiptail --title "$TITLE" --default-item "${TEMPLATE_NAME:-${rows[-1]}}" --menu \
        "OS template" 20 78 10 "${args[@]}" 3>&1 1>&2 2>&3)" || die "cancelled."
  TEMPLATE_NAME="$sel"
}

wt_pick_llm() {  # writes the LLM provider into the container's data/.env (never committed)
  local choice
  choice="$(whiptail --title "$TITLE" --default-item none --menu \
    "LLM provider (stored only in the container's data/.env)" 14 72 3 \
    none      "Configure later" \
    anthropic "Anthropic API key" \
    ollama    "Ollama host URL" 3>&1 1>&2 2>&3)" || die "cancelled."
  case "$choice" in
    anthropic) wt_input ANTHROPIC_API_KEY "Anthropic API key" "${ANTHROPIC_API_KEY:-}" ;;
    ollama)    wt_input OLLAMA_HOST       "Ollama host URL"    "${OLLAMA_HOST:-http://127.0.0.1:11434}" ;;
  esac
}

# ── Defaults (env overrides everything; auto-detected where it matters) ────────────────────────
CTID="${CTID:-$(pvesh get /cluster/nextid 2>/dev/null || echo 900)}"
CT_HOSTNAME="${CT_HOSTNAME:-bbai}"
CORES="${CORES:-2}"
RAM_MB="${RAM_MB:-2048}"
DISK_GB="${DISK_GB:-8}"
BRIDGE="${BRIDGE:-vmbr0}"
NET="${NET:-dhcp}"                 # "dhcp" or a static CIDR, e.g. 192.168.1.50/24
GATEWAY="${GATEWAY:-}"             # required only for a static NET
STORAGE="${STORAGE:-$(storage_for rootdir)}";          STORAGE="${STORAGE:-local-lvm}"
TEMPLATE_STORAGE="${TEMPLATE_STORAGE:-$(storage_for vztmpl)}"; TEMPLATE_STORAGE="${TEMPLATE_STORAGE:-local}"
REPO="${REPO:-https://github.com/kevinhirsch/bbai.git}"
BRANCH="${BRANCH:-main}"
BBAI_PORT="${BBAI_PORT:-8080}"
ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-}"
OLLAMA_HOST="${OLLAMA_HOST:-}"

# An explicit TEMPLATE=storage:vztmpl/name override splits into storage + name; otherwise the
# newest debian-12-standard is resolved (and downloaded) below.
TEMPLATE_NAME="${TEMPLATE_NAME:-}"
if [[ -n "${TEMPLATE:-}" ]]; then
  TEMPLATE_STORAGE="${TEMPLATE%%:*}"
  TEMPLATE_NAME="${TEMPLATE##*/}"
fi

# ── Config menu (community-scripts style: Defaults vs Advanced, fields pre-populated) ───────────
if interactive; then
  if whiptail --title "$TITLE" --yes-button "Use Defaults" --no-button "Advanced" --yesno \
      "Create a Debian LXC and install bbai.\n\nDefaults:\n  CTID ${CTID}  ·  ${CORES} cores  ·  ${RAM_MB} MB  ·  ${DISK_GB} GB\n  rootfs storage ${STORAGE}  ·  bridge ${BRIDGE}  ·  net ${NET}\n  UI port ${BBAI_PORT}  ·  branch ${BRANCH}\n\nUse these defaults, or configure advanced settings?" 20 72; then
    : # keep defaults
  else
    wt_input CTID        "Container ID (CTID)"                        "$CTID"
    wt_input CT_HOSTNAME "Hostname"                                   "$CT_HOSTNAME"
    wt_input CORES       "CPU cores"                                  "$CORES"
    wt_input RAM_MB      "RAM (MB)"                                   "$RAM_MB"
    wt_input DISK_GB     "Disk (GB)"                                  "$DISK_GB"
    wt_pick_storage  STORAGE          rootdir "$STORAGE"
    wt_pick_storage  TEMPLATE_STORAGE vztmpl  "$TEMPLATE_STORAGE"
    wt_input BRIDGE      "Network bridge"                             "$BRIDGE"
    wt_input NET         "IP — 'dhcp' or CIDR (e.g. 192.168.1.50/24)" "$NET"
    [[ "$NET" != "dhcp" ]] && wt_input GATEWAY "Gateway (for the static IP)" "${GATEWAY:-}"
    wt_input BBAI_PORT   "bbai UI port"                               "$BBAI_PORT"
    wt_input BRANCH      "Git branch"                                 "$BRANCH"
    wt_pick_template
    wt_pick_llm
  fi
fi

# ── Resolve + download the OS template (the fix for the original failure) ───────────────────────
ensure_template() {
  if [[ -z "$TEMPLATE_NAME" ]]; then
    msg "resolving newest debian-12-standard template"
    pveam update >/dev/null 2>&1 || true
    TEMPLATE_NAME="$(available_debian12 | tail -n1)"
  fi
  # Offline fallback: newest debian-12-standard already present on the template storage.
  if [[ -z "$TEMPLATE_NAME" ]]; then
    TEMPLATE_NAME="$(pveam list "$TEMPLATE_STORAGE" 2>/dev/null | awk '{print $1}' \
      | sed 's#.*/##' | grep -E '^debian-12-standard' | sort -V | tail -n1 || true)"
  fi
  [[ -n "$TEMPLATE_NAME" ]] || die "no debian-12-standard template available or downloaded — check internet / 'pveam available'."
  if ! pveam list "$TEMPLATE_STORAGE" 2>/dev/null | grep -qF "$TEMPLATE_NAME"; then
    msg "downloading template ${TEMPLATE_NAME} → ${TEMPLATE_STORAGE} (first run only)"
    pveam download "$TEMPLATE_STORAGE" "$TEMPLATE_NAME"
  fi
  TEMPLATE="${TEMPLATE_STORAGE}:vztmpl/${TEMPLATE_NAME}"
}
ensure_template

# ── Create + start the container ───────────────────────────────────────────────────────────────
# NET0 may be passed as a raw pct net0 string (e.g. "name=eth0,bridge=vmbr0,ip=dhcp") to
# bypass the helpers; otherwise it's constructed from NET ("dhcp" or CIDR), BRIDGE, GATEWAY.
if [[ -n "${NET0:-}" ]]; then
  : # raw passthrough — use as-is
elif [[ "${NET:-dhcp}" =~ ^name= ]] || [[ "${NET:-dhcp}" =~ bridge= ]]; then
  NET0="${NET}"  # caller already supplied a full net0 option string via NET=
elif [[ "${NET:-dhcp}" == "dhcp" ]]; then
  NET0="name=eth0,bridge=${BRIDGE},ip=dhcp"
else
  NET0="name=eth0,bridge=${BRIDGE},ip=${NET}${GATEWAY:+,gw=${GATEWAY}}"
fi

msg "config: CTID=${CTID} CORES=${CORES} RAM_MB=${RAM_MB} DISK_GB=${DISK_GB} STORAGE=${STORAGE} TEMPLATE=${TEMPLATE} NET=${NET0} PORT=${BBAI_PORT} BRANCH=${BRANCH}"
msg "creating LXC ${CTID} (${CT_HOSTNAME})"
pct create "$CTID" "$TEMPLATE" \
  --hostname "$CT_HOSTNAME" \
  --cores "$CORES" --memory "$RAM_MB" \
  --rootfs "${STORAGE}:${DISK_GB}" \
  --net0 "$NET0" \
  --features nesting=1 \
  --unprivileged 1 \
  --onboot 1
pct start "$CTID"

# Wait for a network address (DHCP lease) before running the in-container install.
msg "waiting for the container network"
IP=""
for _ in $(seq 1 30); do
  IP="$(pct exec "$CTID" -- bash -c "hostname -I 2>/dev/null | awk '{print \$1}'" 2>/dev/null || true)"
  [[ -n "$IP" ]] && break
  sleep 2
done
[[ -n "$IP" ]] || IP="<container-ip>"

# ── In-container install (LLM config, if any, is passed through and lands in data/.env) ─────────
# The fresh container has no curl yet, so download bbai-install.sh on the host (which always
# has curl) and push it in via pct — no chicken-and-egg bootstrap problem.
msg "running in-container install"
TMP_INSTALL="$(mktemp /tmp/bbai-install-XXXXXX.sh)"
curl -fsSL "https://raw.githubusercontent.com/kevinhirsch/bbai/${BRANCH}/deploy/bbai-install.sh" -o "$TMP_INSTALL"
pct push "$CTID" "$TMP_INSTALL" /tmp/bbai-install.sh
rm -f "$TMP_INSTALL"
pct exec "$CTID" -- bash -c \
  "export REPO='${REPO}' BRANCH='${BRANCH}' BBAI_PORT='${BBAI_PORT}' \
          ANTHROPIC_API_KEY='${ANTHROPIC_API_KEY}' OLLAMA_HOST='${OLLAMA_HOST}'; \
   bash /tmp/bbai-install.sh"

msg "done. bbai UI: http://${IP}:${BBAI_PORT}"
