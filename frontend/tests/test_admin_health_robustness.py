"""Admin status-page robustness + beefed-up debug bundle (owner P1 + "beef up that file").

Roles only — "admin"/"user" are ACCOUNT ROLES, not people. Proves:

  Part 1 — the status page must NEVER refuse to connect:
    * the FE boots even when the DB fails to initialize (a broken/corrupt/inaccessible
      ``app.db``): ``init_db()`` records the failure instead of raising, so importing
      ``core.database`` (which ``app.py`` imports) cannot crash the process;
    * a degraded boot is VISIBLE — ``db_init_error()`` is set and the health snapshot's
      store section carries ``degraded: True``;
    * ``/api/admin/health`` renders (200) and the status page renders + keeps its recovery
      buttons clickable even when the engine is DOWN and the store is broken.

  Part 2 — the debug bundle carries MUCH more, all secret-free + Vault-free:
    * versions, system info, feature flags, recent logs, ops status, REDACTED provider
      config, a scalar game-state summary, and recent session METADATA all ride along;
    * a configured secret (token/key/password) NEVER crosses; an api-key VALUE never crosses
      even though provider names/models/urls do; no transcript body crosses the session-
      METADATA section (the schema-3 chatStore dump carries transcripts BY DESIGN — owner
      ruling 2026-07-13 — under the same credential redaction).

  Part 3 — schema 3 ("include everything an operator/debugger could need", owner 2026-07-13):
    * the new sections all ride: full LLM I/O records (0112), the complete chat store dump
      (bounded per session), the whole FE log ring, the token ledger, the sync/divergence
      ledger + belt telemetry, the enrichment ledger, the overseer report ring, cast-
      authoring + house-entry detail, portrait/image state, a REDACTED settings snapshot,
      and the engine per-sandbox health;
    * a meta.sections index lists what's present/skipped with per-section item counts;
    * seeded credentials (api keys / Authorization headers) NEVER cross — in LLM I/O
      records, chat content, session headers, or the settings snapshot;
    * every new section is Vault-free (the repo's structural key-scan) and a broken
      subsystem degrades to an {"error": ...} section, never a build failure.
"""

import importlib
import json
import os

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

ahr = importlib.import_module("routes.admin_health_routes")
orwell_engine = importlib.import_module("src.orwell_engine")
database = importlib.import_module("core.database")


def _app():
    app = FastAPI()
    app.include_router(ahr.setup_admin_health_routes())
    app.include_router(ahr.setup_admin_status_page())
    return app


# ─────────────────────────────────────────────────────────────────────────────
# Part 1 — boot resilience: init_db NEVER crashes the process
# ─────────────────────────────────────────────────────────────────────────────

def test_init_db_never_raises_on_a_broken_store(monkeypatch, tmp_path):
    """A corrupt app.db must NOT abort init_db(): it records DB_INIT_ERROR and returns.

    This is the exact failure mode the owner hit (a root-run reset left the store
    unusable and the whole process failed to boot). init_db() runs at import time, so a
    raise here used to take down the FE and make /admin/status unreachable.

    At real process boot, ``engine`` is bound to the broken file and ``create_all(bind=
    engine)`` raises. We reproduce that by binding a FRESH engine to a corrupt file (the
    module's own ``engine`` is already bound to the test DB), so ``_init_db_inner`` raises
    and the wrapper must catch it."""
    from sqlalchemy import create_engine
    broken = tmp_path / "app.db"
    broken.write_bytes(b"this is not a sqlite database \x00\x01\x02 garbage")
    url = f"sqlite:///{broken}"
    monkeypatch.setattr(database, "DATABASE_URL", url)
    monkeypatch.setattr(database, "engine",
                        create_engine(url, connect_args={"check_same_thread": False}))

    # The previous error state must not leak between cases.
    monkeypatch.setattr(database, "DB_INIT_ERROR", None, raising=False)
    # Must not raise — that is the whole point (boot degraded, never crash).
    database.init_db()
    err = database.db_init_error()
    assert err is not None, "a broken store must be RECORDED, not swallowed silently"
    assert "error" in err and err["error"]
    # The recorded diagnostic must not echo the file bytes — error class + the DB URL only.
    assert "garbage" not in json.dumps(err)


