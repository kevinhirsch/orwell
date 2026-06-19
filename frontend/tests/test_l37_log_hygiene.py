"""L37 (remainder) — on-disk ops-log hygiene.

Two pieces, beyond the already-shipped poll-failure throttle:
  (a) the on-disk ops-panel.log is SIZE-CAPPED so a single run capturing an engine-down journal
      firehose can never balloon the file (`_cap_log_file` keeps only the freshest tail);
  (b) the per-poll httpx access lines ("INFO HTTP Request: GET …/models 200") are QUIETED to
      WARNING so the warmup/keepalive/model-discovery probes stop filling the log.

Sync tests only (pytest-asyncio is in auto mode — no async test defs / asyncio.run()).
"""

import logging
import os

import routes.admin_health_routes as ah
from src.log_quiet import quiet_http_loggers, _HTTP_NOISE_LOGGERS


# ── (a) ops-panel.log size cap ────────────────────────────────────────────────
def test_cap_leaves_a_small_file_untouched(tmp_path):
    p = tmp_path / "ops-panel.log"
    body = "a normal short health-panel run\n"
    p.write_text(body, encoding="utf-8")
    ah._cap_log_file(str(p), cap=64 * 1024)
    assert p.read_text(encoding="utf-8") == body, "a file under the cap must be left byte-identical"


def test_cap_truncates_an_oversized_file_to_the_tail(tmp_path):
    p = tmp_path / "ops-panel.log"
    # Write WAY over a small cap; the tail (freshest) must be kept, the head dropped.
    lines = [f"line-{i:06d} firehose\n" for i in range(20000)]
    lines.append("THE-FINAL-FRESHEST-LINE\n")
    p.write_text("".join(lines), encoding="utf-8")
    original = p.stat().st_size
    cap = 8 * 1024
    ah._cap_log_file(str(p), cap=cap)
    capped = p.stat().st_size
    assert capped < original, "an oversized file must shrink"
    # genuinely bounded: the marker counts toward the cap, so the total never exceeds it
    assert capped <= cap
    text = p.read_text(encoding="utf-8")
    assert "log truncated" in text, "a truncation marker must explain the gap"
    assert "THE-FINAL-FRESHEST-LINE" in text, "the freshest tail must survive"
    assert "line-000000" not in text, "the oldest head must be dropped"


def test_cap_is_idempotent_and_never_raises(tmp_path):
    p = tmp_path / "ops-panel.log"
    p.write_text("x" * (50 * 1024), encoding="utf-8")
    cap = 4 * 1024
    ah._cap_log_file(str(p), cap=cap)
    once = p.read_bytes()
    ah._cap_log_file(str(p), cap=cap)  # already capped — leaves it alone
    assert p.read_bytes() == once
    # a missing path is a no-op, never an error
    ah._cap_log_file(str(tmp_path / "does-not-exist.log"), cap=cap)


# ── (b) httpx access-line quieting ────────────────────────────────────────────
def test_quiet_http_loggers_raises_httpx_and_httpcore_to_warning():
    # Start noisy (the firehose state), then quiet.
    for name in _HTTP_NOISE_LOGGERS:
        logging.getLogger(name).setLevel(logging.INFO)
    quiet_http_loggers()
    for name in _HTTP_NOISE_LOGGERS:
        lg = logging.getLogger(name)
        assert lg.level == logging.WARNING, f"{name} must be quieted to WARNING"
        # an INFO access line is now below the bar (would be dropped); a WARNING still passes
        assert not lg.isEnabledFor(logging.INFO)
        assert lg.isEnabledFor(logging.WARNING)


def test_quiet_http_loggers_is_idempotent():
    quiet_http_loggers()
    quiet_http_loggers()
    assert logging.getLogger("httpx").level == logging.WARNING
