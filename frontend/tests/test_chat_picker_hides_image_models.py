"""The chat model picker hides image-generation models.

Models carry a per-endpoint type: `model_type === 'image'` vs `'chat'/'llm'`
(see models.js — `data-model-type="image"`, the "+ Image" vs "+ Chat" button).
Image-generation models belong to the image flow (settings `image_model` / the
image step), NOT the chat composer's "Select model" dropdown. Before this fix
the chat picker (`modelPicker.js` `_getAllModels()`) listed EVERY saved model,
so an image-only endpoint leaked into the chat dropdown — and, because every
picker path (browse, provider groups, search) reads that one list, it leaked
into search too.

The fix is a single inclusion guard at the top of the `_getAllModels()` item
loop: an endpoint whose `model_type` is `image` is skipped entirely. Chat (and
chat+image dual-capable, which are not `model_type === 'image'`) endpoints are
untouched, and image generation is unaffected because it resolves its model
independently (settings.js `_isImageModel`).

The source pin proves the guard is wired into the chat picker's list builder.
The behavioral check slices the real `_getAllModels` body, stubs its externals,
and runs it under node against a mixed chat+image endpoint set — proving image
models appear nowhere in the list the picker renders/searches.
"""

import json
import os
import re
import shutil
import subprocess
import tempfile

import pytest

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(rel):
    with open(os.path.join(FRONTEND, rel), encoding="utf-8") as f:
        return f.read()


def _get_all_models_body(js):
    """Slice the `_getAllModels()` function body out of modelPicker.js."""
    start = js.index("function _getAllModels(")
    # The function ends at its `return sortModelObjects(result);` closing brace.
    end = js.index("// ── Provider display names", start)
    return js[start:end]


def _is_image_model_id_fn(js, with_comment=False):
    """Slice the module-level `_isImageModelId(mid)` helper out of modelPicker.js
    so the node harness can run the per-model image filter the body calls.

    `with_comment=True` extends the slice back over the leading doc comment (which
    carries the settings.js source-of-truth citation)."""
    start = js.index("function _isImageModelId(")
    if with_comment:
        start = js.index("// ── Image-model detector")
    end = js.index("\n}\n", js.index("function _isImageModelId(")) + len("\n}\n")
    return js[start:end]


# ── source pin: the chat picker's list builder excludes image endpoints ─────────


def test_chat_picker_get_all_models_filters_out_image_model_type():
    js = _read("static/js/modelPicker.js")
    body = _get_all_models_body(js)
    # The guard skips any endpoint whose model_type is 'image'. Pinned loosely
    # on the operative tokens so cosmetic edits don't break it.
    assert "item.model_type" in body, "the chat picker must inspect each endpoint's model_type"
    assert "=== 'image'" in body and "return" in body, (
        "the chat picker must SKIP (return) image-type endpoints"
    )
    # The guard lives inside the per-item loop (before models are collected).
    guard = body.index("model_type")
    collect = body.index("result.push(")
    assert guard < collect, "the image-type guard must run before models are collected"


# ── behavioral: real _getAllModels body, mixed endpoints, run under node ────────


def test_get_all_models_omits_image_endpoint_models():
    if shutil.which("node") is None:
        pytest.skip("node not available")
    js = _read("static/js/modelPicker.js")
    body = _get_all_models_body(js)

    # Mixed catalog: a chat endpoint, an image-only endpoint, and an endpoint
    # with no model_type (defaults to chat).
    items = [
        {"endpoint_id": "chat-ep", "endpoint_name": "Chat", "url": "http://c/v1",
         "model_type": "chat", "models": ["openai/gpt-4o", "anthropic/claude-3.5-sonnet"]},
        {"endpoint_id": "img-ep", "endpoint_name": "Images", "url": "http://i/v1",
         "model_type": "image", "models": ["openai/dall-e-3", "black-forest-labs/flux.1-dev"]},
        {"endpoint_id": "legacy-ep", "endpoint_name": "Legacy", "url": "http://l/v1",
         "models": ["meta-llama/llama-3.3-70b-instruct"]},
    ]

    harness = (
        "const ITEMS = " + json.dumps(items) + ";\n"
        # Stub the externals the sliced body references.
        "const window = { modelsModule: { getCachedItems: () => ITEMS } };\n"
        "const _localProbe = {};\n"
        "const sortModelObjects = (a) => a;\n"
        + _is_image_model_id_fn(js) + "\n"
        + body +
        "\nconst out = _getAllModels().map(m => m.mid);\n"
        "console.log(JSON.stringify(out));\n"
    )
    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False) as f:
        f.write(harness)
        path = f.name
    try:
        res = subprocess.run(["node", path], capture_output=True, text=True, timeout=20)
    finally:
        os.unlink(path)
    assert res.returncode == 0, res.stderr
    mids = json.loads(res.stdout.strip().splitlines()[-1])

    # Chat + untyped (legacy) endpoints are present…
    assert "openai/gpt-4o" in mids
    assert "anthropic/claude-3.5-sonnet" in mids
    assert "meta-llama/llama-3.3-70b-instruct" in mids
    # …and NO image-endpoint model appears anywhere in the picker's list.
    assert "openai/dall-e-3" not in mids
    assert "black-forest-labs/flux.1-dev" not in mids


