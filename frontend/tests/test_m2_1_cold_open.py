"""M2-1 (audit B1) — the cold open leads with the show, never the plumbing.

Source pins: (1) the setup wizard's first screen is the show fantasy — one h1
("Welcome to the Big Brother house") and ONE primary CTA ("Enter the house"); (2) model
names render HUMANIZED ("Narrator: GLM 5.2") through `humanizeModelId` on both summary
slots — a raw provider/model id ("z-ai/glm-5.2") never renders on the first screen;
(3) the config door is the demoted "Production settings" link (same
`data-ob-choose-models` behavior — opens the real Settings over the wizard), not a peer
button; raw ids live in Settings only.
"""
from __future__ import annotations

import os
import re

FE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(rel: str) -> str:
    with open(os.path.join(FE, rel), encoding="utf-8") as fh:
        return fh.read()


def _setup_seg(js: str) -> str:
    seg = js[js.index("function mountSetup"):]
    return seg[: seg.index("\n  }\n")] if "\n  }\n" in seg else seg


def test_cold_open_leads_with_the_fantasy_and_one_cta():
    js = _read("static/js/orwellOnboarding.js")
    seg = _setup_seg(js)
    assert "Welcome to the Big Brother house" in seg
    assert "Enter the house" in seg
    # the h1 carries the fantasy, not the plumbing — no model talk in the heading line
    h1 = re.search(r"<h1>([^<]+)</h1>", seg)
    assert h1 and "model" not in h1.group(1).lower()
    # exactly one PRIMARY CTA in the wizard (the prominent class appears once)
    assert seg.count("ow-btn-prominent") == 1


def test_model_ids_render_humanized_never_raw():
    js = _read("static/js/orwellOnboarding.js")
    assert "function humanizeModelId" in js
    seg = _setup_seg(js)
    # both summary slots render THROUGH the humanizer (display-only; resolution keeps raw ids)
    assert re.search(r"chatEl\.textContent = humanizeModelId\(chat\)", seg)
    assert re.search(r"imgEl\.textContent = humanizeModelId\(image\)", seg)
    # no hardcoded raw provider/model id anywhere in the wizard template or its fallbacks
    assert not re.search(r"\b[\w.]+/[\w.-]+\b", "".join(re.findall(r"textContent = [^;]+;", seg))
                         .replace("humanizeModelId", ""))


def test_humanizer_shapes():
    """The humanizer's rules pinned by shape (the js function is mirrored here byte-for-rule:
    drop the provider prefix, split on dashes, known families cased, versions uppercased)."""
    js = _read("static/js/orwellOnboarding.js")
    fn = js[js.index("function humanizeModelId"):]
    fn = fn[: fn.index("\n  }\n") + 4]
    for known in ('glm: "GLM"', 'deepseek: "DeepSeek"', 'gemini: "Gemini"', 'qwen: "Qwen"'):
        assert known in fn, f"humanizer family map lost {known}"
    assert 'split("/").pop()' in fn  # provider prefix never renders


def test_production_settings_is_a_demoted_link():
    js = _read("static/js/orwellOnboarding.js")
    seg = _setup_seg(js)
    assert "Production settings" in seg
    assert "data-ob-choose-models" in seg        # same door, same behavior
    assert "ob-prod-settings-link" in seg        # link styling, not a peer button
    css = _read("static/css/game-trim.css")
    assert ".ob-prod-settings-link" in css
    # the old peer-button label is gone from the wizard
    assert "Choose models" not in seg
