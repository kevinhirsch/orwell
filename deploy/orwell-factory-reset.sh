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
# Run on the Proxmox HOST or inside the container as root:
#   bash /path/to/orwell-factory-reset.sh             # prompts to confirm
#   bash /path/to/orwell-factory-reset.sh --yes       # no prompt (automation)
#   bash /path/to/orwell-factory-reset.sh --dry-run   # show what WOULD be removed
#   bash /path/to/orwell-factory-reset.sh --no-restart # scrub but leave services down
#
# On the Proxmox host the script locates the orwell LXC (by hostname "orwell"; override with
# CTID=<id> or CT_HOSTNAME=<name>) and re-runs itself inside it — same bridge as orwell-update.sh.
#
# Paths/services are overridable via env: APP_DIR, ORWELL_DATA_DIR, ORWELL_FE_DATA_DIR,
# ORWELL_ENGINE_SVC, ORWELL_FRONTEND_SVC (handy for a dev checkout).
set -euo pipefail

BRANCH="${BRANCH:-main}"
CT_HOSTNAME="${CT_HOSTNAME:-orwell}"
APP_DIR_EXPLICIT="${APP_DIR:-}"

msg()  { echo -e "==> $*"; }
warn() { echo -e "WARN: $*" >&2; }
die()  { echo "ERROR: $*" >&2; exit 1; }

# Collect flags so they can be forwarded to the in-container run.
ASSUME_YES=0; DRY_RUN=0; RESTART=1; EXTRA_FLAGS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    -y|--yes)        ASSUME_YES=1; EXTRA_FLAGS+=("--yes") ;;
    -n|--dry-run)    DRY_RUN=1;    EXTRA_FLAGS+=("--dry-run") ;;
    --no-restart)    RESTART=0;    EXTRA_FLAGS+=("--no-restart") ;;
    -h|--help)       sed -n '3,22p' "${BASH_SOURCE[0]:-/dev/null}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *)               die "unknown option: $1 (try --help)" ;;
  esac
  shift
done

# First install dir found: an explicit override, then the current path, then the legacy one.
find_app() {
  local d
  for d in "${APP_DIR_EXPLICIT:-}" /opt/orwell /opt/bbai; do
    [[ -n "$d" && -d "$d/.git" ]] && { printf '%s' "$d"; return 0; }
  done
  return 1
}

# ── Host → container bridge ────────────────────────────────────────────────────────────────────
# On a Proxmox host (pct present) the app lives inside the LXC — locate the orwell container and
# re-run this script inside it, forwarding all flags. Same pattern as orwell-update.sh.
# Inside the container pct does not exist (and the app dir does), so this block is skipped.
if command -v pct >/dev/null 2>&1 && ! find_app >/dev/null 2>&1; then
  CTID="${CTID:-$(pct list 2>/dev/null | awk -v n="$CT_HOSTNAME" 'NR>1 && $NF==n {print $1}' || true)}"
  [[ -n "$CTID" ]] || die "no orwell LXC found (hostname '${CT_HOSTNAME}'). Set CTID=<id> and retry."
  [[ "$(printf '%s' "$CTID" | wc -w)" -eq 1 ]] || die "multiple containers named '${CT_HOSTNAME}' (${CTID//$'\n'/ }). Set CTID=<id>."
  [[ "$(pct status "$CTID" 2>/dev/null)" == *running* ]] || die "LXC ${CTID} is not running — start it first: pct start ${CTID}"

  msg "orwell lives in LXC ${CTID}; running factory reset inside the container"
  TMP_RESET="$(mktemp /tmp/orwell-factory-reset-XXXXXX.sh)"
  curl -fsSL "https://raw.githubusercontent.com/kevinhirsch/orwell/${BRANCH}/deploy/orwell-factory-reset.sh" -o "$TMP_RESET"
  pct push "$CTID" "$TMP_RESET" /tmp/orwell-factory-reset.sh
  rm -f "$TMP_RESET"
  # --yes is forwarded; --dry-run is forwarded; --no-restart is forwarded.
  pct exec "$CTID" -- bash /tmp/orwell-factory-reset.sh "${EXTRA_FLAGS[@]:-}"
  exit 0
fi

