"""Lane H / H6 — the Chats auto-sort control says "Tidy" once.

Product-owner report, verbatim:
  "Under Chats > Tidy, there is another tidy that needs to be removed."

The control is a split button inside the session-sort dropdown:

  [ * Tidy        | v ]   #auto-sort-sessions-btn  — the AI tidy (_runTidy(false))
  [ Clean up (no AI)  ]   #auto-sort-sessions-noai-btn — Phase-1 cleanup only
                          (_runTidy(true)), revealed by the #auto-sort-sessions-more
                          chevron.

Pre-H6 the sub-row was ALSO labeled bare "Tidy", so expanding the chevron showed
the word twice — two identical labels for two different actions. The fix keeps
ONE coherent control: the main "Tidy" keeps its name; the sub-row is relabeled
to what it actually does (the backend's skip_llm path deletes empty/throwaway
sessions and never calls the LLM). Both paths stay wired through _runTidy(skipLlm).

The runtime half (exactly one VISIBLE "Tidy" affordance in the rendered control,
sub-row collapsed and expanded) lives in frontend/scripts/browser_smoke.py (the
H6 block, anchored after the F3 sheets check).

NOT in scope: #memory-tidy-btn — the memory-modal's own Tidy is a different
feature and keeps its label.
"""
import os
import re

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INDEX = os.path.join(FRONTEND, "static", "index.html")
APP_JS = os.path.join(FRONTEND, "static", "app.js")
SMOKE = os.path.join(FRONTEND, "scripts", "browser_smoke.py")


def _read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def _sort_dropdown_block():
    """The session-sort dropdown markup (the region that owns the control)."""
    html = _read(INDEX)
    start = html.index('id="session-sort-dropdown"')
    end = html.index('id="session-bulk-bar"')
    return html[start:end]


def _visible_text(markup):
    """Markup with tags stripped — what a user can actually read."""
    return re.sub(r"<[^>]*>", " ", markup)


# ── 1. the duplicate markup is gone ────────────────────────────────────────

def test_sort_dropdown_reads_tidy_exactly_once():
    text = _visible_text(_sort_dropdown_block())
    hits = re.findall(r"\bTidy\b", text)
    assert len(hits) == 1, (
        f"The session-sort dropdown must read 'Tidy' exactly once (found "
        f"{len(hits)}) — the no-AI sub-row was a second bare 'Tidy' (H6)."
    )


def test_noai_subrow_carries_its_own_distinct_label():
    block = _sort_dropdown_block()
    m = re.search(
        r'id="auto-sort-sessions-noai-btn"[^>]*>(.*?)</div>', block, re.S
    )
    assert m, "the no-AI sub-row (#auto-sort-sessions-noai-btn) must still exist"
    own_text = _visible_text(m.group(1))
    assert "Clean up (no AI)" in own_text, (
        "The sub-row must say what it does — 'Clean up (no AI)' (the skip_llm "
        "path only deletes empty/throwaway chats), never a blank row."
    )
    assert not re.search(r"\bTidy\b", own_text), (
        "The bare 'Tidy' label regrew on the no-AI sub-row — that is the H6 "
        "duplicate."
    )


def test_main_tidy_and_its_options_chevron_remain():
    block = _sort_dropdown_block()
    assert 'id="auto-sort-sessions-btn"' in block, "the main Tidy button must remain"
    assert re.search(r'class="auto-sort-icon">.*?\bTidy\b', block, re.S), (
        "the main control keeps its '★ Tidy' label (the one Tidy)"
    )
    assert 'id="auto-sort-sessions-more"' in block, (
        "the options chevron must remain — one coherent split control"
    )


def test_memory_tidy_button_is_untouched():
    # Different feature (the memory modal) — H6 must not bleed into it.
    html = _read(INDEX)
    m = re.search(r'id="memory-tidy-btn"[^>]*>(.*?)</button>', html, re.S)
    assert m and re.search(r"\bTidy\b", _visible_text(m.group(1))), (
        "#memory-tidy-btn (the memory modal's own Tidy) keeps its label — "
        "it is out of H6 scope."
    )


# ── 2. the tidy handler is still wired (both paths) ────────────────────────

def test_run_tidy_drives_both_paths():
    js = _read(APP_JS)
    assert re.search(r"async function _runTidy\(skipLlm\)", js), (
        "_runTidy(skipLlm) is the single driver for both tidy paths"
    )
    assert re.search(
        r"el\('auto-sort-sessions-btn'\)[\s\S]{0,120}_runTidy\(false\)", js
    ), "the main Tidy button must still run the AI path (_runTidy(false))"
    assert re.search(
        r"autoSortNoaiBtn\.addEventListener\('click', \(\) => _runTidy\(true\)\)", js
    ), "the no-AI sub-row must still run the cleanup path (_runTidy(true))"
    assert re.search(r"\$\{API_BASE\}/api/sessions/auto-sort\$\{skipLlm \? '\?skip_llm=true' : ''\}", js), (
        "_runTidy still targets /api/sessions/auto-sort with the skip_llm flag"
    )


def test_chevron_still_toggles_the_subrow():
    js = _read(APP_JS)
    assert re.search(
        r"el\('auto-sort-sessions-more'\)[\s\S]{0,300}autoSortNoaiBtn\.style\.display", js
    ), "the chevron must still toggle the no-AI sub-row's visibility"


# ── 3. the runtime gate exists ─────────────────────────────────────────────

def test_browser_smoke_carries_the_h6_runtime_gate():
    smoke = _read(SMOKE)
    assert "H6: ONE visible Tidy affordance with the options sub-row closed" in smoke
    assert "H6: STILL exactly one visible 'Tidy' with the sub-row expanded" in smoke
    assert "H6: the revealed sub-row is the distinctly-labeled no-AI cleanup" in smoke
    # Anchored after the last pre-H6 check (the F3 sheets block), per the lane brief.
    f3 = smoke.index("F3: sheets stay full-width")
    h6 = smoke.index("H6: the Chats auto-sort control reads")
    assert h6 > f3, "the H6 smoke block sits after the F3 sheets block"