def test_init_db_inner_failure_is_caught_by_the_wrapper(monkeypatch):
    """Belt-and-braces: ANY exception from the inner sequence is caught + recorded, so a
    future migration that throws can never crash boot either."""
    def boom():
        raise RuntimeError("a migration exploded")

    monkeypatch.setattr(database, "_init_db_inner", boom)
    monkeypatch.setattr(database, "DB_INIT_ERROR", None, raising=False)
    database.init_db()  # must not raise
    err = database.db_init_error()
    assert err is not None and "a migration exploded" in err["error"]


def test_init_db_clean_store_leaves_no_error(monkeypatch, tmp_path):
    """A healthy store initializes cleanly and clears any prior degraded flag."""
    good = tmp_path / "fresh.db"  # absent → SQLite creates a valid new DB
    monkeypatch.setattr(database, "DATABASE_URL", f"sqlite:///{good}")
    monkeypatch.setattr(database, "DB_INIT_ERROR", {"error": "stale"}, raising=False)
    database.init_db()
    assert database.db_init_error() is None


def test_health_store_section_reports_degraded_boot(monkeypatch):
    """The degraded-boot flag surfaces in the health snapshot so the page can show it."""
    monkeypatch.setattr(database, "DB_INIT_ERROR",
                        {"error": "DatabaseError: file is not a database"}, raising=False)
    stats = ahr._store_stats()
    assert stats.get("degraded") is True
    assert "file is not a database" in (stats.get("initError") or "")


# ─────────────────────────────────────────────────────────────────────────────
# Part 1 — the health endpoint + status page never HARD-fail (engine down + DB broken)
# ─────────────────────────────────────────────────────────────────────────────

@pytest.fixture
def down_everything(monkeypatch):
    """The worst case: engine unreachable AND the store degraded. Nothing may 500."""
    async def down_detail():
        return {"ok": False, "engineUrl": "http://127.0.0.1:9", "error": "ConnectError: refused"}

    async def down_raw():
        return None, None

    monkeypatch.setattr(orwell_engine, "engine_health_detail", down_detail)
    monkeypatch.setattr(ahr, "_engine_raw_health", down_raw)
    monkeypatch.setattr(database, "DB_INIT_ERROR",
                        {"error": "DatabaseError: file is not a database"}, raising=False)


def test_health_endpoint_never_hard_fails_when_all_is_broken(monkeypatch, down_everything):
    monkeypatch.setenv("AUTH_ENABLED", "false")
    client = TestClient(_app(), raise_server_exceptions=False)
    r = client.get("/api/admin/health")
    assert r.status_code == 200, "the health surface must NEVER 500 — that is the report"
    body = r.json()
    assert body["engine"]["ok"] is False
    assert body["tiersAgree"] is False
    # the degraded store is reported, not hidden
    assert body["frontend"]["store"].get("degraded") is True


def test_health_endpoint_survives_a_helper_that_blows_up(monkeypatch):
    """Even if a snapshot helper unexpectedly raises, the route returns a 200 diagnostic."""
    monkeypatch.setenv("AUTH_ENABLED", "false")

    async def boom(user):
        raise RuntimeError("unexpected snapshot failure")

    monkeypatch.setattr(ahr, "_health_snapshot", boom)
    client = TestClient(_app(), raise_server_exceptions=False)
    r = client.get("/api/admin/health")
    assert r.status_code == 200
    assert r.json()["engine"]["ok"] is False


