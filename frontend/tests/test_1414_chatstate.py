"""#1414 (R3 PR0) — the chatState.js enabler for decomposing the chat.js god-object.

chat.js (~7,600 LOC) is being split into focused modules (docs/REFACTOR-ROADMAP.md, R3). The
blocker for every later extraction: chat.js's cross-cluster module-level mutable state (streaming
flags, the send outbox, the reconcile sets, background-stream maps, the single-flight guards) is
mutated from every cluster, and an ES-module imported binding is READ-ONLY — you cannot
`import { isStreaming }` from a sibling module and reassign it. PR0 introduces ONE shared mutable
singleton (`chatState`) that every future fragment mutates by FIELD, so the guards resolve to the
SAME instance across the submit/outbox/reconcile paths.

PR0 is behavior-preserving and mechanical: no functions move out of chat.js; chat.js just
references `chatState.X` where it used to reference the bare `X`. This gate pins:
  1. chatState.js exports the `chatState` singleton and is dual-load idempotent (#1399 generalized);
  2. chatState.js is imported by chat.js only — NOT app.js / any html shell — so it piggybacks on
     chat.js's single evaluation path (the #1399 invariant is not weakened);
  3. chat.js declares NO module-level let/const/var for any moved var (the declarations are gone);
  4. chat.js consumes the singleton — every moved var is referenced as `chatState.X`;
  5. the single-flight guards (isStreaming, _sendInFlight, _flushingOutbox, _outboxRestoreDone)
     route through chatState (same instance ⇒ re-entrancy actually serializes);
  6. the public chatModule export surface still carries the moved names (byte-identical API).
"""
import re
from pathlib import Path

FE = Path(__file__).resolve().parents[1]
STATIC = FE / "static"
CHAT_JS = (STATIC / "js" / "chat.js").read_text(encoding="utf-8")
CHATSTATE_JS = (STATIC / "js" / "chatState.js").read_text(encoding="utf-8")
APP_JS = (STATIC / "app.js").read_text(encoding="utf-8")
ALL_HTML = sorted(STATIC.rglob("*.html"))

# #1414 R3 (PR6+): as chat.js decomposes into focused sibling modules (chatOutbox.js, …), a moved
# var's SOLE consumer can move OUT of chat.js while still resolving to the ONE shared chatState
# instance. The "consumed through the singleton" checks below therefore scan the whole chat.js module
# GRAPH (chat.js + every chat*.js sibling), not chat.js alone — the shared-instance guarantee is
# unchanged; only the file that holds a given consumer moved (e.g. the outbox's _flushingOutbox /
# _outboxRestoreDone reads/writes now live in chatOutbox.js).
CHAT_GRAPH_JS = "\n".join(
    p.read_text(encoding="utf-8") for p in sorted((STATIC / "js").glob("chat*.js"))
)

# The full set of module-level mutable state relocated to chatState in PR0.
MOVED_VARS = [
    "isStreaming", "currentAbort", "_sendInFlight", "_streamSessionId", "_displayOverride",
    "_hideUserBubble", "_pendingContinue", "_autoNudges", "_autoContinuePending", "_sendOutbox",
    "_outboxAwaitingConfirm", "_outboxFailed", "_pendingReconcile", "_pendingPeerResume",
    "_forceRebuild", "_backgroundStreams", "_resumingStreams", "_researchingStreamIds",
    "_flushingOutbox", "_outboxRestoreDone",
]

# The single-flight / re-entrancy guards that MUST resolve to one shared instance.
SINGLE_FLIGHT_GUARDS = ["isStreaming", "_sendInFlight", "_flushingOutbox", "_outboxRestoreDone"]


def _strip_line_comments(src: str) -> str:
    """Drop // line-comments (keep code) so a comment mentioning `let _sendOutbox` in prose
    can't false-match the declaration sweep. Block comments never carry a bare declaration here."""
    out = []
    for line in src.splitlines():
        # naive but sufficient: cut at the first // that isn't inside a trivial string.
        # For the declaration sweep we only need to not be fooled by leading-// pointer comments.
        stripped = line.lstrip()
        if stripped.startswith("//") or stripped.startswith("*"):
            continue
        out.append(line)
    return "\n".join(out)


def test_chatstate_module_exports_the_singleton():
    assert re.search(r"export\s+const\s+chatState\b", CHATSTATE_JS), (
        "chatState.js must `export const chatState` — the ONE shared mutable-state object."
    )
    # It must hold every moved field (initialized on the object literal).
    missing = [v for v in MOVED_VARS if not re.search(rf"\b{re.escape(v)}\s*:", CHATSTATE_JS)]
    assert not missing, f"chatState singleton is missing fields: {missing}"


