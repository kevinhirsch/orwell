"""Lane G26 — the player's own casting headshot.

During casting the player may upload a photo to use as their portrait, two ways:
  • 'exact'     — their photo, square-cropped to the face, stored verbatim (NO AI; works
                  even with no image model configured);
  • 'reference' — an image-to-image studio portrait that keeps their likeness (still AI,
                  re-creatable on a regenerate).

The contract under test:
  • intake round-trips (save/load/clear); a bad upload is rejected, not raised;
  • exact application is provider-free, square, source='upload', and LOCKED (the regenerate
    lever never discards it);
  • reference application calls _generate_one with the reference image, source='reference';
  • only the PLAYER honors the intake — NPCs are always text-to-image;
  • _generate_one routes a reference: OpenRouter→chat image part, OpenAI→/images/edits,
    other→text-to-image fallback (a portrait still lands);
  • the routes store/report/clear, gated to images and a size cap.

Roles only; PIL real, providers/network faked.
"""

import asyncio
import importlib
import io

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image

op = importlib.import_module("src.orwell_portraits")
orwell_engine = importlib.import_module("src.orwell_engine")
orwell_routes = importlib.import_module("routes.orwell_routes")


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def _img(fmt="JPEG", w=900, h=1200, color=(120, 80, 60)):
    b = io.BytesIO()
    Image.new("RGB", (w, h), color).save(b, fmt)
    return b.getvalue()


@pytest.fixture
def tmp_portraits(tmp_path, monkeypatch):
    monkeypatch.setattr(op, "PORTRAITS_DIR", tmp_path / "portraits")
    monkeypatch.setattr(op, "AVATARS_DIR", tmp_path / "avatars")  # G27: isolate the account avatar too
    monkeypatch.setattr(op, "PORTRAIT_LOG_PATH", tmp_path / "portrait-log.jsonl")
    monkeypatch.setattr(op, "_LAST_BACKFILL_AT", {})
    return tmp_path / "portraits"


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("AUTH_ENABLED", "false")
    app = FastAPI()
    app.include_router(orwell_routes.setup_orwell_routes())
    return TestClient(app, raise_server_exceptions=False)


# ── intake storage ─────────────────────────────────────────────────────────────

def test_intake_round_trips_and_normalizes_mode(tmp_portraits):
    saved = op.save_player_intake("u", _img(), "exact")
    assert saved["mode"] == "exact"
    assert op.load_player_intake("u")["mode"] == "exact"
    # an unknown mode falls back to 'reference' (the safer, still-AI default)
    op.save_player_intake("u", _img(), "banana")
    assert op.load_player_intake("u")["mode"] == "reference"
    op.clear_player_intake("u")
    assert op.load_player_intake("u") is None


def test_bad_upload_is_rejected_not_raised(tmp_portraits):
    assert op.save_player_intake("u", b"not an image", "exact") is None
    assert op.load_player_intake("u") is None


def test_exact_crop_is_square(tmp_portraits):
    cropped = op._normalize_upload(_img(w=900, h=1200), square=True)
    im = Image.open(io.BytesIO(cropped))
    assert im.size[0] == im.size[1]


# ── exact application: provider-free, locked ───────────────────────────────────

def test_exact_applies_without_a_provider(tmp_portraits, monkeypatch):
    monkeypatch.setattr(op, "image_generation_available", lambda u: False)  # NO image model

    async def boom(*a, **k):
        raise AssertionError("exact mode must never call the image API")
    monkeypatch.setattr(op, "_generate_one", boom)

    op.save_player_intake("u", _img(), "exact")
    summary = _run(op.generate_and_store(
        [{"houseguestId": "player", "name": "P", "prompt": "x"},
         {"houseguestId": "npc:1", "name": "N", "prompt": "y"}], "u", record_beats=False))
    assert summary["generated"] == 1                       # the player photo, not the NPC
    assert op.portrait_file("u", "player") is not None
    assert op.load_manifest("u")["player"]["source"] == "upload"
    im = Image.open(op.portrait_file("u", "player"))
    assert im.size[0] == im.size[1]                        # square-cropped


def test_uploaded_photo_is_locked_against_the_regenerate_lever(tmp_portraits, monkeypatch):
    monkeypatch.setattr(op, "image_generation_available", lambda u: False)
    op.save_player_intake("u", _img(), "exact")
    _run(op.generate_and_store([{"houseguestId": "player", "name": "P", "prompt": "x"}], "u", record_beats=False))
    removed = op.discard_portraits("u", ["player"])
    assert removed == 0                                    # the literal photo is never discarded
    assert op.portrait_file("u", "player") is not None


# ── reference application: image-to-image, regenerable ─────────────────────────

