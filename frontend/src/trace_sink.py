"""Feature 0112 — the opt-in, fail-soft ``TraceSink`` forwarding port.

The *external* counterpart to 0079's internal diagnostic log and the sibling of the
token/sync ledgers: where those persist Vault-free facts on-box, a ``TraceSink`` ships the
same Vault-free ``TraceRecord`` (built in ``src/llm_trace.py``) to an operator-chosen,
provider-agnostic, self-hostable destination (OTLP / Langfuse / any JSON-over-HTTP sink).

Discipline (identical to the FE-driven write-backs and the token ledger)
------------------------------------------------------------------------
  * **Opt-in with a no-op default.** No configured endpoint ⇒ ``resolve_trace_sink``
    returns ``NoopTraceSink`` and nothing is ever shipped — the game plays byte-identically
    to today. This is the safety contract (0112 scenario "the sink is opt-in").
  * **Fail-soft, best-effort, never harms the turn.** ``emit`` is async and swallows every
    error/timeout. A sink that raises or hangs can never fail or delay the player's turn
    (0112 scenario "a failing sink never harms the turn"). The HTTP call carries a short,
    bounded timeout.
  * **Vault-free by construction.** The sink only ever receives the ``TraceRecord`` the
    record builder produced — it holds no Vault handle and reads no engine secret. The
    record builder is the single choke point for the Vault-free guarantee (see llm_trace).

The two adapters:
  * ``NoopTraceSink`` — the default; ``emit`` is a no-op.
  * ``OtlpTraceSink`` — POSTs the record as JSON to the configured endpoint. OTLP/Langfuse
    and most observability sinks accept a JSON body over HTTP; a destination that wants a
    different envelope is a thin subclass. Provider-agnostic and self-hostable (the deploy
    ships an opt-in Langfuse ``docker-compose`` so a private/LAN box keeps everything local).
"""

from __future__ import annotations

import logging
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

# A short, bounded ship timeout — telemetry must never delay a turn. Even when we ``await``
# the emit, the worst case is this many seconds, and it runs AFTER the turn's content has
# already streamed to the player.
_DEFAULT_TIMEOUT_S = 3.0


class TraceSink:
    """The forwarding port. ``emit(record)`` is async, fail-soft, best-effort."""

    async def emit(self, record: Dict[str, Any]) -> None:  # pragma: no cover - interface
        raise NotImplementedError


class NoopTraceSink(TraceSink):
    """The default adapter — ships nothing. Chosen whenever observability is unconfigured."""

    async def emit(self, record: Dict[str, Any]) -> None:
        return None


class OtlpTraceSink(TraceSink):
    """Ship the Vault-free record as a JSON POST to an OTLP/Langfuse/JSON-over-HTTP endpoint.

    Provider-agnostic: the body is the flat ``TraceRecord``. Fail-soft — a network error,
    a non-2xx, or a timeout is swallowed and never propagates to the turn."""

    def __init__(self, endpoint: str, *, timeout_s: float = _DEFAULT_TIMEOUT_S,
                 headers: Optional[Dict[str, str]] = None) -> None:
        self.endpoint = endpoint
        self.timeout_s = timeout_s
        self.headers = dict(headers or {})
        self.headers.setdefault("Content-Type", "application/json")

    async def emit(self, record: Dict[str, Any]) -> None:
        if not self.endpoint:
            return
        try:
            import httpx
            timeout = httpx.Timeout(self.timeout_s)
            async with httpx.AsyncClient(timeout=timeout) as client:
                await client.post(self.endpoint, json=record, headers=self.headers)
        except Exception as e:  # best-effort — an emit failure NEVER touches the turn
            try:
                logger.debug("[orwell] trace-sink emit failed (swallowed): %s", e)
            except Exception:
                pass
            return None


def resolve_trace_sink(settings: Optional[Dict[str, Any]] = None) -> TraceSink:
    """Resolve the active sink from settings (read per-request, like ``_resolve_llm_fn``).

    No endpoint / observability disabled ⇒ the no-op stands (byte-identical, nothing shipped).
    A configured endpoint ⇒ the OTLP/Langfuse adapter. Defensive: ``settings`` may be ``None``
    or missing keys; any resolution failure falls back to the no-op (telemetry never breaks the
    game). ``settings`` is an already-read dict; when omitted we read the live settings ourselves."""
    try:
        if settings is None:
            settings = _live_settings()
        if not isinstance(settings, dict):
            return NoopTraceSink()
        if not settings.get("observability_enabled", False):
            return NoopTraceSink()
        endpoint = settings.get("observability_endpoint") or ""
        if not isinstance(endpoint, str) or not endpoint.strip():
            return NoopTraceSink()
        return OtlpTraceSink(endpoint.strip())
    except Exception:
        return NoopTraceSink()


def _live_settings() -> Dict[str, Any]:
    """Read the two sink-selection settings live (per-request; no restart). Fail-open ⇒ {}."""
    try:
        from src.settings import get_setting
        return {
            "observability_enabled": bool(get_setting("observability_enabled", False)),
            "observability_endpoint": get_setting("observability_endpoint", "") or "",
        }
    except Exception:
        return {}
