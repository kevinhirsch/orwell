"""#738 item #4 — haptics/audio beat channel a11y hardening (source-pinned gate).

Issue #738 (Liquid Glass backlog) item #4 asks for a "Web-haptics + audio beat
channel on ceremony/decision beats … behind a setting + reduced-motion, Vault-free
trigger." The channel itself already shipped under #745 (orwellHaptics.js); its
load-bearing invariants are frozen by `test_0745_haptics.py`.

This gate freezes the #738 a11y-trio HARDENING added on top of that shipped module:
  * a `prefers-reduced-transparency` silence gate (the Liquid Glass a11y trio — a
    player who asked for a calmer, less-material UI opts out of the accent too);
  * an INDEPENDENT audio sub-toggle (`orwell-haptics-audio`) so the vibration and
    the chime silence separately, exposed in the settings panel;
  * the g15 single-dispatcher invariant is preserved — the module still only LISTENS
    for `orwell:gamechanged`, it never introduces a second dispatcher;
  * the new gating stays Vault-free (reads only the a11y media query + the setting).

Note on the DEFAULT: the shipped channel defaults ON (opt-out) by a documented
owner decision + its own gate (`test_0745_haptics::test_default_on_only_explicit_off
_disables`). This gate does NOT flip that — it only pins that the setting EXISTS and
that the a11y silence gates are wired. (Flipping the default is an owner call, not a
delegate one.)

Static-source convention checks — the FE has no DOM runtime in the pytest lane.
"""
import re
from pathlib import Path

FE = Path(__file__).resolve().parents[1]
JS_DIR = FE / "static" / "js"
HAPTICS = (JS_DIR / "orwellHaptics.js").read_text(encoding="utf-8")
SETTINGS = (JS_DIR / "settings.js").read_text(encoding="utf-8")
INDEX = (FE / "static" / "index.html").read_text(encoding="utf-8")


def _strip_comments(src: str) -> str:
    """Drop // and /* */ comments so a Vault/behaviour sweep checks CODE, not the
    module's own explanatory prose."""
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    src = re.sub(r"(?m)//.*$", "", src)
    return src


# ── The setting exists (opt-out toggle, persisted in the FE store) ─────────────
def test_haptics_setting_exists_and_is_persisted():
    assert "orwell-haptics" in HAPTICS, "the module must read the 'orwell-haptics' user setting"
    assert "localStorage" in HAPTICS
    assert "orwell-haptics" in SETTINGS, "settings.js must persist the haptics setting"


# ── The reduced-motion guard is present (motion-optional contract) ─────────────
def test_reduced_motion_guard_present():
    assert "prefers-reduced-motion" in HAPTICS and "reduce" in HAPTICS, (
        "haptics must go silent under prefers-reduced-motion"
    )
    assert "matchMedia" in HAPTICS


# ── #738: the reduced-transparency silence gate (a11y trio) ────────────────────
def test_reduced_transparency_gate_present():
    assert "prefers-reduced-transparency" in HAPTICS, (
        "#738 item #4: the channel must also honour prefers-reduced-transparency "
        "(the Liquid Glass a11y trio) and go silent for that a11y setting"
    )
    # It participates in the same `active()` gate as reduced-motion — both silence.
    code = _strip_comments(HAPTICS)
    m = re.search(r"function\s+active\s*\([^)]*\)\s*\{(.*?)\}", code, re.S)
    assert m, "orwellHaptics.js must define active()"
    body = m.group(1)
    assert "reducedMotion" in body and "reducedTransparency" in body, (
        "active() must gate on BOTH reduced-motion and reduced-transparency"
    )


# ── #738: an independent audio sub-toggle ──────────────────────────────────────
def test_audio_sub_toggle_key_present_and_independent():
    assert "orwell-haptics-audio" in HAPTICS, (
        "the chime must be independently mutable via 'orwell-haptics-audio'"
    )
    code = _strip_comments(HAPTICS)
    # The audio gate governs ONLY the tone: playTone is guarded by audioEnabled(),
    # but the vibration pulse is not (the buzz survives a muted chime).
    assert re.search(r"if\s*\(\s*audioEnabled\(\)\s*\)\s*playTone", code), (
        "playTone must be gated by audioEnabled() so the chime silences on its own"
    )
    fire = re.search(r"function\s+fire\s*\([^)]*\)\s*\{(.*?)\n  \}", code, re.S)
    assert fire, "orwellHaptics.js must define fire()"
    fbody = fire.group(1)
    assert "pulse(cue.vibe)" in fbody, "fire() must still pulse the vibration unconditionally"
    assert "audioEnabled" in fbody, "fire() must consult the audio sub-toggle"


def test_settings_exposes_audio_sub_toggle_via_js():
    assert "orwell-haptics-audio" in SETTINGS, "settings.js must persist the audio sub-toggle"
    assert 'data-haptics-key="beat-audio"' in SETTINGS, (
        "the audio sub-toggle must be JS-injected (no index.html edit)"
    )
    # JS-injected, never declared in index.html.
    assert "beat-audio" not in INDEX, "the audio sub-toggle must not be an index.html element"


# ── g15: no second orwell:gamechanged dispatcher introduced ────────────────────
def test_no_second_gamechanged_dispatcher():
    assert not re.search(r"new CustomEvent\(\s*['\"]orwell:gamechanged['\"]", HAPTICS), (
        "haptics must never dispatch orwell:gamechanged — it only LISTENS (g15 single "
        "dispatcher lives in platform.js)"
    )
    assert re.search(r"addEventListener\(\s*['\"]orwell:gamechanged['\"]", HAPTICS), (
        "the channel triggers off the existing debounced orwell:gamechanged event"
    )


# ── The new gating stays Vault-free ────────────────────────────────────────────
def test_new_gating_is_vault_free():
    code = _strip_comments(HAPTICS).lower()
    for forbidden in ("vault", "secret", "fetch(", "/api/orwell", "votes", "ballot"):
        assert forbidden not in code, (
            f"haptics gating must stay Vault-free — found '{forbidden}' in code"
        )
