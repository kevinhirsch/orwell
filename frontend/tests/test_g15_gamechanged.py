"""Lane G15 — event-driven freshness: ONE debounced `orwell:gamechanged` dispatcher.

ROOT CAUSE pinned here: the sidebar/panel surfaces are poll-based (20-30s) and the
event's only inline dispatch (E65, chat.js) was nested under the
advanceGame/submitDecision branch while keyed on createCharacter/manageSandbox —
unreachable — so post-action UI lagged up to a full poll period ("the sidebar is
behind").

The contract:
  1. ONE helper, `orwellGameChanged(reason)` in platform.js, owns the dispatch —
     the only `new CustomEvent('orwell:gamechanged'…)` anywhere in static JS;
  2. it debounces (~250ms trailing) so a burst of tool results in one agent turn
     coalesces into one refresh wave, and it is window-exposed so classic-script
     surfaces share the seam without import coupling;
  3. every FE mutation-result seam calls it: the chat tool-result seam (each named
     game-mutating tool) and the decision card's POST success branch;
  4. the panel listeners are untouched — they already subscribe;
  5. no FE JS posts /api/orwell/new-game (admin/ops route — no seam to wire) and
     the portraits backfill stays out of the mutating set (image cache, not game
     state).

The live half (helper call -> debounced event -> the status HUD refresh fires
without waiting a poll period) is proven in scripts/browser_smoke.py (the G15
block, anchored after the G10 close check).
"""
import re
from pathlib import Path

FE = Path(__file__).resolve().parents[1]
JS_DIR = FE / "static" / "js"
PLATFORM = (JS_DIR / "platform.js").read_text(encoding="utf-8")
CHAT = (JS_DIR / "chat.js").read_text(encoding="utf-8")
DECISION = (JS_DIR / "orwellDecision.js").read_text(encoding="utf-8")
ONBOARDING = (JS_DIR / "orwellOnboarding.js").read_text(encoding="utf-8")
RENDERER = (JS_DIR / "chatRenderer.js").read_text(encoding="utf-8")

# Every static JS file, the root app.js included — the "exists once" sweep.
ALL_JS = sorted((FE / "static").rglob("*.js"))

DISPATCH_RE = re.compile(r"new CustomEvent\(\s*['\"]orwell:gamechanged['\"]")


# ── 1. the helper exists ONCE ─────────────────────────────────────────────────

def test_the_dispatch_exists_exactly_once_and_lives_in_the_helper():
    hits = []
    for f in ALL_JS:
        for _ in DISPATCH_RE.finditer(f.read_text(encoding="utf-8")):
            hits.append(f.name)
    assert hits == ["platform.js"], (
        f"`orwell:gamechanged` must have exactly ONE dispatcher (platform.js "
        f"orwellGameChanged) — found {hits}. New mutation seams call the helper, "
        f"never dispatch ad hoc."
    )


def _helper_body():
    m = re.search(r"export function orwellGameChanged\([^)]*\)\s*\{(.*?)\n\}", PLATFORM, re.S)
    assert m, "platform.js must export function orwellGameChanged(reason)"
    return m.group(1)


def test_the_helper_is_window_exposed_for_classic_script_callers():
    assert "window.orwellGameChanged = orwellGameChanged" in PLATFORM


# ── 2. the debounce ───────────────────────────────────────────────────────────

def test_the_helper_debounces_a_burst_into_one_event():
    body = _helper_body()
    assert "clearTimeout" in body, "a fresh call must reset the pending timer (trailing debounce)"
    assert "setTimeout" in body and DISPATCH_RE.search(body), \
        "the dispatch fires from the debounce timer, never synchronously"
    assert re.search(r"GAMECHANGED_DEBOUNCE_MS\s*=\s*250", PLATFORM), \
        "~250ms: long enough to coalesce one agent turn's tool burst, far below a poll period"


# ── 3. every mutation seam calls it ──────────────────────────────────────────

MUTATING_TOOLS = ["advanceGame", "submitDecision", "recordInteraction",
                  "createCharacter", "updateCasting", "manageSandbox", "runCompetition"]


def _chat_g15_block():
    i = CHAT.find("G15:")
    assert i != -1, "chat.js tool-result seam must carry the G15 dispatcher call"
    return CHAT[i:i + 1200]


def test_chat_tool_result_seam_routes_every_mutating_tool_through_the_helper():
    block = _chat_g15_block()
    for tool in MUTATING_TOOLS:
        assert f"'{tool}'" in block, f"the mutating set must include {tool}"
    assert "window.orwellGameChanged" in block, "the seam calls THE shared helper"
    assert re.search(r"if\s*\(ok\s*&&", block), \
        "only a SUCCESSFUL tool result mutated anything — the nudge is ok-gated"


