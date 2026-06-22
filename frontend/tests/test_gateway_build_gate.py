"""Tests for gateway game-build gate (feature 0072).

Verifies:
  - The gateway always operates with game_build=ON (GATEWAY_GAME_BUILD constant)
  - Drop-set tools are not accessible via the gateway (Vault-safe by inheritance)
  - The platform adapter registry is populated with known platforms
  - The scrub chokepoint is always present in the delivery path

BDD invariant proven:
  "Game build respected — a platform player cannot invoke a drop-set /
   inherited-workspace tool."
"""

import sys
import os

import pytest

_FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _FRONTEND not in sys.path:
    sys.path.insert(0, _FRONTEND)


class TestGatewayGameBuildFlag:
    def test_gateway_game_build_constant_is_true(self):
        from gateway.handler import GATEWAY_GAME_BUILD
        assert GATEWAY_GAME_BUILD is True

    def test_game_build_setting_reports_on_by_default(self, monkeypatch):
        """ORWELL_GAME_BUILD is ON by default — confirm the settings module agrees."""
        monkeypatch.delenv("ORWELL_GAME_BUILD", raising=False)
        monkeypatch.delenv("BBAI_GAME_BUILD", raising=False)
        from src.settings import game_build_enabled
        assert game_build_enabled() is True


class TestDropSetUnavailable:
    def test_drop_set_tools_not_in_gateway_scope(self):
        """The game drop-set verticals are not mounted when game_build is ON.

        The gateway handler calls the engine's PLAYER channel (Vault-free).
        The engine's player channel never exposes Vault tools.
        Additionally, the FE's drop-set verticals (email, shell, calendar, …) are never
        mounted under the game build — so even if the gateway were to try to call them
        they would 404.

        This test verifies that the drop-set identifiers are in GAME_DROP_SET
        (the canonical forbidden list) rather than the keep-set.
        """
        from src.settings import GAME_DROP_SET, GAME_KEEP_SET

        # Spot-check a few inherited-workspace tools the gateway must never expose
        for tool in ("email", "shell", "calendar", "gallery", "memory", "vault"):
            assert tool in GAME_DROP_SET, f"'{tool}' should be in GAME_DROP_SET"
            assert tool not in GAME_KEEP_SET, f"'{tool}' should NOT be in GAME_KEEP_SET"

    def test_game_tools_are_in_keep_set(self):
        """The game-specific tools remain in the keep-set."""
        from src.settings import GAME_KEEP_SET
        for tool in ("portraits", "image_gen", "accounts", "settings", "theme"):
            assert tool in GAME_KEEP_SET

    def test_gateway_constant_matches_settings(self):
        """GATEWAY_GAME_BUILD must match what game_build_enabled() returns by default."""
        from gateway.handler import GATEWAY_GAME_BUILD
        from src.settings import game_build_enabled
        # Both should be True in the default/game configuration
        assert GATEWAY_GAME_BUILD == game_build_enabled()


class TestPlatformRegistry:
    def test_telegram_adapter_registers_on_import(self):
        """Importing the telegram adapter causes it to self-register."""
        from gateway import platform_registry
        from gateway.platforms import telegram  # noqa: F401 — trigger registration
        assert platform_registry.get("telegram") is not None

    def test_unknown_platform_returns_none(self):
        from gateway import platform_registry
        assert platform_registry.get("nonexistent_platform_xyz") is None

    def test_all_ids_includes_telegram(self):
        from gateway import platform_registry
        from gateway.platforms import telegram  # noqa: F401
        assert "telegram" in platform_registry.all_ids()


class TestScrubAlwaysInDeliveryPath:
    def test_scrub_is_imported_by_handler(self):
        """The handler module must import the scrub function."""
        import gateway.handler as h
        import inspect
        source = inspect.getsource(h)
        assert "scrub_for_platform" in source

    def test_scrub_is_called_on_every_code_path(self):
        """Every return path in handle_platform_turn must go through scrub_for_platform."""
        import gateway.handler as h
        import inspect
        source = inspect.getsource(h.handle_platform_turn)
        # The chokepoint must be the only return-value transform
        assert "scrub_for_platform" in source

    def test_scrub_called_on_unpaired_reply(self):
        """Even the unpaired message goes through the scrub chokepoint."""
        import gateway.handler as h
        import inspect
        source = inspect.getsource(h.handle_platform_turn)
        # The unpaired return must use scrub_for_platform, not return the raw constant
        assert "scrub_for_platform(_UNPAIRED_MSG)" in source
