# 0014 — Local & tunable HTTPS for the player tier (trusted on the LAN, with or without a domain)

> **Status:** **Accepted** (PO direction 2026-06-22: *"support https through tunable backend variables
> in the control panel … eventually it will be at https://www.hiorwell.com and lives locally at
> http://orwell.lan and its ip address, but all of that needs to be covered with HTTPS and no
> confirmation dialog … i would like https working locally whether or not the external domain is
> configured or not"*).
> **Source:** PO direction, 2026-06-22 (the "https everywhere, no browser warning" thread).
> **Builds on:** ADR [`0007`](./0007-public-internet-exposure.md) (the *public* exposure layer + the
> "never expose uvicorn directly — always a TLS-terminating reverse proxy in front" rule, the `.env`
> perimeter knobs, and the privileged-apply **ops-flag** seam from feature 0068) and the E85 systemd
> hardening + the `orwell` control panel (`deploy/orwell-menu.sh`, `deploy/orwell-change-port.sh`).
> **Inherits / bounded by:** the **Vault Wall** (mandate #2) and **cross-user isolation** (0021) — both
> structural and unchanged here; ADR 0003. This is a **transport-only** decision: no new Vault reader,
> no authority over outcomes, not one byte of gameplay changes.

## Context

ADR 0007 settled how to put the player tier on the **public internet** (`hiorwell.com`) over HTTPS —
Cloudflare Tunnel terminates TLS at the edge. But the day-to-day reality is a **trusted-LAN** box
reached three ways that ADR 0007 leaves on **plaintext HTTP**:

- a friendly hostname — `http://orwell.lan` (or `orwell.local` via mDNS),
- the raw LAN IP — `http://192.168.x.y:8080`,
- and, eventually, the public name — `https://www.hiorwell.com`.

The owner wants **all three covered by HTTPS with no browser "your connection is not private"
dialog**, and — critically — **local HTTPS must work whether or not the public domain is
configured**. Today the FE binds plaintext HTTP (`deploy/systemd/orwell-frontend.service`); login
credentials and session cookies cross the LAN in the clear, and there is **no local TLS path at all**.

The hard constraint that shapes everything: **a browser suppresses the warning only when it already
trusts the certificate's issuer.** A public name (`www.hiorwell.com`) gets that automatically from a
public CA (Let's Encrypt / Cloudflare). A **private** name (`orwell.lan`) or a **raw private IP** can
**never** receive a publicly-trusted certificate — no public CA will issue for them. So "no
confirmation dialog" for the local entrypoints is achievable **only** by either (a) a **local CA**
whose root the device trusts once, or (b) a **real, publicly-trusted** certificate for a real domain,
resolved to the LAN IP. There is no third option; this ADR commits to **both, layered**.

## Decision

Stand up a **local TLS-terminating reverse proxy on the box** (Caddy) in front of the front-end,
driven by **tunable `ORWELL_TLS_*` variables in `data/.env`** and managed from **both** control
surfaces — the `orwell` control-panel TUI **and** the in-app Admin card. It is **independent of**
public exposure (0007/0068): it works with the domain configured, without it, or alongside the
Cloudflare tunnel.

### A. The terminator (Caddy), engine never named

1. **Caddy fronts the FE on the LAN.** It owns `:80` (redirect) + `:443`; it reverse-proxies to the
   front-end on **loopback** (`127.0.0.1:${ORWELL_PORT}`, default 8080). Enabling local TLS pins the
   FE to **`ORWELL_BIND_HOST=127.0.0.1`** so the **only** LAN entrypoint is HTTPS through Caddy, and
   sets **`SECURE_COOKIES=true`** (cookies get the `Secure` flag behind TLS). uvicorn keeps its
   `--proxy-headers --forwarded-allow-ips=127.0.0.1`, so scheme/IP behind Caddy stay honest.
2. **The engine is never named — by construction.** Exactly as in ADR 0007: the generated Caddyfile
   references the **FE** host:port and **only** that. Engine port **8765 never appears** in any TLS
   artifact. A test proves it.
3. **Local TLS does *not* arm the public fail-closed profile.** `ORWELL_PUBLIC` stays **unset** for a
   LAN-only TLS deploy (it is the *internet* profile, with its Host-pin/auth fail-closed guard). Local
   TLS is the gentler, LAN-scoped posture: Secure cookies + loopback bind, no forced Host pin. Turning
   the public profile on later is orthogonal and additive.

### B. Layered trust — how the warning goes away

The `ORWELL_TLS_*` variables select **how** the certificate is trusted, layered so the floor always
works offline and the upgrade removes even the one-time step:

- **Floor — local internal CA (no domain, fully offline).** Caddy issues certs for the configured
  **local names** (`ORWELL_TLS_LOCAL_NAMES`, default `orwell.lan,orwell.local`, plus the auto-detected
  LAN IP) from its **own internal CA** (`tls internal`). This needs **nothing external** — no domain,
  no internet. To kill the warning, the CA **root** is exported and **served for one-click download**
  (an unauthenticated `GET /orwell-local-ca.crt`); a device trusts it **once**, then never sees the
  dialog again. The control panel + Admin card surface the URL and the per-OS install step.
- **Upgrade — publicly-trusted cert via DNS-01 (zero per-device install).** When the owner also sets
  `ORWELL_TLS_DOMAINS` **and** a DNS provider + API token (`ORWELL_TLS_DNS_PROVIDER` /
  `ORWELL_TLS_DNS_API_TOKEN`), Caddy obtains a **real** (Let's Encrypt) certificate for those names
  via a **DNS-01** challenge — which needs only DNS API access, **not** public reachability — and
  serves it on the LAN too (resolve the name to the LAN IP via split-horizon DNS). Now there is **no
  warning and no per-device install**, because the issuer is already trusted everywhere.

Both layers can run at once: local names on the internal CA **and** the domain on the real cert, from
one Caddy. The public Cloudflare tunnel (0007) is unaffected and may run alongside.

### C. Tunable variables + two control surfaces

The knobs live in `data/.env` (the "tunable backend variables"):

| Variable | Meaning |
|---|---|
| `ORWELL_TLS_MODE` | `off` (default — today's plaintext) · `local` (Caddy terminates TLS on the LAN) |
| `ORWELL_TLS_LOCAL_NAMES` | local hostnames to cover (default `orwell.lan,orwell.local`; the LAN IP is auto-added) |
| `ORWELL_TLS_DOMAINS` | *(optional)* public FQDN(s) to also serve with a publicly-trusted cert |
| `ORWELL_TLS_DNS_PROVIDER` | *(optional)* DNS provider for DNS-01 issuance of the domains (e.g. `cloudflare`) |
| `ORWELL_TLS_DNS_API_TOKEN` | *(optional, secret — 0600)* the DNS API token; **never** echoed by any GET |
| `ORWELL_TLS_ACME_EMAIL` | *(optional)* ACME account email for the public cert |

- **The control-panel TUI** — a new `orwell https` action (a sibling of `orwell change-port`) edits
  those vars and applies (mirrors the change-port hinge: write `.env` → reconcile the runtime →
  restart → verify). `deploy/orwell-https.sh` is the **single source of truth** for the apply.
- **The in-app Admin card** — "Local HTTPS", next to "Connect to the internet". It reuses the **exact**
  0068 privileged-apply seam: the hardened FE writes a non-secret config + an existence-only flag (and,
  if given, the 0600 DNS token) under `data/ops/`; a **root** path-unit (`orwell-ops-tls.path`) runs
  the fixed `orwell-ops-tls.sh`, which calls `orwell-https.sh`. The web tier chooses **when**, never
  **what**; the DNS token is consumed and shredded; no GET ever returns it.

## Testability

Structural + FE config, gated by the FE pytest suite and a deploy-artifact test (a recorded deviation
from the BDD-default, like 0066/0067) — the TS engine is unchanged.

- **Engine-never-named (structural).** A deploy test runs the Caddyfile generator
  (`orwell-https.sh --print-caddyfile`) and asserts it references the FE port and **never** `8765` /
  the engine — the ADR 0007 invariant, extended to the local terminator.
- **Tunable + applied.** `orwell-https.sh` writes the `ORWELL_TLS_*` keys, sets `SECURE_COOKIES=true` +
  `ORWELL_BIND_HOST=127.0.0.1` on enable, and reverts cookies on disable (unless `ORWELL_PUBLIC`). A
  deploy test asserts the `.env` upsert + the loopback/secure-cookie reconciliation.
- **Admin seam, token-safe.** FE tests assert the apply route writes the flag + non-secret config +
  the **mode-0600** DNS token, **fails closed/loud** with no watcher, is **admin-gated**, and that the
  status route **never** returns the token — mirroring `test_public_deployment_routes.py`.
- **Root-CA download.** An FE test asserts `GET /orwell-local-ca.crt` is **unauthenticated** (a fresh
  device fetches it before login), serves the exported root when present, and 404s when absent.
- **Dormant by default.** `ORWELL_TLS_MODE` unset/`off` ⇒ byte-identical to today (no Caddy, plaintext
  FE) — the non-TLS deploy is unchanged.
- **No-leak / isolation unchanged.** The dependency-cruiser Vault edge test + the vault sentinels are
  untouched; nothing here adds a reader. Cross-user isolation (0021) is unchanged. Both stay green.

## Litmus test

> Can a fresh laptop **and** a phone reach the box at `https://orwell.lan` (and the raw IP) with **no
> browser warning** after at most a **one-time** trust step — **without any public domain configured**
> — while the engine and the Vault stay structurally unreachable, and toggling it lives in the control
> panel as a tunable `.env` variable? If local HTTPS needs the internet, or the warning persists every
> visit, or the engine is reachable, it is the wrong shape.

## Consequences

- A **feature spec** — [0074](../features/0074-local-and-tunable-https.md) (+ `.feature`) — carries the
  build: `deploy/orwell-https.sh` (the apply engine + `--print-caddyfile`), the `orwell https`
  control-panel action, the `orwell-ops-tls.*` root apply seam + `orwell-ops-tls.sh`, the FE
  `admin_tls_routes` + the `/orwell-local-ca.crt` download + the "Local HTTPS" Admin card, and the
  `ORWELL_TLS_*` keys in the `.env` template.
- `deploy/expose/` gains a **local-TLS** reference Caddyfile alongside the public ones; the existing
  Cloudflare/Pangolin/VPS options are unchanged.
- `docs/INSTALL.md` gains a **"Local HTTPS (trusted on every device)"** section; the public section is
  untouched.
- **0010** (container smoke on a real Proxmox host) verifies the local-HTTPS path end-to-end alongside
  the public flip.

## Open / to confirm

- **DNS-provider coverage for the upgrade tier.** The first-class provider is **Cloudflare**
  (`caddy-dns/cloudflare`), matching the owner's `hiorwell.com` zone; other providers are a config
  swap (`ORWELL_TLS_DNS_PROVIDER`) once their Caddy DNS module is added to the build.
- **`.lan` resolution is the operator's network, not ours.** `orwell.lan` resolves only if the LAN's
  router/DNS maps it; `orwell.local` works out of the box via mDNS. The cert covers all configured
  names + the IP; making a name resolve is a documented network step.
- **Auto-trust on the box vs. clients.** Caddy installs its root into the **box's** own store; **client
  devices** still trust it once via the download. The DNS-01 upgrade removes even that.

## Traceability

- Source: PO direction 2026-06-22 ("https everywhere, no browser warning, local works without the
  domain").
- Builds on: ADR 0007 (public exposure; reverse-proxy-in-front; the 0068 ops-flag apply seam), the
  E85 systemd hardening, the `orwell` control panel + `orwell-change-port.sh`.
- Bounded by: the Vault Wall (0001) and cross-user isolation (0021) — both unchanged; ADR 0003.
- Followed by: feature **0074** (the executable spec + the in-repo build); `docs/INSTALL.md` local
  section; 0010 host smoke of the local-HTTPS path.
