"""Lane G27 — the headshot studio + the account avatar.

The finalized casting headshot becomes BOTH the player's houseguest portrait AND the account's
circle avatar (auto-updating). The studio lets the player generate 3 AI options at a time off
their uploaded photo, pick one (or regenerate, indefinitely, or upload new), then finalize.

Contract under test:
  • the account avatar set/get/clear, and that it SURVIVES a new-season scrub (account-level);
  • finalize writes the avatar + the live player portrait (locked source='upload') + the
    persisted final.png a later season reuses;
  • the studio needs an uploaded photo + a provider, generates N image-to-image candidates,
    and a fresh call replaces the set;
  • season start uses the finalized pick (no provider), and a RETURNING player keeps their
    face via the persisted avatar;
  • the routes: studio generate/candidate/finalize, the avatar serve (204→200), and an
    'exact' upload finalizes at once.

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


def _img():
    b = io.BytesIO()
    Image.new("RGB", (900, 1200), (90, 120, 150)).save(b, "JPEG")
    return b.getvalue()


@pytest.fixture
def tmp(tmp_path, monkeypatch):
    monkeypatch.setattr(op, "PORTRAITS_DIR", tmp_path / "portraits")
    monkeypatch.setattr(op, "AVATARS_DIR", tmp_path / "avatars")
    monkeypatch.setattr(op, "PORTRAIT_LOG_PATH", tmp_path / "portrait-log.jsonl")
    monkeypatch.setattr(op, "_LAST_BACKFILL_AT", {})
    return tmp_path


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("AUTH_ENABLED", "false")
    app = FastAPI()
    app.include_router(orwell_routes.setup_orwell_routes())
    return TestClient(app, raise_server_exceptions=False)


# ── the account avatar ─────────────────────────────────────────────────────────

def test_avatar_set_get_clear(tmp):
    assert op.user_avatar_path("u") is None
    op.set_user_avatar("u", b"\x89PNG")
    assert op.user_avatar_path("u") is not None
    op.clear_user_avatar("u")
    assert op.user_avatar_path("u") is None


def test_avatar_survives_a_new_season_scrub(tmp):
    op.set_user_avatar("u", b"\x89PNG")
    op._write_portrait("u", "player", b"\x89PNG", "P", source="upload")
    op.scrub_user("u")                                   # new season clears the cast portraits…
    assert op.portrait_file("u", "player") is None
    assert op.user_avatar_path("u") is not None          # …but the account avatar is the user


# ── finalize ───────────────────────────────────────────────────────────────────

def test_finalize_sets_avatar_live_portrait_and_final(tmp):
    png = op._normalize_upload(_img(), square=True)
    assert op.finalize_player_headshot("u", png) is True
    assert op.user_avatar_path("u") is not None                       # the circle
    assert op.portrait_file("u", "player") is not None                # the live game portrait
    assert op.load_manifest("u")["player"]["source"] == "upload"      # locked
    assert op._read_intake_final("u") is not None                     # the durable pick
    # locked against the regenerate lever
    assert op.discard_portraits("u", ["player"]) == 0


# ── the studio ─────────────────────────────────────────────────────────────────

def test_studio_needs_a_photo_then_generates_image_to_image_options(tmp, monkeypatch):
    monkeypatch.setattr(op, "image_generation_available", lambda u: True)
    # no photo yet → refused, nothing made
    assert _run(op.generate_studio_candidates("u", 3))["generated"] == 0

    refs = []

    async def fake_gen(prompt, user, reference_png=None):
        refs.append(reference_png)
        return b"\x89PNG-cand"
    monkeypatch.setattr(op, "_generate_one", fake_gen)

    op.save_player_intake("u", _img(), "reference")
    res = _run(op.generate_studio_candidates("u", 3))
    assert res["generated"] == 3
    assert op.candidate_count("u") == 3
    assert all(r is not None for r in refs)              # every option is image-to-image off the photo

    # a fresh call REPLACES the set (back-and-forth), still 3
    _run(op.generate_studio_candidates("u", 3))
    assert op.candidate_count("u") == 3


def test_studio_needs_a_provider(tmp, monkeypatch):
    monkeypatch.setattr(op, "image_generation_available", lambda u: False)
    op.save_player_intake("u", _img(), "reference")
    assert _run(op.generate_studio_candidates("u", 3))["generated"] == 0


# ── season start uses the chosen headshot / the avatar ─────────────────────────

def test_season_start_uses_the_finalized_pick_without_a_provider(tmp, monkeypatch):
    monkeypatch.setattr(op, "image_generation_available", lambda u: False)
    op.finalize_player_headshot("u", op._normalize_upload(_img(), square=True))
    op.discard_portraits("u", [])  # no-op; the player portrait is locked anyway
    # simulate a fresh season dir without the live portrait but WITH the final.png intact
    (op.user_portrait_dir("u") / "player.png").unlink()
    summary = _run(op.generate_and_store(
        [{"houseguestId": "player", "name": "P", "prompt": "x"}], "u", record_beats=False))
    assert summary["generated"] == 1
    assert op.load_manifest("u")["player"]["source"] == "upload"


def test_returning_player_keeps_their_face_via_the_avatar(tmp, monkeypatch):
    monkeypatch.setattr(op, "image_generation_available", lambda u: False)
    op.set_user_avatar("u", op._normalize_upload(_img(), square=True))  # avatar only, no intake
    summary = _run(op.generate_and_store(
        [{"houseguestId": "player", "name": "P", "prompt": "x"}], "u", record_beats=False))
    assert summary["generated"] == 1                     # the avatar seeded the player portrait
    assert op.portrait_file("u", "player") is not None


# ── routes ─────────────────────────────────────────────────────────────────────

def test_exact_upload_route_finalizes_and_sets_avatar(tmp, client):
    r = client.post("/api/orwell/portrait/intake",
                    files={"file": ("me.jpg", _img(), "image/jpeg")}, data={"mode": "exact"})
    assert r.json() == {"ok": True, "mode": "exact", "finalized": True}
    assert client.get("/api/orwell/avatar").status_code == 200            # the circle is live


def test_studio_routes_generate_serve_and_finalize(tmp, client, monkeypatch):
    monkeypatch.setattr(op, "image_generation_available", lambda u: True)

    async def fake_gen(prompt, user, reference_png=None):
        return b"\x89PNG-" + (b"R" if reference_png else b"X")
    monkeypatch.setattr(op, "_generate_one", fake_gen)

    # avatar absent until finalized — 204 (not 404) so it's not a console error every load (F-S1-C)
    assert client.get("/api/orwell/avatar").status_code == 204
    client.post("/api/orwell/portrait/intake",
                files={"file": ("me.jpg", _img(), "image/jpeg")}, data={"mode": "reference"})
    gen = client.post("/api/orwell/portrait/studio/generate").json()
    assert gen["generated"] == 3 and len(gen["candidates"]) == 3
    # the option images serve
    assert client.get("/api/orwell/portrait/studio/candidate/1").status_code == 200
    # pick one → finalized → avatar live
    fin = client.post("/api/orwell/portrait/studio/finalize", json={"index": 1}).json()
    assert fin == {"ok": True, "finalized": True}
    assert client.get("/api/orwell/avatar").status_code == 200


def test_studio_finalize_rejects_a_missing_candidate(tmp, client):
    assert client.post("/api/orwell/portrait/studio/finalize", json={"index": 9}).status_code == 400
