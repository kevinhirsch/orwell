"""Feature 0051 — in-character cast portraits (front-end half).

Name-agnostic (roles only). Covers the FE pipeline the spec pins for pytest:
  • generation triggered on createCharacter with portraitPrompts
  • skip (silent) when image generation is unavailable / disabled — game plays identically
  • persistence: a file + manifest entry written; NOT regenerated when already present
  • cast roster route: name + status + portrait ref, and Vault-free (no hidden content)
  • factory/game scrub removes the portraits dir

Generation itself is monkeypatched (deterministic, no image API / no engine).
"""

import asyncio
import importlib
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

orwell_portraits = importlib.import_module("src.orwell_portraits")
orwell_engine = importlib.import_module("src.orwell_engine")
orwell_routes = importlib.import_module("routes.orwell_routes")


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


@pytest.fixture
def tmp_portraits(tmp_path, monkeypatch):
    """Redirect the portraits dir to a throwaway tmp tree for the test."""
    d = tmp_path / "portraits"
    monkeypatch.setattr(orwell_portraits, "PORTRAITS_DIR", d)
    return d


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(orwell_routes.setup_orwell_routes())
    return TestClient(app)


_PROMPTS = [
    {"houseguestId": "player", "name": "The Player", "prompt": "photoreal headshot, person A"},
    {"houseguestId": "npc:1", "name": "Houseguest One", "prompt": "photoreal headshot, person B"},
    {"houseguestId": "npc:2", "name": "Houseguest Two", "prompt": "photoreal headshot, person C"},
]


# --- generation triggered on createCharacter with prompts -------------------------------

def test_generate_and_store_writes_files_and_manifest(tmp_portraits, monkeypatch):
    monkeypatch.setattr(orwell_portraits, "image_generation_available", lambda user: True)

    async def fake_gen(prompt, user, reference_png=None):
        return b"PNGBYTES-" + prompt.encode()[:4]
    monkeypatch.setattr(orwell_portraits, "_generate_one", fake_gen)

    summary = _run(orwell_portraits.generate_and_store(_PROMPTS, "alice", record_beats=False))

    assert summary["generated"] == 3 and summary["total"] == 3
    for hid in ("player", "npc_1", "npc_2"):  # ids are sanitized for filenames
        assert (tmp_portraits / "alice" / f"{hid}.png").exists()
    manifest = orwell_portraits.load_manifest("alice")
    assert set(manifest.keys()) == {"player", "npc_1", "npc_2"}
    assert manifest["npc_1"]["name"] == "Houseguest One"


def test_create_character_tool_kicks_off_generation(tmp_portraits, monkeypatch):
    """The do_create_character tool path passes the engine's portraitPrompts to the pipeline."""
    tool_impl = importlib.import_module("src.tool_implementations")

    async def fake_create(*a, **k):
        return {"started": True, "portraitPrompts": _PROMPTS}
    monkeypatch.setattr(orwell_engine, "create_character", fake_create)

    captured = {}

    def fake_kickoff(prompts, user):
        captured["prompts"] = prompts
        captured["user"] = user
    monkeypatch.setattr(orwell_portraits, "kickoff_generation", fake_kickoff)

    res = _run(tool_impl.do_create_character('{"playerName":"P"}', owner="bob"))
    assert res["exit_code"] == 0
    assert captured["user"] == "bob"
    assert captured["prompts"] == _PROMPTS


