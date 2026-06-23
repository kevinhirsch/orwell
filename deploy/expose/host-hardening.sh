#!/usr/bin/env bash
# Host hardening for an Orwell public deploy — feature 0067 / ADR 0007.
#
# REFERENCE script: read it before running. Run as root on the PUBLIC host — the VPS under
# Pangolin/Caddy, or the origin host under a Cloudflare/Pangolin outbound tunnel. Debian/Ubuntu.
# Idempotent. It does NOT edit sshd_config (that's left to you so a bad rule can't lock you out);
# it prints the recommended sshd settings at the end.
#
# Usage:
#   MODE=tunnel ./host-hardening.sh     # outbound tunnel: NO inbound web ports (SSH only) — default
#   MODE=proxy  ./host-hardening.sh     # this host terminates TLS: also open 80/443
#   SSH_PORT=22 ALLOW_SSH_FROM=any ./host-hardening.sh
set -Eeuo pipefail

MODE="${MODE:-tunnel}"
SSH_PORT="${SSH_PORT:-22}"
ALLOW_SSH_FROM="${ALLOW_SSH_FROM:-any}"   # an IP/CIDR to restrict SSH to, or "any"

echo "==> Installing ufw, fail2ban, unattended-upgrades"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y ufw fail2ban unattended-upgrades

echo "==> Firewall (ufw): default deny incoming, allow outgoing"
# Lockout-safe ordering: put the SSH allow rule in place BEFORE the default-deny is enabled, and do
# NOT `ufw --force reset` first. A reset wipes all rules and leaves the deny-incoming default active
# during the window before the SSH allow lands — any failure under `set -Eeuo pipefail` in that gap
# aborts with no SSH rule ⇒ remote lockout (and every re-run discards coexisting rules). ufw rule
# adds are idempotent, so we set the allows first, then the defaults, then enable last.
if [ "$ALLOW_SSH_FROM" = "any" ]; then
  ufw allow "${SSH_PORT}/tcp" comment 'ssh'
else
  ufw allow from "$ALLOW_SSH_FROM" to any port "$SSH_PORT" proto tcp comment 'ssh (restricted)'
fi

if [ "$MODE" = "proxy" ]; then
  echo "    MODE=proxy: opening 80/443 (this host terminates TLS)"
  ufw allow 80/tcp  comment 'http (ACME + redirect)'
  ufw allow 443/tcp comment 'https'
else
  echo "    MODE=tunnel: NOT opening 80/443 — the connector dials out, nothing inbound but SSH"
fi

# Defaults applied AFTER the SSH allow exists, then enable last. (deny incoming / allow outgoing.)
ufw default deny incoming
ufw default allow outgoing
ufw --force enable
ufw status verbose

echo "==> fail2ban: enable the sshd jail"
cat >/etc/fail2ban/jail.d/orwell-sshd.local <<'EOF'
[sshd]
enabled  = true
maxretry = 4
findtime = 10m
bantime  = 1h
EOF
systemctl enable --now fail2ban
systemctl restart fail2ban

echo "==> Unattended security upgrades"
cat >/etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF
systemctl enable --now unattended-upgrades || true

cat <<'EOF'

==> DONE. Recommended /etc/ssh/sshd_config hardening (apply manually, then: systemctl reload ssh):
      PasswordAuthentication no
      PermitRootLogin no
      PubkeyAuthentication yes
    Use ed25519 keys. Verify you can log in with a key BEFORE disabling passwords.

    Also confirm the Orwell FE runs the public profile (it refuses to boot otherwise):
      ORWELL_PUBLIC=1  AUTH_ENABLED=true  LOCALHOST_BYPASS=false  SECURE_COOKIES=true
      ALLOWED_HOSTS=<your-domain>,www.<your-domain>  ALLOWED_ORIGINS=https://<your-domain>
EOF
