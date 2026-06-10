"""Queue C23 + C15 — the onboarding onramp (audit J4/J5/J6/J8/F5/F7).

Browser-verified pieces live in scripts/browser_smoke.py (dark-house holding card,
archetype chips, tip hygiene — all driven in real Chromium). These pin the server flag
and the source contracts.
"""

import os

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*rel):
    with open(os.path.join(FRONTEND, *rel), encoding="utf-8") as f:
        return f.read()


def test_game_build_marks_the_body():
    src = _read("app.py")
    assert 'data-game-build="1"' in src
    assert "game_build_enabled()" in src


def test_onboarding_sequences_model_before_character():
    js = _read("static", "js", "orwellOnboarding.js")
    assert "anyModelConfigured" in js
    assert "Production needs a feed source" in js          # J4: the model gate, game-framed
    assert "The house is dark" in js                       # F5: engine-down holding card


def test_onboarding_communicates_balanced_stats():
    # J6 moved with the intake (0050): creation happens in the CHAT, so the anti-sycophancy
    # stance lives in the engine's casting-interview moment prompt, not a form blurb.
    import os
    repo = os.path.dirname(FRONTEND)
    with open(os.path.join(repo, "src", "engine", "momentPrompts.ts"), encoding="utf-8") as f:
        prompt = f.read()
    assert "balanced" in prompt and "nobody is invincible" in prompt


def test_new_season_gets_a_fresh_chat_session():
    js = _read("static", "js", "orwellOnboarding.js")
    # F7: the dead season's transcript never rides along as narrator context
    assert "sidebar-new-chat-btn" in js


def test_no_dropped_vertical_in_game_tips():
    html = _read("static", "index.html")
    block = html[html.index("data-game-build')"):]
    head = block[:1200]
    assert "Compare mode" not in head and "web search and code" not in head
    js = _read("static", "js", "models.js")
    gb = js[js.index("_gb"): js.index("_gb") + 600]
    assert "Compare mode" not in gb
