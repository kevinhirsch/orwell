"""fal.ai image client — Seedream v5 Lite "Sequential" portraits (issue #1153, ADR 0016 §C).

Why this exists (the #1140 fix): the OpenRouter `/chat/completions` image path that today's
`google/gemini-2.5-flash-image` portraits use re-rolls a face from a TEXT prompt every shoot, so a
houseguest's presentation/gender can drift from the narrated pronouns and the SAME houseguest looks
like a different person across re-shoots. Seedream v5 Lite on fal.ai is a reference-image (img2img)
model: we generate ONE canonical headshot per houseguest, persist it, and regenerate AGAINST it
(`image_urls`), so the face + gender stay stable.

fal.ai is a SEPARATE API surface + key + billing from the OpenRouter account (flagged to the operator,
accepted in ADR 0016 §C). It is configured like any other provider — a `ModelEndpoint` row with
``base_url = https://fal.run`` and ``api_key = <FAL_KEY>`` (Fernet-encrypted at rest via the existing
`EncryptedText` column; no new secret store). The fal auth header is ``Authorization: Key <FAL_KEY>``
(NOT ``Bearer``), built by `endpoint_resolver.build_headers` for a fal base.

Endpoint shape (verified against a LIVE fal probe 2026-06-29 — the routing below is what the API
actually accepts; the prior "promote to /edit always" was wrong and 422'd a first shoot):
  text→image  POST https://fal.run/fal-ai/bytedance/seedream/v5/lite/text-to-image
              Body {"prompt": str, "image_size": "auto_2K", "num_images": 1}
  edit (ref)  POST https://fal.run/fal-ai/bytedance/seedream/v5/lite/edit
              Body {"prompt": str, "image_urls": [<https-url>, ...],  # REQUIRED — /edit 422s without
                    "image_size": "auto_2K", "num_images": 1, "max_images": 1}
  Auth  Authorization: Key <FAL_KEY>
  Resp  {"images": [{"url": "https://...", "content_type": "image/...", ...}], "seed": int, ...}
  Cost  ~$0.035 / image.

ROUTE BY REFERENCE PRESENCE (the #1153 fix): `/edit` REQUIRES `image_urls` (HTTP 422
"Field required: image_urls" without them), so a FIRST shoot (no reference — the common case) MUST
hit `/text-to-image`; only a re-shoot (a reference image in hand) hits `/edit`. The slug suffix is
chosen from whether `image_urls` is non-empty, NOT hard-coded onto the model id.

Discipline (mirrors the rest of the portrait pipeline):
  • Vault-free — this client receives only the engine's already-Vault-free portrait prompt + the
    reference image bytes. It never touches a stat, relationship, or hidden element.
  • Best-effort — every failure path returns None (never raises), so a flaky/unconfigured fal account
    can never break game start or surface an error to the player; the caller falls back gracefully.
"""

import base64
import logging
import re
from typing import Optional

logger = logging.getLogger(__name__)

# Default render size asked of fal. `auto_2K` keeps the long edge ~2K and lets fal pick the aspect
# (the prompt + a reference image carry the square-headshot framing; bounded cost).
FAL_DEFAULT_IMAGE_SIZE = "auto_2K"

# The Seedream v5 Lite base slug + its two operation suffixes on fal. The caller picks the suffix at
# request time from whether a reference image is present (text→image vs. edit) — `/edit` REQUIRES
# `image_urls` (422s without), so the suffix is NEVER hard-coded onto the model id. Kept here so the
# autodetect / default wiring + the routing have ONE source of truth.
FAL_SEEDREAM_BASE_SLUG = "fal-ai/bytedance/seedream/v5/lite"
FAL_SEEDREAM_T2I_SLUG = FAL_SEEDREAM_BASE_SLUG + "/text-to-image"  # first shoot — no reference
FAL_SEEDREAM_EDIT_SLUG = FAL_SEEDREAM_BASE_SLUG + "/edit"          # re-shoot — reference in image_urls


def is_fal_model(model_id: Optional[str]) -> bool:
    """True for a fal Seedream slug (configured as the `image_model`). Used by callers that need to
    know "is the selected image model a fal one?" without a URL in hand."""
    lower = str(model_id or "").lower()
    return "seedream" in lower or lower.startswith("fal-ai/")


def _fal_seedream_slug(model_id: str, has_reference: bool) -> str:
    """Resolve the operation slug for a Seedream request from whether a reference image is present.

    The #1153 fix: `/edit` REQUIRES `image_urls` (it 422s without), so a first shoot (no reference)
    MUST route to `/text-to-image` and only a re-shoot (reference in hand) to `/edit`. The incoming
    `model_id` may be the base slug, `.../edit`, or `.../text-to-image` (whatever the operator
    configured) — for a Seedream slug we IGNORE its suffix and pick by reference presence, so the
    routing can never be wrong. A non-Seedream fal slug (a different model) is passed through as-is."""
    slug = str(model_id or FAL_SEEDREAM_BASE_SLUG).strip().strip("/")
    low = slug.lower()
    if "seedream" not in low:
        return slug  # some other fal model — caller knows its shape; don't rewrite it
    # Strip any operation suffix the operator may have configured, then append the correct one.
    base_slug = re.sub(r"/(edit|text-to-image|image-to-image)$", "", slug, flags=re.IGNORECASE)
    return base_slug + ("/edit" if has_reference else "/text-to-image")


