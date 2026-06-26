"""#642 — THE NOTICE RATCHET: above-composer affordance fragmentation cannot grow back.

The third sibling of the DWE convention gates (test_f3_window_ratchet.py for windows,
test_og_gadget_kit.py for rail gadgets), for the ABOVE-COMPOSER AFFORDANCE ZONE. Every
in-chat affordance that renders above the message box — the game guide, narrator-proposed
decisions, system notices, the Continue prompt — must compose the OrwellNotice kit
(`window.OrwellNoticeKit` + the `.on-*` family) for its anchor + chrome + dismiss + a11y +
animation + (#638) shown/dismissed sync. It must NOT hand-roll its own anchor/dismiss again:

  • no bespoke `insertBefore(<the composer bar>)` anchor — the kit owns the ONE stacked
    container (#orwell-notice-zone) above .chat-input-bar;
  • no per-affordance card shell / dismiss / mount/unmount animation — that's the kit.

A failure here is the audit's above-composer fragmentation (each affordance minting its own
anchor + dismiss, colliding on the slot) regrowing. Compose
`window.OrwellNoticeKit.create(...)` instead (see orwellNotice.js).

BRIGHT LINE: this kit is for AFFORDANCES/notices, never narration/messages. Genuine chat-stream
content (the in-stream `.msg-system` connection-error bubble, the in-stream Continue buttons,
both in chat.js) stays in the chat stream via the renderer and is OUT of this gate.

The engine-status banner (orwellEngineStatus.js) is a position:fixed top-of-viewport GLOBAL
outage banner — NOT above-composer — but #642's owner add-on migrated it onto the SAME kit at
the "top-banner" placement (one shared chrome/dismiss/a11y/animation/sync path; a different
anchor). It is pinned as a kit consumer below, separate from the above-composer-anchor checks.
"""
import os

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JS_DIR = os.path.join(FRONTEND, "static", "js")


def _read(*rel):
    with open(os.path.join(FRONTEND, *rel), encoding="utf-8") as f:
        return f.read()


# ── the above-composer affordances (the migrated set) ─────────────────────────
# These render in the zone above the composer and compose the OrwellNotice kit now. New
# above-composer affordances MUST join this set (compose the kit); nothing may regrow a
# bespoke anchor/dismiss.
ABOVE_COMPOSER_AFFORDANCES = (
    "orwellDecision.js",          # narrator-proposed binding decisions (the charter member)
    "orwellPremiereTutorial.js",  # the premiere / game guide
    "orwellChatHint.js",          # the OOC composer hint surface
)

KIT = "orwellNotice.js"


def test_above_composer_affordances_compose_the_kit():
    for f in ABOVE_COMPOSER_AFFORDANCES:
        js = _read("static", "js", f)
        assert "OrwellNoticeKit.create(" in js, (
            f"{f} must compose the OrwellNotice kit (window.OrwellNoticeKit.create) — "
            "above-composer affordances inherit the anchor/chrome/dismiss, never hand-roll "
            "their own anchor (#642)."
        )


def test_above_composer_affordances_do_not_hand_roll_the_composer_anchor():
    # The ONE stacked anchor above the composer is the kit's (#orwell-notice-zone). A migrated
    # affordance asks the kit to mount it (ensure()/show()) and never re-implements its own
    # insertBefore against the composer bar (.chat-input-bar / #chat-bar).
    import re

    # match insertBefore(..., bar) where bar resolves to the composer — heuristic: any
    # insertBefore call in the same file as a .chat-input-bar / #chat-bar lookup that is the
    # affordance's own anchor. We assert the affordances no longer call insertBefore on a
    # composer-bar parent: the kit owns it.
    for f in ABOVE_COMPOSER_AFFORDANCES:
        js = _read("static", "js", f)
        # The decision card legitimately falls back to #chat-history (the in-stream host) when
        # the kit is unavailable, but that is appendChild, not a composer-bar insertBefore.
        assert "parentNode.insertBefore(card, bar)" not in js, (
            f"{f} re-grew a hand-rolled composer anchor (insertBefore against the bar) — the "
            "kit owns the ONE above-composer zone (orwellNotice.js)."
        )
        assert "parentNode.insertBefore(hint, bar)" not in js, (
            f"{f} re-grew a hand-rolled composer anchor — compose the kit."
        )


