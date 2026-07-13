"""Bundle-audit portrait fixes (2026-07-13) — the prod debug-bundle findings, pinned.

Fix 1 — the player `no-prompt` retry loop: the bundle showed 11× `{houseguestId: 'player',
ok: false, errorClass: 'no-prompt'}` over ~1.7h and `completeness {total: 16, present: 15,
missing: 1}` with the missing 1 being the player, forever. The player's face comes from the
upload/casting-studio path (0050/G26/G27) — the engine emits NO portrait prompt for them by
design (#529) — so:
  • the player is EXEMPT from every prompt-shoot seam (missing set / backfill / reconciler);
  • the completeness counters cover the shootable NPCs, with the player tracked separately
    as `playerAwaitingUpload`;
  • a genuine NPC `no-prompt` is logged ONCE, then quiesced until the state changes;
  • the reconciler still applies an already-CHOSEN player headshot (avatar/upload) when the
    portrait file is missing — zero provider calls, zero log spam.

Fix 2 — staleness-heal priority: the bundle had a DEAD pre-reset cast's face (manifest name
differing from the current cast) queued BEHIND fingerprint re-shoots, and npc:8–14 re-shot
pre-#1559 using the old WRONG face as an img2img reference (wrong-identity DNA). The heal
queue is now priority-ordered — name-mismatch (wrong person) first, then unstamped reference
carries (wrong DNA), then fingerprint drift (wrong wardrobe) — and identity-carry writes stamp
`refClean` provenance so a clean carry is never re-shot.

Name-agnostic (roles/ids only); engine client + image provider monkeypatched — same
conventions as test_g9_portrait_backfill.py / test_adr0013_backfill_gate.py.
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
    monkeypatch.setattr(orwell_portraits, "AVATARS_DIR", tmp_path / "avatars")
    monkeypatch.setattr(orwell_portraits, "PORTRAIT_LOG_PATH", tmp_path / "portrait-log.jsonl")
    monkeypatch.setattr(orwell_portraits, "RECONCILE_STATE_PATH", tmp_path / "portrait-reconcile.json")
    monkeypatch.setattr(orwell_portraits, "_LAST_BACKFILL_AT", {})
    monkeypatch.setattr(orwell_portraits, "_SEEN_USERS", {})
    monkeypatch.setattr(orwell_portraits, "_PROVIDER_SEEN", {})
    monkeypatch.setattr(orwell_portraits, "_LAST_MISSING", {})
    monkeypatch.setattr(orwell_portraits, "_STALE_AUTHORED_SEEN", {})
    monkeypatch.setattr(orwell_portraits, "_NO_PROMPT_LOGGED", {})
    monkeypatch.setattr(orwell_portraits, "_INFLIGHT", {})
    monkeypatch.setattr(orwell_portraits, "IMAGE_BEAT_SPACING_S", 0)
    return d


def _stub_gate(monkeypatch, on=False):
    async def _gate(owner):
        return on
    monkeypatch.setattr(orwell_cast_authoring, "house_entry_gate_active", _gate)


def _stub_state(monkeypatch, state):
    async def fake_state(user=None, **k):
        return state
    monkeypatch.setattr(orwell_engine, "get_game_state", fake_state)


def _stub_provider(monkeypatch, available=True):
    monkeypatch.setattr(orwell_portraits, "image_generation_available", lambda user: available)


def _stub_prompts(monkeypatch, missing=(), suffix=""):
    """Engine prompt reads (None for ids in `missing` — the engine's real no-prompt shape) +
    beat writes; returns the fetched-id list."""
    fetched = []

    async def fake_prompt(hid, user=None):
        fetched.append(str(hid))
        if str(hid) in set(missing):
            return None
        return {"houseguestId": hid, "name": f"HG {hid}", "prompt": f"photoreal {hid}{suffix}"}

    async def fake_beat(hid, ref, user=None):
        return {"ok": True}

    monkeypatch.setattr(orwell_engine, "get_portrait_prompt", fake_prompt)
    monkeypatch.setattr(orwell_engine, "record_image_beat", fake_beat)
    return fetched


def _stub_generate(monkeypatch):
    calls = []

    async def fake_gen(prompt, user, reference_png=None, keep_identity=True):
        calls.append(prompt)
        return b"\x89PNG-" + prompt.encode()[:12]

    monkeypatch.setattr(orwell_portraits, "_generate_one", fake_gen)
    return calls


def _no_prompt_rows(hid=None):
    rows = [e for e in orwell_portraits.read_attempt_log()
            if not e["ok"] and e["errorClass"] == "no-prompt"]
    return [e for e in rows if hid is None or e["houseguestId"] == hid]


# ── Fix 1: the player is exempt from the prompt-shoot loop ──────────────────────────────────

def test_backfill_never_fetches_or_logs_no_prompt_for_the_player(tmp_portraits, monkeypatch):
    _stub_gate(monkeypatch, False)
    _stub_provider(monkeypatch, True)
    fetched = _stub_prompts(monkeypatch)
    _stub_generate(monkeypatch)

    _run(orwell_portraits.backfill_missing(["player"], "u"))
    _run(orwell_portraits.backfill_missing(["player"], "u"))

    assert fetched == []                       # never prompt-fetched
    assert _no_prompt_rows("player") == []     # the bundle's 11× spam class is gone
    assert orwell_portraits.portrait_file("u", "player") is None  # nothing invented either


def test_backfill_applies_the_players_chosen_headshot_without_a_prompt(tmp_portraits, monkeypatch):
    """An explicit player backfill (the manual lever / authored re-shoot seam) still lands the
    CHOSEN headshot — through generate_and_store's pre-pass, with zero prompt fetches."""
    _stub_gate(monkeypatch, False)
    _stub_provider(monkeypatch, True)
    fetched = _stub_prompts(monkeypatch)
    _stub_generate(monkeypatch)
    orwell_portraits.set_user_avatar("u", b"\x89PNG-my-face")

    summary = _run(orwell_portraits.backfill_missing(["player"], "u"))

    assert fetched == []
    assert summary["generated"] == 1
    assert orwell_portraits.portrait_file("u", "player").read_bytes() == b"\x89PNG-my-face"
    assert orwell_portraits.load_manifest("u")["player"]["source"] == "upload"


def test_reconciler_applies_the_avatar_when_the_player_portrait_is_missing(tmp_portraits, monkeypatch):
    _stub_gate(monkeypatch, False)
    _stub_state(monkeypatch, {
        "started": True,
        "player": {"id": "player", "name": "The Player", "status": "active"},
        "house": [{"id": "npc:1", "name": "HG npc:1", "status": "active"}],
    })
    _stub_provider(monkeypatch, True)
    _stub_prompts(monkeypatch)
    _stub_generate(monkeypatch)
    orwell_portraits.set_user_avatar("u", b"\x89PNG-returning-player")

    _run(orwell_portraits._reconcile_user("u"))

    assert orwell_portraits.portrait_file("u", "player").read_bytes() == b"\x89PNG-returning-player"
    # And the player never entered the retry budget (no counter minted).
    counters = orwell_portraits._user_counters(
        orwell_portraits._load_reconcile_state(), orwell_portraits._safe_user("u"))
    assert "player" not in counters


def test_reconciler_without_an_upload_leaves_the_player_awaiting_quietly(tmp_portraits, monkeypatch, caplog):
    import logging

    _stub_gate(monkeypatch, False)
    state = {
        "started": True,
        "player": {"id": "player", "name": "The Player", "status": "active"},
        "house": [{"id": "npc:1", "name": "HG npc:1", "status": "active"}],
    }
    _stub_state(monkeypatch, state)
    _stub_provider(monkeypatch, True)
    _stub_prompts(monkeypatch)
    _stub_generate(monkeypatch)

    _run(orwell_portraits._reconcile_user("u"))  # shoots npc:1; the player is exempt
    _run(orwell_portraits._reconcile_user("u"))  # the one-time "set complete" transition line
    caplog.set_level(logging.INFO, logger="src.orwell_portraits")
    caplog.clear()  # drop the (legitimate) transition lines — only the QUIET sweeps are judged
    for _ in range(5):
        _run(orwell_portraits._reconcile_user("u"))

    assert orwell_portraits.portrait_file("u", "player") is None
    assert _no_prompt_rows("player") == []
    # Scope to THIS module's logger — under xdist an unrelated logger in the worker can emit.
    module_records = [r for r in caplog.records if r.name == "src.orwell_portraits"]
    assert not module_records, "an awaiting-upload player must not spam the log per sweep"
    # The awaiting state is VISIBLE, not silent: the completeness payload carries the flag.
    from routes.orwell_routes import _roster_cards
    cards = _roster_cards(state, "u")
    assert orwell_portraits.completeness("u", cards)["playerAwaitingUpload"] is True


# ── Fix 1: a genuine NPC no-prompt logs ONCE, then quiesces until the state changes ─────────

def test_npc_no_prompt_is_logged_once_then_quiesced(tmp_portraits, monkeypatch):
    _stub_gate(monkeypatch, False)
    _stub_provider(monkeypatch, True)
    _stub_prompts(monkeypatch, missing=("npc:9",))
    _stub_generate(monkeypatch)

    for _ in range(4):
        _run(orwell_portraits.backfill_missing(["npc:9"], "u"))

    assert len(_no_prompt_rows("npc:9")) == 1  # once, not once-per-sweep


def test_npc_no_prompt_rearms_when_a_prompt_appears_then_disappears(tmp_portraits, monkeypatch):
    _stub_gate(monkeypatch, False)
    _stub_provider(monkeypatch, True)
    _stub_generate(monkeypatch)

    _stub_prompts(monkeypatch, missing=("npc:9",))
    _run(orwell_portraits.backfill_missing(["npc:9"], "u"))
    assert len(_no_prompt_rows("npc:9")) == 1

    # State changes: the engine now serves a prompt (the face generates) …
    _stub_prompts(monkeypatch)
    _run(orwell_portraits.backfill_missing(["npc:9"], "u"))
    assert orwell_portraits.portrait_file("u", "npc:9") is not None

    # … then the slot is discarded and the prompt vanishes again — a NEW state, logged anew.
    orwell_portraits.discard_portraits("u", ["npc:9"])
    _stub_prompts(monkeypatch, missing=("npc:9",))
    _run(orwell_portraits.backfill_missing(["npc:9"], "u"))
    assert len(_no_prompt_rows("npc:9")) == 2


# ── Fix 2: heal priority — wrong person first, then wrong DNA, then wrong wardrobe ──────────

def _authored_state(n):
    return {
        "started": True,
        "player": {"id": "player", "name": "The Player", "status": "active"},
        "house": [
            {"id": f"npc:{i}", "name": f"HG npc:{i}", "status": "active", "authored": True}
            for i in range(1, n + 1)
        ],
    }


def test_heal_reshoots_a_name_mismatched_face_before_fingerprint_stales(tmp_portraits, monkeypatch):
    """The bundle case: a dead pre-reset cast's face (npc:4 named for the OLD cast) must heal in
    the FIRST sweep, ahead of the fingerprint-stale majority (wrong person > wrong wardrobe)."""
    _stub_gate(monkeypatch, False)
    _stub_state(monkeypatch, _authored_state(4))
    _stub_provider(monkeypatch, True)
    _stub_prompts(monkeypatch, suffix=" AUTHORED")  # every stored fingerprint reads stale
    _stub_generate(monkeypatch)

    # npc:1..3 — right person, stale fingerprint (shot from the pre-authoring prompt).
    for i in (1, 2, 3):
        fp = orwell_portraits._prompt_fingerprint(f"photoreal npc:{i}")
        orwell_portraits._write_portrait("u", f"npc:{i}", b"OLD-" + str(i).encode(),
                                         f"HG npc:{i}", fingerprint=fp)
    # npc:4 — the DEAD cast's face: the manifest name differs from the current cast's.
    fp4 = orwell_portraits._prompt_fingerprint("photoreal npc:4 AUTHORED")  # even fp-clean!
    orwell_portraits._write_portrait("u", "npc:4", b"DEAD-CAST-FACE",
                                     "Somebody Else", fingerprint=fp4)

    cap = orwell_portraits.STALE_RESHOOT_PER_SWEEP
    from routes.orwell_routes import _roster_cards
    cards = _roster_cards(_authored_state(4), "u")
    healed = _run(orwell_portraits._heal_stale_authored_faces("u", cards))

    assert healed == cap
    # The wrong-person face healed FIRST — even though its fingerprint matched the current
    # prompt — and now carries the current cast's name + a fresh face.
    entry = orwell_portraits.load_manifest("u").get("npc_4")
    assert entry["name"] == "HG npc:4"
    assert orwell_portraits.portrait_file("u", "npc:4").read_bytes() != b"DEAD-CAST-FACE"
    # With the cap at 3 and 4 stale faces, exactly one fingerprint-stale face waits a sweep.
    remaining_old = [i for i in (1, 2, 3)
                     if orwell_portraits.portrait_file("u", f"npc:{i}").read_bytes() == b"OLD-" + str(i).encode()]
    assert len(remaining_old) == 1


def test_heal_reshoots_an_unstamped_reference_carry_once(tmp_portraits, monkeypatch):
    """The bundle's npc:8–14 class: an authored subject's face with source 'reference' and NO
    refClean provenance may carry pre-authoring wrong-face DNA — re-shot once (discard-first,
    fresh text-to-image), then quiet. A carry stamped refClean is left alone."""
    _stub_gate(monkeypatch, False)
    _stub_state(monkeypatch, _authored_state(2))
    _stub_provider(monkeypatch, True)
    _stub_prompts(monkeypatch)
    _stub_generate(monkeypatch)

    fp1 = orwell_portraits._prompt_fingerprint("photoreal npc:1")
    fp2 = orwell_portraits._prompt_fingerprint("photoreal npc:2")
    # npc:1 — a PRE-FIX legacy reference carry (fingerprint even matches the current prompt —
    # exactly how the wrong-DNA faces slipped past the fingerprint heal in the bundle).
    orwell_portraits._write_portrait("u", "npc:1", b"WRONG-DNA", "HG npc:1",
                                     source="reference", fingerprint=fp1)
    # npc:2 — a POST-FIX clean identity carry (provenance stamped).
    orwell_portraits._write_portrait("u", "npc:2", b"CLEAN-CARRY", "HG npc:2",
                                     source="reference", fingerprint=fp2, ref_clean=True)

    from routes.orwell_routes import _roster_cards
    cards = _roster_cards(_authored_state(2), "u")
    healed = _run(orwell_portraits._heal_stale_authored_faces("u", cards))

    assert healed == 1
    assert orwell_portraits.portrait_file("u", "npc:1").read_bytes() != b"WRONG-DNA"
    assert orwell_portraits.load_manifest("u")["npc_1"]["source"] == "generated"  # fresh shoot
    assert orwell_portraits.portrait_file("u", "npc:2").read_bytes() == b"CLEAN-CARRY"

    # Quiesced: the healed face is a fresh 'generated' shoot — a second sweep re-shoots nothing.
    assert _run(orwell_portraits._heal_stale_authored_faces("u", cards)) == 0


def test_fingerprint_reshoot_stamps_ref_clean_provenance(tmp_portraits, monkeypatch):
    """A facet-drift re-shoot over a fresh ('generated') base is a CLEAN identity carry — the new
    entry records source 'reference' + refClean, so the heal never mistakes it for wrong DNA."""
    _stub_provider(monkeypatch, True)
    _stub_generate(monkeypatch)

    async def fake_beat(hid, ref, user=None):
        return {"ok": True}
    monkeypatch.setattr(orwell_engine, "record_image_beat", fake_beat)

    first = [{"houseguestId": "npc:1", "name": "HG npc:1", "prompt": "facet-A"}]
    _run(orwell_portraits.generate_and_store(first, "u"))
    assert orwell_portraits.load_manifest("u")["npc_1"]["source"] == "generated"

    drifted = [{"houseguestId": "npc:1", "name": "HG npc:1", "prompt": "facet-B"}]
    _run(orwell_portraits.generate_and_store(drifted, "u"))
    entry = orwell_portraits.load_manifest("u")["npc_1"]
    assert entry["source"] == "reference"      # the identity carry (#1153) still happens
    assert entry["refClean"] is True           # …with its provenance stamped
    assert entry["fingerprint"] == orwell_portraits._prompt_fingerprint("facet-B")
