"""Feature 0051 — in-character cast portraits (front-end half).

The engine builds a Vault-free portrait PROMPT per houseguest (from public appearance
facets + a per-season photorealistic style anchor) and returns them on `createCharacter`
as ``portraitPrompts``. This module is the FE pipeline that turns those prompts into
persisted images, looks them up for the roster + chat, and scrubs them on reset.

Discipline (from the spec, non-negotiable):
  • Graceful absence — no image-capable model configured ⇒ the game plays identically.
    Generation is best-effort; a failure NEVER surfaces an error to the player and never
    blocks game start. The roster falls back to name + status cards.
  • Vault-free — this module receives only the engine's already-Vault-free prompts and the
    Vault-free public projection. It never touches a stat, relationship, or hidden element.
  • Generate once per season — on restart the stored portrait is served from disk; a portrait
    that already exists is never regenerated (ADR 0003: augment, never replace; bounded cost).

Storage: ``{frontend}/data/portraits/{user}/{houseguestId}.png`` plus a small
``manifest.json`` (houseguestId → filename + name). The whole tree lives under the
front-end data dir, so ``orwell-factory-reset.sh`` (which scrubs the FE store) already
removes it; ``orwell-game-reset.sh`` is taught to clear it too (a new season = a new cast).
"""

import asyncio
import base64
import json
import logging
import os
import re
from pathlib import Path
from typing import Optional

from src.constants import DATA_DIR

logger = logging.getLogger(__name__)

# Base dir for all per-user portrait sets (co-located with the FE data store so the
# existing factory-reset scrub of data/ removes it; game-reset clears it explicitly).
PORTRAITS_DIR = Path(DATA_DIR) / "portraits"

# A houseguest id is engine-supplied (e.g. "npc:3", "player"). Sanitize to a safe, stable
# filename stem so it can never escape the user's portrait dir.
_ID_SAFE_RE = re.compile(r"[^A-Za-z0-9_-]+")
# A username likewise sanitized for use as a directory name.
_USER_SAFE_RE = re.compile(r"[^A-Za-z0-9_.-]+")


def _safe_id(houseguest_id: str) -> str:
    stem = _ID_SAFE_RE.sub("_", str(houseguest_id or "").strip())
    return stem or "unknown"


def _safe_user(user: Optional[str]) -> str:
    u = _USER_SAFE_RE.sub("_", str(user or "").strip())
    return u or "default"


def user_portrait_dir(user: Optional[str]) -> Path:
    """The per-user portrait directory (created lazily by callers that write)."""
    return PORTRAITS_DIR / _safe_user(user)


def _manifest_path(user: Optional[str]) -> Path:
    return user_portrait_dir(user) / "manifest.json"


