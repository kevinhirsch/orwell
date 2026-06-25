"""Issue #752 (Genius #14) — PERSISTENT surfaces keep STABLE positions; only
TRANSIENT surfaces animate.

NN/g's deepest critique of the glass UI was learnability: "nothing stayed where you
left it." THE POLICY (documented in orwellSlots.js, the geometry-persistence kit):

  PERSISTENT surfaces — the nav sidebar (#sidebar), the gadget rail (#gadget-rail),
  and the Windows dock (#minimized-dock) — keep STABLE POSITIONS across game-phase
  changes, the 20-30s poll / `orwell:gamechanged` refresh, and page reloads. They do
  NOT relocate and do NOT replay an entrance/slide/fly animation on those events — an
  entrance plays only on FIRST mount. Position/side/collapse/order is read from
  PERSISTED state on load and re-applied IDEMPOTENTLY.

  TRANSIENT surfaces — toasts, decision cards, sheets, the floating game windows —
  animate in/out freely (that's their job), from a STABLE anchor.

This is a SOURCE-PINNED guard (CI has no GPU compositor; the live behaviour is shown
by the refresh/reload position-sampling evidence on the PR). It pins:
  1. The dock entrance animation is OPT-IN per chip (.chip-entering), never blanket
     on .minimized-dock-chip — so a dock re-render doesn't re-fly every docked chip.
  2. _renderDock adds .chip-entering ONLY to a genuinely new chip (guarded by the
     previous-pass _renderedChipIds snapshot).
  3. The three persistent surfaces restore position/side/collapse/order from PERSISTED
     state on init (so a reload lands them where they were).
  4. Their `orwell:gamechanged` / poll handlers are idempotent re-syncs — none
     re-mounts/relocates the surface or re-adds an entrance-animation class on refresh.
  5. The OrwellSlots reveal animation fires only on a hidden->shown transition, never
     on every restack (a poll-driven restack must not re-animate a persistent panel).
  6. The policy is documented in source (so the rule survives future edits).
"""
import re
from pathlib import Path

FE = Path(__file__).resolve().parents[1]
CSS = (FE / "static" / "style.css").read_text(encoding="utf-8")
SLOTS_JS = (FE / "static" / "js" / "orwellSlots.js").read_text(encoding="utf-8")
DOCK_JS = (FE / "static" / "js" / "modalManager.js").read_text(encoding="utf-8")
RAIL_JS = (FE / "static" / "js" / "orwellGadgetRail.js").read_text(encoding="utf-8")
SIDEBAR_JS = (FE / "static" / "js" / "sidebar-layout.js").read_text(encoding="utf-8")


def _css_blocks(selector_literal: str):
    """All declaration blocks whose selector LIST contains selector_literal exactly."""
    out = []
    for m in re.finditer(r"([^{}]+)\{([^{}]*)\}", CSS):
        selectors = m.group(1)
        if selector_literal in selectors:
            out.append((selectors.strip(), m.group(2)))
    return out


# ── 1. The dock entrance animation is OPT-IN per chip, never blanket ─────────────────
def test_dock_chip_entrance_is_opt_in_not_blanket():
    """The BASE .minimized-dock-chip rule must NOT carry `animation: dock-chip-in` —
    otherwise every chip re-flies on every _renderDock rebuild (rows.innerHTML=''),
    which is the 'nothing stays put' defect on the persistent dock."""
    base = [
        body for (sel, body) in _css_blocks(".minimized-dock-chip")
        # the BARE base rule — not the .chip-entering / :hover / theme-frosted variants
        if re.search(r"(^|,)\s*\.minimized-dock-chip\s*$", sel.replace("\n", " ").strip())
        or sel.strip() == ".minimized-dock-chip"
    ]
    assert base, "could not find the base .minimized-dock-chip rule"
    for body in base:
        assert "dock-chip-in" not in body, (
            "the BASE .minimized-dock-chip rule must NOT play dock-chip-in — a persistent "
            "surface re-render would re-animate every already-docked chip (#752)"
        )


def test_dock_chip_entrance_gated_behind_chip_entering():
    """The entrance keyframe is applied ONLY behind the .chip-entering modifier."""
    entering = _css_blocks(".minimized-dock-chip.chip-entering")
    assert entering, ".minimized-dock-chip.chip-entering rule is missing (#752)"
    assert any("dock-chip-in" in body for (_sel, body) in entering), (
        ".minimized-dock-chip.chip-entering must carry the dock-chip-in entrance animation"
    )


# ── 2. _renderDock adds .chip-entering ONLY to a genuinely NEW chip ──────────────────
def test_render_dock_marks_only_new_chips_entering():
    """A chip whose id was in the PREVIOUS pass (_renderedChipIds) must NOT be marked
    .chip-entering — only the transient newcomer animates; the survivors hold position."""
    assert "_renderedChipIds.has(id)" in DOCK_JS, (
        "_renderDock must consult the previous-pass _renderedChipIds snapshot to decide "
        "which chip is genuinely new (#752)"
    )
    # the add must be guarded by the NEGATED previous-pass membership
    assert re.search(
        r"if\s*\(\s*!\s*_renderedChipIds\.has\(id\)\s*\)\s*[^;]*chip-entering",
        DOCK_JS,
    ), "the .chip-entering class must be added ONLY when the chip id was NOT in the prior pass"


