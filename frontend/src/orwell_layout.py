"""WebSocket Phase-1 — per-DEVICE window/HUD layout store (LWW).

The game UI is a set of draggable/resizable OrwellWindow kit windows (cast, finale,
retrospective, …) plus the gadget rail (0054). Their open/minimized/docked state, size, and
position persist so a window you move stays where you put it.

**Policy (ADR 0017, owner call 2026-07-09) — supersedes feature 0064-F.** Layout geometry is
remembered **PER DEVICE** and is NO LONGER synced cross-device: a desktop and a phone keep
independent arrangements. Only game state syncs cross-device. This store is therefore keyed by
`(user, deviceId)` — where `deviceId` is a stable per-device token (localStorage; survives reload;
distinct from the per-tab id). A same-device *other tab* still mirrors (LWW per window field), but a
different device does not.

**Read-compatible migration.** Legacy records written by 0064-F were keyed by `user` alone
(`{user: {"windows": {...}}}`). Those still resolve: a read for `(user, deviceId)` with no per-device
record yet falls back to the legacy per-user layout (never crashes), and a device's first write seeds
its windows from that legacy layout so an existing arrangement carries onto the device.

Mirrors `orwell_seasons.py` / `orwell_game_session.py`: a small JSON map in ``DATA_DIR``, atomically
written. Vault-free by construction — window geometry carries no game secret. The factory-reset scrub
of ``data/`` takes it back to default; layout deliberately survives a season reset (a window position
is a UI preference, not season state).
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
# malformed client can never write a wild value that throws the window off-screen.
#
# #637/#638 extend the SAME store to a few synthetic ids — the gadget rail's ORDER (id
# "gadget-rail"), the panel SIDE (id "panel"), game-POPUP shown/dismissed state (id
# "popup:<name>"), and (#640, the OrwellGadget kit) per-gadget COLLAPSED state (id
# "gadget:<id>"). They reuse the per-field last-write-wins merge; all are Vault-free (an order, a
# left/right enum, a shown/dismissed/collapsed bool carry no game secret).
_BOOL_FIELDS = ("open", "minimized", "docked", "dismissed", "shown", "collapsed")
_NUM_FIELDS = ("x", "y", "w", "h")
_NUM_MIN, _NUM_MAX = -20000.0, 20000.0
_MAX_WINDOWS = 64          # a hard cap on tracked windows per device (the kit has a handful)
_MAX_DEVICES = 32          # a hard cap on tracked devices per user (bounded store)
_MAX_ID_LEN = 64
# A bounded "side" enum (the panel edge) and a bounded id-list (the gadget rail order). Both are
# clamped so a malformed/hostile client can never write an unbounded blob into the store.
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


def _device_key(device_id) -> str | None:
    """A stable, bounded per-device token. Empty / None / oversized ⇒ ``None`` (legacy per-user
    scope) — so a caller that omits a deviceId still reads/writes the legacy top-level layout."""
    if not isinstance(device_id, str):
        return None
    d = device_id.strip()
    if not d or len(d) > _MAX_ID_LEN:
        return None
    return d


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


def _legacy_windows(bucket: dict) -> dict:
    """The 0064-F per-user windows map (the migration source), or ``{}``."""
    legacy = bucket.get("windows") if isinstance(bucket, dict) else None
    return legacy if isinstance(legacy, dict) else {}


def _read_windows(bucket: dict, device_id: str | None) -> dict:
    """Resolve the windows map to READ for (user, device).

    Per-device record if present; otherwise the legacy per-user layout (migration read-compat) so
    an existing pre-per-device record still resolves and never crashes."""
    if not isinstance(bucket, dict):
        return {}
    if device_id:
        devices = bucket.get("devices")
        if isinstance(devices, dict):
            dev = devices.get(device_id)
            if isinstance(dev, dict) and isinstance(dev.get("windows"), dict):
                return dev["windows"]
        # No per-device record yet → fall back to the legacy per-user windows.
        return _legacy_windows(bucket)
    # No device id → the legacy per-user scope (backward compatible).
    return _legacy_windows(bucket)


def _device_count(bucket: dict) -> int:
    devices = bucket.get("devices") if isinstance(bucket, dict) else None
    return len(devices) if isinstance(devices, dict) else 0


def _device_exists(bucket: dict, device_id: str) -> bool:
    devices = bucket.get("devices") if isinstance(bucket, dict) else None
    return isinstance(devices, dict) and isinstance(devices.get(device_id), dict)


def _writable_windows(bucket: dict, device_id: str | None) -> dict:
    """The windows map to MUTATE for (user, device). A device's first write seeds a COPY of the
    legacy per-user windows (migration) so the existing arrangement carries onto the device."""
    if not device_id:
        return _legacy_windows(bucket)
    devices = bucket.get("devices")
    if isinstance(devices, dict):
        dev = devices.get(device_id)
        if isinstance(dev, dict) and isinstance(dev.get("windows"), dict):
            return dev["windows"]
    # First write for this device: seed from the legacy per-user windows (copy), if any.
    return dict(_legacy_windows(bucket))


def _store_windows(bucket: dict, device_id: str | None, windows: dict) -> None:
    if not device_id:
        bucket["windows"] = windows
        return
    devices = bucket.get("devices")
    if not isinstance(devices, dict):
        devices = {}
    dev = devices.get(device_id)
    if not isinstance(dev, dict):
        dev = {}
    dev["windows"] = windows
    devices[device_id] = dev
    bucket["devices"] = devices


def get_layout(user: str | None, device_id: str | None = None) -> dict:
    """The (user, device)'s full layout blob:
    ``{"windows": {<id>: {open?, minimized?, docked?, x?, y?, w?, h?}}}``.

    Per-device (ADR 0017); a legacy per-user record still resolves (migration). Always answers (a
    missing/corrupt store ⇒ ``{"windows": {}}``)."""
    with _LOCK:
        bucket = _load().get(_key(user))
    windows = _read_windows(bucket if isinstance(bucket, dict) else {}, _device_key(device_id))
    return {"windows": windows if isinstance(windows, dict) else {}}


def patch_layout(user: str | None, device_id: str | None, patch, *, origin: str = "") -> dict:
    """Merge a partial state for ONE window into the (user, device)'s layout (last-write-wins per
    field) and return a broadcast descriptor.

    Signature (published for the WS-server agent):
        ``patch_layout(user, device_id, patch, *, origin="")``
      - ``patch`` — ``{"windowId": <id>, "state": {<partial fields>}}``.
      - ``origin`` — the originating tab/device token; round-tripped in the returned descriptor so
        the caller fans the change out to the SAME device's OTHER tabs and SUPPRESSES the echo back
        to ``origin`` (a device never gets its own echo).

    Returns ``{"windowId", "state", "origin", "deviceId"}`` on success, or ``{}`` (falsy) when the
    window id / payload is unusable or a bound is hit — the caller then knows nothing was stored.
    Bounded: unknown fields dropped, geometry clamped, windows-per-device and devices-per-user
    capped. Per-device (ADR 0017): geometry is NOT synced cross-device."""
    if not isinstance(patch, dict):
        return {}
    wid = _clean_window_id(patch.get("windowId"))
    state = _clean_state(patch.get("state"))
    if not wid or not state:
        return {}
    dev = _device_key(device_id)
    k = _key(user)
    with _LOCK:
        data = _load()
        bucket = data.get(k)
        if not isinstance(bucket, dict):
            bucket = {}
        # Cap devices: only when introducing a NEW device (never evict an existing one).
        if dev and not _device_exists(bucket, dev) and _device_count(bucket) >= _MAX_DEVICES:
            return {}
        windows = _writable_windows(bucket, dev)
        current = windows.get(wid)
        merged = dict(current) if isinstance(current, dict) else {}
        merged.update(state)
        # Cap windows: only enforce when ADDING a new id (never evict the window being updated).
        if wid not in windows and len(windows) >= _MAX_WINDOWS:
            return {}
        windows[wid] = merged
        _store_windows(bucket, dev, windows)
        data[k] = bucket
        atomic_write_json(str(LAYOUT_PATH), data, indent=2)
        return {"windowId": wid, "state": merged, "origin": origin or "", "deviceId": dev or ""}


def clear_layout(user: str | None) -> None:
    """Drop the user's saved layout (ALL of the user's devices) — used only by a full
    account/factory reset, NOT a season reset (window placement is a UI preference that should
    survive a new season)."""
    k = _key(user)
    with _LOCK:
        data = _load()
        if k in data:
            del data[k]
            atomic_write_json(str(LAYOUT_PATH), data, indent=2)
