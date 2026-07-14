"""#11 snappy UX — model-config saves show a synchronous "Saving…" hint AND never
falsely report "Saved" on a non-2xx response.

A model-config <select> change POSTs to /api/auth/settings and previously showed
nothing until the round-trip returned ('Saved' was set only AFTER the await) — so
a slow save read as "did my click even register?". The fix is a shared _savingHint()
helper set BEFORE each fetch (mirroring the overseer-dial save that already did it).

Separately (ruling #1599 — nothing fails softly): the handlers treated ANY resolved
fetch as success, so an HTTP 4xx/5xx could still print 'Saved'. They now POST through
_postSettings(), which throws on a non-ok response so the caller's catch shows
'Failed to save'.
"""
import re
from pathlib import Path

FE = Path(__file__).resolve().parents[1]
SETTINGS = (FE / "static" / "js" / "settings.js").read_text(encoding="utf-8")

# The six model-config saves, each keyed by a marker that is UNIQUE to that save's
# _postSettings(...) call — so the per-save assertions can't be satisfied by a sibling.
SAVES = [
    ("default chat", "default_endpoint_id: epSel.value"),
    ("utility", "utility_endpoint_id: epSel.value"),
    ("faithfulness", "faithfulness_endpoint_id: epSel.value"),
    ("image", "image_gen_enabled:"),
    ("vision", "vision_enabled:"),
    ("research", "_postSettings(payload)"),
]


def test_helper_sets_the_exact_saving_text_with_the_muted_color():
    m = re.search(r"function _savingHint\(msg\)\s*\{(.*?)\n\}", SETTINGS, re.S)
    assert m, "_savingHint helper must exist"
    body = m.group(1)
    # exact copy, not a loose substring (guards against 'Saving now' / 'Not Saving' drift)
    assert "msg.textContent = 'Saving…'" in body, "helper must set exactly 'Saving…'"
    assert "var(--fg-muted)" in body, "the hint must use the muted color token"


def test_each_save_hints_before_posting_scoped_to_its_own_body():
    """For EACH of the six saves, within its own try block, _savingHint(msg) must precede
    the _postSettings(...) call. Scoped per-save so one save can't satisfy another."""
    for name, marker in SAVES:
        idx = SETTINGS.find(marker)
        assert idx != -1, f"{name}: marker {marker!r} not found"
        try_idx = SETTINGS.rfind("try {", 0, idx)
        assert try_idx != -1, f"{name}: save must run inside a try block"
        body = SETTINGS[try_idx: idx + len(marker) + 40]
        hint = body.find("_savingHint(msg)")
        post = body.find("_postSettings(")
        assert hint != -1, f"{name}: must set the Saving… hint"
        assert post != -1, f"{name}: must POST through _postSettings"
        assert hint < post, f"{name}: the Saving… hint must be set BEFORE the POST"


def test_postSettings_throws_on_a_non_ok_response():
    """A non-2xx settings response must raise so the catch shows 'Failed to save', not 'Saved'."""
    m = re.search(r"async function _postSettings\(body\)\s*\{(.*?)\n\}", SETTINGS, re.S)
    assert m, "_postSettings helper must exist"
    body = m.group(1)
    assert "!r.ok" in body and "throw" in body, "must throw on a non-ok response"
