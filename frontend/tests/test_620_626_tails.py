"""#620 / #626 roundup tails.

Source-pinned convention checks (name-agnostic; no running engine), matching the rest of the
FE test gate. Each finding below was re-verified against CURRENT source before deciding whether
it needed a code change:

  NARR-4 (#620) — invented-houseguest guard misses copula/existential intros + single-token
    phantoms. ALREADY SHIPPED: `_COPULA_NAME_RE` / `_EXISTENTIAL_NAME_RE` in
    routes/chat_helpers.py cover exactly this shape (see test_narr3_roster_guard.py for the
    behavioral gate). No code change here — this file only pins the already-fixed state stays
    fixed, since a future refactor could silently drop the regexes.

  NARR-6 (#620) — casting turns ran reasoning=medium under a hard 2048 max_tokens cap, so
    medium-effort reasoning could truncate the last voiced intro mid-sentence. ALREADY SHIPPED
    (the #1166/A9 fix): `casting` was dropped from both `token_policy._DEFAULT_MAX_TOKENS` and
    `settings.DEFAULT_SETTINGS["max_tokens_budget"]`, so it now resolves to the model-aware cap
    (≫2048 — see test_narration_maxtokens_no_truncate.py) instead of the flat 2048 that caused
    the truncation. `reasoning_budget.casting = "medium"` is an explicit, ADR-0010-ratified
    owner ruling (2026-06-21) — left as-is; the truncation VECTOR is what NARR-6 flagged, and
    removing the flat max_tokens cap closes it regardless of reasoning effort.

  UX-2 (#626) — the gadget-rail collapsed-strip duplicate `aria-label="The Cast"` (both
    orwell-cast and orwell-cast-pin). ALREADY SHIPPED — the registry differentiates them
    ("The Cast" / "Pinned Cast"). Pinned here so a future registry edit can't silently
    reintroduce the collision.

  UX-3 (#626) — the premiere-tutorial dismiss button had visible text "Close guide" absent
    from its aria-label ("Dismiss the premiere guide") — a WCAG 2.5.3 Label-in-Name violation.
    ALREADY SHIPPED (structurally, via refactor): the tutorial no longer hand-rolls that
    button — it composes the shared OrwellNoticeKit dismiss control, which is a glyph-only
    "x" (no visible text label to mismatch).

  UX-4 (#626) — retrospective vault headings/button carry a bare leading emoji with no
    aria-hidden wrap (WCAG 1.1.1: a screen reader reads "closed lock with key…"). ALREADY
    SHIPPED — every one of the four sites sets an explicit `aria-label` that strips the emoji.

  UX-5 (#626) — six static `role="dialog"` elements (Brain/Theme/Prompt/Rename/Cookbook/
    Settings) had no `aria-modal`. PARTIALLY shipped already: Settings and Theme were migrated
    onto the OrwellWindow kit, which stamps `aria-modal="true"` on ITS OWN wrapper element at
    runtime (the static host div is just inert content lifted into the kit's `.ow-body` — see
    orwellWindow.js:620 `el.setAttribute('aria-modal', 'true')`). The remaining four — Brain
    (#memory-modal), Prompt (#custom-preset-modal), Rename (#rename-session-modal), Cookbook
    (#cookbook-modal) — are still the legacy `.modal` family and genuinely had no aria-modal.
    FIXED HERE: static `aria-modal="true"` added to all four. (Their Tab-cycling focus trap was
    already fixed separately — see the AXE-8 comment in static/js/ui.js — this file only closes
    the missing-attribute half.)

  UX-6 (#626) — the season chip's aria-label was a static "Season number" placeholder, never
    updated to the live season. ALREADY SHIPPED — paintChip() sets `aria-label` to "Season N"
    on every repaint.

  UX-7 (#626) — the Diary Room's in-composer pill (role="status") announced NOTHING on entry:
    enterDRMode() only toggled `display`, and aria-live fires on a CONTENT mutation, not a
    style change — so the private OOC-channel switch was silent to screen readers. FIXED HERE:
    the pill's label starts empty and enterDRMode() (re-)injects the label text on every
    entry, forcing the mutation the live region needs to actually announce.

  UX-8 (#626) — finale shortcut buttons' emoji/arrow glyphs were unguarded in the accessible
    name (e.g. "ballot box with ballot, Vote for X"). ALREADY SHIPPED (tagged A11Y-10 in
    source) — addBtn() strips the leading glyph from the aria-label.
"""
import os
import re

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATIC_JS = os.path.join(FRONTEND, "static", "js")


def _read_js(name: str) -> str:
    with open(os.path.join(STATIC_JS, name), encoding="utf-8") as f:
        return f.read()


def _read(*parts) -> str:
    with open(os.path.join(FRONTEND, *parts), encoding="utf-8") as f:
        return f.read()


