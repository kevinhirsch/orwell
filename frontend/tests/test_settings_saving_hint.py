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

# Every model-config save wired for the Saving… hint, with a stable anchor into its body.
SAVE_FUNCS = [
    ("saveDefault", r"async function saveDefault\(\)\s*\{(.*?)\n  \}"),
    ("utility", r"utility_endpoint_id:.*?\n\s*\}\);"),   # sampled via its body below
]


def _fn_body(name):
    m = re.search(rf"async function {name}\(\)\s*\{{(.*?)\n  \}}", SETTINGS, re.S)
    return m.group(1) if m else None


def test_helper_sets_saving_with_the_muted_color():
    m = re.search(r"function _savingHint\(msg\)\s*\{(.*?)\n\}", SETTINGS, re.S)
    assert m, "_savingHint helper must exist"
    body = m.group(1)
    assert "Saving" in body and "textContent" in body
    assert "var(--fg-muted)" in body, "the hint must use the muted color token"


def test_every_touched_save_hints_before_posting():
    """Each of the 6 model-config saves calls _savingHint(msg) before its settings POST."""
    # 6 call sites + 1 helper definition.
    assert SETTINGS.count("_savingHint(msg)") >= 7
    # Verify ordering in each identifiable save body: the hint precedes the POST helper.
    # The 6 bodies each contain a _postSettings(...) call; assert the hint comes first.
    for marker in (
        "default_endpoint_id: epSel.value",
        "utility_endpoint_id: epSel.value",
        "faithfulness_endpoint_id: epSel.value",
        "image_gen_enabled:",
        "vision_enabled:",
        "_postSettings(payload)",
    ):
        i_marker = SETTINGS.find(marker)
        assert i_marker != -1, f"expected a wired save containing {marker!r}"
        # the nearest preceding _savingHint(msg) must be within the same try block (<~600 chars)
        window = SETTINGS[max(0, i_marker - 600):i_marker]
        assert "_savingHint(msg)" in window, f"{marker!r} save must hint before posting"


def test_saves_route_through_postSettings_which_throws_on_non_ok():
    """A non-2xx settings response must raise so the catch shows 'Failed to save', not 'Saved'."""
    m = re.search(r"async function _postSettings\(body\)\s*\{(.*?)\n\}", SETTINGS, re.S)
    assert m, "_postSettings helper must exist"
    body = m.group(1)
    assert "!r.ok" in body and "throw" in body, "must throw on a non-ok response"
    # all six model-config saves must use it (helper def + 6 calls = 7 occurrences)
    assert SETTINGS.count("_postSettings(") >= 7
