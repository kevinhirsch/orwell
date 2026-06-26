"""#985 (vector P2-C) — the cross-device "no response on this client" peer-resume fix.

Root cause: for a FRAMED game turn the server keys the run on the CANONICAL session and publishes
`run-started` THERE (chat_routes.py `run_key = ctx.canonical_session or session`). But a peer
browser's SSE EventSource was bound to its PER-TAB `currentSession()`, and sessionSync dropped any
event whose `data.session !== currentSession()`. A 2nd window whose session list hadn't yet converged
to the canonical id subscribed to the WRONG channel, never received `run-started`, never resumed — so
the first window's turn rendered NOWHERE on it (looked like "no response," though the backend replied
and the run is durable/resumable).

Fix (FE-only, sessionSync.js): in the GAME BUILD, subscribe to the CANONICAL game session's event
channel regardless of the per-tab `currentSession()` (resolved via the same READ-ONLY endpoint the
convergence ladder uses, GET /api/orwell/game-session), relax the `run-started` equality drop so an
un-converged peer on the canonical id reconciles + calls `resumeStream`, and converge the view onto
the canonical session first. Game-build-scoped; pre-game / no-game-bound falls back to per-tab.

The behavioral half runs the REAL sessionSync.js in Node against a DOM/EventSource/fetch stub — a true
fail-before/pass-after of the peer-resume path. The structural half pins the legs so a revert fails.
Roles only; no names.
"""

import json
import os
import shutil
import subprocess

import pytest

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATIC = os.path.join(FRONTEND, "static", "js")


def _read(*parts):
    with open(os.path.join(FRONTEND, *parts), encoding="utf-8") as f:
        return f.read()


# ── BEHAVIORAL — run the real sessionSync.js in Node ─────────────────────────────

# A self-contained harness: stub window/document (game build) + EventSource + fetch + the
# session/chat modules, load sessionSync.js (a classic IIFE → eval'd), then drive the peer scenario.
_HARNESS = r"""
globalThis.window = globalThis;
let _selected = [];            // sessionModule.selectSession() calls (the convergence record)
let _resumed = [];             // chatModule.resumeStream() calls
let _reloaded = [];            // chatModule.softReloadHistory() calls
let _esUrls = [];              // every EventSource URL we subscribe to
let _listeners = {};           // run-started/message-added/... listeners on the LIVE EventSource
let _tickCb = null;            // the setInterval(tick) callback, so the test can re-tick

const PER_TAB = "peer-per-tab-session";     // what THIS peer is viewing (NOT yet converged)
const CANON   = "canonical-game-session";   // the bound canonical game session the run rides on

// --- DOM stub: a game-build body, complete readyState (so start() runs immediately) ---
globalThis.document = {
  readyState: "complete",
  body: { dataset: { gameBuild: "1" }, hasAttribute: (a) => a === "data-game-build" },
  addEventListener() {},
};
globalThis.addEventListener = () => {};

// --- timers: capture the interval callback; setTimeout fires via the real loop ---
const _realSetTimeout = setTimeout;
globalThis.setInterval = (cb) => { _tickCb = cb; return 1; };
globalThis.setTimeout = (cb, ms) => _realSetTimeout(cb, ms);
globalThis.clearTimeout = () => {};

// --- fetch: GET /api/orwell/game-session → {sessionId: CANON} ---
globalThis.fetch = (url) => {
  if (String(url).indexOf("/api/orwell/game-session") !== -1) {
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ sessionId: CANON }) });
  }
  return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
};

// --- EventSource stub: record the URL; capture listeners on the canonical-channel socket ---
globalThis.EventSource = function (url) {
  _esUrls.push(url);
  this.readyState = 1;
  const onCanon = String(url).indexOf(encodeURIComponent(CANON)) !== -1;
  this.addEventListener = (type, fn) => { if (onCanon) (_listeners[type] = _listeners[type] || []).push(fn); };
  this.close = () => {};
};

// --- the FE modules the listener reuses ---
globalThis.window.sessionModule = {
  getCurrentSessionId: () => PER_TAB,                  // the peer is NOT on the canonical id
  selectSession: (id) => { _selected.push(id); return Promise.resolve(); },
};
globalThis.window.chatModule = {
  softReloadHistory: (id) => { _reloaded.push(id); return Promise.resolve(); },
  resumeStream: (id) => { _resumed.push(id); return Promise.resolve(true); },
  hasActiveStream: () => false,                        // peer is IDLE → should resume immediately
  deferPeerResume: (id) => {},
};

const fs = require("node:fs");
// `node -e <code> <modpath>` puts the extra arg at argv[1] (no script path in -e mode).
const _modPath = process.argv[1];
const src = fs.readFileSync(_modPath, "utf8");
(0, eval)(src);  // sessionSync.js IIFE — runs start() → tick() immediately

function flush() { return new Promise((r) => _realSetTimeout(r, 25)); }

(async () => {
  // tick 1 (from start()) kicks the canonical fetch; the id isn't resolved yet, so it binds per-tab.
  await flush();
  // tick again now that the canonical id has resolved → it must REBIND to the canonical channel.
  if (_tickCb) _tickCb();
  await flush();

  // The server publishes run-started on the CANONICAL session. Deliver it to the canonical socket's
  // run-started listener (simulating the peer receiving the invitation on the right channel).
  const fns = _listeners["run-started"] || [];
  for (const fn of fns) fn({ data: JSON.stringify({ session: CANON }) });
  await flush();
  await flush();

  process.stdout.write(JSON.stringify({
    esUrls: _esUrls,
    subscribedCanonical: _esUrls.some((u) => String(u).indexOf(encodeURIComponent(CANON)) !== -1),
    gotRunStartedListener: (_listeners["run-started"] || []).length > 0,
    selected: _selected,
    reloaded: _reloaded,
    resumed: _resumed,
  }));
})();
"""


