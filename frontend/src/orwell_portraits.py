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
import time
from pathlib import Path
from typing import Optional

from src.constants import DATA_DIR

logger = logging.getLogger(__name__)

# Base dir for all per-user portrait sets (co-located with the FE data store so the
# existing factory-reset scrub of data/ removes it; game-reset clears it explicitly).
PORTRAITS_DIR = Path(DATA_DIR) / "portraits"

# ── G9 observability: the generation-attempt log ──────────────────────────────────────────
# Every generation attempt/outcome lands here as one JSON line — {ts, houseguestId, ok,
# errorClass, durationMs} — capped to the last PORTRAIT_LOG_MAX_ENTRIES so it can never
# grow unbounded. The logger.info lines stay; this file is the operator-visible record
# (served admin-gated via GET /api/orwell/portraits/log, picked up by the admin Health card).
PORTRAIT_LOG_PATH = Path(DATA_DIR) / "portrait-log.jsonl"
PORTRAIT_LOG_MAX_ENTRIES = 100

# ── G9 backfill debounce: at most ONE backfill attempt per user per process per window ────
# (a failing image provider must not be hammered by every roster poll / button mash).
BACKFILL_DEBOUNCE_S = 10 * 60
_LAST_BACKFILL_AT: dict = {}

# ── G20 reconciler: verify-and-retry until the cast portrait set is complete ──────────────
# The G9 backfill is LAZY (it fires only when someone views the roster) — if no model was
# available when the cast moved in and nobody opens the panel, the set stays incomplete
# forever. The reconciler is the autonomous half: one background task per process sweeps
# every RECONCILE_INTERVAL_S over the users seen by the roster/portrait routes this
# process-life, and for each with an active game AND a usable provider, retries the missing
# set THROUGH the standard pipeline — under a per-houseguest budget (after a failed attempt
# n it cools down ~2^n cycles; RECONCILE_MAX_ATTEMPTS real failures and the reconciler
# stands down for that houseguest, leaving the lazy roster backfill + the manual lever).
# Provider ABSENCE idles and never consumes the budget; absent→present resets all counters.
RECONCILE_INTERVAL_S = 5 * 60
RECONCILE_MAX_ATTEMPTS = 6
# The budget sidecar, persisted next to the attempt log so a restart cannot forget how many
# real attempts a houseguest already burned: {safeUser: {safeId: {attempts, cooldown}}}.
RECONCILE_STATE_PATH = Path(DATA_DIR) / "portrait-reconcile.json"

# Users seen by the roster/portrait read helpers this process (safe key → the raw identity
# the routes asserted). The reconciler sweeps exactly these — per-user isolation holds; no
# cross-user enumeration is invented.
_SEEN_USERS: dict = {}
# Per-user last-observed provider availability (the absent→present transition resets the
# budget) and last-observed missing count — TRANSITION logging only (the A9 lesson: the
# reconciler never logs a line per idle cycle).
_PROVIDER_SEEN: dict = {}
_LAST_MISSING: dict = {}
_RECONCILER_TASK = None

# The most recent _generate_one failure reason (+ an optional short detail — the provider's
# own error code/message on an HTTP failure), consumed by the attempt logger. Module-level is
# adequate: generate_and_store awaits each generation sequentially, and the log is best-effort
# observability, never game state.
_LAST_GEN_ERROR: Optional[str] = None
_LAST_GEN_DETAIL: Optional[str] = None


def _note_gen_error(error_class: str, detail: Optional[str] = None) -> None:
    global _LAST_GEN_ERROR, _LAST_GEN_DETAIL
    _LAST_GEN_ERROR = error_class
    _LAST_GEN_DETAIL = detail or None


def _consume_gen_error() -> Optional[str]:
    global _LAST_GEN_ERROR
    e = _LAST_GEN_ERROR
    _LAST_GEN_ERROR = None
    return e


def _consume_gen_detail() -> Optional[str]:
    global _LAST_GEN_DETAIL
    d = _LAST_GEN_DETAIL
    _LAST_GEN_DETAIL = None
    return d


# Recognized text→image model families — the Python mirror of settings.js `_isImageModel`.
# A non-image (chat) model resolves fine but can't generate: POSTing it to /images/generations
# 400s instantly. This keeps such a model from being treated as available or attempted, so the
# pipeline never 400-loops on a mis-set model and `image_generation_available` stays truthful
# (G20's reconciler and the Health "portraits N/M" counter both gate on it).
_IMAGE_MODEL_FAMILIES = (
    "gpt-image", "dall-e", "dalle",
    "flux", "stable-diffusion", "sdxl", "sd3", "sd-", "playground-v",
    "imagen", "ideogram", "recraft", "kolors", "kandinsky", "pixart",
    "firefly", "titan-image", "aura-flow", "hidream", "seedream",
    "qwen-image", "wan2", "janus", "omnigen", "cogview", "chroma",
    "lumina", "nano-banana", "photon", "phoenix", "luma-photon",
)
_VISION_MARKERS = ("vision", "-vl", "understand", "caption", "ocr", "embed", "rerank")


def _is_image_model(model_id: Optional[str]) -> bool:
    lower = str(model_id or "").lower()
    if any(kw in lower for kw in _IMAGE_MODEL_FAMILIES):
        return True
    if "image" in lower or "text-to-image" in lower or "t2i" in lower:
        return not any(m in lower for m in _VISION_MARKERS)
    return False


