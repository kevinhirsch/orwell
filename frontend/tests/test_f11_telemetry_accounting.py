"""F11 / BL-056 — telemetry accounting quirks.

Two clear accounting bugs the live-bundle sweep surfaced:
  * ``portraits.progress`` could report ``done > total`` ("7 / 5") after a retry / re-backfill ticked
    the heartbeat past the run's total — nonsensical, and a progress bar overshooting 100%.
  * ``tokenEconomy.spendAlertThresholdUsd == 0.0`` — the shipped default, which ``check_soft_alert``
    reads as "disabled", so the ops view showed an effectively-unset alert. Arm a sane default.
"""
import routes.admin_health_routes as ahr
from src import orwell_portraits


# ── portraits.progress never reports done > total (F11) ────────────────────────────

def test_generation_progress_clamps_done_to_total(monkeypatch):
    user = "f11-progress-user"
    orwell_portraits._progress_start(user, total=5)
    # Over-tick: 7 arrivals recorded against a run of 5 (a retry re-ran the pipeline).
    for _ in range(7):
        orwell_portraits._progress_tick(user)
    prog = orwell_portraits.generation_progress(user)
    assert prog is not None
    assert prog["total"] == 5
    assert prog["done"] == 5, "reported done must be clamped to total, never overshoot"
    assert prog["done"] <= prog["total"]


def test_generation_progress_normal_case_unaffected(monkeypatch):
    user = "f11-progress-user-2"
    orwell_portraits._progress_start(user, total=4)
    orwell_portraits._progress_tick(user)
    orwell_portraits._progress_tick(user)
    prog = orwell_portraits.generation_progress(user)
    assert prog == {"total": 4, "done": 2, "active": True}


# ── spend-alert threshold gets a sane default when unset (BL-056) ──────────────────

def test_spend_alert_threshold_defaults_when_unset(monkeypatch):
    # Shipped default is 0.0 → "disabled". The ops view should surface the armed default instead.
    monkeypatch.setattr("src.settings.get_setting",
                        lambda key, default=None: 0.0 if key == "token_spend_alert_usd" else default)
    out = ahr._token_economy("bl056-user")
    assert out["spendAlertThresholdUsd"] == ahr._DEFAULT_SPEND_ALERT_USD
    assert out["spendAlertThresholdDefaulted"] is True


def test_spend_alert_threshold_honors_explicit_admin_value(monkeypatch):
    monkeypatch.setattr("src.settings.get_setting",
                        lambda key, default=None: 2.5 if key == "token_spend_alert_usd" else default)
    out = ahr._token_economy("bl056-user-2")
    assert out["spendAlertThresholdUsd"] == 2.5
    assert out["spendAlertThresholdDefaulted"] is False
