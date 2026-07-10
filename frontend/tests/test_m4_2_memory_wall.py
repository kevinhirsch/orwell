"""M4-2 — the Memory Wall (knowledge journal). The flagship "what you know" surface.

The Vault Wall is the whole point of this feature: the player's OWN knowledge gets a surface, but
NOTHING hidden may ride along. The engine's `getVisibleStateFor().knowledge` projection spreads the
WHOLE KnowledgeFact — including the raw belief NUMBERS (`confidence`/`distortion`/`hops`) and, most
dangerously, `originalContent` (the UNDISTORTED origin of a distorted belief — the truth the player's
belief drifts FROM, which they do NOT hold). This gate proves the route's shaping strips every one of
those SERVER-SIDE, so no number and no origin-truth ever reaches the browser, and that a distorted
rumor surfaces AS the player's belief (its source named), never truth-flagged.

Plus: the 0007 non-degradation promise made VISIBLE — journal content survives reload/restart and only
ACCUMULATES (a reload snapshot is a superset). And the source pins for the JS window, the sidebar-beside-
Cast entry, and the rail twin.

Roles only in the fixtures — houseguest display names are role words (HOH / Nominee / NPC), never a
real name (CLAUDE.md testing rule).
"""

import importlib
import pathlib
import re

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

orwell_engine = importlib.import_module("src.orwell_engine")
orwell_routes = importlib.import_module("routes.orwell_routes")

FE = pathlib.Path(__file__).resolve().parents[1]
JS = FE / "static" / "js" / "orwellMemoryWall.js"
LAYOUT = FE / "static" / "js" / "sidebar-layout.js"
INDEX = FE / "static" / "index.html"


# ── fixtures: a synthetic getVisibleStateFor + roster, with SENTINEL hidden fields ──────────────── #

# The public roster (getGameState) — id → PUBLIC name (role words only). The player + two houseguests.
_STATE = {
    "started": True,
    "player": {"id": "player", "name": "You"},
    "house": [
        {"id": "npc:1", "name": "HOH"},
        {"id": "npc:2", "name": "Nominee"},
    ],
}

# The sentinel truth the player must NEVER see: the undistorted origin of the distorted belief below,
# plus a made-up Vault-shaped extra field. If EITHER crosses to the payload, the wall leaked.
_ORIGIN_TRUTH = "the real plan is a final-two with the veto holder"
_VAULT_SENTINEL = "TOP-SECRET-VAULT-ONLY"

# What getVisibleStateFor(PLAYER).knowledge returns — the full KnowledgeFact shape (spread verbatim by
# the engine), numbers and origin-truth included, exactly what the route must strip.
_KNOWLEDGE = [
    {
        "id": "k1", "ts": 3, "pathway": "witnessed", "subject": "npc:1",
        "content": "the HOH won the endurance comp",
        # firsthand facts still carry a confidence number in the raw projection — must be dropped.
        "confidence": 1.0,
    },
    {
        "id": "k2", "ts": 5, "pathway": "told-by:npc:2", "subject": "npc:1",
        "content": "the HOH is gunning for you next week",
        # a DISTORTED secondhand belief: the numbers + the undistorted origin must all be dropped.
        "confidence": 0.42, "distortion": 0.6, "hops": 2,
        "originalContent": _ORIGIN_TRUTH,
        "factId": "lineage-9",
    },
    {
        "id": "k3", "ts": 7, "pathway": "overheard", "subject": "npc:2",
        "content": "the Nominee is scrambling for votes",
        "confidence": 0.55,
        # a made-up Vault-shaped field the shaping must not echo through.
        "vaultSecret": _VAULT_SENTINEL,
    },
    {
        "id": "k4", "ts": 9, "pathway": "diary-room", "subject": None,
        "content": "your own read: trust no one in the kitchen alliance",
    },
    {
        "id": "k5", "ts": 11, "pathway": "gossip:offscreen:alliance:1:99", "subject": "npc:99",
        "content": "word is a secret pair is running the house",
        "confidence": 0.3, "distortion": 0.8,
    },
]


