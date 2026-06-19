"""Portrait image-config lane — square 1:1 framing, a pinned resolution, and
reference-image-on-regen for identity preservation.

Three behaviours, all Vault-free request-shape concerns:
  1. SQUARE (1:1) aspect ratio is asked of BOTH provider transports — OpenRouter
     /chat/completions via `image_config.aspect_ratio`, OpenAI /images/{generations,edits}
     via a square `size` — with graceful degradation (a provider that rejects the param
     never blocks generation), plus a belt-and-suspenders prompt cue.
  2. A single PINNED square resolution (default 1024x1024) is sent on every path so the
     cast grid is uniform and per-image cost is bounded.
  3. REFERENCE-ON-REGEN: re-generating an EXISTING houseguest's portrait (the L17
     look-alike re-shoot) feeds the current portrait back through the img2img path as a
     reference so the houseguest stays the SAME person; first-generation stays text-to-image.

Roles only; httpx fully faked (no network). pytest-asyncio is AUTO mode → SYNC tests
driven through run_until_complete, never `async def` / `asyncio.run()`.
"""

import asyncio
import base64
import importlib

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
    """Minimal async httpx.AsyncClient stand-in. `posts` is one response or a sequence
    returned in order (sticking at the last). Captures every JSON post payload + multipart
    (data, files) post so the request SHAPE can be asserted."""

    def __init__(self, posts=(), get=None):
        self._posts = list(posts) if isinstance(posts, (list, tuple)) else [posts]
        self._i = 0
        self._get = get
        self.post_payloads = []      # JSON bodies
        self.post_multipart = []     # (data, files) tuples from /images/edits

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def post(self, url, json=None, headers=None, data=None, files=None):
        if json is not None:
            self.post_payloads.append(json)
        if data is not None or files is not None:
            self.post_multipart.append((data, files))
        r = self._posts[min(self._i, len(self._posts) - 1)]
        self._i += 1
        return r

    async def get(self, url):
        return self._get


def _data_url(raw: bytes) -> str:
    return "data:image/png;base64," + base64.b64encode(raw).decode()


# ── 1 + 2: square aspect on the OpenRouter chat transport ─────────────────────────

def test_chat_payload_requests_square_image_config():
    body = {"choices": [{"message": {"images": [{"image_url": {"url": _data_url(b"SQ")}}]}}]}
    client = _Client(_Resp(200, body))
    out = _run(op._generate_via_chat_completions(
        client, "https://openrouter.ai/api/v1/chat/completions", "m/image", "p", {}))
    assert out == b"SQ"
    cfg = client.post_payloads[0].get("image_config")
    assert cfg == {"aspect_ratio": op.PORTRAIT_ASPECT_RATIO} == {"aspect_ratio": "1:1"}


def test_chat_degrades_when_image_config_rejected():
    # First post 400s WITH image_config (provider rejects the param); the same mechanism is
    # retried WITHOUT it and succeeds — square never blocks generation.
    ok = {"choices": [{"message": {"images": [{"image_url": {"url": _data_url(b"OK")}}]}}]}
    client = _Client([_Resp(400, {"error": {"message": "unknown param image_config"}}, text="x"),
                      _Resp(200, ok)])
    out = _run(op._generate_via_chat_completions(
        client, "https://openrouter.ai/api/v1/chat/completions", "m/image", "p", {}))
    assert out == b"OK"
    # the first attempt carried image_config, the degraded retry stripped it
    assert "image_config" in client.post_payloads[0]
    assert "image_config" not in client.post_payloads[1]


# ── 2: pinned square size on both OpenAI transports ───────────────────────────────

def test_pinned_size_constant_is_square_1024():
    assert op.PORTRAIT_SIZE_DEFAULT == "1024x1024"
    assert op._portrait_size("medium") == "1024x1024"
    assert op._portrait_size("high") == "1024x1024"
    assert op._portrait_size("anything-unknown") == "1024x1024"
    # always WxH square
    w, h = op._portrait_size("low").split("x")
    assert w == h


def test_images_generations_sends_square_size(monkeypatch):
    import httpx
    monkeypatch.setattr(op, "_image_settings", lambda u: (True, "dall-e-3", "medium"))
    import src.ai_interaction as ai
    monkeypatch.setattr(ai, "_resolve_model",
                        lambda spec, owner=None: ("https://api.openai.com/v1/chat/completions", "dall-e-3", {}))
    client = _Client(_Resp(200, {"data": [{"b64_json": base64.b64encode(b"IMG").decode()}]}))
    monkeypatch.setattr(httpx, "AsyncClient", lambda *a, **k: client)
    out = _run(op._generate_one("p", "u"))
    assert out == b"IMG"
    payload = client.post_payloads[0]
    assert payload["size"] == op.PORTRAIT_SIZE_DEFAULT == "1024x1024"
    # belt-and-suspenders: the prompt carries the square framing cue
    assert op._SQUARE_FRAMING_CUE.strip() in payload["prompt"]


