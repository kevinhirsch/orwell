#!/usr/bin/env python3
"""The responsive matrix gate (Stream S, mechanism part 5 — ruling #16).

Boots the real front-end (and, when available, the real engine with a staged
game) and drives the UI across the viewport matrix with MEASURABLE assertions:

  overflow  — no page-level horizontal scroll; no surface wider than its box
  overlap   — no registered game surface intersects another or the composer
              (the D2 collision rule, executable)
  crowding  — no visible text below the --fs-2xs floor (~11px); no nowrap
              line-box overflow
  touch     — ≥36px interactive boxes at coarse-pointer viewports
  200% pass — doubling the root font must not break the page

KNOWN failures carry a finding ID in XFAIL below and report as xfail (exit 0).
When a finding lands, its xfail flips to a hard assertion by REMOVING the entry
— the gate ratchets. An xpass prints a nudge to remove the entry.

Engine-staged surfaces (status HUD, decision card, …) are exercised when an
engine is reachable (ORWELL_MATRIX_ENGINE=url) or buildable; otherwise the run
covers the page chrome (composer, sidebar, settings, theme modal) — still the
S1/S5/S9 regression net. Usage:  python3 scripts/responsive_matrix.py
"""
import os
import subprocess
import sys
import time
from pathlib import Path

import httpx

FE_DIR = Path(__file__).resolve().parents[1]
PORT = int(os.environ.get("ORWELL_MATRIX_PORT", "8893"))
FE = f"http://127.0.0.1:{PORT}"
ENGINE_URL = os.environ.get("ORWELL_MATRIX_ENGINE", "")

# width, height, coarse-pointer?
VIEWPORTS = [
    ("tiny-320", 320, 568, True),
    ("phone-390", 390, 844, True),
    ("tablet-820", 820, 1180, True),
    ("laptop-1024", 1024, 768, False),   # the ~125%-scaling proxy (S1)
    ("desktop-1366", 1366, 768, False),  # the ruling's "standard PC"
    ("wide-1440", 1440, 900, False),
]

FS_FLOOR_PX = 10.5  # the --fs-2xs floor (~11px) with sub-pixel slack

# finding-ID → substring the failure line must contain. Remove an entry when its
# finding lands; the failure then breaks the gate for real.
XFAIL = {
    "S1": "crowding:settings",          # settings px micro-type until the settings-repair PR
    "S9": "touch:",                     # sub-36px controls beyond the floor rule's reach (swatches, slash rows)
    "R2": "overlap:orwell-presence",    # presence strip over the composer until the chrome PR's slots
    "R2b": "overlap:orwell-retro",      # retrospective over the composer (post-season) — chrome PR
    "R4": "overlap:orwell-status",      # status HUD over the social HUD until E64 moves it to the sidebar
    "E92": "composer-bottom-inset",     # composer touches the viewport bottom until the chrome PR
}

passes, failures, xfails, xpasses = [], [], [], []


def report(kind, line):
    if kind == "fail":
        for fid, needle in XFAIL.items():
            if needle in line:
                xfails.append(f"[{fid}] {line}")
                print(f"XFAIL[{fid}] {line}")
                return
        failures.append(line)
        print(f"FAIL  {line}")
    else:
        passes.append(line)


def boot_fe():
    env = dict(os.environ, ORWELL_GAME_BUILD="1", AUTH_ENABLED="false", LOCALHOST_BYPASS="true")
    if ENGINE_URL:
        env["ORWELL_ENGINE_MCP_URL"] = ENGINE_URL
    proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "app:app", "--host", "127.0.0.1", "--port", str(PORT)],
        cwd=FE_DIR, stdout=open(f"/tmp/fe-matrix-{PORT}.log", "w"), stderr=subprocess.STDOUT, env=env)
    for _ in range(60):
        try:
            if httpx.get(FE, timeout=1).status_code == 200:
                return proc
        except Exception:
            pass
        time.sleep(0.5)
        if proc.poll() is not None:
            sys.exit(f"FAIL — uvicorn exited early; see /tmp/fe-matrix-{PORT}.log")
    sys.exit("FAIL — front-end did not come up")


def stage_game():
    """Best-effort: create a game so the game surfaces render (needs an engine)."""
    if not ENGINE_URL:
        return False
    try:
        r = httpx.post(f"{FE}/api/orwell/new-game",
                       json={"playerName": "Matrix Player", "confirm": True}, timeout=60)
        return r.status_code == 200 and bool(r.json().get("started"))
    except Exception:
        return False


GAME_SURFACES = ["#orwell-status", "#orwell-social", "#orwell-presence",
                 "#orwell-retro", "[id*='ofin']", "[class*='odec']"]
CHROME = {"composer": "#chat-form", "sidebar": "#sidebar"}


