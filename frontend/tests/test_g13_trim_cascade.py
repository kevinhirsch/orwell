"""Lane G / G13 — the trim-zombie sweep: gating must cascade (ruling 2026-06-11).

ROOT CAUSE: the game build hides ITEMS but not their PARENTS/launchers — the
Tools-chevron instance (fixed in G3 for sidebar sections) generalized to the
rest of the chrome. The RULE, enforced here and walked at runtime in
frontend/scripts/browser_smoke.py (the G13 block):

  * a container with zero visible actionable children hides itself;
  * an affordance whose action is build-refused is HIDDEN, not click-refused.

Three mechanisms, source-pinned below:

1. SHORTCUTS MODAL (static/js/settings.js, the Shortcuts tab): a binding whose
   action this build trimmed is a zombie row. Rows gate on the build's own
   seam — the voice vertical ships its JS only when the voice flag is on
   (src/settings.py dropped_script_srcs strips the tts-ai.js <script> tag), so
   the shipped tag is the probe; a category header with zero rows hides too.

2. CHROME MENUS (static/app.js): under the game build the export/overflow
   menus never hold an entry whose handler lands on a dropped vertical
   ("Save to Documents" posts into the dropped documents vertical — 404 by
   design). Entries are REMOVED before wiring, and a menu trigger whose menu
   ends up with zero visible items hides with it (hide-only — the user's
   Appearance UI-vis toggles own un-hiding).

3. SETTINGS TABS (static/js/settings.js): a tab whose every card is
   .admin-only is an empty page for a non-admin — syncAdminVisibility hides
   its launcher (computed from the panel's own cards, no tab name list), and
   open()'s _tabVisible consults computed display so a hidden tab can't be
   landed on either (covers this cascade AND the game-trim CSS tab trims).

The rail (item 4 of the lane) needs no new mechanism: static launchers for
dropped verticals are trimmed by game-trim.css's first block, and H4's
syncRailIcons mirrors follow their source row's computed display — the smoke
walk proves both stay invisible under the build.

The runtime half — the game-build walk (menu sweeps, shortcuts rows, the
non-admin tab sweep, the synthetic cascade probe, the rail sweep) — lives in
the browser smoke as ONE block anchored after the last existing check (the H4
rail block), deriving the dropped list from src.settings/game-trim.css (never
hardcoded).
"""
import os
import re

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SETTINGS_JS = os.path.join(FRONTEND, "static", "js", "settings.js")
APP_JS = os.path.join(FRONTEND, "static", "app.js")
SMOKE = os.path.join(FRONTEND, "scripts", "browser_smoke.py")
TRIM_CSS = os.path.join(FRONTEND, "static", "css", "game-trim.css")


def _read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


# ── 1. the shortcuts modal lists only bindings this build ships ─────────────

def test_shortcut_rows_gate_on_the_builds_own_seam():
    js = _read(SETTINGS_JS)
    assert "SHORTCUT_REQUIRES" in js and "_shortcutShipped" in js, (
        "settings.js must carry the G13 availability registry — a binding "
        "whose action the build trimmed is a zombie row."
    )
    # The voice probe targets the build's own script-strip seam, not a name list.
    assert re.search(r"tts:\s*\(\)\s*=>.*script\[src\*=\"tts-ai\.js\"\]", js), (
        "the tts row must probe the shipped tts-ai.js <script> tag — the exact "
        "seam src/settings.py dropped_script_srcs strips when voice is off."
    )
    assert "window.aiTTSManager && window.aiTTSManager.available" in js, (
        "a live, available TTS manager must also count as shipped (covers a "
        "build where the tag was stripped but voice is genuinely live)."
    )


def test_shortcut_render_filters_rows_and_drops_empty_categories():
    js = _read(SETTINGS_JS)
    assert re.search(
        r"const actions = cat\.keys\.filter\(a => \(a in keybinds\) && _shortcutShipped\(a\)\);", js
    ), "render() must filter each category's actions through _shortcutShipped."
    assert re.search(r"if \(actions\.length === 0\) continue;", js), (
        "a category header with zero rows under it is a zombie parent — "
        "render() must skip the whole category (the cascade rule)."
    )


