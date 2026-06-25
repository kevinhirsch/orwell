"""#794 follow-up — windows drag FREELY in any direction and stay exactly where
dropped. The two release-time "snap" systems that re-anchored a window AGAINST the
user's drop intent are RETIRED (owner-approved):

  1. modalSnap's left/right EDGE-SNAP dock, armed from the shared drag helper
     (windowDrag.js). Dropping a window with the cursor within 60px of a side edge
     force-re-anchored it into a full-height docked side panel (pinned to the edge,
     body pushed) and the dock was sticky (un-dock needed an 80px pull-away).
  2. tileManager's 9-zone window TILING. A drag whose cursor ended near an
     edge/corner re-anchored the window a beat after release to fill a half/quarter/
     maximize zone.

Both fought the basic expectation the owner described: "pull a window in any
direction and drop it where you let go." The live before/after behaviour is captured
by scripts/browser_smoke.py-style Playwright drag-sampling; THESE are the cheap
source-pins so the retirement can't silently regress.

Owner ruling (verbatim intent): "double-check that the snapping to the left and
right isn't messing up windows pulling in any direction. I don't actually need the
snapping if it's a problem — we could probably drop the whole thing."
"""
import os

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*parts):
    with open(os.path.join(FRONTEND, *parts), encoding="utf-8") as f:
        return f.read()


# ── 1) windowDrag.js no longer arms the left/right edge-snap dock ──────────────

def test_windowdrag_does_not_arm_edge_dock_controllers_on_drag():
    """The drag helper must NOT call makeEdgeDockController — that is what created a
    side dock on release. The import itself is gone; only clearRightDock survives
    (used to peel a remembered-docked window back to free-floating when grabbed)."""
    js = _read("static", "js", "windowDrag.js")
    assert "makeEdgeDockController(" not in js, \
        "windowDrag must never arm an edge-dock controller (it hijacked the drop)"
    # The import line pulls ONLY clearRightDock now (no makeEdgeDockController).
    import_lines = [l for l in js.splitlines() if "from './modalSnap.js'" in l]
    assert len(import_lines) == 1, "expected exactly one modalSnap import in windowDrag"
    assert "makeEdgeDockController" not in import_lines[0]
    assert "clearRightDock" in import_lines[0]


def test_windowdrag_has_no_side_dock_commit_in_drag_end():
    """The release handler must not commit a side dock. With the controllers gone,
    rightDock/leftDock .commit()/.hovering() must not appear in the live logic."""
    js = _read("static", "js", "windowDrag.js")
    # No live references to the retired controllers (comments are fine).
    code = "\n".join(l for l in js.splitlines() if not l.strip().startswith("//"))
    for sym in ("rightDock.commit(", "leftDock.commit(",
                "rightDock.hovering(", "leftDock.hovering(",
                "rightDock.onMove(", "leftDock.onMove("):
        assert sym not in code, f"{sym} must be gone — no drag-time side dock"


def test_windowdrag_peels_a_remembered_dock_on_grab():
    """A window still carrying a dock class from the NON-drag remembered-dock path
    (modalManager) must be peeled back to free-floating when the user grabs it, so
    it drags like any window instead of with a stale full-height width + body push."""
    js = _read("static", "js", "windowDrag.js")
    assert "clearRightDock(modal" in js
    # The peel happens at drag start, guarded on a present dock class.
    assert "modal.classList.contains('modal-right-docked')" in js
    assert "modal.classList.contains('modal-left-docked')" in js


def test_windowdrag_keeps_top_edge_fullscreen_snap():
    """Only the SEPARATE top-edge fullscreen snap survives (opt-in via
    onEnterFullscreen) — it is not the side-edge interference."""
    js = _read("static", "js", "windowDrag.js")
    assert "_enterFs()" in js          # the fullscreen entry still fires on a top-edge release
    assert "cy <= SNAP_PX" in js       # gated on the top band


# ── 2) tileManager.js no longer snaps a dragged window into a tile zone ────────

def test_tilemanager_drag_target_is_neutralized():
    """The 9-zone tile snap must never start tracking a drag: _findDragTarget returns
    null up front, so no ghost shows and no release-time snap fires."""
    js = _read("static", "js", "tileManager.js")
    start = js.index("function _findDragTarget(")
    body = js[start:js.index("}", start) + 1]
    # The very first statement of the body is `return null;` (before any closest()).
    first_stmt = next(l.strip() for l in body.splitlines()[1:] if l.strip() and not l.strip().startswith("//"))
    assert first_stmt == "return null;", \
        "tileManager must short-circuit _findDragTarget so a drag never tile-snaps"


def test_tilemanager_keeps_unsnap_and_reclamp():
    """Releasing/reclamping an ALREADY-snapped window stays available — only NEW
    drag-created snaps are removed."""
    js = _read("static", "js", "tileManager.js")
    assert "function _unsnap(" in js
    assert "function _reclampAll(" in js
