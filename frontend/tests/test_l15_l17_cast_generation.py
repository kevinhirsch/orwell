"""Ledger L15 + L17 — cast generation stays responsive and the cast is distinct.

L15 — "the final photo generated, then ALL photos vanished and the FE lost the backend":
  cast generation floods the engine's per-user serial queue, a roster poll's state read times
  out, and the route used to fail open to an EMPTY roster (every face gone) while /state 502'd
  (the cast button vanished). The fixes proven here:
    • generate_and_store reports LIVE progress (generation_progress: {total, done, active}) as
      each face lands, so the panel shows "Generating N of M…" instead of going dark;
    • the run's engine writes (record_image_beat) are SPACED, not fired back-to-back, so the
      per-user queue can answer the panel's polls between beats;
    • the /roster route serves the LAST-GOOD roster (flagged `stale`) on a transient state read
      failure instead of blanking the cast.

L17 — after the full cast generates, an automated look-alike / mistake pass detects near-duplicate
  faces (from the structured, Vault-free portrait-prompt facets) and REGENERATES the offenders
  with enforced variety, bounded by a retry cap.

Roles only (player / NPC / houseguest) — no names. Generation/engine fully monkeypatched; SYNC
tests drive coroutines with run_until_complete (pytest-asyncio AUTO mode — never asyncio.run()).
"""

import asyncio
import importlib

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
    monkeypatch.setattr(orwell_portraits, "PORTRAITS_DIR", tmp_path / "portraits")
    # Reset the process-local progress between tests (it is module-level).
    orwell_portraits._GEN_PROGRESS.clear()
    return tmp_path / "portraits"


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(orwell_routes.setup_orwell_routes())
    return TestClient(app)


# A small engine-shaped portrait prompt set: each "Physical appearance:" clause is DISTINCT, so the
# L17 pass leaves them alone unless we deliberately collide two.
def _prompt(hid, name, physical):
    return {
        "houseguestId": hid, "name": name,
        "prompt": ("photorealistic candid production still, Big Brother house interior. "
                   f"Subject: {name}, 30 years old. "
                   f"Physical appearance: {physical}. "
                   "Presentation style: casual. Expression: an easy open smile. "
                   "Framing: head-and-shoulders. Setting: kitchen counters blurred behind"),
    }


_DISTINCT = [
    _prompt("npc:1", "Houseguest One", "tall and lean, warm brown skin, tight black curls, square jaw"),
    _prompt("npc:2", "Houseguest Two", "short and stocky, pale freckled skin, red wavy hair, round face"),
    _prompt("npc:3", "Houseguest Three", "average height, olive skin, straight dark hair, sharp cheekbones"),
]


# ── L15: live generation progress ──────────────────────────────────────────────────────────────

def test_generation_progress_starts_ticks_and_finishes(tmp_portraits, monkeypatch):
    monkeypatch.setattr(orwell_portraits, "image_generation_available", lambda user: True)
    # Capture the progress AT each landed face so we prove it moves DURING the run, not just after.
    seen = []

    async def fake_gen(prompt, user, reference_png=None):
        seen.append(orwell_portraits.generation_progress(user))
        return b"PNG-" + prompt.encode()[:4]
    monkeypatch.setattr(orwell_portraits, "_generate_one", fake_gen)
    # No L17 regen, no beats — isolate the progress signal.
    async def no_dedupe(prompts, user, **k):
        return {"regenerated": 0, "regeneratedIds": [], "offenders": []}
    monkeypatch.setattr(orwell_portraits, "dedupe_lookalikes", no_dedupe)

    summary = _run(orwell_portraits.generate_and_store(_DISTINCT, "u", record_beats=False))
    assert summary["generated"] == 3

    # The run was marked active with the right total while generating…
    assert seen[0]["total"] == 3 and seen[0]["active"] is True
    # …and the done count climbed as faces landed.
    assert [p["done"] for p in seen] == [0, 1, 2]
    # After the run, progress reports inactive (the panel drops to the idle cadence).
    final = orwell_portraits.generation_progress("u")
    assert final["done"] == 3 and final["total"] == 3 and final["active"] is False


