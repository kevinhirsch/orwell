"""Lane G32 — a generated-but-unpicked headshot photoset persists across refresh.

Bug: after the studio generated 3 AI options, a page refresh dropped them — the picker
vanished back to the upload chooser. The candidate images DO persist server-side
(_intake/cand-*.png) and intake_status reports the count; the fix restores the picker from
that count on reload. These pin the server-side persistence contract the FE relies on, plus
the FE rebuild seam.

Roles only; provider/generation faked.
"""

import asyncio
import importlib
import io

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image

op = importlib.import_module("src.orwell_portraits")
orwell_routes = importlib.import_module("routes.orwell_routes")


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def _img():
    b = io.BytesIO(); Image.new("RGB", (64, 64), (70, 90, 110)).save(b, "PNG"); return b.getvalue()


@pytest.fixture
def tmp(tmp_path, monkeypatch):
    monkeypatch.setattr(op, "PORTRAITS_DIR", tmp_path / "portraits")
    monkeypatch.setattr(op, "AVATARS_DIR", tmp_path / "avatars")
    monkeypatch.setattr(op, "HEADSHOTS_DIR", tmp_path / "headshots")
    monkeypatch.setattr(op, "PORTRAIT_LOG_PATH", tmp_path / "portrait-log.jsonl")
    return tmp_path


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("AUTH_ENABLED", "false")
    app = FastAPI(); app.include_router(orwell_routes.setup_orwell_routes())
    return TestClient(app, raise_server_exceptions=False)


def _fake_gen(monkeypatch):
    async def gen(prompt, user, reference_png=None):
        return b"\x89PNG-cand"
    monkeypatch.setattr(op, "_generate_one", gen)
    monkeypatch.setattr(op, "image_generation_available", lambda u: True)


def test_intake_status_reports_pending_candidate_count(tmp, monkeypatch):
    _fake_gen(monkeypatch)
    op.save_player_intake("u", _img(), "reference")
    _run(op.generate_studio_candidates("u", 3))
    # The count the FE rebuilds the picker from — and it's NOT finalized.
    st = op.intake_status("u")
    assert st["candidates"] == 3 and st["finalized"] is False


def test_candidates_survive_a_simulated_refresh(tmp, monkeypatch, client):
    _fake_gen(monkeypatch)
    client.post("/api/orwell/portrait/intake", files={"file": ("me.png", _img(), "image/png")}, data={"mode": "reference"})
    client.post("/api/orwell/portrait/studio/generate")
    # A "refresh" is just a fresh status read + re-serving the candidate images.
    st = client.get("/api/orwell/portrait/intake").json()
    assert st["candidates"] == 3 and st["finalized"] is False
    for i in range(3):
        assert client.get(f"/api/orwell/portrait/studio/candidate/{i}").status_code == 200


def test_finalizing_a_pick_clears_the_pending_set(tmp, monkeypatch, client):
    _fake_gen(monkeypatch)
    client.post("/api/orwell/portrait/intake", files={"file": ("me.png", _img(), "image/png")}, data={"mode": "reference"})
    client.post("/api/orwell/portrait/studio/generate")
    client.post("/api/orwell/portrait/studio/finalize", json={"index": 0})
    st = client.get("/api/orwell/portrait/intake").json()
    assert st["candidates"] == 0 and st["finalized"] is True   # consumed on pick


def test_fe_rebuilds_the_picker_from_the_persisted_count():
    import os
    p = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                     "static", "js", "orwellHeadshot.js")
    js = open(p, encoding="utf-8").read()
    # refreshStatus reconstructs st.candidates from status.candidates (the persisted count),
    # only when not finalized — so a refresh re-shows the option grid.
    assert "status.candidates" in js
    assert "/api/orwell/portrait/studio/candidate/" in js
    assert "!status.finalized" in js