def test_portraits_start_immediately_not_chained_behind_authoring(tmp_portraits, monkeypatch):
    """Bug B — cast portraits must start generating BY MOVE-IN, not after.

    With a cast present, createCharacter must (a) kick portrait generation off IMMEDIATELY from
    the seeded facets (in parallel with authoring), and (b) still run cast authoring with a
    `then` top-up callback. The picture must NOT be chained behind the (slow, 15-call) authoring
    pass — that is what made portraits land around/after house entry."""
    tool_impl = importlib.import_module("src.tool_implementations")
    cast_authoring = importlib.import_module("src.orwell_cast_authoring")

    async def fake_create(*a, **k):
        return {
            "started": True,
            "portraitPrompts": _PROMPTS,
            "house": [{"id": "npc:1"}, {"id": "npc:2"}],
            "player": {"name": "The Player"},
        }
    monkeypatch.setattr(orwell_engine, "create_character", fake_create)

    order = []  # record the call order so we can prove portraits don't wait on authoring

    def fake_kickoff_generation(prompts, user):
        order.append(("portraits", tuple(p["houseguestId"] for p in prompts)))
    monkeypatch.setattr(orwell_portraits, "kickoff_generation", fake_kickoff_generation)

    captured = {}

    # ANTI-SYCOPHANCY: kickoff_authoring no longer takes the player's name — NPC storylines are
    # authored player-independent, so the call carries only the cast + owner (+ the top-up callback).
    def fake_kickoff_authoring(cast, owner, then=None):
        order.append(("authoring", owner))
        captured["cast"] = cast
        captured["then"] = then  # the top-up callback must be wired (not None)
    monkeypatch.setattr(cast_authoring, "kickoff_authoring", fake_kickoff_authoring)

    res = _run(tool_impl.do_create_character('{"playerName":"P"}', owner="bob"))
    assert res["exit_code"] == 0
    # Portraits kicked off, and BEFORE authoring is even scheduled — never chained behind it.
    assert ("portraits", ("player", "npc:1", "npc:2")) in order
    assert order.index(("portraits", ("player", "npc:1", "npc:2"))) < \
        next(i for i, c in enumerate(order) if c[0] == "authoring")
    # Authoring still runs, with a top-up callback to fill any not-yet-landed face from the
    # authored facet (idempotent). It is keyed by the OWNER, never the player's identity.
    assert ("authoring", "bob") in order
    assert callable(captured.get("then"))
    # and the player's name is never threaded into authoring (storylines are player-independent)
    assert "player_name" not in str(captured.get("cast"))


# --- graceful absence: skip silently when generation is unavailable ---------------------

def test_skips_silently_when_generation_unavailable(tmp_portraits, monkeypatch):
    monkeypatch.setattr(orwell_portraits, "image_generation_available", lambda user: False)

    # If it ever tried to generate, this would error the test (it must NOT be called).
    async def boom(prompt, user, reference_png=None):
        raise AssertionError("generation must not run when unavailable")
    monkeypatch.setattr(orwell_portraits, "_generate_one", boom)

    summary = _run(orwell_portraits.generate_and_store(_PROMPTS, "carol"))
    assert summary["generated"] == 0
    assert summary["skipped"] == 3
    # No directory/manifest created — the game plays identically with no portraits.
    assert not (tmp_portraits / "carol").exists()


def test_image_settings_disabled_means_unavailable(tmp_portraits, monkeypatch):
    monkeypatch.setattr(orwell_portraits, "_image_settings", lambda user: (False, "some-model", "medium"))
    assert orwell_portraits.image_generation_available("dave") is False


# --- persistence: not regenerated when already present ----------------------------------

def test_not_regenerated_when_already_stored(tmp_portraits, monkeypatch):
    monkeypatch.setattr(orwell_portraits, "image_generation_available", lambda user: True)

    calls = {"n": 0}

    async def fake_gen(prompt, user, reference_png=None):
        calls["n"] += 1
        return b"PNG"
    monkeypatch.setattr(orwell_portraits, "_generate_one", fake_gen)

    _run(orwell_portraits.generate_and_store(_PROMPTS, "erin", record_beats=False))
    assert calls["n"] == 3
    # Second run (a "restart"): every portrait already on disk → no regeneration.
    summary = _run(orwell_portraits.generate_and_store(_PROMPTS, "erin", record_beats=False))
    assert calls["n"] == 3  # unchanged
    assert summary["generated"] == 0 and summary["skipped"] == 3


def test_portrait_ref_points_at_route_only_when_file_exists(tmp_portraits, monkeypatch):
    monkeypatch.setattr(orwell_portraits, "image_generation_available", lambda user: True)

    async def fake_gen(prompt, user, reference_png=None):
        return b"PNG"
    monkeypatch.setattr(orwell_portraits, "_generate_one", fake_gen)

    assert orwell_portraits.portrait_ref("fay", "npc:1") is None  # nothing yet
    _run(orwell_portraits.generate_and_store(_PROMPTS[:1] + [_PROMPTS[1]], "fay", record_beats=False))
    # The ref points at the route AND carries the per-cast cache-busting version (`?v=`).
    ref = orwell_portraits.portrait_ref("fay", "npc:1")
    epoch = orwell_portraits._load_cast_epoch("fay")
    assert epoch and ref == f"/api/orwell/portrait/npc_1?v={epoch}"
    # A scrubbed file → ref goes back to None (no broken <img>).
    (tmp_portraits / "fay" / "npc_1.png").unlink()
    assert orwell_portraits.portrait_ref("fay", "npc:1") is None