INDEX = _read("static", "index.html")
GADGET_RAIL = _read_js("orwellGadgetRail.js")
PREMIERE = _read_js("orwellPremiereTutorial.js")
RETRO = _read_js("orwellRetrospective.js")
SEASON_PROGRESS = _read_js("orwellSeasonProgress.js")
DIARY_ROOM = _read_js("orwellDiaryRoom.js")
FINALE = _read_js("orwellFinale.js")
UI_JS = _read_js("ui.js")


# ── NARR-4 (#620) — already shipped; pin it stays shipped ──────────────────────────────────


def test_narr4_copula_and_existential_phantom_patterns_still_present():
    import sys
    if FRONTEND not in sys.path:
        sys.path.insert(0, FRONTEND)
    import routes.chat_helpers as chat_helpers  # noqa: E402
    assert hasattr(chat_helpers, "_COPULA_NAME_RE"), (
        "the NARR-4 copula phantom-name pattern must stay wired in "
        "routes/chat_helpers.py — regression would reopen #620/NARR-4."
    )
    assert hasattr(chat_helpers, "_EXISTENTIAL_NAME_RE")
    known_first = {"marcus"}
    known_full = {"marcus webb"}
    # A genuinely single-token invented name via a copula frame must still be flagged.
    assert chat_helpers._sentence_names_invented(
        "Zephyr is a new houseguest.", known_first, known_full) == "Zephyr"
    # A real roster first name in the same frame must not be flagged.
    assert chat_helpers._sentence_names_invented(
        "Marcus is a new houseguest.", known_first, known_full) is None


# ── NARR-6 (#620) — already shipped (the max_tokens half); pin it stays shipped ─────────────


def test_narr6_casting_max_tokens_seed_stays_absent():
    settings_src = _read("src", "settings.py")
    token_policy_src = _read("src", "token_policy.py")
    m = re.search(r'"max_tokens_budget":\s*\{(.*?)\n\s*\},', settings_src, re.S)
    assert m, "max_tokens_budget dict not found in settings.py"
    body = m.group(1)
    assert '"casting"' not in body, (
        "settings.py's max_tokens_budget seed must NOT reintroduce a literal 'casting' cap — "
        "that silently re-activates the #620 NARR-6/A9 truncation vector (a flat cap always "
        "wins over token_policy's model-aware default)."
    )
    assert '"narration"' not in body, (
        "narration must stay out of the seed for the same reason (#620 NARR-5)."
    )
    # Bind the assertion to the _DEFAULT_MAX_TOKENS INITIALIZER itself (not a whole-file
    # substring, which a comment or an unrelated dict could satisfy/spoof).
    dm = re.search(r"_DEFAULT_MAX_TOKENS\s*=\s*\{(.*?)\n\}", token_policy_src, re.S)
    assert dm, "_DEFAULT_MAX_TOKENS dict literal not found in token_policy.py"
    default_body = dm.group(1)
    casting_entries = re.findall(r'"casting"\s*:\s*([^,\n]+)', default_body)
    assert casting_entries, "_DEFAULT_MAX_TOKENS must still carry an explicit 'casting' key"
    for value in casting_entries:
        assert value.strip() == "None", (
            f"_DEFAULT_MAX_TOKENS['casting'] must stay None (model-aware cap), found "
            f"{value.strip()!r} — a literal int here IS the #620 NARR-6 truncation vector, "
            "independent of reasoning effort."
        )


# ── UX-2 (#626) — already shipped; pin it stays shipped ─────────────────────────────────────


def test_ux2_gadget_rail_cast_titles_are_distinct():
    m = re.search(r"var REGISTRY = \[(.*?)\];", GADGET_RAIL, re.S)
    assert m, "gadget REGISTRY not found"
    body = m.group(1)
    titles = re.findall(r'title:\s*"([^"]+)"', body)
    assert len(titles) == len(set(titles)), (
        f"gadget-rail registry titles must be unique (they become the collapsed-strip "
        f"aria-label) — duplicates found: {titles} (#626 UX-2)."
    )


# ── UX-3 (#626) — already shipped (structurally, via refactor); pin it stays shipped ────────


def test_ux3_premiere_dismiss_has_no_labelinname_violation():
    # The old hand-rolled "Close guide" button (visible text absent from its aria-label) is
    # gone; the tutorial composes the shared kit's glyph-only dismiss instead.
    assert "Close guide" not in PREMIERE
    assert "Dismiss the premiere guide" not in PREMIERE
    assert "OrwellNoticeKit" in PREMIERE, (
        "the premiere tutorial should compose the shared notice kit (glyph-only dismiss) "
        "rather than hand-roll its own labelled close button (#626 UX-3)."
    )


