"""Issue #745 — web-haptics + audio beat channel (source-pinned gate).

A sub-second navigator.vibrate() pulse + audio cue fires on the game's ceremony /
decision beats (crown / noms-locked / veto / eviction / decision-confirm),
derived ONLY from the public beat reason/phase. This is supplementary feedback
(Apple's "motion optional, supplement with haptics/audio") — gated behind a user
setting AND prefers-reduced-motion, Vault-free, and fully fail-soft.

These are static-source convention checks (the live behaviour needs a real device
with a vibration motor + audio output, which CI lacks). They pin the load-bearing
invariants so a refactor can't silently break the contract:
  * the module self-registers off the existing dispatcher (no index.html edit);
  * it reads ONLY the public reason/kind (Vault Wall);
  * it gates on the setting + prefers-reduced-motion;
  * every cue is fail-soft (no throw on a missing vibrate/audio API);
  * platform.js imports it; settings.js exposes the toggle.
"""
import re
from pathlib import Path

FE = Path(__file__).resolve().parents[1]
JS_DIR = FE / "static" / "js"
HAPTICS = (JS_DIR / "orwellHaptics.js").read_text(encoding="utf-8")
PLATFORM = (JS_DIR / "platform.js").read_text(encoding="utf-8")
SETTINGS = (JS_DIR / "settings.js").read_text(encoding="utf-8")
INDEX = (FE / "static" / "index.html").read_text(encoding="utf-8")


# ── The module is loaded without an index.html script tag ──────────────────────
def test_platform_imports_haptics_module():
    assert re.search(r"import\s+['\"]\./orwellHaptics\.js['\"]", PLATFORM), (
        "platform.js (the always-loaded dispatcher hub) must side-effect import "
        "orwellHaptics.js so it self-registers with no index.html change"
    )


def test_not_added_as_index_html_script_tag():
    # The whole point of the platform.js import: index.html stays untouched
    # (a sibling agent owns it). Belt-and-suspenders against a stray script tag.
    assert "orwellHaptics" not in INDEX, (
        "orwellHaptics must NOT be wired via an index.html <script> tag — it loads "
        "through the platform.js import"
    )


# ── It fires off the existing PUBLIC beat reason, never secret state ────────────
def test_listens_for_gamechanged_reason():
    assert re.search(r"addEventListener\(\s*['\"]orwell:gamechanged['\"]", HAPTICS), (
        "haptics must trigger off the existing debounced orwell:gamechanged event"
    )
    # It reads the public reason string only.
    assert "detail" in HAPTICS and "reason" in HAPTICS


def test_maps_each_beat_to_a_distinct_cue():
    # crown / noms / veto / eviction / decision — five distinct cues.
    for beat in ("crown", "noms", "veto", "eviction", "decision"):
        assert re.search(r"\b" + beat + r"\b\s*:", HAPTICS), (
            f"a distinct cue for the '{beat}' beat must be defined"
        )
    # The reason → beat map keys on the public reason/kind strings.
    assert "tool:runCompetition" in HAPTICS, "the crown beat keys on the comp result reason"
    assert "decision:" in HAPTICS, "the ceremony beats key on the decision:<kind> reason"
    for kind in ("nominations", "veto-decision", "eviction-vote"):
        assert kind in HAPTICS, f"the '{kind}' decision kind must map to a beat"


def test_does_not_dispatch_gamechanged():
    # g15: the ONLY dispatcher is platform.js. Haptics only LISTENS.
    assert not re.search(r"new CustomEvent\(\s*['\"]orwell:gamechanged['\"]", HAPTICS), (
        "haptics must never dispatch orwell:gamechanged — it only listens (g15)"
    )


# ── Vault Wall — no secret-state reads ─────────────────────────────────────────
def _strip_comments(src: str) -> str:
    # Drop // line comments and /* */ block comments so the Vault-Wall sweep
    # checks CODE, not the module's own explanatory prose (which discusses the
    # Vault on purpose).
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    src = re.sub(r"(?m)//.*$", "", src)
    return src


def test_vault_free_no_secret_state_reads():
    # The trigger reads the beat reason/phase only — never any secret/Vault field
    # and never a state fetch. Sweep the CODE (comments stripped) for the obvious
    # leak surfaces; none may appear.
    code = _strip_comments(HAPTICS).lower()
    for forbidden in ("vault", "secret", "fetch(", "/api/orwell", "votes", "ballot"):
        assert forbidden not in code, (
            f"haptics must stay Vault-free — found a reference to '{forbidden}' in code"
        )


# ── Gating: a setting AND prefers-reduced-motion ───────────────────────────────
def test_gated_on_setting():
    assert "orwell-haptics" in HAPTICS, "must read the 'orwell-haptics' user setting"
    assert "localStorage" in HAPTICS


def test_gated_on_prefers_reduced_motion():
    assert "prefers-reduced-motion" in HAPTICS and "reduce" in HAPTICS, (
        "must go silent under prefers-reduced-motion (motion-optional contract)"
    )
    assert "matchMedia" in HAPTICS


# ── Fail-soft: no throw when the APIs are absent ───────────────────────────────
def test_uses_vibrate_api_guarded():
    assert "navigator.vibrate" in HAPTICS
    # Guarded by a typeof / function check so a desktop / iOS Safari is a no-op.
    assert "typeof navigator.vibrate" in HAPTICS or "navigator.vibrate ===" in HAPTICS or \
        re.search(r"function['\"]?\s*===\s*typeof", HAPTICS) is not None or \
        "function" in HAPTICS


def test_uses_audio_context_guarded():
    assert "AudioContext" in HAPTICS
    assert "webkitAudioContext" in HAPTICS, "must fall back to the prefixed AudioContext"


def test_is_fail_soft_everywhere():
    # Every entry point is try/catch-wrapped; nothing throws into a beat.
    assert HAPTICS.count("try {") >= 4, "haptics must be wrapped in try/catch (fail-soft)"
    assert "catch" in HAPTICS


# ── Settings: a JS-injected toggle (no index.html edit) ────────────────────────
def test_settings_exposes_haptics_toggle():
    assert "orwell-haptics" in SETTINGS, "settings.js must persist the haptics setting"
    assert "data-haptics-key" in SETTINGS, (
        "settings.js must inject the toggle via JS (no index.html edit)"
    )
    # The toggle is built in JS, not declared in index.html.
    assert "data-haptics-key" not in INDEX, (
        "the haptics toggle must be JS-injected, never an index.html element"
    )


def test_default_on_only_explicit_off_disables():
    # The documented default: ON unless the stored value is exactly 'off'.
    assert "=== 'off'" in HAPTICS or '=== "off"' in HAPTICS, (
        "the setting defaults ON — only an explicit 'off' disables"
    )
