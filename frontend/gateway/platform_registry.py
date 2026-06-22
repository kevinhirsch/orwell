"""Platform adapter registry for the multi-platform gateway (feature 0072).

Adapted from hermes-agent gateway/platform_registry.py
(MIT © 2025 Nous Research — see frontend/ACKNOWLEDGMENTS.md).

Each platform adapter self-registers here on import so adding a new platform
never touches core routing code.
"""

from typing import Optional
from .platforms.base import PlatformAdapter


class PlatformRegistry:
    """A simple registry mapping platform_id → PlatformAdapter.

    Adapters call :meth:`register` at import time (self-registering pattern).
    The gateway webhook route calls :meth:`get` to dispatch an inbound message.
    """

    def __init__(self) -> None:
        self._adapters: dict[str, PlatformAdapter] = {}

    def register(self, adapter: PlatformAdapter) -> None:
        """Register *adapter* under its declared ``platform_id``."""
        pid = adapter.platform_id
        if pid in self._adapters:
            raise ValueError(f"Platform '{pid}' is already registered")
        self._adapters[pid] = adapter

    def get(self, platform_id: str) -> Optional[PlatformAdapter]:
        """Return the adapter for *platform_id*, or None if unknown."""
        return self._adapters.get(platform_id)

    def all_ids(self) -> list[str]:
        """Return the list of registered platform IDs (for diagnostics)."""
        return list(self._adapters.keys())


# Module-level singleton — imported by adapters and the gateway routes.
platform_registry = PlatformRegistry()