def test_chat_keeps_the_fresh_session_hook_reachable():
    # The E65 fresh-session hook used to sit in the same dead nest; it must now
    # actually fire on createCharacter success.
    block = _chat_g15_block()
    assert "_orwellFreshSession" in block


# ── 3b. FE-render #7: no welcome-splash flash at the casting→game cutover ──────
# createCharacter fires mid-stream and opens a fresh session, so createDirectChat
# blanks #chat-history + shows the welcome splash WHILE the still-finalizing tool
# beat / casting card re-paints the OLD transcript. The conversation appears to
# vanish for a beat. The fresh-session hook arms a self-clearing transition flag
# and showWelcomeScreen suppresses the splash while the old bubbles are still up.

def test_fresh_session_arms_a_self_clearing_casting_transition_flag():
    m = re.search(r"window\._orwellFreshSession\s*=\s*\(\)\s*=>\s*\{(.*?)\n  \};",
                  ONBOARDING, re.S)
    assert m, "orwellOnboarding.js must define window._orwellFreshSession"
    body = m.group(1)
    assert "window._orwellCastingTransition = true" in body, \
        "the casting→game cutover must mark the transition so the welcome splash is suppressed"
    assert "setTimeout" in body and "_orwellCastingTransition = false" in body, \
        "the flag must self-clear so a stuck flag can never permanently hide the welcome screen"
    assert "clearTimeout" in body, "re-entry must reset the self-clear timer"


def test_show_welcome_suppresses_the_splash_only_during_transition_with_bubbles():
    m = re.search(r"export function showWelcomeScreen\(\)\s*\{(.*?)\n\}", RENDERER, re.S)
    assert m, "chatRenderer.js must export showWelcomeScreen()"
    body = m.group(1)
    # The guard reads the transition flag, checks the history still has a real
    # message bubble, and bails BEFORE un-hiding the welcome screen.
    flag = body.find("window._orwellCastingTransition")
    bubble = body.find(".msg")
    unhide = body.find("classList.remove('hidden')")
    assert flag != -1, "showWelcomeScreen must consult the casting-transition flag"
    assert bubble != -1, "the guard must require the old transcript still has a .msg bubble"
    assert "return" in body[flag:unhide if unhide != -1 else len(body)], \
        "the guard must early-return (skip the splash) before the welcome screen is shown"
    assert unhide != -1 and flag < unhide, \
        "the suppression guard must run BEFORE the welcome screen is un-hidden"


def test_decision_card_success_branch_calls_the_helper():
    # The call belongs to the POST *success* branch only: after the !r.ok throw
    # (a failed POST mutated nothing) and before the catch hunk.
    confirm = DECISION[DECISION.find('fetch("/api/orwell/decision"'):]
    ok_gate = confirm.find("if (!r.ok) throw")
    call = confirm.find("window.orwellGameChanged")
    catch = confirm.find("} catch")
    assert ok_gate != -1 and call != -1 and catch != -1
    assert ok_gate < call < catch, \
        "orwellGameChanged must fire inside the success branch (post-throw-gate, pre-catch)"
    assert "orwellGameChanged" not in confirm[catch:], \
        "the catch branch (another lane's hunk) must not dispatch — nothing changed"


# ── 4. listeners untouched — they already subscribe ──────────────────────────

LISTENERS = ["orwellStatusPanel.js", "orwellSocial.js", "orwellCast.js",
             "orwellFinale.js", "orwellEngineStatus.js", "orwellDiaryRoom.js",
             "orwellDecision.js"]


def test_every_panel_still_subscribes():
    for name in LISTENERS:
        src = (JS_DIR / name).read_text(encoding="utf-8")
        assert re.search(r"addEventListener\(\s*['\"]orwell:gamechanged['\"]", src), \
            f"{name} lost its orwell:gamechanged subscription"


# ── 5. the non-seams stay non-seams ──────────────────────────────────────────

def test_no_fe_js_posts_new_game():
    # /api/orwell/new-game is the admin-gated ops route (E70); no FE surface posts
    # it, so there is no FE-side dispatch to wire — verified, not assumed.
    for f in ALL_JS:
        assert "new-game" not in f.read_text(encoding="utf-8"), \
            f"{f.name} references the new-game route — if a FE caller appears, wire the helper there"


def test_portraits_backfill_stays_out_of_the_mutating_set():
    # The backfill fills an image cache — game state does not move, so it must
    # not nudge the panels (and must not creep into the chat seam's tool set).
    assert "portraits" not in _chat_g15_block()
    cast = (JS_DIR / "orwellCast.js").read_text(encoding="utf-8")
    backfill = cast[cast.find("portraits/backfill"):]
    assert "orwellGameChanged" not in backfill
