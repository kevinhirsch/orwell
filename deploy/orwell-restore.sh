#!/usr/bin/env bash
#
# orwell-restore.sh (B72/ops A8) — restore a backup made by orwell-backup.sh.
# Stops the services, untars BOTH data dirs over the app, fixes ownership, restarts.
#
# Usage: orwell-restore.sh <backup.tar.gz>
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/orwell}"
BACKUP="${1:-}"
[[ -n "$BACKUP" && -f "$BACKUP" ]] || { echo "usage: orwell-restore.sh <backup.tar.gz>" >&2; exit 1; }

have_systemd=0
command -v systemctl >/dev/null 2>&1 && have_systemd=1
[[ "$have_systemd" -eq 1 ]] && systemctl stop orwell-frontend orwell-engine 2>/dev/null || true

tar -xzf "$BACKUP" -C "$APP_DIR"
id -u orwell >/dev/null 2>&1 && chown -R orwell:orwell "${APP_DIR}/data" "${APP_DIR}/frontend/data" 2>/dev/null || true

[[ "$have_systemd" -eq 1 ]] && systemctl start orwell-engine orwell-frontend 2>/dev/null || true
echo "restore complete from ${BACKUP}"
