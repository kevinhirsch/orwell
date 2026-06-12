"""Lane G1 — admin Health & Logs (UI-based health checking + debug bundle).

Name-agnostic — "admin"/"user" are ACCOUNT ROLES. Proves:
  * both routes are admin-gated (the shared require_admin contract: 403 without
    an admin session under AUTH_ENABLED=true, like test_0053_admin_transcripts);
  * /api/admin/health aggregates the engine self-report (uptime + the G1
    recent-failure ring + embeddings status), the FE tier's view, tier agreement,
    FE store stats, and the image-generation provider state;
  * /api/admin/debug-bundle is one downloadable JSON whose config section REDACTS
    every secret-shaped value (tokens/keys/passwords never leave the box);
  * the surface is read-only;
  * the Settings card exists, is admin-only DOM, and admin.js wires it.
"""

import importlib
import json
import os

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

ahr = importlib.import_module("routes.admin_health_routes")
orwell_engine = importlib.import_module("src.orwell_engine")


_INDEX = None
_APP_PY = None
_SETTINGS_JS = None


def _lazy_consts():
    global _INDEX, _APP_PY, _SETTINGS_JS
    base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if _INDEX is None:
        _INDEX = open(os.path.join(base, "static", "index.html"), encoding="utf-8").read()
    if _APP_PY is None:
        _APP_PY = open(os.path.join(base, "app.py"), encoding="utf-8").read()
    if _SETTINGS_JS is None:
        _SETTINGS_JS = open(os.path.join(base, "static", "js", "settings.js"), encoding="utf-8").read()


def _read_static(*parts):
    base = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "static")
    with open(os.path.join(base, *parts), encoding="utf-8") as f:
        return f.read()


def _app():
    app = FastAPI()
    app.include_router(ahr.setup_admin_health_routes())
    app.include_router(ahr.setup_admin_status_page())  # G1b: the standalone ops page
    return app


# A realistic engine /health self-report (the G1 shape) used by the stubbed tier.
ENGINE_RAW = {
    "ok": True,
    "uptimeSeconds": 4242,
    "toolCalls": {"total": 120, "failed": 3},
    "recentFailures": [
        {"ts": 1765400000000, "tool": "advanceGame", "errorClass": "TurnRefusedError", "durationMs": 18},
        {"ts": 1765400100000, "tool": "submitDecision", "errorClass": "EngineRefusal", "durationMs": 4},
    ],
    "embeddings": {"provider": "deterministic", "degraded": True},
}


@pytest.fixture
def stubbed_engine(monkeypatch):
    """Both engine probes answer locally — no network, deterministic shapes."""
    async def fake_detail():
        return {"ok": True, "engineUrl": "http://127.0.0.1:8765"}

    async def fake_raw():
        return ENGINE_RAW, 7

    monkeypatch.setattr(orwell_engine, "engine_health_detail", fake_detail)
    monkeypatch.setattr(ahr, "_engine_raw_health", fake_raw)
    monkeypatch.setattr(ahr, "_store_stats", lambda: {"sessions": 2, "messages": 9})
    monkeypatch.setattr(ahr, "_image_state", lambda user: {
        "enabled": True, "model": "gpt-image-1", "quality": "medium", "available": False,
    })


# ── Admin gating: a non-admin is refused on BOTH routes ────────────────────────

def test_health_is_admin_gated(monkeypatch):
    monkeypatch.setenv("AUTH_ENABLED", "true")  # default posture, no admin session
    client = TestClient(_app(), raise_server_exceptions=False)
    r = client.get("/api/admin/health")
    assert r.status_code == 403


def test_debug_bundle_is_admin_gated(monkeypatch):
    monkeypatch.setenv("AUTH_ENABLED", "true")
    monkeypatch.setenv("ORWELL_ENGINE_TOKEN", "gate-test-secret-value")
    client = TestClient(_app(), raise_server_exceptions=False)
    r = client.get("/api/admin/debug-bundle")
    assert r.status_code == 403
    # nothing leaks on the refusal path either
    assert "gate-test-secret-value" not in r.text


# ── /api/admin/health: the aggregated snapshot shape ───────────────────────────