def test_images_edits_sends_square_size():
    client = _Client(_Resp(200, {"data": [{"b64_json": base64.b64encode(b"EDIT").decode()}]}))
    out = _run(op._generate_via_images_edit(
        client, "https://api.openai.com/v1", "gpt-image-1", "p", {}, b"REF", "high"))
    assert out == b"EDIT"
    data, files = client.post_multipart[0]
    assert data["size"] == op._portrait_size("high") == "1024x1024"
    # the reference image conditions the result (identity preservation)
    assert files["image"][1] == b"REF"


# ── 3: reference-image-on-regen for the L17 look-alike re-shoot ───────────────────

def _prompt(hid, name, physical):
    # Mirrors the engine's portraitPrompts.ts clause labels so the L17 distinctness signature
    # (Physical appearance / Presentation style) finds a structured clause to compare.
    return {"houseguestId": hid, "name": name,
            "prompt": (f"Portrait. Physical appearance: {physical}. "
                       "Presentation style: casual. Setting: kitchen counters blurred behind")}


def test_lookalike_regen_feeds_current_portrait_as_reference(tmp_path, monkeypatch):
    # Two identical-looking houseguests → npc:2 is the offender. Seed an EXISTING portrait for
    # npc:2 on disk, then assert the regen feeds THOSE bytes back as a reference (same person)
    # and suppresses the identity-keep prefix (keep_identity=False) so the variety directive
    # — which differentiates from the rest of the cast — wins.
    monkeypatch.setattr(op, "PORTRAITS_DIR", tmp_path / "portraits")
    monkeypatch.setattr(op, "image_generation_available", lambda user: True)

    op._write_portrait("u", "npc:1", b"FACE-1", "Houseguest One")
    op._write_portrait("u", "npc:2", b"OLD-FACE-2", "Houseguest Two")

    seen = {}

    async def fake_gen(prompt, user, reference_png=None, keep_identity=True):
        seen["prompt"] = prompt
        seen["reference_png"] = reference_png
        seen["keep_identity"] = keep_identity
        return b"NEW-FACE-2"
    monkeypatch.setattr(op, "_generate_one", fake_gen)

    same = "tall and broad, deep brown skin, shaved head, broad nose"
    prompts = [_prompt("npc:1", "Houseguest One", same),
               _prompt("npc:2", "Houseguest Two", same)]
    res = _run(op.dedupe_lookalikes(prompts, "u"))

    assert res["regenerated"] == 1 and res["regeneratedIds"] == ["npc:2"]
    # identity preserved by feeding the CURRENT portrait back as a reference image
    assert seen["reference_png"] == b"OLD-FACE-2"
    # the standard "minimal alteration" prefix is suppressed so the variety directive wins
    assert seen["keep_identity"] is False
    assert seen["prompt"].startswith(op._VARIETY_DIRECTIVE)
    # the re-rolled face is persisted
    assert op.portrait_file("u", "npc:2").read_bytes() == b"NEW-FACE-2"


def test_regen_keep_identity_false_skips_reference_prefix(monkeypatch):
    # keep_identity=False must NOT prepend the REFERENCE_PROMPT_PREFIX even with a reference set.
    monkeypatch.setattr(op, "_image_settings", lambda u: (True, "m/image", "medium"))
    import src.ai_interaction as ai
    monkeypatch.setattr(ai, "_resolve_model",
                        lambda spec, owner=None: ("https://openrouter.ai/api/v1/chat/completions", "m/image", {}))

    seen = {}

    async def fake_chat(client, url, model_id, prompt, headers, reference_png=None):
        seen["prompt"] = prompt
        seen["reference_png"] = reference_png
        return b"PNG"
    monkeypatch.setattr(op, "_generate_via_chat_completions", fake_chat)

    out = _run(op._generate_one("VARIETY. base prompt", "u",
                                reference_png=b"REF", keep_identity=False))
    assert out == b"PNG"
    assert seen["reference_png"] == b"REF"  # reference still rides along (img2img)
    assert not seen["prompt"].startswith(op.REFERENCE_PROMPT_PREFIX)
    # square framing cue still appended
    assert op._SQUARE_FRAMING_CUE.strip() in seen["prompt"]


def test_player_headshot_keeps_identity_prefix(monkeypatch):
    # The G26 player-headshot path (keep_identity defaults True) STILL prepends the
    # identity-keep prefix — the regen change must not regress likeness preservation.
    monkeypatch.setattr(op, "_image_settings", lambda u: (True, "m/image", "medium"))
    import src.ai_interaction as ai
    monkeypatch.setattr(ai, "_resolve_model",
                        lambda spec, owner=None: ("https://openrouter.ai/api/v1/chat/completions", "m/image", {}))

    seen = {}

    async def fake_chat(client, url, model_id, prompt, headers, reference_png=None):
        seen["prompt"] = prompt
        return b"PNG"
    monkeypatch.setattr(op, "_generate_via_chat_completions", fake_chat)

    _run(op._generate_one("base", "u", reference_png=b"HEADSHOT"))
    assert seen["prompt"].startswith(op.REFERENCE_PROMPT_PREFIX)
