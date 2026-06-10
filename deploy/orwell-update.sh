#!/usr/bin/env bash
#
# orwell — update. Pulls, rebuilds the engine, refreshes front-end deps, and restarts services.
# It NEVER touches <app>/data, so the save (state + souls) is preserved (ties to #7).
#
# Run it EITHER on the Proxmox host (it locates the orwell LXC and updates INSIDE it) OR directly
# inside the container. On the host it mirrors deploy/orwell.sh's pct bridge; the app and its git
# checkout live in the LXC, never on the host (where there is no git / no app dir).
#
# Legacy-aware: a container provisioned BEFORE the bbai -> orwell rename (app in /opt/bbai with
# bbai-* services) is updated in place — the engine and front-end still honor the deprecated BBAI_*
# env, so its existing data/.env keeps working untouched.
set -euo pipefail

APP_DIR_EXPLICIT="${APP_DIR:-}"     # honor an explicit override; otherwise auto-detect below
BRANCH="${BRANCH:-main}"
# B71/ops A4 — pin + rollback:
#   REF=<sha|tag>          update to a PINNED ref instead of the branch tip
#   orwell-update.sh --rollback   return to the previous build (SHA + dist) recorded by the last update
REF="${REF:-}"
ROLLBACK=0
[[ "${1:-}" == "--rollback" ]] && ROLLBACK=1
CT_HOSTNAME_SET="${CT_HOSTNAME:+1}"   # explicit override disables the legacy-name fallback
CT_HOSTNAME="${CT_HOSTNAME:-orwell}"

# First install dir found here: an explicit override, then the current path, then the legacy one.
find_app() {
  local d
  for d in "${APP_DIR_EXPLICIT:-}" /opt/orwell /opt/bbai; do
    [[ -n "$d" && -d "$d/.git" ]] && { printf '%s' "$d"; return 0; }
  done
  return 1
}

# ── Host → container bridge ────────────────────────────────────────────────────────────────────
# On a Proxmox host (pct present) the app lives inside the LXC, not here — so locate the orwell
# container and re-run this update inside it, exactly as deploy/orwell.sh runs the installer.
# Inside the container pct does not exist (and the app dir does), so this block is skipped and the
# update runs directly. Override the target with CTID=<id> or CT_HOSTNAME=<name>.
if command -v pct >/dev/null 2>&1 && ! find_app >/dev/null 2>&1; then
  CTID="${CTID:-$(pct list 2>/dev/null | awk -v n="$CT_HOSTNAME" 'NR>1 && $NF==n {print $1}' || true)}"
  # Legacy-aware: a pre-rename box may still run an LXC literally named "bbai".
  [[ -n "$CTID" || -n "$CT_HOSTNAME_SET" ]] || CTID="$(pct list 2>/dev/null | awk 'NR>1 && $NF=="bbai" {print $1}' || true)"
  [[ -n "$CTID" ]] || { echo "ERROR: no orwell LXC found (hostname '${CT_HOSTNAME}' or legacy 'bbai'). Set CTID=<id> and retry." >&2; exit 1; }
  [[ "$(printf '%s' "$CTID" | wc -w)" -eq 1 ]] || { echo "ERROR: multiple containers named '${CT_HOSTNAME}' (${CTID//$'\n'/ }). Set CTID=<id>." >&2; exit 1; }
  [[ "$(pct status "$CTID" 2>/dev/null)" == *running* ]] || { echo "ERROR: LXC ${CTID} is not running — start it first: pct start ${CTID}" >&2; exit 1; }

  echo "==> orwell lives in LXC ${CTID}; updating inside the container"
  # The container already has curl; fetch on the host (always has curl) and push the script in, so
  # we always run the latest update logic regardless of the container's currently-installed copy.
  TMP_UPDATE="$(mktemp /tmp/orwell-update-XXXXXX.sh)"
  curl -fsSL "https://raw.githubusercontent.com/kevinhirsch/orwell/${BRANCH}/deploy/orwell-update.sh" -o "$TMP_UPDATE"
  pct push "$CTID" "$TMP_UPDATE" /tmp/orwell-update.sh
  rm -f "$TMP_UPDATE"
  # Forward only an explicit APP_DIR override; let auto-detect run inside the container otherwise.
  pct exec "$CTID" -- bash -c "export ${APP_DIR_EXPLICIT:+APP_DIR='${APP_DIR_EXPLICIT}' }BRANCH='${BRANCH}' REF='${REF}'; bash /tmp/orwell-update.sh $([[ $ROLLBACK -eq 1 ]] && echo --rollback)"
  exit 0