def test_kit_owns_the_zone_anchor_and_fallback_chain():
    kit = _read("static", "js", KIT)
    assert "orwell-notice-zone" in kit                       # the single stacked container id
    assert 'querySelector(".chat-input-bar")' in kit         # the composer anchor
    assert 'getElementById("chat-bar")' in kit               # the fallback anchor
    assert "document.body" in kit                             # degraded/headless DOM fallback


def test_kit_provides_the_on_family_chrome():
    kit = _read("static", "js", KIT)
    # the .on-* family the affordances compose (mirrors .ow-* / .og-*)
    for cls in (".on-card", ".on-head", ".on-title", ".on-body", ".on-dismiss"):
        assert cls in kit, cls
    # the four kind skins
    for cls in (".on-guide", ".on-decision", ".on-system-notice", ".on-continue"):
        assert cls in kit, cls
    # the public seam (mirrors window.OrwellWindowKit / window.OrwellGadgetKit)
    assert "window.OrwellNoticeKit" in kit
    assert "create:" in kit


def test_on_family_is_declared_in_style_css_for_themes():
    # the .on-* family is also a source-of-truth declaration in style.css (so the house themes /
    # frost layer paint it), exactly as the .ow-* / .og-* families are.
    css = _read("static", "style.css")
    for cls in ("#orwell-notice-zone", ".on-card", ".on-card .on-head",
                ".on-card .on-title", ".on-card .on-body", ".on-card .on-dismiss",
                ".on-card.on-guide", ".on-card.on-decision"):
        assert cls in css, cls


def test_kit_dismiss_meets_the_touch_floor():
    # the ONE dismiss affordance is the 44px touch floor (WCAG 2.5.5), in the kit + the css.
    kit = _read("static", "js", KIT)
    assert "min-width: 44px" in kit and "min-height: 44px" in kit
    css = _read("static", "style.css")
    # the .on-dismiss block in style.css carries the same floor
    assert ".on-card .on-dismiss" in css
    idx = css.find(".on-card .on-dismiss")
    block = css[idx:idx + 400]
    assert "min-width: 44px" in block and "min-height: 44px" in block


def test_kit_aria_live_is_per_kind():
    # each kind gets an aria-live appropriate to its weight (assertive for decision/system-notice,
    # polite for the ambient guide/continue) — the kit maps it, not each consumer.
    kit = _read("static", "js", KIT)
    assert "aria-live" in kit
    assert "assertive" in kit and "polite" in kit


def test_a11y11_dismiss_aria_label_is_context_specific():
    # A11Y-11 (#598): the ONE dismiss affordance must carry a CONTEXT-SPECIFIC accessible name
    # ("Dismiss — <this notice's title>"), never the bare context-free "Dismiss" that gives a
    # screen-reader user no signal about WHICH banner/notice variant they are dismissing. Since
    # every above-composer affordance + the top-of-viewport engine-status banner compose this one
    # kit, fixing it here makes it context-specific across all banner variants at once.
    import re
    kit = _read("static", "js", KIT)
    # The aria-label must be derived from the notice title (a template concat), not a literal "Dismiss".
    assert re.search(r'setAttribute\(\s*"aria-label"\s*,\s*"Dismiss\s*—\s*"\s*\+\s*this\.o\.title\s*\)', kit), \
        'the dismiss button aria-label must be "Dismiss — " + this.o.title (context-specific) — A11Y-11'
    # A bare context-free aria-label="Dismiss" must NOT be used (the J4 audit's bare-Dismiss finding).
    assert not re.search(r'setAttribute\(\s*"aria-label"\s*,\s*"Dismiss"\s*\)', kit), \
        'the dismiss aria-label must never be the context-free bare "Dismiss" — A11Y-11'
    # An in-place re-skin (update()) — used when a banner transitions variant (down → reconnecting) —
    # must keep the dismiss label in sync with the NEW title, so it never goes stale/context-free.
    assert re.search(r'dismissBtn\.setAttribute\(\s*"aria-label"\s*,\s*"Dismiss\s*—\s*"\s*\+\s*patch\.title\s*\)', kit), \
        "update() must re-skin the dismiss aria-label to the new title when a banner changes variant — A11Y-11"


