"""Default-DENY scrubbing for settings exposed to non-admin / unauthenticated callers.

Deliberately dependency-light (stdlib only) and separate from
``routes/auth_routes.py`` so it can be imported and unit-tested without dragging
in the FastAPI app / auth / database import chain.

``/api/auth/settings`` is auth-exempt — the frontend (and the pre-login page)
read it for keybinds, TTS/STT prefs, the cosmetic login-background config, and a
couple of non-secret model NAMES (image/vision) used by onboarding. Because the
endpoint is reachable WITHOUT auth (load-bearing when the app is behind a
Cloudflare tunnel / reverse proxy), the projection it returns to non-admins must
be **default-DENY**: it exposes ONLY an explicit allow-list of known-safe fields
and drops everything else.

This replaces an earlier DENY-LIST that masked values under secret-SHAPED key
names (``*_api_key``, ``*_token`` …). That leaked any secret stored under a key
NOT named like one (e.g. ``openai_authorization``, ``smtp_login``, a bare
``anthropic``, or any future field). An allow-list cannot leak a key it does not
know about — the safe default for a tunnel-reachable, auth-exempt endpoint.

The AUTHENTICATED admin path is unchanged: admins still receive the full settings
dict (see ``get_settings`` in ``routes/auth_routes.py``).
"""

# ── The explicit allow-list of known-safe, non-secret settings ──
#
# Every key here is read by a pre-login / non-admin front-end consumer (verified
# against static/js/* and static/login.html) and carries no secret, capability
# handle, provider/endpoint routing, internal infra URL, or operator prompt.
#
#   keybinds            keyboard-shortcuts.js, slashCommands.js, settings.js
#   tts_*               tts-ai.js, app.js (overflow TTS button), settings.js
#   stt_*               app.js / settings.js (voice input prefs)
#   image_*             orwellOnboarding.js (image model summary), app.js, settings.js
#   vision_*            settings.js (image analysis prefs) — model NAMES, not secrets
#   time_of_day_enabled app.js / settings.js (in-game clock toggle, HUD)
#   login_*             login.html prefetch + #764 cosmetic login background
#   overseer_mode /     enums injected at read-time by get_settings; the Settings
#   faithfulness_mode   dials read them. Plain enum strings, never a secret.
#
# Anything NOT listed here — every *_api_key / *_token / endpoint+model routing
# config / search provider config / app_public_url / reminder webhook handle /
# operator prompt / agent+token budget — is dropped by construction, including
# any future field added to DEFAULT_SETTINGS.
SAFE_AUTH_EXEMPT_KEYS = frozenset({
    # Keyboard shortcuts (a per-profile UX preference; not a secret).
    "keybinds",
    # Text-to-speech prefs (toggle / provider / model / voice / speed).
    "tts_enabled", "tts_provider", "tts_model", "tts_voice", "tts_speed",
    # Speech-to-text prefs (voice input).
    "stt_enabled", "stt_provider", "stt_model", "stt_language",
    # Image generation — toggle + non-secret model NAME + quality.
    "image_gen_enabled", "image_model", "image_quality",
    # Vision (image analysis) — toggle + non-secret model NAME(s).
    "vision_enabled", "vision_model", "vision_model_fallbacks",
    # In-game time-of-day clock toggle (HUD / ADR 0006).
    "time_of_day_enabled",
    # #764 — cosmetic login-background config (pre-auth page). A validated source
    # enum + per-source cosmetic numbers/preset + an optional (validated) URL.
    "login_background", "login_background_photo_url",
    "login_gradient_preset", "login_gradient_speed", "login_gradient_intensity",
    "login_particles_density", "login_particles_speed", "login_particles_color",
    # Operator-dial enums injected at read time by get_settings (0079/0080/0081).
    # Plain "off"|"shadow"|"active" strings — the Settings dials read them.
    "overseer_mode", "faithfulness_mode",
})


def scrub_settings(settings: dict) -> dict:
    """Project ``settings`` down to the explicit ``SAFE_AUTH_EXEMPT_KEYS`` allow-list.

    Default-DENY: returns ONLY known-safe top-level keys; every other key —
    including any future / unknown field, and any secret stored under a
    non-secret-shaped name — is dropped. Nested structures under a safe key
    (e.g. ``keybinds``) are passed through as-is because those keys hold no
    secrets; an allow-listed key never contains nested sensitive data.

    This is the projection returned to non-admin / unauthenticated callers of
    the auth-exempt ``/api/auth/settings`` route. The admin path is unchanged.
    """
    if not isinstance(settings, dict):
        return {}
    return {k: v for k, v in settings.items() if k in SAFE_AUTH_EXEMPT_KEYS}
