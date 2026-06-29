"""Issue #1153 / ADR 0016 §C — fal.ai Seedream v5 Lite portrait provider.

The #1140 fix: portraits move to reference-image conditioning on a NEW provider (fal.ai Seedream —
not on OpenRouter, which froze the /chat/completions image path the Gemini portraits use). One
canonical headshot per houseguest is persisted and regenerated AGAINST it (`image_urls`), so the
face + gender stay stable.

Covered here:
  • the fal client builds the request (POST <base>/<slug>, `image_urls` data-URIs, image_size) and
    parses the {images:[{url}]} response (URL fetch + inline data-URI);
  • fal auth/url plumbing in endpoint_resolver (Key auth, no /chat/completions, fal detection);
  • _generate_one ROUTES a fal endpoint to the fal client (and gemini/openai do NOT route there);
  • the reference pipeline — a re-shoot of a houseguest with a stored portrait carries that portrait
    as the fal reference (identity-carry);
  • graceful fallback — no fal endpoint configured ⇒ the current Gemini path is used, fal untouched;
  • image_gen_enabled=false short-circuits (no generation).

Roles only; httpx + fal fully faked (NO real fal calls — there is no key in CI).
"""

import asyncio
import base64
import importlib
import json

import pytest

fal = importlib.import_module("src.orwell_fal_image")
op = importlib.import_module("src.orwell_portraits")
er = importlib.import_module("src.endpoint_resolver")
ai = importlib.import_module("src.ai_interaction")


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
    """Minimal async httpx.AsyncClient stand-in. `posts` is one response or a sequence; `get` is the
    response for any .get(). Records post (url, json, headers) and get urls for assertions."""
    def __init__(self, posts=(), get=None):
        self._posts = list(posts) if isinstance(posts, (list, tuple)) else [posts]
        self._i = 0
        self._get = get
        self.posts = []        # (url, json, headers)
        self.gets = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def post(self, url, json=None, headers=None):
        self.posts.append((url, json, headers))
        r = self._posts[min(self._i, len(self._posts) - 1)]
        self._i += 1
        return r

    async def get(self, url):
        self.gets.append(url)
        return self._get


# ── the fal client: slug routing by reference presence (the #1153 fix) ─────────────
# `/edit` REQUIRES image_urls (422s without), so a FIRST shoot (no reference) MUST route to
# `/text-to-image` and only a re-shoot (reference present) to `/edit`.

def test_fal_endpoint_url_first_shoot_routes_to_text_to_image():
    # no reference ⇒ /text-to-image, regardless of how the model_id was configured
    for slug in (fal.FAL_SEEDREAM_BASE_SLUG, fal.FAL_SEEDREAM_EDIT_SLUG, fal.FAL_SEEDREAM_T2I_SLUG):
        assert fal.fal_endpoint_url("https://fal.run", slug, has_reference=False) \
            == "https://fal.run/" + fal.FAL_SEEDREAM_T2I_SLUG


def test_fal_endpoint_url_reshoot_routes_to_edit():
    # a reference present ⇒ /edit, regardless of how the model_id was configured
    for slug in (fal.FAL_SEEDREAM_BASE_SLUG, fal.FAL_SEEDREAM_EDIT_SLUG, fal.FAL_SEEDREAM_T2I_SLUG):
        assert fal.fal_endpoint_url("https://fal.run", slug, has_reference=True) \
            == "https://fal.run/" + fal.FAL_SEEDREAM_EDIT_SLUG


def test_fal_endpoint_url_defaults_to_first_shoot():
    # default (no has_reference arg) is the first-shoot path — the common case
    assert fal.fal_endpoint_url("https://fal.run", fal.FAL_SEEDREAM_EDIT_SLUG) \
        == "https://fal.run/" + fal.FAL_SEEDREAM_T2I_SLUG


def test_fal_endpoint_url_strips_stray_chat_suffix():
    assert fal.fal_endpoint_url("https://fal.run/chat/completions", fal.FAL_SEEDREAM_EDIT_SLUG,
                                has_reference=True) \
        == "https://fal.run/" + fal.FAL_SEEDREAM_EDIT_SLUG