# ── 2. the chrome menus never hold a refused entry ──────────────────────────

def test_app_js_removes_refused_menu_entries_before_wiring():
    js = _read(APP_JS)
    assert "function applyGameBuildMenuGating()" in js
    gate = js[js.index("function applyGameBuildMenuGating()"):]
    gate = gate[:gate.index("\nfunction initializeEventListeners")]
    assert "if (!document.body.hasAttribute('data-game-build')) return;" in gate, (
        "menu gating is a game-build behavior — the full workspace is untouched."
    )
    assert "'export-doc-btn'" in gate and ".remove()" in gate, (
        "'Save to Documents' acts on the dropped documents vertical — the "
        "entry must be REMOVED (hidden-not-click-refused), not left for CSS."
    )
    # #1638: the composer overflow entries (Attach files, TTS Mode) are no longer static DOM nodes —
    # they are buildOverflowItems() items, so their game-build drop moved OUT of applyGameBuildMenuGating
    # (this `gate` body) and INTO the builder's filter. The TTS voice-module probe now lives there.
    assert "overflow-tts-btn" not in gate, (
        "the overflow TTS entry is no longer a DOM node removed here — its gating moved to the builder"
    )
    builder = js[js.index("function buildOverflowItems()"):]
    builder = builder[: builder.index("\n  function updatePlusDot")]
    assert "script[src*=\"tts-ai.js\"]" in builder, (
        "the TTS overflow item must go with its unshipped voice module — the builder includes it "
        "only when the tts-ai.js <script> tag is shipped (the game build strips it)."
    )
    assert "gameBuild" in builder and "Attach files" in builder, (
        "the Attach-files drop under the game build now lives in the builder (dropped when "
        "data-game-build is set — the composer SEND '+' is the single attach affordance there)."
    )
    # The gate runs before any menu wiring looks the entries up.
    init = js[js.index("function initializeEventListeners()"):]
    assert init.index("applyGameBuildMenuGating();") < init.index("el('export-dl-btn')"), (
        "applyGameBuildMenuGating must run at the top of "
        "initializeEventListeners — handlers never attach to removed nodes."
    )


def test_menu_trigger_cascade_is_hide_only_and_rerun_after_async_passes():
    js = _read(APP_JS)
    assert "function _g13CascadeMenuTriggers()" in js, (
        "a launcher whose whole menu has zero visible items must hide itself "
        "(the G3 Tools-chevron rule generalized to menus)."
    )
    block = js[js.index("function _g13CascadeMenuTriggers()"):]
    block = block[:block.index("\nfunction applyGameBuildMenuGating")]
    assert "['export-dl-btn', 'export-dropdown-menu', '.export-dropdown-item']" in block
    # #1638: the composer overflow "+" no longer has static DOM (it mounts through OrwellMenuKit), so
    # its empty-chevron cascade left this static-DOM sweep. The sweep now covers only the export
    # dropdown; the overflow cascade is builder-driven (refreshOverflowChevron).
    assert "'overflow-plus-btn', 'overflow-menu'" not in block, (
        "the composer overflow menu is builder-driven now — its tuple must be OUT of the static "
        "_g13CascadeMenuTriggers sweep (it lives in refreshOverflowChevron)."
    )
    assert "if (!anyVisible) btn.style.display = 'none';" in block, (
        "the cascade is HIDE-ONLY — un-hiding belongs to the user's "
        "Appearance UI-vis toggles, never this rule."
    )
    # The overflow empty-chevron cascade is now builder-driven: refreshOverflowChevron hides the "+"
    # trigger (hide-only) when buildOverflowItems() yields zero items.
    refresh = js[js.index("function refreshOverflowChevron()"):]
    refresh = refresh[: refresh.index("\n  window._updateOverflowPlusDot")]
    assert "buildOverflowItems().length" in refresh and "plusBtn.style.display = 'none'" in refresh, (
        "refreshOverflowChevron must hide the overflow '+' (hide-only) when the builder yields zero "
        "items — the G13 empty-chevron cascade, driven by the builder."
    )
    # Both async passes can hide entries — the cascade re-runs after each.
    feats = js[js.index("window._initFeaturesReady = ("):]
    feats = feats[:feats.index(".catch(() => {});")]
    assert "_g13CascadeMenuTriggers()" in feats, (
        "the features fetch hides entries asynchronously — the trigger "
        "cascade must re-run when it settles."
    )
    setts = js[js.index("window._initSettingsReady = ("):]
    setts = setts[:setts.index(".catch(() => {});")]
    assert "_g13CascadeMenuTriggers()" in setts, (
        "the TTS-settings pass hides the overflow entry too — the trigger "
        "cascade must re-run when it settles."
    )


