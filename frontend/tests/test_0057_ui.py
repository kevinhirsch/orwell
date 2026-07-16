"""Feature 0057 (chunks 2-3) — the season HUD indicators + the post-season "New season" surface.

Source-level (no browser): the two HUD modules' JS guards, the new-season panel's wiring, the
settings red-zone control, and the index.html script/HTML structural presence. The live browser
behavior (overflow, tap targets, the actual fill width) is the parent's responsive-matrix /
browser-smoke job; here we assert the contracts that make those pass.

Name-agnostic: no houseguest names anywhere.
"""

import pathlib

FRONTEND_DIR = pathlib.Path(__file__).parent.parent
HTML_SRC = (FRONTEND_DIR / "static" / "index.html").read_text(encoding="utf-8")
JS_PROGRESS = (FRONTEND_DIR / "static" / "js" / "orwellSeasonProgress.js").read_text(encoding="utf-8")
CSS_SRC = (FRONTEND_DIR / "static" / "style.css").read_text(encoding="utf-8")
JS_NEWSEASON = (FRONTEND_DIR / "static" / "js" / "orwellNewSeason.js").read_text(encoding="utf-8")
JS_SETTINGS = (FRONTEND_DIR / "static" / "js" / "settings.js").read_text(encoding="utf-8")


# ── A. the season progress bar + chip (chunk 2) ─────────────────────────────────────────────

class TestSeasonProgressBar:
    def test_module_is_referenced_in_index(self):
        assert "orwellSeasonProgress.js" in HTML_SRC

    def test_bar_id_and_chip_id_present(self):
        assert "orwell-season-progress" in JS_PROGRESS
        assert "orwell-season-chip" in JS_PROGRESS

    def test_bar_adopts_the_progress_primitive(self):
        # #1638 (G8): the bar now composes the .ow-progress / .ow-progress--edge kit primitive;
        # the fill is dual-classed so paint()'s `.osp-fill` selector survives.
        assert 'bar.className = "ow-progress ow-progress--edge"' in JS_PROGRESS
        assert 'fill.className = "ow-progress-fill osp-fill"' in JS_PROGRESS

    def test_bar_is_at_most_5px_tall(self):
        # The spec requires a thin bar (<= 5px). The edge variant pins 4px via --ow-progress-edge-h.
        assert "--ow-progress-edge-h, 4px" in CSS_SRC

    def test_bar_pinned_to_bottom_of_viewport(self):
        # fixed, bottom:0, spanning the width — BELOW the composer (in the .ow-progress--edge kit rule).
        edge = CSS_SRC[CSS_SRC.index(".ow-progress--edge {"):]
        edge = edge[:edge.index("}")]
        assert "position: fixed" in edge
        assert "bottom: 0" in edge

    def test_bar_spans_width_without_scrollbar_overflow(self):
        # left:0/right:0 (NOT 100vw) so the bar never adds a horizontal scrollbar (kit .ow-progress--edge).
        edge = CSS_SRC[CSS_SRC.index(".ow-progress--edge {"):]
        edge = edge[:edge.index("}")]
        assert "left: 0; right: 0" in edge
        # The bar never uses a 100vw width that would overflow the scrollbar gutter.
        assert "width: 100vw" not in JS_PROGRESS and "width: 100vw" not in edge

    def test_bar_uses_theme_accent(self):
        # The progress FILL keeps the theme-accent chain (a fill is a legit accent use) — now in the
        # .ow-progress-fill kit token chain, retaining the #6d4aff final fallback.
        fill = CSS_SRC[CSS_SRC.index(".ow-progress-fill {"):]
        fill = fill[:fill.index("}")]
        assert "var(--accent" in fill
        assert "--accent-primary" in fill

    def test_progress_is_cadence_driven_not_lingering(self):
        # The fill is derived from evictions + the ceremony phase — never a turn count or social play.
        assert "TOTAL_EVICTIONS" in JS_PROGRESS
        assert "PHASE_FRACTION" in JS_PROGRESS

    def test_progress_forced_full_on_post_season(self):
        assert 'moment === "post-season"' in JS_PROGRESS
        assert "return 100" in JS_PROGRESS

    def test_progress_is_monotone_within_a_season(self):
        assert "_lastPct" in JS_PROGRESS

    def test_progress_reads_vault_free_routes_only(self):
        assert "/api/orwell/status" in JS_PROGRESS
        assert "/api/orwell/state" in JS_PROGRESS
        # No secret reads: the module never touches the unsealing route nor reads hidden weights.
        assert "/retrospective" not in JS_PROGRESS
        for forbidden_key in ('"trust"', '"affinity"', '"threat"', ".trust", ".affinity", ".threat"):
            assert forbidden_key not in JS_PROGRESS, forbidden_key

    def test_progress_honors_reduced_motion(self):
        assert "prefers-reduced-motion" in JS_PROGRESS

    def test_progress_refreshes_on_gamechanged(self):
        assert "orwell:gamechanged" in JS_PROGRESS

    def test_progress_is_game_build_gated(self):
        assert "data-game-build" in JS_PROGRESS


