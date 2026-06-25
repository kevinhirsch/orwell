#!/usr/bin/env python3
"""#757 Liquid-glass craft touches — render verification harness (DOC-ONLY, not a CI gate).

Loads the real FE static stylesheet + the real liquidGlass.js module in headless
Chromium over a realistic rich backdrop, mounts the two key surfaces the craft touches
target (a focused .ow-window and a focused .chat-input-bar composer under body.glass-full),
and captures the states the issue asks to see:

  #21 POINTER-REACTIVE SPECULAR
    • the moving rim-light tracking the pointer on the composer (two pointer positions)
    • exactly ONE surface lit at a time (focus moves off composer → its rim clears)
    • prefers-reduced-motion → a STATIC top rim (data-ow-spec="static", no chase)
  #26 CHROMATIC-FRINGE EDGE
    • the 1px high-chroma OKLCH fringe on the focused window + composer
    • dropped/neutralized under prefers-reduced-transparency

Writes PNGs to /tmp/craft-shots/ and prints PASS/FAIL lines + computed-style probes that
prove the rim/fringe are live. Run from frontend/:
  /home/user/orwell/frontend/.venv/bin/python scripts/craft_render_check.py

Roles only, no names, no engine/network — a self-contained DOM harness loading the real
style.css + liquidGlass.js. The live behavior (rim follows the pointer; one at a time) is
what the captured frames prove.
"""
from __future__ import annotations

import base64
import os
import sys

from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATIC = os.path.join(ROOT, "static")
OUT = "/tmp/craft-shots"
os.makedirs(OUT, exist_ok=True)

_fails: list[str] = []


def check(cond, label):
    print(("  ok  — " if cond else "  FAIL — ") + label)
    if not cond:
        _fails.append(label)


def _data_uri(path):
    with open(path, "rb") as f:
        return "data:image/png;base64," + base64.b64encode(f.read()).decode("ascii")


# A realistic rich backdrop: the Apple authentic dark glass-over-dark starfield ref.
BACKDROP = _data_uri(
    os.path.join(
        ROOT, "..", "docs", "design", "liquid-glass", "images",
        "lg_hig_ios_glass_over_dark.png",
    )
)

CSS = open(os.path.join(STATIC, "style.css"), encoding="utf-8").read()
JS = open(os.path.join(STATIC, "js", "liquidGlass.js"), encoding="utf-8").read()

PAGE = """<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box}
html,body{margin:0;height:100%%}
body{
  background:#0b0b0f url('%(backdrop)s') center/cover no-repeat;
  font-family:-apple-system,'SF Pro Text',system-ui,sans-serif;color:#fff;
}
/* geometry forced with !important so the real style.css rules (which set
   .chat-input-bar to position:relative etc.) cannot clobber the harness layout. */
#harness-window{
  position:fixed !important;left:120px !important;top:90px !important;
  width:520px !important;height:300px !important;border-radius:22px;
  background:rgba(28,28,32,0.42);backdrop-filter:blur(18px) saturate(170%%);
  -webkit-backdrop-filter:blur(18px) saturate(170%%);
  box-shadow:0 24px 60px rgba(0,0,0,.5);overflow:hidden;
}
#harness-window .ow-body{padding:18px 20px;font-size:14px;line-height:1.5;color:#e8e8ee}
#harness-composer{
  position:fixed !important;left:80px !important;top:424px !important;
  width:640px !important;height:60px !important;
  border-radius:30px;background:rgba(28,28,32,0.42);
  backdrop-filter:blur(18px) saturate(170%%);-webkit-backdrop-filter:blur(18px) saturate(170%%);
  box-shadow:0 14px 40px rgba(0,0,0,.45);display:flex;align-items:center;padding:0 22px;
}
#harness-composer .ph{color:#cfcfd6;font-size:15px}
#harness-composer input{position:absolute;inset:0;opacity:0;border:0}
%(css)s
</style></head><body class="theme-frosted glass-full">
<div id="harness-window" class="ow-window ow-focused"><div class="ow-body">
  Focused window — the chromatic-fringe edge rides the very rim, and (when focused
  + pointer over it) the pointer-reactive specular tracks the cursor.
</div></div>
<div id="harness-composer" class="chat-input-bar"><span class="ph">Message the house…</span>
  <input aria-label="composer"></div>
<script>%(js)s</script>
</body></html>""" % {"backdrop": BACKDROP, "css": CSS, "js": JS}


def computed(page, sel, pseudo, prop):
    return page.evaluate(
        "([s,p,k])=>{const e=document.querySelector(s);if(!e)return null;"
        "return getComputedStyle(e,p).getPropertyValue(k);}",
        [sel, pseudo, prop],
    )


def spec_surface(page):
    return page.evaluate(
        "() => { const f = window.OrwellLiquidGlass && window.OrwellLiquidGlass._specSurface; "
        "const s = f && f(); return s ? (s.className || s.tagName) : null; }"
    )


