"""ADR 0013 — the LAZY portrait seams (backfill / reconciler) enforce authoring too (2026-07-13).

The prewarm/createCharacter seams already gate per-NPC (test_adr0013_photo_requires_authoring.py),
but the LAZY seams — the roster backfill, the manual lever, and the G20 reconciler — used to shoot
ANY missing face from whatever the store held. On a box where deep authoring landed LATE (or was
floored for hours), those seams shot the whole cast from the PRE-authoring seeded floor: exactly the
identity-mismatch ADR 0013 forbids. This file pins the closure:

  • `adr0013_allowed_ids` — the funnel filter in `backfill_missing`: while a real authoring model
    resolves (the #1313 gate fork), an ACTIVE NPC's face shoots only once its deep profile is
    AUTHORED (the engine's Vault-free per-card flag). Gate off / pre-game / read trouble ⇒ fail-open.
  • `kickoff_authored_reshoot` — the per-NPC "authoring just landed" (re)shoot: a face whose stored
    prompt FINGERPRINT predates the authored prompt is DISCARDED (never carried as an img2img
    identity reference) and re-shot from the authored prompt; a matching face is left alone.
  • the reconciler's staleness self-heal — an existing game whose faces predate authoring re-shoots
    them autonomously, capped at STALE_RESHOOT_PER_SWEEP per sweep (the IMAGE_BUDGET.perTurnCap
    mirror — never a provider flood), with a watermark so the per-face prompt fetch is not per-sweep.

Name-agnostic (roles/ids only); the engine client and the image provider are monkeypatched, same
conventions as test_g9_portrait_backfill.py / test_g20_portrait_reconciler.py.
"""

import asyncio
import importlib

import pytest

orwell_portraits = importlib.import_module("src.orwell_portraits")
orwell_engine = importlib.import_module("src.orwell_engine")
orwell_cast_authoring = importlib.import_module("src.orwell_cast_authoring")


def _run(coro):
    # FE convention: reuse the thread's loop (never asyncio.run, which closes it on the siblings).
    return asyncio.get_event_loop().run_until_complete(coro)


@pytest.fixture
def tmp_portraits(tmp_path, monkeypatch):
    """Throwaway portrait tree + fresh process-local trackers per test."""
    d = tmp_path / "portraits"
    monkeypatch.setattr(orwell_portraits, "PORTRAITS_DIR", d)
    monkeypatch.setattr(orwell_portraits, "PORTRAIT_LOG_PATH", tmp_path / "portrait-log.jsonl")
    monkeypatch.setattr(orwell_portraits, "RECONCILE_STATE_PATH", tmp_path / "portrait-reconcile.json")
    monkeypatch.setattr(orwell_portraits, "_LAST_BACKFILL_AT", {})
    monkeypatch.setattr(orwell_portraits, "_SEEN_USERS", {})
    monkeypatch.setattr(orwell_portraits, "_PROVIDER_SEEN", {})
    monkeypatch.setattr(orwell_portraits, "_LAST_MISSING", {})
    monkeypatch.setattr(orwell_portraits, "_STALE_AUTHORED_SEEN", {})
    monkeypatch.setattr(orwell_portraits, "_INFLIGHT", {})
    monkeypatch.setattr(orwell_portraits, "IMAGE_BEAT_SPACING_S", 0)
    return d


def _stub_gate(monkeypatch, on):
    async def _gate(owner):
        return on
    monkeypatch.setattr(orwell_cast_authoring, "house_entry_gate_active", _gate)


def _stub_state(monkeypatch, state):
    async def fake_state(user=None, **k):
        return state
    monkeypatch.setattr(orwell_engine, "get_game_state", fake_state)


def _stub_provider(monkeypatch, available=True):
    monkeypatch.setattr(orwell_portraits, "image_generation_available", lambda user: available)


def _stub_prompts(monkeypatch, suffix=""):
    """Engine prompt reads + beat writes; returns the list of fetched ids."""
    fetched = []

    async def fake_prompt(hid, user=None):
        fetched.append(str(hid))
        return {"houseguestId": hid, "name": f"HG {hid}", "prompt": f"photoreal {hid}{suffix}"}

    async def fake_beat(hid, ref, user=None):
        return {"ok": True}

    monkeypatch.setattr(orwell_engine, "get_portrait_prompt", fake_prompt)
    monkeypatch.setattr(orwell_engine, "record_image_beat", fake_beat)
    return fetched


