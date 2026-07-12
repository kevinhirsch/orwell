"""#891 F-A6 — composer size cap + immersion-safe connection-error copy.

Two small, self-contained UX-resilience polish items, both source-pinned (no running
engine — same convention as test_914_session_expired_notice.py / test_g17_composer_draft.py):

  * Item 1: the user-facing connection-error line in the chat stream must NOT leak a raw
    HTTP status code (e.g. "(502)") into the rendered bubble — it reads as noise and, in the
    game build, breaks immersion. The interpolated `Connection error (${res.status})` copy is
    replaced by a clean, calm, status-free message. (F-S4-C already reclassified the bubble to
    `.msg-system`; this only cleans the copy.)

  * Item 2: the composer <textarea id="message"> gets a native `maxlength` mirroring the
    server-side inbound cap (`ChatRequest.message` max_length / `validate_message` limit =
    50000) so an over-length paste is stopped client-side before a doomed round-trip. Native
    attribute only — no JS validation, no error UI.
"""

import os

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATIC = os.path.join(FRONTEND, "static")
STATIC_JS = os.path.join(STATIC, "js")

# The server-side inbound message cap this composer mirrors. Sourced from
# src/request_models.py (`ChatRequest.message` max_length) and src/chat_helpers.py
# (`validate_message`'s `len(message) > 50000`). Keep in lock-step if the server cap moves.
SERVER_MESSAGE_CAP = 50000


def _read(*parts) -> str:
    with open(os.path.join(FRONTEND, *parts), encoding="utf-8") as f:
        return f.read()


def _chat_js_files():
    for name in sorted(os.listdir(STATIC_JS)):
        if name.startswith("chat") and name.endswith(".js"):
            yield name, _read("static", "js", name)


# ── Item 1: no chat*.js renders a raw HTTP status into the connection-error copy ──────

def test_no_chat_js_interpolates_the_raw_status_into_the_error_copy():
    # The literal "Connection error (" (with the open paren) is the interpolated-status
    # form — `Connection error (${res.status})`. It must not appear in any chat*.js: a raw
    # status code is noise to the player and an immersion break in the game build.
    offenders = [name for name, src in _chat_js_files() if "Connection error (" in src]
    assert not offenders, (
        "raw HTTP status must not be interpolated into the user-facing connection-error "
        f"copy; found the '(status)' form in: {offenders}"
    )


def test_chat_js_still_shows_a_clean_connection_error_line():
    # The calm, status-free message is still present (we cleaned the copy, we didn't drop
    # the notice) and still tells the player their message didn't go through.
    src = _read("static", "js", "chat.js")
    assert "Connection error" in src
    assert "your message didn't go through" in src


# ── Item 2: the composer textarea carries a native maxlength mirroring the server cap ──

def test_composer_textarea_has_a_maxlength_attribute():
    html = _read("static", "index.html")
    i = html.index('id="message"')
    tag = html[html.rindex("<textarea", 0, i):html.index(">", i) + 1]
    assert "maxlength=" in tag, (
        "the composer <textarea id=\"message\"> must carry a native maxlength attribute"
    )


def test_composer_maxlength_mirrors_the_server_message_cap():
    html = _read("static", "index.html")
    i = html.index('id="message"')
    tag = html[html.rindex("<textarea", 0, i):html.index(">", i) + 1]
    assert f'maxlength="{SERVER_MESSAGE_CAP}"' in tag, (
        f"the composer maxlength should mirror the server inbound cap ({SERVER_MESSAGE_CAP})"
    )
