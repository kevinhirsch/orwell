"""Tests for feature 0071 — secret redaction helper.

Checks every pattern in the redaction table, verifies non-secret text is
unchanged, and validates the log-path wiring via the RedactingFilter.
"""
from __future__ import annotations

import logging
import sys
import os

# Allow imports from the frontend/src package without a package install.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from src.secret_redaction import redact, RedactingFilter, install_log_redaction

_MASK = "[REDACTED]"


# ---------------------------------------------------------------------------
# Vendor-prefixed API keys
# ---------------------------------------------------------------------------

class TestVendorPrefixedKeys:
    def test_openai_sk_key(self):
        secret = "sk-abcdefghijklmnopqrstuvwxyz1234"
        out = redact(f"using key {secret} now")
        assert secret not in out
        assert _MASK in out

    def test_short_sk_not_redacted(self):
        # Under the minimum suffix length — should NOT be redacted.
        short = "sk-abc"
        out = redact(f"code {short} end")
        assert short in out

    def test_github_ghp_pat(self):
        secret = "ghp_abcdefghijklmnopqrstuvwxyz12345"
        out = redact(f"token: {secret}")
        assert secret not in out
        assert _MASK in out

    def test_groq_gsk_key(self):
        secret = "gsk_abcdefghijklmnopqrstuvwxyz12"
        out = redact(f"endpoint api_key={secret}")
        assert secret not in out
        assert _MASK in out

    def test_xai_key(self):
        secret = "xai-abcdefghijklmnopqrstu"
        out = redact(f"xai key: {secret}")
        assert secret not in out
        assert _MASK in out

    def test_google_aiza_key(self):
        secret = "AIzaSyabcdefghijklmnopqrs"
        out = redact(f"gcal api {secret}")
        assert secret not in out
        assert _MASK in out

    def test_gitlab_pat(self):
        secret = "glpat-abcdefghijklmnop1234"
        out = redact(f"ci token {secret}")
        assert secret not in out
        assert _MASK in out

    def test_surrounding_text_preserved(self):
        secret = "sk-thisissecretabcde"
        text = f"prefix {secret} suffix"
        out = redact(text)
        assert "prefix" in out
        assert "suffix" in out
        assert secret not in out


# ---------------------------------------------------------------------------
# Authorization / x-api-key header values
# ---------------------------------------------------------------------------

class TestAuthHeaders:
    def test_authorization_bearer(self):
        out = redact("Authorization: Bearer sk-abc1234567890")
        assert "Bearer" not in out or _MASK in out
        assert "sk-abc1234567890" not in out

    def test_authorization_token(self):
        out = redact("Authorization: Token ghp_abc1234567890abcde")
        assert "ghp_abc1234567890abcde" not in out
        assert _MASK in out

    def test_x_api_key_colon(self):
        out = redact("x-api-key: supersecretvalue123")
        assert "supersecretvalue123" not in out
        assert _MASK in out

    def test_authorization_header_name_kept(self):
        out = redact("Authorization: Bearer secret123456")
        assert "Authorization" in out

    def test_non_auth_text_untouched(self):
        text = "Content-Type: application/json"
        assert redact(text) == text


# ---------------------------------------------------------------------------
# URL query-parameter secrets
# ---------------------------------------------------------------------------