def _provider_error_reason(resp) -> Optional[str]:
    """A short, SAFE hint from a non-200 image response — the provider's own error
    code/message (e.g. 'This model does not support image generation'), clipped, never
    our prompt. Best-effort; None when nothing useful parses out."""
    try:
        body = resp.json()
        if isinstance(body, dict):
            err = body.get("error")
            if isinstance(err, dict):
                msg = err.get("message") or err.get("code") or err.get("type")
                if msg:
                    return str(msg)[:140]
            elif isinstance(err, str) and err:
                return err[:140]
            msg = body.get("message")
            if msg:
                return str(msg)[:140]
    except Exception:
        pass
    return None


def log_attempt(houseguest_id: str, ok: bool, error_class: Optional[str] = None,
                duration_ms: int = 0, detail: Optional[str] = None) -> None:
    """Append one generation attempt/outcome to the capped JSONL ring. Best-effort:
    a logging failure must never break the generation pipeline itself.

    `detail` (failures only) is a short provider-supplied reason — e.g. the body of an
    image-API 400 ('model does not support image generation') — so a failure is
    self-diagnosing without grepping the live log. Clipped; never carries our prompt."""
    entry = {
        "ts": time.time(),
        "houseguestId": str(houseguest_id),
        "ok": bool(ok),
        "errorClass": None if ok else (error_class or "unknown"),
        "durationMs": int(duration_ms),
    }
    if (not ok) and detail:
        entry["detail"] = str(detail)[:200]
    try:
        lines = []
        try:
            with open(PORTRAIT_LOG_PATH, "r", encoding="utf-8") as f:
                lines = [ln for ln in f.read().splitlines() if ln.strip()]
        except (FileNotFoundError, OSError):
            lines = []
        lines.append(json.dumps(entry))
        lines = lines[-PORTRAIT_LOG_MAX_ENTRIES:]
        PORTRAIT_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
        tmp = PORTRAIT_LOG_PATH.with_suffix(".jsonl.tmp")
        with open(tmp, "w", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")
        os.replace(tmp, PORTRAIT_LOG_PATH)
    except Exception as e:  # pragma: no cover - defensive
        logger.info("[portraits] attempt-log write failed: %s", e)


def read_attempt_log(limit: int = PORTRAIT_LOG_MAX_ENTRIES) -> list:
    """The last `limit` attempt entries, oldest first. Empty when none/unreadable."""
    try:
        limit = int(limit)
    except (TypeError, ValueError):
        limit = PORTRAIT_LOG_MAX_ENTRIES
    if limit <= 0:
        return []
    try:
        with open(PORTRAIT_LOG_PATH, "r", encoding="utf-8") as f:
            lines = [ln for ln in f.read().splitlines() if ln.strip()]
    except (FileNotFoundError, OSError):
        return []
    out = []
    for ln in lines[-limit:]:
        try:
            entry = json.loads(ln)
            if isinstance(entry, dict):
                out.append(entry)
        except (ValueError, TypeError):
            continue
    return out

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


def note_user_seen(user: Optional[str]) -> None:
    """Register `user` for the G20 reconciler sweep (first-seen identity wins).

    Called from the per-user read helpers the roster/portrait routes already go through,
    so the reconciler only ever works for users who actually touched those surfaces this
    process. A pure dict write — it may never break a read path."""
    try:
        _SEEN_USERS.setdefault(_safe_user(user), user)
    except Exception:  # pragma: no cover - defensive
        pass


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
    note_user_seen(user)  # G20: a roster view enrolls this user in the reconciler sweep
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
    note_user_seen(user)  # G20: a portrait fetch enrolls this user in the reconciler sweep
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
    # A configured model only counts if it's an IMAGE model — a chat model resolves fine but
    # can't generate (it 400s), so a non-image pick falls through to the auto-detect image
    # candidates instead of reporting a false positive.
    candidates = []
    if model_spec and _is_image_model(model_spec):
        candidates.append(model_spec)
    candidates += ["gpt-image-1.5", "gpt-image-1", "dall-e-3"]
    for cand in candidates:
        if not cand:
            continue
        try:
            _resolve_model(cand, owner=user or None)
            return True
        except Exception:
            continue
    return False


def _extract_chat_image_url(data: dict) -> Optional[str]:
    """Pull a generated image's URL (a data: URL or an https: URL) out of a chat-completions
    response — OpenRouter returns images on the assistant message: as `message.images[]`
    (native image-output models, a data URL), as an image part in `message.content`, or as a
    URL embedded in text content (the openrouter:image_generation server tool). Best-effort."""
    try:
        msg = data["choices"][0]["message"]
    except (KeyError, IndexError, TypeError):
        return None
    if not isinstance(msg, dict):
        return None

    def _url_of(obj):
        if not isinstance(obj, dict):
            return None
        iu = obj.get("image_url")
        if isinstance(iu, dict) and isinstance(iu.get("url"), str):
            return iu["url"]
        if isinstance(iu, str) and iu:
            return iu
        return obj.get("url") if isinstance(obj.get("url"), str) else None

    images = msg.get("images")
    if isinstance(images, list):
        for im in images:
            u = _url_of(im)
            if u:
                return u
    content = msg.get("content")
    if isinstance(content, list):
        for part in content:
            if isinstance(part, dict) and part.get("type") in ("image_url", "output_image", "image"):
                u = _url_of(part)
                if u:
                    return u
    if isinstance(content, str) and content:
        m = re.search(r'(data:image/[A-Za-z0-9.+\-]+;base64,[A-Za-z0-9+/=]+|https?://[^\s)"\']+)', content)
        if m:
            return m.group(1)
    return None


def _chat_text_hint(data: dict) -> Optional[str]:
    """A short clip of the assistant's text reply — useful when no image came back (the model
    may have explained why). Best-effort; never our prompt."""
    try:
        c = data["choices"][0]["message"].get("content")
        if isinstance(c, str) and c.strip():
            return c.strip()[:140]
    except Exception:
        pass
    return None


def _data_url_png(png: bytes) -> str:
    """A `data:image/png;base64,…` URL for a reference image part (G26)."""
    return "data:image/png;base64," + base64.b64encode(png).decode()


async def _image_bytes_from_url(client, url: str) -> Optional[bytes]:
    """Decode a data: URL or fetch an https: URL to raw image bytes. None on any failure."""
    try:
        if url.startswith("data:"):
            b64 = url.split(",", 1)[1] if "," in url else ""
            return base64.b64decode(b64) if b64 else None
        r = await client.get(url)
        return r.content if r.status_code == 200 else None
    except Exception:
        return None


# G26: prepended to the portrait prompt in 'reference' mode — the player wants their own
# likeness, lightly restyled. Instructs the model toward minimal facial alteration ("as low
# adulteration as possible but still AI generated").
REFERENCE_PROMPT_PREFIX = (
    "Recreate the person in the provided photo as a reality-TV cast portrait. Preserve their "
    "facial identity, bone structure, skin tone, hair, and distinguishing features as "
    "faithfully as possible — keep the face clearly recognizable as the same person, with "
    "minimal alteration. Restyle only the lighting, framing, and background to match: "
)


async def _generate_via_images_edit(client, base_url: str, model_id: str, prompt: str,
                                    headers: dict, reference_png: bytes,
                                    quality: str) -> Optional[bytes]:
    """OpenAI gpt-image image-to-image via /images/edits (multipart). The reference image
    conditions the result. Best-effort: returns None and records a reason on failure."""
    edits_url = base_url + "/images/edits"
    # httpx sets the multipart Content-Type (with boundary) itself — drop any JSON one.
    h = {k: v for k, v in (headers or {}).items() if k.lower() != "content-type"}
    files = {"image": ("headshot.png", reference_png, "image/png")}
    data = {"model": model_id, "prompt": prompt, "size": "1024x1024"}
    if quality in ("low", "medium", "high", "auto"):
        data["quality"] = quality
    try:
        resp = await client.post(edits_url, data=data, files=files, headers=h)
        if resp.status_code != 200:
            logger.info("[portraits] images/edits %s: %s", resp.status_code, resp.text[:200])
            _note_gen_error(f"http-{resp.status_code}", _provider_error_reason(resp))
            return None
        body = resp.json()
        imgs = body.get("data", []) if isinstance(body, dict) else []
        if imgs and imgs[0].get("b64_json"):
            return base64.b64decode(imgs[0]["b64_json"])
        if imgs and imgs[0].get("url"):
            ir = await client.get(imgs[0]["url"])
            return ir.content if ir.status_code == 200 else None
        _note_gen_error("empty-response")
        return None
    except Exception as e:
        logger.info("[portraits] images/edits failed: %s", e)
        _note_gen_error(type(e).__name__)
        return None


async def _generate_via_chat_completions(client, chat_url: str, model_id: str,
                                         prompt: str, headers: dict,
                                         reference_png: Optional[bytes] = None) -> Optional[bytes]:
    """OpenRouter (and compatible) image generation over /chat/completions.

    Two mechanisms, tried in order: native image-output via `modalities: [image, text]`
    (the image-collection models), then the `openrouter:image_generation` server tool (any
    model orchestrates and returns an image URL). The image is extracted from the assistant
    message (data: or https:) and decoded. Best-effort: returns None and records the most
    informative reason on failure.

    G26: when `reference_png` is set (the player's uploaded headshot), it rides along as an
    image part in the user message — the model recreates THAT person in the requested style
    (image-to-image / likeness preservation), the prompt already carrying the identity-keep
    instruction."""
    if reference_png:
        content = [
            {"type": "text", "text": prompt},
            {"type": "image_url", "image_url": {"url": _data_url_png(reference_png)}},
        ]
    else:
        content = prompt
    base_msg = {"model": model_id, "messages": [{"role": "user", "content": content}]}
    attempts = (
        {**base_msg, "modalities": ["image", "text"]},
        {**base_msg, "tools": [{"type": "openrouter:image_generation"}]},
    )
    last_reason, last_detail = "no-image", None
    for payload in attempts:
        try:
            resp = await client.post(chat_url, json=payload, headers=headers)
        except Exception as e:  # transport error — try the next mechanism
            last_reason, last_detail = type(e).__name__, None
            continue
        if resp.status_code != 200:
            logger.info("[portraits] openrouter chat %s: %s", resp.status_code, resp.text[:200])
            last_reason, last_detail = f"http-{resp.status_code}", _provider_error_reason(resp)
            continue
        try:
            data = resp.json()
        except Exception:
            last_reason, last_detail = "bad-json", None
            continue
        img_url = _extract_chat_image_url(data)
        if not img_url:
            last_reason, last_detail = "no-image-in-response", _chat_text_hint(data)
            continue
        png = await _image_bytes_from_url(client, img_url)
        if png:
            return png
        last_reason, last_detail = "image-decode-failed", None
    _note_gen_error(last_reason, last_detail)
    return None


async def _generate_one(prompt: str, user: Optional[str],
                        reference_png: Optional[bytes] = None) -> Optional[bytes]:
    """Generate a single image from `prompt`; return PNG bytes, or None on any failure.

    Best-effort: every failure path returns None (never raises) so a flaky image API can
    never break game start or leak an error to the player. OpenRouter endpoints generate
    via /chat/completions (see _generate_via_chat_completions); others use the OpenAI
    Images API (/images/generations).

    G26: when `reference_png` is set (the player's uploaded headshot, 'reference' mode) the
    prompt is prefixed with an identity-preservation instruction and the image is sent to the
    provider's image-to-image path — OpenRouter chat with the image part, OpenAI /images/edits.
    A provider with no img2img path falls back to plain text-to-image (logged) so a portrait
    still lands; the likeness is best-effort, never a hard failure.
    """
    import httpx
    from src.ai_interaction import _resolve_model

    enabled, model_spec, quality = _image_settings(user)
    if not enabled or not prompt:
        return None
    if reference_png:
        prompt = REFERENCE_PROMPT_PREFIX + prompt

    # Ignore a configured CHAT model (it can't generate — it would 400) and fall back to
    # image auto-detect, mirroring image_generation_available so a stale/mis-set model never
    # 400-loops the pipeline.
    if model_spec and not _is_image_model(model_spec):
        logger.info("[portraits] configured image_model %r is not an image model — using auto-detect", model_spec)
        model_spec = ""

    if not model_spec:
        for candidate in ("gpt-image-1.5", "gpt-image-1", "dall-e-3"):
            try:
                _resolve_model(candidate, owner=user or None)
                model_spec = candidate
                break
            except Exception:
                continue
    if not model_spec:
        _note_gen_error("no-model")
        return None

    try:
        url, model_id, headers = _resolve_model(model_spec, owner=user or None)
    except Exception as e:
        logger.info("[portraits] no image model resolved: %s", e)
        _note_gen_error("no-model")
        return None

    # OpenRouter does NOT implement the OpenAI /images/generations endpoint — its image
    # models emit images through /chat/completions (native image-output via `modalities`,
    # or any model via the openrouter:image_generation server tool). POSTing /images/...
    # there 400s on every model, so route OpenRouter to the chat-completions transport.
    is_openrouter = "openrouter.ai" in (url or "").lower()
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
            if is_openrouter:
                # OpenRouter does image-to-image natively via the chat image part (G26).
                return await _generate_via_chat_completions(client, url, model_id, prompt,
                                                            headers, reference_png=reference_png)
            if reference_png:
                if is_gpt_image:
                    # OpenAI gpt-image edits: the reference image conditions the result.
                    return await _generate_via_images_edit(client, base_url, model_id, prompt,
                                                           headers, reference_png, quality)
                # No img2img path for this provider — render text-to-image so a portrait still
                # lands (likeness is best-effort), and say so in the log.
                logger.info("[portraits] reference mode unsupported by %s — text-to-image fallback", model_id)
            resp = await client.post(images_url, json=payload, headers=headers)
            if resp.status_code != 200:
                logger.info("[portraits] image API %s: %s", resp.status_code, resp.text[:200])
                _note_gen_error(f"http-{resp.status_code}", _provider_error_reason(resp))
                return None
            data = resp.json()
            images = data.get("data", [])
            if not images:
                _note_gen_error("empty-response")
                return None
            img = images[0]
            if img.get("b64_json"):
                return base64.b64decode(img["b64_json"])
            if img.get("url"):
                # Some providers return a URL instead of inline bytes — fetch them.
                ir = await client.get(img["url"])
                if ir.status_code == 200:
                    return ir.content
                _note_gen_error(f"image-fetch-http-{ir.status_code}")
                return None
            _note_gen_error("empty-response")
            return None
    except Exception as e:
        logger.info("[portraits] generation failed: %s", e)
        _note_gen_error(type(e).__name__)
        return None


def _write_portrait(user: Optional[str], houseguest_id: str, png: bytes, name: str,
                    source: str = "generated") -> str:
    """Persist one portrait + update the manifest; return its stored filename.

    `source` (G26) records HOW the portrait was made: 'generated' (text-to-image, the default),
    'reference' (image-to-image off the player's headshot — still AI, re-creatable), or 'upload'
    (the player's literal cropped photo — LOCKED: the regenerate lever never discards it)."""
    d = user_portrait_dir(user)
    d.mkdir(parents=True, exist_ok=True)
    filename = f"{_safe_id(houseguest_id)}.png"
    (d / filename).write_bytes(png)
    manifest = load_manifest(user)
    manifest[_safe_id(houseguest_id)] = {"file": filename, "name": name, "source": source}
    _save_manifest(user, manifest)
    return filename


# ── G26: the player's own headshot — uploaded during casting, applied as their portrait ─────
# Two modes (player's choice): 'exact' = their cropped photo stored verbatim (no AI); 'reference'
# = an image-to-image studio portrait that keeps their likeness. The upload lives under the
# user's portrait dir so a new-season scrub clears it (casting re-asks); the source image
# PERSISTS so 'reference' mode can re-render on a regenerate.
PLAYER_PORTRAIT_ID = "player"


def _intake_dir(user: Optional[str]) -> Path:
    return user_portrait_dir(user) / "_intake"


def _normalize_upload(raw: bytes, *, square: bool) -> Optional[bytes]:
    """Decode an uploaded image, honor EXIF orientation, optionally center-square-crop (biased
    slightly up — faces sit high in a frame), bound the long edge to 1024, re-encode PNG.
    Returns PNG bytes, or None on any failure (a bad upload never raises)."""
    try:
        import io
        from PIL import Image, ImageOps

        im = Image.open(io.BytesIO(raw))
        im = ImageOps.exif_transpose(im)
        im = im.convert("RGB")
        if square:
            w, h = im.size
            s = min(w, h)
            left = (w - s) // 2
            top = max(0, (h - s) // 2 - int(h * 0.06))
            im = im.crop((left, top, left + s, top + s))
        im.thumbnail((1024, 1024), Image.LANCZOS)
        out = io.BytesIO()
        im.save(out, format="PNG")
        return out.getvalue()
    except Exception as e:
        logger.info("[portraits] upload normalize failed: %s", e)
        return None


def save_player_intake(user: Optional[str], raw_image: bytes, mode: str) -> Optional[dict]:
    """Store the player's uploaded headshot + chosen mode ('exact'|'reference'). The source is
    normalized to an oriented, bounded PNG; returns the saved meta, or None if it couldn't be
    read as an image."""
    mode = mode if mode in ("exact", "reference") else "reference"
    norm = _normalize_upload(raw_image, square=False)
    if not norm:
        return None
    d = _intake_dir(user)
    d.mkdir(parents=True, exist_ok=True)
    (d / "source.png").write_bytes(norm)
    meta = {"mode": mode, "ts": time.time()}
    try:
        (d / "meta.json").write_text(json.dumps(meta), encoding="utf-8")
    except OSError as e:
        logger.info("[portraits] intake meta write failed: %s", e)
        return None
    return meta


def load_player_intake(user: Optional[str]) -> Optional[dict]:
    """The player's pending headshot meta ({mode, ts}) when both meta + source exist, else None."""
    d = _intake_dir(user)
    try:
        meta = json.loads((d / "meta.json").read_text(encoding="utf-8"))
        if isinstance(meta, dict) and (d / "source.png").exists():
            return meta
    except (OSError, ValueError):
        pass
    return None


def _read_intake_source(user: Optional[str]) -> Optional[bytes]:
    try:
        return (_intake_dir(user) / "source.png").read_bytes()
    except OSError:
        return None


def clear_player_intake(user: Optional[str]) -> None:
    import shutil
    try:
        shutil.rmtree(_intake_dir(user))
    except OSError:
        pass


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

    generated = 0
    skipped = 0
    newly_shown = []  # (houseguestId, ref) for beat recording

    # G26 pre-pass: the player's EXACT uploaded photo needs no provider — apply it BEFORE the
    # availability gate, so "untouched by AI" works even when no image model is configured.
    intake = load_player_intake(user)
    if intake and intake.get("mode") == "exact":
        for entry in prompts:
            if not isinstance(entry, dict):
                continue
            hid = entry.get("houseguestId") or entry.get("id")
            if not hid or _safe_id(str(hid)) != PLAYER_PORTRAIT_ID:
                continue
            if portrait_file(user, hid) is not None:
                break  # already on disk (generate-once)
            cropped = _normalize_upload(_read_intake_source(user) or b"", square=True)
            if cropped:
                try:
                    _write_portrait(user, str(hid), cropped, str(entry.get("name") or ""), source="upload")
                    log_attempt(str(hid), True, None, 0)
                    generated += 1
                    newly_shown.append((str(hid), f"/api/orwell/portrait/{_safe_id(hid)}"))
                except Exception as e:
                    logger.info("[portraits] failed to persist exact headshot: %s", e)
            break

    # Graceful absence: don't even probe the API per houseguest if generation is off (the exact
    # player photo, if any, already landed above).
    if not image_generation_available(user):
        logger.info("[portraits] image generation unavailable — skipping cast portraits")
        if record_beats and newly_shown:
            await _record_image_beats(newly_shown, user)
        total = len(prompts)
        return {"generated": generated, "skipped": total - generated, "total": total}

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

        # G26: the PLAYER may have chosen 'reference' mode — image-to-image off their headshot
        # (exact mode already landed in the pre-pass above). NPCs always text-to-image.
        is_player = _safe_id(str(hid)) == PLAYER_PORTRAIT_ID
        ref = _read_intake_source(user) if (is_player and intake and intake.get("mode") == "reference") else None
        source = "reference" if ref else "generated"

        _consume_gen_error(); _consume_gen_detail()  # clear any stale reason/detail
        t0 = time.monotonic()
        png = await _generate_one(str(prompt), user, reference_png=ref)
        duration_ms = int((time.monotonic() - t0) * 1000)
        if ref and not png:
            source = "generated"  # reference failed; the log carries the reason
        if not png:
            log_attempt(str(hid), False, _consume_gen_error() or "generation-failed",
                        duration_ms, detail=_consume_gen_detail())
            skipped += 1
            continue
        try:
            _write_portrait(user, str(hid), png, str(name), source=source)
            log_attempt(str(hid), True, None, duration_ms)
            generated += 1
            newly_shown.append((str(hid), f"/api/orwell/portrait/{_safe_id(hid)}"))
        except Exception as e:
            logger.info("[portraits] failed to persist %s: %s", hid, e)
            log_attempt(str(hid), False, "persist-failed", duration_ms)
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


# ── G9 backfill: portraits for seasons that predate 0051 (or whose generation failed) ─────
# Portrait generation originally kicked off ONLY from the createCharacter response, so any
# season created before 0051 merged (or before an image provider was configured) showed
# placeholders forever. The backfill closes that: when the roster is served (or the manual
# "Generate cast portraits" lever is pulled) and portraits are missing for active houseguests,
# fetch each missing houseguest's Vault-free prompt via the engine's live `getPortraitPrompt`
# player-channel tool and run it through the SAME generate+persist pipeline. No engine change.


def missing_portrait_ids(user: Optional[str], roster_cards: list) -> list:
    """Active houseguests (player included) on the roster with no stored portrait.

    THE one definition of "missing" — the roster's lazy backfill, the manual lever, the
    G20 reconciler, and the completeness counters all derive from this helper."""
    note_user_seen(user)  # G20: a missing-set read enrolls this user in the reconciler sweep
    out = []
    for card in roster_cards or []:
        if not isinstance(card, dict):
            continue
        if (card.get("status") or "active") != "active":
            continue  # departed houseguests keep their placeholder — no late generation
        hid = card.get("id")
        if hid and portrait_file(user, hid) is None:
            out.append(str(hid))
    return out


def completeness(user: Optional[str], roster_cards: list) -> dict:
    """{total, present, missing} over the ACTIVE cast (player included) — G20 visibility.

    `missing` comes straight from `missing_portrait_ids` (the one definition), so the
    Health card, the /admin/status page, and the roster counter can never disagree with
    what the backfill/reconciler would actually act on."""
    active = [c for c in roster_cards or []
              if isinstance(c, dict) and (c.get("status") or "active") == "active" and c.get("id")]
    missing = missing_portrait_ids(user, roster_cards)
    return {"total": len(active), "present": len(active) - len(missing), "missing": len(missing)}


async def portrait_completeness(user: Optional[str]) -> Optional[dict]:
    """{total, present, missing} for this user's active cast, or None pre-game/engine-down.

    Fetches the same Vault-free public projection the roster route serves and derives the
    cards with the SAME helper (`routes.orwell_routes._roster_cards`, imported lazily —
    routes import this module at load, so the cycle only resolves at call time). Used by
    the admin health surfaces (G20); best-effort — any failure reads as None, never a 500."""
    from src import orwell_engine

    try:
        state = await orwell_engine.get_game_state(user=user)
    except Exception:
        return None
    if not isinstance(state, dict) or state.get("started") is False:
        return None
    try:
        from routes.orwell_routes import _roster_cards  # the one roster-card derivation (G9)
        return completeness(user, _roster_cards(state, user))
    except Exception:
        return None


def backfill_allowed(user: Optional[str]) -> bool:
    """True when this user's process-local backfill debounce window has elapsed."""
    last = _LAST_BACKFILL_AT.get(_safe_user(user))
    return last is None or (time.time() - last) >= BACKFILL_DEBOUNCE_S


async def backfill_missing(missing_ids: list, user: Optional[str]) -> dict:
    """Fetch each missing houseguest's prompt from the engine and generate + persist it.

    Best-effort throughout (never raises): a houseguest whose prompt can't be fetched is
    logged to the attempt ring and skipped; the rest still generate. Reuses the standard
    `generate_and_store` pipeline (idempotent, beat-recording, availability-gated)."""
    from src import orwell_engine

    prompts = []
    for hid in missing_ids or []:
        try:
            p = await orwell_engine.get_portrait_prompt(str(hid), user=user)
        except Exception as e:
            logger.info("[portraits] backfill prompt fetch failed for %s: %s", hid, e)
            log_attempt(str(hid), False, "prompt-fetch-failed", 0)
            continue
        if isinstance(p, dict) and p.get("prompt"):
            prompts.append({
                "houseguestId": p.get("houseguestId") or str(hid),
                "name": p.get("name") or "",
                "prompt": p.get("prompt"),
            })
        else:
            log_attempt(str(hid), False, "no-prompt", 0)
    if not prompts:
        return {"generated": 0, "skipped": 0, "total": 0}
    summary = await generate_and_store(prompts, user)
    logger.info("[portraits] backfill for %s: %s", _safe_user(user), summary)
    return summary


def kickoff_backfill(missing_ids: list, user: Optional[str], force: bool = False) -> bool:
    """Fire-and-forget backfill; returns True when a run was actually kicked.

    The AUTOMATIC roster-poll path is debounced (at most one attempt per user per process per
    BACKFILL_DEBOUNCE_S — a failing provider is never hammered). `force=True` is the EXPLICIT
    manual lever ("Generate cast portraits"): a deliberate click means "run now", so it
    bypasses the debounce window — but still STAMPS it, so an auto-poll seconds later can't
    pile on. Never blocks the caller: scheduled on the running loop like `kickoff_generation`."""
    if not missing_ids:
        return False
    if not force and not backfill_allowed(user):
        return False
    _LAST_BACKFILL_AT[_safe_user(user)] = time.time()

    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None
    if loop is not None:
        task = loop.create_task(backfill_missing(list(missing_ids), user))

        def _done(t):
            try:
                t.result()
            except Exception as e:  # pragma: no cover - defensive
                logger.info("[portraits] background backfill error: %s", e)

        task.add_done_callback(_done)
    else:  # non-async callers (tests drive backfill_missing directly)
        try:
            asyncio.run(backfill_missing(list(missing_ids), user))
        except Exception as e:
            logger.info("[portraits] sync backfill error: %s", e)
    return True


# ── G20: the portrait reconciler (the autonomous verify-and-retry loop) ───────────────────


def _load_reconcile_state() -> dict:
    """The persisted budget sidecar: {safeUser: {safeId: {attempts, cooldown}}}."""
    try:
        with open(RECONCILE_STATE_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return {}


def _save_reconcile_state(state: dict) -> None:
    """Best-effort atomic write (mirrors the attempt log) — never breaks a sweep."""
    try:
        RECONCILE_STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
        tmp = RECONCILE_STATE_PATH.with_suffix(".json.tmp")
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(state, f, indent=2)
        os.replace(tmp, RECONCILE_STATE_PATH)
    except Exception as e:  # pragma: no cover - defensive
        logger.info("[portraits] reconcile-state write failed: %s", e)


def _clear_counters(safe_user: str) -> None:
    """Drop one user's budget counters (fresh provider / complete set / new season)."""
    sidecar = _load_reconcile_state()
    if safe_user in sidecar:
        sidecar.pop(safe_user, None)
        _save_reconcile_state(sidecar)


def _user_counters(sidecar: dict, safe_user: str) -> dict:
    """One user's counters from the sidecar, shape-normalized (a tampered/corrupt file
    must degrade to a fresh budget, never crash the sweep)."""
    raw = sidecar.get(safe_user)
    out: dict = {}
    if isinstance(raw, dict):
        for k, v in raw.items():
            if isinstance(v, dict):
                try:
                    out[str(k)] = {"attempts": int(v.get("attempts") or 0),
                                   "cooldown": int(v.get("cooldown") or 0)}
                except (TypeError, ValueError):
                    continue
    return out


async def _reconcile_user(user: Optional[str]) -> Optional[dict]:
    """One user's verify-and-retry pass: {missing, attempted}, or None when idling.

    The gates, cheapest first:
      (a) an active game exists — engine state, fail-open (engine trouble = idle quietly);
      (b) a provider is usable — ABSENCE idles and never consumes the retry budget; the
          absent→present transition resets every counter (a fresh provider = a fresh budget,
          because the burned attempts belonged to the old/missing one);
      (c) missing = the roster route's own card derivation + `missing_portrait_ids` (the
          shared helpers — never a second definition of "missing");
      (d) the per-houseguest budget picks the eligible subset: after failed attempt n a
          houseguest cools down ~2^n cycles; RECONCILE_MAX_ATTEMPTS real failures and the
          reconciler stands down for it (the lazy roster backfill + manual lever remain);
      (e) eligible ids retry THROUGH the standard pipeline (`backfill_missing`). Debounce
          coordination is deliberate: the reconciler BYPASSES the lazy-path window *read*
          — its per-houseguest budget is stricter and cycle-timed, and aliasing the 10-min
          blanket window against the 5-min cycle would make backoff timing arbitrary — but
          it WRITES the stamp, so a roster poll seconds after a reconciler attempt cannot
          immediately re-hammer the same failing provider;
      (f) outcomes: a landed portrait clears its counter (success resets); only a real
          failed attempt consumes budget.

    Logs TRANSITIONS only — started / complete / gave-up-per-budget / provider-appeared —
    never a line per idle cycle (the A9 lesson)."""
    from src import orwell_engine

    safe = _safe_user(user)

    # (a) an active game — cheap and fail-open.
    try:
        state = await orwell_engine.get_game_state(user=user)
    except Exception:
        return None
    if not isinstance(state, dict) or state.get("started") is False:
        return None

    # (b) the provider gate — absence idles WITHOUT consuming the budget.
    try:
        available = bool(image_generation_available(user))
    except Exception:
        available = False
    was_available = _PROVIDER_SEEN.get(safe)
    _PROVIDER_SEEN[safe] = available
    if not available:
        return None
    if was_available is False:
        _clear_counters(safe)
        logger.info("[portraits] reconciler: image provider available for %s — retry budget reset", safe)

    # (c) what's missing — the SAME derivation the roster route serves.
    from routes.orwell_routes import _roster_cards  # lazy: routes import this module at load

    cards = _roster_cards(state, user)
    missing = missing_portrait_ids(user, cards)
    prev_missing = _LAST_MISSING.get(safe)
    _LAST_MISSING[safe] = len(missing)
    if not missing:
        if prev_missing:
            done = completeness(user, cards)
            logger.info("[portraits] reconciler: portrait set complete for %s (%d/%d)",
                        safe, done["present"], done["total"])
        _clear_counters(safe)  # nothing to track when nothing is missing
        return {"missing": 0, "attempted": 0}
    if not prev_missing:
        logger.info("[portraits] reconciler: %d portrait(s) missing for %s — verify-and-retry engaged",
                    len(missing), safe)

    # (d) the budget/backoff filter.
    sidecar = _load_reconcile_state()
    counters = _user_counters(sidecar, safe)
    live_ids = {_safe_id(h) for h in missing}
    counters = {k: v for k, v in counters.items() if k in live_ids}  # landed/departed: tidy
    eligible = []
    for hid in missing:
        sid = _safe_id(hid)
        entry = counters.get(sid) or {"attempts": 0, "cooldown": 0}
        if entry["attempts"] >= RECONCILE_MAX_ATTEMPTS:
            continue  # budget spent — the lazy/manual paths own this one now
        if entry["cooldown"] > 0:
            counters[sid] = {"attempts": entry["attempts"], "cooldown": entry["cooldown"] - 1}
            continue
        eligible.append(hid)
    if not eligible:
        sidecar[safe] = counters
        _save_reconcile_state(sidecar)
        return {"missing": len(missing), "attempted": 0}

    # (e) retry through the standard pipeline; stamp the lazy-path debounce (see docstring).
    _LAST_BACKFILL_AT[safe] = time.time()
    await backfill_missing(list(eligible), user)

    # (f) outcomes — success resets; a real failed attempt consumes one budget unit.
    for hid in eligible:
        sid = _safe_id(hid)
        if portrait_file(user, hid) is not None:
            counters.pop(sid, None)
            continue
        attempts = (counters.get(sid) or {"attempts": 0}).get("attempts", 0) + 1
        counters[sid] = {"attempts": attempts, "cooldown": 2 ** attempts}
        if attempts == RECONCILE_MAX_ATTEMPTS:
            logger.info("[portraits] reconciler: gave up on %s for %s after %d failed attempts — "
                        "the roster backfill and the manual lever still work", sid, safe, attempts)
    sidecar[safe] = counters
    _save_reconcile_state(sidecar)
    return {"missing": len(missing), "attempted": len(eligible)}


async def reconcile_once() -> dict:
    """One sweep over every user seen this process: {safeUser: result-or-None}.

    Exposed for tests; the loop calls it on the interval. One user's trouble never
    starves another's pass (per-user isolation, like every other portrait surface)."""
    results: dict = {}
    for safe, raw in list(_SEEN_USERS.items()):
        try:
            results[safe] = await _reconcile_user(raw)
        except Exception as e:
            logger.info("[portraits] reconcile for %s failed: %s", safe, e)
            results[safe] = None
    return results


async def _reconcile_loop() -> None:
    """The per-process G20 loop: sleep first (nothing is registered at startup), then
    sweep. A cycle error never kills the loop; cancellation passes through."""
    while True:
        await asyncio.sleep(RECONCILE_INTERVAL_S)
        try:
            await reconcile_once()
        except asyncio.CancelledError:  # pragma: no cover - loop teardown
            raise
        except Exception as e:  # pragma: no cover - defensive
            logger.info("[portraits] reconcile sweep error: %s", e)


def ensure_reconciler_started() -> bool:
    """Start the reconcile loop on the running event loop (the app startup hook calls
    this; idempotent). Returns True only when this call actually created the task —
    a second start never double-runs (the single-task guard). A task whose loop died
    (test harnesses / reloads) is replaced rather than wedging the guard forever."""
    global _RECONCILER_TASK
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return False  # no loop (sync caller) — the startup hook always has one
    task = _RECONCILER_TASK
    if task is not None and not task.done():
        try:
            if task.get_loop() is loop:
                return False  # already running here
        except Exception:  # pragma: no cover - defensive
            pass
    _RECONCILER_TASK = loop.create_task(_reconcile_loop())
    return True


def discard_portraits(user: Optional[str], houseguest_ids: list) -> int:
    """Delete the stored portraits + manifest entries for THESE houseguests only (the G25
    debug-regenerate lever); returns how many files were removed.

    Selective on purpose — never the whole dir: the backfill regenerates ACTIVE houseguests
    only, so wiping a departed houseguest's photo would leave a placeholder forever. Clears
    the debounce stamp and the G20 retry budget so the regeneration can run immediately."""
    manifest = load_manifest(user)
    d = user_portrait_dir(user)
    removed = 0
    for hid in houseguest_ids or []:
        sid = _safe_id(hid)
        entry = manifest.get(sid)
        # G26: a player's LITERAL uploaded photo ('upload') is locked — regenerate never
        # discards it. 'reference' (still AI off their headshot) re-renders like any other.
        if isinstance(entry, dict) and entry.get("source") == "upload":
            continue
        entry = manifest.pop(sid, None)
        fname = entry.get("file") if isinstance(entry, dict) else None
        if not fname:
            continue
        try:
            p = d / os.path.basename(str(fname))
            if p.exists():
                p.unlink()
                removed += 1
        except OSError as e:
            logger.info("[portraits] discard of %s failed: %s", sid, e)
    try:
        _save_manifest(user, manifest)
    except OSError as e:
        logger.info("[portraits] discard manifest write failed: %s", e)
    _LAST_BACKFILL_AT.pop(_safe_user(user), None)
    _clear_counters(_safe_user(user))
    return removed


def scrub_user(user: Optional[str]) -> None:
    """Delete one user's portrait set (used on a per-user new-season reset)."""
    import shutil

    d = user_portrait_dir(user)
    try:
        if d.exists():
            shutil.rmtree(d)
    except OSError as e:
        logger.info("[portraits] scrub_user(%s) failed: %s", _safe_user(user), e)
    # A new season may backfill immediately — the old debounce stamp shouldn't gate it.
    _LAST_BACKFILL_AT.pop(_safe_user(user), None)
    # G20: a new season = a new cast — stale budget counters/trackers must not gate it.
    _clear_counters(_safe_user(user))
    _PROVIDER_SEEN.pop(_safe_user(user), None)
    _LAST_MISSING.pop(_safe_user(user), None)


def scrub_all() -> None:
    """Delete every user's portraits (factory/game reset; mirrors the deploy scripts)."""
    import shutil

    try:
        if PORTRAITS_DIR.exists():
            shutil.rmtree(PORTRAITS_DIR)
    except OSError as e:
        logger.info("[portraits] scrub_all failed: %s", e)
    # G20: the budget sidecar and trackers describe casts that no longer exist.
    try:
        RECONCILE_STATE_PATH.unlink(missing_ok=True)
    except OSError:
        pass
    _PROVIDER_SEEN.clear()
    _LAST_MISSING.clear()
