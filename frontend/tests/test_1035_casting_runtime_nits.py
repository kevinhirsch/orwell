"""#1035 — casting/runtime nits from the 2026-06-26 live-verify debug export.

Three small, independent runtime/UX fixes observed on the live deepseek run:

* F-8 — 404 poll spam. The FE polled `GET /api/research/status/<sid>` (29×) and
  `GET /api/chat/stream_status/<sid>` (27×), ~one pair per turn, all 404. Deep research is a
  DROPPED vertical under the game build, so its status poll can only ever 404 → it is skipped in
  the game build (`checkPendingResearch`). The stream-status probe exists to re-attach a stream
  detached by a PAGE RELOAD; it now fires once per session per page-load instead of on every
  in-app session switch (a stream started in-page is tracked locally).

* F-10 — double `prewarm-cast` fire. `route()` kicks `_orwellWarm("prewarm-cast")` and re-runs on
  every `orwell:models-changed`, so a single pre-game load fired the author-warm TWICE (~28s
  apart). The server endpoint is idempotent, but the trigger now carries a per-load once-guard,
  re-armed on a genuine restart/new-season (`_orwellMarkRestart`).

* F-6 — cast-photo CTA gating. `castPhoto` is OPTIONAL (the engine never counts it toward
  `finalizable`) yet tops the engine's raw `missing` list, so the casting-incomplete steer told the
  model "we still need their cast photo" — making the headshot read as a hard gate. The steer now
  drops `castPhoto` from the gap it asks the model to demand.

Name-agnostic. JS fixes are source-pinned; the Python steer is exercised directly (fail-before/
pass-after).
"""
import importlib
from pathlib import Path

agent_loop = importlib.import_module("src.agent_loop")

FE = Path(__file__).resolve().parents[1]
JS_DIR = FE / "static" / "js"
CHAT = (JS_DIR / "chat.js").read_text(encoding="utf-8")
SESSIONS = (JS_DIR / "sessions.js").read_text(encoding="utf-8")
ONBOARDING = (JS_DIR / "orwellOnboarding.js").read_text(encoding="utf-8")


# ── F-8: inapplicable 404 polls are gated ───────────────────────────────────────── #

def test_research_poll_skips_in_game_build():
    """`checkPendingResearch` returns early under the game build BEFORE issuing the
    /api/research/status fetch (research is a dropped vertical → only ever 404s)."""
    fn = CHAT[CHAT.index("export async function checkPendingResearch("):]
    fn = fn[: fn.index("\n  }")]  # the function body
    guard = "document.body.hasAttribute('data-game-build')"
    fetch = "fetch(`${API_BASE}/api/research/status/"
    assert guard in fn, "research poll must be gated on the game build"
    assert fetch in fn, "the research fetch should still exist for the full workspace"
    # the game-build early-return must precede the fetch
    assert fn.index(guard) < fn.index(fetch), "the game-build guard must short-circuit before the fetch"


def test_server_stream_probe_fires_once_per_session_per_load():
    """`_checkServerStream` only probes /api/chat/stream_status once per session per page-load —
    a refresh-detached stream is what it recovers; re-probing on every in-app switch was the 404 spam."""
    assert "const _serverStreamProbed = new Set();" in SESSIONS
    fn = SESSIONS[SESSIONS.index("async function _checkServerStream("):]
    fn = fn[: fn.index("\nasync function ") if "\nasync function " in fn else len(fn)]
    body = fn[: fn.index("stream_status")]  # everything before the actual probe fetch
    assert "if (_serverStreamProbed.has(sessionId)) return;" in body
    assert "_serverStreamProbed.add(sessionId);" in body
    # the once-guard must precede the stream_status fetch
    assert body.index("_serverStreamProbed.add(sessionId);") < fn.index("stream_status")


# ── F-10: the prewarm-cast trigger is deduped ───────────────────────────────────── #

def test_prewarm_author_warm_has_a_once_guard():
    """`_orwellWarm('prewarm-cast')` is collapsed to a single fire per pre-game load by a guard
    that is set on fire and re-armed on a genuine restart."""
    fn = ONBOARDING[ONBOARDING.index("function _orwellWarm("):]
    fn = fn[: fn.index("\n  }")]
    assert 'if (path === "prewarm-cast")' in fn
    assert "if (_authorWarmKicked) return;" in fn
    assert "_authorWarmKicked = true;" in fn
    # the guard check must precede the fetch so the second call short-circuits
    assert fn.index("if (_authorWarmKicked) return;") < fn.index("fetch(")


def test_prewarm_guard_is_rearmed_on_restart():
    """A new season has a fresh cast — the once-guard is cleared on `_orwellMarkRestart` so route()
    warms the next season exactly once."""
    assert "let _authorWarmKicked = false;" in ONBOARDING
    assert "function _resetAuthorWarmGuard()" in ONBOARDING
    mark = ONBOARDING[ONBOARDING.index("window._orwellMarkRestart = () => {"):]
    mark = mark[: mark.index("\n  };")]
    assert "_resetAuthorWarmGuard()" in mark, "the restart hook must re-arm the author-warm"


# ── F-6: castPhoto is dropped from the casting-incomplete steer gap ──────────────── #

def test_casting_steer_omits_optional_cast_photo():
    """castPhoto is optional and never gates finalize — the steer must NOT tell the model the season
    is blocked on the cast photo (fail-before/pass-after)."""
    steer = agent_loop._casting_incomplete_steer(["castPhoto", "backstory", "motivation"])
    low = steer.lower()
    assert "photo" not in low, "the optional cast photo must not appear as a still-needed gap"
    # the genuine required gaps still surface
    assert "backstory" in low
    assert "why they came" in low  # the motivation label


def test_casting_steer_castphoto_only_falls_back_to_generic_gap():
    """If castPhoto were the only entry in `missing`, dropping it must NOT name 'castPhoto' — it
    degrades to the neutral fallback (a refused finalize is never about the optional photo)."""
    steer = agent_loop._casting_incomplete_steer(["castPhoto"])
    assert "castPhoto" not in steer
    assert "photo" not in steer.lower()
    assert "a required casting detail they haven't given yet" in steer