def test_kit_never_dispatches_gamechanged():
    # g15 invariant: the single `orwell:gamechanged` dispatcher stays in platform.js. The kit
    # only emits the layout-sync event (an allowed seam); no ad-hoc gamechanged dispatch.
    kit = _read("static", "js", KIT)
    assert "new CustomEvent('orwell:gamechanged'" not in kit
    assert 'new CustomEvent("orwell:gamechanged"' not in kit


def test_kit_motion_is_reduced_motion_guarded():
    # the mount/unmount animations are stripped under prefers-reduced-motion.
    kit = _read("static", "js", KIT)
    assert "prefers-reduced-motion" in kit
    assert "on-anim-in" in kit and "on-anim-out" in kit


def test_dismiss_state_syncs_through_the_layout_store():
    # #638: shown/dismissed uses the SAME 0064 capture event (no parallel sync), under a
    # synthetic "notice:<id>" window id, and applies a synced dismiss from the seed OR a peer.
    kit = _read("static", "js", KIT)
    assert "notice:" in kit                              # the synthetic id namespace
    assert "orwell:window-layout" in kit                # the shared capture event
    assert "orwell:layout-seed" in kit and "orwell:layout-changed" in kit
    assert "dismissed" in kit
    # localStorage stays the offline/seed fallback (per-user key)
    assert "orwell-notice-dismissed:" in kit


def test_kit_stacks_deterministically():
    # several affordances present at once stack in a DEFINED order (the issue's acceptance:
    # a decision card vs the guide must not fight for the slot). The kit carries a kind→order map.
    kit = _read("static", "js", KIT)
    assert "KIND_ORDER" in kit
    # the decision (most action-demanding) sits closest to the composer; the guide (ambient) top.
    assert "decision: 40" in kit
    assert "guide: 10" in kit


def test_kit_is_loaded_before_the_affordances():
    # the kit (classic script) must execute before the affordance modules that consume
    # window.OrwellNoticeKit.
    html = _read("static", "index.html")
    assert "orwellNotice.js" in html
    i_kit = html.find("orwellNotice.js")
    for f in ABOVE_COMPOSER_AFFORDANCES + ("orwellEngineStatus.js",):
        assert i_kit < html.find(f), f"{f} loads before the kit it composes"


# ── the engine-status banner: same kit, top-banner placement (#642 owner add-on) ──────────


def test_engine_status_banner_composes_the_kit():
    js = _read("static", "js", "orwellEngineStatus.js")
    assert "OrwellNoticeKit.create(" in js, (
        "orwellEngineStatus.js must compose the OrwellNotice kit (the owner add-on: the error "
        "banner is refactored onto the kit for consistency, #642)."
    )
    # it uses the top-banner placement (a global outage signal, not above-composer) + system-notice kind
    assert '"top-banner"' in js or "top-banner" in js
    assert "system-notice" in js
    # it no longer hand-rolls its own inline <style> banner shell / its own --oes-inset scheme
    assert "#orwell-engine-status" not in js, (
        "orwellEngineStatus.js re-grew its bespoke #orwell-engine-status banner shell — compose the kit."
    )
    assert "--oes-inset" not in js, (
        "orwellEngineStatus.js re-grew its bespoke body-inset (--oes-inset) — the kit owns the "
        "top-banner inset (--on-banner-inset)."
    )


