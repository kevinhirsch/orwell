"""T0-4 (telemetry + probe arm) — the /admin/status surface.

``/api/admin/health`` must carry a Vault-free ``capability`` section (every persisted
per-endpoint CapabilityProfile) and light a RED ``capability-red`` alarm whenever any profile's
``overallTier`` is red — mirrors the ``faithfulness-judge-dark`` pattern in
test_f10_faithfulness_judge_dark.py.
"""
import importlib

ahr = importlib.import_module("routes.admin_health_routes")
cap = importlib.import_module("src.capability_probe")


def test_a_red_capability_profile_lights_the_alarm():
    alarms = ahr._compute_alarms({}, capability={
        "ep-1": {"overallTier": "red", "toolChoice": {"tier": "red"}, "json": {"tier": "green"}},
    })
    codes = {a["code"] for a in alarms}
    assert "capability-red" in codes
    alarm = next(a for a in alarms if a["code"] == "capability-red")
    assert alarm["severity"] == "red"
    assert alarm["count"] == 1
    assert "ep-1" not in alarm["detail"]  # Vault-free / no endpoint id in free text — count only


def test_a_green_or_unknown_capability_profile_lights_no_alarm():
    assert not any(a["code"] == "capability-red" for a in ahr._compute_alarms({}, capability={
        "ep-1": {"overallTier": "green"}, "ep-2": {"overallTier": "unknown"}}))


def test_no_capability_data_lights_no_alarm():
    assert not any(a["code"] == "capability-red" for a in ahr._compute_alarms({}, capability=None))
    assert not any(a["code"] == "capability-red" for a in ahr._compute_alarms({}, capability={}))


def test_multiple_red_endpoints_count_correctly():
    alarms = ahr._compute_alarms({}, capability={
        "ep-1": {"overallTier": "red"},
        "ep-2": {"overallTier": "red"},
        "ep-3": {"overallTier": "green"},
    })
    alarm = next(a for a in alarms if a["code"] == "capability-red")
    assert alarm["count"] == 2


def test_health_snapshot_carries_the_capability_section(monkeypatch):
    monkeypatch.setattr(cap, "get_all_capability_profiles",
                        lambda: {"ep-1": {"overallTier": "yellow", "model": "m"}})
    # _health_snapshot does a lot of engine/faithfulness/etc. I/O — reach for the one seam this
    # test actually cares about (the capability import happens inline in the function via
    # `from src import capability_probe as _cap`, so monkeypatching the module attribute above
    # is enough; we still need the rest of the snapshot machinery to degrade gracefully with no
    # engine wired, which _health_snapshot already tolerates per its own fail-soft design).
    import asyncio
    snap = asyncio.run(ahr._health_snapshot(None))
    assert snap["capability"] == {"ep-1": {"overallTier": "yellow", "model": "m"}}


def test_health_snapshot_capability_section_is_fail_soft(monkeypatch):
    def boom():
        raise RuntimeError("settings store on fire")
    monkeypatch.setattr(cap, "get_all_capability_profiles", boom)
    import asyncio
    snap = asyncio.run(ahr._health_snapshot(None))
    assert snap["capability"] == {}  # degrades to empty, never raises through the snapshot