def test_unconverged_peer_subscribes_canonical_and_resumes_the_run():
    """The end-to-end behavioral proof: a peer whose `currentSession()` != canonical id, given a
    `run-started` published on the canonical id, SUBSCRIBES to the canonical channel, converges its
    view, reconciles, and calls `resumeStream(canonical)` — instead of dropping the event (the old
    behavior, which produced "no response on this client").
    """
    node = shutil.which("node")
    if not node:
        pytest.skip("node not available for the behavioral peer-resume check")
    mod = os.path.join(STATIC, "sessionSync.js")
    proc = subprocess.run(
        [node, "-e", _HARNESS, mod],
        capture_output=True, text=True, timeout=30,
    )
    assert proc.returncode == 0, f"node failed: {proc.stderr}"
    out = json.loads(proc.stdout)

    # The peer must end up subscribed to the CANONICAL game session's event channel (not only per-tab).
    assert out["subscribedCanonical"], \
        f"the game-build peer must subscribe to the canonical channel — saw {out['esUrls']}"
    assert out["gotRunStartedListener"], "the canonical socket must wire a run-started listener"
    # It converges its view onto the canonical session (so the run renders where the player can see it).
    assert "canonical-game-session" in out["selected"], \
        "an un-converged peer must converge its view onto the canonical session"
    # It reconciles the just-persisted user turn AND resumes the live reply on the canonical id.
    assert "canonical-game-session" in out["reloaded"], "the peer must reconcile the canonical history"
    assert "canonical-game-session" in out["resumed"], \
        "THE FIX: the peer must resume the canonical run (instead of dropping the run-started)"


def test_pre_game_peer_falls_back_to_per_tab_no_canonical_resume():
    """Fail-open guard: when NO game is bound (the endpoint returns no sessionId), the peer must keep
    the original per-tab behavior — subscribe to its own session and NOT hijack onto a phantom
    canonical id. Proves the fix is scoped and never regresses the non-game / pre-game path."""
    node = shutil.which("node")
    if not node:
        pytest.skip("node not available")
    # Reuse the harness but make the game-session endpoint return an EMPTY binding.
    harness = _HARNESS.replace(
        'return Promise.resolve({ ok: true, json: () => Promise.resolve({ sessionId: CANON }) });',
        'return Promise.resolve({ ok: true, json: () => Promise.resolve({ sessionId: null }) });',
    )
    mod = os.path.join(STATIC, "sessionSync.js")
    proc = subprocess.run([node, "-e", harness, mod], capture_output=True, text=True, timeout=30)
    assert proc.returncode == 0, f"node failed: {proc.stderr}"
    out = json.loads(proc.stdout)
    # With no canonical id, the peer subscribes to its PER-TAB session only; the canonical run-started
    # never reaches it (no canonical socket), so it never spuriously resumes a foreign session.
    assert not out["subscribedCanonical"], "no game bound → must NOT subscribe to a phantom canonical id"
    assert "per-tab" in (out["esUrls"][0] if out["esUrls"] else ""), \
        f"pre-game falls back to the per-tab channel — saw {out['esUrls']}"
    assert out["resumed"] == [], "pre-game must not resume any canonical run"


# ── STRUCTURAL — pin the legs so a revert fails ──────────────────────────────────

def test_session_sync_resolves_canonical_via_the_shared_readonly_endpoint():
    src = _read("static", "js", "sessionSync.js")
    # Resolve the canonical id via the SAME endpoint the convergence ladder uses (READ-ONLY).
    assert "/api/orwell/game-session" in src, "must resolve the canonical id via the shared endpoint"
    assert "function canonicalSession()" in src and "function refreshCanonical()" in src
    # The subscription target prefers the canonical game session in the game build.
    assert "function desiredSession()" in src
    assert "tick()" not in src or "refreshCanonical();" in src, "tick must keep the canonical id fresh"


def test_session_sync_is_game_build_scoped_and_fail_open():
    src = _read("static", "js", "sessionSync.js")
    assert "function gameBuildOn()" in src, "the fix must be game-build scoped"
    # desiredSession falls back to currentSession() (the original) when no canonical id is resolved.
    assert "return currentSession();" in src, "fail-open: fall back to the per-tab session"


def test_session_sync_accepts_canonical_event_and_converges_before_resume():
    src = _read("static", "js", "sessionSync.js")
    # The relaxed gate: accept the per-tab session OR the canonical game session.
    assert "function isWatchedSession(id)" in src
    assert "if (!isWatchedSession(id)) return;" in src, \
        "the old strict `id !== currentSession()` drop must be replaced by the canonical-aware gate"
    # The run-started path converges the view, then resumes (with the double-resume guard intact).
    assert "function convergeView(id)" in src
    assert "convergeView(id).then(" in src, "an un-converged peer converges its view before resuming"
    assert "cm.resumeStream(id);" in src, "the idle fast path still resumes the canonical run live"
    assert "if (cm.hasActiveStream && cm.hasActiveStream(id)) {" in src, \
        "the double-resume guard (defer when our own stream is live) must stay"


def test_session_sync_listens_for_gamechanged_but_never_dispatches_it():
    """g15: the canonical-id cache may only LISTEN for orwell:gamechanged (platform.js is the ONE
    dispatcher); it must never `new CustomEvent('orwell:gamechanged')`."""
    src = _read("static", "js", "sessionSync.js")
    assert "window.addEventListener('orwell:gamechanged'" in src, "drop the cached canonical id on a game change"
    assert "new CustomEvent('orwell:gamechanged'" not in src
    assert 'new CustomEvent("orwell:gamechanged"' not in src