def test_e96_css_belt_still_hides_export_doc():
    css = _read(TRIM_CSS)
    assert "body[data-game-build] #export-doc-btn { display: none !important; }" in css, (
        "the E96 CSS belt stays — the DOM removal is the rule, the CSS is "
        "defense-in-depth against a reintroduced node."
    )


# ── 3. an all-admin-cards tab hides its launcher for non-admins ─────────────

def test_sync_admin_visibility_cascades_to_tab_launchers():
    js = _read(SETTINGS_JS)
    sync = js[js.index("function syncAdminVisibility()"):]
    sync = sync[:sync.index("\n/* ")]
    assert "[data-settings-tab]" in sync and "[data-settings-panel=" in sync, (
        "syncAdminVisibility must walk the tab launchers against their panels."
    )
    assert re.search(
        r"const allAdminOnly = cards\.length > 0 &&\s*"
        r"Array\.from\(cards\)\.every\(c => c\.classList\.contains\('admin-only'\)\);",
        sync,
    ), (
        "the cascade is COMPUTED from the panel's own cards (no tab name "
        "list) — any tab that drifts to all-admin-only content auto-hides."
    )
    assert "btn.style.display = (allAdminOnly && !isAdmin) ? 'none' : '';" in sync, (
        "the cascade must also CLEAR its hide when the condition lifts — a "
        "one-way write would strand the launcher hidden for admins."
    )


def test_tab_visibility_resolution_respects_every_gate():
    js = _read(SETTINGS_JS)
    open_fn = js[js.index("export function open(tab)"):]
    open_fn = open_fn[:open_fn.index("export function close()")]
    assert "getComputedStyle(b).display !== 'none'" in open_fn, (
        "_tabVisible must consult computed display so a launcher hidden by "
        "the cascade OR the game-trim CSS can never be landed on."
    )
    # The not-visible fallback lands a non-admin player on Appearance (J1-14), `account` last resort.
    assert "if (!_tabVisible(activeTab)) activeTab = _tabVisible('appearance') ? 'appearance' : 'account';" in open_fn
    # syncAdminVisibility (which applies the cascade) runs before resolution.
    assert open_fn.index("syncAdminVisibility();") < open_fn.index("_tabVisible"), (
        "open() must apply the cascade before resolving the landing tab."
    )


# ── the runtime gate: the browser-smoke game-build walk ─────────────────────

def test_browser_smoke_carries_the_g13_walk():
    smoke = _read(SMOKE)
    # The three concrete asserts the lane prescribes.
    assert "no shortcuts-modal row names a dropped vertical" in smoke
    assert "no overflow item present whose handler is the refusal path" in smoke
    assert "no empty non-admin settings tab button renders" in smoke
    # Plus the launcher sweeps and the live cascade probe.
    assert "no visible rail icon names a dropped vertical" in smoke
    assert "every game-trim'd launcher stays invisible" in smoke
    assert "is removed from the DOM" in smoke
    assert "hides its launcher for the player" in smoke
    assert "the cascade is hide-only, never over-hides" in smoke


