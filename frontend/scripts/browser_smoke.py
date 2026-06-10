#!/usr/bin/env python3
"""Feature 0032 — front-end BROWSER smoke (the headless-browser gate for Tier 3).

The server-side boot smoke (scripts/boot_smoke.py) proves routes are gated, but it cannot
catch a broken browser module graph: the keep-set chat UI (static/app.js, static/js/chat.js)
imports several dropped modules, so deleting a dropped file without also removing its import
would 404 that module and break the app *in the browser* while the server still serves HTML.

This loads the real page in headless chromium and fails if:
  - any /static/*.js request returns >= 400 (a deleted-but-still-imported module), or
  - any uncaught page error fires (a missing reference / syntax error), or
  - the keep-set UI (sidebar, chat container, composer) does not mount.

It is the gate that makes the Tier-3 deletion safe: it stays green only while the keep-set
loads cleanly. Engine-down API 404s (e.g. /api/orwell game state) are expected and ignored —
we only assert on static module loads, uncaught errors, and the keep-set DOM.

Run:  python3 scripts/browser_smoke.py   (needs `playwright install chromium`)
"""
from __future__ import annotations

import os
import subprocess
import sys
import time
import urllib.request

from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # frontend/
PY = os.environ.get("PYTHON", sys.executable)
PORT = int(os.environ.get("ORWELL_FE_BROWSER_PORT", "8195"))

_fails: list[str] = []


def check(cond: bool, label: str) -> None:
    print(("  ok  — " if cond else "  FAIL — ") + label)
    if not cond:
        _fails.append(label)


def boot():
    os.makedirs(os.path.join(ROOT, "data"), exist_ok=True)
    env = dict(os.environ, ORWELL_GAME_BUILD="1", AUTH_ENABLED="false", LOCALHOST_BYPASS="true")
    proc = subprocess.Popen(
        [PY, "-m", "uvicorn", "app:app", "--host", "127.0.0.1", "--port", str(PORT)],
        cwd=ROOT, env=env, stdout=open(f"/tmp/fe-browser-{PORT}.log", "w"), stderr=subprocess.STDOUT,
    )
    base = f"http://127.0.0.1:{PORT}"
    for _ in range(60):
        if proc.poll() is not None:
            sys.exit(f"FAIL — uvicorn exited early; see /tmp/fe-browser-{PORT}.log")
        try:
            urllib.request.urlopen(base + "/openapi.json", timeout=2)
            return proc, base
        except Exception:
            time.sleep(1)
    proc.terminate()
    sys.exit("FAIL — server never became ready")