# --- cross-season: a NEW cast on REUSED role ids never inherits an old face ----------------
# Root cause #1 (portrait id reused every season) + #3 (generate-once skips the new cast). The
# engine hands out role ids (`npc:3`) that are byte-identical every season, so a reset whose
# portrait scrub was skipped/failed leaves last season's face on the new houseguest at that id.

def test_new_cast_on_reused_ids_wipes_and_regenerates_with_a_fresh_version(tmp_portraits, monkeypatch):
    monkeypatch.setattr(orwell_portraits, "image_generation_available", lambda user: True)

    async def fake_gen(prompt, user, reference_png=None):
        return b"PNG:" + prompt.encode()  # bytes track the prompt so we can spot a regen
    monkeypatch.setattr(orwell_portraits, "_generate_one", fake_gen)

    cast_a = [
        {"houseguestId": "npc:1", "name": "Houseguest One", "prompt": "A-one"},
        {"houseguestId": "npc:2", "name": "Houseguest Two", "prompt": "A-two"},
    ]
    _run(orwell_portraits.generate_and_store(cast_a, "u", record_beats=False))
    bytes_a = (tmp_portraits / "u" / "npc_1.png").read_bytes()
    epoch_a = orwell_portraits._load_cast_epoch("u")
    assert epoch_a and orwell_portraits.portrait_ref("u", "npc:1").endswith(f"?v={epoch_a}")

    # A NEW season's cast lands on the SAME role ids with DIFFERENT names, and the reset's
    # portrait scrub did NOT run (we deliberately do not call scrub_user — simulating the bug).
    cast_b = [
        {"houseguestId": "npc:1", "name": "Fresh Alpha", "prompt": "B-one"},
        {"houseguestId": "npc:2", "name": "Fresh Beta", "prompt": "B-two"},
    ]
    summary = _run(orwell_portraits.generate_and_store(cast_b, "u", record_beats=False))

    # The stale faces were wiped and regenerated for the new cast (root cause #1/#3 fixed)…
    assert summary["generated"] == 2
    bytes_b = (tmp_portraits / "u" / "npc_1.png").read_bytes()
    assert bytes_b == b"PNG:B-one" and bytes_b != bytes_a
    assert orwell_portraits.load_manifest("u")["npc_1"]["name"] == "Fresh Alpha"
    # …and the cache-busting version rotated, so a 24h-cached browser fetches the new face.
    epoch_b = orwell_portraits._load_cast_epoch("u")
    assert epoch_b and epoch_b != epoch_a
    assert orwell_portraits.portrait_ref("u", "npc:1").endswith(f"?v={epoch_b}")


def test_same_season_rerun_keeps_one_persisted_image_per_npc(tmp_portraits, monkeypatch):
    """Generate-once is preserved WITHIN a season: one image per NPC persists, the URL version is
    stable, and a re-run (backfill / restart) regenerates nothing — the requested behavior."""
    monkeypatch.setattr(orwell_portraits, "image_generation_available", lambda user: True)
    calls = []

    async def fake_gen(prompt, user, reference_png=None):
        calls.append(prompt)
        return b"PNG:" + prompt.encode() + b":" + str(len(calls)).encode()
    monkeypatch.setattr(orwell_portraits, "_generate_one", fake_gen)

    cast = [
        {"houseguestId": "npc:1", "name": "Houseguest One", "prompt": "one"},
        {"houseguestId": "npc:2", "name": "Houseguest Two", "prompt": "two"},
    ]
    _run(orwell_portraits.generate_and_store(cast, "u", record_beats=False))
    bytes_first = (tmp_portraits / "u" / "npc_1.png").read_bytes()
    epoch_first = orwell_portraits._load_cast_epoch("u")
    calls_after_first = len(calls)

    # Same cast (same names): generate-once must hold — nothing regenerated, version unchanged.
    summary = _run(orwell_portraits.generate_and_store(cast, "u", record_beats=False))
    assert summary["generated"] == 0 and summary["skipped"] == 2
    assert len(calls) == calls_after_first  # no fresh generation calls
    assert (tmp_portraits / "u" / "npc_1.png").read_bytes() == bytes_first  # same persisted image
    assert orwell_portraits._load_cast_epoch("u") == epoch_first  # stable URL version all season