def test_health_aggregates_both_tiers(monkeypatch, stubbed_engine):
    monkeypatch.setenv("AUTH_ENABLED", "false")  # bypasses the gate (smoke posture)
    client = TestClient(_app(), raise_server_exceptions=False)
    r = client.get("/api/admin/health")
    assert r.status_code == 200
    body = r.json()
    for key in ("generatedAt", "engine", "frontend", "tiersAgree", "images"):
        assert key in body, f"missing aggregate field: {key}"

    eng = body["engine"]
    assert eng["ok"] is True
    assert eng["latencyMs"] == 7
    assert eng["uptimeSeconds"] == 4242
    assert eng["toolCalls"] == {"total": 120, "failed": 3}
    # the G1 ring rides through untouched: tool + sanitized error class + timing only
    assert eng["recentFailures"] == ENGINE_RAW["recentFailures"]
    for entry in eng["recentFailures"]:
        assert set(entry) == {"ts", "tool", "errorClass", "durationMs"}
    # the embeddings degrade flag is visible to the admin
    assert eng["embeddings"] == {"provider": "deterministic", "degraded": True}

    assert body["frontend"]["store"] == {"sessions": 2, "messages": 9}
    assert body["tiersAgree"] is True
    assert body["images"]["available"] is False and body["images"]["enabled"] is True


def test_tiers_disagree_when_fe_recently_could_not_reach_the_engine(monkeypatch, stubbed_engine):
    monkeypatch.setenv("AUTH_ENABLED", "false")

    async def detail_with_fe_trouble():
        # the engine answers /health, but the FE's recent tool call could not get through
        return {"ok": True, "engineUrl": "http://127.0.0.1:8765",
                "lastError": {"tool": "advanceGame", "kind": "unreachable",
                              "error": "ReadTimeout: timed out", "ageSeconds": 5}}

    monkeypatch.setattr(orwell_engine, "engine_health_detail", detail_with_fe_trouble)
    client = TestClient(_app(), raise_server_exceptions=False)
    body = client.get("/api/admin/health").json()
    assert body["tiersAgree"] is False
    assert body["frontend"]["lastError"]["kind"] == "unreachable"


def test_health_survives_a_down_engine(monkeypatch, stubbed_engine):
    monkeypatch.setenv("AUTH_ENABLED", "false")

    async def down_detail():
        return {"ok": False, "engineUrl": "http://127.0.0.1:9", "error": "ConnectError: refused"}

    async def down_raw():
        return None, None

    monkeypatch.setattr(orwell_engine, "engine_health_detail", down_detail)
    monkeypatch.setattr(ahr, "_engine_raw_health", down_raw)
    client = TestClient(_app(), raise_server_exceptions=False)
    r = client.get("/api/admin/health")
    assert r.status_code == 200  # the health surface NEVER 500s on an outage — that IS the report
    body = r.json()
    assert body["engine"]["ok"] is False
    assert body["tiersAgree"] is False
    assert "error" in body["engine"]


# ── /api/admin/debug-bundle: one JSON download, secrets REDACTED ───────────────

def test_debug_bundle_shape_and_download_headers(monkeypatch, stubbed_engine):
    monkeypatch.setenv("AUTH_ENABLED", "false")
    client = TestClient(_app(), raise_server_exceptions=False)
    r = client.get("/api/admin/debug-bundle")
    assert r.status_code == 200
    assert "application/json" in r.headers.get("content-type", "")
    assert "attachment" in r.headers.get("content-disposition", "")
    assert "orwell-debug-bundle-" in r.headers.get("content-disposition", "")

    bundle = json.loads(r.content)
    for key in ("bundle", "generatedAt", "health", "recentFailures", "config"):
        assert key in bundle, f"missing bundle field: {key}"
    assert bundle["bundle"] == "orwell-debug"
    # the failure ring is hoisted for one-glance triage
    assert bundle["recentFailures"] == ENGINE_RAW["recentFailures"]
    # and the full health snapshot rides inside
    assert bundle["health"]["engine"]["embeddings"]["degraded"] is True


def test_debug_bundle_redacts_secrets(monkeypatch, stubbed_engine):
    monkeypatch.setenv("AUTH_ENABLED", "false")
    secret = "sk-VERY-SECRET-bearer-0123456789"
    monkeypatch.setenv("ORWELL_ENGINE_TOKEN", secret)
    monkeypatch.setenv("ORWELL_ENGINE_ADMIN_TOKEN", secret + "-admin")
    monkeypatch.setenv("ORWELL_DATA_DIR", "/tmp/orwell-data-dir")  # non-secret ops value crosses
    client = TestClient(_app(), raise_server_exceptions=False)
    r = client.get("/api/admin/debug-bundle")
    text = r.text
    assert secret not in text, "a configured secret crossed into the bundle"
    bundle = json.loads(r.content)
    cfg = bundle["config"]
    assert cfg.get("ORWELL_ENGINE_TOKEN") == ahr.REDACTED
    assert cfg.get("ORWELL_ENGINE_ADMIN_TOKEN") == ahr.REDACTED
    assert cfg.get("ORWELL_DATA_DIR") == "/tmp/orwell-data-dir"


