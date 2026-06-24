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
    ALLOWED = set(ABOVE_COMPOSER_AFFORDANCES) | {KIT}
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
            # chat.js's import-prompt banner anchors to #chat-bar and auto-dismisses — it is a
            # transient TOAST, not a persistent affordance (classified out, like the in-stream
            # notices). It does NOT use .chat-input-bar; this guard keys on .chat-input-bar.
            rogue[name] = True
    assert not rogue, (
        f"NEW above-composer affordance(s) {sorted(rogue)} hand-roll an anchor against the "
        ".chat-input-bar — compose window.OrwellNoticeKit (the ONE stacked zone), #642."
    )
