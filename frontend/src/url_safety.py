"""Outbound URL safety checks (SSRF hardening) and path-traversal guards.

Adapted from Nous Research hermes-agent gateway SSRF / path-traversal guards
(V-009 hardening, MIT © 2025 Nous Research).  See ``frontend/ACKNOWLEDGMENTS.md``
for attribution.

This module provides two distinct URL-safety modes:

1. **Embedding-endpoint mode** (``check_outbound_url``):
   Orwell is local-first — pointing the embedding endpoint at a loopback or LAN
   address (a local vLLM / llama.cpp / Ollama server) is a normal, intended setup.
   So this guard does **not** blanket-block private addresses by default — that would
   break the primary use case. What it *always* rejects:
     - a non-HTTP(S) scheme (``file://``, ``gopher://``, ``ftp://`` …), and
     - the link-local range (``169.254.0.0/16`` / ``fe80::/10``), i.e. the cloud
       instance-metadata SSRF credential-exfil vector — nobody serves embeddings
       there — plus multicast / reserved / unspecified addresses.
   For exposed multi-tenant deployments, set ``EMBEDDING_BLOCK_PRIVATE_IPS=true`` to
   additionally reject all private and loopback targets (full SSRF lockdown).

2. **Fail-closed mode** (``is_safe_url`` / ``assert_safe_url``):
   Used for any fetch where the target must be a public internet address — rejects
   loopback, all private ranges, link-local, and IPv6 scope-ID tricks.
   Unknown/ambiguous ⇒ False (fail closed, not open).

3. **Path-join guard** (``safe_join``):
   Joins path segments under a base directory, refusing any ``..``, absolute, or
   drive-letter traversal.
"""

import ipaddress
import os
import socket
from typing import Callable, List, Optional, Tuple
from urllib.parse import urlparse

ALLOWED_SCHEMES = ("http", "https")


def _default_resolver(host: str) -> List[str]:
    """Resolve a hostname to the list of IP strings it maps to (A + AAAA)."""
    return [info[4][0] for info in socket.getaddrinfo(host, None)]


def _classify(ip: ipaddress._BaseAddress, *, block_private: bool) -> Optional[str]:
    """Return a rejection reason for an IP, or None if it is allowed."""
    # IPv4-mapped IPv6 (e.g. ::ffff:169.254.169.254) — judge the embedded v4.
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    if ip.is_link_local:
        return f"link-local address blocked (SSRF metadata risk): {ip}"
    if ip.is_multicast or ip.is_reserved or ip.is_unspecified:
        return f"disallowed address: {ip}"
    if block_private and (ip.is_private or ip.is_loopback):
        return f"private/loopback address blocked: {ip}"
    return None


def check_outbound_url(
    url: str,
    *,
    block_private: bool = False,
    resolver: Optional[Callable[[str], List[str]]] = None,
) -> Tuple[bool, str]:
    """Validate a user-supplied outbound URL.

    Returns ``(ok, reason)``. ``ok`` is True only when the URL is safe to fetch.
    ``resolver`` is injectable so callers/tests can avoid real DNS.
    """
    if not isinstance(url, str):
        return False, "URL must be a string"
    if not url or not url.strip():
        return False, "URL is required"
    try:
        parsed = urlparse(url.strip())
    except Exception as e:  # pragma: no cover - urlparse is very tolerant
        return False, f"unparseable URL: {e}"

    if parsed.scheme.lower() not in ALLOWED_SCHEMES:
        return False, f"scheme must be http or https, got '{parsed.scheme or '(none)'}'"
    host = parsed.hostname
    if not host:
        return False, "URL has no host"

    resolve = resolver or _default_resolver
    try:
        raw_ips = resolve(host)
    except Exception as e:
        return False, f"host does not resolve: {e}"
    if not raw_ips:
        return False, "host does not resolve"

    for raw in raw_ips:
        try:
            ip = ipaddress.ip_address(raw.split("%")[0])  # strip IPv6 zone id
        except ValueError:
            continue
        reason = _classify(ip, block_private=block_private)
        if reason:
            return False, reason
    return True, "ok"


# ---------------------------------------------------------------------------
# Fail-closed URL guard (feature 0071)
# ---------------------------------------------------------------------------
# Unlike check_outbound_url (which permits local servers by default for the
# embedding use-case), these helpers always block private/loopback/link-local.
# Adapted from Nous Research hermes-agent gateway V-009 hardening.
# ---------------------------------------------------------------------------