def test_status_page_renders_with_recovery_buttons_when_engine_down(monkeypatch, down_everything):
    """The page must render and keep its recovery actions clickable in the worst case.

    The page is self-contained HTML (it does not depend on the live health to render its
    DOM), so the recovery controls are present regardless of engine/DB state."""
    monkeypatch.setenv("AUTH_ENABLED", "false")
    client = TestClient(_app(), raise_server_exceptions=False)
    r = client.get("/admin/status")
    assert r.status_code == 200
    body = r.text
    # Recovery buttons are present + clickable (real <button> with listeners, no js: hrefs).
    for ctrl in ('id="update-orwell"', 'id="factory-reset"', 'id="update-reset"',
                 'id="refresh-now"', 'href="/api/admin/debug-bundle"'):
        assert ctrl in body, f"recovery control missing from the status page: {ctrl}"
    # The degraded-boot banner element exists for the JS to populate.
    assert 'id="degraded"' in body
    assert "Data store DEGRADED" in body  # the operator-facing message is wired


# ─────────────────────────────────────────────────────────────────────────────
# Part 2 — the beefed-up bundle: rich, AND strictly secret-free + Vault-free
# ─────────────────────────────────────────────────────────────────────────────

ENGINE_RAW = {
    "ok": True,
    "uptimeSeconds": 100,
    "toolCalls": {"total": 5, "failed": 0},
    "recentFailures": [],
    "embeddings": {"provider": "deterministic", "degraded": True},
}


@pytest.fixture
def stubbed(monkeypatch):
    async def fake_detail():
        return {"ok": True, "engineUrl": "http://127.0.0.1:8765"}

    async def fake_raw():
        return ENGINE_RAW, 5

    monkeypatch.setattr(orwell_engine, "engine_health_detail", fake_detail)
    monkeypatch.setattr(ahr, "_engine_raw_health", fake_raw)
    monkeypatch.setattr(ahr, "_image_state", lambda user: {
        "enabled": False, "model": "", "quality": "", "available": False, "portraits": None})


def test_bundle_carries_the_beefed_up_sections(monkeypatch, stubbed):
    monkeypatch.setenv("AUTH_ENABLED", "false")
    client = TestClient(_app(), raise_server_exceptions=False)
    r = client.get("/api/admin/debug-bundle")
    assert r.status_code == 200
    bundle = json.loads(r.content)
    # All the schema-2 sections are still present…
    for key in ("versions", "systemInfo", "featureFlags", "logs",
                "opsStatus", "providerConfig", "gameState", "sessions"):
        assert key in bundle, f"beefed-up bundle missing section: {key}"
    # …plus the schema-3 "everything an operator could need" set.
    for key in ("llmIo", "chatStore", "frontendLog", "tokenEconomy", "syncLedger",
                "enrichment", "overseer", "castAuthoring", "houseEntry", "portraits",
                "settings", "sandboxHealth", "meta"):
        assert key in bundle, f"schema-3 bundle missing section: {key}"
    assert bundle.get("schema") == 3
    assert bundle["meta"]["schema"] == 3
    # System info carries the runtime versions an operator needs.
    assert "python" in bundle["systemInfo"]
    # Feature flags carry the build posture.
    assert "gameBuild" in bundle["featureFlags"]
    assert "authEnabled" in bundle["featureFlags"]