def _stub_engine(monkeypatch, *, knowledge=None, state=None, no_game=False):
    async def fake_visible(user=None, **_kw):
        if no_game:
            raise orwell_engine.EngineToolError("no active game for this user")
        return {"forEntity": "player", "visibleEvents": [], "knowledge": knowledge if knowledge is not None else _KNOWLEDGE}

    async def fake_state(user=None, **_kw):
        return state if state is not None else _STATE

    monkeypatch.setattr(orwell_engine, "get_visible_state", fake_visible)
    monkeypatch.setattr(orwell_engine, "get_game_state", fake_state)


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(orwell_routes.setup_orwell_routes())
    return TestClient(app)


def _all_strings(obj):
    """Every string value anywhere in a nested payload (for the leak sweep)."""
    out = []
    if isinstance(obj, str):
        out.append(obj)
    elif isinstance(obj, dict):
        for v in obj.values():
            out.extend(_all_strings(v))
    elif isinstance(obj, list):
        for v in obj:
            out.extend(_all_strings(v))
    return out


def _all_keys(obj):
    out = set()
    if isinstance(obj, dict):
        for k, v in obj.items():
            out.add(k)
            out |= _all_keys(v)
    elif isinstance(obj, list):
        for v in obj:
            out |= _all_keys(v)
    return out


# ── 1. the leak sweep — no hidden field, number, or origin-truth crosses ─────────────────────────── #

def test_route_drops_every_hidden_field(client, monkeypatch):
    _stub_engine(monkeypatch)
    r = client.get("/api/orwell/knowledge")
    assert r.status_code == 200
    body = r.json()
    keys = _all_keys(body)
    # None of the raw belief NUMBERS or plumbing keys survive into the payload.
    for forbidden in ("confidence", "distortion", "hops", "originalContent", "factId", "vaultSecret", "ts", "sourceEventId"):
        assert forbidden not in keys, f"the Memory Wall payload leaked a hidden field: {forbidden}"


def test_route_never_carries_the_distorted_origin_truth(client, monkeypatch):
    _stub_engine(monkeypatch)
    body = client.get("/api/orwell/knowledge").json()
    blob = "\n".join(_all_strings(body))
    # The undistorted origin of the player's distorted belief is the truth they do NOT hold — it must
    # never appear (rendering it would defeat the whole point of a distorted belief).
    assert _ORIGIN_TRUTH not in blob, "the distorted belief's origin truth leaked to the player"
    assert _VAULT_SENTINEL not in blob, "a Vault-shaped sentinel field leaked into the payload"


def test_payload_items_carry_only_the_safe_shape(client, monkeypatch):
    _stub_engine(monkeypatch)
    body = client.get("/api/orwell/knowledge").json()
    assert body["started"] is True
    items = body["items"]
    assert len(items) == len(_KNOWLEDGE)
    for it in items:
        # Exactly the Vault-free shape — content + a qualitative source + a subject (or null).
        assert set(it.keys()) == {"content", "source", "subject"}
        assert set(it["source"].keys()) == {"kind", "who", "firsthand"}
        # The source carries NO number anywhere.
        for v in it["source"].values():
            assert not isinstance(v, (int, float)) or isinstance(v, bool), "a number rode on the source descriptor"


def test_zero_numbers_in_the_structured_projection(client, monkeypatch):
    _stub_engine(monkeypatch)
    body = client.get("/api/orwell/knowledge").json()
    # DoD "zero numbers": no numeric value anywhere in the STRUCTURED payload (booleans excepted —
    # `firsthand`; content prose may legitimately contain digits like "final 2", so we scan the
    # structure, not free text). Walk every non-content scalar and assert it is never a bare number.
    def scan(obj, path=""):
        if isinstance(obj, dict):
            for k, v in obj.items():
                scan(v, f"{path}.{k}")
        elif isinstance(obj, list):
            for i, v in enumerate(obj):
                scan(v, f"{path}[{i}]")
        elif isinstance(obj, (int, float)) and not isinstance(obj, bool):
            raise AssertionError(f"a raw number crossed at {path}: {obj!r}")
    scan(body)


# ── 2. belief vs. truth — distorted/secondhand renders AS a belief, never truth-flagged ─────────── #

def test_secondhand_belief_is_attributed_never_truth_flagged(client, monkeypatch):
    _stub_engine(monkeypatch)
    items = client.get("/api/orwell/knowledge").json()["items"]
    told = next(it for it in items if it["content"].startswith("the HOH is gunning"))
    # It is the player's BELIEF, attributed to its teller — never marked true/verified.
    assert told["source"]["kind"] == "told"
    assert told["source"]["firsthand"] is False
    assert told["source"]["who"] == "Nominee"  # the teller, name-resolved from the public roster
    # No truth/verification field anywhere on a belief.
    assert not ({"true", "verified", "truthful", "distorted", "confidence"} & set(_all_keys(told)))


