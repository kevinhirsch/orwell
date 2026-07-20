"""BL-057 — debug-bundle redaction targets CREDENTIAL keys, not any NAME containing "secret".

The bundle redaction was redacting ``ORWELL_SECRET_PACING`` (a feature flag) purely because the key
NAME contains the substring "SECRET". A feature flag is not a credential; its value must cross the
bundle intact. Real credentials — api keys, tokens, passwords, `client_secret` / `SECRET_KEY` /
trailing `_secret` — must STILL be redacted. This pins both directions.
"""
import routes.admin_health_routes as ahr


# ── the env/config section (_redact_config → _SECRET_RE) ───────────────────────────

def test_feature_flag_named_secret_is_not_redacted_in_config():
    cfg = ahr._redact_config({
        "ORWELL_SECRET_PACING": "0.35",          # a feature flag — NAME has "secret", value is not a credential
        "ORWELL_ENGINE_TOKEN": "t0p",            # a real credential
        "AUTH_SECRET_KEY": "signing-key",        # a real credential (secret_key shape)
        "ORWELL_CLIENT_SECRET": "cs",            # a real credential (client_secret shape)
        "ORWELL_ENGINE_PORT": "8765",            # ordinary ops value
    })
    assert cfg["ORWELL_SECRET_PACING"] == "0.35"          # NOT redacted — flag value crosses intact
    assert cfg["ORWELL_ENGINE_TOKEN"] == ahr.REDACTED     # redacted
    assert cfg["AUTH_SECRET_KEY"] == ahr.REDACTED         # redacted
    assert cfg["ORWELL_CLIENT_SECRET"] == ahr.REDACTED    # redacted
    assert cfg["ORWELL_ENGINE_PORT"] == "8765"            # crosses intact


# ── the generic bundle scrub (_scrub_bundle → _BUNDLE_SECRET_KEY_RE) ───────────────

def test_scrub_bundle_keeps_secret_named_flag_but_redacts_credentials():
    obj = {
        "ORWELL_SECRET_PACING": "0.35",     # flag — keep
        "secret_pacing": "on",              # flag — keep
        "client_secret": "cs-value",        # credential — redact
        "api_key": "sk-abc",                # credential — redact
        "authorization": "Bearer xyz",      # credential — redact
        "webhook_secret": "wh",             # credential — redact
        "inputTokens": "1234",              # count field — keep (token(?!s))
        "maxTokens": "4096",                # count field — keep
    }
    out = ahr._scrub_bundle(obj)
    assert out["ORWELL_SECRET_PACING"] == "0.35"
    assert out["secret_pacing"] == "on"
    assert out["client_secret"] == ahr.REDACTED
    assert out["api_key"] == ahr.REDACTED
    assert out["authorization"] == ahr.REDACTED
    assert out["webhook_secret"] == ahr.REDACTED
    assert out["inputTokens"] == "1234"
    assert out["maxTokens"] == "4096"


def test_scrub_bundle_token_prefix_is_boundary_aware():
    """`token(?![a-z0-9])` must not over-match benign TOKENIZE* keys, while the real credential
    `*_token` forms are still redacted and the plural COUNT field survives."""
    obj = {
        "TOKENIZER": "cl100k_base",          # benign — a tokenizer name, NOT a credential
        "TOKENIZED": "true",                 # benign
        "TOKENIZATION_MODE": "bpe",          # benign
        "tokens": "512",                     # plural COUNT field — keep
        "access_token": "at-secret",         # credential — redact
        "api_token": "apitok-secret",        # credential — redact
        "token": "bare-secret",              # credential — redact
        "authorization": "Bearer z",         # credential — redact
        "bearer": "b-secret",                # credential — redact
    }
    out = ahr._scrub_bundle(obj)
    assert out["TOKENIZER"] == "cl100k_base"     # value crosses intact
    assert out["TOKENIZED"] == "true"
    assert out["TOKENIZATION_MODE"] == "bpe"
    assert out["tokens"] == "512"
    assert out["access_token"] == ahr.REDACTED
    assert out["api_token"] == ahr.REDACTED
    assert out["token"] == ahr.REDACTED
    assert out["authorization"] == ahr.REDACTED
    assert out["bearer"] == ahr.REDACTED
