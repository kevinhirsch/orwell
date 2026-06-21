"""Feature 0067 / ADR 0007 — real client IP behind a proxy/tunnel.

Behind cloudflared (or any reverse proxy) the transport peer is 127.0.0.1 for every visitor, so a
per-IP login throttle keyed on it collapses to ONE global bucket. The fix resolves the real client
IP from the trusted forwarding header. Self-contained: imports only `src.rate_limiter`.
"""
from src.rate_limiter import client_ip, RateLimiter


class _Client:
    def __init__(self, host):
        self.host = host


class _Req:
    def __init__(self, host="127.0.0.1", headers=None):
        self.client = _Client(host)
        self.headers = headers or {}


TRUST = {"ORWELL_PUBLIC": "1"}


def test_direct_peer_when_proxy_not_trusted():
    # No trust flag ⇒ transport peer; forwarding headers are ignored so a directly-exposed
    # deployment cannot be spoofed by a forged CF-Connecting-IP.
    req = _Req(host="203.0.113.9", headers={"cf-connecting-ip": "198.51.100.7"})
    assert client_ip(req, env={}) == "203.0.113.9"


def test_global_bucket_without_resolution():
    # The defect the fix addresses: behind a tunnel every visitor looks like 127.0.0.1.
    a = _Req(host="127.0.0.1", headers={"cf-connecting-ip": "198.51.100.1"})
    b = _Req(host="127.0.0.1", headers={"cf-connecting-ip": "198.51.100.2"})
    assert client_ip(a, env={}) == client_ip(b, env={}) == "127.0.0.1"


def test_resolves_cf_connecting_ip_when_trusted():
    req = _Req(host="127.0.0.1", headers={"cf-connecting-ip": "198.51.100.7"})
    assert client_ip(req, env=TRUST) == "198.51.100.7"


def test_resolves_xff_first_hop():
    req = _Req(host="127.0.0.1", headers={"x-forwarded-for": "198.51.100.7, 10.0.0.1"})
    assert client_ip(req, env=TRUST) == "198.51.100.7"


def test_resolves_x_real_ip():
    req = _Req(host="127.0.0.1", headers={"x-real-ip": "198.51.100.7"})
    assert client_ip(req, env=TRUST) == "198.51.100.7"


def test_different_real_ips_get_independent_buckets():
    # The throttle is per real client IP, NOT one global bucket for every visitor.
    limiter = RateLimiter(max_requests=2, window_seconds=60)
    a = _Req(host="127.0.0.1", headers={"cf-connecting-ip": "198.51.100.1"})
    b = _Req(host="127.0.0.1", headers={"cf-connecting-ip": "198.51.100.2"})
    assert limiter.check(client_ip(a, env=TRUST)) is True
    assert limiter.check(client_ip(a, env=TRUST)) is True
    assert limiter.check(client_ip(a, env=TRUST)) is False  # A is throttled
    assert limiter.check(client_ip(b, env=TRUST)) is True   # B is unaffected
