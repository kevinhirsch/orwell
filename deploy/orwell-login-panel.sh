#!/usr/bin/env bash
#
# orwell — the login health panel (ruling #21, 2026-06-11). Installed by
# orwell-install.sh / orwell-update.sh to /usr/local/bin/orwell-panel and hooked into
# interactive shells, so entering the container greets you with live health instead of
# a bare (or seemingly hung) prompt.
#
# DESIGN RULE: this must NEVER hang or break a login. Every probe is time-bounded
# (curl -m 1, no retries), every command is || true'd, the whole script is set +e,
# and the bashrc hook guards with ORWELL_PANEL_SHOWN so nested shells stay quiet.
# Worst case on a wedged box: ~2s of timeouts, then your prompt — never silence.
set +e

# ---- locate the install (legacy bbai-aware, same detection as the other scripts) ----
APP_DIR=""
for d in "${ORWELL_HOME:-}" /opt/orwell /opt/bbai; do
  [[ -n "$d" && -d "$d/.git" ]] && { APP_DIR="$d"; break; }
done
[[ -n "$APP_DIR" ]] || exit 0   # not an orwell box — stay silent

if systemctl cat bbai-engine.service >/dev/null 2>&1; then
  ENGINE_SVC="bbai-engine"; FRONTEND_SVC="bbai-frontend"
else
  ENGINE_SVC="orwell-engine"; FRONTEND_SVC="orwell-frontend"
fi

ENV_FILE="${APP_DIR}/data/.env"
envv() { grep -E "^${1}=" "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '"' ; }
ENGINE_PORT="$(envv ORWELL_ENGINE_PORT)"; ENGINE_PORT="${ENGINE_PORT:-$(envv BBAI_ENGINE_PORT)}"; ENGINE_PORT="${ENGINE_PORT:-8765}"
FE_PORT="$(envv ORWELL_PORT)"; FE_PORT="${FE_PORT:-$(envv BBAI_PORT)}"; FE_PORT="${FE_PORT:-8080}"

# ---- probes (each bounded; never block the prompt) ----
ok="\e[32m●\e[0m"; bad="\e[31m●\e[0m"; warn="\e[33m●\e[0m"; dim="\e[2m"; off="\e[0m"; bold="\e[1m"

svc() { systemctl is-active --quiet "$1" 2>/dev/null && echo -e "$ok up" || echo -e "$bad down"; }
ENGINE_UNIT="$(svc "$ENGINE_SVC")"
FE_UNIT="$(svc "$FRONTEND_SVC")"

ENGINE_HTTP="$bad no reply"
curl -fsS -m 1 "http://127.0.0.1:${ENGINE_PORT}/health" 2>/dev/null | grep -q '"ok":true' && ENGINE_HTTP="$ok healthy"

FE_HTTP="$bad no reply"; TIERS=""
fe_json="$(curl -fsS -m 1 "http://127.0.0.1:${FE_PORT}/api/orwell/health" 2>/dev/null)"
if [[ -n "$fe_json" ]]; then
  FE_HTTP="$ok healthy"
  grep -q '"engine":[[:space:]]*true' <<<"$fe_json" && TIERS="$ok agree" || TIERS="$warn FE can't see engine"
fi

EMBED="${dim}deterministic${off}"
if [[ "$(envv ORWELL_EMBEDDINGS)" == "fastembed" ]]; then
  cache="$(envv ORWELL_EMBED_CACHE)"; cache="${cache:-${APP_DIR}/data/models}"
  if [[ -d "$cache" && -n "$(ls -A "$cache" 2>/dev/null)" ]]; then EMBED="$ok fastembed (cached)"; else EMBED="$warn fastembed (model NOT cached)"; fi
fi

SHA="$(git -C "$APP_DIR" rev-parse --short HEAD 2>/dev/null || echo '?')"
SAVES=0
sd="$(envv ORWELL_DATA_DIR)"; sd="${sd:-$(envv BBAI_DATA_DIR)}"; sd="${sd:-${APP_DIR}/.orwell-data}"
[[ "$sd" == /* ]] || sd="${APP_DIR}/${sd#./}"
[[ -d "$sd" ]] && SAVES="$(find "$sd" -mindepth 1 -maxdepth 1 -type d ! -name models 2>/dev/null | wc -l | tr -d ' ')"
LOAD="$(cut -d' ' -f1-3 /proc/loadavg 2>/dev/null || echo '?')"
MEM="$(free -m 2>/dev/null | awk '/^Mem:/{printf "%d/%dMB", $3, $2}' || echo '?')"
IP="$(hostname -I 2>/dev/null | awk '{print $1}')"

# ---- render ----
echo -e ""
echo -e "${bold}  ◉ ORWELL${off}  ${dim}${APP_DIR} @ ${SHA}${off}"
echo -e "  ─────────────────────────────────────────────"
echo -e "  engine   ${ENGINE_UNIT}   ${dim}unit${off}   ${ENGINE_HTTP}   ${dim}:${ENGINE_PORT}/health${off}"
echo -e "  frontend ${FE_UNIT}   ${dim}unit${off}   ${FE_HTTP}   ${dim}:${FE_PORT}${off}${TIERS:+   ${dim}tiers${off} ${TIERS}}"
echo -e "  recall   ${EMBED}"
echo -e "  saves    ${SAVES} sandbox(es)   ${dim}load${off} ${LOAD}   ${dim}mem${off} ${MEM}"
[[ -n "$IP" ]] && echo -e "  play     ${bold}http://${IP}:${FE_PORT}${off}"
echo -e "  ─────────────────────────────────────────────"
echo -e "  ${dim}doctor:${off} bash ${APP_DIR}/deploy/orwell-doctor.sh   ${dim}update:${off} bash ${APP_DIR}/deploy/orwell-update.sh"
echo -e ""
exit 0