def test_bundle_game_state_summary_is_vault_free_scalars_only(monkeypatch, stubbed):
    """The game-state summary reduces to counts/phase/week — NO roster, NO Vault/soul.

    We feed a deliberately rich engine projection (a soul-ish blob + per-houseguest hidden
    fields) and assert ONLY the scalar reductions cross.

    The schema-3 sections are stubbed empty here: they carry process-global content (the
    live log ring, the shared test chat store) whose AMBIENT text would make this test's
    full-bundle marker scan order-dependent. Their own Vault-free gates live in Part 3
    (structural key-scan + the planted-sentinel tests in test_debug_bundle_fixes.py)."""
    monkeypatch.setenv("AUTH_ENABLED", "false")

    async def empty_v3(user):
        return {}

    monkeypatch.setattr(ahr, "_bundle_v3_sections", empty_v3)

    async def fake_status(user=None):
        return {"started": True, "week": 3, "phase": "nominations",
                "pending": {"kind": "nominate", "secretLean": "SHOULD-NEVER-CROSS"}}

    async def fake_state(user=None):
        return {
            "started": True,
            "houseguests": [
                {"id": "1", "status": "active", "secretTrust": 0.9, "soul": "VAULT-SECRET"},
                {"id": "2", "status": "evicted", "vaultNote": "VAULT-SECRET"},
            ],
            "jury": [{"id": "9"}],
            "player": {"status": "active", "hiddenThreat": 0.7},
        }

    monkeypatch.setattr(orwell_engine, "game_status", fake_status)
    monkeypatch.setattr(orwell_engine, "get_game_state", fake_state)
    client = TestClient(_app(), raise_server_exceptions=False)
    r = client.get("/api/admin/debug-bundle")
    text = r.text
    bundle = json.loads(r.content)
    gs = bundle["gameState"]
    assert gs["week"] == 3 and gs["phase"] == "nominations"
    assert gs["castCount"] == 2 and gs["activeCount"] == 1 and gs["juryCount"] == 1
    assert gs["playerStatus"] == "active"
    assert gs.get("pendingKind") == "nominate"
    # NOTHING hidden/Vault-shaped may cross — only scalar reductions.
    for leak in ("SHOULD-NEVER-CROSS", "VAULT-SECRET", "secretTrust",
                 "hiddenThreat", "vaultNote", "secretLean", "soul"):
        assert leak not in text, f"a hidden/Vault field leaked into the bundle: {leak}"


def test_bundle_provider_config_redacts_api_keys(monkeypatch, stubbed):
    """Provider names/models/base-urls cross; the api-key VALUE never does."""
    monkeypatch.setenv("AUTH_ENABLED", "false")
    secret_key = "sk-PROVIDER-SECRET-9999"

    class _Ep:
        name = "OpenRouter"
        base_url = "https://openrouter.ai/api/v1"
        model_type = "llm"
        endpoint_kind = "api"
        is_enabled = True
        supports_tools = True
        api_key = secret_key

    class _DB:
        def query(self, *a, **k): return self
        def all(self): return [_Ep()]
        def close(self): pass

    monkeypatch.setattr(ahr, "_provider_config", ahr._provider_config)  # keep the real one
    import core.database as cdb
    monkeypatch.setattr(cdb, "SessionLocal", lambda: _DB())
    monkeypatch.setattr(cdb, "ModelEndpoint", _Ep, raising=False)

    client = TestClient(_app(), raise_server_exceptions=False)
    r = client.get("/api/admin/debug-bundle")
    text = r.text
    bundle = json.loads(r.content)
    eps = bundle["providerConfig"]["endpoints"]
    assert eps and eps[0]["name"] == "OpenRouter"
    assert eps[0]["baseUrl"] == "https://openrouter.ai/api/v1"  # the non-secret url crosses
    assert eps[0]["hasApiKey"] is True                          # presence only
    assert secret_key not in text, "the api-key VALUE leaked into the bundle"
    # the raw key field name must not appear with a value either
    assert "apiKey" not in eps[0] and "api_key" not in eps[0]


def test_bundle_sessions_are_metadata_not_transcripts(monkeypatch, stubbed):
    """Recent session METADATA crosses (id/name/owner/model/counts) — no message bodies."""
    monkeypatch.setenv("AUTH_ENABLED", "false")
    client = TestClient(_app(), raise_server_exceptions=False)
    r = client.get("/api/admin/debug-bundle")
    bundle = json.loads(r.content)
    sessions = bundle["sessions"]
    assert "recent" in sessions  # a list (possibly empty in a fresh test DB)
    # The metadata shape never includes a message-content field.
    for s in sessions.get("recent", []):
        assert "content" not in s and "messages" not in s and "transcript" not in s


