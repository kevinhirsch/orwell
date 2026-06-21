# 0007 — Public internet exposure of the player tier (hiorwell.com) over HTTPS

> **Status:** **Accepted** (PO direction 2026-06-20: *"we bought hiorwell.com and want to get this on
> the internet… needs HTTPS and internet-grade security now; thinking Pangolin + a VPS, or Cloudflare,
> IDK"*). The **option-independent hardening floor** is **BUILT** (feature
> [`0067`](../features/0067-public-internet-exposure.md)); the **exposure layer** is confirmed
> **Cloudflare Tunnel + Access** (owner, 2026-06-20) — the `deploy/expose/cloudflared/` kit + the INSTALL
> runbook ship it as the default, with Pangolin-on-VPS and plain-VPS-Caddy kept as documented
> alternatives. Remaining: the real-host smoke of the exposed path (folds into 0010).
> **Source:** PO direction, 2026-06-20 (the "get it on the internet" thread) + the deploy/security
> reconnaissance summarised in [feature 0067](../features/0067-public-internet-exposure.md).
> **Builds on:** the existing Proxmox-LXC deploy (`deploy/`, `docs/INSTALL.md`), the network-edge
> guardrails already in `src/main.ts` (audit E1/B34), the FE auth tier (0021/0029), and the E85 systemd
> hardening.
> **Inherits / bounded by:** the **Vault Wall** (mandate #2) and **cross-user isolation** (0021) — both
> structural and unchanged by anything here; ADR 0003 (the conversation is the game). Private-repo
> ruling #17.

## Context

The game is two services in one Proxmox LXC: the **TS engine** (HTTP MCP, `ORWELL_ENGINE_PORT`
default **8765**, already bound to **`127.0.0.1`** by default — `src/main.ts:59`) and the **Python/
FastAPI front-end** (uvicorn, `ORWELL_PORT` default **8080**). Only the front-end is ever meant to face
a human; the engine is engine-only and must never be publicly reachable (it speaks the privileged tool
API, and only the FE asserts the authenticated `x-orwell-user`).

Today the deploy is **single-tenant, loopback-trusted**:

- The FE systemd unit binds **`0.0.0.0:8080` as plaintext HTTP** with **no reverse proxy and no TLS**
  (`deploy/systemd/orwell-frontend.service:46`). Login credentials and session cookies cross the wire
  in clear; `SECURE_COOKIES` defaults `false`.
- There is **no edge protection**: no rate-limiting or brute-force lockout on the login route, no WAF,
  no DDoS absorption. The FE has `CORSMiddleware` + a `SecurityHeadersMiddleware` but **no
  `TrustedHostMiddleware`** (Host header unvalidated), and **no HSTS** (correct — HSTS belongs at the
  TLS terminator).
- `AUTH_ENABLED` defaults **`true`** (good), but the FE's `require_admin` **short-circuits to allow when
  `AUTH_ENABLED=false`** — so leaving it false on a public host silently unlocks God Mode. `LOCALHOST_
  BYPASS` and `ORWELL_ENGINE_MULTIUSER` are the other footguns.

So the box is production-ready for a trusted LAN and **categorically not safe on the open internet** as
shipped. This record settles **how** to put the player tier on `hiorwell.com` with real HTTPS and an
internet-grade posture — **without** moving the engine, weakening the Vault Wall, or changing one byte
of gameplay.

The Vault Wall is *not* re-litigated here: the engine never emits Vault data on any outward surface
(proven structurally by dependency-cruiser + the vault sentinels), and the FE consumes **only Vault-free
projections**. Whatever terminates TLS at the edge can therefore only ever see *the player's own
narrated game* — never secret state, and never another user's game (0021). Exposure changes the
*transport*, not the trust model.

## Decision

Split the problem in two. **(A)** an **option-independent hardening floor** that is mandatory under
*every* exposure option, built in-repo as [feature 0067](../features/0067-public-internet-exposure.md);
and **(B)** a choice of **exposure layer** that carries TLS + the public hostname and (ideally) keeps
the origin LXC at **zero inbound ports**.

### A. The hardening floor (binding, option-independent)

These hold no matter which front in §B is chosen. None of them touch the engine or gameplay.

1. **The engine never goes public — by construction.** `ORWELL_ENGINE_HOST` stays `127.0.0.1` (or a
   private VPN interface). Port **8765 is never named** in any reverse-proxy route, tunnel `ingress`, or
   firewall allow rule. A surface is not "exposed-safe" until a test proves the public config exposes
   the FE host:port and **only** that.
2. **Never expose uvicorn directly — always a TLS-terminating reverse proxy in front.** The FE binds a
   **private** address (new `ORWELL_BIND_HOST`, default **`127.0.0.1`**, replacing the hardcoded
   `0.0.0.0`) and is reached only by the local connector/proxy. uvicorn runs with
   `--proxy-headers --forwarded-allow-ips=<proxy>` so client IP/scheme are honest.
3. **Auth is forced on for a public profile.** `AUTH_ENABLED=true`, `LOCALHOST_BYPASS=false`,
   `ORWELL_ENGINE_MULTIUSER=1`, `SECURE_COOKIES=true`, distinct strong `ORWELL_ENGINE_TOKEN` /
   `ORWELL_ENGINE_ADMIN_TOKEN`, `ALLOWED_ORIGINS=https://hiorwell.com`. A **public profile refuses to
   boot** if any of these is unsafe (auth disabled, localhost-bypass on, insecure cookies) — fail
   closed, never a silent insecure start.
4. **Host header pinned + edge security headers.** Add `TrustedHostMiddleware` (allowed hosts from
   env, default the domain) so Host-header attacks are rejected; the terminator adds **HSTS**
   (`max-age≥31536000; includeSubDomains` once fully HTTPS) and keeps the existing security headers.
5. **Brute-force protection on the credential endpoint, made correct behind the tunnel.** The FE
   already throttles login (per-IP); behind a tunnel every request arrives from `127.0.0.1`, so the
   throttle is keyed on the **real client IP** resolved from the trusted forwarding header
   (`CF-Connecting-IP`/`X-Forwarded-For`), not one global bucket — plus the edge auth gate (Access)
   in front. (Per-username lockout is deliberately avoided — it enables a targeted-lockout DoS.)
6. **Host hardening + backups.** ufw `default deny incoming` (only SSH from a trusted source + 80/443,
   or *nothing inbound* under a tunnel), key-only SSH, `unattended-upgrades`, fail2ban (`sshd`), keep
   the E85 systemd sandboxing, and schedule `orwell-backup.sh` **off-host** with a tested restore.

### B. The exposure layer — recommendation

All three viable fronts keep the engine private; they differ on **where TLS terminates**, **whether the
LXC opens any inbound port**, and **what managed protection (DDoS/WAF/auth-gate) you get**.

| | **Cloudflare Tunnel + Access** | **Pangolin on a VPS** | **Plain VPS + Caddy** |
|---|---|---|---|
| Inbound ports on the LXC | **none** (outbound `cloudflared`) | **none** (outbound Newt/WireGuard) | none *(via VPS→WireGuard→LXC)* |
| TLS terminates at | Cloudflare edge (3rd-party sees plaintext) | **your VPS** (Traefik) | **your VPS** (Caddy) |
| Managed DDoS / WAF | **yes, free** (unmetered DDoS, free managed ruleset, Bot Fight) | no (DIY / put CF in front) | no (DIY: `caddy-ratelimit`/Coraza) |
| Auth gate in front of app | **yes** (Access: email-OTP/SSO, free tier) | **yes** (SSO/OIDC/PIN/password/email-allowlist) | no (add Authelia) |
| Ops burden / cost | **lowest**; ~$0 (free tier) + the LXC | a hardened ~$5/mo VPS you run | most DIY; a ~$5/mo VPS |
| 3rd-party dependency | Cloudflare (DNS + edge + auth) | none (self-hosted) | none (self-hosted) |

**Recommended default for the initial launch: Cloudflare Tunnel + Cloudflare Access.** It is the
fastest route to a genuinely *internet-grade* posture and the tightest fit to "secure it **now**": an
outbound-only tunnel (the LXC opens **zero** inbound ports, `cloudflared`'s `ingress` lists the FE and
nothing else — the engine is unreachable by simply never being named), free **unmetered DDoS** + the
free **WAF managed ruleset** + **Bot Fight Mode**, automatic edge HTTPS, and **Access email-OTP** as a
login wall *in front of* the FE so unauthenticated traffic never reaches uvicorn. The honest cost is a
**third-party dependency** and **edge TLS visibility** — Cloudflare decrypts at its edge (that is how the
WAF works). The mitigant is structural: the FE only ever handles **Vault-free projections of the
player's own game**, so what the edge can see is narrated gameplay, never Vault secrets and never
another user's game. One caveat to respect: Cloudflare's CDN terms restrict proxying large media in
bulk through the free tier — keep AI-generated images/audio served from the provider's own URLs (the FE
already does), not hairpinned through the proxy.

