"""Lane G21 — the Image Generation select offers only image-capable models.

The bug (live, 2026-06-11): H2 unified every flat model dropdown onto the chat
pool, but — unlike Vision and TTS — left the Image Generation select UNFILTERED.
A chat model (e.g. an OpenRouter `deepseek/deepseek-v4-pro`) could be selected.
Resolving it succeeds (it IS a real chat model) but POSTing it to
`/images/generations` 400s instantly — the provider fast-rejects a non-image
model — so every portrait attempt failed with `http-400` and the house showed
placeholder icons.

G21 adds `_isImageModel(mid)`: an INCLUSION filter that offers only recognizable
text→image families (gpt-image, dall-e, flux, stable-diffusion/sdxl, imagen,
ideogram, seedream, recraft, …) plus a generic image/t2i token (minus vision
markers). It is data-driven on the model id, so an OpenRouter endpoint's image
collection appears dynamically, while its chat models are hidden. A saved pick
that isn't an image model self-heals to Auto-detect and persists the correction.

The classification check below extracts the real `_isImageModel` source and
runs it under node against representative OpenRouter ids — no browser needed,
so it gates in CI's pytest step (where the chromium runtime test skips).
"""

import json
import os
import shutil
import subprocess
import tempfile

import pytest

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(rel):
    with open(os.path.join(FRONTEND, rel), encoding="utf-8") as f:
        return f.read()


def _extract_is_image_model(js):
    """Slice the standalone `_isImageModel` function source out of settings.js."""
    start = js.index("function _isImageModel(")
    end = js.index("/* ── Image Generation ── */", start)
    return js[start:end].strip()


# ── source pins: the filter is actually wired into the Image card ──────────────


def test_image_select_is_wired_to_the_capability_filter():
    js = _read("static/js/settings.js")
    img = js[js.index("async function initImageSettings"):js.index("/* ── Vision ── */")]
    # the union pool is narrowed by the image-capability filter (like Vision/TTS)
    assert "_availableModelIds(_endpoints, function(mid) { return _isImageModel(mid); })" in img
    # a non-image saved pick self-heals to Auto-detect and persists the fix
    assert "autoHealStaleModel" in img
    assert "_isImageModel(saved)" in img


def test_isImageModel_function_exists_and_is_self_contained():
    js = _read("static/js/settings.js")
    src = _extract_is_image_model(js)
    assert src.startswith("function _isImageModel(mid)")
    # self-contained: only String/regex/Array primitives — safe to eval in node
    for forbidden in ("fetch(", "document", "localStorage", "el('", "await "):
        assert forbidden not in src, f"_isImageModel must not depend on {forbidden!r}"


# ── behavioral: real source, real OpenRouter-shaped ids, run under node ─────────

# Representative ids from OpenRouter's image-models collection (provider-prefixed).
IMAGE_IDS = [
    "openai/gpt-image-1",
    "openai/dall-e-3",
    "openai/dall-e-2",
    "black-forest-labs/flux.1.1-pro",
    "black-forest-labs/flux-1-schnell",
    "black-forest-labs/flux.1-dev",
    "stability-ai/sdxl",
    "stability-ai/stable-diffusion-3.5-large",
    "stabilityai/sd3-medium",
    "playgroundai/playground-v2.5-1024px-aesthetic",
    "ideogram-ai/ideogram-v3",
    "recraft-ai/recraft-v3",
    "bytedance/seedream-3-t2i",
    "google/gemini-2.5-flash-image-preview",
    "google/imagen-3.0-generate",
    "luma/photon",
]

# Chat / non-image ids that MUST NOT be offered in the Image select.
NON_IMAGE_IDS = [
    "deepseek/deepseek-v4-pro",
    "deepseek/deepseek-chat",
    "anthropic/claude-3.5-sonnet",
    "openai/gpt-4o",
    "openai/gpt-4o-mini",
    "meta-llama/llama-3.3-70b-instruct",
    "google/gemini-2.5-flash",
    "qwen/qwen2.5-vl-72b-instruct",   # a VISION model — input images, not output
    "mistralai/mistral-large",
    "x-ai/grok-2",
]


@pytest.mark.skipif(shutil.which("node") is None, reason="node not available")
def test_isImageModel_classifies_openrouter_ids():
    js = _read("static/js/settings.js")
    src = _extract_is_image_model(js)
    harness = (
        src
        + "\nconst IMG = " + json.dumps(IMAGE_IDS) + ";"
        + "\nconst CHAT = " + json.dumps(NON_IMAGE_IDS) + ";"
        + "\nconst missImg = IMG.filter(m => !_isImageModel(m));"
        + "\nconst falseImg = CHAT.filter(m => _isImageModel(m));"
        + "\nconsole.log(JSON.stringify({ missImg, falseImg }));\n"
    )
    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False) as f:
        f.write(harness)
        path = f.name
    try:
        out = subprocess.run(["node", path], capture_output=True, text=True, timeout=20)
    finally:
        os.unlink(path)
    assert out.returncode == 0, out.stderr
    res = json.loads(out.stdout.strip().splitlines()[-1])
    assert res["missImg"] == [], f"image models the filter wrongly hid: {res['missImg']}"
    assert res["falseImg"] == [], f"chat/vision models the filter wrongly offered: {res['falseImg']}"
