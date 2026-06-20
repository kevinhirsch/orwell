# deploy/expose/ — putting the player tier on the internet (hiorwell.com)

Reference configs for exposing the **player front-end** over HTTPS with an internet-grade
perimeter. Governed by **ADR [`0007`](../../docs/decisions/0007-public-internet-exposure.md)** and
feature **[`0067`](../../docs/features/0067-public-internet-exposure.md)**. Full runbook:
`docs/INSTALL.md → Public deployment (hiorwell.com)`.

## The rule that makes this safe

Only the **front-end** is ever exposed. The **engine is engine-only** and stays bound to loopback;
it is never given a tunnel `ingress` entry, a `reverse_proxy` route, or a firewall allow rule. It
is unreachable from the internet **by simply never being named** in any file here. The FE also only
ever serves **Vault-free projections of the player's own game**, so whatever terminates TLS can see
narrated gameplay — never secret state, never another user's game.

Before exposing, the FE must run the **public profile** (`docs/INSTALL.md`): `ORWELL_PUBLIC=1`,
`AUTH_ENABLED=true`, `LOCALHOST_BYPASS=false`, `SECURE_COOKIES=true`,
`ALLOWED_HOSTS=hiorwell.com,www.hiorwell.com`, `ALLOWED_ORIGINS=https://hiorwell.com`. The app
**refuses to boot** if any of those is unsafe.

> All targets below use the FE port **8080** (the installer default `ORWELL_PORT`). If you changed
> `ORWELL_PORT`, change it here too.

## Option A — Cloudflare Tunnel + Access  *(recommended)*

Fastest path to internet-grade: an outbound-only tunnel (the origin opens **zero inbound ports**),
free unmetered DDoS + the free WAF managed ruleset + Bot Fight Mode, automatic edge HTTPS, and
Cloudflare **Access** (email-OTP / SSO) as a login wall in front of the FE.

- `cloudflared/config.yml` — the tunnel ingress (FE only; the engine is intentionally absent).

```bash
cloudflared tunnel login                       # pick the hiorwell.com zone
cloudflared tunnel create orwell               # writes the UUID + credentials json
cloudflared tunnel route dns orwell hiorwell.com
# copy cloudflared/config.yml to /etc/cloudflared/config.yml, fill in <TUNNEL-UUID>
sudo cloudflared service install && sudo systemctl enable --now cloudflared
```

Then in the dashboard: enable the **WAF Free Managed Ruleset** + **Bot Fight Mode**, add an
**Access** application over `hiorwell.com` (email-OTP allow-list), and (optional) **Turnstile** on
the login form. Trade-off: a Cloudflare dependency and edge TLS visibility (the edge decrypts to run
the WAF). Keep large AI media served from the provider's own URLs, not proxied in bulk (CDN terms).

## Option B — Pangolin on a hardened VPS  *(self-hosted control)*

TLS terminates on a small VPS **you** run; the origin still opens zero inbound ports (the **Newt**
connector dials out over WireGuard). Adds an SSO / PIN / password / email-allow-list gate for free.

- `pangolin/newt.compose.yml` — the Newt connector for the origin host.

Install Pangolin on the VPS (`curl -fsSL https://static.pangolin.net/get-installer.sh | bash`),
create a **Site** (Newt), run the compose on the LXC, then register a single HTTP **resource**
targeting the FE — and **do not** register the engine. Trade-off: a ~$5/mo VPS you patch, and no
managed DDoS/WAF (front it with Cloudflare later, locking the VPS firewall to Cloudflare IPs).

## Option C — Plain VPS + Caddy  *(DIY fallback)*

A public VPS running Caddy (automatic Let's Encrypt), reaching the FE over WireGuard so the origin
stays private. Most manual; pick A or B unless you specifically want a bare reverse proxy.

- `caddy/Caddyfile` — auto-TLS + security headers + an optional login rate-limit.

## Host hardening (every option)

- `host-hardening.sh` — a **reference** script (review before running) for the public host: ufw
  (`default deny incoming`), fail2ban (`sshd`), and `unattended-upgrades`. Under a pure outbound
  tunnel (Option A) you open **no** inbound ports except SSH.