**First-class alternative (the owner's lean): Pangolin on a small, hardened VPS.** Choose this when
keeping **all** gameplay traffic on infrastructure you control — TLS terminating on *your* VPS, no
third party in the path — outweighs managed DDoS/WAF. It preserves the same zero-inbound-port origin
model (Newt dials out from the LXC over WireGuard; register **only** the FE as a resource, leave the
engine unregistered and therefore unreachable), adds an identity-aware auth gate for free, and is a
natural extension of the existing self-hosted, private-repo, Proxmox posture. The trade is **more ops**
(you own a VPS: patching, the Pangolin DB, cert health, backups) and **no managed DDoS/WAF** — a single
small VPS can be knocked offline by volumetric abuse. **Hybrid:** front the Pangolin VPS with Cloudflare
(free, proxied) and firewall the VPS to accept 443 **only** from Cloudflare IP ranges — this buys the
DDoS/WAF edge, but re-introduces edge visibility (CF terminates TLS when proxied), so it is a
*when-needed* switch, not day one.

**Plain VPS + Caddy** is the most-DIY fallback (auto Let's Encrypt, a hand-tuned `Caddyfile`,
`caddy-ratelimit`/Coraza for the WAF, VPS→WireGuard→LXC to keep the origin private). Document it; don't
lead with it — it's strictly more work than Pangolin for the same self-hosted properties.

This record adds **no authority over outcomes**, no new Vault reader, and no gameplay change. It is a
transport-and-perimeter decision only.

## Testability

The hardening floor (§A) is structural and gated; the exposure layer (§B) is ops, verified by review +
smoke.

- **Engine-never-public (A1), structural.** A test asserts the public deploy artifacts (the chosen
  front's config + the FE bind) reference the **FE** host:port and **never** the engine port 8765 — and
  `src/main.ts` keeps `ORWELL_ENGINE_HOST` defaulting to loopback (existing E1 guardrail unchanged).
- **Fail-closed public profile (A3), runtime.** An FE test asserts the public profile **refuses to
  boot** when `AUTH_ENABLED=false`, `LOCALHOST_BYPASS=true`, or `SECURE_COOKIES=false` — and boots
  green when all are safe.
- **Host pinned (A4), runtime.** An FE test asserts a request with a Host header outside the allow-list
  is rejected, and the domain is accepted.
- **Loopback-by-default (A2), config.** A deploy test asserts the FE unit binds `ORWELL_BIND_HOST`
  (default `127.0.0.1`), not `0.0.0.0`.
- **No-leak, unchanged.** The dependency-cruiser Vault-Wall edge test + the vault sentinels already
  prove no outward surface reads the Vault; nothing here adds a reader. Cross-user isolation (0021)
  is likewise untouched. Both stay green.
- **Smoke.** `deploy/smoke.sh` (boots real engine + FE, drives a full turn) continues to pass with the
  FE on loopback behind the proxy/connector.

## Litmus test

> Is the **only** thing reachable from `hiorwell.com` the authenticated player front-end, served over
> HTTPS, with the engine and the Vault structurally unreachable — and does a misconfiguration fail
> *closed* (no boot) rather than quietly serving the game in the clear or with auth off? If any of those
> breaks, it is the wrong shape, even if "the site loads."

## Consequences

- A **feature spec** — [0067](../features/0067-public-internet-exposure.md) (+ `.feature`) — carries the
  in-repo build of §A: `ORWELL_BIND_HOST` (loopback default) in the FE unit and uvicorn proxy-headers;
  the **public-profile fail-closed boot guard**; `TrustedHostMiddleware`; the login throttle/lockout;
  and a `deploy/expose/` kit (a `cloudflared` config template, a Pangolin/Newt compose, a `Caddyfile`,
  a ufw + fail2ban + `unattended-upgrades` snippet) keyed off the chosen option.
- `docs/INSTALL.md` gains a **"Public deployment (hiorwell.com)"** section per the chosen option; the
  installer/`.env` template documents the public profile knobs (`SECURE_COOKIES`, `ALLOWED_ORIGINS`,
  `ORWELL_BIND_HOST`, the host pin).
- DNS for `hiorwell.com` is configured per the chosen option (Cloudflare nameservers + a proxied
  hostname; or A/AAAA → VPS for Pangolin/Caddy). The apex and `www` both resolve to the app.
- **0010** (container smoke on a real Proxmox host) is the natural place to also verify the exposed path
  end-to-end during the private-repo flip.

## Open / to confirm

- ✅ **The exposure-layer pick is resolved (owner, 2026-06-20): Cloudflare Tunnel + Access** — fastest
  to internet-grade now (free DDoS/WAF + email-OTP login wall + zero inbound ports). **Pangolin on a
  hardened VPS** and **plain VPS + Caddy** stay documented as the self-hosted-control alternatives, and
  the **hybrid** (a self-hosted origin fronted by Cloudflare, origin firewalled to CF IPs) is the
  when-DDoS-matters switch. Feature 0067 built the option-independent floor + the Cloudflare kit.
- **Auth-gate-in-front strength:** whether to require an *edge* identity gate (Access / Pangolin SSO)
  **in addition** to the app's own login, or rely on the app login alone behind TLS + rate-limit. (For a
  single/low-N user base, an edge email-OTP allow-list is cheap defense-in-depth and recommended.)
- **Session lifetime:** the 7-day FE session TTL is long for a public app — consider shortening +
  server-side revocation on logout (a 0067 sub-item, not architecture).

## Traceability

- Source: PO direction 2026-06-20 ("get it on the internet" thread).
- Builds on: the Proxmox-LXC deploy (`deploy/`, `docs/INSTALL.md`), `src/main.ts` edge guardrails
  (E1/B34), FE auth (0021/0029), E85 systemd hardening; private-repo ruling #17.
- Bounded by: the Vault Wall (0001) and cross-user isolation (0021) — both unchanged; ADR 0003.
- Followed by: feature **0067** (the executable spec + the in-repo build); `docs/INSTALL.md` public
  section; 0010 host smoke of the exposed path.
