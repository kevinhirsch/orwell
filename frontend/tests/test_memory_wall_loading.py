"""#11 snappy UX — the memory/knowledge wall shows a loading sliver on first open.

togglePanel(open) awaited GET /api/orwell/knowledge with no loading state, so the
window showed an empty shell until the fetch resolved. The fix routes the window
kit's setLoading() around the fetch — but ONLY on the interactive open
(refresh({loading:true})), never on the 20-30s background poll, so the panel's
"refreshing" chrome doesn't flicker every tick.
"""
import re
from pathlib import Path

FE = Path(__file__).resolve().parents[1]
WALL = (FE / "static" / "js" / "orwellMemoryWall.js").read_text(encoding="utf-8")


def test_interactive_open_requests_the_loading_state():
    assert "refresh({ loading: true })" in WALL, "the interactive open must ask for the loading sliver"


def test_refresh_gates_setloading_on_the_loading_flag_and_clears_in_finally():
    m = re.search(r"async function refresh\(opts\)\s*\{(.*?)\n  \}", WALL, re.S)
    assert m, "refresh(opts) must exist"
    body = m.group(1)
    # gated on the opts flag AND the kit actually exposing setLoading
    assert "opts && opts.loading" in body
    assert "_win.setLoading(true)" in body
    # cleared in a finally so a fetch error still tears the sliver down
    assert "} finally {" in body
    assert "_win.setLoading(false)" in body


def test_background_poll_does_not_pass_the_loading_flag():
    """scheduleNextPoll's tick calls refresh() with no args ⇒ no per-poll flicker."""
    m = re.search(r"const tick = async \(\) => \{(.*?)\};", WALL, re.S)
    assert m, "the poll tick must exist"
    assert "await refresh()" in m.group(1), "the periodic poll must call refresh() WITHOUT the loading flag"
