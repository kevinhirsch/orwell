#!/usr/bin/env python3
"""Render the Apple overlay scrollbars (window kit) for #709 verification.

Boots the real FE, opens a kit window (.ow-window) with a TALL scrolling .ow-body
under Full Glass (body.theme-frosted) over a LIGHT and a DARK wallpaper, and captures:
  at-rest (thumb hidden) · during-scroll (thumb visible) · hover-expand.

It builds the kit window via the live window.OrwellWindowKit.create global (the same
path Settings/Control-Room use), so it exercises the exact .ow-window .ow-body CSS +
orwellScrollbars.js runtime. Pass OW_SCROLL_BEFORE=1 to label the shots "before".

Run:  python3 scripts/scrollbar_shots.py   (needs playwright chromium)
Out:  /tmp/scrollbar-shots/*.png  (override with OW_SCROLL_OUT)
"""
from __future__ import annotations
import os, subprocess, sys, time, urllib.request
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PY = os.environ.get("PYTHON", sys.executable)
PORT = int(os.environ.get("OW_SCROLL_PORT", "8196"))
OUT = os.environ.get("OW_SCROLL_OUT", "/tmp/scrollbar-shots")
TAG = "before" if os.environ.get("OW_SCROLL_BEFORE") else "after"

WALLPAPERS = {
    # light + dark realistic backdrops (CSS gradients stand in for a photo wallpaper)
    "light": "linear-gradient(135deg,#eef2f7 0%,#dfe7f0 45%,#cdd9e8 100%)",
    "dark":  "linear-gradient(135deg,#10131a 0%,#1b2230 50%,#0c0f15 100%)",
}

# Build a kit window with a tall body so the scrollbar engages, force Full Glass, and
# paint a wallpaper behind it. Returns once the .ow-body exists.
BUILD = """(grad) => {
  document.body.classList.add('theme-frosted');
  document.body.style.background = grad;
  document.documentElement.style.background = grad;
  // tear down a prior probe window
  document.querySelectorAll('[data-scroll-probe]').forEach(n => {
    const w = n.closest('.ow-window'); if (w) w.remove(); else n.remove();
  });
  const content = document.createElement('div');
  content.setAttribute('data-scroll-probe','1');
  content.style.padding = '14px 16px';
  let html = '<h3 style="margin:0 0 10px">Settings</h3>';
  for (let i=0;i<60;i++) html += '<p style="margin:0 0 10px;line-height:1.5">Row '+i+
    ' — a line of scrollable settings content to make the body overflow so the overlay scrollbar engages.</p>';
  content.innerHTML = html;
  const win = window.OrwellWindowKit.create({
    id: 'scroll-probe', title: 'Settings', content,
    width: 420, height: 360, draggable: true, resizable: true,
  });
  if (win && win.open) try { win.open(); } catch(e){}   // create() only constructs; open() mounts
  const el = win && win.el ? win.el : (content.closest('.ow-window') || document.querySelector('.ow-window'));
  if (el) {
    el.style.left='80px'; el.style.top='70px';
    el.style.zIndex='99999';                 // sit above any lingering reconnect chrome
    if (win && win.raise) try { win.raise(); } catch(e){}
  }
  return !!document.querySelector('[data-scroll-probe]') &&
         !!(content.closest('.ow-window') || document.querySelector('.ow-window .ow-body'));
}"""

GEOM = """() => {
  const probe = document.querySelector('[data-scroll-probe]');
  const win = probe ? probe.closest('.ow-window') : null;
  const b = win ? win.querySelector('.ow-body') : document.querySelector('.ow-window .ow-body');
  if (!b) return null;
  const r = b.getBoundingClientRect();
  const wr = win ? win.getBoundingClientRect() : r;
  return { x:r.x, y:r.y, w:r.width, h:r.height, right:r.right, bottom:r.bottom,
           win:{ x:wr.x, y:wr.y, w:wr.width, h:wr.height } };
}"""


def boot():
    os.makedirs(os.path.join(ROOT, "data"), exist_ok=True)
    env = dict(os.environ, ORWELL_GAME_BUILD="1", AUTH_ENABLED="false", LOCALHOST_BYPASS="true")
    proc = subprocess.Popen(
        [PY, "-m", "uvicorn", "app:app", "--host", "127.0.0.1", "--port", str(PORT)],
        cwd=ROOT, env=env, stdout=open(f"/tmp/fe-scroll-{PORT}.log", "w"), stderr=subprocess.STDOUT,
    )
    base = f"http://127.0.0.1:{PORT}"
    for _ in range(120):
        if proc.poll() is not None:
            sys.exit(f"FAIL — uvicorn exited; see /tmp/fe-scroll-{PORT}.log")
        try:
            urllib.request.urlopen(base + "/openapi.json", timeout=2); return proc, base
        except Exception:
            time.sleep(1)
    proc.terminate(); sys.exit("FAIL — server never ready")


def main() -> int:
    os.makedirs(OUT, exist_ok=True)
    proc, base = boot()
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            page = browser.new_page(viewport={"width": 720, "height": 560}, device_scale_factor=2)
            page.goto(base + "/", wait_until="load", timeout=30000)
            page.wait_for_timeout(4000)
            # Dismiss the "house is dark" reconnect overlay (engine offline in this harness).
            try:
                for _ in range(3):
                    btn = page.query_selector("text=Go in anyway")
                    if btn:
                        btn.click(); page.wait_for_timeout(400)
                    else:
                        break
            except Exception:
                pass
            for name, grad in WALLPAPERS.items():
                ok = page.evaluate(BUILD, grad)
                if not ok:
                    print(f"  FAIL — kit body not built over {name}"); continue
                page.wait_for_timeout(600)
                g = page.evaluate(GEOM)
                if not g:
                    print("  FAIL — no .ow-body geom"); continue
                cx, cy = g["x"] + g["w"] / 2, g["y"] + g["h"] / 2
                w = g["win"]
                m = 24  # margin so the float shadow + wallpaper context is visible
                clip = {"x": max(0, w["x"] - m), "y": max(0, w["y"] - m),
                        "width": w["w"] + 2 * m, "height": w["h"] + 2 * m}

                # 1) AT REST — move pointer away, let idle fade, capture (thumb hidden)
                page.mouse.move(10, 10); page.wait_for_timeout(1500)
                page.screenshot(path=f"{OUT}/{TAG}-{name}-1-rest.png", clip=clip)

                # 2) DURING SCROLL — wheel inside the body, capture immediately (thumb visible)
                page.mouse.move(cx, cy)
                page.mouse.wheel(0, 240); page.wait_for_timeout(120)
                page.mouse.wheel(0, 240); page.wait_for_timeout(150)
                page.screenshot(path=f"{OUT}/{TAG}-{name}-2-scroll.png", clip=clip)

                # 3) HOVER-EXPAND — park the pointer over the right edge (the thumb track)
                page.mouse.move(g["right"] - 5, cy); page.wait_for_timeout(450)
                page.screenshot(path=f"{OUT}/{TAG}-{name}-3-hover.png", clip=clip)
                print(f"  ok  — captured {name} (rest/scroll/hover)")
            browser.close()
        print("shots →", OUT)
        return 0
    finally:
        proc.terminate()
        try: proc.wait(timeout=10)
        except Exception: proc.kill()


if __name__ == "__main__":
    raise SystemExit(main())