def test_chatstate_is_dual_load_idempotent():
    # #1399 generalized: a second evaluation must reuse the first instance, not clobber live
    # queues/flags. Guarded via a window-scoped handle.
    assert "window.__orwellChatState" in CHATSTATE_JS, (
        "chatState.js must guard against a double-eval (window.__orwellChatState) so a second "
        "load reuses the live instance rather than resetting the outbox/flags."
    )


def test_chatstate_imported_only_by_chat_js():
    # chatState piggybacks on chat.js's single eval path (#1399). chat.js imports it once…
    imports = re.findall(r"import\s*\{[^}]*\bchatState\b[^}]*\}\s*from\s*['\"]\./chatState\.js['\"]", CHAT_JS)
    assert len(imports) == 1, f"chat.js must import chatState exactly once — found {len(imports)}."
    # …and nothing else evaluates it: no app.js import, no html <script>.
    assert "chatState.js" not in APP_JS, "app.js must NOT import chatState.js (chat.js owns the import)."
    offenders = [f.name for f in ALL_HTML if "chatState.js" in f.read_text(encoding="utf-8")]
    assert not offenders, f"no html shell may load chatState.js (chat.js owns it): {offenders}"


def test_chat_js_declares_no_moved_var_module_level():
    code = _strip_line_comments(CHAT_JS)
    leftovers = []
    for v in MOVED_VARS:
        # a module-level declaration is `let/const/var X` at low indentation (<=2 spaces).
        if re.search(rf"(?m)^\s{{0,4}}(let|const|var)\s+{re.escape(v)}\b", code):
            leftovers.append(v)
    assert not leftovers, (
        f"these vars still have a bare declaration in chat.js — they moved to chatState: {leftovers}. "
        "A leftover `let X` shadows the singleton and breaks the shared-instance guarantee."
    )


def test_chat_js_consumes_the_singleton():
    # Every moved var is referenced through the singleton somewhere in the chat.js module GRAPH
    # (chat.js + its extracted chat*.js siblings — PR6 moved the outbox's _flushingOutbox /
    # _outboxRestoreDone consumers into chatOutbox.js, still one shared chatState instance).
    unused = [v for v in MOVED_VARS if f"chatState.{v}" not in CHAT_GRAPH_JS]
    assert not unused, f"the chat module graph never references chatState.<var> for: {unused}"


def test_single_flight_guards_route_through_chatstate():
    # #1414 R3 PR6: the outbox guards (_flushingOutbox / _outboxRestoreDone) are consumed in
    # chatOutbox.js now, so resolve these against the chat.js module GRAPH — the shared-instance
    # guarantee is unchanged (one chatState), only the consuming file moved.
    code = _strip_line_comments(CHAT_GRAPH_JS)
    for g in SINGLE_FLIGHT_GUARDS:
        assert f"chatState.{g}" in CHAT_GRAPH_JS, (
            f"single-flight guard {g!r} must resolve through chatState.{g} so submit/outbox/reconcile "
            "share ONE instance (re-entrancy must actually serialize)."
        )
        # And there is no bare, un-namespaced assignment left anywhere in the graph (a dangling ref).
        assert not re.search(rf"(?<![.\w]){re.escape(g)}\s*=(?!=)", code), (
            f"a bare `{g} = …` assignment remains in the chat module graph — every write must go "
            "through chatState."
        )


def test_public_chatmodule_export_surface_preserved():
    # The outbox collections stay exported by their ORIGINAL names (byte-identical public API),
    # now sourced from the singleton.
    for name in ("_sendOutbox", "_outboxAwaitingConfirm", "_outboxFailed"):
        assert re.search(rf"\b{name}\s*:\s*chatState\.{name}\b", CHAT_JS), (
            f"chatModule must still export {name!r} (now `= chatState.{name}`) — public API is byte-identical."
        )
    # The test hooks keep their names and read/write the singleton.
    assert re.search(r"_isStreaming\s*:\s*\(\)\s*=>\s*chatState\.isStreaming", CHAT_JS), (
        "_isStreaming hook must read chatState.isStreaming."
    )
    assert "_setStreamStateForTest" in CHAT_JS and "_setOutboxDispatch" in CHAT_JS, (
        "the browser-gate test hooks must remain exported."
    )
