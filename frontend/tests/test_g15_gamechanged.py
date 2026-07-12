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


# ── 3. every mutation seam routes through the ONE dispatcher (DERIVED, #1412) ──

# HISTORY: the seam once carried a HAND-CODED array of "which tools fire a HUD
# refresh" (FEJS-3 #622 grew it 7 → 15; the 0093–0107 DRIFT mutators + 0094/0095
# confront/accuseTie later took it to 21). That inline list silently went stale
# whenever a new game-mutating tool got wired — the HUD lagged a whole poll period.
#
# #1412 (R1b) — the CONSUMING half: chat.js now calls the shared manifest lookup
# `window.orwellIsMutatingTool` (platform.js `ORWELL_MUTATING_TOOLS`) instead of an
# inline array. `test_1412_mutating_manifest.py` (the MANIFEST half, shipped #1479)
# pins that manifest EQUAL to the engine tool registry's mutating set — so the
# authoritative "which tools refresh the HUD" set is DERIVED from the registry, not
# maintained here.
#
# So this list is no longer hand-authored: we read it straight from the manifest in
# platform.js as the doc-anchor. The authoritative set is the manifest.
def _manifest_mutating_tools():
    m = re.search(r"ORWELL_MUTATING_TOOLS\s*=\s*Object\.freeze\(\[(.*?)\]\)", PLATFORM, re.S)
    assert m, "platform.js must export const ORWELL_MUTATING_TOOLS = Object.freeze([ ... ])"
    body = re.sub(r"//[^\n]*", "", m.group(1))  # strip // comments so words can't masquerade
    return re.findall(r"'([A-Za-z][A-Za-z0-9]*)'", body)


# DERIVED, not hand-authored — the authoritative set is the manifest (see above).
MUTATING_TOOLS = _manifest_mutating_tools()


def _chat_g15_block():
    i = CHAT.find("G15:")
    assert i != -1, "chat.js tool-result seam must carry the G15 dispatcher call"
    # The seam spans the G15 comment, the ok-gated mutating-tool dispatch, and the
    # createCharacter branch (fresh-session hook + the P1 finalizing indicator). The
    # window covers that whole branch — these are deeply indented lines. (#1412 SHRANK
    # the seam: the inline 21-name array became a single orwellIsMutatingTool call, so
    # the fresh-session hook now sits ~offset 1950; 2200 keeps a comfortable margin.)
    return CHAT[i:i + 2200]


def test_chat_tool_result_seam_consumes_the_shared_manifest_not_a_hand_array():
    # #1412 (R1b) — source-pin the CONSUMING half: the seam calls the shared lookup in
    # place of a hand-coded `[...].includes(json.tool)`, and the inline array is gone.
    block = _chat_g15_block()
    assert "window.orwellIsMutatingTool(json.tool)" in block, \
        "the seam must consume the shared manifest helper (platform.js orwellIsMutatingTool)"
    assert "window.orwellGameChanged" in block, "the seam calls THE shared dispatcher"
    assert re.search(r"if\s*\(ok\s*&&", block), \
        "only a SUCCESSFUL tool result mutated anything — the nudge is ok-gated"
    # The whole point of #1412: NO inline tool-name array survives in the seam. Every
    # former array member (bar createCharacter, which keeps its own fresh-session branch)
    # must be GONE as a quoted literal — a re-introduced list is exactly the stale-HUD trap.
    leaked = sorted(t for t in MUTATING_TOOLS
                    if t != "createCharacter" and f"'{t}'" in block)
    assert not leaked, (
        f"the seam still hard-codes tool-name literals {leaked} — #1412 removed the inline "
        f"array; the mutating set now lives in platform.js ORWELL_MUTATING_TOOLS")


def test_a_new_registry_mutating_tool_flows_into_the_seam_with_no_chatjs_edit():
    # The #1412 Definition-of-Done: "adding a new mutating tool with no extra FE change
    # still refreshes the HUD — a test proves it." The DERIVATION CHAIN that makes it true:
    #   1. test_1412_mutating_manifest.py pins  ORWELL_MUTATING_TOOLS == registry mutating set
    #      (a new registry PLAYER_TOOL is mutating-by-default and MUST join the manifest);
    #   2. THIS seam consumes window.orwellIsMutatingTool (the manifest lookup) — no inline
    #      list — so a manifest addition is honoured here WITHOUT editing chat.js.
    # Together: a newly-wired mutating registry tool refreshes the HUD with a manifest-only
    # change. This test asserts link #2 structurally (link #1 is the sibling test's whole job).
    block = _chat_g15_block()
    assert "window.orwellIsMutatingTool(json.tool)" in block, \
        "the seam must be manifest-driven for a new mutating tool to flow in edit-free"
    # The lookup the seam calls is really the registry-pinned manifest helper …
    assert "export function orwellIsMutatingTool" in PLATFORM, \
        "platform.js must define the manifest lookup (pinned registry-equal by test_1412)"
    # … and the drift guard that completes the chain (link #1) must exist.
    assert (FE / "tests" / "test_1412_mutating_manifest.py").exists(), \
        "the manifest↔registry drift guard must exist to complete the derivation chain"


