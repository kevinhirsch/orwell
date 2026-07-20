"""F10 / BL-019 — an ACTIVE-but-unconfigured faithfulness judge must FAIL LOUD, not silently no-op.

When ``faithfulness_mode == 'active'`` (or ``'shadow'``) but no model resolves (faithfulness /
utility / default all unset), the live ``_faith_check`` hook just returns on ``_llm is None`` and the
anti-hallucination guard is DARK with nothing signalling it. These pins verify the health surface
(``src.faithfulness.judge_health``) reports the DARK state and that ``/admin/status`` lights a RED
``faithfulness-judge-dark`` alarm.
"""
import routes.admin_health_routes as ahr
from src import faithfulness as f


def _stub(monkeypatch, *, mode, resolvable):
    monkeypatch.setattr(f, "faithfulness_mode", lambda: mode)

    def _resolve(prefix, owner=None):
        return ("http://ep/v1/chat", "some/model", {}) if resolvable else ("", "", {})

    monkeypatch.setattr("src.endpoint_resolver.resolve_endpoint", _resolve)
    # keep dedicated-config reads deterministic (both empty — the reported live case)
    monkeypatch.setattr("src.settings.get_setting", lambda key, default=None: "" if "faithfulness" in key else default)


def test_active_judge_with_no_model_is_dark(monkeypatch):
    _stub(monkeypatch, mode="active", resolvable=False)
    h = f.judge_health("u")
    assert h["mode"] == "active"
    assert h["enabled"] is True
    assert h["modelResolvable"] is False
    assert h["dark"] is True


def test_active_judge_with_model_is_not_dark(monkeypatch):
    _stub(monkeypatch, mode="active", resolvable=True)
    h = f.judge_health("u")
    assert h["modelResolvable"] is True
    assert h["dark"] is False


def test_off_judge_is_never_dark(monkeypatch):
    _stub(monkeypatch, mode="off", resolvable=False)
    h = f.judge_health("u")
    assert h["enabled"] is False
    assert h["dark"] is False, "an intentionally-off judge is not a coverage loss"


def test_dark_judge_lights_red_alarm():
    alarms = ahr._compute_alarms(
        {}, faithfulness={"mode": "active", "enabled": True, "modelResolvable": False, "dark": True})
    codes = {a["code"] for a in alarms}
    assert "faithfulness-judge-dark" in codes
    dark = next(a for a in alarms if a["code"] == "faithfulness-judge-dark")
    assert dark["severity"] == "red"


def test_healthy_or_off_judge_lights_no_alarm():
    assert not any(a["code"] == "faithfulness-judge-dark" for a in ahr._compute_alarms(
        {}, faithfulness={"mode": "active", "enabled": True, "modelResolvable": True, "dark": False}))
    assert not any(a["code"] == "faithfulness-judge-dark" for a in ahr._compute_alarms(
        {}, faithfulness={"mode": "off", "enabled": False, "dark": False}))