# --- the cast roster route: name + status + portrait, Vault-free ------------------------

_HIDDEN_SENTINEL = "VAULT_SECRET_DO_NOT_LEAK"


def test_roster_returns_name_status_portrait(tmp_portraits, client, monkeypatch):
    async def fake_state(user=None, **k):
        return {
            "started": True,
            "player": {"id": "player", "name": "The Player", "status": "active"},
            "house": [
                {"id": "npc:1", "name": "Houseguest One", "status": "active"},
                {"id": "npc:2", "name": "Houseguest Two", "status": "jury"},
                {"id": "npc:3", "name": "Houseguest Three", "status": "evicted"},
            ],
        }
    monkeypatch.setattr(orwell_engine, "get_game_state", fake_state)
    monkeypatch.setattr(orwell_portraits, "image_generation_available", lambda user: True)
    # One houseguest has a stored portrait; the rest fall back to null (placeholder client-side).
    monkeypatch.setattr(orwell_portraits, "portrait_ref",
                        lambda user, hid: "/api/orwell/portrait/npc_1" if hid == "npc:1" else None)

    body = client.get("/api/orwell/roster").json()
    roster = body["roster"]
    assert body["imagesAvailable"] is True
    assert len(roster) == 4  # player + 3 house
    by_name = {c["name"]: c for c in roster}
    assert by_name["The Player"]["isPlayer"] is True
    assert by_name["Houseguest One"]["portrait"] == "/api/orwell/portrait/npc_1"
    assert by_name["Houseguest Two"]["status"] == "jury"
    assert by_name["Houseguest Three"]["status"] == "evicted"  # evicted stays on the roster
    assert by_name["Houseguest Two"]["portrait"] is None


def test_roster_is_vault_free(tmp_portraits, client, monkeypatch):
    # Even if the engine projection ever carried hidden content, the roster only forwards
    # name + status + portrait — never a stat / relationship / soul field.
    async def fake_state(user=None, **k):
        return {
            "started": True,
            "player": {"id": "player", "name": "The Player", "status": "active",
                       "secretTrust": _HIDDEN_SENTINEL, "threat": 99},
            "house": [
                {"id": "npc:1", "name": "Houseguest One", "status": "active",
                 "soul": _HIDDEN_SENTINEL, "affinity": 0.7, "hiddenPlan": _HIDDEN_SENTINEL},
            ],
        }
    monkeypatch.setattr(orwell_engine, "get_game_state", fake_state)
    monkeypatch.setattr(orwell_portraits, "image_generation_available", lambda user: False)

    r = client.get("/api/orwell/roster")
    text = r.text
    assert _HIDDEN_SENTINEL not in text
    for forbidden in ("secretTrust", "threat", "soul", "affinity", "hiddenPlan"):
        assert forbidden not in text
    cards = r.json()["roster"]
    # Only the whitelisted public keys are present per card.
    allowed = {"id", "name", "status", "isPlayer", "portrait"}
    for c in cards:
        assert set(c.keys()) <= allowed


def test_roster_empty_pre_game(tmp_portraits, client, monkeypatch):
    async def fake_state(user=None, **k):
        return {"started": False}
    monkeypatch.setattr(orwell_engine, "get_game_state", fake_state)
    body = client.get("/api/orwell/roster").json()
    assert body == {"roster": [], "imagesAvailable": False}


def test_roster_fails_open_on_engine_error(tmp_portraits, client, monkeypatch):
    # No prior good roster cached for this (anonymous) user → the route must fail open to empty.
    # (L15 adds a last-good cache; clearing it here pins the genuine "engine down, never had a
    #  cast" path — the stale-serving behavior is covered by its own test below.)
    orwell_routes._LAST_ROSTER.clear()

    async def boom(user=None, **k):
        raise RuntimeError("engine unreachable")
    monkeypatch.setattr(orwell_engine, "get_game_state", boom)
    r = client.get("/api/orwell/roster")
    assert r.status_code == 200
    assert r.json() == {"roster": [], "imagesAvailable": False}