def test_bundle_still_redacts_env_secrets(monkeypatch, stubbed):
    """The original redaction contract holds for the beefed-up bundle: env secrets out."""
    monkeypatch.setenv("AUTH_ENABLED", "false")
    secret = "sk-VERY-SECRET-bearer-0123456789"
    monkeypatch.setenv("ORWELL_ENGINE_TOKEN", secret)
    monkeypatch.setenv("ORWELL_ENGINE_ADMIN_TOKEN", secret + "-admin")
    client = TestClient(_app(), raise_server_exceptions=False)
    r = client.get("/api/admin/debug-bundle")
    text = r.text
    assert secret not in text
    cfg = json.loads(r.content)["config"]
    assert cfg.get("ORWELL_ENGINE_TOKEN") == ahr.REDACTED
    assert cfg.get("ORWELL_ENGINE_ADMIN_TOKEN") == ahr.REDACTED


def test_bundle_assembles_even_when_health_and_engine_are_broken(monkeypatch):
    """P1: the bundle is the last-resort diagnostic — it must always download, never 500."""
    monkeypatch.setenv("AUTH_ENABLED", "false")

    async def boom_snapshot(user):
        raise RuntimeError("snapshot exploded")

    async def boom_extras(user):
        raise RuntimeError("extras exploded")

    monkeypatch.setattr(ahr, "_health_snapshot", boom_snapshot)
    monkeypatch.setattr(ahr, "_bundle_extras", boom_extras)
    client = TestClient(_app(), raise_server_exceptions=False)
    r = client.get("/api/admin/debug-bundle")
    assert r.status_code == 200
    assert "attachment" in r.headers.get("content-disposition", "")
    bundle = json.loads(r.content)
    assert bundle["bundle"] == "orwell-debug"
    # the failures are reported inside, not as a crash
    assert "error" in bundle["health"]


def test_bundle_is_admin_gated_and_leaks_nothing_on_refusal(monkeypatch):
    monkeypatch.setenv("AUTH_ENABLED", "true")
    monkeypatch.setenv("ORWELL_ENGINE_TOKEN", "refusal-path-secret-value")
    client = TestClient(_app(), raise_server_exceptions=False)
    r = client.get("/api/admin/debug-bundle")
    assert r.status_code == 403
    assert "refusal-path-secret-value" not in r.text


# ─────────────────────────────────────────────────────────────────────────────
# Part 3 — schema 3: everything an operator/debugger could need (owner 2026-07-13)
# ─────────────────────────────────────────────────────────────────────────────

_V3_SECTIONS = ("llmIo", "chatStore", "frontendLog", "tokenEconomy", "syncLedger",
                "enrichment", "overseer", "castAuthoring", "houseEntry", "portraits",
                "settings", "sandboxHealth")


def _get_bundle(client, url="/api/admin/debug-bundle", headers=None):
    r = client.get(url, headers=headers or {})
    assert r.status_code == 200
    return json.loads(r.content), r.text


def test_v3_meta_sections_index_lists_presence_and_counts(monkeypatch, stubbed):
    """(a) The meta.sections index: every content section has a row saying present/
    skipped (with per-section item counts where they exist), and the producerVault row
    is present:false on the STANDARD (Vault-free) export."""
    monkeypatch.setenv("AUTH_ENABLED", "false")
    client = TestClient(_app(), raise_server_exceptions=False)
    bundle, _ = _get_bundle(client)
    sections = bundle["meta"]["sections"]
    for name in _V3_SECTIONS + ("health", "config", "sessions", "providerConfig"):
        assert name in sections, f"meta.sections missing a row for: {name}"
        assert "present" in sections[name]
    # Counts ride where a natural item collection exists.
    assert isinstance(sections["frontendLog"].get("items"), int)
    assert isinstance(sections["chatStore"].get("items"), int)
    # The Vault row is self-describing and CLOSED on the standard export.
    assert sections["producerVault"]["present"] is False
    assert "producerVault" not in bundle


