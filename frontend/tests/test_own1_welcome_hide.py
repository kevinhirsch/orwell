"""OWN-1 (2026-07-14 theme visual audit §9) — the welcome hero must never ghost through a
streaming transcript.

The owner screenshot showed the #welcome-screen hero (wordmark / tagline / rotating tip)
rendering BEHIND/THROUGH the translucent glass bubbles while the CASTING conversation
streamed: `.chat-container.welcome-active` stayed set because the hide seam fired only from
addMessage (history renders) and a handful of explicit call sites — but several live paths
mount bubbles DIRECTLY into #chat-history without addMessage: the live streaming holder
(chat.js handleChatSubmit), the casting kickoff's hidden-cue stream (the user bubble is
deliberately suppressed, so nothing routes through addMessage), the WS mirror splice
(chatWsSplice.js _wsEnsureRound), and the resume/poll fallbacks (sessions.js
_checkServerStream).

The fix is ONE shared "transcript has content" seam in chatRenderer.js (never per-path
patches in chat.js — the highest-risk file):

  1. ensureWelcomeContentSync() — a childList MutationObserver on #chat-history that hides
     the hero the moment ANY message bubble (.msg) exists while the hero is still up.
     Hide-only by design: it never re-shows welcome.
  2. showWelcomeScreen() — the FE-render #7 bubble guard is now UNCONDITIONAL: the hero is
     never painted over a non-empty transcript, regardless of the casting-transition flag.

The behavior itself (casting stream ⇒ welcome-active removed; genuinely empty chat ⇒
present) is exercised in a real browser by tests/test_own1_welcome_hide_browser.py.
These are wiring pins (JS-as-text). No fixture names — roles only.
"""

import os
import re

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*parts):
    with open(os.path.join(FRONTEND, *parts), encoding="utf-8") as f:
        return f.read()


RENDERER = _read("static", "js", "chatRenderer.js")


def _fn_body(name, src=RENDERER):
    m = re.search(r"export function " + name + r"\(\)\s*\{(.*?)\n\}", src, re.S)
    assert m, f"chatRenderer.js must export {name}()"
    return m.group(1)


# ── 1. the shared "transcript has content" seam exists ──────────────────────────────

def test_shared_transcript_content_seam_watches_chat_history():
    body = _fn_body("ensureWelcomeContentSync")
    # it targets the transcript node …
    assert "getElementById('chat-history')" in body, "the seam must watch #chat-history"
    # … via a childList MutationObserver (direct-child bubble mounts; NOT per-token subtree
    # mutations, which would fire on every streamed delta) …
    assert "new MutationObserver" in body, "the seam must be a MutationObserver"
    assert "childList: true" in body, "observe childList (bubble mounts), not subtree"
    assert "subtree" not in body, "must NOT observe subtree — per-token deltas would thrash it"
    # … and hides the hero only when a real bubble exists.
    assert "querySelector('.msg')" in body, "content = a real .msg bubble in the transcript"
    assert "hideWelcomeScreen()" in body, "the seam funnels through the ONE canonical hide"


def test_seam_is_hide_only_it_never_shows_welcome():
    body = _fn_body("ensureWelcomeContentSync")
    # An empty transcript re-shows welcome ONLY via the explicit showWelcomeScreen calls
    # that follow a clear — the observer must never re-show (or it would fight every
    # legitimate "blank to welcome" path).
    assert "showWelcomeScreen" not in body
    assert "classList.add('welcome-active')" not in body
    assert "classList.remove('hidden')" not in body


def test_seam_is_armed_at_module_init_dom_ready_safe():
    # Armed immediately when the DOM is ready, with a DOMContentLoaded fallback while
    # loading — so the seam is live before the first stream can mount a holder.
    idx = RENDERER.find("export function ensureWelcomeContentSync")
    tail = RENDERER[idx:]
    arm = tail[: tail.find("export function showWelcomeScreen")]
    assert "DOMContentLoaded" in arm, "must arm on DOMContentLoaded when still loading"
    assert "ensureWelcomeContentSync()" in arm, "must arm immediately when DOM is ready"
    # inert outside a browser (source is also evaluated headlessly by test harnesses)
    assert "typeof document !== 'undefined'" in arm


def test_seam_checks_content_already_present_at_arm_time():
    # A resumed transcript may already hold bubbles when the observer arms (module init
    # after a fast history render) — the seam must sync once immediately, not only on the
    # next mutation.
    body = _fn_body("ensureWelcomeContentSync")
    assert re.search(r"\n  sync\(\);", body), \
        "ensureWelcomeContentSync must run one immediate sync after observing"


def test_seam_is_exported_on_the_module_api():
    # exported so a future DOM-swap path can re-arm it explicitly
    m = re.search(r"const chatRenderer = \{(.*?)\n\};", RENDERER, re.S)
    assert m and "ensureWelcomeContentSync" in m.group(1), \
        "ensureWelcomeContentSync must be on the chatRenderer module object"


# ── 2. showWelcomeScreen never paints the hero over a non-empty transcript ──────────

def test_show_welcome_bubble_guard_is_unconditional():
    body = _fn_body("showWelcomeScreen")
    # The FE-render #7 guard used to be gated on the casting-transition flag; OWN-1 showed
    # the same ghosting on the casting stream itself, so the runtime gate is GONE — the
    # bubble check always applies. (The flag survives in prose for the FE-render #7 story;
    # test_g15_gamechanged.py pins that history.)
    assert "if (window._orwellCastingTransition)" not in body, \
        "the bubble guard must NOT be gated on the casting-transition flag"
    guard = body.find("querySelector('.msg')")
    unhide = body.find("classList.remove('hidden')")
    assert guard != -1 and unhide != -1 and guard < unhide, \
        "the .msg guard must run BEFORE the hero is un-hidden"
    assert "return" in body[guard : unhide], \
        "the guard must early-return — never paint the hero over a transcript with bubbles"


def test_hide_welcome_still_drops_both_hero_and_container_state():
    # The canonical hide the seam funnels through: the hero node hides AND the container
    # class (the composer lift + hero styling) drops — the pair the audit saw stuck.
    body = _fn_body("hideWelcomeScreen")
    assert "classList.add('hidden')" in body
    assert "classList.remove('welcome-active')" in body
