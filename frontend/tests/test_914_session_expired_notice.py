"""#914 — a mid-session 401 must not silently redirect and drop the player's live context.

First-run → end-of-day-1 audit finding L7: `GET /api/orwell/state → 401` mid-session forced
a silent redirect to `/login` with no "you've been logged out" notice, and no attempt to
preserve the in-flight composer draft against the debounced-save race.

The fix (static, source-pinned; no running engine — same convention as test_g17_composer_draft.py):

  * `static/app.js`'s global fetch wrapper, on a mid-session 401, now (1) flushes the
    composer draft synchronously via a new `_orwellComposerDraftFlush` seam BEFORE
    navigating (the debounced save would otherwise lose a very recent keystroke to the
    immediate `location.href =`), (2) leaves a one-shot `sessionStorage` flag for the
    login page, and only then redirects. It also skips once already on `/login` (no
    redirect loop).
  * `static/js/orwellComposerDraft.js` exposes `window._orwellComposerDraftFlush = saveNow`
    — an immediate (non-debounced) flush of the SAME record `orwellComposerDraft.js`
    already restores on the next boot (G17/#914 compose, they don't duplicate storage).
  * `static/login.html` reads that one-shot flag on load, renders an honest "you've been
    signed out" notice (role="status", not role="alert" — it isn't the player's fault),
    and clears the flag immediately so a plain visit/reload of /login never shows it again.

"Return the player to where they were" needs no separate mechanism: the composer draft
(sessionStorage) and the last-open session id (`Storage` 'lastSessionId', localStorage) are
untouched by this redirect (this fix doesn't clear either), so re-authenticating already
resumes the same session with the same draft restored — the pre-existing G17 composer-draft
restore-on-boot and the sessions.js `lastSessionId` resolution ladder do that work.
"""

import os

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATIC = os.path.join(FRONTEND, "static")
STATIC_JS = os.path.join(STATIC, "js")


def _read(*parts) -> str:
    with open(os.path.join(FRONTEND, *parts), encoding="utf-8") as f:
        return f.read()


APP_JS = _read("static", "app.js")
DRAFT_JS = _read("static", "js", "orwellComposerDraft.js")
LOGIN_HTML = _read("static", "login.html")


# ── 1. app.js: the fetch wrapper flushes the draft + flags the notice BEFORE redirecting ──

def test_fetch_wrapper_still_redirects_on_a_mid_session_401():
    assert "res.status === 401" in APP_JS
    assert "window.location.href = '/login'" in APP_JS
    # auth endpoints themselves must stay excluded (a failed login attempt is not a
    # mid-session expiry) — the original guard survives unchanged.
    assert "!String(args[0]).includes('/api/auth/')" in APP_JS


def test_fetch_wrapper_never_redirect_loops_from_login_itself():
    # New guard: a 401 that somehow fires while already on /login must not re-trigger the
    # notice-flag + redirect dance.
    assert "!window.location.pathname.startsWith('/login')" in APP_JS


def test_fetch_wrapper_flushes_the_composer_draft_before_navigating():
    handler = APP_JS[APP_JS.index("window.fetch = async function"):]
    handler = handler[:handler.index("\n};") + 3]
    assert "_orwellComposerDraftFlush" in handler
    i_flush = handler.index("_orwellComposerDraftFlush")
    i_redirect = handler.index("window.location.href = '/login'")
    assert i_flush < i_redirect, \
        "the draft must be flushed BEFORE the navigation fires, not after"


def test_fetch_wrapper_leaves_a_one_shot_notice_flag_before_navigating():
    handler = APP_JS[APP_JS.index("window.fetch = async function"):]
    handler = handler[:handler.index("\n};") + 3]
    assert "sessionStorage.setItem('orwell-session-expired-notice'" in handler
    i_flag = handler.index("sessionStorage.setItem('orwell-session-expired-notice'")
    i_redirect = handler.index("window.location.href = '/login'")
    assert i_flag < i_redirect, \
        "the flag must be set BEFORE the navigation fires, or the login page can't see it"


def test_fetch_wrapper_never_throws_if_the_draft_module_is_absent():
    # A degraded/headless page (no orwellComposerDraft.js loaded) must not break the 401
    # handler itself — the flush call is optionally-chained/guarded.
    handler = APP_JS[APP_JS.index("window.fetch = async function"):]
    handler = handler[:handler.index("\n};") + 3]
    assert "window._orwellComposerDraftFlush &&" in handler or \
           "window._orwellComposerDraftFlush?." in handler


# ── 2. orwellComposerDraft.js: the new flush seam is the SAME save path G17 already uses ──

def test_flush_seam_is_exposed_and_reuses_the_existing_immediate_save():
    assert "window._orwellComposerDraftFlush = saveNow;" in DRAFT_JS
    # saveNow already exists (G17) as the non-debounced write; #914 doesn't invent a
    # second storage path, it just exposes the existing one as a public seam.
    assert "function saveNow()" in DRAFT_JS


def test_flush_seam_sits_alongside_the_other_public_seams():
    # Same neighbourhood as the pre-existing clear/peek seams, not scattered elsewhere.
    tail = DRAFT_JS[DRAFT_JS.index("window._orwellComposerDraftClear"):]
    assert "window._orwellComposerDraftFlush" in tail[:600]


# ── 3. login.html: the one-shot notice, rendered honestly and cleared immediately ─────

def test_login_reads_and_clears_the_flag_as_one_shot():
    i_get = LOGIN_HTML.index("sessionStorage.getItem('orwell-session-expired-notice')")
    i_remove = LOGIN_HTML.index("sessionStorage.removeItem('orwell-session-expired-notice')")
    # Removed right after being read (before the notice paints), so a reload of /login,
    # a fresh tab, or an explicit-logout visit never resurfaces a stale flag.
    assert i_get < i_remove < i_get + 300


def test_login_notice_copy_is_honest_and_actionable():
    assert "You've been signed out" in LOGIN_HTML
    assert "sign back in" in LOGIN_HTML.lower() or "continue" in LOGIN_HTML.lower()


def test_login_notice_element_is_status_not_alert():
    # It isn't the player's fault (unlike a failed-login #error, which is role="alert") —
    # a session timeout is informational, so it must not compete with #error's urgency.
    assert 'id="sessionExpiredNotice"' in LOGIN_HTML
    i = LOGIN_HTML.index('id="sessionExpiredNotice"')
    notice_tag = LOGIN_HTML[LOGIN_HTML.rindex("<div", 0, i):LOGIN_HTML.index(">", i) + 1]
    assert 'role="status"' in notice_tag
    assert 'role="alert"' not in notice_tag


def test_login_notice_starts_hidden():
    # No inline "You've been signed out" text baked into the static markup — it is only
    # populated + revealed by the script when the flag is actually present.
    head = LOGIN_HTML[:LOGIN_HTML.index('id="sessionExpiredNotice"') + 400]
    tag_start = head.rindex("<div", 0, head.index('id="sessionExpiredNotice"'))
    tag = head[tag_start:head.index(">", tag_start) + 1]
    assert "notice-info" in tag
    assert "You've been signed out" not in tag


def test_setmode_does_not_clobber_the_session_expired_notice():
    # setMode() toggles #error's visibility on every mode switch (login/signup/setup) —
    # it must not also reach into #sessionExpiredNotice, or a toggle would silently hide
    # the one honest notice we just showed.
    set_mode_body = LOGIN_HTML[LOGIN_HTML.index("function setMode(m) {"):
                                LOGIN_HTML.index("// Check auth status")]
    assert "sessionExpiredNotice" not in set_mode_body