# ── UX-4 (#626) — already shipped; pin it stays shipped ─────────────────────────────────────


_UX4_EMOJI = ("\U0001F513", "\U0001F5F3", "\U0001F510")  # 🔓 🗳 🔐


def test_ux4_retrospective_emoji_headings_have_explicit_aria_label():
    # Every string literal that opens with one of the three decorative glyphs must be followed
    # NEARBY (same element, next couple of lines) by an explicit aria-label whose text is the
    # emoji-free remainder — per-site, not a global setter count (which any unrelated
    # setAttribute call could satisfy).
    emoji_alt = "".join(_UX4_EMOJI)
    sites = list(re.finditer(
        r'"([' + emoji_alt + r'])️?\s*([^"]+)"', RETRO))
    assert len(sites) >= 4, (
        f"expected the four retrospective emoji-led strings (headings + unseal CTA), found "
        f"{len(sites)} — if they were removed/renamed, re-verify UX-4 (#626)."
    )
    for m in sites:
        glyph, text = m.group(1), m.group(2).strip()
        nearby = RETRO[m.end():m.end() + 300]
        lm = re.search(r'setAttribute\("aria-label",\s*"([^"]+)"\)', nearby)
        assert lm, (
            f"the element whose text starts with {glyph!r} ({text!r}) must set an explicit "
            "aria-label right after it — the emoji is decorative and must not reach the "
            "accessible name (#626 UX-4)."
        )
        label = lm.group(1)
        for g in _UX4_EMOJI:
            assert g not in label, (
                f"the aria-label for {text!r} must EXCLUDE the decorative emoji, found "
                f"{label!r} (#626 UX-4)."
            )
        assert label == text, (
            f"the aria-label should be the emoji-free visible text: expected {text!r}, "
            f"found {label!r} (#626 UX-4 / WCAG 2.5.3 label-in-name)."
        )


# ── UX-5 (#626) — FIXED HERE: aria-modal on the 4 still-legacy static dialogs ───────────────


_LEGACY_MODAL_IDS = ("memory-modal", "custom-preset-modal", "rename-session-modal", "cookbook-modal")


def test_ux5_legacy_static_dialogs_have_aria_modal():
    for modal_id in _LEGACY_MODAL_IDS:
        m = re.search(r'<div id="' + re.escape(modal_id) + r'" class="modal hidden">', INDEX)
        assert m, f"#{modal_id} wrapper not found (or its shape changed) — re-check the fix"
        # Find the role="dialog" content div nested inside — it must carry aria-modal="true".
        tail = INDEX[m.end():m.end() + 400]
        content_m = re.search(r'<div class="modal-content[^"]*"\s+role="dialog"[^>]*>', tail)
        assert content_m, f"#{modal_id}'s role=dialog content div not found nearby"
        assert 'aria-modal="true"' in content_m.group(0), (
            f"#{modal_id}'s dialog div must carry aria-modal=\"true\" (#626 UX-5) — without it "
            "a screen-reader virtual cursor can wander outside the open modal."
        )


def test_ux5_kit_migrated_dialogs_get_aria_modal_at_runtime_not_statically():
    # Settings + Theme are lifted into the OrwellWindow kit, which stamps aria-modal on its OWN
    # wrapper (orwellWindow.js) — the static host content must NOT also claim aria-modal itself
    # (that would create a nested/duplicate dialog once lifted into the kit's .ow-body).
    assert 'id="settings-host" hidden' in INDEX
    assert 'id="theme-host" style="display:none"' in INDEX
    # Pin the EXACT runtime stamp — this line (modal:true branch of the kit's root builder) is
    # what makes the Settings/Theme dialogs aria-modal at runtime.
    ow = _read_js("orwellWindow.js")
    assert "el.setAttribute('aria-modal', 'true')" in ow, (
        "orwellWindow.js must stamp aria-modal='true' on its modal wrapper — the kit-migrated "
        "dialogs (Settings/Theme) rely on this runtime stamp for their UX-5 fix (#626)."
    )
    # Negative: the static host CONTENT divs carry no aria-modal of their own (a static claim
    # would duplicate the kit's runtime one on the outer wrapper).
    settings_tag = re.search(
        r'<div class="modal-content settings-modal-content"[^>]*>', INDEX)
    assert settings_tag, "the settings-modal-content div not found in index.html"
    assert "aria-modal" not in settings_tag.group(0), (
        "the static settings-modal-content must NOT claim aria-modal — the OrwellWindow kit "
        "stamps it on its own wrapper at runtime; a static duplicate nests two aria-modal "
        "surfaces (#626 UX-5)."
    )
    theme_tag = re.search(r'<div id="theme-popup"[^>]*>', INDEX)
    assert theme_tag, "the #theme-popup div not found in index.html"
    assert "aria-modal" not in theme_tag.group(0), (
        "the static #theme-popup must NOT claim aria-modal — same kit-runtime reasoning as "
        "settings (#626 UX-5)."
    )


