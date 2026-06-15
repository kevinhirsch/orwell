"""Lane G30 — the persistent headshot library.

Every headshot uploaded (exact) or selected from the AI studio is cached as a reusable option;
the player can re-pick any at the start of a season or from Settings, anytime. The avatar /
season portrait is whichever cached headshot is CURRENT. The library is account-level — it
survives a new-season scrub.

Roles only; PIL real, providers faked.
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


def _png(color=(80, 80, 80)):
    b = io.BytesIO(); Image.new("RGB", (64, 64), color).save(b, "PNG"); return b.getvalue()


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


# ── library mechanics ──────────────────────────────────────────────────────────

def test_finalize_caches_and_makes_current(tmp):
    op.finalize_player_headshot("u", _png((200, 0, 0)), kind="upload")
    op.finalize_player_headshot("u", _png((0, 200, 0)), kind="studio")
    lib = op.list_headshots("u")
    assert len(lib) == 2
    assert lib[0]["current"] is True and lib[0]["kind"] == "studio"   # newest is current
    assert lib[1]["current"] is False and lib[1]["kind"] == "upload"
    assert op.user_avatar_path("u") is not None


def test_select_a_cached_headshot_makes_it_current(tmp):
    op.finalize_player_headshot("u", _png((200, 0, 0)), kind="upload")
    op.finalize_player_headshot("u", _png((0, 200, 0)), kind="studio")
    older = [h for h in op.list_headshots("u") if h["kind"] == "upload"][0]["id"]
    assert op.select_headshot("u", older) is True
    cur = [h for h in op.list_headshots("u") if h["current"]]
    assert len(cur) == 1 and cur[0]["kind"] == "upload"
    assert op.portrait_file("u", "player") is not None              # the live season portrait too


def test_library_survives_a_new_season_scrub(tmp):
    op.finalize_player_headshot("u", _png(), kind="upload")
    op.scrub_user("u")                                              # new season
    assert len(op.list_headshots("u")) == 1                        # cached options persist
    assert op.user_avatar_path("u") is not None                    # and the avatar


def test_library_cap_evicts_oldest_non_current(tmp, monkeypatch):
    monkeypatch.setattr(op, "HEADSHOT_LIBRARY_MAX", 3)
    import time
    for i in range(5):
        op.finalize_player_headshot("u", _png((i * 10, 0, 0)), kind="studio")
        time.sleep(0.002)  # distinct ms ids
    lib = op.list_headshots("u")
    assert len(lib) == 3
    assert sum(1 for h in lib if h["current"]) == 1                # the current one is kept


def test_delete_removes_a_cached_headshot(tmp):
    op.finalize_player_headshot("u", _png(), kind="upload")
    hid = op.list_headshots("u")[0]["id"]
    assert op.delete_headshot("u", hid) is True
    assert op.list_headshots("u") == []
    assert op.delete_headshot("u", "nope") is False


# ── routes ─────────────────────────────────────────────────────────────────────

def test_library_routes_list_serve_select_delete(tmp, client):
    # seed two via the exact-upload route (each caches a 'upload' headshot)
    client.post("/api/orwell/portrait/intake", files={"file": ("a.png", _png((200, 0, 0)), "image/png")}, data={"mode": "exact"})
    client.post("/api/orwell/portrait/intake", files={"file": ("b.png", _png((0, 0, 200)), "image/png")}, data={"mode": "exact"})
    lib = client.get("/api/orwell/portrait/library").json()["headshots"]
    assert len(lib) == 2
    # the item image serves
    assert client.get(lib[0]["ref"]).status_code == 200
    # select the non-current one
    target = next(h for h in lib if not h["current"])
    assert client.post("/api/orwell/portrait/library/select", json={"id": target["id"]}).json()["ok"] is True
    relib = client.get("/api/orwell/portrait/library").json()["headshots"]
    assert next(h for h in relib if h["id"] == target["id"])["current"] is True
    # delete one
    assert client.request("DELETE", "/api/orwell/portrait/library/" + lib[0]["id"]).json()["ok"] is True
    assert len(client.get("/api/orwell/portrait/library").json()["headshots"]) == 1


def test_select_rejects_unknown_id(tmp, client):
    assert client.post("/api/orwell/portrait/library/select", json={"id": "nope"}).status_code == 400