def test_chat_keeps_the_fresh_session_hook_reachable():
    # The E65 fresh-session hook used to sit in the same dead nest; it must now
    # actually fire on createCharacter success.
    block = _chat_g15_block()
    assert "_orwellFreshSession" in block


# ── 3c. P1: the INITIAL onboarding is ONE conversation; only a RESTART splits ──
# Bug: finalizing the FIRST casting interview split the single onboarding into TWO
# chats — _orwellFreshSession fired on EVERY createCharacter success, including the
# legitimate initial onboarding (where the interview is the lead-in and must flow
# into the game in the SAME conversation). The fix: the split is armed ONLY by a
# genuine restart (reset-progress / next-season, both of which run while a game is
# already started); the initial onboarding never arms it, so the seam is a no-op.

SETTINGS = (JS_DIR / "settings.js").read_text(encoding="utf-8")
NEWSEASON = (JS_DIR / "orwellNewSeason.js").read_text(encoding="utf-8")
FINALIZING = (JS_DIR / "orwellFinalizing.js").read_text(encoding="utf-8")


def test_fresh_session_is_a_no_op_unless_a_restart_was_armed():
    m = re.search(r"window\._orwellFreshSession\s*=\s*\(\)\s*=>\s*\{(.*?)\n  \};",
                  ONBOARDING, re.S)
    assert m, "orwellOnboarding.js must define window._orwellFreshSession"
    body = m.group(1)
    # The first statement gates on the restart-armed flag and bails for the initial
    # onboarding BEFORE any session swap / history blank.
    guard = body.find("_orwellRestartArmed")
    swap = body.find("sidebar-new-chat-btn")
    transition = body.find("_orwellCastingTransition")
    assert guard != -1, "the seam must consult the restart-armed flag"
    assert "if (!window._orwellRestartArmed) return;" in body, \
        "the initial onboarding (no restart armed) must early-return — ONE conversation, no split"
    assert swap == -1 or guard < swap, "the guard must run BEFORE the new-chat swap"
    assert transition == -1 or guard < transition, \
        "the guard must run BEFORE the transition flag / history blank"


def test_only_genuine_restart_entry_points_arm_the_split():
    # markRestart is the arming seam; the two real restarts (already-started game)
    # arm it right before opening the fresh session.
    assert "window._orwellMarkRestart" in ONBOARDING, \
        "orwellOnboarding.js must expose the restart-arming seam"
    for src, name in ((SETTINGS, "settings.js reset-progress"),
                      (NEWSEASON, "orwellNewSeason.js next-season")):
        mark = src.find("_orwellMarkRestart")
        fresh = src.find("_orwellFreshSession")
        assert mark != -1, f"{name} must arm the restart before splitting"
        assert fresh != -1 and mark < fresh, \
            f"{name} must arm BEFORE calling _orwellFreshSession"


def test_chat_createcharacter_does_not_arm_a_restart():
    # The createCharacter success path (fires for EVERY interview, initial included)
    # must NOT arm the restart — otherwise the initial onboarding would split.
    assert "_orwellMarkRestart" not in CHAT, \
        "chat.js must never arm a restart on createCharacter — that re-splits the initial onboarding"


# ── 3d. P1: the finalizing/loading state across the cutover ───────────────────
# The createCharacter → house-entry beat is heavy; the chat used to look frozen.
# An inline (never modal — the transcript stays) indicator appears at the cutover
# and clears when the house-entry narration streams.

def test_finalizing_indicator_module_is_inline_and_fails_open():
    assert "_orwellFinalizing" in FINALIZING and "begin" in FINALIZING and "end" in FINALIZING
    # Inline into the transcript, NOT a blocking modal (no inert/aria-modal scrim).
    assert "chat-history" in FINALIZING, "the indicator mounts inline in the transcript"
    assert "aria-modal" not in FINALIZING, "must NOT be a blocking modal — the transcript stays visible"


def test_chat_drives_the_finalizing_indicator_begin_and_clear():
    # begin() at createCharacter success; cleared on the first narration token and
    # safety-netted in the stream's finally.
    assert "window._orwellFinalizing.begin()" in CHAT, "createCharacter must start the indicator"
    assert CHAT.count("window._orwellFinalizing.end()") >= 2, \
        "the indicator must clear on the narration token AND in the finally safety net"


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
    # the OUTER error-handler catch — anchored AFTER the dispatch so the inner
    # `try { _beat = (await r.json()).beatSeq } catch` (M1-3 beatSeq read) isn't mistaken for it.
    catch = confirm.find("} catch", call)
    assert ok_gate != -1 and call != -1 and catch != -1
    assert ok_gate < call < catch, \
        "orwellGameChanged must fire inside the success branch (post-throw-gate, pre-catch)"
    assert "orwellGameChanged" not in confirm[catch:], \
        "the catch branch (another lane's hunk) must not dispatch — nothing changed"


# ── 4. listeners untouched — they already subscribe ──────────────────────────

LISTENERS = ["orwellStatusPanel.js", "orwellCast.js",
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
