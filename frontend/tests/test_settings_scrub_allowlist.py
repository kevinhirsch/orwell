"""Default-DENY allow-list scrub for the auth-exempt /api/auth/settings projection.

The auth-exempt projection (``scrub_settings`` in src/settings_scrub.py) is what a
NON-ADMIN / UNAUTHENTICATED caller of /api/auth/settings receives. It must be a
DEFAULT-DENY allow-list, not a deny-list of secret-SHAPED names — otherwise a
secret stored under a key NOT named like a secret (e.g. ``openai_authorization``,
``smtp_login``, a bare ``anthropic``, or any future field) leaks to an
unauthenticated caller reachable over a tunnel / reverse proxy.

These tests are fail-before / pass-after the deny-list → allow-list flip:
  - a secret under a NON-secret-shaped key is DROPPED (deny-list would have
    returned it verbatim → fail before; dropped → pass after);
  - the known-safe pre-login fields (keybinds / TTS / cosmetic login bg) ARE
    returned;
  - nested unknown/secret keys are dropped (only allow-listed top-level keys
    survive).
"""

import sys
import os

_FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _FRONTEND not in sys.path:
    sys.path.insert(0, _FRONTEND)

from src.settings_scrub import scrub_settings, SAFE_AUTH_EXEMPT_KEYS


# ── The leak this fix closes: secrets under NON-secret-shaped key names ──

class TestNonSecretShapedSecretsDropped:
    """The deny-list masked only ``*_api_key`` / ``*_token`` -shaped names; a
    secret under any other key name leaked. The allow-list drops them all."""

    def test_bare_provider_name_holding_a_key_is_dropped(self):
        out = scrub_settings({"anthropic": "sk-ant-LEAKED-SECRET"})
        assert "anthropic" not in out
        assert "sk-ant-LEAKED-SECRET" not in out.values()

    def test_authorization_header_field_is_dropped(self):
        out = scrub_settings({"openai_authorization": "Bearer sk-LEAKED"})
        assert "openai_authorization" not in out

    def test_smtp_login_is_dropped(self):
        out = scrub_settings({"smtp_login": "secret@example.com"})
        assert "smtp_login" not in out

    def test_arbitrary_custom_secret_field_is_dropped(self):
        out = scrub_settings({"custom_token_field": "LEAKED", "some_creds": "LEAKED2"})
        assert out == {}

    def test_future_unknown_field_is_dropped_by_default(self):
        # The whole point: an allow-list cannot leak a field it does not know about.
        out = scrub_settings({"a_field_added_next_year": "anything"})
        assert out == {}


# ── Known secret-shaped names stay dropped (no regression) ──

class TestSecretShapedNamesStillDropped:
    def test_api_keys_dropped(self):
        secrets = {
            "brave_api_key": "x", "tavily_api_key": "y", "serper_api_key": "z",
            "google_pse_key": "k",
        }
        assert scrub_settings(secrets) == {}

    def test_endpoint_and_routing_config_dropped(self):
        # Capability handles / provider routing — not secret-SHAPED, but sensitive.
        cfg = {
            "default_endpoint_id": "ep1", "utility_endpoint_id": "ep2",
            "openrouter_provider": {"order": ["x"]},
            "reminder_webhook_integration_id": "int-1",
            "search_url": "http://internal.local/search",
            "app_public_url": "https://chat.example.com",
            "urgent_email_prompt": "operator prompt text",
        }
        assert scrub_settings(cfg) == {}


# ── Known-safe pre-login fields ARE returned ──

class TestSafeFieldsReturned:
    def test_keybinds_returned(self):
        kb = {"search": "ctrl+k", "toggle_sidebar": "ctrl+b"}
        out = scrub_settings({"keybinds": kb})
        assert out == {"keybinds": kb}

    def test_tts_prefs_returned(self):
        tts = {
            "tts_enabled": True, "tts_provider": "openai",
            "tts_model": "tts-1", "tts_voice": "alloy", "tts_speed": "1",
        }
        assert scrub_settings(tts) == tts

    def test_cosmetic_login_background_returned(self):
        cosmetic = {
            "login_background": "gradient", "login_gradient_preset": "aurora",
            "login_gradient_speed": 26, "login_particles_color": "",
        }
        assert scrub_settings(cosmetic) == cosmetic

    def test_image_and_vision_model_names_returned(self):
        m = {"image_model": "google/gemini-2.5-flash-image", "vision_model": "gpt-4o"}
        assert scrub_settings(m) == m

    def test_operator_dial_enums_returned(self):
        dials = {"overseer_mode": "off", "faithfulness_mode": "shadow"}
        assert scrub_settings(dials) == dials


# ── Mixed: only the allow-listed keys survive ──

class TestMixedProjection:
    def test_mixed_blob_keeps_only_safe_keys(self):
        blob = {
            # safe
            "keybinds": {"search": "ctrl+k"},
            "tts_enabled": True,
            "time_of_day_enabled": True,
            # NOT safe (secret-shaped + non-secret-shaped + handles)
            "brave_api_key": "SECRET",
            "anthropic": "sk-ant-LEAKED",
            "default_endpoint_id": "ep1",
            "openrouter_provider": {"key": "nested-secret"},
        }
        out = scrub_settings(blob)
        assert set(out.keys()) == {"keybinds", "tts_enabled", "time_of_day_enabled"}
        # no secret value anywhere in the projection
        flat = repr(out)
        assert "SECRET" not in flat
        assert "sk-ant-LEAKED" not in flat
        assert "nested-secret" not in flat

    def test_nested_secret_under_unknown_parent_is_dropped_wholesale(self):
        # The deny-list recursed into nested dicts; the allow-list simply drops
        # the whole non-allow-listed parent — the nested secret never appears.
        out = scrub_settings({"email_account": {"smtp_password": "LEAKED"}})
        assert out == {}


# ── Edge cases / robustness ──

class TestRobustness:
    def test_non_dict_returns_empty(self):
        assert scrub_settings(None) == {}
        assert scrub_settings([1, 2, 3]) == {}
        assert scrub_settings("nope") == {}

    def test_empty_dict(self):
        assert scrub_settings({}) == {}

    def test_does_not_mutate_input(self):
        src = {"keybinds": {"search": "ctrl+k"}, "brave_api_key": "SECRET"}
        scrub_settings(src)
        assert src == {"keybinds": {"search": "ctrl+k"}, "brave_api_key": "SECRET"}

    def test_allow_list_is_a_frozenset_of_known_safe_keys(self):
        # Guard: no secret-shaped key ever sneaks onto the allow-list.
        for k in SAFE_AUTH_EXEMPT_KEYS:
            assert not k.endswith("_api_key")
            assert not k.endswith("_secret")
            assert not k.endswith("_token")
            assert not k.endswith("_password")
            assert not k.endswith("_key") or k == "keybinds"  # 'keybinds' is not '*_key'
