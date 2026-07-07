"""M1-9 (audit A9) — image-generation honesty: a failing provider says so.

`image_generation_available` is deliberately permissive ("a configured endpoint is enough
to TRY" — the documented false-negative fix), so honesty lives in the OUTCOME: a completed
run that attempted portraits and landed ZERO stamps a per-user failing verdict, which flips
the cast panel's copy and the /admin/status row — instead of the audit's eternal
"Generating 16 remaining… (0/16 done)" over a provider that never produces an image.
Name-agnostic; counts only.
"""

import importlib
import os

orwell_portraits = importlib.import_module("src.orwell_portraits")

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def test_zero_of_n_run_stamps_failing(monkeypatch):
    monkeypatch.setattr(orwell_portraits, "_LAST_RUN_OUTCOME", {})
    orwell_portraits._note_last_run("u1", generated=0, skipped=0, total=16)
    out = orwell_portraits.last_run_outcome("u1")
    assert out and out["failing"] is True and out["attempted"] == 16


def test_partial_or_full_success_is_not_failing(monkeypatch):
    monkeypatch.setattr(orwell_portraits, "_LAST_RUN_OUTCOME", {})
    orwell_portraits._note_last_run("u1", generated=3, skipped=0, total=16)
    assert orwell_portraits.last_run_outcome("u1")["failing"] is False


def test_all_skipped_run_keeps_the_prior_verdict(monkeypatch):
    """An idempotent re-run (everything already on disk) attempted nothing — it must not
    overwrite a real verdict in either direction."""
    monkeypatch.setattr(orwell_portraits, "_LAST_RUN_OUTCOME", {})
    orwell_portraits._note_last_run("u1", generated=0, skipped=0, total=16)
    orwell_portraits._note_last_run("u1", generated=0, skipped=16, total=16)
    assert orwell_portraits.last_run_outcome("u1")["failing"] is True


def test_new_season_scrub_resets_the_verdict(monkeypatch, tmp_path):
    monkeypatch.setattr(orwell_portraits, "_LAST_RUN_OUTCOME", {})
    monkeypatch.setattr(orwell_portraits, "user_portrait_dir", lambda user: tmp_path / "p")
    orwell_portraits._note_last_run("u1", generated=0, skipped=0, total=16)
    orwell_portraits.scrub_user("u1")
    assert orwell_portraits.last_run_outcome("u1") is None


def test_cast_panel_carries_the_honest_copy():
    js = open(os.path.join(FRONTEND, "static", "js", "orwellCast.js"), encoding="utf-8").read()
    assert "portraitLastRun" in js, "the panel must read the roster payload's verdict"
    assert "Portraits aren't landing" in js, "the failing state needs actionable copy"
    idx_fail = js.index("_lastRunFailing")
    idx_gen = js.index('"Generating " + missing.length')
    assert idx_fail < idx_gen or "_lastRunFailing" in js[:idx_gen + 400], \
        "the failing branch must gate the idle 'Generating N remaining' copy"


def test_admin_row_carries_the_failed_marker():
    src = open(os.path.join(FRONTEND, "routes", "admin_health_routes.py"), encoding="utf-8").read()
    assert '"lastRun"' in src and "last run FAILED" in src, \
        "/admin/status must show the last run's honest verdict beside AVAILABLE"


def test_roster_payload_exposes_the_verdict():
    src = open(os.path.join(FRONTEND, "routes", "orwell_routes.py"), encoding="utf-8").read()
    assert '"portraitLastRun"' in src, "the roster payload carries the verdict (counts only)"