# ── #763: ONE icon language — the icon flows through the kit `icon` slot, never a title glyph ──


def _emoji_chars(s):
    # Any non-ASCII codepoint that reads as a pictograph/emoji (the colour-emoji family the bug
    # baked into the title — 📡 satellite, ⚠ warning, 🎬 clapperboard). Deliberately permissive:
    # punctuation the source legitimately uses (em dash —, arrows →, bullets •, curly quotes) is
    # whitelisted so the gate flags ONLY emoji/symbol glyphs, not typographic punctuation.
    OK = set("—–‘’“”…•→←↔×·")
    out = []
    for ch in s:
        if ord(ch) < 0x2190:  # below the Arrows block — plain ASCII + Latin-1 + general punct
            if ord(ch) < 0x2000:
                continue
        if ch in OK:
            continue
        if ord(ch) >= 0x2000:  # general-punctuation and above: a symbol/emoji we don't whitelist
            out.append(ch)
    return out


def test_engine_status_titles_carry_no_raw_glyph():
    # #763: the banner titles are GLYPH-FREE text. The old bug prepended a colour emoji (📡/⚠/🎬)
    # to the title string, so a full-colour emoji sat next to the kit's monochrome symbols on the
    # sibling banner. The icon now lives in the kit's `icon` slot only; titles are plain text.
    import re

    js = _read("static", "js", "orwellEngineStatus.js")
    # Pull every show(...)/showHolding/showReconnecting title literal — the 2nd arg to show(), and
    # the inline title literals in the two helper wrappers — and assert none carry an emoji glyph.
    titles = re.findall(r'show\(\s*"[^"]*"\s*,\s*"([^"]*)"', js)
    # the helper wrappers call show("degraded", "<title>", ...) — captured by the same regex
    assert titles, "expected to find engine-status banner title literals to check"
    for t in titles:
        bad = _emoji_chars(t)
        assert not bad, (
            f"engine-status banner title {t!r} still carries a raw glyph/emoji {bad} — "
            "#763: pass the icon through the kit `icon` slot, keep the title glyph-free text."
        )


def test_engine_status_passes_icon_through_the_kit_slot():
    # #763: the icon flows through the OrwellNotice kit's dedicated `icon` channel (a semantic key
    # from the kit's ONE monochrome set), not a title glyph. show() resolves a per-kind key and
    # hands it to the kit via update({ icon: ... }).
    js = _read("static", "js", "orwellEngineStatus.js")
    assert "icon:" in js, (
        "orwellEngineStatus.js must pass an `icon` through the kit (update({ icon: ... })) — "
        "#763: the icon flows through the kit's icon slot, never a baked-in title glyph."
    )
    # consistent monochrome icon language: it uses the kit's named severity-family keys (the same
    # keys NOTICE_ICONS defines: info/warn/error), so both banners render the SAME mono SVG glyphs.
    assert '"error"' in js and '"warn"' in js, (
        "orwellEngineStatus.js must use the kit's monochrome icon keys (error=down, warn=degraded) "
        "so both engine-status banners share ONE icon language (#763)."
    )


def test_kit_icon_slot_renders_the_monochrome_set_into_on_icon():
    # The kit's `icon` channel is the single source: a named key resolves to a MONOCHROME inline SVG
    # (currentColor, no colour emoji), rendered into .on-icon. This is what the banner icons compose.
    kit = _read("static", "js", KIT)
    assert "NOTICE_ICONS" in kit                       # the kit's one monochrome glyph set
    assert "on-icon" in kit                            # the decorative icon node before the title
    assert "resolveIcon" in kit                        # the key→glyph resolver
    # currentColor inline SVG (tints with severity, never a fixed-colour emoji)
    assert "currentColor" in kit
    # update() carries the icon through (a state transition re-renders the slot), and the option is
    # documented as a first-class field.
    assert "patch.icon" in kit