def _stub_generate(monkeypatch):
    """A controllable _generate_one recording each generated prompt."""
    calls = []

    async def fake_gen(prompt, user, reference_png=None, keep_identity=True):
        calls.append(prompt)
        return b"\x89PNG-" + prompt.encode()[:12]

    monkeypatch.setattr(orwell_portraits, "_generate_one", fake_gen)
    return calls


def _mixed_state(started=True):
    """A live game: npc:1 authored, npc:2 still floor, npc:3 authored, player present."""
    return {
        "started": started,
        "player": {"id": "player", "name": "The Player", "status": "active"},
        "house": [
            {"id": "npc:1", "name": "One", "status": "active", "authored": True},
            {"id": "npc:2", "name": "Two", "status": "active"},
            {"id": "npc:3", "name": "Three", "status": "active", "authored": True},
        ],
    }


# ── adr0013_allowed_ids: the funnel filter ──────────────────────────────────────────────────

def test_gate_on_holds_unauthored_npcs(tmp_portraits, monkeypatch):
    _stub_gate(monkeypatch, True)
    _stub_state(monkeypatch, _mixed_state())
    allowed = _run(orwell_portraits.adr0013_allowed_ids(["npc:1", "npc:2", "npc:3", "player"], "u"))
    # Authored NPCs + the player pass; the still-floor npc:2 is held.
    assert allowed == ["npc:1", "npc:3", "player"]


def test_gate_off_passes_everything(tmp_portraits, monkeypatch):
    _stub_gate(monkeypatch, False)  # no authoring model ⇒ the floor IS the final cast
    _stub_state(monkeypatch, _mixed_state())
    allowed = _run(orwell_portraits.adr0013_allowed_ids(["npc:1", "npc:2", "player"], "u"))
    assert allowed == ["npc:1", "npc:2", "player"]


def test_pregame_passes_everything(tmp_portraits, monkeypatch):
    # Pre-game the only callers are the per-NPC authored-shoot paths (the warm gates own ADR 0013).
    _stub_gate(monkeypatch, True)
    _stub_state(monkeypatch, {"started": False})
    allowed = _run(orwell_portraits.adr0013_allowed_ids(["npc:1", "npc:2"], "u"))
    assert allowed == ["npc:1", "npc:2"]


def test_filter_fails_open_on_state_trouble(tmp_portraits, monkeypatch):
    _stub_gate(monkeypatch, True)

    async def boom(user=None, **k):
        raise RuntimeError("engine down")
    monkeypatch.setattr(orwell_engine, "get_game_state", boom)
    allowed = _run(orwell_portraits.adr0013_allowed_ids(["npc:1", "npc:2"], "u"))
    assert allowed == ["npc:1", "npc:2"]


def test_backfill_missing_routes_through_the_filter(tmp_portraits, monkeypatch):
    """The ONE funnel: backfill_missing itself holds un-authored NPCs while the gate is on."""
    _stub_gate(monkeypatch, True)
    _stub_state(monkeypatch, _mixed_state())
    _stub_provider(monkeypatch, True)
    _stub_prompts(monkeypatch)
    calls = _stub_generate(monkeypatch)

    res = _run(orwell_portraits.backfill_missing(["npc:1", "npc:2"], "u"))
    # Only the authored npc:1 generated; the still-floor npc:2 was held (no prompt even fetched
    # into the pipeline — it simply isn't in the run).
    assert res["generated"] == 1
    assert orwell_portraits.portrait_file("u", "npc:1") is not None
    assert orwell_portraits.portrait_file("u", "npc:2") is None
    assert all("npc:2" not in c for c in calls)


# ── kickoff_authored_reshoot: the per-NPC "authoring just landed" (re)shoot ─────────────────