# --- the portrait-serving route ---------------------------------------------------------

def test_portrait_route_serves_stored_png(tmp_portraits, client, monkeypatch):
    monkeypatch.setattr(orwell_portraits, "image_generation_available", lambda user: True)

    async def fake_gen(prompt, user, reference_png=None):
        return b"\x89PNG\r\n\x1a\n-fake"
    monkeypatch.setattr(orwell_portraits, "_generate_one", fake_gen)
    _run(orwell_portraits.generate_and_store([_PROMPTS[1]], "default", record_beats=False))

    r = client.get("/api/orwell/portrait/npc:1")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("image/png")
    assert r.content.startswith(b"\x89PNG")


def test_portrait_route_404_when_missing(tmp_portraits, client):
    r = client.get("/api/orwell/portrait/nobody")
    assert r.status_code == 404


# --- image-beat recording on first show -------------------------------------------------

def test_records_image_beat_for_each_shown_portrait(tmp_portraits, monkeypatch):
    monkeypatch.setattr(orwell_portraits, "image_generation_available", lambda user: True)

    async def fake_gen(prompt, user, reference_png=None):
        return b"PNG"
    monkeypatch.setattr(orwell_portraits, "_generate_one", fake_gen)

    beats = []

    async def fake_beat(houseguest_id, image_ref, user=None):
        beats.append((houseguest_id, image_ref, user))
        return {"ok": True}
    monkeypatch.setattr(orwell_engine, "record_image_beat", fake_beat)

    _run(orwell_portraits.generate_and_store(_PROMPTS, "gail", record_beats=True))
    assert len(beats) == 3
    ids = {b[0] for b in beats}
    assert ids == {"player", "npc:1", "npc:2"}
    for hid, ref, user in beats:
        assert user == "gail"
        assert ref.startswith("/api/orwell/portrait/")


# --- scrub (factory / game reset) -------------------------------------------------------

def test_scrub_user_and_scrub_all_remove_portraits(tmp_portraits, monkeypatch):
    monkeypatch.setattr(orwell_portraits, "image_generation_available", lambda user: True)

    async def fake_gen(prompt, user, reference_png=None):
        return b"PNG"
    monkeypatch.setattr(orwell_portraits, "_generate_one", fake_gen)

    _run(orwell_portraits.generate_and_store(_PROMPTS, "hank", record_beats=False))
    _run(orwell_portraits.generate_and_store(_PROMPTS, "iris", record_beats=False))
    assert (tmp_portraits / "hank").exists() and (tmp_portraits / "iris").exists()

    orwell_portraits.scrub_user("hank")
    assert not (tmp_portraits / "hank").exists()
    assert (tmp_portraits / "iris").exists()  # other users untouched

    orwell_portraits.scrub_all()
    assert not tmp_portraits.exists()


def test_factory_reset_script_scrubs_portraits_dir():
    """The reset scripts remove the cast portraits (feature 0051).

    The factory reset delegates to orwell-oobe-reset.sh, which wipes the WHOLE front-end store
    (portraits included) while keeping the LLM config — proven end-to-end in
    test_factory_reset_keeps_llm_config.py. The game reset preserves the FE store, so it must
    name the portraits dir explicitly.
    """
    root = Path(__file__).resolve().parents[2]
    factory = (root / "deploy" / "orwell-factory-reset.sh").read_text()
    oobe = (root / "deploy" / "orwell-oobe-reset.sh").read_text()
    game = (root / "deploy" / "orwell-game-reset.sh").read_text()
    # Factory reset hands off to the OOBE-reset implementation (which scrubs the FE store)…
    assert "orwell-oobe-reset.sh" in factory
    # …and that implementation wipes the front-end store wholesale (portraits live under it).
    assert "scrubbing front-end store" in oobe.lower() or "fe_data_dir" in oobe.lower()
    # Game reset preserves the FE store, so it MUST name the portraits dir explicitly.
    assert "portraits" in game.lower()
    assert "PORTRAITS_DIR" in game