def test_firsthand_fact_is_marked_firsthand(client, monkeypatch):
    _stub_engine(monkeypatch)
    items = client.get("/api/orwell/knowledge").json()["items"]
    seen = next(it for it in items if it["content"].startswith("the HOH won"))
    assert seen["source"]["kind"] == "witnessed" and seen["source"]["firsthand"] is True


def test_subject_grouping_and_unresolved_subject_falls_through(client, monkeypatch):
    _stub_engine(monkeypatch)
    items = client.get("/api/orwell/knowledge").json()["items"]
    # A resolvable subject carries its public name; an unknown/absent subject is null (→ "Around the
    # house" client-side), never a raw npc:id.
    by_content = {it["content"][:12]: it for it in items}
    assert by_content["the HOH won "]["subject"] == {"id": "npc:1", "name": "HOH"}
    assert by_content["your own rea"]["subject"] is None       # diary-room, subjectless
    assert by_content["word is a se"]["subject"] is None       # npc:99 not on the roster → null, never "npc:99"
    for it in items:
        if it["subject"] is not None:
            assert not it["subject"]["name"].startswith("npc:")


# ── 3. pre-game / fail-open ──────────────────────────────────────────────────────────────────────── #

def test_pre_game_is_an_honest_empty_journal(client, monkeypatch):
    _stub_engine(monkeypatch, no_game=True)
    r = client.get("/api/orwell/knowledge")
    assert r.status_code == 200
    assert r.json() == {"started": False, "items": []}


def test_name_map_read_failure_still_serves_the_journal(client, monkeypatch):
    # getGameState failing only drops NAMES (subjects → null), never the journal itself.
    async def fake_visible(user=None, **_kw):
        return {"knowledge": _KNOWLEDGE}

    async def boom_state(user=None, **_kw):
        raise RuntimeError("state read timed out")

    monkeypatch.setattr(orwell_engine, "get_visible_state", fake_visible)
    monkeypatch.setattr(orwell_engine, "get_game_state", boom_state)
    body = client.get("/api/orwell/knowledge").json()
    assert body["started"] is True and len(body["items"]) == len(_KNOWLEDGE)
    # With no roster, every subject is null and no told-teller name resolves — but never a raw id.
    for it in body["items"]:
        assert it["subject"] is None
        assert it["source"].get("who") in (None,)


# ── 4. recall parity — the 0007 non-degradation promise made visible ─────────────────────────────── #

def test_reload_is_lossless_and_deterministic(client, monkeypatch):
    _stub_engine(monkeypatch)
    first = client.get("/api/orwell/knowledge").json()["items"]
    # Simulate a reload/restart: the SAME persisted knowledge is re-projected — byte-identical.
    second = client.get("/api/orwell/knowledge").json()["items"]
    assert first == second, "a reload must re-project the journal identically (no drift, no loss)"


def test_restart_accumulates_a_superset(client, monkeypatch):
    # Snapshot the projection, then simulate a later session where MORE has been learned (0007: detail
    # only accumulates and deepens — never thins). The later projection is a SUPERSET of the earlier.
    _stub_engine(monkeypatch, knowledge=_KNOWLEDGE[:2])
    before = client.get("/api/orwell/knowledge").json()["items"]
    grown = _KNOWLEDGE  # every earlier fact, plus more
    _stub_engine(monkeypatch, knowledge=grown)
    after = client.get("/api/orwell/knowledge").json()["items"]
    assert len(after) >= len(before)
    for it in before:
        assert it in after, "the journal LOST a previously-known fact across the restart (non-degradation)"


# ── 5. the pure shaping helper (unit) ────────────────────────────────────────────────────────────── #

def test_sanitize_helper_is_vault_free_directly():
    items = orwell_routes._sanitize_knowledge({"knowledge": _KNOWLEDGE}, _STATE)
    for it in items:
        assert set(it.keys()) == {"content", "source", "subject"}
    blob = "\n".join(_all_strings(items))
    assert _ORIGIN_TRUTH not in blob and _VAULT_SENTINEL not in blob