def _kick_reshoot(hid, user):
    async def _inner():
        kicked = orwell_portraits.kickoff_authored_reshoot(hid, user)
        for _ in range(25):  # drain the fire-and-forget heal (all awaits are stubbed-immediate)
            await asyncio.sleep(0)
        return kicked
    return _run(_inner())


def test_reshoot_discards_a_stale_fingerprint_face_and_regenerates(tmp_portraits, monkeypatch):
    _stub_gate(monkeypatch, False)
    _stub_provider(monkeypatch, True)
    _stub_prompts(monkeypatch, suffix=" AUTHORED")  # the CURRENT prompt differs from the stored one
    calls = _stub_generate(monkeypatch)

    # A face shot from the OLD (pre-authoring) prompt.
    old_fp = orwell_portraits._prompt_fingerprint("photoreal npc:1")
    orwell_portraits._write_portrait("u", "npc:1", b"OLD-FACE", "HG npc:1", fingerprint=old_fp)

    assert _kick_reshoot("npc:1", "u") is True
    # Regenerated from the authored prompt — fresh first-shoot semantics: the stale face was
    # DISCARDED first, so it can never ride along as an img2img identity reference.
    assert calls and "AUTHORED" in calls[0]
    new = orwell_portraits.portrait_file("u", "npc:1")
    assert new is not None and new.read_bytes() != b"OLD-FACE"
    entry = orwell_portraits.load_manifest("u").get("npc_1")
    assert entry["fingerprint"] == orwell_portraits._prompt_fingerprint("photoreal npc:1 AUTHORED")


def test_reshoot_leaves_a_matching_face_alone(tmp_portraits, monkeypatch):
    _stub_gate(monkeypatch, False)
    _stub_provider(monkeypatch, True)
    _stub_prompts(monkeypatch)  # the current prompt EQUALS the stored one
    calls = _stub_generate(monkeypatch)

    fp = orwell_portraits._prompt_fingerprint("photoreal npc:1")
    orwell_portraits._write_portrait("u", "npc:1", b"GOOD-FACE", "HG npc:1", fingerprint=fp)

    _kick_reshoot("npc:1", "u")
    # Generate-once holds: nothing regenerated, the face bytes are untouched.
    assert calls == []
    assert orwell_portraits.portrait_file("u", "npc:1").read_bytes() == b"GOOD-FACE"


def test_reshoot_shoots_a_missing_face(tmp_portraits, monkeypatch):
    _stub_gate(monkeypatch, False)
    _stub_provider(monkeypatch, True)
    _stub_prompts(monkeypatch)
    calls = _stub_generate(monkeypatch)

    _kick_reshoot("npc:1", "u")
    assert len(calls) == 1
    assert orwell_portraits.portrait_file("u", "npc:1") is not None


def test_reshoot_never_touches_the_players_uploaded_photo(tmp_portraits, monkeypatch):
    _stub_gate(monkeypatch, False)
    _stub_provider(monkeypatch, True)
    _stub_prompts(monkeypatch, suffix=" AUTHORED")
    _stub_generate(monkeypatch)

    orwell_portraits._write_portrait("u", "player", b"MY-REAL-PHOTO", "Me", source="upload")
    _kick_reshoot("player", "u")
    # The literal uploaded photo is LOCKED — never discarded, never regenerated over.
    assert orwell_portraits.portrait_file("u", "player").read_bytes() == b"MY-REAL-PHOTO"


# ── the reconciler's staleness self-heal (existing games heal within the budget) ────────────

def _authored_state(n=5):
    # Names match the stubbed engine prompt entries ("HG npc:{i}") — as in production, where the
    # manifest name comes from the engine's roster/prompt — so the staleness heal's NAME-mismatch
    # class (wrong person, bundle-audit fix 2026-07-13) never fires on these same-cast fixtures.
    return {
        "started": True,
        "player": {"id": "player", "name": "The Player", "status": "active"},
        "house": [
            {"id": f"npc:{i}", "name": f"HG npc:{i}", "status": "active", "authored": True}
            for i in range(1, n + 1)
        ],
    }


