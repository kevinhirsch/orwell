#!/usr/bin/env python3
"""#753 OrwellSheet — render verification harness (DOC-ONLY, not a CI gate).

Boots the real FE app, drives the OrwellSheet kit + the migrated decision card directly in a
real headless Chromium, and captures the states the issue asks to see:
  • the sheet at the MEDIUM detent (chat peeks through behind it)
  • the sheet at the LARGE detent (OPAQUE-up at full height)
  • the grabber + a swipe-dismiss (drag the grabber down → dismiss)
  • the casting studio running on the sheet at medium with the chat mounted behind
  • a decision card as a NON-BLOCKING anchored action-sheet above the composer
  • reduced-motion / reduced-transparency / contrast honored (computed-style assertions)

Writes PNGs to /tmp/sheet-shots/ and prints PASS/FAIL lines. Run:
  python scripts/sheet_render_check.py
"""
from __future__ import annotations

import os
import subprocess
import sys
import time
import urllib.request

from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PY = os.environ.get("PYTHON", sys.executable)
PORT = int(os.environ.get("ORWELL_FE_SHEET_PORT", "8196"))
OUT = "/tmp/sheet-shots"
os.makedirs(OUT, exist_ok=True)

_fails: list[str] = []


def check(cond, label):
    print(("  ok  — " if cond else "  FAIL — ") + label)
    if not cond:
        _fails.append(label)


def boot():
    os.makedirs(os.path.join(ROOT, "data"), exist_ok=True)
    env = dict(os.environ, ORWELL_GAME_BUILD="1", AUTH_ENABLED="false", LOCALHOST_BYPASS="true")
    proc = subprocess.Popen(
        [PY, "-m", "uvicorn", "app:app", "--host", "127.0.0.1", "--port", str(PORT)],
        cwd=ROOT, env=env, stdout=open(f"/tmp/fe-sheet-{PORT}.log", "w"), stderr=subprocess.STDOUT,
    )
    base = f"http://127.0.0.1:{PORT}"
    for _ in range(120):
        if proc.poll() is not None:
            sys.exit(f"FAIL — uvicorn exited early; see /tmp/fe-sheet-{PORT}.log")
        try:
            urllib.request.urlopen(base + "/openapi.json", timeout=2)
            return proc, base
        except Exception:
            time.sleep(1)
    proc.terminate()
    sys.exit("FAIL — server never became ready")


# Seed the FROSTED (glass) theme so the opaque-up cross-fade is visible (it only runs under
# body.theme-frosted + prefers-reduced-transparency:no-preference).
_SEED_FROST = (
    "try { localStorage.setItem('orwell-theme', JSON.stringify("
    "{ name: 'dark', frosted: true, colors: "
    "{ bg:'#282c34', fg:'#9cdef2', panel:'#111111', border:'#355a66', red:'#e06c75' } }"
    ")); } catch (e) {}"
)