def test_ux5_legacy_modal_family_still_has_the_axe8_focus_trap():
    # The other half of UX-5 ("unconfirmed focus trap") was already fixed separately — pin that
    # it stays wired so a regression here isn't masked by "well, aria-modal is set".
    assert "AXE-8" in UI_JS
    assert re.search(r"e\.key !== ['\"]Tab['\"]", UI_JS), (
        "the shared .modal family Tab-cycling focus trap must stay wired (AXE-8) alongside "
        "the aria-modal fix above — together they close UX-5."
    )


# ── UX-6 (#626) — already shipped; pin it stays shipped ─────────────────────────────────────


def test_ux6_season_chip_aria_label_reflects_live_season():
    assert 'chip.setAttribute("aria-label", "Season " + season)' in SEASON_PROGRESS, (
        "paintChip() must set a LIVE aria-label (\"Season N\"), not leave the static "
        "placeholder \"Season number\" (#626 UX-6)."
    )


# ── UX-7 (#626) — FIXED HERE: DR mode-entry now mutates the live-region content ─────────────


def test_ux7_diary_room_pill_starts_with_an_empty_label():
    m = re.search(r"function ensurePill\(\)\s*\{.*?\n  \}", DIARY_ROOM, re.S)
    assert m, "ensurePill() not found"
    body = m.group(0)
    assert re.search(r"pill\.innerHTML = `<span></span>", body), (
        "the DR pill's label span must start EMPTY — the text is injected by enterDRMode() so "
        "that ENTRY itself is the content mutation the aria-live region needs (#626 UX-7)."
    )
    assert 'pill.setAttribute("role", "status")' in body


def test_ux7_enter_dr_mode_injects_the_label_before_showing_the_pill():
    m = re.search(r"function enterDRMode\(\)\s*\{.*?\n  \}", DIARY_ROOM, re.S)
    assert m, "enterDRMode() not found"
    body = m.group(0)
    label_idx = body.find("label.textContent = DR_ENTRY_LABEL")
    display_idx = body.find('pill.style.display = "flex"')
    assert label_idx != -1, (
        "enterDRMode() must inject DR_ENTRY_LABEL into the pill's label on every entry — a "
        "pure display:none->flex toggle never fires the role=status live region (#626 UX-7)."
    )
    assert display_idx != -1
    assert label_idx < display_idx, (
        "the label text must be set BEFORE the pill becomes visible (so a screen reader that "
        "picks up the region has real content, not a flicker from empty to full)."
    )


def test_ux7_dr_entry_label_is_non_empty_and_mentions_diary_room():
    m = re.search(r'DR_ENTRY_LABEL\s*=\s*"([^"]+)"', DIARY_ROOM)
    assert m, "DR_ENTRY_LABEL constant not found"
    label = m.group(1)
    assert "Diary Room" in label
    assert "out-of-character" in label or "ooc" in label.lower()


# ── UX-8 (#626) — already shipped; pin it stays shipped ─────────────────────────────────────


def test_ux8_finale_buttons_strip_leading_glyph_from_aria_label():
    m = re.search(r"const addBtn = \(label, text\) => \{.*?\n    \};", FINALE, re.S)
    assert m, "addBtn() not found"
    body = m.group(0)
    # Pin the EXACT strip expression — /^[^\p{L}\p{N}]+/u removes every leading char that is
    # neither a Unicode letter nor a digit (the emoji/arrow prefix + its trailing space), and
    # the `|| label` keeps a glyph-only label from collapsing to an empty accessible name.
    strip_expr = 'label.replace(/^[^\\p{L}\\p{N}]+/u, "").trim() || label'
    assert strip_expr in body, (
        "addBtn() must strip the leading emoji/arrow glyph from the accessible name with the "
        f"exact expression {strip_expr!r} so a screen reader doesn't read "
        '"ballot box with ballot, Vote for X" (#626 UX-8).'
    )
    assert 'btn.setAttribute("aria-label"' in body, (
        "the stripped name must be applied as the button's aria-label (#626 UX-8)."
    )
    # Prove the semantics on a representative label: emulate the JS pattern (strip leading
    # non-letter/non-digit chars) on the exact shapes the finale renders.
    def _strip(label: str) -> str:
        stripped = re.sub(r"^[^\w]+", "", label, flags=re.UNICODE).strip()
        return stripped or label
    assert _strip("\U0001F5F3 Vote for X") == "Vote for X"
    assert _strip("→ Own my game") == "Own my game"
    assert _strip("✍ Give your opening statement") == "Give your opening statement"
