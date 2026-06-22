"""frontend/gateway — multi-platform gateway (feature 0072).

A non-Vault player adapter that lets a player reach THEIR game from messaging
platforms (Telegram, etc.) over the same Vault-free MCP player channel. Vault-safe
by inheritance: the gateway only calls player-channel tools, never imports a TS port.

Key modules:
  pairing           — code-approval flow binding a platform identity to one orwell account
  scrub             — server-side reasoning/censor chokepoint (fires before every delivery)
  platform_registry — self-registering per-platform adapter registry
  platforms/base    — adapter contract (send / parse_inbound)
  platforms/telegram— Telegram adapter (the first platform wave)
  handler           — turn handler: route inbound → player channel → scrub → deliver
"""
from .platform_registry import platform_registry

__all__ = ["platform_registry"]