def test_redaction_helper_covers_secret_shapes_and_url_credentials():
    cfg = ahr._redact_config({
        "ORWELL_ENGINE_TOKEN": "t0p",
        "BBAI_ENGINE_TOKEN": "legacy",
        "ORWELL_API_KEY": "k",
        "ORWELL_DB_PASSWORD": "p",
        "ORWELL_ENGINE_PORT": "8765",
        "DATABASE_URL": "postgresql://app:hunter2@db.internal/app",
        "UNRELATED_VAR": "never-bundled",
    })
    assert cfg["ORWELL_ENGINE_TOKEN"] == ahr.REDACTED
    assert cfg["BBAI_ENGINE_TOKEN"] == ahr.REDACTED
    assert cfg["ORWELL_API_KEY"] == ahr.REDACTED
    assert cfg["ORWELL_DB_PASSWORD"] == ahr.REDACTED
    assert cfg["ORWELL_ENGINE_PORT"] == "8765"  # non-secret ops values cross intact
    assert "hunter2" not in json.dumps(cfg)  # URL-embedded credentials scrubbed
    assert "UNRELATED_VAR" not in cfg  # only the deploy-relevant namespaces are bundled


# ── Read-only: no mutating verb exists on the surface ─────────────────────────

def test_surface_is_read_only():
    # Amended by G19a: the HEALTH/LOG routes stay read-only (GET only); the ops
    # subtree adds POST *triggers* by design — fixed-id allowlisted runs, the
    # update flag, and the G25 portrait-regenerate lever (which touches ONLY the
    # regenerable portrait cache, refuse-before-discard; pinned in
    # test_g25_portrait_regen.py) — pinned separately in test_g19a_ops_page.py.
    # No route here may ever mutate game or store state.
    router = ahr.setup_admin_health_routes()
    for r in router.routes:
        methods = getattr(r, "methods", set()) or set()
        if r.path.startswith("/api/admin/ops"):
            assert methods <= {"GET", "POST", "HEAD"}, r.path
        else:
            assert methods <= {"GET", "HEAD"}, f"{r.path} must stay read-only"

def test_health_card_is_admin_only():
    _lazy_consts()
    import re
    m = re.search(r'id="adm-health-card"[^>]*class="([^"]*)"|'
                  r'class="([^"]*)"[^>]*id="adm-health-card"', _INDEX)
    assert m, "the Health & Logs card must exist in Settings"
    classes = (m.group(1) or m.group(2) or "")
    assert "admin-only" in classes, "the Health & Logs card must be admin-only DOM"
    # settings.js is what hides every .admin-only node for a non-admin
    assert ".admin-only" in _SETTINGS_JS
    assert "isAdmin ? '' : 'none'" in _SETTINGS_JS


def test_health_card_lives_in_the_system_panel_not_player_chrome():
    _lazy_consts()
    # inside the System panel region (after the panel marker, before the modal ends)
    system_panel = _INDEX.split('data-settings-panel="system"')[1]
    assert 'id="adm-health-card"' in system_panel
    # exactly one card — nothing duplicated into player chrome
    assert _INDEX.count('id="adm-health-card"') == 1
    # no new nav surface — the only entry is the System-panel card
    assert 'data-settings-tab="health"' not in _INDEX


def test_health_card_has_live_rows_failure_log_and_bundle_button():
    # Amended by G1b: the failure TABLE moved to the standalone /admin/status
    # page; the card keeps the live summary rows + the page link + the bundle.
    html = _read_static("index.html")
    assert 'id="adm-health-card"' in html
    assert 'id="adm-health-rows"' in html
    assert "adm-health-failures" not in html          # offloaded to the page
    assert 'id="adm-health-page"' in html and 'href="/admin/status"' in html
    assert 'id="adm-health-bundle"' in html and "/api/admin/debug-bundle" in html

def test_admin_js_wires_the_health_panel():
    # Amended by G1b: the driver renders the summary rows only; the failure
    # table renderer lives in the standalone page.
    js = _read_static("js", "admin.js")
    assert "initHealthLogs" in js
    assert "/api/admin/health" in js
    assert "adm-health-rows" in js
    assert "adm-health-failures" not in js            # offloaded to the page

def test_routes_are_registered_in_app():
    _lazy_consts()
    assert "admin_health_routes" in _APP_PY
    assert "setup_admin_health_routes" in _APP_PY



# ── G1b: the standalone status page ─────────────────────────────────────────

def test_g1b_status_page_is_admin_gated(monkeypatch):
    monkeypatch.setenv("AUTH_ENABLED", "true")
    client = TestClient(_app(), raise_server_exceptions=False)
    r = client.get("/admin/status")
    assert r.status_code == 403