def test_kit_supports_the_top_banner_placement():
    kit = _read("static", "js", KIT)
    assert "top-banner" in kit
    assert "orwell-notice-banner" in kit            # the separate top-banner host
    # the body-inset compensation lives in the kit now (so a top banner never occludes the chat top)
    assert "--on-banner-inset" in kit
    assert "paddingTop" in kit
    # the banner placement keeps role=alert / assertive semantics + a guarded slide-in
    assert "on-anim-banner-in" in kit


def test_no_new_above_composer_affordance_hand_rolls_its_anchor():
    # The anti-fragmentation sweep: any module that inserts itself directly above the composer
    # bar (insertBefore against .chat-input-bar's parent) must be a kit consumer or the kit. This
    # catches a NEW affordance regrowing the bespoke anchor the kit replaced.
    import glob
    import re

    # files allowed to reference the composer bar for NON-affordance reasons (layout, the kit,
    # the composer's own modules). The affordances themselves are kit consumers (asserted above).
    # #753: orwellSheet.js is a SIBLING KIT (the iOS bottom-sheet kit), not a hand-rolled
    # affordance — its anchored placement PREFERS the OrwellNotice zone (OrwellNoticeKit.ensureZone)
    # and only falls back to a composer-bar anchor when the notice kit is unavailable (fail-open,
    # the same chain the notice kit itself uses). It is a kit, so it joins the allowed set.
    ALLOWED = set(ABOVE_COMPOSER_AFFORDANCES) | {KIT, "orwellSheet.js"}
    rx = re.compile(r"insertBefore\([^)]*\b(bar|chatBar)\b\)")
    rogue = {}
    for path in glob.glob(os.path.join(JS_DIR, "*.js")):
        name = os.path.basename(path)
        if name in ALLOWED:
            continue
        with open(path, encoding="utf-8") as fh:
            src = fh.read()
        # only flag a file that ALSO anchors to the composer bar (so a generic `insertBefore(x,
        # bar)` in an unrelated list isn't a false positive)
        if ".chat-input-bar" in src and rx.search(src):
            # #951: chat.js's import-prompt banner was migrated ONTO the kit (it now composes
            # window.OrwellNoticeKit.create, a "continue"-kind above-composer notice), so it no
            # longer hand-rolls an anchor at all. This guard keys on .chat-input-bar regardless.
            rogue[name] = True
    assert not rogue, (
        f"NEW above-composer affordance(s) {sorted(rogue)} hand-roll an anchor against the "
        ".chat-input-bar — compose window.OrwellNoticeKit (the ONE stacked zone), #642."
    )


# ── #951: UNIFY ALL notifications onto the kit — the toast system + the import-prompt banner ──────
#
# Every notification surface must share the kit's ONE chrome/icon/dismiss/motion/a11y contract
# (the "Reconnecting to Big Brother…" banner format). The legacy `.toast` system (showToast /
# showError in ui.js) is now a kit consumer at the new "toast" placement, and chat.js's
# import-prompt banner composes the kit too. These gates pin that and prevent the old bespoke
# look from regrowing.


def test_kit_supports_the_toast_placement():
    kit = _read("static", "js", KIT)
    # the new ephemeral-toast placement + its separate corner host
    assert '"toast"' in kit or "toast" in kit
    assert "orwell-notice-toast" in kit                 # the corner-toast host id
    # the toast keeps the .on-card chrome but its OWN slide-from-right entrance/exit (mirrors the
    # legacy toast motion) — both reduced-motion guarded with the rest.
    assert "on-anim-toast-in" in kit and "on-anim-toast-out" in kit
    # auto-dismiss (a toast is ephemeral) lives in the kit, not the consumer
    assert "autoDismissMs" in kit and "_armAutoDismiss" in kit
    # swipe-to-dismiss for touch is kit-owned now (moved out of ui.js)
    assert "_wireSwipe" in kit