def test_fal_first_shoot_routes_text_to_image_with_no_image_urls():
    # The bug this fixes: a reference-free first shoot must NOT hit /edit (which 422s "image_urls
    # required") — it hits /text-to-image and sends NO image_urls.
    client = _Client(_Resp(200, {"images": [{"url": "https://cdn.fal/x.png"}]}), get=_Resp(200, content=b"PNG"))
    out, reason, _ = _run(fal.generate_via_fal(
        client, "https://fal.run", fal.FAL_SEEDREAM_EDIT_SLUG, "a portrait", {"Authorization": "Key K"}))
    assert out == b"PNG" and reason is None
    url, payload, headers = client.posts[0]
    assert url.endswith(fal.FAL_SEEDREAM_T2I_SLUG)   # routed to text→image, NOT /edit
    assert payload["prompt"] == "a portrait"
    assert payload["image_size"] == fal.FAL_DEFAULT_IMAGE_SIZE
    assert payload["num_images"] == 1
    assert "image_urls" not in payload              # no reference ⇒ text→image, no image_urls
    assert "max_images" not in payload              # max_images is an /edit-only field
    assert headers["Authorization"] == "Key K"      # the fal Key auth rides through


def test_fal_reshoot_routes_to_edit_with_reference_as_data_uri():
    client = _Client(_Resp(200, {"images": [{"url": "https://cdn.fal/x.png"}]}), get=_Resp(200, content=b"PNG"))
    # configure the model as the bare slug to prove routing isn't carried on the model id
    out, _, _ = _run(fal.generate_via_fal(
        client, "https://fal.run", fal.FAL_SEEDREAM_BASE_SLUG, "p", {}, reference_pngs=[b"REFBYTES"]))
    assert out == b"PNG"
    url, payload, _ = client.posts[0]
    assert url.endswith(fal.FAL_SEEDREAM_EDIT_SLUG)  # a reference ⇒ /edit
    assert isinstance(payload["image_urls"], list) and len(payload["image_urls"]) == 1
    assert payload["image_urls"][0].startswith("data:image/png;base64,")
    assert base64.b64decode(payload["image_urls"][0].split(",", 1)[1]) == b"REFBYTES"
    assert payload["max_images"] == 1               # /edit carries max_images


def test_fal_caps_reference_images_at_ten():
    client = _Client(_Resp(200, {"images": [{"url": "https://cdn.fal/x.png"}]}), get=_Resp(200, content=b"PNG"))
    _run(fal.generate_via_fal(client, "https://fal.run", fal.FAL_SEEDREAM_EDIT_SLUG, "p", {},
                              reference_pngs=[b"r"] * 15))
    _, payload, _ = client.posts[0]
    assert len(payload["image_urls"]) == 10


# ── the fal client: response parse ───────────────────────────────────────────────

def test_fal_parses_inline_data_uri_response():
    data_uri = "data:image/png;base64," + base64.b64encode(b"INLINE").decode()
    client = _Client(_Resp(200, {"images": [{"url": data_uri}]}))
    out, reason, _ = _run(fal.generate_via_fal(client, "https://fal.run", fal.FAL_SEEDREAM_EDIT_SLUG, "p", {}))
    assert out == b"INLINE" and reason is None
    assert client.gets == []  # an inline data-uri is decoded directly, never fetched


def test_fal_http_error_returns_reason_not_raise():
    client = _Client(_Resp(422, {"detail": [{"msg": "image_urls is required"}]}, text="x"))
    out, reason, detail = _run(fal.generate_via_fal(client, "https://fal.run", fal.FAL_SEEDREAM_EDIT_SLUG, "p", {}))
    assert out is None
    assert reason == "http-422"
    assert "image_urls" in (detail or "")


def test_fal_no_image_in_response():
    client = _Client(_Resp(200, {"seed": 1, "images": []}))
    out, reason, _ = _run(fal.generate_via_fal(client, "https://fal.run", fal.FAL_SEEDREAM_EDIT_SLUG, "p", {}))
    assert out is None and reason == "no-image-in-response"


def test_fal_transport_exception_is_caught():
    class _Boom(_Client):
        async def post(self, *a, **k):
            raise RuntimeError("conn reset")
    out, reason, _ = _run(fal.generate_via_fal(_Boom(), "https://fal.run", fal.FAL_SEEDREAM_EDIT_SLUG, "p", {}))
    assert out is None and reason == "RuntimeError"


# ── endpoint_resolver fal plumbing ───────────────────────────────────────────────

def test_resolver_detects_fal_host():
    assert er.is_fal_url("https://fal.run")
    assert er.is_fal_url("https://queue.fal.run/x")
    assert not er.is_fal_url("https://openrouter.ai/api/v1")
    assert not er.is_fal_url("https://example.com/?ref=fal.run")  # host-based, not substring


def test_resolver_fal_uses_key_auth_not_bearer():
    h = er.build_headers("MYKEY", "https://fal.run")
    assert h["Authorization"] == "Key MYKEY"
    assert "Bearer" not in h["Authorization"]


def test_resolver_fal_chat_url_is_base_unchanged():
    # fal has no /chat/completions — build_chat_url leaves a fal base alone
    assert er.build_chat_url("https://fal.run") == "https://fal.run"
    # a non-fal base still gets the chat suffix
    assert er.build_chat_url("https://api.openai.com/v1").endswith("/chat/completions")


