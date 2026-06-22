# Feature 0074 — Local & tunable HTTPS (trusted on the LAN, with or without a domain)

> **ADR:** [`0014`](../decisions/0014-local-and-tunable-https.md). **Builds on:** feature
> [`0067`/`0068`](./0067-public-internet-exposure.md) (the public exposure layer + the privileged
> **ops-flag** apply seam) and the `orwell` control panel. **Gate:** the FE pytest suite + a
> deploy-artifact test (a recorded deviation from the BDD-default, like 0066/0067) — the behaviour is
> host/ops + FE config, **not** a new Cucumber world. The TS engine is unchanged.

## Why

The box is reached three ways — `orwell.lan`, the raw LAN IP, and (eventually) `www.hiorwell.com` —
and today all of them are **plaintext HTTP** on the LAN (ADR 0007 only covers the *public* edge). The
owner wants **HTTPS on all three with no browser "not private" dialog**, and **local HTTPS must work
whether or not the public domain is configured**.

The unavoidable PKI fact (see ADR 0014): a browser trusts a cert only if it already trusts the
**issuer**. Public names get that free; **private names (`.lan`) and raw IPs cannot**. So the warning
goes away only via a **local CA the device trusts once**, or a **real cert for a real domain** resolved
to the LAN. This feature ships **both, layered**, behind tunable `ORWELL_TLS_*` variables managed from
the control-panel TUI **and** the in-app Admin card.

## Scope

**In:**

- A **local TLS terminator** (Caddy) in front of the FE: owns `:80`/`:443`, reverse-proxies to the FE
  on loopback (`127.0.0.1:${ORWELL_PORT}`), and **never names the engine** (port 8765 absent).
- **Tunable `.env` variables** (the "backend variables"): `ORWELL_TLS_MODE` (`off`|`local`),
  `ORWELL_TLS_LOCAL_NAMES`, `ORWELL_TLS_DOMAINS`, `ORWELL_TLS_DNS_PROVIDER`, `ORWELL_TLS_DNS_API_TOKEN`
  (secret, 0600), `ORWELL_TLS_ACME_EMAIL`.
- **Layered trust:** the **internal CA** floor (offline, no domain) for the local names + IP, with the
  CA **root downloadable** (`GET /orwell-local-ca.crt`, unauthenticated) to kill the warning after one
  install; the **DNS-01 publicly-trusted** upgrade for the domain(s) (zero per-device install).
- **Two control surfaces:** `deploy/orwell-https.sh` (the single apply engine) driven by (1) a new
  `orwell https` control-panel action and (2) the in-app Admin "Local HTTPS" card via the **0068
  ops-flag seam** (`orwell-ops-tls.path`/`.service` → `orwell-ops-tls.sh` → `orwell-https.sh`).
- Enabling local TLS sets `SECURE_COOKIES=true` + pins `ORWELL_BIND_HOST=127.0.0.1`; it does **not**
  arm `ORWELL_PUBLIC` (the internet profile).

**Out:** the public exposure layer (0067/0068, unchanged); making `orwell.lan` *resolve* on the LAN
(operator's router/DNS — documented, not automated); non-Cloudflare DNS providers (a config swap once
their Caddy DNS module is in the build).

## Contracts

- **`deploy/orwell-https.sh`** — validate names → upsert `ORWELL_TLS_*` into `data/.env` → generate
  `/etc/caddy/Caddyfile` → install/enable Caddy (apt repo + `.deb` fallback; `caddy add-package` the
  DNS module when a provider is set) → export the internal-CA root to `data/tls/local-ca.crt` (world-
  readable) → set `SECURE_COOKIES`/`ORWELL_BIND_HOST` → restart the FE → verify → print the access URLs
  + the root-CA install step. Flags: `--mode`, `--local-names`, `--domains`, `--dns-provider`,
  `--dns-token`, `--acme-email`, `--disable`, `--yes`, `--no-restart`, `--dry-run`,
  `--print-caddyfile`. Host→container `pct` bridge, like `orwell-change-port.sh`.
- **`frontend/routes/admin_tls_routes.py`** — `GET /api/admin/tls-status` (posture; **never** the
  token), `POST /api/admin/tls/apply` (validate → write `data/ops/tls.json` + 0600 `tls-dns-token` +
  the existence-only flag; fail-loud with no watcher), `POST /api/admin/tls/disconnect`. Admin-gated;
  reuses the Update-lane flag helpers verbatim.
- **`GET /orwell-local-ca.crt`** — unauthenticated; serves `data/tls/local-ca.crt` (the public root, not
  a secret) so a fresh device can trust it before login; 404 when absent.
- **`core/middleware.py`** — pure, unit-testable helpers: `local_tls_names_from_env` and
  `sanitize_tls_names` (strict hostname/IP allow-list — defense in depth, since names become Caddyfile
  data).

## Test strategy (Definition of Done)

- **FE pytest** `test_tls_routes.py` (mirrors `test_public_deployment_routes.py`): admin-gated;
  apply writes flag+config+**0600** token and **never echoes** it; status never returns the token and
  reports posture; disconnect; the routes are wired into `app.py`; `tls` is in the ops-status actions.
- **FE pytest** `test_local_tls_guard.py`: `sanitize_tls_names` rejects shell/Caddy metacharacters and
  keeps valid hostnames/IPs; `local_tls_names_from_env` defaults + parses.
- **FE pytest** `test_local_ca_download.py`: `/orwell-local-ca.crt` is auth-exempt, serves when
  present, 404 when absent.
- **Deploy** `tests/unit/tlsArtifacts.test.ts`: the generated Caddyfile references the FE port and
  **never** `8765`; `orwell-https.sh` upserts the `ORWELL_TLS_*` keys + sets `SECURE_COOKIES`/loopback;
  the `orwell-ops-tls.*` units mirror the public-deployment pattern (existence-only flag, rm-first);
  `orwell-menu.sh` wires the `https` action; install/update reconcile the new units.
- **Dormant-by-default**: `ORWELL_TLS_MODE` unset ⇒ no Caddy, plaintext FE — byte-identical to today.
- **Vault/isolation unchanged**: no new reader; the existing structural gates stay green.

## Implementer handoff

- Single source of truth for *apply* is `orwell-https.sh`; the TUI and the root ops-runner both call
  it. Don't fork the logic (the change-port lesson).
- The DNS token is a secret: 0600 on disk, consumed/handled by the root path only, never returned by a
  GET, never written to the run log (mirror `cloudflared-token` in `orwell-ops-public-deployment.sh`).
- Keep the engine **unnamed** in every TLS artifact — the generated Caddyfile points only at
  `127.0.0.1:${ORWELL_PORT}`. This is the load-bearing invariant the deploy test guards.