# ── source pin: a PER-MODEL image filter inside the per-item loop ───────────────


def test_chat_picker_get_all_models_filters_image_models_per_model():
    """Bug 1: a MIXED endpoint (chat + image models, model_type 'llm') is NOT
    caught by the endpoint-level model_type==='image' drop, so the picker must
    also filter image MODELS individually inside the per-item loop."""
    js = _read("static/js/modelPicker.js")
    body = _get_all_models_body(js)
    assert "_isImageModelId(mid)" in body, (
        "the chat picker must filter each MODEL via _isImageModelId so a mixed "
        "chat+image endpoint can't leak its image models into the chat dropdown"
    )
    # The per-model guard runs before the model is collected.
    guard = body.index("_isImageModelId(mid)")
    collect = body.index("result.push(")
    assert guard < collect, "the per-model image guard must run before models are collected"


def test_is_image_model_id_helper_mirrors_settings_families():
    """The local detector must keep settings.js's family list (the source of
    truth) so the two surfaces agree on what an image model is."""
    js = _read("static/js/modelPicker.js")
    fn = _is_image_model_id_fn(js)
    for kw in ("gpt-image", "dall-e", "flux", "stable-diffusion", "sdxl",
               "imagen", "ideogram", "nano-banana"):
        assert f"'{kw}'" in fn, f"_isImageModelId must include the '{kw}' family (mirror of settings.js)"
    # A code comment must point at the source of truth so it stays in sync.
    assert "settings.js" in _is_image_model_id_fn(js, with_comment=True), (
        "_isImageModelId must cite settings.js as the source of truth"
    )


# ── behavioral: a MIXED chat+image endpoint (the real Bug-1 case) ───────────────


def test_get_all_models_omits_image_models_from_mixed_endpoint():
    if shutil.which("node") is None:
        pytest.skip("node not available")
    js = _read("static/js/modelPicker.js")
    body = _get_all_models_body(js)

    # ONE OpenRouter-style endpoint (model_type 'llm') serving BOTH chat AND
    # image models — exactly what the endpoint-level drop misses.
    items = [
        {"endpoint_id": "or", "endpoint_name": "OpenRouter", "url": "http://or/v1",
         "model_type": "llm", "models": [
             "deepseek/deepseek-v4-pro",
             "google/gemini-2.5-flash-image",
             "black-forest-labs/flux-1.1-pro",
             "openai/dall-e-3",
             "google/gemini-2.5-flash",
             "openai/gpt-image-1",
         ]},
    ]

    harness = (
        "const ITEMS = " + json.dumps(items) + ";\n"
        "const window = { modelsModule: { getCachedItems: () => ITEMS } };\n"
        "const _localProbe = {};\n"
        "const sortModelObjects = (a) => a;\n"
        + _is_image_model_id_fn(js) + "\n"
        + body +
        "\nconst out = _getAllModels().map(m => m.mid);\n"
        "console.log(JSON.stringify(out));\n"
    )
    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False) as f:
        f.write(harness)
        path = f.name
    try:
        res = subprocess.run(["node", path], capture_output=True, text=True, timeout=20)
    finally:
        os.unlink(path)
    assert res.returncode == 0, res.stderr
    mids = json.loads(res.stdout.strip().splitlines()[-1])

    # Chat models from the mixed endpoint survive…
    assert "deepseek/deepseek-v4-pro" in mids
    assert "google/gemini-2.5-flash" in mids  # vision/chat sibling, NOT image
    # …and ZERO image models leak through (the whole point of Bug 1).
    image_leaks = [m for m in mids if any(
        kw in m.lower() for kw in
        ("flash-image", "flux", "dall-e", "gpt-image")
    )]
    assert image_leaks == [], f"image models leaked into the chat picker: {image_leaks}"