def test_toast_placement_motion_is_reduced_motion_guarded():
    kit = _read("static", "js", KIT)
    # the toast slide-in/out join the same prefers-reduced-motion strip as the zone/banner anims
    import re
    m = re.search(r"prefers-reduced-motion: reduce\s*\)\s*\{([^}]*on-anim[^}]*)\}", kit)
    assert m, "expected a reduced-motion block listing the kit animations"
    block = m.group(1)
    assert "on-anim-toast-in" in block and "on-anim-toast-out" in block, (
        "the toast slide-in/out must be stripped under prefers-reduced-motion like every other "
        "kit animation (#951)."
    )


def test_toast_severity_drives_role_and_arialive():
    # #951: a toast's role/aria-live track its severity — an error/warn toast is consequential
    # (role=alert, aria-live=assertive); a plain/success toast is a passive confirmation
    # (role=status, aria-live=polite). This is the legacy showError's assertive announcement,
    # preserved through the kit.
    kit = _read("static", "js", KIT)
    assert "_liveFor" in kit
    # the toast branch maps error/warn → alert/assertive
    assert "alert" in kit and "status" in kit
    assert "assertive" in kit and "polite" in kit


def test_showtoast_routes_through_the_kit_not_the_legacy_toast():
    # The central toast API (ui.js showToast/showError) must compose the kit, NOT touch the old
    # `.toast` element/classes — that is the unification (#951). The old hand-rolled DOM
    # (#toast element, .toast/.show/.exiting classes, _wireToastSwipe) is gone from ui.js.
    ui = _read("static", "js", "ui.js")
    assert "OrwellNoticeKit.create(" in ui, (
        "ui.js showToast/showError must compose window.OrwellNoticeKit (the toast placement) — #951."
    )
    assert "placement: 'toast'" in ui or 'placement: "toast"' in ui
    # the legacy toast DOM is no longer driven from ui.js
    assert "getElementById('toast')" not in ui and 'getElementById("toast")' not in ui, (
        "ui.js must not drive the legacy #toast element anymore — route through the kit (#951)."
    )
    assert "classList.add('show')" not in ui and "classList.add('exiting')" not in ui, (
        "ui.js must not toggle the legacy .toast .show/.exiting classes — the kit owns toast motion."
    )
    assert "_wireToastSwipe" not in ui, (
        "swipe-to-dismiss moved into the kit (_wireSwipe) — ui.js must not re-implement it (#951)."
    )
    # the public API names are unchanged (88 callers depend on them)
    assert "export function showToast(" in ui
    assert "export function showError(" in ui


def test_showtoast_preserves_action_and_icon_semantics():
    # The unified toast still supports the legacy action affordance (Undo + Ctrl-Z hint + ×) and
    # the leading icons (check → success severity, spinner → in-progress) — only the CHROME changed.
    ui = _read("static", "js", "ui.js")
    # the action button / hint / dismiss-× path is preserved
    assert "actionLabel" in ui and "actionHint" in ui
    # leadingIcon 'check' maps to the kit's success severity (its mono check glyph)
    assert "'check'" in ui or '"check"' in ui
    assert "success" in ui
    # the spinner whirlpool (a live cue the static icon set doesn't cover) still renders
    assert "createWhirlpool" in ui


def test_import_prompt_banner_composes_the_kit():
    # #951: chat.js's "Import to document library?" prompt was a hand-rolled above-composer banner
    # with its own anchor + × ; it now composes the kit (a "continue"-kind notice), so it shares
    # the ONE chrome/dismiss/motion/a11y contract.
    chat = _read("static", "js", "chat.js")
    assert "OrwellNoticeKit.create(" in chat, (
        "chat.js's import-prompt banner must compose the OrwellNotice kit (#951)."
    )
    # it no longer hand-rolls its own .import-prompt-banner div / insertBefore against #chat-bar
    assert "className = 'import-prompt-banner'" not in chat, (
        "chat.js re-grew the bespoke .import-prompt-banner shell — compose the kit (#951)."
    )
    assert "import-prompt-dismiss" not in chat, (
        "chat.js re-grew its bespoke dismiss × — the kit owns the ONE dismiss affordance (#951)."
    )
