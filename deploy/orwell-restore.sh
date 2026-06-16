#!/usr/bin/env bash
#
# orwell-restore.sh (B72/ops A8) — restore a backup made by orwell-backup.sh.
# Stops the services, untars BOTH data dirs over the app, fixes ownership, restarts.
#
# Usage: orwell-restore.sh <backup.tar.gz>
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/orwell}"
BACKUP="${1:-}"

# Optional whiptail TUI (deploy/orwell-tui.sh): on a TTY with no file given, pick from existing
# backups; otherwise the usage check below stands (automation must pass the file as $1).
__here="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd || true)"
for __lib in "${__here}/orwell-tui.sh" /opt/orwell/deploy/orwell-tui.sh /opt/bbai/deploy/orwell-tui.sh; do
  if [[ -n "${__lib:-}" && -r "$__lib" ]]; then . "$__lib"; break; fi
done
type tui_active >/dev/null 2>&1 || tui_active() { return 1; }

if [[ -z "$BACKUP" ]] && tui_active; then
  ORWELL_TUI_TITLE="Orwell — restore"
  __dir="${APP_DIR}/backups"
  mapfile -t __list < <(ls -1t "${__dir}"/orwell-backup-*.tar.gz 2>/dev/null)
  if [[ ${#__list[@]} -eq 0 ]]; then
    wt_msgbox "No backups found in:\n${__dir}\n\nCreate one first:  orwell backup"; exit 1
  fi
  __args=(); for __f in "${__list[@]}"; do __args+=("$__f" "$(date -r "$__f" '+%Y-%m-%d %H:%M' 2>/dev/null || echo '')"); done
  wt_menu BACKUP "Choose a backup to restore:" "${__args[@]}" || { echo "cancelled."; exit 0; }
  wt_yesno "Restore from:\n${BACKUP}\n\nThis STOPS the services and OVERWRITES the current engine + front-end data with the backup, then restarts." --defaultno || { echo "cancelled."; exit 0; }
fi

[[ -n "$BACKUP" && -f "$BACKUP" ]] || { echo "usage: orwell-restore.sh <backup.tar.gz>" >&2; exit 1; }

have_systemd=0
command -v systemctl >/dev/null 2>&1 && have_systemd=1
[[ "$have_systemd" -eq 1 ]] && systemctl stop orwell-frontend orwell-engine 2>/dev/null || true

tar -xzf "$BACKUP" -C "$APP_DIR"
id -u orwell >/dev/null 2>&1 && chown -R orwell:orwell "${APP_DIR}/data" "${APP_DIR}/frontend/data" 2>/dev/null || true

[[ "$have_systemd" -eq 1 ]] && systemctl start orwell-engine orwell-frontend 2>/dev/null || true
echo "restore complete from ${BACKUP}"