def run():
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=["--force-color-profile=srgb"])

        # ── default (motion + transparency ON) ──
        ctx = browser.new_context(viewport={"width": 800, "height": 520},
                                  device_scale_factor=2)
        page = ctx.new_page()
        page.set_content(PAGE, wait_until="load")
        page.wait_for_timeout(400)

        sup = page.evaluate(
            "() => !!(window.OrwellLiquidGlass && window.OrwellLiquidGlass.supported)")
        check(sup, "liquidGlass reports supported (Chromium SVG-refraction tier active)")

        page.eval_on_selector(".chat-input-bar input", "el=>el.focus()")
        page.wait_for_timeout(150)
        s1 = spec_surface(page)
        check(s1 and "chat-input-bar" in s1,
              f"composer focus → composer owns the rim (specSurface={s1})")

        page.mouse.move(220, 484)
        page.wait_for_timeout(120)
        xa = page.evaluate("() => getComputedStyle(document.querySelector('.chat-input-bar'))"
                           ".getPropertyValue('--ow-spec-x')")
        page.screenshot(path=f"{OUT}/21_specular_pointer_left.png")
        page.mouse.move(580, 484)
        page.wait_for_timeout(120)
        xb = page.evaluate("() => getComputedStyle(document.querySelector('.chat-input-bar'))"
                           ".getPropertyValue('--ow-spec-x')")
        page.screenshot(path=f"{OUT}/21_specular_pointer_right.png")
        check(xa and xb and xa.strip() != xb.strip(),
              f"specular center tracks the pointer (--ow-spec-x A={xa!r} → B={xb!r})")

        after_bg = computed(page, ".chat-input-bar", "::after", "background-image")
        check(after_bg and "radial-gradient" in after_bg,
              "composer ::after renders a radial specular gradient")

        fringe_bg = computed(page, ".ow-window.ow-focused", "::before", "background-image")
        check(fringe_bg and "gradient" in fringe_bg,
              "focused window ::before renders the chromatic-fringe gradient")
        page.screenshot(path=f"{OUT}/26_fringe_window_composer.png")

        # ONE at a time: move focus off the composer → its rim must clear
        page.eval_on_selector(".chat-input-bar input", "el=>el.blur()")
        page.wait_for_timeout(200)
        s2 = spec_surface(page)
        check(s2 is None or "chat-input-bar" not in s2,
              f"focus off composer → composer no longer the rim surface (now={s2})")
        ctx.close()

        # ── reduced motion → STATIC rim (no pointer chase) ──
        ctx2 = browser.new_context(viewport={"width": 800, "height": 520},
                                   device_scale_factor=2, reduced_motion="reduce")
        p2 = ctx2.new_page()
        p2.set_content(PAGE, wait_until="load")
        p2.wait_for_timeout(400)
        p2.eval_on_selector(".chat-input-bar input", "el=>el.focus()")
        p2.wait_for_timeout(150)
        mode = p2.evaluate(
            "() => document.querySelector('.chat-input-bar').getAttribute('data-ow-spec')")
        check(mode == "static",
              f"reduced-motion → composer rim is STATIC (data-ow-spec={mode!r})")
        p2.mouse.move(580, 484)
        p2.wait_for_timeout(120)
        p2.screenshot(path=f"{OUT}/21_specular_reduced_motion_static.png")
        ctx2.close()

        # ── reduced transparency → specular dropped (Apple drops glass) ──
        ctx3 = browser.new_context(viewport={"width": 800, "height": 520},
                                   device_scale_factor=2)
        p3 = ctx3.new_page()
        try:
            client = ctx3.new_cdp_session(p3)
            client.send("Emulation.setEmulatedMedia", {
                "features": [{"name": "prefers-reduced-transparency", "value": "reduce"}]
            })
        except Exception as e:  # pragma: no cover
            print("  (note) could not emulate reduced-transparency:", e)
        p3.set_content(PAGE, wait_until="load")
        p3.wait_for_timeout(400)
        p3.eval_on_selector(".chat-input-bar input", "el=>el.focus()")
        p3.wait_for_timeout(150)
        # Under reduced-transparency specEligible() is false → the JS never marks a rim
        # surface at all (data-ow-spec absent), so the ::after never even applies. That
        # is the stronger suppression (no rim surface, not just a CSS display:none).
        rt_attr = p3.evaluate(
            "() => document.querySelector('.chat-input-bar').getAttribute('data-ow-spec')")
        spec_rt = spec_surface(p3)
        check(rt_attr is None and spec_rt is None,
              f"reduced-transparency → no specular rim surface "
              f"(data-ow-spec={rt_attr!r}, specSurface={spec_rt!r})")
        p3.screenshot(path=f"{OUT}/21_26_reduced_transparency.png")
        ctx3.close()

        browser.close()

    print()
    if _fails:
        print(f"RESULT: {len(_fails)} FAIL(S): " + "; ".join(_fails))
        sys.exit(1)
    print("RESULT: all craft render checks PASS. Shots in " + OUT)


if __name__ == "__main__":
    run()
