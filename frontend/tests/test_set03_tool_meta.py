"""SET-03/04/05 (2026-07-14 theme-visual audit §4): admin Tools-panel TOOL_META hygiene.

The Settings > Tools panel renders every id served by GET /api/tools through the
static TOOL_META map in static/js/admin.js; an id with no entry falls into an
"Other" bucket as a raw camelCase id with an empty description (SET-03's 22 live
game tools). Duplicate keys are dead code (the later definition wins — SET-04),
and entries for ids no longer in TOOL_TAGS can never render at all (SET-05).

These are source-pinned convention checks (display metadata only — no wiring):
  * every id the game build serves ((KEEP | OPTIONAL) & TOOL_TAGS) has an entry,
  * no duplicate TOOL_META keys,
  * every TOOL_META key is a live TOOL_TAGS id,
  * the engine/game-master levers all sit in the 'Game' category.

Tool ids (getGameState, bash, ...) are app capabilities, not people — naming
them is fine under the roles-only rule.
"""

import pathlib
import re

from src.agent_tools import TOOL_TAGS, GAME_TOOL_KEEP, GAME_TOOL_OPTIONAL
from src.tool_schemas import ORWELL_GAME_TOOLS

_ADMIN_JS = pathlib.Path(__file__).parent.parent / "static" / "js" / "admin.js"


def _tool_meta_entries():
    """[(key, entry_body), ...] in source order, duplicates preserved."""
    src = _ADMIN_JS.read_text(encoding="utf-8")
    block = re.search(r"const TOOL_META = \{(.*?)\n\};", src, re.DOTALL)
    assert block, "TOOL_META block not found in admin.js"
    entries = []
    for line in block.group(1).splitlines():
        m = re.match(r"\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*\{(.*)\}", line)
        if m:
            entries.append((m.group(1), m.group(2)))
    assert entries, "no TOOL_META entries parsed"
    return entries


def _served_ids_game_build():
    """The exact id set GET /api/tools lists under the game build
    (mirrors routes/model_routes.py: (KEEP | OPTIONAL) & TOOL_TAGS)."""
    return (set(GAME_TOOL_KEEP) | set(GAME_TOOL_OPTIONAL)) & set(TOOL_TAGS)


def test_no_duplicate_tool_meta_keys():
    # SET-04: a duplicated key's first definition is dead code (later wins).
    keys = [k for k, _ in _tool_meta_entries()]
    dupes = sorted({k for k in keys if keys.count(k) > 1})
    assert not dupes, f"duplicate TOOL_META keys (first defs are dead): {dupes}"


def test_every_game_build_served_tool_has_a_meta_entry():
    # SET-03: an unmapped served id renders as a raw camelCase id in "Other".
    keys = {k for k, _ in _tool_meta_entries()}
    unmapped = sorted(_served_ids_game_build() - keys)
    assert not unmapped, (
        f"served tools with no TOOL_META entry (would render in 'Other'): {unmapped}"
    )


def test_every_tool_meta_key_is_a_live_tool_tag():
    # SET-05: an entry for an id outside TOOL_TAGS can never render (dead entry).
    dead = sorted({k for k, _ in _tool_meta_entries()} - set(TOOL_TAGS))
    assert not dead, f"TOOL_META entries for ids not in TOOL_TAGS (dead): {dead}"


def test_game_engine_levers_categorized_as_game():
    # Every agent-facing engine lever (ORWELL_GAME_TOOLS is the pinned name set)
    # files under 'Game' so the panel leads with the game surface, per the audit fix.
    cats = {}
    for key, body in _tool_meta_entries():
        m = re.search(r"cat:\s*'([^']*)'", body)
        cats[key] = m.group(1) if m else None
    miscat = sorted(
        name for name in ORWELL_GAME_TOOLS if cats.get(name) and cats[name] != "Game"
    )
    assert not miscat, f"engine levers not in the 'Game' category: {miscat}"