def test_v3_llm_io_carries_full_records_and_redacts_auth(monkeypatch, stubbed, tmp_path):
    """The llmIo section carries COMPLETE request/response records — system prompt,
    messages, REASONING, tool calls, finish reason, per-call class (kind) + the applied
    maxTokens — and a seeded Authorization/api-key shape NEVER survives serialization."""
    monkeypatch.setenv("AUTH_ENABLED", "false")
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    from src import llm_trace
    secret = "sk-LLMIO-SEEDED-SECRET-0123456789"
    llm_trace.record_llm_call(
        kind="narration",
        model="test-model-v1",
        messages=[
            {"role": "system", "content": "You are the narrator."},
            {"role": "user", "content": f"my key is {secret} and Authorization: Bearer {secret}"},
        ],
        tools=[{"type": "function", "function": {"name": "advanceGame"}}],
        temperature=0.7,
        max_tokens=1234,
        response={"text": "The house stirs.", "reasoning": "hidden-from-player reasoning text",
                  "toolCalls": [{"name": "advanceGame", "arguments": "{}"}],
                  "usage": {"prompt_tokens": 10, "completion_tokens": 5},
                  "finishReason": "stop"},
        ok=True, duration_ms=42)
    client = TestClient(_app(), raise_server_exceptions=False)
    bundle, text = _get_bundle(client)
    recs = bundle["llmIo"]["records"]
    assert recs, "the seeded LLM I/O record must ride in the bundle"
    rec = recs[-1]
    assert rec["kind"] == "narration"                       # per-call class
    assert rec["request"]["maxTokens"] == 1234              # applied output cap
    assert rec["request"]["messages"][0]["role"] == "system"
    assert rec["response"]["reasoning"].startswith("hidden-from-player")
    assert rec["response"]["toolCalls"][0]["name"] == "advanceGame"
    assert rec["response"]["finishReason"] == "stop"
    assert bundle["llmIo"]["meta"]["cap"] == ahr._BUNDLE_LLM_IO_CAP
    # HARD LINE #2: the seeded credential shapes never appear ANYWHERE in the bundle.
    assert secret not in text


def test_v3_chat_store_dumps_messages_with_metadata_and_caps(monkeypatch, stubbed):
    """The chatStore section is the COMPLETE dump — sessions + messages with metadata
    (reasoning/tool_events/client_msg_id ride inside), seq and timestamps — capped at the
    LAST N per session with the truncation noted in the section meta. Session `headers`
    (which can carry Authorization) NEVER cross — presence only."""
    monkeypatch.setenv("AUTH_ENABLED", "false")
    monkeypatch.setattr(ahr, "_BUNDLE_CHAT_MSG_CAP", 5)
    hdr_secret = "Bearer sk-SESSION-HEADER-SECRET-987654321"
    import uuid
    from core.database import SessionLocal, Session as DbSession, ChatMessage as DbChatMessage
    sid = f"bundle-dump-{uuid.uuid4().hex[:10]}"
    db = SessionLocal()
    try:
        db.add(DbSession(id=sid, name="bundle dump session", endpoint_url="http://x/v1",
                         model="m", owner="admin", headers={"Authorization": hdr_secret}))
        for i in range(8):
            db.add(DbChatMessage(
                id=f"{sid}-m{i}", session_id=sid, role="user" if i % 2 == 0 else "assistant",
                content=f"turn {i}",
                meta_data=json.dumps({"client_msg_id": f"c{i}", "reasoning": f"r{i}",
                                      "tool_events": [{"name": "getGameState"}]}),
                seq=i))
        db.commit()
    finally:
        db.close()
    try:
        client = TestClient(_app(), raise_server_exceptions=False)
        bundle, text = _get_bundle(client)
        sessions = {s["id"]: s for s in bundle["chatStore"]["sessions"]}
        assert sid in sessions, "every session must be in the dump"
        s = sessions[sid]
        # The LAST 5 of 8 messages, chronological, with content + parsed metadata + seq.
        assert [m["seq"] for m in s["messages"]] == [3, 4, 5, 6, 7]
        assert s["messages"][-1]["content"] == "turn 7"
        assert s["messages"][-1]["metadata"]["client_msg_id"] == "c7"
        assert s["messages"][-1]["metadata"]["reasoning"] == "r7"
        assert s["messages"][-1]["metadata"]["tool_events"][0]["name"] == "getGameState"
        assert s["messages"][-1]["timestamp"]
        # Truncation is noted in the section meta.
        trunc = {t["id"]: t for t in bundle["chatStore"]["meta"]["truncatedSessions"]}
        assert sid in trunc and trunc[sid]["total"] == 8 and trunc[sid]["included"] == 5
        assert bundle["chatStore"]["meta"]["messageCapPerSession"] == 5
        # Session headers NEVER cross — presence flag only; the seeded secret is absent.
        assert s["hasHeaders"] is True
        assert "headers" not in s
        assert hdr_secret not in text
        assert "sk-SESSION-HEADER-SECRET" not in text
    finally:
        db = SessionLocal()
        try:
            db.query(DbChatMessage).filter(DbChatMessage.session_id == sid).delete()
            db.query(DbSession).filter(DbSession.id == sid).delete()
            db.commit()
        finally:
            db.close()


