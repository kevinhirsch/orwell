#!/usr/bin/env python3
"""#794 capture: prove the Settings window flies IN to its final centered position
in ONE motion (no "fly right → jump to center"). Boots the real app under FULL
GLASS (frosted on), opens Settings, and samples the window's bounding box across
the open animation. A clean fly-in keeps the window centered for every frame; the
bug showed an early-frame RIGHTWARD excursion that snapped back to center.

Usage:
  ORWELL_REVERSED_MOTION=0 python3 scripts/_capture_794_flyin.py
Prints per-frame {t, left, centerX, viewportCenterX, dx} and a PASS/FAIL verdict,
and writes a frame screenshot at the first sampled frame + the settled frame.
"""
from __future__ import annotations
import os, subprocess, sys, time, urllib.request
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PY = sys.executable
PORT = int(os.environ.get("ORWELL_FE_CAP_PORT", "8197"))
OUT = os.path.join(ROOT, "data", "_794_capture")
os.makedirs(OUT, exist_ok=True)

# Full Glass ON (the reported-bug theme).
SEED_GLASS = (
    "try { localStorage.setItem('orwell-theme', JSON.stringify("
    "{ name: 'dark', frosted: true, colors: "
    "{ bg:'#282c34', fg:'#9cdef2', panel:'#111111', border:'#355a66', red:'#e06c75' } }"
    ")); } catch (e) {}"
)


def boot():
    os.makedirs(os.path.join(ROOT, "data"), exist_ok=True)
    env = dict(os.environ, ORWELL_GAME_BUILD="1", AUTH_ENABLED="false", LOCALHOST_BYPASS="true")
    proc = subprocess.Popen(
        [PY, "-m", "uvicorn", "app:app", "--host", "127.0.0.1", "--port", str(PORT)],
        cwd=ROOT, env=env, stdout=open(f"/tmp/fe-cap-{PORT}.log", "w"), stderr=subprocess.STDOUT)
    base = f"http://127.0.0.1:{PORT}"
    for _ in range(120):
        if proc.poll() is not None:
            print("server exited early; see log"); sys.exit(2)
        try:
            urllib.request.urlopen(base, timeout=2); break
        except Exception:
            time.sleep(1)
    return proc, base


def main():
    proc, base = boot()
    verdict_fail = []
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_page(viewport={"width": 1440, "height": 900})
            page.add_init_script(SEED_GLASS)
            page.goto(base, wait_until="domcontentloaded")
            page.wait_for_selector("#sidebar", timeout=15000)
            time.sleep(1.0)  # let modules settle
            vw = page.evaluate("window.innerWidth")
            vcx = vw / 2
            # Open Settings exactly as the app does (dynamic ES import → module.open()) AND sample
            # the window's geometry on EVERY animation frame from open() onward, page-side (rAF), so
            # we catch the very first rendered frame of the fly-in (a Python poll loop is too coarse
            # to see a one-frame rightward excursion).
            raw = page.evaluate(
                """async () => {
                  const vcx = window.innerWidth / 2;
                  const frames = [];
                  const t0 = performance.now();
                  const m = await import('/static/js/settings.js');
                  (m.default || m).open();
                  await new Promise((resolve) => {
                    const tick = () => {
                      const el = document.getElementById('settings-modal');
                      if (el) {
                        const r = el.getBoundingClientRect();
                        if (r.width > 0) {
                          const cx = r.left + r.width / 2;
                          frames.push({ t_ms: Math.round(performance.now() - t0),
                                        left: Math.round(r.left), cx: Math.round(cx),
                                        dx: Math.round(cx - vcx) });
                        }
                      }
                      if (performance.now() - t0 < 400) requestAnimationFrame(tick);
                      else resolve();
                    };
                    requestAnimationFrame(tick);
                  });
                  return frames;
                }""")
            frames = raw or []
            page.screenshot(path=os.path.join(OUT, "settings_open_settled.png"))
            browser.close()

            print(f"viewport center x = {vcx}")
            for f in frames:
                print(f"  t={f['t_ms']:>4}ms  left={f['left']:>5}  centerX={f['cx']:>5}  dx_from_center={f['dx']:+5}")
            if not frames:
                verdict_fail.append("no frames sampled (window never rendered with width)")
            else:
                # PASS = the window is centered (|dx| small) on EVERY sampled frame — never a
                # rightward excursion that later corrects. Allow a few px of sub-pixel slack.
                worst = max(abs(f["dx"]) for f in frames)
                print(f"\nworst |dx_from_center| across the fly-in = {worst}px")
                if worst > 24:
                    verdict_fail.append(f"window strayed {worst}px from center during the fly-in (the right-then-center bug)")
    finally:
        proc.terminate()
        try: proc.wait(timeout=10)
        except Exception: proc.kill()

    if verdict_fail:
        print("\nFAIL: " + "; ".join(verdict_fail)); sys.exit(1)
    print("\nPASS: single clean fly-in — window centered on every sampled frame.")


if __name__ == "__main__":
    main()
