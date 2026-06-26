"""#967 — first-run casting cold-start: the producers' opener must fire EVERY time.

Root cause (confirmed, not re-investigated here): the producers' opening message only fires via an
FE-driven hidden-cue turn, gated on the onboarding re-route that rides `orwell:models-changed`
(orwellOnboarding.js `_reRouteAfterModelConfig` → `route()`). Two seams broke the trigger after the
player "enabled API access" and closed Settings:

  (1) The endpoint ENABLE/DISABLE toggle (admin.js) refreshed the model list UNFORCED
      (loadEndpoints → refreshModels() with no `force`). refreshModels only fetches when
      `needsFetch = force || cache-empty || TTL-expired`, and only fires `orwell:models-changed`
      on a genuine none→some transition *after a fetch*. If the models were already scanned
      (warm cache) while the endpoint was disabled, `needsFetch` was false → no fetch → no event →
      the onboarding never re-routed → the wizard never mounted → the kickoff never fired.

  (2) Settings `close()` only cleared a dim class + closed the window — it was never itself a
      trigger, so "closing Settings" did nothing to re-evaluate onboarding.

Belt-and-suspenders fix (this PR):
  (a) admin.js — the enable/disable toggle force-refreshes the model list so the none→some edge is
      observed and `orwell:models-changed` fires on ENABLE.
  (b) settings.js — `close()` re-dispatches `orwell:models-changed` on the game build so closing
      Settings re-evaluates onboarding regardless of whether the none→some edge was observed (the
      more robust belt, reusing the existing onboarding re-route path — not a new event, and NOT a
      g15 `orwell:gamechanged` dispatch).

These are wiring pins (JS-as-text) PLUS one behavioral node check of the warm-cache gate that proves
why `force` is required. No fixture names — roles only.
"""

import os
import json
import shutil
import tempfile
import subprocess

import pytest

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*parts):
    with open(os.path.join(FRONTEND, *parts), encoding="utf-8") as f:
        return f.read()


# ── belt (a): the enable/disable toggle FORCES a refresh so none→some is observed ───────────

def test_a_toggle_handler_force_refreshes_models():
    js = _read("static", "js", "admin.js")
    # isolate the endpoint enable/disable toggle handler
    anchor = js.index("[data-adm-toggle-ep]")
    seg = js[anchor: anchor + 1400]
    # it PATCHes the endpoint (the enable/disable action) ...
    assert "/api/model-endpoints/" in seg and "method: 'PATCH'" in seg
    # ... then forces a model refresh so refreshModels actually fetches and can observe the
    # none→some transition that fires orwell:models-changed.
    assert "refreshModels(true)" in seg, (
        "the enable/disable toggle must force-refresh the model list so the none→some edge "
        "is observed (an unforced refresh skips the fetch on a warm cache → no event → no kickoff)"
    )
    # it still reloads the endpoint list afterwards
    assert "loadEndpoints()" in seg


def test_a_force_refresh_is_scoped_to_the_toggle_not_a_blanket_change():
    # The fix must be precise: it lives in the toggle handler, and the toggle references #967.
    js = _read("static", "js", "admin.js")
    assert "#967" in js, "the toggle fix should be commented with the issue ref for traceability"
    # the comment lives next to the toggle handler force-refresh, not elsewhere
    idx967 = js.index("#967")
    nearby = js[idx967: idx967 + 1400]
    assert "refreshModels(true)" in nearby


# ── belt (b): closing Settings re-evaluates onboarding via the existing re-route event ──────

def test_b_settings_close_redispatches_models_changed_on_game_build():
    js = _read("static", "js", "settings.js")
    close_fn = js[js.index("export function close()"):]
    close_fn = close_fn[: close_fn.index("\n}")]
    # gated on the game build (don't fire the onboarding re-route in the full workspace build)
    assert "data-game-build" in close_fn
    # re-dispatches the SAME event the onboarding listens for (reuse the re-route path; don't
    # duplicate route logic, don't invent a new event)
    assert "orwell:models-changed" in close_fn
    assert "dispatchEvent" in close_fn
    assert "#967" in close_fn


def test_b_settings_close_does_not_ad_hoc_dispatch_gamechanged():
    # g15: the ONLY orwell:gamechanged dispatcher is orwellGameChanged() in platform.js. The #967
    # belt must NOT add an ad-hoc gamechanged dispatch — it reuses orwell:models-changed instead.
    js = _read("static", "js", "settings.js")
    close_fn = js[js.index("export function close()"):]
    close_fn = close_fn[: close_fn.index("\n}")]
    assert "orwell:gamechanged" not in close_fn, (
        "closing Settings must NOT ad-hoc dispatch orwell:gamechanged (g15); reuse "
        "orwell:models-changed for the onboarding re-route"
    )


