"""#1399 — chat.js must be evaluated EXACTLY ONCE per page (kill the dual-load hazard).

ROOT CAUSE pinned here: chat.js was loaded by TWO different urls on the app shell —
  * app.js's ES import              → `import chatModule from './js/chat.js'`  (url: /static/js/chat.js)
  * index.html's versioned <script> → `<script src="/static/js/chat.js?v=…">`  (url: /static/js/chat.js?v=…)
Two different urls are two different module records to the browser, so the file was
EVALUATED TWICE: two live copies of every module-level variable, timer, listener and
cache. PR #1398 patched only the one consequence it hit (both instances boot-restoring
the same sessionStorage outbox → duplicate paints + a real double-send) by keying the
restore to the window.chatModule instance; the dual-load itself remained a hazard class
(any module-level state in chat.js was silently duplicated). This gate makes the
single-eval invariant structural.

The contract:
  1. app.js imports chat.js exactly ONCE — that ES import is THE canonical load/eval path
     (app.js wires the instance via chatModule.init() and it registers window.chatModule);
  2. NO html shell script-tags chat.js — a <script src=".../chat.js…"> at ANY url is a
     second module record and re-introduces the double-eval. (The *different* url — the old
     `?v=` cache-buster — is exactly what broke module dedup; a same-url tag would merely
     dedup, but the app relies on the app.js import, so the shell carries no chat.js tag at all.)
  3. => exactly ONE evaluation path total (the app.js import);
  4. cache-busting does NOT depend on a `?v=` query — sw.js serves /static/*.js network-first
     and precaches /static/js/chat.js (unversioned), so a normal reload already gets fresh code;
  5. a runtime once-sentinel in chat.js makes a regression LOUD (console.warn on a 2nd eval)
     instead of silent.

Note: sibling modules (ui.js, sessions.js, chatStream.js, …) are BOTH script-tagged and
imported, but at the SAME (unversioned) url, so the browser dedups them to one instance —
chat.js was the lone anomaly because its script tag carried `?v=…`.
"""
import re
from pathlib import Path

FE = Path(__file__).resolve().parents[1]
STATIC = FE / "static"
APP_JS = (STATIC / "app.js").read_text(encoding="utf-8")
CHAT_JS = (STATIC / "js" / "chat.js").read_text(encoding="utf-8")

# Every html shell in static/ (index.html, login.html, …) — the "no second load path" sweep.
ALL_HTML = sorted(STATIC.rglob("*.html"))

# An ACTUAL <script> element that would EVALUATE chat.js — matches `<script … src="…/chat.js…">`
# at any url (versioned or not). Deliberately does NOT match:
#   * <link rel="modulepreload" href="…/chat.js">  (a cache hint, not an evaluation)
#   * chat.js mentioned inside an <!-- … --> comment (no `<script … src=`)
#   * chatRenderer.js / chatStream.js / search-chat.js  (the leading `/chat.js` boundary guards this)
SCRIPT_CHATJS_RE = re.compile(
    r"""<script\b[^>]*\bsrc=["'][^"']*/chat\.js(?:\?[^"']*)?["']""", re.I
)

# The ES import of chat.js in app.js: `import chatModule from './js/chat.js';`
IMPORT_CHATJS_RE = re.compile(r"""import\s+\w+\s+from\s+['"]\./js/chat\.js['"]""")


def test_app_js_imports_chat_js_exactly_once():
    hits = IMPORT_CHATJS_RE.findall(APP_JS)
    assert len(hits) == 1, (
        f"app.js must import chat.js exactly once (the ONE canonical eval path) — found {len(hits)}. "
        "See #1399: chat.js loads via the app.js ES import only."
    )


def test_no_html_shell_script_tags_chat_js():
    offenders = {}
    for f in ALL_HTML:
        found = SCRIPT_CHATJS_RE.findall(f.read_text(encoding="utf-8"))
        if found:
            offenders[f.name] = found
    assert not offenders, (
        "chat.js must NOT be loaded by a <script> tag — it is loaded via app.js's ES import only, "
        "so it evaluates ONCE. A <script src=…/chat.js…> re-introduces the #1399 dual-load (a "
        "different url — e.g. the old `?v=` — is two module records ⇒ chat.js runs twice ⇒ every "
        f"module-level timer/listener/cache is duplicated). Offending tag(s): {offenders}"
    )


def test_exactly_one_chat_js_evaluation_path_total():
    # Belt: the total number of chat.js *evaluation* references across the app shell
    # (app.js import + every html <script>) is exactly ONE.
    total = len(IMPORT_CHATJS_RE.findall(APP_JS))
    for f in ALL_HTML:
        total += len(SCRIPT_CHATJS_RE.findall(f.read_text(encoding="utf-8")))
    assert total == 1, (
        f"chat.js must have exactly ONE evaluation path (the app.js import) — found {total}. "
        "See #1399: two urls ⇒ two module instances ⇒ doubled module-level state."
    )


def test_chat_js_has_a_single_eval_runtime_sentinel():
    # Defense-in-depth: a 2nd evaluation (a regression re-adding a differing load path) must be
    # LOUD, not silent. chat.js sets a window sentinel at module top and warns if it is already set.
    assert "window.__orwellChatEvaluated" in CHAT_JS, (
        "chat.js must carry the #1399 once-sentinel (window.__orwellChatEvaluated) so a regression "
        "that re-introduces the dual-load surfaces a console.warn instead of silently duplicating "
        "module-level state."
    )
    assert re.search(r"__orwellChatEvaluated[\s\S]{0,400}?console\.warn", CHAT_JS), (
        "the #1399 sentinel must console.warn on a second evaluation (loud, not silent)."
    )
