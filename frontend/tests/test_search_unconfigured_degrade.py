"""BL-058 / F8 — an UNCONFIGURED SearXNG degrades cleanly to the no-key fallback.

On a fresh install ``search_url == ""`` while ``search_provider == "searxng"``, so
``_get_search_instance`` falls back to the localhost:8080 default that nothing serves — and every
SearXNG attempt died to ``[Errno 111] Connection refused`` (twice per query + the HTML fallback),
spamming the log and starving the move-in zeitgeist enrichment lane ("no-slices"). The fix
short-circuits an unconfigured SearXNG out of the provider chain so we go straight to DuckDuckGo.
"""
import os

import pytest

from services.search import core, providers


@pytest.fixture(autouse=True)
def _no_env_searxng(monkeypatch):
    monkeypatch.delenv("SEARXNG_INSTANCE", raising=False)


def _stub_settings(monkeypatch, settings: dict):
    monkeypatch.setattr(providers, "_get_search_settings", lambda: dict(settings))
    monkeypatch.setattr(core, "_get_search_settings", lambda: dict(settings))


def test_unconfigured_searxng_is_reported_unconfigured(monkeypatch):
    _stub_settings(monkeypatch, {"search_url": "", "search_provider": "searxng"})
    assert providers.searxng_configured() is False


def test_explicit_search_url_counts_as_configured(monkeypatch):
    _stub_settings(monkeypatch, {"search_url": "http://searx.local", "search_provider": "searxng"})
    assert providers.searxng_configured() is True


def test_env_override_counts_as_configured(monkeypatch):
    monkeypatch.setenv("SEARXNG_INSTANCE", "http://searx.example:8888")
    _stub_settings(monkeypatch, {"search_url": "", "search_provider": "searxng"})
    assert providers.searxng_configured() is True


def test_unconfigured_searxng_dropped_from_chain(monkeypatch):
    """The reported bug: an unconfigured SearXNG must NOT lead the chain (no refused-connection spam)."""
    _stub_settings(monkeypatch, {"search_url": "", "search_provider": "searxng"})
    chain = core._build_provider_chain("searxng")
    assert "searxng" not in chain
    assert chain == ["duckduckgo"]  # degrades straight to the no-key fallback


def test_configured_searxng_still_leads_chain(monkeypatch):
    _stub_settings(monkeypatch, {"search_url": "http://searx.local", "search_provider": "searxng"})
    chain = core._build_provider_chain("searxng")
    assert chain[0] == "searxng"
    assert "duckduckgo" in chain  # fallback still appended


def test_unconfigured_searxng_dropped_even_from_fallback_chain(monkeypatch):
    """A user-set fallback chain that names searxng also drops it while unconfigured."""
    _stub_settings(monkeypatch, {
        "search_url": "", "search_provider": "brave",
        "search_fallback_chain": "searxng,duckduckgo",
    })
    chain = core._build_provider_chain("brave")
    assert "searxng" not in chain
    assert chain == ["brave", "duckduckgo"]