def test_b_reuses_existing_onboarding_reroute_path():
    # The event we re-dispatch is exactly the one orwellOnboarding.js already binds to its
    # re-route (_reRouteAfterModelConfig → route()). This pins that the belt reuses the existing
    # path rather than duplicating route logic.
    onb = _read("static", "js", "orwellOnboarding.js")
    assert 'addEventListener("orwell:models-changed"' in onb
    assert "_reRouteAfterModelConfig" in onb
    seg = onb[onb.index("function _reRouteAfterModelConfig"):]
    seg = seg[: seg.index("\n  }")]
    assert "route()" in seg


# ── behavioral: the warm-cache gate proves WHY belt (a) needs force ──────────────────────────
#
# Reconstruct refreshModels()'s `needsFetch` decision from the REAL source (constant + expression)
# and prove: with a WARM cache (non-empty items, recent fetch) an UNFORCED refresh skips the fetch
# (needsFetch === false) — so it can never observe the none→some edge or fire the event — whereas a
# FORCED refresh always fetches. This is the exact mechanism the toggle fix relies on.


def _needsfetch_constant_and_expr():
    js = _read("static", "js", "models.js")
    # pull the real TTL constant
    ttl_line = next(l for l in js.splitlines() if "_FETCH_CACHE_TTL =" in l and "const" in l)
    ttl = ttl_line.split("=")[1].split(";")[0].strip()
    # pull the real needsFetch expression
    expr_line = next(l for l in js.splitlines() if "const needsFetch =" in l)
    expr = expr_line.split("=", 1)[1].split(";")[0].strip()
    return ttl, expr


def _run_needsfetch(force, cached_len, last_fetch_age_ms):
    """Evaluate the REAL needsFetch expression under node with a controlled cache state."""
    ttl, expr = _needsfetch_constant_and_expr()
    harness = (
        f"const _FETCH_CACHE_TTL = {ttl};\n"
        f"const force = {json.dumps(bool(force))};\n"
        f"const _cachedItems = new Array({int(cached_len)}).fill(0);\n"
        "const now = 1000000;\n"
        f"const _lastFetchTime = now - {int(last_fetch_age_ms)};\n"
        f"const needsFetch = {expr};\n"
        "console.log(JSON.stringify(needsFetch));\n"
    )
    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False) as f:
        f.write(harness)
        path = f.name
    try:
        res = subprocess.run(["node", path], capture_output=True, text=True, timeout=20)
    finally:
        os.unlink(path)
    assert res.returncode == 0, res.stderr
    return json.loads(res.stdout.strip().splitlines()[-1])


def test_warm_cache_unforced_refresh_skips_fetch():
    if shutil.which("node") is None:
        pytest.skip("node not available")
    # WARM cache: already has models, fetched 1s ago (well within the 30s TTL). An UNFORCED refresh
    # must NOT fetch — this is precisely the state that left the kickoff un-fired (#967).
    assert _run_needsfetch(force=False, cached_len=3, last_fetch_age_ms=1000) is False


def test_warm_cache_forced_refresh_does_fetch():
    if shutil.which("node") is None:
        pytest.skip("node not available")
    # The belt (a) fix passes force=true → the refresh fetches even on a warm cache, so the
    # none→some transition is observed and orwell:models-changed fires.
    assert _run_needsfetch(force=True, cached_len=3, last_fetch_age_ms=1000) is True


def test_cold_cache_fetches_even_unforced():
    if shutil.which("node") is None:
        pytest.skip("node not available")
    # Sanity: an empty cache always fetches (the original none→some path that DID work).
    assert _run_needsfetch(force=False, cached_len=0, last_fetch_age_ms=1000) is True


def test_models_changed_fires_only_on_none_to_some_edge():
    # Pin the none→some guard in models.js (the event must not fire spuriously, e.g. on
    # disable/some→none). belt (a) relies on this: forcing a fetch when DISABLING is harmless
    # because the some→none direction does not satisfy the guard.
    js = _read("static", "js", "models.js")
    assert "_modelsAvailable" in js
    assert "_hadModelsBefore" in js
    # the dispatch is guarded by (!had && now-has)
    seg = js[js.index("_hadModelsBefore"):]
    seg = seg[: seg.index("orwell:models-changed") + 40]
    assert "!_hadModelsBefore" in seg and "_modelsAvailable(_cachedItems)" in seg
