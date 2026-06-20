# 0067 — Public internet exposure & internet-grade hardening (hiorwell.com)

**Status:** 📝 **Spec only** · **gate (planned): FE (pytest) + scripts (deploy)** — a recorded deviation
from the BDD-default (matching 0066/0055): the `.feature` is the spec of record, but the behaviour is
host/ops + FE-config, so the executable gates are the FE pytest suite and the deploy-script lints/smoke,
not a new Cucumber world. The TS engine is **unchanged** by this feature.
**Executable spec:** [`0067-public-internet-exposure.feature`](./0067-public-internet-exposure.feature)
**Provenance:** ADR [`0007`](../decisions/0007-public-internet-exposure.md) (public internet exposure of
the player tier); PO direction 2026-06-20 ("we bought hiorwell.com — get it on the internet, HTTPS +
internet-grade security now").

## 1. Summary

Put the **player front-end** on `hiorwell.com` over HTTPS with an internet-grade perimeter, while the
**engine stays private** and **gameplay is unchanged**. Two halves (ADR 0007): an **option-independent
hardening floor** built in-repo here, and a **pluggable exposure layer** (Cloudflare Tunnel + Access
*recommended for launch*; Pangolin on a hardened VPS the self-hosted alternative; plain VPS + Caddy the
DIY fallback) that carries TLS + the public hostname and keeps the origin LXC at zero inbound ports.

Nothing here reads the Vault, moves an outcome, or relaxes cross-user isolation — it changes the
**transport and the perimeter**, not the trust model. The FE only ever handles Vault-free projections of
the player's own game, so whatever terminates TLS can only see narrated gameplay, never secret state.

## 2. What exists today

- Engine: HTTP MCP, `ORWELL_ENGINE_PORT` 8765, **already loopback** (`ORWELL_ENGINE_HOST` default
  `127.0.0.1`, `src/main.ts:59`) + optional bearer/admin tokens + multiuser guard (E1/B34). **Correct as
  is — do not change.**
- FE: uvicorn bound **`0.0.0.0:8080` plaintext** with **no TLS / no reverse proxy**
  (`deploy/systemd/orwell-frontend.service:46`). `AUTH_ENABLED` default `true`; `SECURE_COOKIES` default
  `false`; `ALLOWED_ORIGINS` default localhost (`app.py:96`); `CORSMiddleware` + `SecurityHeadersMiddleware`
  present; **no `TrustedHostMiddleware`**; only one in-app rate limiter (error-report), **none on login**.
- `require_admin` **short-circuits when `AUTH_ENABLED=false`** — a public host with auth off silently
  unlocks God Mode. `LOCALHOST_BYPASS` (default false) bypasses auth for loopback.
- E85 systemd sandboxing on both units; `orwell-backup.sh`/`restore.sh` exist; deploy is Proxmox-LXC.

## 3. Scope

**In (built in-repo):**
- **`ORWELL_BIND_HOST`** for the FE (default **`127.0.0.1`**), replacing the hardcoded `--host 0.0.0.0`
  in the systemd unit; uvicorn `--proxy-headers --forwarded-allow-ips=<proxy>`.
- A **public-profile fail-closed boot guard**: when the public profile is selected
  (`ORWELL_PUBLIC=1`), the FE **refuses to start** if `AUTH_ENABLED=false`, `LOCALHOST_BYPASS=true`, or
  `SECURE_COOKIES=false` — and logs exactly which knob is unsafe.
- **`TrustedHostMiddleware`** with `ALLOWED_HOSTS` (default the domain) — Host-header attacks rejected.
- **Login brute-force protection**: app-level throttle/lockout on `/api/auth/login` (N fails → cooldown),
  keyed per-username + per-IP.
- A **`deploy/expose/` kit** (templates, not secrets): a `cloudflared` `config.yml` (FE-only `ingress`,
  engine never listed), a Pangolin **Newt** compose, a `Caddyfile` (auto-TLS + security headers +
  optional `caddy-ratelimit`), and a host snippet (ufw `default deny incoming`, fail2ban `sshd`,
  `unattended-upgrades`). Plus a `docs/INSTALL.md` **"Public deployment (hiorwell.com)"** section.
- `.env` template + installer note for the public knobs (`SECURE_COOKIES`, `ALLOWED_ORIGINS`,
  `ORWELL_BIND_HOST`, `ALLOWED_HOSTS`, `ORWELL_PUBLIC`).

**Out (ops / owner-confirmed elsewhere):**
- Standing up the actual VPS / Cloudflare account, DNS records, and certificates — runbook, not code.
- The **exposure-layer pick** itself (ADR 0007 Open item) — the floor is built regardless; the
  front-specific wiring is finished once the owner confirms.
- Shorter session TTL + server-side revocation on logout (clean fast-follow; noted, not blocking).
- Any DDoS/WAF beyond what the chosen front provides (Cloudflare free tier; or `caddy-ratelimit`/Coraza).

## 4. Design

- **Engine privacy is by construction, not configuration.** The engine is never named in any public
  artifact; the only thing the front routes to is the FE bind (`ORWELL_BIND_HOST:ORWELL_PORT`). A test
  greps the exposure kit for the engine port and fails if it appears.
- **The FE binds private; the front faces the world.** Under Cloudflare Tunnel / Pangolin, the connector
  runs on the LXC and reaches the FE at `127.0.0.1:8080`; under VPS+Caddy, Caddy reaches the LXC over
  WireGuard. Either way the FE never binds a public interface.
- **Fail closed.** The public profile validates its own security posture at boot and **dies loudly** on
  an unsafe combination rather than serving the game in the clear or with auth off. Default
  (non-public) behaviour is byte-identical — the guard only arms when `ORWELL_PUBLIC=1`.
- **Defense in depth on auth.** App login (already there) + edge rate-limit + (recommended) an edge
  identity gate (Cloudflare Access email-OTP / Pangolin SSO) in front. The Vault Wall and 0021 isolation
  remain the structural guarantees underneath; this only adds perimeter.
- **HSTS at the terminator, not the app** — the app may legitimately speak HTTP behind the proxy on the
  private hop; the security headers the app already sets stay, HSTS is added where TLS lives.

## 5. Contracts (stack-agnostic)

```
FE env:   ORWELL_PUBLIC (default 0)        # arms the public-profile boot guard
          ORWELL_BIND_HOST (default 127.0.0.1)   # FE listen address (was hardcoded 0.0.0.0)
          AUTH_ENABLED=true · LOCALHOST_BYPASS=false · SECURE_COOKIES=true  # required when public
          ALLOWED_ORIGINS=https://hiorwell.com   # CORS
          ALLOWED_HOSTS=hiorwell.com,www.hiorwell.com   # TrustedHostMiddleware allow-list
boot:     ORWELL_PUBLIC=1 + any-unsafe-knob  ⇒  refuse to start (exit non-zero, named reason)
mw:       TrustedHostMiddleware(allowed_hosts=ALLOWED_HOSTS)   # 400 on Host mismatch
login:    POST /api/auth/login throttle  → after N fails per {user,ip}: 429 + cooldown
engine:   ORWELL_ENGINE_HOST stays 127.0.0.1; port 8765 NEVER in any deploy/expose/* artifact
deploy:   deploy/expose/{cloudflared.config.yml, newt.compose.yml, Caddyfile, host-hardening.sh}
```

## 6. Definition of Done

- `frontend/tests/test_public_profile_guard.py` — the public profile **refuses to boot** with
  `AUTH_ENABLED=false`, with `LOCALHOST_BYPASS=true`, and with `SECURE_COOKIES=false` (one assertion
  each, naming the offending knob); boots green when all safe; and is **dormant when `ORWELL_PUBLIC`
  is unset** (default start path byte-identical).
- `frontend/tests/test_trusted_host.py` — a Host header outside `ALLOWED_HOSTS` is rejected; the domain
  is accepted.
- `frontend/tests/test_login_throttle.py` — N failed logins for a `{user,ip}` trip a cooldown (429);
  a correct login is unaffected; the limiter is per-key, not global.
- A deploy/config test (FE pytest or `deploy/` lint) asserting: the FE unit binds `ORWELL_BIND_HOST`
  (default `127.0.0.1`), **not** `0.0.0.0`; and **no file under `deploy/expose/` names engine port
  8765** (engine-never-public, structural).
- The full FE suite (`cd frontend && python3 -m pytest tests/`) and `deploy/smoke.sh` stay green with the
  FE on loopback behind the proxy/connector. The engine's `npm test` is **untouched** (no engine change),
  and the dependency-cruiser Vault-Wall + vault sentinels + 0021 isolation tests remain green.

## 7. Dependencies & traceability

- Governed by: ADR **0007** (public internet exposure); the Vault Wall (0001) + cross-user isolation
  (0021), both unchanged; private-repo ruling #17.
- Builds on: the E1/B34 engine edge guardrails (`src/main.ts`), the FE auth tier (0021/0029), the E85
  systemd hardening, `orwell-backup.sh`/`restore.sh`.
- Followed by: `docs/INSTALL.md` public section; the front-specific kit once the exposure layer is
  confirmed; **0010** host smoke of the exposed path during the private-repo flip; session-TTL/revocation
  fast-follow.

## 8. Implementer handoff — open questions

1. **Exposure layer (ADR 0007 Open):** Cloudflare Tunnel + Access (recommended, launch-now) vs. Pangolin
   on a hardened VPS (self-hosted, owner's lean) vs. plain VPS + Caddy (DIY). The §3 floor is built
   regardless; only the `deploy/expose/` front-specific piece waits on the pick.
2. **Edge auth gate:** require an edge identity gate (Access email-OTP / Pangolin SSO) **in addition** to
   the app login, or app login alone behind TLS + rate-limit? (Recommended: yes, for low-N defense in
   depth.)
3. **`ORWELL_PUBLIC` ergonomics:** a single profile flag (proposed) vs. validating the individual knobs
   unconditionally. The flag keeps the default/dev path byte-identical and the guard explicit.
4. **Session hardening scope:** fold the shorter TTL + logout revocation into 0067, or split to a
   follow-on? (Proposed: split — it's independent of exposure.)