fi

# ── In-container (or direct) update ────────────────────────────────────────────────────────────
APP_DIR="$(find_app || true)"; APP_DIR="${APP_DIR:-/opt/orwell}"

# Service names follow the install: prefer orwell-*, fall back to the legacy bbai-* units when
# that's what is registered (a container provisioned before the rename).
unit_exists() { systemctl list-unit-files "$1" 2>/dev/null | grep -q "$1"; }
if unit_exists orwell-engine.service; then
  ENGINE_SVC="orwell-engine"; FRONTEND_SVC="orwell-frontend"
elif unit_exists bbai-engine.service; then
  ENGINE_SVC="bbai-engine"; FRONTEND_SVC="bbai-frontend"
else
  ENGINE_SVC="orwell-engine"; FRONTEND_SVC="orwell-frontend"
fi

PREV_FILE="${APP_DIR}/data/.update-prev"      # the last good SHA (data/ survives updates)
PREV_DIST="${APP_DIR}/dist.prev"              # the last good build output

# ── Rollback (B71/ops A4): return to the recorded previous SHA + its dist, then restart. ──────
if [[ "$ROLLBACK" -eq 1 ]]; then
  [[ -f "$PREV_FILE" ]] || { echo "ERROR: no previous update recorded (${PREV_FILE} missing) — nothing to roll back to." >&2; exit 1; }
  PREV_SHA="$(cat "$PREV_FILE")"
  echo "==> rolling back to ${PREV_SHA}"
  git -C "$APP_DIR" reset --hard "$PREV_SHA"
  if [[ -d "$PREV_DIST" ]]; then
    rm -rf "${APP_DIR}/dist"
    cp -a "$PREV_DIST" "${APP_DIR}/dist"
  else
    ( cd "$APP_DIR" && npm ci && npm run build )
  fi
  systemctl restart "$ENGINE_SVC" "$FRONTEND_SVC"
  echo "==> rollback complete (now on ${PREV_SHA})."
  exit 0
fi

echo "==> updating orwell in ${APP_DIR} (save in ${APP_DIR}/data is preserved)"
PREV_SHA="$(git -C "$APP_DIR" rev-parse HEAD)"
# Keep the running build so a failed update (or a later --rollback) can restore it untouched.
if [[ -d "${APP_DIR}/dist" ]]; then
  rm -rf "$PREV_DIST"
  cp -a "${APP_DIR}/dist" "$PREV_DIST"
fi

# Fetch + check out the TARGET (a pinned REF wins over the branch tip).
if [[ -n "$REF" ]]; then
  git -C "$APP_DIR" fetch origin "$REF" || git -C "$APP_DIR" fetch --tags origin
  TARGET="$REF"
else
  git -C "$APP_DIR" fetch --depth 1 origin "$BRANCH"
  TARGET="origin/${BRANCH}"
fi
git -C "$APP_DIR" reset --hard "$TARGET"

# Build BEFORE committing to the swap (B71/ops A4): a failed build must leave the services on the
# PREVIOUS checkout + build — never a new tree with a stale dist, never a restart into a broken build.
echo "==> rebuild engine (the update commits only if this succeeds)"
cd "$APP_DIR"
if ! (npm ci && npm run build); then
  echo "ERROR: build FAILED on ${TARGET} — reverting to ${PREV_SHA}; services were NOT restarted." >&2
  git -C "$APP_DIR" reset --hard "$PREV_SHA"
  if [[ -d "$PREV_DIST" ]]; then rm -rf "${APP_DIR}/dist"; cp -a "$PREV_DIST" "${APP_DIR}/dist"; fi
  echo "Hint: retry with REF=<known-good sha|tag>, or run 'orwell-update.sh --rollback' later." >&2
  exit 1
fi

echo "==> refresh front-end deps"
cd "${APP_DIR}/frontend"
./.venv/bin/pip install -q -r requirements.txt

# Record the rollback point only once the new build is in place.
mkdir -p "${APP_DIR}/data"
printf '%s' "$PREV_SHA" > "$PREV_FILE"

echo "==> restart services (${ENGINE_SVC}, ${FRONTEND_SVC})"
systemctl restart "$ENGINE_SVC" "$FRONTEND_SVC"
echo "==> update complete ($(git -C "$APP_DIR" rev-parse --short HEAD)); previous build kept for --rollback."