def test_v3_frontend_log_ring_and_ledgers_ride(monkeypatch, stubbed, tmp_path):
    """The FULL FE log ring (with the WARN/ERROR history), the sync/divergence ledger +
    belt totals, the token ledger, the enrichment ledger, and the overseer report ring
    all ride in the bundle."""
    monkeypatch.setenv("AUTH_ENABLED", "false")
    import logging
    from src import log_rings, orwell_sync_ledger
    marker = "v3-bundle-ring-marker-line"
    logging.getLogger("v3-bundle-test").warning(marker)
    log_rings.record_overseer("observation", "v3-bundle-probe", "bundle test diagnostic")
    monkeypatch.setattr(orwell_sync_ledger, "LEDGER_PATH",
                        tmp_path / "sync_ledger.json", raising=True)
    orwell_sync_ledger.note_belt_fire("admin", "auto-record-scene")
    orwell_sync_ledger.record_turn("admin", session="s1", turn_id="t1",
                                   beat_seq_before=1, beat_seq_after=2,
                                   tools_called=["recordInteraction"])
    client = TestClient(_app(), raise_server_exceptions=False)
    # effective_user resolves None → the "default"/admin bucket in these middleware-less
    # apps; read the ledger sections for whichever bucket the route resolved by checking
    # both shapes are present rather than user-keyed content.
    bundle, _ = _get_bundle(client)
    # The full ring (not just a tail) + the WARN/ERROR slice.
    lines = bundle["frontendLog"]["lines"]
    assert any(marker in (l.get("msg") or "") for l in lines)
    assert any(marker in (l.get("msg") or "") for l in bundle["frontendLog"]["warnErrors"])
    # The overseer report ring carries the probe.
    assert any((l.get("kind") or "") == "v3-bundle-probe" for l in bundle["overseer"]["reports"])
    # The ledgers carry their shapes (entries may be user-scoped; shape is the contract).
    assert "recent" in bundle["syncLedger"] and "beltTotals" in bundle["syncLedger"]
    assert "entries" in bundle["tokenEconomy"] and "summary" in bundle["tokenEconomy"]
    assert "policy" in bundle["enrichment"] and "failures" in bundle["enrichment"]
    # House entry + cast authoring + portraits + settings + sandboxHealth all ride.
    assert "hold" in bundle["houseEntry"] and "watchActive" in bundle["houseEntry"]
    assert "attemptsSpent" in bundle["castAuthoring"] and "givenUp" in bundle["castAuthoring"]
    for key in ("manifest", "lastRun", "budget", "attemptLog", "prompts"):
        assert key in bundle["portraits"], f"portraits section missing: {key}"
    assert "settings" in bundle["settings"]
    assert isinstance(bundle["sandboxHealth"], dict)  # engine down ⇒ {"error": ...}, still a dict


