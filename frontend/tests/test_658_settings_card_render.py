"""#658 — the Appearance tab composes the OrwellSettingsCard primitive, proven in a REAL browser.

test_658_settings_card_kit.py source-pins the primitive + the settings.js adoption and runs the
kit's transform against a fake DOM. This lane closes the loop end to end: boot the real FE, open
Settings, land on Appearance, and assert every section in that panel actually renders as
``.osc-card`` > ``.osc-head`` (``.osc-title``) + ``.osc-body`` — while KEEPING ``.admin-card`` (so
the peek / empty-tab / ``.closest('.admin-card')`` logic still works) and dropping the per-card
inline padding leak.

Auto-marked ``browser`` by conftest (sync_playwright).
"""
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request

import pytest

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(FRONTEND, "tests"))
from _settings_open import open_settings_deterministically  # noqa: E402


def _free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def _boot(env, port):
    proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "app:app", "--host", "127.0.0.1", "--port", str(port)],
        cwd=FRONTEND, env=env,
        stdout=open(f"/tmp/fe-658-render-{port}.log", "w"), stderr=subprocess.STDOUT,
    )
    base = f"http://127.0.0.1:{port}"
    for _ in range(120):
        if proc.poll() is not None:
            raise RuntimeError(f"uvicorn exited early; see /tmp/fe-658-render-{port}.log")
        try:
            urllib.request.urlopen(base + "/openapi.json", timeout=2)
            return proc, base
        except Exception:
            time.sleep(1)
    proc.terminate()
    raise RuntimeError("server never became ready")


@pytest.fixture(scope="module")
def _app():
    try:
        from playwright.sync_api import sync_playwright  # noqa: F401
    except Exception:
        pytest.skip("playwright not installed")
    env = dict(
        os.environ,
        ORWELL_GAME_BUILD="1",
        AUTH_ENABLED="false",
        LOCALHOST_BYPASS="true",
        PLAYWRIGHT_BROWSERS_PATH=os.environ.get("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers"),
        DATABASE_URL="sqlite:///" + os.path.join(tempfile.mkdtemp(prefix="orwell-658-"), "app.db"),
    )
    port = _free_port()
    try:
        proc, base = _boot(env, port)
    except RuntimeError as e:
        pytest.skip(str(e))
    yield base
    proc.terminate()
    try:
        proc.wait(timeout=10)
    except Exception:
        proc.kill()


_ASSERT = r"""
() => {
  const panel = document.querySelector('[data-settings-panel="appearance"]');
  if (!panel) return { error: 'no appearance panel' };
  const cards = Array.from(panel.children).filter(
    c => c.classList && (c.classList.contains('osc-card') || c.classList.contains('admin-card')));
  return {
    cardCount: cards.length,
    rows: cards.map(c => ({
      osc: c.classList.contains('osc-card'),
      admin: c.classList.contains('admin-card'),
      head: !!c.querySelector(':scope > .osc-head > .osc-title'),
      body: !!c.querySelector(':scope > .osc-body'),
      inlinePad: c.style.paddingBottom || '',
    })),
  };
}
"""


def _land_on_appearance(page, base, viewport):
    page.set_viewport_size(viewport)
    page.goto(base + "/", wait_until="load", timeout=30000)
    page.wait_for_timeout(1500)
    open_settings_deterministically(page)
    page.evaluate("() => { const b = document.getElementById('settings-tab-appearance'); if (b) b.click(); }")
    page.wait_for_timeout(400)
    return page.evaluate(_ASSERT)


def _assert_composed(result):
    assert "error" not in result, result.get("error")
    rows = result["rows"]
    assert len(rows) >= 2, f"expected several Appearance sections; got {len(rows)}"
    for r in rows:
        assert r["osc"], "each section is upgraded to .osc-card"
        assert r["admin"], "upgrade KEEPS .admin-card (peek / empty-tab / closest still work)"
        assert r["head"], "each section has an .osc-head > .osc-title"
        assert r["body"], "each section wraps its content in .osc-body"
        assert not r["inlinePad"], "the per-card inline padding leak is dropped"


def test_appearance_sections_compose_the_primitive_desktop(_app):
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        try:
            browser = pw.chromium.launch()
        except Exception as e:
            pytest.skip(f"chromium unavailable: {e}")
        page = browser.new_page()
        result = _land_on_appearance(page, _app, {"width": 1280, "height": 900})
        browser.close()
    _assert_composed(result)


def test_appearance_sections_compose_the_primitive_mobile(_app):
    """≤768px the Settings kit hosts as a bottom sheet (#893); the primitive still composes."""
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        try:
            browser = pw.chromium.launch()
        except Exception as e:
            pytest.skip(f"chromium unavailable: {e}")
        page = browser.new_page()
        result = _land_on_appearance(page, _app, {"width": 390, "height": 844})
        browser.close()
    _assert_composed(result)