def test_render_dock_snapshot_repopulated_after_render():
    """_renderedChipIds is the prior-pass memory: it must be cleared + repopulated at the
    END of _renderDock so the NEXT render can tell new from surviving chips."""
    assert "_renderedChipIds.clear()" in DOCK_JS
    assert re.search(r"_renderedChipIds\.add\(id\)", DOCK_JS)


# ── 3. Each persistent surface restores its position from PERSISTED state on load ────
def test_sidebar_restores_side_from_storage_on_init():
    """The sidebar side (left/right) is read from persisted Storage on init, so a reload
    lands it on the same edge."""
    assert "Storage.get(Storage.KEYS.SIDEBAR_SIDE)" in SIDEBAR_JS, (
        "the sidebar must restore its persisted side on init (#752 reload stability)"
    )


def test_gadget_rail_restores_collapse_side_order_on_init():
    """The rail restores collapse, side, and per-user gadget order from persisted state."""
    assert "applyCollapsed(lsGet(COLLAPSE_KEY)" in RAIL_JS, (
        "the rail must restore its persisted collapsed state on init"
    )
    # side defers to the sidebar (single source of truth) with a persisted fallback
    assert "lsGet(SIDE_KEY)" in RAIL_JS, "the rail must restore its persisted side on init"
    # order is restored via loadOrder() applied in decorateAll()
    assert "function loadOrder" in RAIL_JS and "applyOrder()" in RAIL_JS, (
        "the rail must restore its persisted per-user gadget order on init"
    )


def test_dock_position_restored_and_clamped_from_storage():
    """The dock pad position is persisted + clamped into the current viewport on load
    (a position saved on a bigger screen can't strand the dock off-screen on reload)."""
    assert "_DOCK_STORAGE_KEY" in DOCK_JS and "_loadDockState" in DOCK_JS, (
        "the dock must restore its persisted position on load (#752)"
    )
    # clamp present in the load path
    i = DOCK_JS.find("function _loadDockState")
    assert i != -1
    load = DOCK_JS[i:i + 1400]
    assert "Math.max" in load and "Math.min" in load, (
        "the restored dock position must be clamped into the current viewport"
    )


# ── 4. The gamechanged / poll handlers are idempotent re-syncs (no relocate/re-anim) ─
def test_rail_gamechanged_handlers_do_not_remount_or_reanimate():
    """The rail's gamechanged + poll handlers (syncVisibility / decorateAll) re-derive
    visibility/strip/order idempotently — they must NOT remove+re-append the rail or add
    an entrance-animation class. (Re-mounting would replay any CSS entrance + lose
    scroll/position.)"""
    assert 'addEventListener("orwell:gamechanged", syncVisibility)' in RAIL_JS
    assert 'addEventListener("orwell:gamechanged", decorateAll)' in RAIL_JS
    # Neither handler tears the rail out of the DOM.
    for fn_name in ("function syncVisibility", "function decorateAll"):
        i = RAIL_JS.find(fn_name)
        assert i != -1, f"{fn_name} not found"
        body = RAIL_JS[i:i + 900]
        assert "rail.remove(" not in body, (
            f"{fn_name} must not remove the rail from the DOM on a refresh (#752)"
        )
        # no entrance/slide/fly-in class is (re-)applied on a refresh
        for anim_cls in ("anim-in", "slide-in", "fly-in", "entrance"):
            assert anim_cls not in body, (
                f"{fn_name} must not (re-)add an entrance animation class on a refresh"
            )


def test_sidebar_has_no_gamechanged_relocate():
    """The sidebar position must not be driven by `orwell:gamechanged` at all — its side
    is persisted + (optionally) synced cross-device, never re-placed on a poll refresh."""
    assert "orwell:gamechanged" not in SIDEBAR_JS, (
        "the sidebar must not relocate/re-animate on orwell:gamechanged (#752): its side "
        "is persisted, and cross-device side changes ride the dedicated layout-seed/"
        "layout-changed seam, not the freshness poll"
    )


def test_dock_render_not_triggered_by_gamechanged_or_poll():
    """_renderDock rebuilds chips only on dock MUTATIONS (minimize/restore/close), never
    on a phase change or the freshness poll — so a refresh never re-renders (and, before
    #752, re-animated) the persistent dock."""
    assert "orwell:gamechanged" not in DOCK_JS, (
        "the dock must not re-render on orwell:gamechanged (#752)"
    )


# ── 5. OrwellSlots reveal animation fires only on hidden->shown, not every restack ───
def test_slots_animate_only_on_reveal_not_on_restack():
    """A poll-driven restack of a slotted panel must NOT replay its entrance. The slot
    observer calls animateIn ONLY on a hidden->shown transition (`!hidden && _wasHidden`),
    never on a plain restack write."""
    assert "if (!hidden && _wasHidden) animateIn(el)" in SLOTS_JS, (
        "OrwellSlots must animate a panel only on a hidden->shown reveal, never on every "
        "style write / restack (#752 — a refresh restack must not re-animate)"
    )
    # the comment intent is pinned too
    assert "animate on reveal, not on every write" in SLOTS_JS


# ── 6. The policy itself is documented in source ────────────────────────────────────
def test_policy_documented_in_source():
    assert "PERSISTENT-SURFACE STABILITY POLICY" in SLOTS_JS, (
        "the #752 persistent-surface stability policy must be documented in orwellSlots.js "
        "so the rule survives future edits"
    )
    # the three persistent surfaces are named in the policy
    for surf in ("#sidebar", "#gadget-rail", "#minimized-dock"):
        assert surf in SLOTS_JS, f"the policy must name the persistent surface {surf}"