def test_generation_progress_none_when_no_run(tmp_portraits):
    assert orwell_portraits.generation_progress("never-ran") is None


def test_generation_progress_inactive_when_heartbeat_is_stale(tmp_portraits, monkeypatch):
    orwell_portraits._progress_start("u", 5)
    orwell_portraits._progress_tick("u")
    # Force the heartbeat far into the past → the run reads as inactive (crash / GC guard).
    orwell_portraits._GEN_PROGRESS["u"]["updatedAt"] = 0.0
    p = orwell_portraits.generation_progress("u")
    assert p["active"] is False and p["done"] == 1


# ── L15: the engine writes are SPACED, not a back-to-back flood ──────────────────────────────────

def test_image_beats_are_spaced_not_a_flood(tmp_portraits, monkeypatch):
    calls = []

    async def fake_beat(hid, ref, user=None):
        calls.append(hid)
    monkeypatch.setattr(orwell_engine, "record_image_beat", fake_beat)

    sleeps = []

    async def fake_sleep(s):
        sleeps.append(s)
    monkeypatch.setattr(orwell_portraits.asyncio, "sleep", fake_sleep)

    shown = [("npc:1", "/r/1"), ("npc:2", "/r/2"), ("npc:3", "/r/3")]
    _run(orwell_portraits._record_image_beats(shown, "u"))

    assert calls == ["npc:1", "npc:2", "npc:3"]
    # One inter-beat yield BETWEEN each pair (n-1), each the configured spacing — so a poll can
    # interleave and the run never starves the per-user queue.
    assert len(sleeps) == len(shown) - 1
    assert all(s == orwell_portraits.IMAGE_BEAT_SPACING_S for s in sleeps)


def test_image_beats_dedupe_a_repeated_id(tmp_portraits, monkeypatch):
    # The L17 pass appends an already-shown id for re-recording — a face is recorded once.
    calls = []

    async def fake_beat(hid, ref, user=None):
        calls.append(hid)
    monkeypatch.setattr(orwell_engine, "record_image_beat", fake_beat)
    monkeypatch.setattr(orwell_portraits, "IMAGE_BEAT_SPACING_S", 0)  # no real waiting in the test

    shown = [("npc:1", "/r/1"), ("npc:2", "/r/2"), ("npc:1", "/r/1b")]
    _run(orwell_portraits._record_image_beats(shown, "u"))
    assert calls == ["npc:1", "npc:2"]


# ── L15: the roster route serves the LAST-GOOD roster on a transient read failure ───────────────

def test_roster_serves_last_good_on_transient_failure(tmp_portraits, client, monkeypatch):
    orwell_routes._LAST_ROSTER.clear()
    monkeypatch.setattr(orwell_portraits, "image_generation_available", lambda user: True)
    monkeypatch.setattr(orwell_portraits, "portrait_ref", lambda user, hid: None)

    async def good_state(user=None, **k):
        return {"started": True,
                "player": {"id": "player", "name": "The Player", "status": "active"},
                "house": [{"id": "npc:1", "name": "Houseguest One", "status": "active"}]}
    monkeypatch.setattr(orwell_engine, "get_game_state", good_state)
    first = client.get("/api/orwell/roster").json()
    assert len(first["roster"]) == 2 and not first.get("stale")

    # Now the engine read times out (the per-user queue is busy committing portraits).
    async def boom(user=None, **k):
        raise RuntimeError("read timeout")
    monkeypatch.setattr(orwell_engine, "get_game_state", boom)
    second = client.get("/api/orwell/roster").json()
    # The cast does NOT vanish — the last-good roster is served, flagged stale.
    assert len(second["roster"]) == 2
    assert second["stale"] is True