def test_v3_settings_snapshot_redacts_secret_shaped_values(monkeypatch, stubbed):
    """(HARD LINE #2) The settings snapshot rides with every secret-shaped value REDACTED
    — a seeded api key / token / webhook secret never survives serialization."""
    monkeypatch.setenv("AUTH_ENABLED", "false")
    seeded = {
        "default_model": "some-chat-model",
        "openrouter_api_key": "sk-SETTINGS-SEEDED-SECRET-1234567890",
        "gateway_webhook_secret": "whsec-SETTINGS-SEEDED-XYZ",
        "reminder_token": "tok-SETTINGS-SEEDED-999",
        "token_spend_alert_usd": 2.5,          # plural-*tokens / numeric knobs survive
        "max_tokens_budget": {"narration": 4096},
    }
    import src.settings as settings_mod
    monkeypatch.setattr(settings_mod, "load_settings", lambda: dict(seeded))
    client = TestClient(_app(), raise_server_exceptions=False)
    bundle, text = _get_bundle(client)
    snap = bundle["settings"]["settings"]
    assert snap["default_model"] == "some-chat-model"
    assert snap["openrouter_api_key"] == ahr.REDACTED
    assert snap["gateway_webhook_secret"] == ahr.REDACTED
    assert snap["reminder_token"] == ahr.REDACTED
    assert snap["token_spend_alert_usd"] == 2.5
    assert snap["max_tokens_budget"] == {"narration": 4096}
    for leak in ("sk-SETTINGS-SEEDED-SECRET", "whsec-SETTINGS-SEEDED", "tok-SETTINGS-SEEDED"):
        assert leak not in text, f"a settings secret crossed into the bundle: {leak}"


def test_v3_new_sections_are_structurally_vault_free(monkeypatch, stubbed):
    """(HARD LINE #1) The repo's structural leak-scan (llm_trace's Vault-key denylist —
    the same class of gate as the engine secrets.test.ts) over every schema-3 section
    whose keys are OURS (fixed shapes, not free-text ring lines): no Vault-shaped key may
    exist in the STANDARD export."""
    monkeypatch.setenv("AUTH_ENABLED", "false")
    from src.llm_trace import record_is_vault_free
    client = TestClient(_app(), raise_server_exceptions=False)
    bundle, _ = _get_bundle(client)
    for name in ("gameState", "castAuthoring", "houseEntry", "portraits", "syncLedger",
                 "tokenEconomy", "enrichment", "sandboxHealth", "sessions"):
        assert record_is_vault_free(bundle.get(name)), \
            f"a Vault-shaped key surfaced in bundle section: {name}"


def test_v3_broken_subsystems_degrade_to_error_sections(monkeypatch, stubbed):
    """(d) Fail-soft: broken subsystems yield {"error": ...} sections — marked skipped in
    the meta index — and the bundle still assembles at 200 with every other section."""
    monkeypatch.setenv("AUTH_ENABLED", "false")

    def boom_chat():
        raise RuntimeError("chat store exploded")

    def boom_settings():
        raise RuntimeError("settings store exploded")

    monkeypatch.setattr(ahr, "_chat_store_section", boom_chat)
    monkeypatch.setattr(ahr, "_settings_section", boom_settings)
    client = TestClient(_app(), raise_server_exceptions=False)
    bundle, _ = _get_bundle(client)
    assert bundle["schema"] == 3
    assert "chat store exploded" in bundle["chatStore"]["error"]
    assert "settings store exploded" in bundle["settings"]["error"]
    # The meta index marks them skipped, with the error.
    assert bundle["meta"]["sections"]["chatStore"]["present"] is False
    assert "error" in bundle["meta"]["sections"]["chatStore"]
    # Every OTHER section still assembled.
    assert "records" in bundle["llmIo"]
    assert "lines" in bundle["frontendLog"]
    assert "recent" in bundle["syncLedger"]