def test_smoke_derives_the_dropped_list_from_the_builds_source():
    smoke = _read(SMOKE)
    assert "from src.settings import GAME_DROP_SET, dropped_script_srcs" in smoke, (
        "the dropped list must be DERIVED from the same source the build "
        "uses (src.settings) — never typed into the gate."
    )
    assert "game-trim.css" in smoke, (
        "the trimmed-launcher sweep reads the build's own trim sheet for its "
        "id list (no hardcoded launcher names)."
    )
    g13 = smoke[smoke.index("G13 (gating cascades"):]
    g13 = g13[:g13.index("browser.close()")]
    for vertical in ("email", "gallery", "cookbook", "calendar", "documents"):
        assert f"'{vertical}'" not in g13 and f'"{vertical}"' not in g13, (
            f"the G13 block hardcodes the dropped vertical '{vertical}' — "
            "derive it from src.settings instead."
        )


def test_smoke_block_is_anchored_after_the_last_existing_check():
    smoke = _read(SMOKE)
    g13 = smoke.index("G13 (gating cascades")
    # After the H4 rail block — the last pre-existing check of the smoke.
    h4_last = smoke.index("gets gated rail mirrors with icons")
    assert g13 > h4_last, "the G13 smoke block sits after the last existing check (H4)"
    # ONE block: nothing but the G13 walk between its start and browser.close().
    tail = smoke[g13:smoke.index("browser.close()")]
    assert tail.count("# G13 (gating cascades") <= 1
    assert "check(" in tail and "def main" not in tail


def test_j1_14_player_lands_on_appearance_not_account():
    """J1-14 (UX audit): a non-admin player who opens Settings should land on Appearance (look/feel),
    not Account. The markup default-active tab is admin-only `services` (hidden for a player), so the
    fallback decides — it used to drop zero-data players on `account` (password/2FA/photo). Now it
    lands on Appearance. (Behaviour verified headless: a non-admin gear-open shows the Appearance panel.)"""
    js = _read(SETTINGS_JS)
    assert "window._isAdmin ? 'services' : 'appearance'" in js          # the non-admin default
    assert "_tabVisible('appearance') ? 'appearance' : 'account'" in js  # the not-visible fallback
    assert "activeTab = 'account'" not in js                            # the old hard fallback is gone


def test_j1_07_game_build_curates_the_appearance_visibility_toggles():
    """J1-07 (UX audit): the Appearance > visibility toggles are inherited-WORKSPACE controls a Big
    Brother player doesn't need (several even surface the OOC model concept). The game build hides the
    workspace rows + the whole Chat-Bar card, keeping only the in-fiction toggles (Theme / Welcome /
    Text-only Emojis / Thinking / Sensitive Blur). Verified headless: 5 visible (was 16)."""
    css = _read(os.path.join(FRONTEND, "static", "css", "game-trim.css"))
    # the workspace rows are hidden in the game build, by their data-ui-key (same :has() pattern)
    for key in ("sidebar-brand", "sidebar-search", "sidebar-new-chat", "sessions-section",
                "models-section", "user-bar", "sidebar-settings-btn", "chat-meta"):
        assert f'.vis-row:has(input[data-ui-key="{key}"])' in css, key
    assert 'body[data-game-build] [data-vis-card="chat-bar"]' in css      # the whole Chat-Bar card
    # the in-fiction toggles are NOT in the hide list (kept)
    for keep in ("tool-theme", "text-emojis", "show-thinking", "sensitive-blur", "welcome-text"):
        assert f'data-ui-key="{keep}"]' not in css, keep
    # the markup tags the Chat-Bar card so the rule can target it
    html = _read(os.path.join(FRONTEND, "static", "index.html"))
    assert 'data-vis-card="chat-bar"' in html