def load_manifest(user: Optional[str]) -> dict:
    """The houseguestId → {file, name} map for this user (empty when none generated)."""
    try:
        with open(_manifest_path(user), "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return {}


def _save_manifest(user: Optional[str], manifest: dict) -> None:
    d = user_portrait_dir(user)
    d.mkdir(parents=True, exist_ok=True)
    tmp = d / "manifest.json.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)
    os.replace(tmp, _manifest_path(user))


def portrait_ref(user: Optional[str], houseguest_id: str) -> Optional[str]:
    """The HTTP ref the browser uses for a stored portrait, or None if none is stored.

    Verifies the file actually exists on disk (a manifest entry whose file was scrubbed
    must not produce a broken <img>). The ref is served by GET /api/orwell/portrait/{id}.
    """
    entry = load_manifest(user).get(_safe_id(houseguest_id))
    if not entry:
        return None
    fname = entry.get("file") if isinstance(entry, dict) else None
    if not fname:
        return None
    if not (user_portrait_dir(user) / fname).exists():
        return None
    return f"/api/orwell/portrait/{_safe_id(houseguest_id)}"


def portrait_file(user: Optional[str], houseguest_id: str) -> Optional[Path]:
    """The on-disk path for a stored portrait (for the serving route), or None."""
    entry = load_manifest(user).get(_safe_id(houseguest_id))
    if not isinstance(entry, dict):
        return None
    fname = entry.get("file")
    if not fname:
        return None
    # fname is a value we wrote ("{safe_id}.png"); re-derive defensively so a tampered
    # manifest can never point outside the user dir.
    safe_name = os.path.basename(str(fname))
    path = user_portrait_dir(user) / safe_name
    return path if path.exists() else None


# ── Image generation (mirrors mcp_servers/image_gen_server.py's proven path) ──────────────
# Kept self-contained so the portrait pipeline does not depend on the MCP/stdio server.
# Reads the SAME settings (image_gen_enabled / image_model / image_quality), per-user where
# those are per-user-eligible (settings._PER_USER_KEYS).

def _image_settings(user: Optional[str]) -> tuple:
    """(enabled, model_spec, quality) — per-user-resolved where allowed."""
    from src.settings import get_user_setting

    enabled = bool(get_user_setting("image_gen_enabled", owner=user or "", default=True))
    model_spec = (get_user_setting("image_model", owner=user or "", default="") or "").strip()
    quality = (get_user_setting("image_quality", owner=user or "", default="medium") or "medium")
    return enabled, model_spec, quality


def image_generation_available(user: Optional[str]) -> bool:
    """True only if image generation is enabled AND a usable image model resolves.

    The roster + onboarding use this to know whether to expect portraits at all (graceful
    absence): when it's False the game proceeds with no portraits and no error surface.
    """
    from src.ai_interaction import _resolve_model

    enabled, model_spec, _ = _image_settings(user)
    if not enabled:
        return False
    candidates = [model_spec] if model_spec else ["gpt-image-1.5", "gpt-image-1", "dall-e-3"]
    for cand in candidates:
        if not cand:
            continue
        try:
            _resolve_model(cand, owner=user or None)
            return True
        except Exception:
            continue
    return False


async def _generate_one(prompt: str, user: Optional[str]) -> Optional[bytes]:
    """Generate a single image from `prompt`; return PNG bytes, or None on any failure.

    Best-effort: every failure path returns None (never raises) so a flaky image API can
    never break game start or leak an error to the player.
    """
    import httpx
    from src.ai_interaction import _resolve_model

    enabled, model_spec, quality = _image_settings(user)
    if not enabled or not prompt:
        return None

    if not model_spec:
        for candidate in ("gpt-image-1.5", "gpt-image-1", "dall-e-3"):
            try:
                _resolve_model(candidate, owner=user or None)
                model_spec = candidate
                break
            except Exception:
                continue
    if not model_spec:
        return None

    try:
        url, model_id, headers = _resolve_model(model_spec, owner=user or None)
    except Exception as e:
        logger.info("[portraits] no image model resolved: %s", e)
        return None

    is_gpt_image = "gpt-image" in model_id.lower()
    base_url = url.replace("/chat/completions", "").replace("/v1/messages", "").rstrip("/")
    images_url = base_url + "/images/generations"

    size = "1024x1024"
    payload = {"model": model_id, "prompt": prompt, "n": 1, "size": size}
    if is_gpt_image:
        payload["quality"] = quality if quality in ("low", "medium", "high", "auto") else "medium"

    try:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(connect=30.0, read=300.0, write=30.0, pool=30.0)
        ) as client:
            resp = await client.post(images_url, json=payload, headers=headers)
            if resp.status_code != 200:
                logger.info("[portraits] image API %s: %s", resp.status_code, resp.text[:200])
                return None
            data = resp.json()
            images = data.get("data", [])
            if not images:
                return None
            img = images[0]
            if img.get("b64_json"):
                return base64.b64decode(img["b64_json"])
            if img.get("url"):
                # Some providers return a URL instead of inline bytes — fetch them.
                ir = await client.get(img["url"])
                if ir.status_code == 200:
                    return ir.content
            return None
    except Exception as e:
        logger.info("[portraits] generation failed: %s", e)
        return None


def _write_portrait(user: Optional[str], houseguest_id: str, png: bytes, name: str) -> str:
    """Persist one portrait + update the manifest; return its stored filename."""
    d = user_portrait_dir(user)
    d.mkdir(parents=True, exist_ok=True)
    filename = f"{_safe_id(houseguest_id)}.png"
    (d / filename).write_bytes(png)
    manifest = load_manifest(user)
    manifest[_safe_id(houseguest_id)] = {"file": filename, "name": name}
    _save_manifest(user, manifest)
    return filename


