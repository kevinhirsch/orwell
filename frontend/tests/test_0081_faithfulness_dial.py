"""Feature 0081 — the narration-faithfulness gate's DIAL (P1 scaffold).

The faithfulness gate is the overseer's SECOND role and rides its OWN 3-state dial, independent of
the 0079/0080 ``overseer_mode()`` (owner ruling O2, 2026-06-24 — its own clock). This lane pins the
dial's contract at the unit grain, mirroring ``tests/test_0080_active_overseer.py``:

  * three states, default OFF, reversible by flipping the setting;
  * settings ``faithfulness_mode`` wins, env ``ORWELL_FAITHFULNESS_MODE`` is the headless fallback;
  * garbage degrades to off (config never crashes the turn);
  * INDEPENDENCE — setting one dial never moves the other (the whole point of "its own dial");
  * SOURCE-PIN — ``/admin/status`` wires the faithfulness dial alongside the overseer one.

P1 ships only the dial (zero behavior change); the judge + correction land in later increments.
Settings writes are isolated to a tmp file so the test never touches the real store. Name-agnostic:
ROLES only, never names.
"""

import pathlib


from src.faithfulness import (
    FAITH_UNREFRAMABLE_MODES,
    FAITHFULNESS_MODES,
    faithfulness_enabled,
    faithfulness_mode,
    faithfulness_unreframable_mode,
)


# ── settings isolation (copied from tests/test_0080_active_overseer.py) ────────────

def _isolate_settings(monkeypatch, tmp_path):
    """Point the settings store at a tmp file and drop the TTL cache, so a mode write never touches
    the real settings.json and reads/writes are immediate."""
    from src import settings as _s
    monkeypatch.setattr(_s, "SETTINGS_FILE", str(tmp_path / "settings.json"))
    monkeypatch.setattr(_s, "_settings_cache", None)


def _clear_env(monkeypatch):
    monkeypatch.delenv("ORWELL_FAITHFULNESS_MODE", raising=False)


# ── the contract surface ──────────────────────────────────────────────────────────

def test_modes_tuple_is_the_three_states():
    assert FAITHFULNESS_MODES == ("off", "shadow", "active")


# ── 1) default off + per-state resolution + reversibility ──────────────────────────

def test_mode_defaults_to_off_with_nothing_configured(monkeypatch, tmp_path):
    """A fresh install with no faithfulness mode configured ⇒ off (the judge never runs)."""
    from src.settings import save_settings
    _isolate_settings(monkeypatch, tmp_path)
    _clear_env(monkeypatch)
    save_settings({})
    assert faithfulness_mode() == "off"
    assert faithfulness_enabled() is False


def test_mode_resolves_each_state_from_settings(monkeypatch, tmp_path):
    """settings ``faithfulness_mode`` resolves each of off/shadow/active; the enabled shim tracks
    ``mode != 'off'``."""
    from src.settings import save_settings
    _isolate_settings(monkeypatch, tmp_path)
    _clear_env(monkeypatch)
    for state in FAITHFULNESS_MODES:
        save_settings({"faithfulness_mode": state})
        assert faithfulness_mode() == state
        assert faithfulness_enabled() is (state != "off")


def test_flipping_the_setting_flips_the_mode_reversibly(monkeypatch, tmp_path):
    """active → shadow → off flips the live mode each time and restores prior behavior; the flip is
    purely the setting (the role is reversible, like the 0080 overseer dial)."""
    from src.settings import save_settings
    _isolate_settings(monkeypatch, tmp_path)
    _clear_env(monkeypatch)
    save_settings({"faithfulness_mode": "active"})
    assert faithfulness_mode() == "active"
    save_settings({"faithfulness_mode": "shadow"})
    assert faithfulness_mode() == "shadow"
    save_settings({"faithfulness_mode": "off"})
    assert faithfulness_mode() == "off"
    assert faithfulness_enabled() is False


# ── 2) env fallback + precedence + garbage ─────────────────────────────────────────

def test_env_var_is_the_headless_fallback_when_unset(monkeypatch, tmp_path):
    """With nothing in settings the ``ORWELL_FAITHFULNESS_MODE`` env knob decides (the headless
    fallback); unset ⇒ off."""
    from src.settings import save_settings
    _isolate_settings(monkeypatch, tmp_path)
    save_settings({})  # nothing in settings -> env decides
    monkeypatch.setenv("ORWELL_FAITHFULNESS_MODE", "active")
    assert faithfulness_mode() == "active"
    monkeypatch.setenv("ORWELL_FAITHFULNESS_MODE", "SHADOW")  # case-insensitive
    assert faithfulness_mode() == "shadow"
    monkeypatch.delenv("ORWELL_FAITHFULNESS_MODE", raising=False)
    assert faithfulness_mode() == "off"


def test_settings_win_over_env(monkeypatch, tmp_path):
    """The settings tier is authoritative over the env fallback (the admin UI control wins)."""
    from src.settings import save_settings
    _isolate_settings(monkeypatch, tmp_path)
    save_settings({"faithfulness_mode": "off"})
    monkeypatch.setenv("ORWELL_FAITHFULNESS_MODE", "active")
    assert faithfulness_mode() == "off"


def test_garbage_values_fall_through_to_off(monkeypatch, tmp_path):
    """An out-of-set settings value or env value degrades to off — never raises, never a bogus
    state (config must not crash the turn)."""
    from src.settings import save_settings
    _isolate_settings(monkeypatch, tmp_path)
    _clear_env(monkeypatch)
    save_settings({"faithfulness_mode": "frobnicate"})
    assert faithfulness_mode() == "off"
    save_settings({})
    monkeypatch.setenv("ORWELL_FAITHFULNESS_MODE", "loud")
    assert faithfulness_mode() == "off"