def test_g1b_status_page_serves_selfcontained_html(monkeypatch):
    monkeypatch.setenv("AUTH_ENABLED", "false")  # bypasses the gate (smoke posture)
    client = TestClient(_app(), raise_server_exceptions=False)
    r = client.get("/admin/status")
    assert r.status_code == 200
    assert "text/html" in r.headers.get("content-type", "")
    body = r.text
    assert "ORWELL · STATUS" in body
    assert "/api/admin/health" in body            # polls the existing aggregate
    assert "setInterval(load, 10000)" in body     # auto-refresh
    assert "<link" not in body                    # zero external assets — must render
    assert '<script src' not in body              #   even when the app shell is broken


# ── G1b: the multi-source live log viewer ───────────────────────────────────

def test_g1b_log_sources_lists_live_io_and_files(monkeypatch, tmp_path):
    monkeypatch.setenv("AUTH_ENABLED", "false")
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    (tmp_path / "portrait-log.jsonl").write_text('{"ok": true}\n')
    (tmp_path / "secrets.txt").write_text("not a log")
    client = TestClient(_app(), raise_server_exceptions=False)
    r = client.get("/api/admin/logs/sources")
    assert r.status_code == 200
    ids = [s["id"] for s in r.json()["sources"]]
    assert "live" in ids and "io" in ids
    assert "file:portrait-log.jsonl" in ids
    assert not any("secrets.txt" in i for i in ids)   # only .log/.jsonl are tailable


def test_g1b_live_ring_and_cursor(monkeypatch):
    monkeypatch.setenv("AUTH_ENABLED", "false")
    import logging
    from src import log_rings
    logging.getLogger("g1b-test").info("g1b ring smoke line")
    client = TestClient(_app(), raise_server_exceptions=False)
    r = client.get("/api/admin/logs?source=live&since=0")
    assert r.status_code == 200
    body = r.json()
    assert any("g1b ring smoke line" in l["msg"] for l in body["lines"])
    # cursor semantics: a follow-up read returns only entries newer than the
    # cursor (the live ring keeps receiving the app's own lines — by design).
    r2 = client.get(f"/api/admin/logs?source=live&since={body['next']}")
    assert all(l["seq"] > body["next"] for l in r2.json()["lines"])


def test_g1b_io_tap_records_calls_and_failures():
    from src import log_rings
    log_rings.record_io("getGameState", {"user": "u"}, True, 12, {"ok": True})
    log_rings.record_io("advanceGame", None, False, 3401, "TimeoutError: boom")
    _, lines = log_rings.IO.since(0)
    tools = [l["tool"] for l in lines]
    assert "getGameState" in tools and "advanceGame" in tools
    failed = [l for l in lines if l["tool"] == "advanceGame"][-1]
    assert failed["ok"] is False and "TimeoutError" in failed["result"]


def test_g1b_io_tap_clips_large_payloads():
    from src import log_rings
    log_rings.record_io("bigTool", {"x": "y"}, True, 1, "z" * 10000)
    _, lines = log_rings.IO.since(0)
    big = [l for l in lines if l["tool"] == "bigTool"][-1]
    assert len(big["result"]) < 3000 and "chars]" in big["result"]


def test_g1b_file_tail_refuses_traversal(monkeypatch, tmp_path):
    monkeypatch.setenv("AUTH_ENABLED", "false")
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    client = TestClient(_app(), raise_server_exceptions=False)
    for evil in ("file:../app.py", "file:..%2Fapp.py", "file:/etc/passwd"):
        r = client.get(f"/api/admin/logs?source={evil}")
        assert r.status_code == 404, evil


def test_g1b_engine_client_is_tapped():
    src = open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                            "src", "orwell_engine.py"), encoding="utf-8").read()
    assert "record_io(" in src and "_call_inner(" in src


def test_g1b_page_carries_the_sticky_tail_viewer(monkeypatch):
    monkeypatch.setenv("AUTH_ENABLED", "false")
    client = TestClient(_app(), raise_server_exceptions=False)
    body = client.get("/admin/status").text
    assert 'id="logpane"' in body and 'id="logsrc"' in body
    assert "scrollHeight - pane.scrollTop" in body    # the at-bottom stickiness math
    assert "paused" in body and "following" in body   # the follow pill states


def test_h1_status_page_inline_script_is_csp_nonceable_no_js_hrefs(monkeypatch):
    # Regression (H1): the page's inline <script> MUST carry the CSP nonce
    # placeholder, or the app's strict script-src nonce policy blocks it and the
    # page sits at "Loading…" forever. And no javascript: href (CSP blocks those
    # too) — interactive controls are real buttons with listeners.
    monkeypatch.setenv("AUTH_ENABLED", "false")
    client = TestClient(_app(), raise_server_exceptions=False)
    body = client.get("/admin/status").text
    assert '<script nonce=' in body                  # nonce-templated, not bare <script>
    assert "javascript:" not in body                 # no CSP-blocked href vectors
    assert 'id="refresh-now"' in body                # refresh is a real button (listener-wired)