async def generate_and_store(prompts: list, user: Optional[str], *, record_beats: bool = True) -> dict:
    """Generate + persist a cast portrait set from the engine's `portraitPrompts`.

    `prompts` is the engine's ``[{houseguestId, name, prompt}]``. Returns a small summary
    ``{generated, skipped, total}``. Idempotent: a houseguest whose portrait already exists
    on disk is NOT regenerated (generate-once-per-season; served from disk on restart).

    Best-effort throughout: never raises. When generation is unavailable (no model / disabled)
    it skips silently and the game is unaffected. After a portrait is shown for the first time
    we record it as a player-witnessed beat via the engine (recorded-or-it-didn't-happen),
    unless `record_beats` is False.
    """
    if not isinstance(prompts, list) or not prompts:
        return {"generated": 0, "skipped": 0, "total": 0}

    # Graceful absence: don't even probe the API per houseguest if generation is off.
    if not image_generation_available(user):
        logger.info("[portraits] image generation unavailable — skipping cast portraits")
        return {"generated": 0, "skipped": len(prompts), "total": len(prompts)}

    generated = 0
    skipped = 0
    newly_shown = []  # (houseguestId, ref) for beat recording

    for entry in prompts:
        if not isinstance(entry, dict):
            skipped += 1
            continue
        hid = entry.get("houseguestId") or entry.get("id")
        prompt = entry.get("prompt")
        name = entry.get("name") or ""
        if not hid or not prompt:
            skipped += 1
            continue

        # Generate-once: a stored portrait is never regenerated on restart.
        if portrait_file(user, hid) is not None:
            skipped += 1
            continue

        png = await _generate_one(str(prompt), user)
        if not png:
            skipped += 1
            continue
        try:
            _write_portrait(user, str(hid), png, str(name))
            generated += 1
            newly_shown.append((str(hid), f"/api/orwell/portrait/{_safe_id(hid)}"))
        except Exception as e:
            logger.info("[portraits] failed to persist %s: %s", hid, e)
            skipped += 1

    if record_beats and newly_shown:
        await _record_image_beats(newly_shown, user)

    logger.info("[portraits] cast set for %s: generated=%d skipped=%d", _safe_user(user), generated, skipped)
    return {"generated": generated, "skipped": skipped, "total": len(prompts)}


async def _record_image_beats(shown: list, user: Optional[str]) -> None:
    """Record each shown portrait as a player-witnessed beat (best-effort)."""
    from src import orwell_engine

    for hid, ref in shown:
        try:
            await orwell_engine.record_image_beat(hid, ref, user=user)
        except Exception as e:
            logger.info("[portraits] record_image_beat(%s) failed: %s", hid, e)


def kickoff_generation(prompts: list, user: Optional[str]) -> None:
    """Fire-and-forget the cast portrait generation so game start never blocks on images.

    Schedules `generate_and_store` on the running event loop when one exists (the normal
    async request path); if called with no loop it runs synchronously to completion. Either
    way it is best-effort and swallows failures.
    """
    if not prompts:
        return
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None
    if loop is not None:
        task = loop.create_task(generate_and_store(prompts, user))

        # Keep a reference so the task isn't GC'd mid-flight; log any unexpected error.
        def _done(t):
            try:
                t.result()
            except Exception as e:  # pragma: no cover - defensive
                logger.info("[portraits] background generation error: %s", e)

        task.add_done_callback(_done)
    else:  # pragma: no cover - non-async callers (tests call generate_and_store directly)
        try:
            asyncio.run(generate_and_store(prompts, user))
        except Exception as e:
            logger.info("[portraits] sync generation error: %s", e)


def scrub_user(user: Optional[str]) -> None:
    """Delete one user's portrait set (used on a per-user new-season reset)."""
    import shutil

    d = user_portrait_dir(user)
    try:
        if d.exists():
            shutil.rmtree(d)
    except OSError as e:
        logger.info("[portraits] scrub_user(%s) failed: %s", _safe_user(user), e)


def scrub_all() -> None:
    """Delete every user's portraits (factory/game reset; mirrors the deploy scripts)."""
    import shutil

    try:
        if PORTRAITS_DIR.exists():
            shutil.rmtree(PORTRAITS_DIR)
    except OSError as e:
        logger.info("[portraits] scrub_all failed: %s", e)