# ── In-container (or direct) reset ─────────────────────────────────────────────────────────────
APP_DIR="$(find_app || true)"; APP_DIR="${APP_DIR:-/opt/orwell}"

# CONFIG dir: where the engine's EnvironmentFile (.env) lives — we PRESERVE .env here.
CONFIG_DIR="${ORWELL_CONFIG_DIR:-${APP_DIR}/data}"
ENV_FILE="${CONFIG_DIR}/.env"
ENV_KEEP=".env"

# ENGINE SAVE dir: where the game actually persists (saves + the hidden Vault layer).
# This is the crux of an earlier bug — the engine (src/adapters/engine/FileSaveStore.ts)
# writes per-user saves to ORWELL_DATA_DIR / BBAI_DATA_DIR, FALLING BACK to ./.orwell-data
# (relative to its WorkingDirectory = APP_DIR). The install never sets ORWELL_DATA_DIR, so
# the real save lives at <app>/.orwell-data — NOT <app>/data. Resolve it the same way the
# engine does: an explicit env override, then the .env, then the ./.orwell-data fallback.
env_val() { [[ -f "$ENV_FILE" ]] && grep -E "^[[:space:]]*${1}=" "$ENV_FILE" | tail -1 | cut -d= -f2- | sed 's/^[[:space:]]*//;s/[[:space:]]*$//;s/^["'\'']//;s/["'\'']$//;s/\r$//'; }
ENGINE_SAVE_DIR="${ORWELL_DATA_DIR:-}"
[[ -n "$ENGINE_SAVE_DIR" ]] || ENGINE_SAVE_DIR="$(env_val ORWELL_DATA_DIR || true)"
[[ -n "$ENGINE_SAVE_DIR" ]] || ENGINE_SAVE_DIR="$(env_val BBAI_DATA_DIR || true)"
[[ -n "$ENGINE_SAVE_DIR" ]] || ENGINE_SAVE_DIR="${APP_DIR}/.orwell-data"
# A relative ORWELL_DATA_DIR (e.g. ./.orwell-data) resolves against the engine CWD = APP_DIR.
[[ "$ENGINE_SAVE_DIR" == /* ]] || ENGINE_SAVE_DIR="${APP_DIR%/}/${ENGINE_SAVE_DIR#./}"

FE_DATA_DIR="${ORWELL_FE_DATA_DIR:-${APP_DIR}/frontend/data}"

# Service names follow the install: prefer orwell-*, fall back to legacy bbai-* units.
unit_exists() { systemctl list-unit-files "${1}.service" --no-legend 2>/dev/null | grep -q .; }
if [[ -z "${ORWELL_ENGINE_SVC:-}" ]]; then
  if unit_exists orwell-engine; then ENGINE_SVC="orwell-engine"; FRONTEND_SVC="orwell-frontend"
  elif unit_exists bbai-engine;  then ENGINE_SVC="bbai-engine";   FRONTEND_SVC="bbai-frontend"
  else                                ENGINE_SVC="orwell-engine"; FRONTEND_SVC="orwell-frontend"
  fi
else
  ENGINE_SVC="$ORWELL_ENGINE_SVC"
  FRONTEND_SVC="${ORWELL_FRONTEND_SVC:-orwell-frontend}"
fi

# ── Safety: never operate on an empty, root, or too-shallow path ──────────────────────────────
sanity_path() {
  local raw="$1" label="$2" p depth
  [[ -n "$raw" ]]     || die "${label} is empty — refusing to scrub."
  [[ "$raw" == /* ]]  || die "${label} must be absolute (got '${raw}')."
  [[ "$raw" != "/" ]] || die "${label} is '/' — refusing."
  p="${raw%/}"
  depth="$(awk -F/ '{print NF-1}' <<<"$p")"
  [[ "${depth}" -ge 2 ]] || die "${label} '${raw}' is too shallow — refusing (need e.g. /opt/orwell/...)."
}
sanity_path "$CONFIG_DIR"      "engine CONFIG_DIR"
sanity_path "$ENGINE_SAVE_DIR" "engine SAVE dir"
sanity_path "$FE_DATA_DIR"     "front-end FE_DATA_DIR"

# ── Environment detection ─────────────────────────────────────────────────────────────────────
have_systemd=0
if command -v systemctl >/dev/null 2>&1 && [[ -d /run/systemd/system ]]; then have_systemd=1; fi
svc_exists() { systemctl list-unit-files "${1}.service" --no-legend 2>/dev/null | grep -q .; }

if [[ "$DRY_RUN" -eq 0 && "$(id -u)" -ne 0 ]]; then
  if [[ "$CONFIG_DIR" == /opt/* || "$ENGINE_SAVE_DIR" == /opt/* || "$FE_DATA_DIR" == /opt/* || "$have_systemd" -eq 1 ]]; then
    die "run as root (sudo): needs to stop services and remove the game data under ${APP_DIR}."
  fi
fi

# Count sandboxes across BOTH the config dir (in case ORWELL_DATA_DIR=<app>/data) and the
# real engine save dir, so the confirmation prompt reflects what will actually be removed.
count_dirs() { [[ -d "$1" ]] && find "$1" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l | tr -d ' ' || echo 0; }
SANDBOXES="$(count_dirs "$ENGINE_SAVE_DIR")"
[[ "$ENGINE_SAVE_DIR" != "$CONFIG_DIR" ]] && SANDBOXES="$(( SANDBOXES + $(count_dirs "$CONFIG_DIR") ))"

# ── Confirmation (skipped by --yes / --dry-run) ───────────────────────────────────────────────
if [[ "$DRY_RUN" -eq 0 && "$ASSUME_YES" -eq 0 ]]; then
  cat <<EOF
This PERMANENTLY DELETES all orwell game + user data:
  • ${SANDBOXES} game sandbox(es)  under ${ENGINE_SAVE_DIR}/<user>/   (saves, souls, hidden Vault layer)
  • the entire front-end store     ${FE_DATA_DIR}/                    (database, settings, uploads, app key)
Preserved (config only):           ${CONFIG_DIR}/${ENV_KEEP}
The next visit will start at first-run onboarding (OOBE).
EOF
  read -r -p "Type 'RESET' to proceed: " ans
  [[ "$ans" == "RESET" ]] || die "aborted — no changes made."
fi

# ── Helpers (dry-run aware) ───────────────────────────────────────────────────────────────────
do_rm()  { if [[ "$DRY_RUN" -eq 1 ]]; then echo "  would remove: $1"; else rm -rf -- "$1"; fi; }
do_svc() {
  if [[ "$DRY_RUN" -eq 1 ]]; then echo "  would: systemctl $1 $2"; else systemctl "$1" "$2" || warn "systemctl $1 $2 failed"; fi
}

# ── 1. Stop the services so nothing writes while we scrub ─────────────────────────────────────
if [[ "$have_systemd" -eq 1 ]]; then
  msg "stopping services"
  for svc in "$FRONTEND_SVC" "$ENGINE_SVC"; do svc_exists "$svc" && do_svc stop "$svc"; done
else
  warn "systemctl not present — skipping service stop (dev mode). Stop the app yourself first."
fi

# ── 2a. Scrub the engine SAVE dir — the real per-user games (saves + hidden Vault layer). ─────
#       This is the dir the engine actually writes to (./.orwell-data by default); the earlier
#       version missed it entirely, which is why a "reset" left the game intact.
msg "scrubbing engine saves in ${ENGINE_SAVE_DIR}"
if [[ -d "$ENGINE_SAVE_DIR" ]]; then
  while IFS= read -r -d '' entry; do do_rm "$entry"; done \
    < <(find "$ENGINE_SAVE_DIR" -mindepth 1 -maxdepth 1 ! -name "$ENV_KEEP" -print0)
else
  warn "engine save dir ${ENGINE_SAVE_DIR} absent — nothing to scrub there"
fi

# ── 2b. Also scrub any sandboxes that landed in the CONFIG dir (covers ORWELL_DATA_DIR=<app>/data),
#       always KEEPING .env (the preserved config). Skipped when it's the same dir as 2a.
if [[ "$CONFIG_DIR" != "$ENGINE_SAVE_DIR" ]]; then
  msg "scrubbing config dir ${CONFIG_DIR} (keeping ${ENV_KEEP})"
  if [[ -d "$CONFIG_DIR" ]]; then
    while IFS= read -r -d '' entry; do do_rm "$entry"; done \
      < <(find "$CONFIG_DIR" -mindepth 1 -maxdepth 1 -type d -print0)
  fi
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