def test_is_fal_model():
    assert fal.is_fal_model("fal-ai/bytedance/seedream/v5/lite/edit")
    assert fal.is_fal_model("seedream-v5")
    assert not fal.is_fal_model("google/gemini-2.5-flash-image")
    assert not fal.is_fal_model("")


# ── _generate_one routing ────────────────────────────────────────────────────────

def test_generate_one_routes_fal_to_fal_client(monkeypatch):
    monkeypatch.setattr(op, "_image_settings",
                        lambda u: (True, "fal-ai/bytedance/seedream/v5/lite/edit", "medium"))
    import src.ai_interaction as ai
    monkeypatch.setattr(ai, "_resolve_model",
                        lambda spec, owner=None: ("https://fal.run",
                                                  "fal-ai/bytedance/seedream/v5/lite/edit",
                                                  {"Authorization": "Key K"}))

    seen = {}

    async def fake_fal(client, base_url, model_id, prompt, headers, reference_pngs=None,
                       image_size=fal.FAL_DEFAULT_IMAGE_SIZE):
        seen["base_url"] = base_url
        seen["model_id"] = model_id
        seen["refs"] = reference_pngs
        return b"FALPNG", None, None
    monkeypatch.setattr(fal, "generate_via_fal", fake_fal)

    # a non-fal transport must NOT be used
    def _no_chat(*a, **k):
        raise AssertionError("fal must not route through the chat path")
    monkeypatch.setattr(op, "_generate_via_chat_completions", _no_chat)

    out = _run(op._generate_one("a portrait", "u", reference_png=b"REF"))
    assert out == b"FALPNG"
    assert seen["base_url"] == "https://fal.run"
    assert seen["model_id"] == "fal-ai/bytedance/seedream/v5/lite/edit"
    assert seen["refs"] == [b"REF"]  # the reference is forwarded as identity-carry


def test_generate_one_gemini_does_not_route_to_fal(monkeypatch):
    monkeypatch.setattr(op, "_image_settings", lambda u: (True, "google/gemini-2.5-flash-image", "medium"))
    import src.ai_interaction as ai
    monkeypatch.setattr(ai, "_resolve_model",
                        lambda spec, owner=None: ("https://openrouter.ai/api/v1/chat/completions",
                                                  "google/gemini-2.5-flash-image", {}))

    def _no_fal(*a, **k):
        raise AssertionError("a gemini/openrouter endpoint must not route to fal (graceful fallback)")
    monkeypatch.setattr(fal, "generate_via_fal", _no_fal)

    async def fake_chat(client, url, model_id, prompt, headers, reference_png=None):
        return b"CHATPNG"
    monkeypatch.setattr(op, "_generate_via_chat_completions", fake_chat)

    assert _run(op._generate_one("p", "u")) == b"CHATPNG"


def test_generate_one_fal_failure_records_reason(monkeypatch):
    monkeypatch.setattr(op, "_image_settings", lambda u: (True, fal.FAL_SEEDREAM_EDIT_SLUG, "medium"))
    import src.ai_interaction as ai
    monkeypatch.setattr(ai, "_resolve_model",
                        lambda spec, owner=None: ("https://fal.run", fal.FAL_SEEDREAM_EDIT_SLUG, {}))

    async def fake_fal(*a, **k):
        return None, "http-401", "bad key"
    monkeypatch.setattr(fal, "generate_via_fal", fake_fal)

    op._consume_gen_error(); op._consume_gen_detail()
    assert _run(op._generate_one("p", "u")) is None
    assert op._consume_gen_error() == "http-401"


# ── image_gen_enabled gate ───────────────────────────────────────────────────────

def test_generate_one_disabled_short_circuits(monkeypatch):
    monkeypatch.setattr(op, "_image_settings", lambda u: (False, fal.FAL_SEEDREAM_EDIT_SLUG, "medium"))

    def _no_fal(*a, **k):
        raise AssertionError("generation is disabled — fal must not be called")
    monkeypatch.setattr(fal, "generate_via_fal", _no_fal)
    assert _run(op._generate_one("p", "u")) is None


# ── _resolve_model: a fal endpoint resolves the slug with NO network probe ─────────

def _seed_fal_endpoint(ep_id="fal_ep", *, owner=None):
    from core.database import SessionLocal, ModelEndpoint
    db = SessionLocal()
    try:
        db.query(ModelEndpoint).filter(ModelEndpoint.id == ep_id).delete()
        db.add(ModelEndpoint(
            id=ep_id, name="fal.ai", base_url="https://fal.run", api_key="FALKEY",
            is_enabled=True, model_type="llm", cached_models=None, owner=owner,
        ))
        db.commit()
    finally:
        db.close()


