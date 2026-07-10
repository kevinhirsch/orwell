# deploy/expose/ — putting the player tier on the internet (any domain)

Reference configs for exposing the **player front-end** over HTTPS with an internet-grade
perimeter. Governed by **ADR [`0007`](../../docs/decisions/0007-public-internet-exposure.md)** and
feature **[`0067`](../../docs/features/0067-public-internet-exposure.md)**. Full runbook:
`docs/INSTALL.md → Public deployment (any domain)`.

## Just want HTTPS on the LAN? (no domain, no internet)

If your goal is a trusted `https://orwell.lan` / `https://<lan-ip>` for the household — **not** a public
site — you don't need any of the options below. Use **local HTTPS** (feature
[`0074`](../../docs/features/0074-local-and-tunable-https.md) / ADR
[`0014`](../../docs/decisions/0014-local-and-tunable-https.md)): `orwell https --mode local` (or the
Admin "Local HTTPS" card) stands up a Caddy terminator with a built-in CA, and each device trusts the
root once (`/orwell-local-ca.crt`) to silence the browser warning. It works with or without any of the
public options here. Reference config: [`caddy/local.Caddyfile`](caddy/local.Caddyfile). The rest of
this page is about the **public internet**.

## The rule that makes this safe

Only the **front-end** is ever exposed. The **engine is engine-only** and stays bound to loopback;
it is never given a tunnel `ingress` entry, a `reverse_proxy` route, or a firewall allow rule. It
is unreachable from the internet **by simply never being named** in any file here. The FE also only
ever serves **Vault-free projections of the player's own game**, so whatever terminates TLS can see
narrated gameplay — never secret state, never another user's game.

Before exposing, the FE must run the **public profile** (`docs/INSTALL.md`): `ORWELL_PUBLIC=1`,
`AUTH_ENABLED=true`, `LOCALHOST_BYPASS=false`, `SECURE_COOKIES=true`,
`ALLOWED_HOSTS=your-domain.example,www.your-domain.example`, `ALLOWED_ORIGINS=https://your-domain.example`. The app
**refuses to boot** if any of those is unsafe.

> All targets below use the FE port **8080** (the installer default `ORWELL_PORT`). If you changed
> `ORWELL_PORT`, change it here too.

## WebSockets through the perimeter (WS Phase-1 turn-on)

The player tier ships a **multiplexed WebSocket transport** (ADR
[`0017`](../../docs/decisions/0017-multiplexed-websocket-session-transport.md); wire spec
`docs/design/websocket-phase1-protocol.md`) that re-hosts the live chat stream, the mirror
resume, and the HUD/presence pushes on **one socket per tab** at `GET /api/ws/session`. It is
**dormant by default** — the browser only *attempts* the upgrade when the front-end is started
with `ORWELL_WS_TRANSPORT=1` (add it to `data/.env`, then restart the FE). Unset ⇒ the page is
byte-identical and the proven SSE/poll stack carries everything, so turning it on is reversible
by flipping the flag back.

**Every terminator here passes the upgrade with no extra config**, and turning WS on does **not**
change what is exposed — it is the *same* FE route on the *same* port, so the "only the front-end
is ever exposed" rule above still holds unchanged.

| Terminator | WebSocket handling | Action needed |
|---|---|---|
| **Direct uvicorn** (LAN / loopback) | `websockets` is pinned in `frontend/requirements*.txt`; uvicorn's default `--ws auto` enables it. The systemd unit does **not** pass `--ws none`. | none |
| **Caddy** (`orwell https`, Option C) | `reverse_proxy` proxies the `Upgrade`/`Connection` handshake transparently, streams unbuffered, and applies no idle timeout to the hijacked connection. | none |
| **Cloudflare Tunnel** (Option A) | `cloudflared` + the Cloudflare edge proxy WebSockets natively. | none |
| **Pangolin / Newt** (Option B) | The Newt connector (Traefik-based) proxies WebSockets natively. | none |

Two things make the long-lived socket robust across any of these: the server sends an
application-level `ping` **every 20 s** (client replies `pong`), which keeps intermediaries from
idling the connection out; and a client that genuinely *cannot* upgrade (a restrictive corporate
MITM, an ancient browser) **falls back to the SSE/poll transport automatically** — that fallback
is a permanent path, not a transitional one, so a proxy that strips the upgrade degrades cleanly
rather than breaking the game.

**Verify the upgrade reaches uvicorn** (run from the origin host, adjusting scheme/host):

```bash
# Expect: HTTP/1.1 101 Switching Protocols  (a 200/400/404/426 means the upgrade was NOT proxied)
curl -sSi -o /dev/null -w '%{http_code}\n' \
  -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
  -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
  http://127.0.0.1:8080/api/ws/session
# Through the terminator, swap the URL for https://your-domain.example/api/ws/session
# (unauthenticated it will 101 then immediately close — that still proves the pipe).
```

## Option A — Cloudflare Tunnel + Access  *(recommended)*

Fastest path to internet-grade: an outbound-only tunnel (the origin opens **zero inbound ports**),
free unmetered DDoS + the free WAF managed ruleset + Bot Fight Mode, automatic edge HTTPS, and
Cloudflare **Access** (email-OTP / SSO) as a login wall in front of the FE.

- `cloudflared/config.yml` — the tunnel ingress (FE only; the engine is intentionally absent).

```bash
cloudflared tunnel login                       # pick the your-domain.example zone
cloudflared tunnel create orwell               # writes the UUID + credentials json
cloudflared tunnel route dns orwell your-domain.example
# copy cloudflared/config.yml to /etc/cloudflared/config.yml, fill in <TUNNEL-UUID>
sudo cloudflared service install && sudo systemctl enable --now cloudflared
```

Then in the dashboard: enable the **WAF Free Managed Ruleset** + **Bot Fight Mode**, add an
**Access** application over `your-domain.example` (email-OTP allow-list), and (optional) **Turnstile** on
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
