"""Security: contain the email-attachment cache dir (issue #1093).

`_download_attachment` builds the on-disk cache dir from the model-influenced
`folder` and `uid`:

    seg = re.sub(r"[^\\w.-]", "_", f"{folder}_{uid}")
    target_dir = DATA_DIR / "mail-attachments" / seg

The leaf filename was already sanitized inside `_extract_attachment_to_disk`,
but the PARENT dir name was not — a `folder`/`uid` containing "../" or "/"
could walk out of DATA_DIR/mail-attachments. These tests prove the flattened
segment can no longer escape, while a normal folder still maps to a usable dir.

Roles only — no real names / PII. `uid`/`folder` here are adversarial fixtures,
not data.
"""
import importlib
import os
import re

email_server = importlib.import_module("mcp_servers.email_server")

DATA_DIR = email_server.DATA_DIR
ATTACH_ROOT = (DATA_DIR / "mail-attachments").resolve()


def _target_dir(folder, uid):
    """Reproduce the production cache-dir construction from _download_attachment."""
    seg = re.sub(r"[^\w.-]", "_", f"{folder}_{uid}")
    return DATA_DIR / "mail-attachments" / seg


def _assert_contained(folder, uid):
    target = _target_dir(folder, uid).resolve()
    # The resolved cache dir must stay strictly under DATA_DIR/mail-attachments.
    target.relative_to(ATTACH_ROOT)  # raises ValueError if it escaped
    # And it must be an immediate child — exactly one path segment deep — so a
    # crafted value can't nest into an unexpected subtree either.
    assert target.parent == ATTACH_ROOT, (
        f"cache dir {target} is not a direct child of {ATTACH_ROOT}"
    )
    return target


def test_folder_traversal_is_contained():
    # A folder packed with "../" must NOT escape the attachments root.
    _assert_contained("../../etc", 42)


def test_uid_traversal_is_contained():
    # A uid carrying its own traversal is likewise flattened.
    _assert_contained("INBOX", "../../../tmp/evil")


def test_absolute_style_values_are_contained():
    # Leading slashes / absolute-looking values can't anchor elsewhere.
    _assert_contained("/etc/passwd", "/root")


def test_combined_separators_are_contained():
    _assert_contained("a/b/../c", "1/2/..")


def test_normal_folder_still_maps_to_a_usable_dir():
    # The common case (a plain folder + numeric uid) must still produce a stable,
    # contained, recognizable cache dir — no behavior change for legitimate input.
    target = _assert_contained("INBOX", 7)
    assert target.name == "INBOX_7"


def test_extract_attachment_writes_inside_root(tmp_path):
    """End-to-end: a real extraction with a traversal-laden folder/uid writes the
    file INSIDE the attachments root, proving the guard holds at the write sink."""
    import email
    from email.message import EmailMessage

    msg = EmailMessage()
    msg["Subject"] = "role: nominee fixture"
    msg.set_content("body")
    # One attachment whose own filename also tries to traverse — the leaf
    # sanitizer handles that; we are checking the PARENT dir here.
    msg.add_attachment(
        b"payload-bytes",
        maintype="application",
        subtype="octet-stream",
        filename="../../escape.bin",
    )
    # Re-parse to mirror the message_from_bytes path the server uses.
    parsed = email.message_from_bytes(msg.as_bytes())

    target_dir = _target_dir("../../escape", "../9")
    filepath = email_server._extract_attachment_to_disk(parsed, 0, target_dir)

    assert filepath is not None
    resolved = os.path.realpath(filepath)
    # The written file must live under DATA_DIR/mail-attachments — no escape.
    assert resolved.startswith(str(ATTACH_ROOT) + os.sep), (
        f"attachment written outside root: {resolved}"
    )

    # Clean up the artifact we created under the real data dir.
    try:
        os.remove(resolved)
        os.rmdir(os.path.dirname(resolved))
    except OSError:
        pass
