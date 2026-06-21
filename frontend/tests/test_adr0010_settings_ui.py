"""ADR 0010 / feature 0069 — the Token Economy admin settings UI is wired.

Source-pins (matching test_s1s2_settings_wiring.py's convention): the controls exist in index.html,
`initTokenEconomySettings` reads/writes `/api/auth/settings` for every token-economy key, the per-class
`reasoning_budget` dict is rebuilt from the four selects, and the OpenRouter provider JSON is validated
before save. The POST /settings route already persists these DEFAULT_SETTINGS keys
(test_adr0010_admin_token_economy.py covers the route + the keys).
"""
import os

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(rel):
    with open(os.path.join(FRONTEND, rel), encoding="utf-8") as f:
        return f.read()


def test_controls_exist_in_index_html():
    html = _read("static/index.html")
    for cid in (
        "set-reasoningNarration", "set-reasoningExtract", "set-reasoningCasting",
        "set-reasoningAuthoring", "set-tokenSpendAlert", "set-tokenPinThreshold",
        "set-contextTieringToggle", "set-openrouterProvider", "set-tokenEconomyMsg",
    ):
        assert f'id="{cid}"' in html, f"missing Token Economy control: {cid}"
    assert "Token Economy" in html


def test_init_is_defined_and_registered():
    js = _read("static/js/settings.js")
    assert "async function initTokenEconomySettings" in js, "the init function must exist"
    assert "initTokenEconomySettings();" in js, "the init must be called in the settings bootstrap"


def test_init_reads_and_writes_every_token_economy_key():
    js = _read("static/js/settings.js")
    start = js.index("async function initTokenEconomySettings")
    block = js[start:]
    end = block.index("/* ── Vision ── */")
    block = block[:end]
    for key in (
        "reasoning_budget", "token_spend_alert_usd", "token_pin_threshold_tokens",
        "context_tiering_enabled", "openrouter_provider",
    ):
        assert key in block, f"the init must read/write {key}"
    assert "/api/auth/settings" in block, "must use the settings route the rest of the UI uses"
    # the four call classes drive the reasoning_budget dict
    for cls in ("narration", "utility-extraction", "casting", "background-authoring"):
        assert f"'{cls}'" in block, f"reasoning_budget must map the {cls} class"
    # the provider field is parsed + object-validated before saving (no garbage to the API)
    assert "JSON.parse" in block, "provider JSON must be parsed"
    assert "Array.isArray" in block, "provider must be validated as an object (not a list)"


def test_keys_present_in_default_settings():
    from src.settings import DEFAULT_SETTINGS
    assert DEFAULT_SETTINGS["reasoning_budget"] == {}
    assert DEFAULT_SETTINGS["openrouter_provider"] == {}
    assert DEFAULT_SETTINGS["token_spend_alert_usd"] == 0.0
    assert DEFAULT_SETTINGS["token_pin_threshold_tokens"] == 0
    assert DEFAULT_SETTINGS["context_tiering_enabled"] is False