def test_sanitize_helper_drops_blank_and_malformed_facts():
    junk = [{"pathway": "witnessed", "content": "  "}, "not-a-dict", {"content": "kept", "pathway": "gossip"}]
    items = orwell_routes._sanitize_knowledge({"knowledge": junk}, {})
    assert [it["content"] for it in items] == ["kept"]


# ── 6. JS window source pins ─────────────────────────────────────────────────────────────────────── #

def _js():
    return JS.read_text(encoding="utf-8")


def test_js_is_game_build_gated():
    assert 'dataset.gameBuild !== "1"' in _js(), "the Memory Wall must be game-build gated"


def test_js_subscribes_to_gamechanged():
    import re
    assert re.search(r"addEventListener\(\s*['\"]orwell:gamechanged['\"]", _js()), \
        "the window must refresh on the debounced orwell:gamechanged event (no ad-hoc dispatcher)"


def test_js_fails_open_via_the_reporter():
    assert "OrwellReport.fail" in _js(), "a fail-open surface must report (G11), never fail silently"


def test_js_composes_the_window_kit():
    assert "OrwellWindowKit.create" in _js(), "new windows MUST compose the OrwellWindow kit (F-3 ratchet)"


def test_js_anchors_beside_cast():
    assert "sidebar-cast-btn" in _js(), "the sidebar entry must sit beside Cast (DoD)"


def test_js_renders_no_raw_number():
    # The window must never read a hidden-state NUMBER off a fact — the route already dropped them, and
    # the render path must not reach for one. Pins "zero numbers, FE-side" structurally.
    js = _js()
    for forbidden in (".confidence", ".distortion", ".originalContent", ".hops"):
        assert forbidden not in js, f"the window reads a hidden number ({forbidden}) — it must not"


def test_js_consumes_the_shared_factline():
    # The M4-1 dossier lane's shared renderer has landed; the Memory Wall now COMPOSES it (the
    # M3-6/M4 unify TODO is resolved) instead of hand-rolling an equivalent fact row.
    js = _js()
    assert "OrwellFactLine.row(" in js, "the Memory Wall must render each fact through the shared OrwellFactLine row"
    assert "TODO(M3-6/M4 unify)" not in js, "the unify TODO must be gone once the shared row is adopted"


def test_js_does_not_define_the_shared_factline_module():
    # We CONSUME the shared renderer (owned by the M4-1 dossier lane) — we must never DEFINE it.
    js = _js()
    assert "window.OrwellFactLine =" not in js and "export function factLine" not in js


# ── 7. sidebar / rail / index registration ───────────────────────────────────────────────────────── #

def test_rail_mirror_is_registered():
    layout = LAYOUT.read_text(encoding="utf-8")
    assert "rail-memory-wall" in layout and "sidebar-memory-btn" in layout, \
        "RAIL_MIRRORS must create the collapsed-rail twin for the Memory Wall button (H4)"


def test_rail_mirror_id_avoids_the_static_brain_button():
    """index.html ships a STATIC #rail-memory (data-rail-source=\"tool-memory-btn\", the inherited
    Brain/Memory tool). The Memory Wall mirror must NOT reuse that id — doing so hijacks the Brain
    button's icon + gating and fails the H4 icon-parity smoke (caught live on PR #1238)."""
    layout = LAYOUT.read_text(encoding="utf-8")
    block = layout[layout.index("RAIL_MIRRORS"):]
    block = block[:block.index("];")]
    assert re.search(r"rail:\s*'rail-memory'[,\s]", block) is None, \
        "RAIL_MIRRORS must not claim the static Brain button's id 'rail-memory'"


def test_rail_mirror_adds_no_second_fallback():
    # The H4 gate requires EXACTLY ONE fallback glyph (the status HUD). Our button has its own svg, so
    # our mirror entry must not add a fallback.
    layout = LAYOUT.read_text(encoding="utf-8")
    block = layout[layout.index("RAIL_MIRRORS"):]
    block = block[:block.index("];")]
    assert block.count("fallback:") == 1, "the Memory Wall mirror must not add a second fallback glyph"


def test_index_loads_the_script():
    assert "orwellMemoryWall.js" in INDEX.read_text(encoding="utf-8"), \
        "index.html must load the Memory Wall window"