def test_roster_clears_cache_and_empties_when_game_ends(tmp_portraits, client, monkeypatch):
    orwell_routes._LAST_ROSTER.clear()
    monkeypatch.setattr(orwell_portraits, "image_generation_available", lambda user: False)
    monkeypatch.setattr(orwell_portraits, "portrait_ref", lambda user, hid: None)

    async def good_state(user=None, **k):
        return {"started": True,
                "player": {"id": "player", "name": "The Player", "status": "active"},
                "house": [{"id": "npc:1", "name": "Houseguest One", "status": "active"}]}
    monkeypatch.setattr(orwell_engine, "get_game_state", good_state)
    assert len(client.get("/api/orwell/roster").json()["roster"]) == 2

    # The season ends / no active game → the panel must EMPTY (a real no-cast state), and a later
    # transient failure must NOT resurrect the stale cast.
    async def ended(user=None, **k):
        return {"started": False}
    monkeypatch.setattr(orwell_engine, "get_game_state", ended)
    assert client.get("/api/orwell/roster").json() == {"roster": [], "imagesAvailable": False}

    async def boom(user=None, **k):
        raise RuntimeError("down")
    monkeypatch.setattr(orwell_engine, "get_game_state", boom)
    assert client.get("/api/orwell/roster").json() == {"roster": [], "imagesAvailable": False}


def test_roster_surfaces_generation_progress(tmp_portraits, client, monkeypatch):
    orwell_routes._LAST_ROSTER.clear()
    orwell_portraits._GEN_PROGRESS.clear()
    monkeypatch.setattr(orwell_portraits, "image_generation_available", lambda user: True)
    monkeypatch.setattr(orwell_portraits, "portrait_ref", lambda user, hid: None)
    monkeypatch.setattr(orwell_portraits, "kickoff_backfill", lambda *a, **k: False)

    async def good_state(user=None, **k):
        return {"started": True,
                "player": {"id": "player", "name": "The Player", "status": "active"},
                "house": [{"id": "npc:1", "name": "Houseguest One", "status": "active"}]}
    monkeypatch.setattr(orwell_engine, "get_game_state", good_state)

    # A run is in flight for the anonymous test user (key "").
    orwell_portraits._progress_start(None, 16)
    orwell_portraits._progress_tick(None)
    orwell_portraits._progress_tick(None)
    body = client.get("/api/orwell/roster").json()
    assert body["generation"]["total"] == 16
    assert body["generation"]["done"] == 2
    assert body["generation"]["active"] is True


# ── L17: look-alike detection + regeneration ─────────────────────────────────────────────────────

def test_find_lookalikes_flags_the_later_of_a_clashing_pair():
    # npc:2 reuses npc:1's exact physical clause → a look-alike; npc:3 is its own person.
    prompts = [
        _prompt("npc:1", "Houseguest One", "tall and broad, deep brown skin, shaved head, broad nose"),
        _prompt("npc:2", "Houseguest Two", "tall and broad, deep brown skin, shaved head, broad nose"),
        _prompt("npc:3", "Houseguest Three", "petite, fair skin, long blonde hair, delicate features"),
    ]
    offenders = orwell_portraits.find_lookalikes(prompts)
    assert offenders == ["npc:2"]  # the EARLIER keeps its face; the later yields


def test_find_lookalikes_clears_a_distinct_cast():
    assert orwell_portraits.find_lookalikes(_DISTINCT) == []


def test_find_lookalikes_never_flags_the_player():
    # The player's face is locked/chosen — even an identical clause must not make them an offender.
    prompts = [
        _prompt("player", "The Player", "tall and broad, deep brown skin, shaved head, broad nose"),
        _prompt("npc:1", "Houseguest One", "tall and broad, deep brown skin, shaved head, broad nose"),
    ]
    offenders = orwell_portraits.find_lookalikes(prompts)
    assert "player" not in offenders


