#!/usr/bin/env bash
#
# orwell — factory reset. Scrubs ALL game + user data back to a fresh-install (OOBE) state:
# every per-user game sandbox (saves, souls, the hidden Vault layer), the front-end database
# (accounts, sessions, settings) and its data files — then restarts the services so the next
# visit begins at first-run onboarding, exactly as after a fresh install.
#
# Install-time CONFIG is PRESERVED: the engine data/.env (ports, engine URL, LLM keys) stays,
# so the box still boots and can still reach your LLM. Only DATA is removed.
#
# Run inside the container as root:
#   bash /opt/orwell/deploy/orwell-factory-reset.sh             # prompts to confirm
#   bash /opt/orwell/deploy/orwell-factory-reset.sh --yes       # no prompt (automation)
#   bash /opt/orwell/deploy/orwell-factory-reset.sh --dry-run   # show what WOULD be removed
#   bash /opt/orwell/deploy/orwell-factory-reset.sh --no-restart # scrub but leave services down
#
# Paths/services are overridable via env: APP_DIR, ORWELL_DATA_DIR, ORWELL_FE_DATA_DIR,
# ORWELL_ENGINE_SVC, ORWELL_FRONTEND_SVC (handy for a dev checkout).
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/orwell}"
DATA_DIR="${ORWELL_DATA_DIR:-${DATA_DIR:-${APP_DIR}/data}}"          # engine saves + .env (config)
FE_DATA_DIR="${ORWELL_FE_DATA_DIR:-${APP_DIR}/frontend/data}"       # SQLite DB + .app_key + app data
ENGINE_SVC="${ORWELL_ENGINE_SVC:-orwell-engine}"
FRONTEND_SVC="${ORWELL_FRONTEND_SVC:-orwell-frontend}"
ENV_KEEP=".env"                                                     # preserved in DATA_DIR

msg()  { echo -e "==> $*"; }
warn() { echo -e "WARN: $*" >&2; }
die()  { echo "ERROR: $*" >&2; exit 1; }

ASSUME_YES=0; DRY_RUN=0; RESTART=1
while [[ $# -gt 0 ]]; do
  case "$1" in
    -y|--yes)     ASSUME_YES=1 ;;
    -n|--dry-run) DRY_RUN=1 ;;
    --no-restart) RESTART=0 ;;
    -h|--help)    sed -n '3,19p' "${BASH_SOURCE[0]:-/dev/null}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *)            die "unknown option: $1 (try --help)" ;;
  esac
  shift
done

# ── Safety: never operate on an empty, root, or too-shallow path ──────────────────────────────
sanity_path() {  # path label
  local raw="$1" label="$2" p depth
  [[ -n "$raw" ]]    || die "${label} is empty — refusing to scrub."
  [[ "$raw" == /* ]] || die "${label} must be absolute (got '${raw}')."
  [[ "$raw" != "/" ]] || die "${label} is '/' — refusing."
  p="${raw%/}"
  depth="$(awk -F/ '{print NF-1}' <<<"$p")"
  [[ "${depth}" -ge 2 ]] || die "${label} '${raw}' is too shallow — refusing (need e.g. /opt/orwell/...)."
}
sanity_path "$DATA_DIR"    "engine DATA_DIR"
sanity_path "$FE_DATA_DIR" "front-end FE_DATA_DIR"

# ── Environment detection ─────────────────────────────────────────────────────────────────────
have_systemd=0
if command -v systemctl >/dev/null 2>&1 && [[ -d /run/systemd/system ]]; then have_systemd=1; fi
svc_exists() { systemctl list-unit-files "${1}.service" --no-legend 2>/dev/null | grep -q .; }

if [[ "$DRY_RUN" -eq 0 && "$(id -u)" -ne 0 ]]; then
  if [[ "$DATA_DIR" == /opt/* || "$FE_DATA_DIR" == /opt/* || "$have_systemd" -eq 1 ]]; then
    die "run as root (sudo): needs to stop services and remove ${DATA_DIR} / ${FE_DATA_DIR}."
  fi
fi

sandbox_count() { [[ -d "$DATA_DIR" ]] && find "$DATA_DIR" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l | tr -d ' ' || echo 0; }
SANDBOXES="$(sandbox_count)"

# ── Confirmation (skipped by --yes / --dry-run) ───────────────────────────────────────────────
if [[ "$DRY_RUN" -eq 0 && "$ASSUME_YES" -eq 0 ]]; then
  cat <<EOF
This PERMANENTLY DELETES all orwell game + user data:
  • ${SANDBOXES} game sandbox(es)  under ${DATA_DIR}/<user>/   (saves, souls, hidden Vault layer)
  • the entire front-end store     ${FE_DATA_DIR}/             (database, settings, uploads, app key)
Preserved (config only):           ${DATA_DIR}/${ENV_KEEP}
The next visit will start at first-run onboarding (OOBE).
EOF
  read -r -p "Type 'RESET' to proceed: " ans
  [[ "$ans" == "RESET" ]] || die "aborted — no changes made."
fi

# ── Helpers (dry-run aware) ───────────────────────────────────────────────────────────────────
do_rm()  { if [[ "$DRY_RUN" -eq 1 ]]; then echo "  would remove: $1"; else rm -rf -- "$1"; fi; }
do_svc() { # action svc
  if [[ "$DRY_RUN" -eq 1 ]]; then echo "  would: systemctl $1 $2"; else systemctl "$1" "$2" || warn "systemctl $1 $2 failed"; fi
}

# ── 1. Stop the services so nothing writes while we scrub ─────────────────────────────────────
if [[ "$have_systemd" -eq 1 ]]; then
  msg "stopping services"
  for svc in "$FRONTEND_SVC" "$ENGINE_SVC"; do svc_exists "$svc" && do_svc stop "$svc"; done
else
  warn "systemctl not present — skipping service stop (dev mode). Stop the app yourself first."
fi

# ── 2. Scrub the engine sandboxes (everything in DATA_DIR except the preserved .env) ──────────
msg "scrubbing engine sandboxes in ${DATA_DIR} (keeping ${ENV_KEEP})"
if [[ -d "$DATA_DIR" ]]; then
  while IFS= read -r -d '' entry; do do_rm "$entry"; done \
    < <(find "$DATA_DIR" -mindepth 1 -maxdepth 1 ! -name "$ENV_KEEP" -print0)
else
  warn "engine data dir ${DATA_DIR} absent — nothing to scrub"
fi

# ── 3. Scrub the front-end store (DB + key + settings + all data files); recreate empty ──────
msg "scrubbing front-end data store ${FE_DATA_DIR}"
if [[ -d "$FE_DATA_DIR" ]]; then
  while IFS= read -r -d '' entry; do do_rm "$entry"; done \
    < <(find "$FE_DATA_DIR" -mindepth 1 -maxdepth 1 -print0)
fi
[[ "$DRY_RUN" -eq 1 ]] || mkdir -p "$FE_DATA_DIR"

# ── 4. Restart so the app re-initialises a fresh DB and lands at OOBE ─────────────────────────
if [[ "$RESTART" -eq 1 && "$have_systemd" -eq 1 ]]; then
  msg "restarting services"
  for svc in "$ENGINE_SVC" "$FRONTEND_SVC"; do svc_exists "$svc" && do_svc start "$svc"; done
elif [[ "$RESTART" -eq 0 ]]; then
  msg "left services stopped (--no-restart). Start them when ready."
fi

if [[ "$DRY_RUN" -eq 1 ]]; then
  msg "dry run complete — nothing was removed."
else
  msg "factory reset complete. Open the UI: it will begin at first-run onboarding (OOBE)."
fi
