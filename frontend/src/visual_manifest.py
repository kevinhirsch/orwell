"""0113 — the visual-regression harness's baseline manifest.

The blessed baseline set is a directory of PNGs (`frontend/tests/visual/baselines/`) plus a
single `manifest.json` mapping shot id -> {sha256, path, width, height, dsf, blessed_at,
source}. The manifest is the single source of truth for "which shot ids have a baseline at
all" — `visual_regression.py`'s pixel-compare step looks a shot id up here first; a MISS is
reported as an explicit SKIPPED-with-notice entry, never a silent pass.

Pure I/O + dict shaping — no Playwright, no PIL requirement at import time (kept separate from
`visual_pixeldiff.py` so a manifest-only consumer, e.g. a future CLI, doesn't need Pillow).
"""
from __future__ import annotations

import hashlib
import json
import os
import time
from dataclasses import asdict, dataclass, field
from typing import Dict, List, Optional

MANIFEST_FORMAT = 1
MANIFEST_FILENAME = "manifest.json"


def encode_shot_id(shot_id: str) -> str:
    """Shot ids are colon-delimited (`tierA:surface:viewport:theme` / `tierB:beat:viewport`)
    for readability in reports; colons are POSIX-legal but awkward across some CI artifact
    tooling / Windows checkouts, so on-disk filenames use a double-underscore delimiter
    instead. Bijective with `decode_shot_id` as long as no shot-id COMPONENT itself contains
    "__" (true today — surface/viewport/theme/beat names are single hyphenated tokens)."""
    return shot_id.replace(":", "__")


def decode_shot_id(filename_stem: str) -> str:
    return filename_stem.replace("__", ":")


def sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


@dataclass
class BaselineEntry:
    shot_id: str
    path: str            # relative to the baselines dir
    sha256: str
    width: Optional[int] = None
    height: Optional[int] = None
    device_scale_factor: Optional[float] = None
    blessed_at: Optional[str] = None
    source: Optional[str] = None   # e.g. "ci-artifact:run-12345" or "path:/tmp/run-dir"
    label: Optional[str] = None

    def to_dict(self) -> Dict:
        return {k: v for k, v in asdict(self).items()}


@dataclass
class Manifest:
    format: int = MANIFEST_FORMAT
    updated_at: Optional[str] = None
    entries: Dict[str, BaselineEntry] = field(default_factory=dict)

    def to_dict(self) -> Dict:
        return {
            "format": self.format,
            "updated_at": self.updated_at,
            "shots": {sid: e.to_dict() for sid, e in sorted(self.entries.items())},
        }

    @classmethod
    def from_dict(cls, data: Dict) -> "Manifest":
        entries = {}
        for sid, raw in (data.get("shots") or {}).items():
            entries[sid] = BaselineEntry(shot_id=sid, **{
                k: v for k, v in raw.items() if k in BaselineEntry.__dataclass_fields__
                and k != "shot_id"
            })
        return cls(format=int(data.get("format") or MANIFEST_FORMAT),
                   updated_at=data.get("updated_at"), entries=entries)


def manifest_path(baselines_dir: str) -> str:
    return os.path.join(baselines_dir, MANIFEST_FILENAME)


def load_manifest(baselines_dir: str) -> Manifest:
    p = manifest_path(baselines_dir)
    if not os.path.isfile(p):
        return Manifest()
    with open(p, "r", encoding="utf-8") as fh:
        try:
            return Manifest.from_dict(json.load(fh))
        except (json.JSONDecodeError, TypeError):
            return Manifest()


def save_manifest(baselines_dir: str, manifest: Manifest) -> str:
    os.makedirs(baselines_dir, exist_ok=True)
    manifest.updated_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    p = manifest_path(baselines_dir)
    tmp = f"{p}.tmp.{os.getpid()}"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(manifest.to_dict(), fh, indent=2, sort_keys=True)
        fh.write("\n")
    os.replace(tmp, p)  # atomic — never leaves a torn manifest for a concurrent reader
    return p


def bless_run(run_shots_dir: str, baselines_dir: str, *, source: str,
             shot_meta: Optional[Dict[str, Dict]] = None) -> Manifest:
    """Stamp every PNG under ``run_shots_dir`` as a blessed baseline: copy it into
    ``baselines_dir`` (flat, keyed by shot id filename) and record its sha256 + dims in the
    manifest. ``shot_meta`` (shot id -> {width, height, device_scale_factor, label}) is the
    harness's own per-shot metadata (from its shots manifest — see `visual_regression.py`); a
    missing entry is tolerated (dims simply stay null, never a hard failure — a hand-run bless
    against an ad-hoc directory of PNGs must still work).

    Idempotent + works on ANY run dir shape (a raw unpacked CI artifact or a local harness run)
    — the contract is just "a directory of `<shot-id>.png` files", per the design note's
    "policy: bless from CI artifacts, not local renders (font/AA drift) — script works on any
    run dir."
    """
    import shutil

    if not os.path.isdir(run_shots_dir):
        raise FileNotFoundError(f"no such run directory: {run_shots_dir}")
    os.makedirs(baselines_dir, exist_ok=True)
    manifest = load_manifest(baselines_dir)
    shot_meta = shot_meta or {}
    blessed_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    count = 0
    for name in sorted(os.listdir(run_shots_dir)):
        if not name.lower().endswith(".png"):
            continue
        shot_id = decode_shot_id(name[:-4])
        src = os.path.join(run_shots_dir, name)
        dst = os.path.join(baselines_dir, name)
        shutil.copyfile(src, dst)
        meta = shot_meta.get(shot_id, {})
        manifest.entries[shot_id] = BaselineEntry(
            shot_id=shot_id, path=name, sha256=sha256_file(dst),
            width=meta.get("width"), height=meta.get("height"),
            device_scale_factor=meta.get("device_scale_factor"),
            blessed_at=blessed_at, source=source, label=meta.get("label"),
        )
        count += 1

    if count == 0:
        raise FileNotFoundError(f"no *.png shots found under {run_shots_dir} — nothing to bless")
    save_manifest(baselines_dir, manifest)
    return manifest


def baseline_bytes(baselines_dir: str, shot_id: str, manifest: Optional[Manifest] = None,
                   ) -> Optional[bytes]:
    """The blessed PNG bytes for a shot id, or None if no baseline is recorded (the
    'missing baseline' case the pixel-compare step must report as SKIPPED, not silently
    passed)."""
    manifest = manifest or load_manifest(baselines_dir)
    entry = manifest.entries.get(shot_id)
    if entry is None:
        return None
    p = os.path.join(baselines_dir, entry.path)
    if not os.path.isfile(p):
        return None
    with open(p, "rb") as fh:
        return fh.read()


def diff_manifests(old: Manifest, new: Manifest) -> Dict[str, List[str]]:
    """Shot ids added / removed / changed (sha256 differs) between two manifests — used by the
    bless script's summary and by tests asserting a round-trip changes exactly what's expected."""
    old_ids, new_ids = set(old.entries), set(new.entries)
    changed = [sid for sid in (old_ids & new_ids)
              if old.entries[sid].sha256 != new.entries[sid].sha256]
    return {
        "added": sorted(new_ids - old_ids),
        "removed": sorted(old_ids - new_ids),
        "changed": sorted(changed),
    }