def _seed_stale_faces(user, n=5):
    """Faces shot from the PRE-authoring prompts (fingerprints of the old prompt strings)."""
    for i in range(1, n + 1):
        fp = orwell_portraits._prompt_fingerprint(f"photoreal npc:{i}")
        # The name matches the stubbed engine prompt entry ("HG npc:{i}") so the cross-season
        # rotation guard never mistakes the same cast for a new one mid-test.
        orwell_portraits._write_portrait(user, f"npc:{i}", b"OLD-" + str(i).encode(),
                                         f"HG npc:{i}", fingerprint=fp)
    # The player's own (non-stale, non-authored) face so nothing is "missing".
    orwell_portraits._write_portrait(user, "player", b"ME", "Me", source="upload")


def test_reconciler_heals_stale_faces_capped_per_sweep(tmp_portraits, monkeypatch):
    _stub_gate(monkeypatch, False)
    _stub_state(monkeypatch, _authored_state(5))
    _stub_provider(monkeypatch, True)
    _stub_prompts(monkeypatch, suffix=" AUTHORED")  # every current prompt differs ⇒ all 5 stale
    _stub_generate(monkeypatch)
    _seed_stale_faces("u", 5)

    cap = orwell_portraits.STALE_RESHOOT_PER_SWEEP
    res1 = _run(orwell_portraits._reconcile_user("u"))
    assert res1["healed"] == cap, f"first sweep heals exactly the cap ({cap}), got {res1}"
    # A second sweep continues (the watermark is NOT stamped while stale faces remain) …
    res2 = _run(orwell_portraits._reconcile_user("u"))
    assert res2["healed"] == 5 - cap
    # … and once everything matches, the heal goes quiet.
    res3 = _run(orwell_portraits._reconcile_user("u"))
    assert res3["healed"] == 0
    # Every face now carries the AUTHORED prompt's fingerprint.
    for i in range(1, 6):
        entry = orwell_portraits.load_manifest("u").get(f"npc_{i}")
        assert entry["fingerprint"] == orwell_portraits._prompt_fingerprint(
            f"photoreal npc:{i} AUTHORED")


def test_reconciler_staleness_watermark_stops_per_sweep_prompt_fetches(tmp_portraits, monkeypatch):
    _stub_gate(monkeypatch, False)
    _stub_state(monkeypatch, _authored_state(3))
    _stub_provider(monkeypatch, True)
    fetched = _stub_prompts(monkeypatch)  # current == stored ⇒ everything verifies clean
    _stub_generate(monkeypatch)
    for i in range(1, 4):
        fp = orwell_portraits._prompt_fingerprint(f"photoreal npc:{i}")
        orwell_portraits._write_portrait("u", f"npc:{i}", b"OK", f"HG npc:{i}", fingerprint=fp)
    orwell_portraits._write_portrait("u", "player", b"ME", "Me", source="upload")

    _run(orwell_portraits._reconcile_user("u"))
    first = len(fetched)
    assert first >= 3  # the verification pass read each authored face's current prompt once
    _run(orwell_portraits._reconcile_user("u"))
    # Verified clean at this authoring watermark ⇒ NO further per-sweep prompt fetches.
    assert len(fetched) == first


def test_reconciler_holds_unauthored_missing_ids_and_burns_no_budget(tmp_portraits, monkeypatch):
    """Gate ON + a missing face for a still-floor NPC: the reconciler must neither shoot it nor
    charge its retry budget — the authored re-shoot owns it once authoring lands."""
    _stub_gate(monkeypatch, True)
    state = {
        "started": True,
        "player": {"id": "player", "name": "The Player", "status": "active"},
        "house": [{"id": "npc:1", "name": "One", "status": "active"}],  # un-authored, no face
    }
    _stub_state(monkeypatch, state)
    _stub_provider(monkeypatch, True)
    _stub_prompts(monkeypatch)
    calls = _stub_generate(monkeypatch)
    orwell_portraits._write_portrait("u", "player", b"ME", "Me", source="upload")

    res = _run(orwell_portraits._reconcile_user("u"))
    assert res is not None and res["missing"] == 0 and res.get("attempted", 0) == 0
    assert calls == []  # nothing generated
    # No budget entry was minted for the held houseguest.
    sidecar = orwell_portraits._load_reconcile_state()
    assert not sidecar.get("u", {})