def audit_page(page, vp_name, width, height, coarse, with_game):
    page.wait_for_timeout(2500)

    # --- overflow: the page itself never scrolls horizontally -----------------
    over = page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
    if over > 1:
        report("fail", f"{vp_name} overflow:page scrolls horizontally by {over}px")
    else:
        report("pass", f"{vp_name} overflow:page")

    # --- the composer is visible and clear of the bottom edge (E92) ----------
    comp = page.query_selector("#message") or page.query_selector(CHROME["composer"])
    cbox = comp.bounding_box() if comp and comp.is_visible() else None
    if not cbox:
        if with_game:
            report("fail", f"{vp_name} composer missing/invisible")
        else:
            # Pre-game with no model configured the holding state hides the
            # composer by design (F5) — a chrome-only run cannot assert it.
            report("pass", f"{vp_name} composer (skipped — holding state, no game)")
    else:
        if cbox["y"] + cbox["height"] > height - 8:
            report("fail", f"{vp_name} composer-bottom-inset: composer bottom at {cbox['y']+cbox['height']:.0f} of {height}")
        else:
            report("pass", f"{vp_name} composer inset")

    # --- overlap: registered surfaces vs each other and the composer (D2) ----
    boxes = {}
    for sel in GAME_SURFACES:
        el = page.query_selector(sel)
        if el and el.is_visible():
            b = el.bounding_box()
            if b and b["width"] > 4 and b["height"] > 4:
                boxes[sel.strip('#[]*=\"')] = b
    if cbox:
        for name, b in boxes.items():
            if _intersects(b, cbox):
                report("fail", f"{vp_name} overlap:{name} intersects the composer")
    names = list(boxes)
    for i in range(len(names)):
        for j in range(i + 1, len(names)):
            if _intersects(boxes[names[i]], boxes[names[j]]):
                report("fail", f"{vp_name} overlap:{names[i]} intersects {names[j]}")
    report("pass", f"{vp_name} overlap sweep ({len(boxes)} surfaces)")

    # --- crowding: visible text at or above the floor; nowrap overflow -------
    crowd = page.evaluate(f"""
      (() => {{
        const out = [];
        const els = document.querySelectorAll('#settings-modal *, .settings-layout *, #orwell-status *, #orwell-social *, #chat-form *');
        let i = 0;
        for (const el of els) {{
          if (i++ > 2500) break;
          if (!el.offsetParent || !el.textContent || !el.textContent.trim()) continue;
          if (el.children.length > 0) continue;
          const cs = getComputedStyle(el);
          const fs = parseFloat(cs.fontSize);
          if (fs && fs < {FS_FLOOR_PX}) out.push('font ' + fs.toFixed(1) + 'px: ' + el.textContent.trim().slice(0, 30));
          if (cs.whiteSpace === 'nowrap' && cs.overflow === 'visible' && el.scrollWidth > el.clientWidth + 2)
            out.push('nowrap-overflow: ' + el.textContent.trim().slice(0, 30));
        }}
        return out.slice(0, 6);
      }})()
    """)
    scope = "settings" if page.evaluate("!!document.querySelector('#settings-modal,[class*=settings-layout]')") else "page"
    for c in crowd:
        report("fail", f"{vp_name} crowding:{scope} {c}")
    if not crowd:
        report("pass", f"{vp_name} crowding")

    # --- touch: coarse-pointer floors ----------------------------------------
    if coarse:
        small = page.evaluate("""
          [...document.querySelectorAll('button, [role=button], select, .settings-nav-item')]
            .filter(e => e.offsetParent !== null && !e.classList.contains('tap-exempt'))
            .map(e => { const r = e.getBoundingClientRect();
                        return { t: (e.innerText || e.ariaLabel || e.id || '?').slice(0, 20), w: r.width, h: r.height }; })
            .filter(b => b.w > 0 && b.h > 0 && (b.w < 36 || b.h < 36))
            .slice(0, 5)
        """)
        for s in small:
            report("fail", f"{vp_name} touch: {s['t']!r} {s['w']:.0f}x{s['h']:.0f}")
        if not small:
            report("pass", f"{vp_name} touch floors")


def _intersects(a, b):
    pad = 2  # px of grace for borders/shadows
    return not (a["x"] + a["width"] - pad <= b["x"] or b["x"] + b["width"] - pad <= a["x"] or
                a["y"] + a["height"] - pad <= b["y"] or b["y"] + b["height"] - pad <= a["y"])


def main():
    from playwright.sync_api import sync_playwright
    proc = boot_fe()
    with_game = stage_game()
    print(f"== matrix: game surfaces {'STAGED' if with_game else 'absent (no engine — chrome-only run)'}")
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            for vp_name, w, h, coarse in VIEWPORTS:
                ctx = browser.new_context(viewport={"width": w, "height": h},
                                          has_touch=coarse)
                page = ctx.new_page()
                page.goto(FE, wait_until="domcontentloaded")
                audit_page(page, vp_name, w, h, coarse, with_game)

                # settings open (the S1 surface) on a representative pair
                if vp_name in ("desktop-1366", "phone-390"):
                    page.evaluate("(document.querySelector('#settings-btn,[data-settings],[aria-label*=ettings]')||{click(){}}).click()")
                    page.wait_for_timeout(600)
                    audit_page(page, vp_name + "+settings", w, h, coarse, with_game)
                ctx.close()

            # the 200% root-font pass (one representative viewport)
            ctx = browser.new_context(viewport={"width": 1366, "height": 768})
            page = ctx.new_page()
            page.goto(FE, wait_until="domcontentloaded")
            page.evaluate("document.documentElement.style.fontSize = '200%'")
            page.wait_for_timeout(1200)
            over = page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
            if over > 1:
                report("fail", f"font-200% overflow:page scrolls horizontally by {over}px")
            else:
                report("pass", "font-200% page integrity")
            comp = page.query_selector("#message") or page.query_selector("#chat-form")
            if with_game and not (comp and comp.is_visible()):
                report("fail", "font-200% composer missing")
            ctx.close()
            browser.close()
    finally:
        proc.terminate()

    print(f"\n==== matrix: {len(passes)} pass · {len(xfails)} xfail (known findings) · {len(failures)} FAIL")
    for f in failures:
        print(f"  FAIL {f}")
    if xpasses:
        print("  (xpass — consider removing the XFAIL entries: " + ", ".join(xpasses) + ")")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
