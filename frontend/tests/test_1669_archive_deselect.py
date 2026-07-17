"""#1669 — archiving the ACTIVE session must deselect + abort it (option a).

Pre-existing latent issue surfaced by the #1638 session-menu kit migration: `_doArchive()`
(a behavior-identical port of the old archive click handler) did `fetch → loadSessions → toast`
but never cleared `currentSessionId` / aborted the in-flight stream the way `_doDelete()` does.
So archiving the session you were CURRENTLY viewing left the chat open/streaming after its sidebar
row disappeared. The owner ruling is OPTION (a): archiving the active session deselects it, mirroring
`_doDelete`'s active-session cleanup, so `loadSessions()` can't re-attach the archived chat.

Source-pinned convention check (the pytest lane has no DOM runtime): `_doArchive` performs the SAME
active-session cleanup `_doDelete` does — the `currentSessionId === s.id` guard, the guarded
`abortCurrentRequest`, `_deselectCurrentSession`, and `_skipAutoSelect = true` — and that cleanup runs
BEFORE the archive request's `loadSessions()`. Mirrors the source-pin style of test_1638_menu_popover_kit.py.
"""
import os
import re

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*p):
    with open(os.path.join(FRONTEND, *p), encoding="utf-8") as f:
        return f.read()


SESSIONS = _read("static", "js", "sessions.js")


def _fn_body(js, header):
    """The body of a `header … {` function up to (and including) the matching close brace."""
    start = js.index(header)
    i = js.index("{", start)
    depth = 0
    j = i
    while j < len(js):
        if js[j] == "{":
            depth += 1
        elif js[j] == "}":
            depth -= 1
            if depth == 0:
                return js[i:j + 1]
        j += 1
    raise AssertionError(f"could not bracket-match function: {header!r}")


ARCHIVE = _fn_body(SESSIONS, "async function _doArchive() {")
DELETE = _fn_body(SESSIONS, "async function _doDelete() {")


def test_archive_guards_on_the_active_session_like_delete():
    # the same active-session predicate _doDelete uses (currentSessionId === s.id).
    assert "currentSessionId === s.id" in ARCHIVE, \
        "_doArchive must detect the active session with the same check _doDelete uses"
    assert "currentSessionId === s.id" in DELETE, \
        "regression guard: _doDelete's active-session predicate moved — re-mirror it in _doArchive"


def test_archive_aborts_the_in_flight_stream_when_active():
    # mirror _doDelete's guarded abort: abort the stream only when archiving the active session.
    assert "window.chatModule.abortCurrentRequest()" in ARCHIVE, \
        "_doArchive must abort the in-flight stream (mirror _doDelete) when archiving the active session"
    assert "window.chatModule.abortCurrentRequest()" in DELETE, \
        "regression guard: _doDelete's stream abort moved — re-mirror it in _doArchive"


def test_archive_deselects_and_skips_autoselect_when_active():
    # clear the current selection (mirror _doDelete) so loadSessions() can't re-attach the archived chat…
    assert "_deselectCurrentSession(s.id)" in ARCHIVE, \
        "_doArchive must deselect the active session (mirror _doDelete's _deselectCurrentSession)"
    # …and skip the auto-select so it lands on the welcome screen, not another session.
    assert "_skipAutoSelect = true" in ARCHIVE, \
        "_doArchive must set _skipAutoSelect so loadSessions doesn't auto-jump to another session"
    for helper in ("_deselectCurrentSession(s.id)", "_skipAutoSelect = true"):
        assert helper in DELETE, \
            f"regression guard: _doDelete no longer does `{helper}` — re-mirror it in _doArchive"


def test_active_session_cleanup_runs_before_the_archive_request():
    # the abort/deselect/skip must precede the archive fetch() itself (which in turn precedes
    # loadSessions()) — cleanup moved after the fetch could let a lost-response retry or the
    # post-archive reload re-attach the archived chat, defeating #1669.
    fetch_at = ARCHIVE.index("/api/session/")   # the archive POST URL
    load_at = ARCHIVE.index("await loadSessions()")
    assert fetch_at < load_at, "sanity: the archive fetch() must precede loadSessions()"
    for op in ("window.chatModule.abortCurrentRequest()",
               "_deselectCurrentSession(s.id)",
               "_skipAutoSelect = true"):
        assert ARCHIVE.index(op) < fetch_at, \
            f"`{op}` must run BEFORE the archive fetch() so the archived chat isn't re-attached"
    # …and each cleanup op stays gated inside an active-session (wasCurrentSession) conditional —
    # a non-active archive must leave the current session untouched. Brace-matched, not "exists somewhere".
    assert re.search(r"const wasCurrentSession = currentSessionId === s\.id;", ARCHIVE), \
        "_doArchive must capture wasCurrentSession and gate the cleanup on it"
    guard_block = _fn_body(ARCHIVE, "if (wasCurrentSession) {")
    for op in ("_deselectCurrentSession(s.id)", "_skipAutoSelect = true"):
        assert op in guard_block, f"`{op}` must be gated inside the `if (wasCurrentSession)` block"
    abort_block = _fn_body(ARCHIVE, "if (wasCurrentSession &&")
    assert "abortCurrentRequest()" in abort_block, \
        "the in-flight stream abort must be gated on wasCurrentSession"
