"""SEC-2 — opt-in gateway webhook verification (feature 0072 hardening).

The /gateway/webhook endpoint trusts the client-supplied platform identity as its only
credential. When a per-platform webhook secret is configured, the adapter must verify the
platform's signature header (Telegram echoes the setWebhook secret in
X-Telegram-Bot-Api-Secret-Token). Unset ⇒ behavior unchanged (opt-in).

Proves:
  - No secret configured ⇒ verify_webhook returns True (unchanged / local deploy unaffected).
  - Secret configured + matching header ⇒ True.
  - Secret configured + wrong / missing header ⇒ False (the route turns this into a 403).
"""

import os
import sys

import pytest

_FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _FRONTEND not in sys.path:
    sys.path.insert(0, _FRONTEND)

from gateway.platforms.telegram import TelegramAdapter

_HDR = "X-Telegram-Bot-Api-Secret-Token"


def test_no_secret_configured_is_unverified_passthrough(monkeypatch):
    monkeypatch.delenv("TELEGRAM_WEBHOOK_SECRET", raising=False)
    a = TelegramAdapter()
    # No secret ⇒ opt-in verification is off, so any (or no) header passes — unchanged behavior.
    assert a.verify_webhook({}) is True
    assert a.verify_webhook({_HDR: "anything"}) is True


def test_secret_configured_matching_header_passes(monkeypatch):
    monkeypatch.setenv("TELEGRAM_WEBHOOK_SECRET", "s3cr3t-token")
    a = TelegramAdapter()
    assert a.verify_webhook({_HDR: "s3cr3t-token"}) is True


@pytest.mark.parametrize("headers", [{}, {_HDR: ""}, {_HDR: "wrong"}, {"X-Other": "s3cr3t-token"}])
def test_secret_configured_bad_or_missing_header_rejected(monkeypatch, headers):
    monkeypatch.setenv("TELEGRAM_WEBHOOK_SECRET", "s3cr3t-token")
    a = TelegramAdapter()
    assert a.verify_webhook(headers) is False