# ── 3) INDEPENDENCE — the two dials never move each other (the point of "its own dial") ──

def test_faithfulness_dial_is_independent_of_overseer_mode(monkeypatch, tmp_path):
    """Owner ruling O2: setting one dial never changes the other, in either direction — so pacing
    can run ``active`` while faithfulness stays ``shadow``, and vice versa (the exact mix the owner
    wanted possible: the riskier role on its own clock)."""
    from src.settings import save_settings
    from src.overseer import overseer_mode
    _isolate_settings(monkeypatch, tmp_path)
    _clear_env(monkeypatch)
    monkeypatch.delenv("ORWELL_OVERSEER", raising=False)
    monkeypatch.delenv("ORWELL_OVERSEER_MODE", raising=False)

    # pacing active, faithfulness shadow.
    save_settings({"overseer_mode": "active", "faithfulness_mode": "shadow"})
    assert overseer_mode() == "active"
    assert faithfulness_mode() == "shadow"

    # the reverse mix.
    save_settings({"overseer_mode": "shadow", "faithfulness_mode": "active"})
    assert overseer_mode() == "shadow"
    assert faithfulness_mode() == "active"


def test_overseer_dial_unaffected_by_faithfulness(monkeypatch, tmp_path):
    """Symmetric guard: writing only ``faithfulness_mode`` leaves ``overseer_mode`` at its own
    resolution (here: absent ⇒ off), and writing only ``overseer_mode`` leaves faithfulness off."""
    from src.settings import save_settings
    from src.overseer import overseer_mode
    _isolate_settings(monkeypatch, tmp_path)
    _clear_env(monkeypatch)
    monkeypatch.delenv("ORWELL_OVERSEER", raising=False)
    monkeypatch.delenv("ORWELL_OVERSEER_MODE", raising=False)

    save_settings({"faithfulness_mode": "active"})
    assert overseer_mode() == "off"          # overseer absent -> its own default
    assert faithfulness_mode() == "active"

    save_settings({"overseer_mode": "active"})
    assert faithfulness_mode() == "off"      # faithfulness absent -> off
    assert overseer_mode() == "active"


# ── 4) SOURCE-PIN — the dials + the faithfulness model picker live in Settings (moved off admin) ──

_ADMIN_SRC = pathlib.Path(__file__).resolve().parents[1] / "routes" / "admin_health_routes.py"
_FE_ROOT = pathlib.Path(__file__).resolve().parents[1]


def test_source_pin_overseer_controls_moved_to_settings():
    """The overseer + faithfulness dials moved OUT of /admin/status INTO the Settings AI tab, and the
    dedicated faithfulness model picker lives there too — all the operator AI config in one place."""
    admin = _ADMIN_SRC.read_text()
    assert "overseer-toggle" not in admin            # the dials are GONE from /admin/status…
    assert "faithfulness-toggle" not in admin
    html = (_FE_ROOT / "static" / "index.html").read_text()
    js = (_FE_ROOT / "static" / "js" / "settings.js").read_text()
    assert "set-overseerMode" in html and "set-faithMode" in html          # …the two dials now in Settings…
    assert "set-faithEpSelect" in html and "set-faithModelSelect" in html   # …+ the dedicated model picker…
    assert "initOverseerModes" in js and "initFaithfulnessModel" in js      # …wired in settings.js.


# ── the un-reframable fallback dial (owner ruling O1) ──────────────────────────────

def test_unreframable_modes_tuple_is_the_three_options():
    assert FAITH_UNREFRAMABLE_MODES == ("reground", "log-only", "visible")


def test_unreframable_defaults_to_reground(monkeypatch, tmp_path):
    from src.settings import save_settings
    _isolate_settings(monkeypatch, tmp_path)
    monkeypatch.delenv("ORWELL_FAITHFULNESS_UNREFRAMABLE", raising=False)
    save_settings({})
    assert faithfulness_unreframable_mode() == "reground"


def test_unreframable_resolves_each_mode_from_settings(monkeypatch, tmp_path):
    from src.settings import save_settings
    _isolate_settings(monkeypatch, tmp_path)
    monkeypatch.delenv("ORWELL_FAITHFULNESS_UNREFRAMABLE", raising=False)
    for m in FAITH_UNREFRAMABLE_MODES:
        save_settings({"faithfulness_unreframable": m})
        assert faithfulness_unreframable_mode() == m


def test_unreframable_env_fallback_then_garbage_degrades_to_reground(monkeypatch, tmp_path):
    from src.settings import save_settings
    _isolate_settings(monkeypatch, tmp_path)
    save_settings({})
    monkeypatch.setenv("ORWELL_FAITHFULNESS_UNREFRAMABLE", "visible")
    assert faithfulness_unreframable_mode() == "visible"
    monkeypatch.setenv("ORWELL_FAITHFULNESS_UNREFRAMABLE", "nonsense")
    assert faithfulness_unreframable_mode() == "reground"   # garbage ⇒ the safe default


# ── the dedicated faithfulness-judge model keys (Settings persistence) ─────────────

def test_faithfulness_model_keys_are_in_default_settings():
    """The dedicated faithfulness-judge model keys live in DEFAULT_SETTINGS so the admin
    /api/auth/settings route (allowlisted to DEFAULT_SETTINGS keys) can persist them — and so
    resolve_endpoint('faithfulness') reads them (falling back to utility -> default when unset)."""
    from src.settings import DEFAULT_SETTINGS
    for k in ("faithfulness_endpoint_id", "faithfulness_model", "faithfulness_model_fallbacks"):
        assert k in DEFAULT_SETTINGS
    assert DEFAULT_SETTINGS["faithfulness_model_fallbacks"] == []
