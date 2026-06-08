#!/usr/bin/env bash
#
# bbai — one-liner Proxmox LXC installer (DRAFT scaffold).
#
# On the Proxmox host shell:
#   bash -c "$(curl -fsSL https://raw.githubusercontent.com/kevinhirsch/bbai/main/deploy/bbai.sh)"
#
# STATUS: DRAFT. The engine build/start entrypoint (feature 0009) and the front-end wiring are
# not finished, so the app build/run steps are TODO. This scaffold provisions the container and
# lays down the structure. It refuses to run until BBAI_ALLOW_DRAFT=1 so nobody half-installs a
# not-yet-runnable build. See deploy/README.md.
set -euo pipefail

# ── DRAFT guard ───────────────────────────────────────────────────────────────────────────
if [[ "${BBAI_ALLOW_DRAFT:-0}" != "1" ]]; then
  echo "bbai deploy is a DRAFT scaffold — not yet functional."
  echo "Pending (MVP-1 critical path): engine 'npm run build'/start entrypoint (feature 0009)"
  echo "and the odysseus front-end wiring (frontend/INTEGRATION.md)."
  echo "To run the scaffold anyway (it will stop at the TODO app-build steps): BBAI_ALLOW_DRAFT=1"
  exit 1
fi

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
# TODO(0010): optionally source community-scripts build.func for the full UX
#   (storage/template/network prompts). Kept self-contained here for clarity.
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
echo "==> Done. Once the app build/run steps (TODO 0009 + wiring) are filled in, bbai will be at:"
echo "    http://${IP}:${BBAI_PORT}"