class TestSeasonChip:
    def test_chip_reads_season_route(self):
        assert "/api/orwell/season" in JS_PROGRESS

    def test_chip_shown_only_from_season_2(self):
        # Season 1 shows nothing.
        assert "season >= 2" in JS_PROGRESS

    def test_chip_label_format(self):
        assert '"Season " + season' in JS_PROGRESS


# ── B. the post-season "New season" surface (chunk 3) ──────────────────────────────────────

class TestNewSeasonSurface:
    def test_module_is_referenced_in_index(self):
        assert "orwellNewSeason.js" in HTML_SRC

    def test_window_id_present(self):
        assert "orwell-new-season" in JS_NEWSEASON

    def test_gated_on_post_season_state(self):
        # Same terminal gate the engine / retrospective use, read from the Vault-free /state.
        assert "/api/orwell/state" in JS_NEWSEASON
        assert 'moment === "post-season"' in JS_NEWSEASON

    def test_offers_keep_and_recreate(self):
        assert 'data-keep="1"' in JS_NEWSEASON
        assert 'data-keep="0"' in JS_NEWSEASON

    def test_posts_to_next_season_with_confirm(self):
        assert "/api/orwell/next-season" in JS_NEWSEASON
        assert "confirm: true" in JS_NEWSEASON

    def test_mounts_the_shared_portrait_studio(self):
        # Per-season portrait keep/upload/regenerate via the G26/G27 studio.
        assert "OrwellHeadshotStudio" in JS_NEWSEASON

    def test_composes_the_window_kit(self):
        # New windows MUST compose the Lane-F kit.
        assert "OrwellWindowKit" in JS_NEWSEASON

    def test_is_persistent_not_closable(self):
        # Stays until the next season starts — not closable, but minimizable.
        assert "closable: false" in JS_NEWSEASON
        assert "minimizable: true" in JS_NEWSEASON

    def test_opens_a_fresh_session_after_advancing(self):
        # The dead season's transcript must not ride along as narrator context (E65).
        assert "_orwellFreshSession" in JS_NEWSEASON

    def test_has_a_gentle_in_reunion_nudge(self):
        assert "nudge" in JS_NEWSEASON

    def test_is_game_build_gated(self):
        assert "data-game-build" in JS_NEWSEASON

    def test_no_vault_reads(self):
        for forbidden in ("trust", "affinity", "threat", "/retrospective", "confessional"):
            assert forbidden not in JS_NEWSEASON.lower(), forbidden


# ── C. the settings red-zone reset-progress control (chunk 3) ──────────────────────────────

class TestResetProgressControl:
    def test_card_present_in_account_panel_html(self):
        assert 'id="settings-reset-progress-card"' in HTML_SRC
        assert 'id="settings-reset-progress-btn"' in HTML_SRC

    def test_card_starts_hidden_until_game_build(self):
        # The card is display:none in source; initAccount reveals it under the game build.
        idx = HTML_SRC.index('id="settings-reset-progress-card"')
        snippet = HTML_SRC[idx:idx + 200]
        assert "display:none" in snippet

    def test_settings_wires_reset_progress(self):
        assert "settings-reset-progress-btn" in JS_SETTINGS
        assert "/api/orwell/reset-progress" in JS_SETTINGS

    def test_reset_progress_requires_styled_confirm_danger(self):
        # Uses the danger styledConfirm pattern.
        idx = JS_SETTINGS.index("/api/orwell/reset-progress")
        window = JS_SETTINGS[max(0, idx - 1200):idx]
        assert "styledConfirm" in window
        assert "danger: true" in window

    def test_reset_progress_gated_on_game_build(self):
        idx = JS_SETTINGS.index("settings-reset-progress-card")
        window = JS_SETTINGS[idx:idx + 400]
        assert "data-game-build" in window

    def test_reset_progress_posts_confirm(self):
        idx = JS_SETTINGS.index("/api/orwell/reset-progress")
        window = JS_SETTINGS[idx:idx + 300]
        assert "confirm: true" in window
