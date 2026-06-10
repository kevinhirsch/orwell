#!/usr/bin/env bash
#
# orwell-backup.sh (B72/ops A8) — back up EVERYTHING a game owns, correctly.
#
# The state lives in TWO places (the layout the old prose misstated):
#   <app>/data/            engine config (.env incl. the generated token) + saves/ (per-user games)
#   <app>/frontend/data/   the front-end SQLite (accounts, chats, settings) + uploads
#
# Usage:  orwell-backup.sh [dest-dir]      (default: <app>/backups)
# Output: orwell-backup-YYYYmmdd-HHMMSS.tar.gz — restore with orwell-restore.sh.
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/orwell}"
[[ -d "$APP_DIR" ]] || { echo "ERROR: app dir ${APP_DIR} not found (set APP_DIR=...)" >&2; exit 1; }
DEST="${1:-${APP_DIR}/backups}"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="${DEST}/orwell-backup-${STAMP}.tar.gz"

mkdir -p "$DEST"
# A consistent snapshot does not strictly require stopping the services (saves are atomic files,
# SQLite is journaled), but quiescing is safest when available.
tar -czf "$OUT" -C "$APP_DIR" \
  $( [[ -d "${APP_DIR}/data" ]] && echo "data" ) \
  $( [[ -d "${APP_DIR}/frontend/data" ]] && echo "frontend/data" )
chmod 600 "$OUT"
echo "backup written: ${OUT}"
echo "contents: <app>/data (engine .env + saves) + <app>/frontend/data (FE SQLite + uploads)"