def test_dedupe_regenerates_offenders_with_variety_and_caps(tmp_portraits, monkeypatch):
    monkeypatch.setattr(orwell_portraits, "image_generation_available", lambda user: True)
    seen_prompts = []

    async def fake_gen(prompt, user, reference_png=None):
        seen_prompts.append(prompt)
        return b"REGEN-PNG"
    monkeypatch.setattr(orwell_portraits, "_generate_one", fake_gen)

    prompts = [
        _prompt("npc:1", "Houseguest One", "tall and broad, deep brown skin, shaved head, broad nose"),
        _prompt("npc:2", "Houseguest Two", "tall and broad, deep brown skin, shaved head, broad nose"),
    ]
    res = _run(orwell_portraits.dedupe_lookalikes(prompts, "u"))
    assert res["regenerated"] == 1 and res["regeneratedIds"] == ["npc:2"]
    # The regen prompt carries the variety directive up front (a clearly different face).
    assert seen_prompts and seen_prompts[0].startswith(orwell_portraits._VARIETY_DIRECTIVE)
    # The new face is persisted.
    assert orwell_portraits.portrait_file("u", "npc:2") is not None


def test_dedupe_respects_the_retry_cap(tmp_portraits, monkeypatch):
    monkeypatch.setattr(orwell_portraits, "image_generation_available", lambda user: True)
    n = []

    async def fake_gen(prompt, user, reference_png=None):
        n.append(1)
        return b"PNG"
    monkeypatch.setattr(orwell_portraits, "_generate_one", fake_gen)

    # Build 10 identical houseguests → 9 offenders; cap regenerations at 2.
    same = "average height, tan skin, brown buzzcut, plain features"
    prompts = [_prompt(f"npc:{i}", f"Houseguest {i}", same) for i in range(1, 11)]
    res = _run(orwell_portraits.dedupe_lookalikes(prompts, "u", max_regens=2))
    assert res["regenerated"] == 2
    assert len(n) == 2  # the cap bounded the re-rolls (a flaky model never loops the cast)


def test_dedupe_noop_without_a_provider(tmp_portraits, monkeypatch):
    monkeypatch.setattr(orwell_portraits, "image_generation_available", lambda user: False)

    async def boom(*a, **k):
        raise AssertionError("must not generate with no provider")
    monkeypatch.setattr(orwell_portraits, "_generate_one", boom)
    prompts = [
        _prompt("npc:1", "Houseguest One", "same look same look same look same look"),
        _prompt("npc:2", "Houseguest Two", "same look same look same look same look"),
    ]
    res = _run(orwell_portraits.dedupe_lookalikes(prompts, "u"))
    assert res["regenerated"] == 0


def test_generate_and_store_runs_the_distinctness_pass(tmp_portraits, monkeypatch):
    monkeypatch.setattr(orwell_portraits, "image_generation_available", lambda user: True)

    async def fake_gen(prompt, user, reference_png=None):
        return b"PNG-" + prompt.encode()[:6]
    monkeypatch.setattr(orwell_portraits, "_generate_one", fake_gen)

    captured = {}

    async def fake_dedupe(prompts, user, **k):
        captured["called"] = True
        return {"regenerated": 1, "regeneratedIds": ["npc:2"], "offenders": ["npc:2"]}
    monkeypatch.setattr(orwell_portraits, "dedupe_lookalikes", fake_dedupe)

    _run(orwell_portraits.generate_and_store(_DISTINCT, "u", record_beats=False))
    assert captured.get("called") is True  # the L17 pass runs after the cast lands


# ── Vault-free by construction ──────────────────────────────────────────────────────────────────

def test_physical_signature_is_built_only_from_public_prompt_text():
    # The signature is tokens of the PUBLIC physical/presentation clauses — never a stat key or
    # a bare number; it cannot carry hidden state because the prompt itself is Vault-free (engine).
    sig = orwell_portraits._physical_signature(
        _prompt("npc:1", "X", "tall, brown skin, curly hair, square jaw")["prompt"])
    assert "tall" in sig and "curly" in sig
    # Stop-worded structural words never enter the signature.
    assert "physical" not in sig and "appearance" not in sig and "subject" not in sig