def _is_dangerous_ip(addr: ipaddress._BaseAddress) -> bool:
    """Return True if *addr* is not a safe public internet address."""
    # Unwrap IPv4-mapped IPv6 first.
    if isinstance(addr, ipaddress.IPv6Address) and addr.ipv4_mapped is not None:
        addr = addr.ipv4_mapped
    return (
        addr.is_loopback
        or addr.is_private
        or addr.is_link_local
        or addr.is_multicast
        or addr.is_reserved
        or addr.is_unspecified
    )


def is_safe_url(url: str) -> bool:
    """Return False if *url* targets a private/loopback/link-local/IPv6-scope address.

    Fail-closed: unknown, ambiguous, or unresolvable → False (not True).

    Rejects:
    - non-http/https schemes
    - loopback (``127.x.x.x``, ``::1``, ``localhost``)
    - private ranges (``10.x``, ``172.16–31.x``, ``192.168.x``, ``fc00::/7``)
    - link-local (``169.254.x``, ``fe80::``)
    - IPv6 scope-id trick (any ``%`` in the host)
    - unresolvable hostnames

    Allows: public internet addresses only.
    """
    try:
        if not isinstance(url, str) or not url.strip():
            return False
        parsed = urlparse(url.strip())
        if parsed.scheme.lower() not in ALLOWED_SCHEMES:
            return False
        host = parsed.hostname
        if not host:
            return False
        # IPv6 scope-id trick: fe80::1%eth0 looks like link-local scoped to
        # an interface; the raw host from urlparse preserves the %-encoding.
        if "%" in host:
            return False
        # Try to parse the host as a literal IP first (no DNS needed).
        try:
            addr = ipaddress.ip_address(host)
            return not _is_dangerous_ip(addr)
        except ValueError:
            pass  # not a literal IP — resolve below
        # Hostname: resolve to IPs and check every one (fail closed: any bad
        # resolution → reject).
        try:
            ips = [
                ipaddress.ip_address(info[4][0])
                for info in socket.getaddrinfo(host, None)
            ]
        except Exception:
            return False  # unresolvable → fail closed
        if not ips:
            return False
        return all(not _is_dangerous_ip(ip) for ip in ips)
    except Exception:
        return False  # any unexpected error → fail closed


def assert_safe_url(url: str) -> None:
    """Raise ``ValueError`` if ``is_safe_url`` returns False.

    Use this as a guard before any outward fetch that must reach a public
    internet address.
    """
    if not is_safe_url(url):
        raise ValueError(
            f"URL rejected by SSRF guard (private/loopback/link-local or "
            f"non-public address): {url!r}"
        )


# ---------------------------------------------------------------------------
# Path-join guard (feature 0071)
# ---------------------------------------------------------------------------

def safe_join(base: str, *parts: str) -> str:
    """Join *parts* under *base*, refusing any traversal.

    Raises ``ValueError`` if any segment:
    - is ``..`` or contains ``..`` as a component
    - starts with ``/`` or ``\\`` (absolute)
    - contains a Windows drive letter (e.g. ``C:``)

    Also raises if the resolved result is not a subpath of *base* (belt-and-
    suspenders after the segment checks).

    Safe usage::

        path = safe_join("/var/data", "uploads", "avatar.png")
        # → "/var/data/uploads/avatar.png"
    """
    base_real = os.path.realpath(base)
    joined = base_real
    for part in parts:
        # Reject drive letters (Windows): any segment matching X: at the start.
        if len(part) >= 2 and part[1] == ":" and part[0].isalpha():
            raise ValueError(
                f"safe_join: Windows drive-letter segment rejected: {part!r}"
            )
        # Reject absolute segments.
        if part.startswith("/") or part.startswith("\\"):
            raise ValueError(
                f"safe_join: absolute segment rejected: {part!r}"
            )
        # Reject any segment that is literally ".." or that *contains* "..".
        norm_parts = part.replace("\\", "/").split("/")
        if any(p == ".." for p in norm_parts):
            raise ValueError(
                f"safe_join: parent-directory traversal segment rejected: {part!r}"
            )
        joined = os.path.join(joined, part)

    # Belt-and-suspenders: after OS normalisation the result must still be
    # under base_real (handles edge cases like embedded NUL, etc.).
    resolved = os.path.realpath(joined)
    if not (resolved == base_real or resolved.startswith(base_real + os.sep)):
        raise ValueError(
            f"safe_join: result {resolved!r} escapes base {base_real!r}"
        )
    return resolved
