"""Lane G23 — OpenRouter image generation over /chat/completions.

OpenRouter does NOT implement the OpenAI /images/generations endpoint: its image models
emit images through /chat/completions — native image-output models via
`modalities: ["image","text"]`, or any model via the `openrouter:image_generation` server
tool (which returns an image URL the model embeds). POSTing /images/generations to OpenRouter
400s on every model, which is the deeper reason cast portraits failed for an OpenRouter user.

This pins the transport: the request mechanisms (native then server-tool), the image
extraction (message.images data URL / content image part / a URL in text), and that
_generate_one routes OpenRouter to the chat path while everything else keeps the Images API.

Roles only; httpx fully faked (no network).
"""

import asyncio
import base64
import importlib

import pytest

op = importlib.import_module("src.orwell_portraits")


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


class _Resp:
    def __init__(self, status=200, body=None, content=b"", text=""):
        self.status_code = status
        self._body = body
        self.content = content
        self.text = text

    def json(self):
        if isinstance(self._body, Exception):
            raise self._body
        return self._body


class _Client:
    """A minimal async httpx.AsyncClient stand-in. `posts` is one response or a sequence
    returned in order (sticking at the last); `get` is the response for any .get()."""
    def __init__(self, posts=(), get=None):
        self._posts = list(posts) if isinstance(posts, (list, tuple)) else [posts]
        self._i = 0
        self._get = get
        self.post_payloads = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def post(self, url, json=None, headers=None):
        self.post_payloads.append(json)
        r = self._posts[min(self._i, len(self._posts) - 1)]
        self._i += 1
        return r

    async def get(self, url):
        return self._get


def _data_url(raw: bytes) -> str:
    return "data:image/png;base64," + base64.b64encode(raw).decode()


# ── image extraction ───────────────────────────────────────────────────────────

def test_extract_from_images_array_data_url():
    body = {"choices": [{"message": {"images": [
        {"type": "image_url", "image_url": {"url": _data_url(b"X")}}]}}]}
    assert op._extract_chat_image_url(body) == _data_url(b"X")


def test_extract_from_content_image_part():
    body = {"choices": [{"message": {"content": [
        {"type": "image_url", "image_url": {"url": "https://img/x.png"}}]}}]}
    assert op._extract_chat_image_url(body) == "https://img/x.png"


def test_extract_from_text_content_url():
    body = {"choices": [{"message": {"content": "Here you go: https://cdn/x.png — enjoy"}}]}
    assert op._extract_chat_image_url(body) == "https://cdn/x.png"


def test_extract_none_when_no_image():
    body = {"choices": [{"message": {"content": "I can't generate images."}}]}
    assert op._extract_chat_image_url(body) is None


# ── url → bytes ─────────────────────────────────────────────────────────────────

def test_image_bytes_from_data_url():
    out = _run(op._image_bytes_from_url(_Client(), _data_url(b"PNGDATA")))
    assert out == b"PNGDATA"


def test_image_bytes_from_https_url():
    client = _Client(get=_Resp(200, content=b"FETCHED"))
    assert _run(op._image_bytes_from_url(client, "https://x/y.png")) == b"FETCHED"


# ── the chat-completions transport ──────────────────────────────────────────────

def test_chat_path_returns_image_via_native_modalities():
    body = {"choices": [{"message": {"images": [{"image_url": {"url": _data_url(b"NATIVE")}}]}}]}
    client = _Client(_Resp(200, body))
    out = _run(op._generate_via_chat_completions(
        client, "https://openrouter.ai/api/v1/chat/completions", "google/gemini-2.5-flash-image", "p", {}))
    assert out == b"NATIVE"
    # the first attempt is the native image-output request
    assert client.post_payloads[0].get("modalities") == ["image", "text"]


def test_chat_path_falls_back_to_server_tool():
    no_img = {"choices": [{"message": {"content": "ok"}}]}
    with_img = {"choices": [{"message": {"images": [{"image_url": {"url": _data_url(b"VIATOOL")}}]}}]}
    client = _Client([_Resp(200, no_img), _Resp(200, with_img)])
    out = _run(op._generate_via_chat_completions(
        client, "https://openrouter.ai/api/v1/chat/completions", "openai/gpt-5-image", "p", {}))
    assert out == b"VIATOOL"
    assert len(client.post_payloads) == 2
    assert client.post_payloads[1]["tools"][0]["type"] == "openrouter:image_generation"


def test_chat_path_records_reason_on_http_error():
    op._consume_gen_error()
    body = {"error": {"message": "No endpoints found for model"}}
    client = _Client([_Resp(404, body, text="x"), _Resp(404, body, text="x")])
    out = _run(op._generate_via_chat_completions(
        client, "https://openrouter.ai/api/v1/chat/completions", "bad/model", "p", {}))
    assert out is None
    assert op._consume_gen_error() == "http-404"


# ── _generate_one routing ───────────────────────────────────────────────────────

def test_generate_one_routes_openrouter_to_chat(monkeypatch):
    monkeypatch.setattr(op, "_image_settings", lambda u: (True, "google/gemini-2.5-flash-image", "medium"))
    import src.ai_interaction as ai
    monkeypatch.setattr(ai, "_resolve_model",
                        lambda spec, owner=None: ("https://openrouter.ai/api/v1/chat/completions",
                                                  "google/gemini-2.5-flash-image", {}))
    seen = {}

    async def fake_chat(client, url, model_id, prompt, headers, reference_png=None):
        seen["url"] = url
        return b"CHATPNG"
    monkeypatch.setattr(op, "_generate_via_chat_completions", fake_chat)

    assert _run(op._generate_one("p", "u")) == b"CHATPNG"
    assert "openrouter.ai" in seen["url"]


def test_generate_one_non_openrouter_uses_images_api(monkeypatch):
    import httpx
    monkeypatch.setattr(op, "_image_settings", lambda u: (True, "dall-e-3", "medium"))
    import src.ai_interaction as ai
    monkeypatch.setattr(ai, "_resolve_model",
                        lambda spec, owner=None: ("https://api.openai.com/v1/chat/completions", "dall-e-3", {}))

    def _no_chat(*a, **k):
        raise AssertionError("a non-OpenRouter endpoint must use the Images API, not the chat path")
    monkeypatch.setattr(op, "_generate_via_chat_completions", _no_chat)

    resp = _Resp(200, {"data": [{"b64_json": base64.b64encode(b"IMGAPI").decode()}]})
    monkeypatch.setattr(httpx, "AsyncClient", lambda *a, **k: _Client(resp))
    assert _run(op._generate_one("p", "u")) == b"IMGAPI"
