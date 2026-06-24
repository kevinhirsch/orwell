"""Feature 0079 — the runtime loop overseer's diagnostic log (the "Overseer (live)" ring).

Name-agnostic — "admin"/"user" are ACCOUNT ROLES. Proves the 4th G1b log ring:
  * record_overseer writes Vault-free, coerced entries (levels, lever, beats, ok) and a
    glanceable one-line msg; the display severity tracks the overseer level + ok flag;
  * the free-text diagnosis is CLIPPED (bounded — no body can balloon the ring) and the
    beat fields coerce to int|None, so the Vault-free guarantee is structural, not
    careful-caller; an unknown level falls back to "observation"; the recorder never raises;
  * "overseer" is a selectable source on /api/admin/logs/sources and tails through
    /api/admin/logs with seq-cursor semantics, admin-gated like the other rings;
  * the existing FE guardrails are wired to emit overseer entries — today's invisible
    corrections become a legible stream.
"""

import importlib
import os

from fastapi import FastAPI
from fastapi.testclient import TestClient

ahr = importlib.import_module("routes.admin_health_routes")


def _app():
    app = FastAPI()
    app.include_router(ahr.setup_admin_health_routes())
    return app


# ── record_overseer: the Vault-free, coerced entry shape ───────────────────────

def test_record_overseer_captures_level_lever_and_beats():
    from src import log_rings
    log_rings.record_overseer("action", "gap-repair", "recorded a missed scene",
                              lever="propose-record", beat_before=7, beat_after=8, ok=True)
    _, lines = log_rings.OVERSEER.since(0)
    e = [l for l in lines if l["kind"] == "gap-repair"][-1]
    assert e["overseerLevel"] == "action"
    assert e["lever"] == "propose-record"
    assert e["beatBefore"] == 7 and e["beatAfter"] == 8
    assert e["ok"] is True
    assert e["level"] == "INFO"            # display severity for an OK action
    assert "gap-repair" in e["msg"] and "action" in e["msg"]


def test_record_overseer_severity_tracks_level_and_ok():
    from src import log_rings
    log_rings.record_overseer("anomaly", "gap-repair", "no parseable JSON", ok=False)
    log_rings.record_overseer("escalation", "stuck", "outside my toolbox", lever="escalate")
    log_rings.record_overseer("observation", "lull", "held; player mid-scene", lever="hold")
    _, lines = log_rings.OVERSEER.since(0)
    anomaly = [l for l in lines if l["overseerLevel"] == "anomaly"][-1]
    escal = [l for l in lines if l["overseerLevel"] == "escalation"][-1]
    obs = [l for l in lines if l["overseerLevel"] == "observation"][-1]
    assert anomaly["level"] == "ERROR"     # ok=False -> ERROR severity
    assert escal["level"] == "ERROR"       # escalation -> ERROR severity
    assert obs["level"] == "INFO"          # a routine hold is INFO


def test_record_overseer_clips_diagnosis_and_coerces_beats():
    from src import log_rings
    log_rings.record_overseer("observation", "k", "z" * 10000,
                              beat_before="not-an-int", beat_after=None)
    _, lines = log_rings.OVERSEER.since(0)
    e = lines[-1]
    assert len(e["diagnosis"]) < 3000 and "chars]" in e["diagnosis"]   # bounded, like record_io
    assert e["beatBefore"] is None and e["beatAfter"] is None          # bad/absent beats -> None


def test_unknown_level_falls_back_to_observation():
    from src import log_rings
    log_rings.record_overseer("bogus", "k", "d")
    _, lines = log_rings.OVERSEER.since(0)
    assert lines[-1]["overseerLevel"] == "observation"


def test_record_overseer_never_raises():
    from src import log_rings
    # a pathological payload must not bubble out of the recorder (logging never hurts the app)
    log_rings.record_overseer(None, object(), object(), lever=object(), beat_before=object())


# ── the admin "Overseer (live)" source ─────────────────────────────────────────

def test_overseer_source_is_listed(monkeypatch):
    monkeypatch.setenv("AUTH_ENABLED", "false")
    client = TestClient(_app(), raise_server_exceptions=False)
    sources = client.get("/api/admin/logs/sources").json()["sources"]
    ids = [s["id"] for s in sources]
    assert "overseer" in ids
    label = [s["label"] for s in sources if s["id"] == "overseer"][0]
    assert "Overseer" in label


def test_overseer_source_tails_with_cursor(monkeypatch):
    monkeypatch.setenv("AUTH_ENABLED", "false")
    from src import log_rings
    log_rings.record_overseer("action", "smoke", "overseer ring smoke line", lever="hold")
    client = TestClient(_app(), raise_server_exceptions=False)
    body = client.get("/api/admin/logs?source=overseer&since=0").json()
    assert body["source"] == "overseer"
    assert any("overseer ring smoke line" in l["msg"] for l in body["lines"])
    # cursor semantics: a follow-up read returns only entries newer than the cursor
    r2 = client.get(f"/api/admin/logs?source=overseer&since={body['next']}").json()
    assert all(l["seq"] > body["next"] for l in r2["lines"])


def test_overseer_log_is_admin_gated(monkeypatch):
    monkeypatch.setenv("AUTH_ENABLED", "true")     # default posture, no admin session
    client = TestClient(_app(), raise_server_exceptions=False)
    assert client.get("/api/admin/logs?source=overseer").status_code == 403
    assert client.get("/api/admin/logs/sources").status_code == 403


# ── the existing guardrails are wired to the overseer log (source-pinned) ───────

def test_fe_guardrails_emit_overseer_entries():
    src = open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                            "src", "agent_loop.py"), encoding="utf-8").read()
    # the gap-repair belt (0055) and the premiere belt both route their corrections here
    assert src.count("record_overseer(") >= 2
    assert "gap-repair" in src and "premiere-belt" in src