def test_reference_calls_generate_with_the_reference_image(tmp_portraits, monkeypatch):
    monkeypatch.setattr(op, "image_generation_available", lambda u: True)
    seen = {}

    async def fake_gen(prompt, user, reference_png=None):
        seen["ref"] = reference_png
        seen["prompt"] = prompt
        return b"\x89PNG-ref"
    monkeypatch.setattr(op, "_generate_one", fake_gen)

    op.save_player_intake("u", _img(), "reference")
    _run(op.generate_and_store([{"houseguestId": "player", "name": "P", "prompt": "x"}], "u", record_beats=False))
    assert seen["ref"] is not None                         # the headshot rode along
    assert op.load_manifest("u")["player"]["source"] == "reference"
    # a reference portrait IS discardable (it re-renders off the persisted headshot)
    assert op.discard_portraits("u", ["player"]) == 1


def test_npc_never_uses_the_player_intake(tmp_portraits, monkeypatch):
    monkeypatch.setattr(op, "image_generation_available", lambda u: True)
    refs = []

    async def fake_gen(prompt, user, reference_png=None):
        refs.append(reference_png)
        return b"\x89PNG"
    monkeypatch.setattr(op, "_generate_one", fake_gen)

    op.save_player_intake("u", _img(), "reference")
    _run(op.generate_and_store([{"houseguestId": "npc:1", "name": "N", "prompt": "y"}], "u", record_beats=False))
    assert refs == [None]                                  # the NPC got no reference


# ── _generate_one reference routing ────────────────────────────────────────────

def _resolver(monkeypatch, url, model_id):
    import src.ai_interaction as ai
    monkeypatch.setattr(ai, "_resolve_model", lambda spec, owner=None: (url, model_id, {}))
    monkeypatch.setattr(op, "_image_settings", lambda u: (True, model_id, "medium"))


def test_reference_openrouter_uses_chat_image_part(tmp_portraits, monkeypatch):
    _resolver(monkeypatch, "https://openrouter.ai/api/v1/chat/completions", "google/gemini-2.5-flash-image")
    got = {}

    async def fake_chat(client, url, model_id, prompt, headers, reference_png=None):
        got["ref"] = reference_png
        got["prompt"] = prompt
        return b"OK"
    monkeypatch.setattr(op, "_generate_via_chat_completions", fake_chat)
    out = _run(op._generate_one("studio portrait", "u", reference_png=b"REF"))
    assert out == b"OK"
    assert got["ref"] == b"REF"
    assert got["prompt"].startswith(op.REFERENCE_PROMPT_PREFIX)   # identity-keep instruction


def test_reference_openai_uses_images_edit(tmp_portraits, monkeypatch):
    _resolver(monkeypatch, "https://api.openai.com/v1/chat/completions", "gpt-image-1")
    got = {}

    async def fake_edit(client, base_url, model_id, prompt, headers, reference_png, quality):
        got["ref"] = reference_png
        return b"EDIT"
    monkeypatch.setattr(op, "_generate_via_images_edit", fake_edit)
    out = _run(op._generate_one("studio portrait", "u", reference_png=b"REF"))
    assert out == b"EDIT"
    assert got["ref"] == b"REF"


def test_reference_unsupported_provider_falls_back_to_text_to_image(tmp_portraits, monkeypatch):
    import httpx
    _resolver(monkeypatch, "https://api.example.com/v1/chat/completions", "some-flux-model")

    class _Resp:
        status_code = 200
        def json(self):
            import base64
            return {"data": [{"b64_json": base64.b64encode(b"T2I").decode()}]}

    class _Client:
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def post(self, *a, **k): return _Resp()   # the /images/generations call
    monkeypatch.setattr(httpx, "AsyncClient", lambda *a, **k: _Client())

    def _no_edit(*a, **k):
        raise AssertionError("a non-OpenAI provider must not hit /images/edits")
    monkeypatch.setattr(op, "_generate_via_images_edit", _no_edit)

    out = _run(op._generate_one("studio portrait", "u", reference_png=b"REF"))
    assert out == b"T2I"     # a portrait still lands (likeness best-effort, fallback logged)


# ── the routes ─────────────────────────────────────────────────────────────────

def test_route_stores_reports_and_clears(tmp_portraits, client):
    r = client.post("/api/orwell/portrait/intake",
                    files={"file": ("me.jpg", _img(), "image/jpeg")}, data={"mode": "exact"})
    assert r.status_code == 200 and r.json() == {"ok": True, "mode": "exact", "finalized": True}
    st = client.get("/api/orwell/portrait/intake").json()
    assert st["present"] is True and st["mode"] == "exact" and st["finalized"] is True
    assert client.request("DELETE", "/api/orwell/portrait/intake").json() == {"ok": True}
    st = client.get("/api/orwell/portrait/intake").json()
    assert st["present"] is False and st["mode"] is None


def test_route_rejects_a_non_image(tmp_portraits, client):
    r = client.post("/api/orwell/portrait/intake",
                    files={"file": ("notes.txt", b"hello", "text/plain")}, data={"mode": "reference"})
    assert r.status_code == 400


def test_route_rejects_an_oversize_upload(tmp_portraits, client):
    big = b"\x89" * (13 * 1024 * 1024)
    r = client.post("/api/orwell/portrait/intake",
                    files={"file": ("big.png", big, "image/png")}, data={"mode": "exact"})
    assert r.status_code == 413