def main() -> int:
    proc, base = boot()
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            page = browser.new_page()
            page_errors: list[str] = []
            bad_js: list[tuple] = []
            ok_js: list[str] = []

            page.on("pageerror", lambda e: page_errors.append(str(e)))

            def on_response(resp):
                url = resp.url.split("?")[0]
                if "/static/" in url and url.endswith(".js"):
                    (ok_js if resp.status < 400 else bad_js).append((resp.status, url.split("/static/")[-1]))

            page.on("response", on_response)

            page.goto(base + "/", wait_until="load", timeout=30000)
            page.wait_for_timeout(6000)  # let module graph + async init settle

            check(len(ok_js) > 50, f"keep-set JS modules load ({len(ok_js)} static .js, 200)")
            check(not bad_js, f"no broken/missing JS module (4xx: {sorted(set(bad_js))})")
            check(not page_errors, f"no uncaught page errors ({page_errors[:5]})")
            check(page.query_selector("#sidebar") is not None, "keep-set DOM: sidebar mounted")
            check(page.query_selector("#chat-container") is not None, "keep-set DOM: chat container mounted")
            check(page.query_selector("textarea") is not None, "keep-set DOM: composer mounted")

            # C25/A11Y-1: the onboarding overlay is a REAL modal — focus trapped inside the
            # card, everything behind the scrim inert. Driven with actual Tab keypresses.
            page.evaluate("window._orwellOnboardingMount && window._orwellOnboardingMount()")
            page.wait_for_selector("#orwell-onboarding", timeout=3000)
            in_card = page.evaluate("document.activeElement && document.activeElement.id === 'ob-name'")
            check(in_card is True, "onboarding: initial focus lands in the card")
            for _ in range(12):  # tab far past the card's focusables — must wrap, never escape
                page.keyboard.press("Tab")
            trapped = page.evaluate(
                "document.getElementById('orwell-onboarding').contains(document.activeElement)")
            check(trapped is True, "onboarding: Tab cycles INSIDE the card (focus trap)")
            sidebar_inert = page.evaluate("(document.getElementById('sidebar')||{}).inert === true "
                                          "|| document.querySelector('#sidebar') === null "
                                          "|| !!document.querySelector('#sidebar').closest('[inert]')")
            check(sidebar_inert is True, "onboarding: background is inert while mounted")
            page.evaluate("document.getElementById('orwell-onboarding').remove();"
                          "document.querySelectorAll('[inert]').forEach(n => n.inert = false)")

            # C25/A11Y-2: the Diary Room is a real dialog — Escape closes it and focus returns.
            page.evaluate("window._orwellOpenDiaryRoom && window._orwellOpenDiaryRoom()")
            page.wait_for_selector("#orwell-dr-modal", timeout=3000)
            dr_open = page.evaluate("document.getElementById('orwell-dr-modal').style.display === 'flex'")
            check(dr_open is True, "diary room: opens via the seam")
            dr_focus = page.evaluate("document.activeElement && document.activeElement.id === 'osoc-dr-text'")
            check(dr_focus is True, "diary room: focus lands in the entry box")
            page.keyboard.press("Escape")
            dr_closed = page.evaluate("document.getElementById('orwell-dr-modal').style.display === 'none'")
            check(dr_closed is True, "diary room: Escape closes the dialog")

            # The theme picker must stay reachable under the game build. Its sidebar
            # Tools-section entry is hidden, so it's surfaced from Settings → Appearance.
            # Drive the REAL user flow (open Settings via the gear, switch to the
            # Appearance tab) rather than clicking the launcher in isolation — the
            # appearance panel reorders its cards with flex `order:`, so a launcher that
            # exists but is shoved below the fold would pass a blind click() yet be
            # invisible to a player. We assert it is actually the topmost, in-viewport
            # card, then that it opens a populated theme grid.
            theme = page.evaluate(
                """() => {
                  const gear = document.getElementById('user-bar-settings');
                  if (!gear) return { step: 'no-gear' };
                  gear.click();
                  const tab = document.querySelector('[data-settings-tab="appearance"]');
                  if (!tab) return { step: 'no-appearance-tab' };
                  tab.click();
                  const btn = document.getElementById('appearance-theme-btn');
                  if (!btn) return { step: 'no-button' };
                  const br = btn.getBoundingClientRect();
                  const inView = br.top >= 0 && br.top < window.innerHeight && br.width > 0;
                  // The Theme card must render above every other appearance card.
                  const cards = [...document.querySelectorAll(
                    '.settings-appearance-panel > .admin-card')];
                  const themeCard = btn.closest('.admin-card');
                  const isTopmost = cards.every(
                    c => c === themeCard ||
                         themeCard.getBoundingClientRect().top <= c.getBoundingClientRect().top);
                  btn.click();
                  const m = document.getElementById('theme-modal');
                  const grid = document.getElementById('themeGrid');
                  return { step: 'ok', inView, isTopmost,
                           opened: m ? !m.classList.contains('hidden') : false,
                           themes: grid ? grid.children.length : 0 };
                }"""
            )
            check(theme.get("step") == "ok", f"Settings → Appearance reachable ({theme})")
            check(bool(theme.get("inView")) and bool(theme.get("isTopmost")),
                  f"theme picker launcher is the topmost, in-view appearance card ({theme})")
            check(bool(theme.get("opened")) and theme.get("themes", 0) > 0,
                  f"launcher opens a populated theme grid ({theme})")

            # The SIDEBAR "Theme" entry must stay visible under the game build (its
            # Appearance → Sidebar toggle is on by default), while the other dropped
            # Tools items stay hidden. Hiding the whole #tools-section buried Theme even
            # with its toggle on; we now hide the non-Theme items individually.
            sidebar_theme = page.evaluate(
                """() => {
                  const vis = (id) => {
                    const el = document.getElementById(id);
                    if (!el) return null;
                    const cs = getComputedStyle(el);
                    return cs.display !== 'none' && el.offsetParent !== null;
                  };
                  return { theme: vis('tool-theme-btn'),
                           memory: vis('tool-memory-btn'),
                           tasks: vis('tool-tasks-btn') };
                }"""
            )
            check(sidebar_theme.get("theme") is True,
                  f"sidebar Theme entry is visible under the game build ({sidebar_theme})")
            check(sidebar_theme.get("memory") is False and sidebar_theme.get("tasks") is False,
                  f"other dropped Tools items stay hidden ({sidebar_theme})")

            # Hamburger / sidebar alignment: on a phone viewport the hamburger must sit on
            # the SAME side as the sidebar, whichever side that is. A stale CSS rule used to
            # hard-pin the hamburger right on mobile, so a left sidebar left them mismatched.
            mob = browser.new_page(viewport={"width": 390, "height": 844})
            mob.goto(base + "/", wait_until="load", timeout=30000)
            mob.wait_for_timeout(2500)

            def ham_vs_sidebar(force_right):
                return mob.evaluate(
                    """(forceRight) => {
                      const sb = document.getElementById('sidebar');
                      const hb = document.getElementById('hamburger-btn');
                      if (!sb || !hb) return { ok: false, why: 'missing' };
                      sb.classList.toggle('right-side', forceRight);
                      sb.classList.remove('hidden');
                      if (window.syncRailSide) window.syncRailSide();
                      const hr = hb.getBoundingClientRect(), sr = sb.getBoundingClientRect();
                      const sideOf = (r) => (r.left + r.right) / 2 < window.innerWidth / 2 ? 'L' : 'R';
                      return { ham: sideOf(hr), sidebar: sideOf(sr) };
                    }""",
                    force_right,
                )

            left_state = ham_vs_sidebar(False)
            right_state = ham_vs_sidebar(True)
            check(left_state.get("ham") == left_state.get("sidebar") == "L",
                  f"mobile: hamburger follows a LEFT sidebar ({left_state})")
            check(right_state.get("ham") == right_state.get("sidebar") == "R",
                  f"mobile: hamburger follows a RIGHT sidebar ({right_state})")
            mob.close()

            browser.close()
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=15)
        except Exception:
            proc.kill()

    print()
    if _fails:
        print(f"FE BROWSER SMOKE FAILED ({len(_fails)})")
        return 1
    print("FE BROWSER SMOKE PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
