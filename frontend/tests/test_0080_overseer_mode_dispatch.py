"""Feature 0080 — the 3-state overseer mode + the active-mode dispatch seam.

Two halves, both name-agnostic (roles only — "admin" is an ACCOUNT ROLE, never a person):

  * overseer_mode() — the FOUNDATION contract: a 5-step, settings-first, fail-soft resolution of
    'off' | 'shadow' | 'active', with the 0079 legacy back-compat (settings 'overseer_enabled' and
    the ORWELL_OVERSEER env flag) intact. overseer_enabled() is now the shim (mode != 'off').
  * dispatch_lever(verdict, actions) — the TRIGGER-ONLY routing seam: it invokes the caller's
    deterministic action for the verdict's lever and NOTHING else (it authors no outcome). 'hold',
    a missing action, and a garbage verdict are no-ops; a raising action is swallowed (fail-soft).

Settings writes are isolated to a tmp store (the test_0079 _isolate_settings pattern) so nothing
touches the real settings.json.
"""

from src import overseer


# ── settings isolation (mirrors test_0079_overseer_settings._isolate_settings) ────

def _isolate_settings(monkeypatch, tmp_path):
    """Point the settings store at a tmp file and drop the TTL cache, so a write never touches the
    real settings.json and reads/writes are immediate."""
    from src import settings as _s
    monkeypatch.setattr(_s, "SETTINGS_FILE", str(tmp_path / "settings.json"))
    monkeypatch.setattr(_s, "_settings_cache", None)


def _clear_env(monkeypatch):
    monkeypatch.delenv("ORWELL_OVERSEER_MODE", raising=False)
    monkeypatch.delenv("ORWELL_OVERSEER", raising=False)


# ── the shared-contract constants ─────────────────────────────────────────────────

def test_modes_constant_is_the_three_states():
    assert overseer.OVERSEER_MODES == ("off", "shadow", "active")


# ── overseer_mode() resolution — all 5 steps, settings-first ──────────────────────

def test_step0_golden_mode_pins_off_over_settings_and_env(monkeypatch, tmp_path):
    """0108 (2026-07-17): under golden record/replay the overseer is STRUCTURALLY off — the
    fixture is recorded overseer-off, so an overseer LLM leg firing under replay is an
    un-recorded call and a guaranteed fixture miss. Neither an explicitly saved settings
    'active' (the full merged-defaults settings round-trip that defeated the driver's env
    pin on CI) nor an env 'active' may turn it on while golden mode is live."""
    from src.settings import save_settings
    _isolate_settings(monkeypatch, tmp_path)
    _clear_env(monkeypatch)
    save_settings({"overseer_mode": "active"})
    monkeypatch.setenv("ORWELL_GOLDEN_REPLAY", str(tmp_path / "fixture.jsonl"))
    assert overseer.overseer_mode() == "off"
    monkeypatch.delenv("ORWELL_GOLDEN_REPLAY")
    monkeypatch.setenv("ORWELL_GOLDEN_RECORD", "1")
    monkeypatch.setenv("ORWELL_OVERSEER_MODE", "active")
    assert overseer.overseer_mode() == "off"
    # Golden mode off again ⇒ the normal resolution stands (settings 'active' wins).
    monkeypatch.delenv("ORWELL_GOLDEN_RECORD")
    assert overseer.overseer_mode() == "active"


def test_step1_settings_overseer_mode_wins(monkeypatch, tmp_path):
    """Step 1: a valid settings 'overseer_mode' wins over every fallback (env + legacy key)."""
    from src.settings import save_settings
    _isolate_settings(monkeypatch, tmp_path)
    monkeypatch.setenv("ORWELL_OVERSEER_MODE", "off")          # env says off…
    monkeypatch.setenv("ORWELL_OVERSEER", "0")
    for mode in overseer.OVERSEER_MODES:                       # …settings wins for each value
        save_settings({"overseer_mode": mode, "overseer_enabled": True})
        assert overseer.overseer_mode() == mode
    # A garbage settings mode is ignored — resolution falls through to the legacy key below it.
    save_settings({"overseer_mode": "nonsense", "overseer_enabled": True})
    assert overseer.overseer_mode() == "shadow"