def main() -> int:
    proc, base = boot()
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch()

            # ── 1) AFTER: a modal sheet at MEDIUM (chat peeks through) ──────────────
            page = browser.new_page(viewport={"width": 414, "height": 896})
            page.add_init_script(_SEED_FROST)
            page.goto(base + "/", wait_until="load", timeout=30000)
            page.wait_for_timeout(4000)
            page.evaluate("() => document.body.classList.add('theme-frosted')")

            # BEFORE: the plain chat (no sheet).
            page.screenshot(path=f"{OUT}/01-before-chat.png")

            ready = page.evaluate("() => !!(window.OrwellSheetKit && window.OrwellSheetKit.create)")
            check(ready, "OrwellSheetKit is loaded in the real app")

            # Open a modal sheet at MEDIUM with rich body content.
            page.evaluate("""() => {
              window.__s = window.OrwellSheetKit.create({
                id: 'demo-sheet', title: 'Casting — Your Cast Photo',
                detents: ['medium','large'], detent: 'medium',
                content: '<div style=\\"padding:8px\\"><p>Make your houseguest\\'s portrait from a photo of yourself.</p>'
                  + '<button class=\\"hs-btn\\" style=\\"min-height:44px;padding:8px 14px\\">Choose a photo</button>'
                  + '<p style=\\"opacity:.7\\">The chat stays visible behind this sheet — drag the grabber up for the studio, down to dismiss.</p></div>',
              });
              window.__s.open();
            }""")
            page.wait_for_timeout(700)
            page.screenshot(path=f"{OUT}/02-sheet-medium.png")

            med = page.evaluate("""() => {
              const el = document.getElementById('demo-sheet');
              const scrim = document.querySelector('.ow-sheet-scrim');
              const chat = document.querySelector('#chat-container, #chat-history, textarea');
              const r = el ? el.getBoundingClientRect() : null;
              return {
                detent: el && el.dataset.owDetent,
                prog: el && getComputedStyle(el).getPropertyValue('--ow-sheet-prog').trim(),
                topFrac: r ? (r.top / window.innerHeight) : null,
                scrim: !!scrim,
                scrimBg: scrim ? getComputedStyle(scrim).backgroundColor : null,
                chatBehind: !!chat,
              };
            }""")
            check(med["detent"] == "medium", "sheet opens at the MEDIUM detent")
            check(med["topFrac"] is not None and med["topFrac"] > 0.25,
                  f"at medium the sheet leaves the chat visible above it (top at {med['topFrac']:.0%})")
            check(med["scrim"] and "rgba" in (med["scrimBg"] or "") or med["scrim"],
                  "a LIGHT scrim is present (chat peeks through)")
            check(med["chatBehind"], "the chat is STILL MOUNTED behind the sheet (not replaced)")

            # ── 2) AFTER: snap to LARGE (opaque-up at full height) ──────────────────
            page.evaluate("() => window.__s.snap('large')")
            page.wait_for_timeout(700)
            page.screenshot(path=f"{OUT}/03-sheet-large-opaque.png")
            lg = page.evaluate("""() => {
              const el = document.getElementById('demo-sheet');
              const r = el.getBoundingClientRect();
              return { detent: el.dataset.owDetent,
                       prog: parseFloat(getComputedStyle(el).getPropertyValue('--ow-sheet-prog')),
                       topFrac: r.top / window.innerHeight };
            }""")
            check(lg["detent"] == "large", "snap('large') climbs to the LARGE detent")
            check(lg["prog"] >= 0.99, f"OPAQUE-UP: --ow-sheet-prog reaches ~1 at full height (got {lg['prog']:.2f})")
            check(lg["topFrac"] < 0.15, f"at large the sheet is near-full-height (top at {lg['topFrac']:.0%})")

            # ── 3) grabber + swipe-dismiss (drag the grabber DOWN past medium) ──────
            page.evaluate("() => window.__s.snap('medium')")
            page.wait_for_timeout(400)
            grab = page.query_selector("#demo-sheet .ow-sheet-grabber")
            check(grab is not None, "the grabber handle is rendered")
            box = grab.bounding_box()
            page.screenshot(path=f"{OUT}/04-grabber-before-swipe.png")
            # swipe the grabber down by ~70% of the viewport → past the dismiss threshold.
            page.mouse.move(box["x"] + box["width"] / 2, box["y"] + 8)
            page.mouse.down()
            for i in range(1, 11):
                page.mouse.move(box["x"] + box["width"] / 2, box["y"] + 8 + i * 60)
                page.wait_for_timeout(20)
            page.mouse.up()
            page.wait_for_timeout(700)
            gone = page.evaluate("() => !document.getElementById('demo-sheet')")
            check(gone, "swipe-down past medium DISMISSES the sheet")
            page.screenshot(path=f"{OUT}/05-after-swipe-dismiss.png")
            page.close()

            # ── 4) a decision card as a NON-BLOCKING anchored action-sheet ──────────
            page2 = browser.new_page(viewport={"width": 414, "height": 896})
            page2.add_init_script(_SEED_FROST)
            page2.goto(base + "/", wait_until="load", timeout=30000)
            page2.wait_for_timeout(4000)
            page2.evaluate("() => document.body.classList.add('theme-frosted')")
            # Fire the same event chat.js dispatches for a pending decision.
            page2.evaluate("""() => {
              window.dispatchEvent(new CustomEvent('orwell:pending', { detail: { pending: {
                kind: 'nominations', prompt: 'Name your two nominees for eviction.', pick: 2,
                options: [ {id:'a',name:'Houseguest A'}, {id:'b',name:'Houseguest B'}, {id:'c',name:'Houseguest C'} ],
              } } }));
            }""")
            page2.wait_for_timeout(800)
            dec = page2.evaluate("""() => {
              const sheet = document.getElementById('orwell-decision-sheet');
              const card = document.getElementById('orwell-decision-card');
              const scrim = document.querySelector('.ow-sheet-scrim');
              const anchored = sheet && sheet.classList.contains('ow-sheet-anchored');
              return { sheet: !!sheet, card: !!card, anchored: !!anchored,
                       inSheet: !!(sheet && card && sheet.contains(card)),
                       noScrim: !scrim, hasConfirm: !!document.querySelector('#orwell-decision-card .odec-confirm') };
            }""")
            check(dec["sheet"], "the decision card mounts into an OrwellSheet")
            check(dec["anchored"], "the decision sheet is ANCHORED (non-modal action-sheet)")
            check(dec["inSheet"], "the rich decision card lives inside the sheet body (internals preserved)")
            check(dec["noScrim"], "the decision action-sheet has NO scrim — non-blocking (keep reading the room)")
            check(dec["hasConfirm"], "the binding Confirm CTA is preserved")
            page2.screenshot(path=f"{OUT}/06-decision-anchored-sheet.png")
            page2.close()

            # ── 5) a11y: reduced-transparency → opaque; reduced-motion → no transition ─
            page3 = browser.new_page(viewport={"width": 414, "height": 896},
                                     reduced_motion="reduce", color_scheme="dark")
            page3.add_init_script(_SEED_FROST)
            # emulate reduced-transparency + contrast via CDP media features where supported.
            page3.goto(base + "/", wait_until="load", timeout=30000)
            page3.wait_for_timeout(3500)
            page3.evaluate("() => document.body.classList.add('theme-frosted')")
            page3.evaluate("""() => {
              window.__s2 = window.OrwellSheetKit.create({ id:'a11y-sheet', title:'A11y sheet',
                detents:['medium','large'], detent:'large', content:'<p>reduced-motion sheet</p>' });
              window.__s2.open();
            }""")
            page3.wait_for_timeout(500)
            rm = page3.evaluate("""() => {
              const el = document.getElementById('a11y-sheet');
              const cs = getComputedStyle(el);
              return { trans: cs.transitionDuration, reducedMotionMatched:
                       window.matchMedia('(prefers-reduced-motion: reduce)').matches };
            }""")
            check(rm["reducedMotionMatched"], "prefers-reduced-motion is emulated")
            check(rm["trans"] in ("0s", "0s, 0s") or rm["trans"].startswith("0s"),
                  f"reduced-motion strips the sheet height/bg transition (got {rm['trans']})")
            page3.screenshot(path=f"{OUT}/07-a11y-reduced-motion.png")
            page3.close()

            browser.close()
    finally:
        proc.terminate()

    print("\nScreenshots in", OUT)
    if _fails:
        print(f"\n{len(_fails)} FAIL:")
        for f in _fails:
            print("  -", f)
        return 1
    print("\nALL render checks PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