def fal_endpoint_url(base_url: str, model_id: str, has_reference: bool = False) -> str:
    """Build the fal POST URL from the endpoint base + model slug, routed by reference presence.

    `base_url` is the configured fal base (``https://fal.run`` — `endpoint_resolver.build_chat_url`
    leaves a fal base unchanged, so it arrives WITHOUT a `/chat/completions` suffix). For a Seedream
    slug the operation suffix is chosen from `has_reference` (the #1153 fix): no reference ⇒
    `/text-to-image` (the first-shoot path; `/edit` would 422 without `image_urls`), a reference ⇒
    `/edit` (reference-image conditioning). The bare/edit/text-to-image slug all normalize correctly."""
    base = (base_url or "https://fal.run").rstrip("/")
    # Strip a stray chat suffix if a caller passed a built chat URL (defensive — fal has no such path).
    for suffix in ("/chat/completions", "/v1/messages"):
        if base.endswith(suffix):
            base = base[: -len(suffix)].rstrip("/")
    return f"{base}/{_fal_seedream_slug(model_id, has_reference)}"


def _data_uri(png: bytes) -> str:
    """A base64 ``data:image/png`` URI fal accepts directly in `image_urls` (no upload round-trip)."""
    return "data:image/png;base64," + base64.b64encode(png).decode()


def _extract_image_url(data: dict) -> Optional[str]:
    """Pull the first generated image URL out of a fal response. fal returns
    ``{"images": [{"url": ...}], ...}``; some surfaces use ``image``/``output`` singular. Best-effort."""
    if not isinstance(data, dict):
        return None
    imgs = data.get("images")
    if isinstance(imgs, list):
        for im in imgs:
            if isinstance(im, dict) and isinstance(im.get("url"), str) and im["url"]:
                return im["url"]
            if isinstance(im, str) and im:
                return im
    # Singular fall-throughs seen on some fal models.
    for key in ("image", "output"):
        v = data.get(key)
        if isinstance(v, dict) and isinstance(v.get("url"), str) and v["url"]:
            return v["url"]
        if isinstance(v, str) and v:
            return v
    return None


def _error_reason(resp) -> Optional[str]:
    """A short, SAFE hint from a non-200 fal response (fal's own error message), clipped; never our
    prompt. fal errors look like ``{"detail": "..."}`` or ``{"detail": [{"msg": ...}]}``."""
    try:
        body = resp.json()
    except Exception:
        return None
    if not isinstance(body, dict):
        return None
    det = body.get("detail")
    if isinstance(det, str) and det:
        return det[:140]
    if isinstance(det, list) and det:
        first = det[0]
        if isinstance(first, dict):
            msg = first.get("msg") or first.get("message")
            if msg:
                return str(msg)[:140]
    for key in ("error", "message"):
        v = body.get(key)
        if isinstance(v, str) and v:
            return v[:140]
        if isinstance(v, dict):
            m = v.get("message") or v.get("detail")
            if m:
                return str(m)[:140]
    return None


async def generate_via_fal(client, base_url: str, model_id: str, prompt: str, headers: dict,
                           reference_pngs: Optional[list] = None,
                           image_size: str = FAL_DEFAULT_IMAGE_SIZE) -> tuple:
    """Generate ONE portrait via fal Seedream and return ``(png_bytes_or_None, error, detail)``.

    `reference_pngs` (the identity-carry input — the canonical headshot, the player's upload, the
    houseguest's current portrait on a re-shoot) ride along as base64 data-URIs in `image_urls`;
    an empty/absent list is a plain text→image generation. Up to 10 refs are passed (fal's cap).

    Best-effort: returns ``(None, reason, detail)`` on any failure — the caller logs it; nothing
    raises. `headers` already carries ``Authorization: Key <FAL_KEY>`` (built by the resolver)."""
    if not prompt:
        return None, "empty-prompt", None

    # Build the reference set FIRST — it decides the routing. A first shoot (no reference) goes to
    # `/text-to-image`; a re-shoot (reference present) goes to `/edit`, which REQUIRES `image_urls`
    # (the #1153 fix — `/edit` 422s "Field required: image_urls" without them).
    image_urls = []
    for png in (reference_pngs or []):
        if png:
            image_urls.append(_data_uri(png))
            if len(image_urls) >= 10:
                break

    url = fal_endpoint_url(base_url, model_id, has_reference=bool(image_urls))

    payload = {
        "prompt": prompt,
        "image_size": image_size,
        "num_images": 1,
    }
    if image_urls:
        # `/edit` only — carry the references and cap the output to one image.
        payload["image_urls"] = image_urls
        payload["max_images"] = 1

    # fal wants application/json; the resolver-built headers carry the Key auth. Ensure content-type.
    h = dict(headers or {})
    h.setdefault("Content-Type", "application/json")

    try:
        resp = await client.post(url, json=payload, headers=h)
    except Exception as e:
        logger.info("[fal] request failed: %s", e)
        return None, type(e).__name__, None

    if resp.status_code != 200:
        reason = _error_reason(resp)
        logger.info("[fal] %s: %s", resp.status_code, (resp.text[:200] if hasattr(resp, "text") else ""))
        return None, f"http-{resp.status_code}", reason

    try:
        data = resp.json()
    except Exception:
        return None, "bad-json", None

    img_url = _extract_image_url(data)
    if not img_url:
        return None, "no-image-in-response", None

    # fal returns a hosted URL (or, when image bytes are inlined, a data: URI) — fetch/decode it.
    try:
        if img_url.startswith("data:"):
            b64 = img_url.split(",", 1)[1] if "," in img_url else ""
            return (base64.b64decode(b64) if b64 else None), (None if b64 else "image-decode-failed"), None
        ir = await client.get(img_url)
        if getattr(ir, "status_code", 0) == 200:
            return ir.content, None, None
        return None, f"image-fetch-http-{getattr(ir, 'status_code', '?')}", None
    except Exception as e:
        logger.info("[fal] image fetch/decode failed: %s", e)
        return None, "image-decode-failed", None