def test_step2_legacy_settings_overseer_enabled(monkeypatch, tmp_path):
    """Step 2: with no 'overseer_mode', the legacy settings 'overseer_enabled' maps
    True -> 'shadow', False -> 'off' (the 0079 toggle still works)."""
    from src.settings import save_settings
    _isolate_settings(monkeypatch, tmp_path)
    monkeypatch.setenv("ORWELL_OVERSEER", "1")                 # env would say shadow, but the
    save_settings({"overseer_enabled": True})                 # explicit legacy key wins…
    assert overseer.overseer_mode() == "shadow"
    save_settings({"overseer_enabled": False})                # …including the explicit OFF
    assert overseer.overseer_mode() == "off"


def test_step3_env_overseer_mode_when_settings_unset(monkeypatch, tmp_path):
    """Step 3: no settings keys -> the explicit 3-state env knob ORWELL_OVERSEER_MODE."""
    from src.settings import save_settings
    _isolate_settings(monkeypatch, tmp_path)
    save_settings({})                                         # no overseer keys at all
    monkeypatch.setenv("ORWELL_OVERSEER", "1")                # legacy env present but outranked
    for mode in overseer.OVERSEER_MODES:
        monkeypatch.setenv("ORWELL_OVERSEER_MODE", mode.upper() + " ")  # case/space tolerant
        assert overseer.overseer_mode() == mode
    monkeypatch.setenv("ORWELL_OVERSEER_MODE", "garbage")     # invalid -> falls to step 4
    assert overseer.overseer_mode() == "shadow"


def test_step4_legacy_env_flag(monkeypatch, tmp_path):
    """Step 4: no settings, no ORWELL_OVERSEER_MODE -> the legacy ORWELL_OVERSEER flag,
    truthy -> 'shadow', anything else -> 'off'."""
    from src.settings import save_settings
    _isolate_settings(monkeypatch, tmp_path)
    save_settings({})
    monkeypatch.delenv("ORWELL_OVERSEER_MODE", raising=False)
    for truthy in ("1", "true", "TRUE", "yes", "on"):
        monkeypatch.setenv("ORWELL_OVERSEER", truthy)
        assert overseer.overseer_mode() == "shadow", truthy
    for falsey in ("0", "false", "no", "off", "", "  "):
        monkeypatch.setenv("ORWELL_OVERSEER", falsey)
        assert overseer.overseer_mode() == "off", repr(falsey)


def test_step5_default_active_everywhere(monkeypatch, tmp_path):
    """Step 5: nothing set anywhere -> 'active' (owner ruling 2026-07-13 — the shipped default; was
    'off'). Only the truly-unset default changed; every explicit step above still wins."""
    from src.settings import save_settings
    _isolate_settings(monkeypatch, tmp_path)
    save_settings({})
    _clear_env(monkeypatch)
    assert overseer.overseer_mode() == "active"


def test_mode_is_failsoft_on_broken_settings(monkeypatch):
    """A broken settings read degrades to the env path (steps 3-4) and NEVER raises."""
    from src import settings as _s

    def _boom(*a, **k):
        raise RuntimeError("settings unreadable")

    monkeypatch.setattr(_s, "get_setting", _boom)
    monkeypatch.delenv("ORWELL_OVERSEER_MODE", raising=False)
    monkeypatch.setenv("ORWELL_OVERSEER", "1")
    assert overseer.overseer_mode() == "shadow"               # degrades to the legacy env
    monkeypatch.setenv("ORWELL_OVERSEER_MODE", "active")
    assert overseer.overseer_mode() == "active"               # degrades to the 3-state env
    _clear_env(monkeypatch)
    assert overseer.overseer_mode() == "active"               # truly-unset ⇒ the active default, no raise


# ── overseer_enabled() back-compat (the load-bearing 0079 shim) ───────────────────

def test_enabled_is_mode_not_off(monkeypatch, tmp_path):
    """overseer_enabled() is now exactly (mode != 'off')."""
    from src.settings import save_settings
    _isolate_settings(monkeypatch, tmp_path)
    _clear_env(monkeypatch)
    save_settings({"overseer_mode": "off"})
    assert overseer.overseer_enabled() is False
    for mode in ("shadow", "active"):
        save_settings({"overseer_mode": mode})
        assert overseer.overseer_enabled() is True


