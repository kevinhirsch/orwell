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
      even though provider names/models/urls do; no transcript body crosses.
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
    # All the new top-level sections are present.
    for key in ("versions", "systemInfo", "featureFlags", "logs",
                "opsStatus", "providerConfig", "gameState", "sessions"):
        assert key in bundle, f"beefed-up bundle missing section: {key}"
    assert bundle.get("schema") == 2
    # System info carries the runtime versions an operator needs.
    assert "python" in bundle["systemInfo"]
    # Feature flags carry the build posture.
    assert "gameBuild" in bundle["featureFlags"]
    assert "authEnabled" in bundle["featureFlags"]


def test_bundle_game_state_summary_is_vault_free_scalars_only(monkeypatch, stubbed):
    """The game-state summary reduces to counts/phase/week — NO roster, NO Vault/soul.

    We feed a deliberately rich engine projection (a soul-ish blob + per-houseguest hidden
    fields) and assert ONLY the scalar reductions cross."""
    monkeypatch.setenv("AUTH_ENABLED", "false")

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