class TestUrlQueryParams:
    def test_api_key_param(self):
        url = "https://example.com/v1?api_key=sk-abcdefghijklmnop"
        out = redact(url)
        assert "sk-abcdefghijklmnop" not in out
        assert _MASK in out

    def test_token_param(self):
        url = "https://api.example.com/data?token=mysecrettoken12345"
        out = redact(url)
        assert "mysecrettoken12345" not in out
        assert _MASK in out

    def test_secret_param(self):
        url = "https://example.com/?secret=verysecretvalue99"
        out = redact(url)
        assert "verysecretvalue99" not in out
        assert _MASK in out

    def test_password_param(self):
        url = "https://db.example.com/?password=hunter2"
        out = redact(url)
        assert "hunter2" not in out
        assert _MASK in out

    def test_access_token_param(self):
        url = "https://oauth.example.com/cb?access_token=eyJhbGciOiJSUzI"
        out = redact(url)
        assert "eyJhbGciOiJSUzI" not in out
        assert _MASK in out

    def test_key_param(self):
        url = "https://maps.googleapis.com/maps?key=AIzaSyabcdef"
        out = redact(url)
        assert "AIzaSyabcdef" not in out
        assert _MASK in out

    def test_non_secret_params_untouched(self):
        url = "https://example.com/search?q=hello&lang=en&page=2"
        out = redact(url)
        assert out == url

    def test_host_and_path_preserved(self):
        url = "https://example.com/v1/api?token=abc123456789"
        out = redact(url)
        assert "example.com" in out
        assert "/v1/api" in out


# ---------------------------------------------------------------------------
# Non-secret text unchanged
# ---------------------------------------------------------------------------

class TestNonSecretUnchanged:
    def test_plain_text(self):
        text = "Hello, world! This is a normal log message."
        assert redact(text) == text

    def test_empty_string(self):
        assert redact("") == ""

    def test_json_no_secrets(self):
        text = '{"status": "ok", "count": 42}'
        assert redact(text) == text

    def test_url_no_secrets(self):
        url = "https://example.com/api/v2/users?page=1&limit=10"
        assert redact(url) == url


# ---------------------------------------------------------------------------
# Log-path wiring
# ---------------------------------------------------------------------------

class TestLogPathWiring:
    def _capture_log(self, message: str) -> str:
        """Emit *message* through a logger with a RedactingFilter and capture
        what the handler actually sees."""
        captured: list[str] = []

        class CapturingHandler(logging.Handler):
            def emit(self, record: logging.LogRecord) -> None:
                captured.append(record.getMessage())

        handler = CapturingHandler()
        handler.addFilter(RedactingFilter())
        test_logger = logging.getLogger(f"test_redaction_{id(self)}")
        test_logger.addHandler(handler)
        test_logger.setLevel(logging.DEBUG)
        test_logger.propagate = False
        test_logger.info(message)
        test_logger.removeHandler(handler)
        return captured[0] if captured else ""

    def test_secret_in_log_is_masked(self):
        out = self._capture_log("api key is sk-abcdefghijklmnopqrstu")
        assert "sk-abcdefghijklmnopqrstu" not in out
        assert _MASK in out

    def test_auth_header_in_log_is_masked(self):
        out = self._capture_log("sending Authorization: Bearer ghp_abcdef1234567890")
        assert "ghp_abcdef1234567890" not in out
        assert _MASK in out

    def test_non_secret_log_unchanged(self):
        msg = "game started for user player-42"
        out = self._capture_log(msg)
        assert out == msg

    def test_install_log_redaction_idempotent(self):
        # Calling install_log_redaction twice should not double-install.
        root_logger = logging.getLogger()
        f1 = install_log_redaction(root_logger)
        f2 = install_log_redaction(root_logger)
        assert f1 is f2, "install_log_redaction must be idempotent"

    def test_redacting_filter_passes_record(self):
        # filter() must return True so the record is not suppressed.
        f = RedactingFilter()
        record = logging.LogRecord(
            name="test", level=logging.INFO, pathname="", lineno=0,
            msg="normal message", args=(), exc_info=None,
        )
        assert f.filter(record) is True

    def test_redacting_filter_scrubs_in_place(self):
        f = RedactingFilter()
        record = logging.LogRecord(
            name="test", level=logging.INFO, pathname="", lineno=0,
            msg="key=%s", args=("sk-abcdefghijklmnop",), exc_info=None,
        )
        f.filter(record)
        # After filtering, msg should be the rendered + scrubbed message.
        assert "sk-abcdefghijklmnop" not in record.msg
        assert _MASK in record.msg