def test_enabled_honors_legacy_env_flag(monkeypatch, tmp_path):
    """The 0079 contract: with the toggle unset, the truthy ORWELL_OVERSEER flag enables."""
    from src.settings import save_settings
    _isolate_settings(monkeypatch, tmp_path)
    save_settings({})
    monkeypatch.delenv("ORWELL_OVERSEER_MODE", raising=False)
    monkeypatch.setenv("ORWELL_OVERSEER", "on")
    assert overseer.overseer_enabled() is True
    monkeypatch.delenv("ORWELL_OVERSEER", raising=False)
    assert overseer.overseer_enabled() is True                # truly-unset ⇒ the active default (2026-07-13)


# ── dispatch_lever — routing + TRIGGER-ONLY + fail-soft ───────────────────────────

class _Spy:
    """A zero-arg action spy: records that it was invoked and returns a configurable 'applied'."""

    def __init__(self, applied=True, raises=False):
        self.calls = 0
        self._applied = applied
        self._raises = raises

    def __call__(self):
        self.calls += 1
        if self._raises:
            raise RuntimeError("action blew up")
        return self._applied


def _verdict(lever):
    # Build a real Verdict (a valid lever) — Signals/levels are irrelevant to the dispatch seam.
    return overseer.Verdict(level="action", kind="t", diagnosis="d", lever=lever)


def test_dispatch_routes_only_the_verdicts_lever_and_authors_nothing():
    """TRIGGER-ONLY: only the verdict's lever's spy is invoked; the others stay untouched; and the
    return is a plain status dict — the dispatcher computes no outcome/magnitude/content."""
    spies = {lev: _Spy() for lev in overseer.LEVERS if lev != "hold"}
    res = overseer.dispatch_lever(_verdict("nudge"), dict(spies))
    assert res == {"lever": "nudge", "applied": True, "reason": "applied"}
    assert spies["nudge"].calls == 1
    assert all(s.calls == 0 for lev, s in spies.items() if lev != "nudge")  # nothing else fired
    # The result authored nothing beyond the routing status — only the contract keys.
    assert set(res.keys()) == {"lever", "applied", "reason"}


def test_dispatch_each_lever_routes_to_its_own_action():
    """Every non-hold lever routes to its own callable, one at a time."""
    for lever in [l for l in overseer.LEVERS if l != "hold"]:
        spy = _Spy()
        res = overseer.dispatch_lever(_verdict(lever), {lever: spy})
        assert res["lever"] == lever and res["applied"] is True
        assert spy.calls == 1


def test_dispatch_action_declined_when_callable_returns_falsy():
    spy = _Spy(applied=False)
    res = overseer.dispatch_lever(_verdict("force-advance"), {"force-advance": spy})
    assert res["applied"] is False and spy.calls == 1
    assert res["reason"] == "action declined"


def test_dispatch_hold_is_a_noop():
    """'hold' applies nothing even if (wrongly) given a callable for it."""
    spy = _Spy()
    res = overseer.dispatch_lever(_verdict("hold"), {"hold": spy})
    assert res == {"lever": "hold", "applied": False, "reason": "hold — no action"}
    assert spy.calls == 0


def test_dispatch_missing_action_is_a_noop():
    """A lever with no action wired this turn is a no-op, not an error."""
    res = overseer.dispatch_lever(_verdict("reinject-delta"), {})  # empty actions
    assert res["lever"] == "reinject-delta" and res["applied"] is False
    assert res["reason"] == "no action provided for lever"


def test_dispatch_none_and_garbage_verdict_is_a_noop():
    """A None / garbage verdict (no usable lever) dispatches nothing."""
    spy = _Spy()
    for bad in (None, object(), "nudge", overseer.Verdict("action", "k", "d", "not-a-lever")):
        res = overseer.dispatch_lever(bad, {"nudge": spy})
        assert res["applied"] is False
    assert spy.calls == 0


def test_dispatch_is_failsoft_when_the_action_raises():
    """A raising action -> applied=False, and the exception NEVER propagates."""
    spy = _Spy(raises=True)
    res = overseer.dispatch_lever(_verdict("propose-record"), {"propose-record": spy})
    assert res["lever"] == "propose-record" and res["applied"] is False
    assert spy.calls == 1
    assert "RuntimeError" in res["reason"]
