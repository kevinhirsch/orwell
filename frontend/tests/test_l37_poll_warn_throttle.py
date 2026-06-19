"""L37 — engine-down poll-failure warnings are throttled.

When the engine is unreachable the FE polls state/status/finale every ~2s and each failed poll
logged a WARNING, firehosing the logs (ballooning ops-panel.log / the /admin/status viewer — a
sustained outage could crash the admin tab). The throttle logs the FIRST failure immediately, then
at most once per cooldown per key; a successful poll clears the key so the NEXT outage is never
silent. Pure-helper tests — no engine needed.
"""

import logging

import routes.orwell_routes as orw

LOGGER = "routes.orwell_routes"


def test_first_failure_logs_then_repeats_are_suppressed(caplog):
    orw._LAST_WARN.clear()
    with caplog.at_level(logging.WARNING, logger=LOGGER):
        for _ in range(50):
            orw._warn_throttled("state", "[orwell] state failed: boom")
    hits = [r for r in caplog.records if "state failed" in r.getMessage()]
    assert len(hits) == 1, "50 identical failures within the cooldown must log exactly once"


def test_recovery_clear_makes_the_next_outage_log_immediately(caplog):
    orw._LAST_WARN.clear()
    with caplog.at_level(logging.WARNING, logger=LOGGER):
        orw._warn_throttled("status", "[orwell] status failed: a")  # outage starts — logs
        orw._warn_throttled("status", "[orwell] status failed: a")  # still down — suppressed
        orw._clear_warn("status")                                   # a poll succeeded
        orw._warn_throttled("status", "[orwell] status failed: b")  # new outage — logs again
    hits = [r for r in caplog.records if "status failed" in r.getMessage()]
    assert len(hits) == 2


def test_cooldown_elapses_emits_a_heartbeat(monkeypatch, caplog):
    orw._LAST_WARN.clear()
    clock = {"now": 1000.0}
    monkeypatch.setattr(orw._time, "monotonic", lambda: clock["now"])
    with caplog.at_level(logging.WARNING, logger=LOGGER):
        orw._warn_throttled("finale", "[orwell] finale failed: x")  # logs
        orw._warn_throttled("finale", "[orwell] finale failed: x")  # suppressed
        clock["now"] += orw._WARN_EVERY + 1                          # cooldown passes
        orw._warn_throttled("finale", "[orwell] finale failed: x")  # heartbeat logs
    hits = [r for r in caplog.records if "finale failed" in r.getMessage()]
    assert len(hits) == 2


def test_distinct_keys_throttle_independently(caplog):
    orw._LAST_WARN.clear()
    with caplog.at_level(logging.WARNING, logger=LOGGER):
        orw._warn_throttled("state", "[orwell] state failed: x")
        orw._warn_throttled("status", "[orwell] status failed: y")
        orw._warn_throttled("finale", "[orwell] finale failed: z")
    assert len([r for r in caplog.records if r.name == LOGGER]) == 3
