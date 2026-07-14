"""#11 snappy UX — model-config saves show a synchronous "Saving…" hint.

A model-config <select> change POSTs to /api/auth/settings and previously showed
nothing until the round-trip returned ('Saved' was set only AFTER the await) — so
a slow save read as "did my click even register?". The fix is a shared _savingHint()
helper set BEFORE each fetch (mirroring the overseer-dial save that already did it),
wired into the model-config saves (default chat, utility, faithfulness, image,
vision, research). Each caller overwrites it with 'Saved' / 'Failed to save' after.
"""
import re
from pathlib import Path

FE = Path(__file__).resolve().parents[1]
SETTINGS = (FE / "static" / "js" / "settings.js").read_text(encoding="utf-8")


def test_helper_sets_saving_before_a_post():
    m = re.search(r"function _savingHint\(msg\)\s*\{(.*?)\n\}", SETTINGS, re.S)
    assert m, "_savingHint helper must exist"
    body = m.group(1)
    assert "Saving" in body
    assert "textContent" in body


def test_every_model_config_save_calls_the_hint_before_its_fetch():
    """Each save must invoke _savingHint(msg) before awaiting the settings POST."""
    # 6 model-config saves are wired; the helper definition is the 7th occurrence.
    assert SETTINGS.count("_savingHint(msg)") >= 7, "expected the helper + its 6 call sites"
    # structural check: the hint must appear BEFORE the fetch inside each wired save.
    # Sample the default-chat save (the highest-traffic one).
    m = re.search(r"async function saveDefault\(\)\s*\{(.*?)\n  \}", SETTINGS, re.S)
    assert m, "saveDefault must exist"
    body = m.group(1)
    i_hint = body.find("_savingHint(msg)")
    i_fetch = body.find("fetch('/api/auth/settings'")
    assert i_hint != -1 and i_fetch != -1
    assert i_hint < i_fetch, "the Saving… hint must be set before the POST"