def _clear_endpoints():
    from core.database import SessionLocal, ModelEndpoint
    db = SessionLocal()
    try:
        db.query(ModelEndpoint).delete()
        db.commit()
    finally:
        db.close()


def test_resolve_model_fal_returns_slug_and_key_auth_without_probe(monkeypatch):
    import src.auth_helpers as auth_helpers
    monkeypatch.setattr(auth_helpers, "is_admin_user", lambda u: True)
    # If _resolve_model tried to probe fal's (non-existent) /models, this would blow up.
    import httpx
    monkeypatch.setattr(httpx, "get", lambda *a, **k: (_ for _ in ()).throw(
        AssertionError("a fal endpoint must NOT be catalog-probed")))
    _clear_endpoints()
    _seed_fal_endpoint()
    try:
        url, model_id, headers = ai._resolve_model("fal-ai/bytedance/seedream/v5/lite/edit", owner="admin")
        assert url == "https://fal.run"
        assert model_id == "fal-ai/bytedance/seedream/v5/lite/edit"
        assert headers["Authorization"] == "Key FALKEY"
    finally:
        _clear_endpoints()


def test_resolve_model_non_fal_spec_skips_fal_endpoint(monkeypatch):
    # a chat-model spec must NOT resolve against a fal endpoint (fal serves only its slugs)
    import src.auth_helpers as auth_helpers
    monkeypatch.setattr(auth_helpers, "is_admin_user", lambda u: True)
    _clear_endpoints()
    _seed_fal_endpoint()
    try:
        with pytest.raises(ValueError):
            ai._resolve_model("deepseek/deepseek-v4-pro", owner="admin")
    finally:
        _clear_endpoints()


# ── the reference pipeline: a re-shoot carries the stored portrait (identity-carry) ──

def test_generate_and_store_reshoot_passes_stored_portrait_as_reference(tmp_path, monkeypatch):
    """When a houseguest's facet changes (a re-shoot), generate_and_store feeds the houseguest's
    CURRENT portrait back to _generate_one as the reference — so a reference-image provider keeps the
    SAME face. This is the #1153/#1140 identity-carry on a re-shoot."""
    monkeypatch.setattr(op, "PORTRAITS_DIR", tmp_path / "portraits")
    monkeypatch.setattr(op, "PORTRAIT_LOG_PATH", tmp_path / "log.jsonl")
    monkeypatch.setattr(op, "image_generation_available", lambda u: True)
    monkeypatch.setattr(op, "_image_settings", lambda u: (True, fal.FAL_SEEDREAM_EDIT_SLUG, "medium"))

    user = "u"
    # Seed an existing portrait for npc:3 with a DIFFERENT fingerprint than the new prompt, so the
    # facet-change branch re-shoots it.
    op._write_portrait(user, "npc:3", b"OLDFACE", "NPC", source="generated", fingerprint="oldfp")

    seen_refs = {}

    async def fake_one(prompt, u, reference_png=None):
        seen_refs["ref"] = reference_png
        return b"NEWFACE"
    monkeypatch.setattr(op, "_generate_one", fake_one)
    # no beats (engine not wired in this unit test)
    out = _run(op.generate_and_store(
        [{"houseguestId": "npc:3", "name": "NPC", "prompt": "a brand new look for the houseguest"}],
        user, record_beats=False))
    assert out["generated"] == 1
    # the OLD stored face was handed back as the reference (identity-carry)
    assert seen_refs["ref"] == b"OLDFACE"


def test_generate_and_store_first_shoot_has_no_reference(tmp_path, monkeypatch):
    """A FIRST shoot (no prior portrait) is reference-free — that establishes the canonical headshot."""
    monkeypatch.setattr(op, "PORTRAITS_DIR", tmp_path / "portraits")
    monkeypatch.setattr(op, "PORTRAIT_LOG_PATH", tmp_path / "log.jsonl")
    monkeypatch.setattr(op, "image_generation_available", lambda u: True)
    monkeypatch.setattr(op, "_image_settings", lambda u: (True, fal.FAL_SEEDREAM_EDIT_SLUG, "medium"))

    seen = {}

    async def fake_one(prompt, u, reference_png=None):
        seen["ref"] = reference_png
        return b"FACE"
    monkeypatch.setattr(op, "_generate_one", fake_one)
    out = _run(op.generate_and_store(
        [{"houseguestId": "npc:7", "name": "NPC", "prompt": "the houseguest"}], "u", record_beats=False))
    assert out["generated"] == 1
    assert seen["ref"] is None  # first generation is text→image (canonical headshot)
