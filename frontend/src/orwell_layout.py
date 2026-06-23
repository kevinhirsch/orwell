"""Feature 0064 (Part F) — per-user WINDOW/HUD layout, synced across devices.

The game UI is a set of draggable/resizable OrwellWindow kit windows (cast, finale,
retrospective, …) plus the gadget rail (0054). Their open/minimized/docked state, size, and
position persist PER DEVICE today (localStorage), so a window you move on one device is invisible
on the next. This store holds the layout as a synced, per-user blob so every device shows the same
arrangement (a `layout-changed` SSE event drives the live apply; this module is just the durable
store).

Mirrors `orwell_seasons.py` / `orwell_game_session.py`: a small JSON map in ``DATA_DIR``, atomically
written, keyed by `_current_user`. Vault-free by construction — window geometry carries no game
secret. The factory-reset scrub of ``data/`` takes it back to default; layout deliberately survives a
season reset (a window position is a UI preference, not season state).
"""

from __future__ import annotations

import json
import threading
from pathlib import Path

from core.atomic_io import atomic_write_json
from src.constants import DATA_DIR

LAYOUT_PATH = Path(DATA_DIR) / "orwell_layout.json"

_LOCK = threading.Lock()

# The only fields a window state may carry, with their coercers. Anything else is dropped (bounded
# blob — no arbitrary client data is ever persisted). Geometry is clamped to a sane range so a
# malformed client can never write a wild value that throws the window off-screen on another device.
#
# #637/#638 extend the SAME store to a few synthetic ids — the gadget rail's ORDER (id
# "gadget-rail"), the panel SIDE (id "panel"), and game-POPUP shown/dismissed state (id
# "popup:<name>"). They reuse the per-field last-write-wins merge + the `layout-changed` fan-out;
# all are Vault-free (an order, a left/right enum, a shown/dismissed bool carry no game secret).
_BOOL_FIELDS = ("open", "minimized", "docked", "dismissed", "shown")
_NUM_FIELDS = ("x", "y", "w", "h")
_NUM_MIN, _NUM_MAX = -20000.0, 20000.0
_MAX_WINDOWS = 64          # a hard cap on tracked windows per user (the kit has a handful)
_MAX_ID_LEN = 64
# A bounded "side" enum (the panel edge) and a bounded id-list (the gadget rail order). Both are
# clamped so a malformed/hostile client can never write an unbounded blob into the synced store.
_SIDE_VALUES = ("left", "right")
_MAX_ORDER_LEN = 64        # never more ids than the window cap; each id is _MAX_ID_LEN-bounded


def _load() -> dict:
    try:
        data = json.loads(LAYOUT_PATH.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except FileNotFoundError:
        return {}
    except Exception:
        # A corrupt store must never break the UI: fall back to "no saved layout".
        return {}


def _key(user: str | None) -> str:
    return (user or "default").strip() or "default"


def _clean_window_id(window_id) -> str | None:
    if not isinstance(window_id, str):
        return None
    wid = window_id.strip()
    if not wid or len(wid) > _MAX_ID_LEN:
        return None
    return wid


def _clean_order(value) -> list | None:
    """Coerce a gadget-rail order to a bounded list of clean, de-duplicated string ids.
    Anything unusable (not a list, no valid ids) ⇒ ``None`` (field dropped)."""
    if not isinstance(value, (list, tuple)):
        return None
    out: list = []
    for item in value:
        wid = _clean_window_id(item)
        if wid and wid not in out:
            out.append(wid)
        if len(out) >= _MAX_ORDER_LEN:
            break
    return out or None


def _clean_state(partial) -> dict:
    """Keep only the allowed, well-typed fields (bools + clamped numbers + the #637/#638 synthetic
    fields: a left/right `side` enum and a bounded `order` id-list); drop everything else."""
    out: dict = {}
    if not isinstance(partial, dict):
        return out
    for f in _BOOL_FIELDS:
        if f in partial and partial[f] is not None:
            out[f] = bool(partial[f])
    for f in _NUM_FIELDS:
        if f in partial and partial[f] is not None:
            try:
                v = float(partial[f])
            except (TypeError, ValueError):
                continue
            out[f] = max(_NUM_MIN, min(_NUM_MAX, v))
    # #637: the panel side — a bounded enum, never free text.
    if partial.get("side") in _SIDE_VALUES:
        out["side"] = partial["side"]
    # #637: the gadget-rail order — a bounded list of clean string ids.
    if "order" in partial:
        order = _clean_order(partial.get("order"))
        if order is not None:
            out["order"] = order
    return out


def get_layout(user: str | None) -> dict:
    """The user's full layout blob: ``{"windows": {<id>: {open?, minimized?, docked?, x?, y?, w?, h?}}}``.
    Always answers (a missing/corrupt store ⇒ ``{"windows": {}}``)."""
    with _LOCK:
        data = _load().get(_key(user))
    windows = data.get("windows") if isinstance(data, dict) else None
    return {"windows": windows if isinstance(windows, dict) else {}}


def patch_layout(user: str | None, window_id, partial) -> dict:
    """Merge a partial state for ONE window into the user's layout (last-write-wins per field).
    Returns the updated per-window state, or ``{}`` when the window id / payload is unusable (the
    caller then knows nothing was stored). Bounded: unknown fields dropped, geometry clamped, the
    number of tracked windows capped."""
    wid = _clean_window_id(window_id)
    state = _clean_state(partial)
    if not wid or not state:
        return {}
    k = _key(user)
    with _LOCK:
        data = _load()
        bucket = data.get(k)
        if not isinstance(bucket, dict):
            bucket = {}
        windows = bucket.get("windows")
        if not isinstance(windows, dict):
            windows = {}
        current = windows.get(wid)
        merged = dict(current) if isinstance(current, dict) else {}
        merged.update(state)
        # Cap the number of tracked windows: only enforce when ADDING a new id (never evict the
        # window being updated). A handful of kit windows means this never trips in practice.
        if wid not in windows and len(windows) >= _MAX_WINDOWS:
            return {}
        windows[wid] = merged
        bucket["windows"] = windows
        data[k] = bucket
        atomic_write_json(str(LAYOUT_PATH), data, indent=2)
        return merged


def clear_layout(user: str | None) -> None:
    """Drop the user's saved layout (used only by a full account/factory reset, NOT a season reset —
    window placement is a UI preference that should survive a new season)."""
    k = _key(user)
    with _LOCK:
        data = _load()
        if k in data:
            del data[k]
            atomic_write_json(str(LAYOUT_PATH), data, indent=2)
