#!/usr/bin/env bash
#
# bbai — one-liner Proxmox LXC installer.
#
# On the Proxmox host shell:
#   bash -c "$(curl -fsSL https://raw.githubusercontent.com/kevinhirsch/bbai/main/deploy/bbai.sh)"
#
# Creates an LXC and installs bbai — the TypeScript engine (MCP server) and the odysseus
# front-end — as systemd services. The engine uses the standard contract `npm run build` /
# `npm start`; the in-container installer verifies that contract before building. See
# deploy/README.md.
set -euo pipefail

# ── Defaults (override via env) ─────────────────────────────────────────────────────────────
CTID="${CTID:-$(pvesh get /cluster/nextid 2>/dev/null || echo 900)}"
CT_HOSTNAME="${CT_HOSTNAME:-bbai}"
DISK_GB="${DISK_GB:-8}"
RAM_MB="${RAM_MB:-2048}"
CORES="${CORES:-2}"
BRIDGE="${BRIDGE:-vmbr0}"
TEMPLATE="${TEMPLATE:-local:vztmpl/debian-12-standard_12.7-1_amd64.tar.zst}"
STORAGE="${STORAGE:-local-lvm}"
REPO="${REPO:-https://github.com/kevinhirsch/bbai.git}"
BRANCH="${BRANCH:-main}"
BBAI_PORT="${BBAI_PORT:-8080}"

echo "==> Creating LXC ${CTID} (${CT_HOSTNAME}): ${CORES} cores / ${RAM_MB}MB / ${DISK_GB}GB on ${STORAGE}"
# Optional: source community-scripts build.func for the full UX (storage/template/network prompts).
pct create "$CTID" "$TEMPLATE" \
  --hostname "$CT_HOSTNAME" \
  --cores "$CORES" --memory "$RAM_MB" \
  --rootfs "${STORAGE}:${DISK_GB}" \
  --net0 "name=eth0,bridge=${BRIDGE},ip=dhcp" \
  --features nesting=1 \
  --unprivileged 1 \
  --onboot 1
pct start "$CTID"
sleep 5

echo "==> Running in-container install"
pct exec "$CTID" -- bash -c \
  "export REPO='${REPO}' BRANCH='${BRANCH}' BBAI_PORT='${BBAI_PORT}'; \
   bash <(curl -fsSL https://raw.githubusercontent.com/kevinhirsch/bbai/${BRANCH}/deploy/bbai-install.sh)"

IP="$(pct exec "$CTID" -- bash -c "hostname -I | awk '{print \$1}'" 2>/dev/null || echo '<container-ip>')"
echo "==> Done. bbai UI: http://${IP}:${BBAI_PORT}"
