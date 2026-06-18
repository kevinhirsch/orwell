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

            # Final FE batch: V3 phase labels + A3 delta announcer live in the status HUD.
            hud_a11y = page.evaluate("""() => {
              if (window._orwellStatusEnsure) window._orwellStatusEnsure();
              const el = document.getElementById('orwell-status');
              if (!el) return { ok: false };
              const a = el.querySelector('#os-announce');
              return { announcer: !!a, polite: a && a.getAttribute('aria-live') === 'polite',
                       hiddenVisually: a && a.offsetWidth <= 1 };
            }""")
            check(hud_a11y.get("announcer") is True and hud_a11y.get("polite") is True,
                  f"status HUD has a polite delta announcer ({hud_a11y})")
            check(page.evaluate("document.getElementById('chat-history').getAttribute('aria-live')") == "polite",
                  "chat log is a polite live region (aria-busy gates it during streams)")

            # C27: the game build ships no third-party CDN deps (KaTeX/Mermaid — no math or
            # diagrams in BB) and no workspace tour. Asserted on the SERVED page.
            served = page.content()
            check("cdn.jsdelivr.net" not in served, "game build: no jsdelivr CDN dependency")
            check("tourHints.js" not in served and "tourAutoplay.js" not in served,
                  "game build: workspace tour not shipped")

            # C23/C15: the game build marks the body, and the engine-down landing is a DARK
            # HOUSE holding card (game-framed), never the silent generic-workspace welcome.
            # (The smoke runs with the engine down, so this is the real F5 path.)
            gb_flag = page.evaluate("document.body.hasAttribute('data-game-build')")
            check(gb_flag is True, "game build marks <body data-game-build>")
            page.wait_for_timeout(1500)  # onboarding's route() resolves its probes
            holding = page.evaluate("""() => {
              const el = document.getElementById('orwell-onboarding');
              if (!el) return { mounted: false };
              return { mounted: true, dark: (el.textContent || '').includes('The house is dark') };
            }""")
            check(holding.get("mounted") is True, f"engine-down: holding card mounts ({holding})")
            check(holding.get("dark") is True, "engine-down: it's the dark-house card, not the form")
            tip_ok = page.evaluate("""() => {
              const t = (document.getElementById('welcome-tip') || {}).textContent || '';
              return !/compare mode|web search and code/i.test(t);
            }""")
            check(tip_ok is True, "welcome tip never names a dropped vertical")
            # No-trap invariant: a blocking holding card must be escapable by a REAL user
            # action (this smoke once force-removed it via JS to proceed — the same deadlock
            # a real operator hit on a fresh install). Dismiss it like a person would.
            has_out = page.evaluate(
                "!!document.querySelector('#orwell-onboarding [data-ob-dismiss]')")
            check(has_out is True, "holding card carries an explicit way out (dismiss button)")
            page.keyboard.press("Escape")
            page.wait_for_timeout(200)
            escaped = page.evaluate("""() => ({
              gone: !document.getElementById('orwell-onboarding'),
              inertLeft: document.querySelectorAll('[inert]').length
            })""")
            check(escaped.get("gone") is True, "Escape dismisses the holding card")
            check(escaped.get("inertLeft") == 0, "dismissal un-inerts the page behind it")

            # 0050: character creation lives in the CHAT — onboarding never mounts a
            # data-entry form (the holding card is the only modal, and it has no inputs).
            page.evaluate("window._orwellOnboardingMount && window._orwellOnboardingMount()")
            page.wait_for_selector("#orwell-onboarding", timeout=3000)
            no_form = page.evaluate("""() => {
              const el = document.getElementById('orwell-onboarding');
              return el.querySelectorAll('input, select, textarea, form').length === 0;
            }""")
            check(no_form is True, "onboarding mounts NO data-entry form (the interview owns intake)")
            # Dismiss via the card's own button (the second real way out, alongside Escape).
            page.click("#orwell-onboarding [data-ob-dismiss]")
            page.wait_for_timeout(200)
            btn_out = page.evaluate("""() => ({
              gone: !document.getElementById('orwell-onboarding'),
              inertLeft: document.querySelectorAll('[inert]').length
            })""")
            check(btn_out.get("gone") is True, "dismiss button removes the holding card")
            check(btn_out.get("inertLeft") == 0, "no inert residue after button dismissal")

            # C31/S5: the System Danger Zone only offers wipes for data the game build has.
            wipes = page.evaluate("""() => {
              const vis = (k) => {
                const b = document.querySelector(`button[data-wipe-kind="${k}"]`);
                if (!b || !b.parentElement) return null;
                return getComputedStyle(b.parentElement).display !== 'none';
              };
              return { chats: vis('chats'), memory: vis('memory'), notes: vis('notes'), gallery: vis('gallery') };
            }""")
            check(wipes.get("chats") is True, f"system wipe: chats (live data) stays ({wipes})")
            check(wipes.get("memory") is False and wipes.get("notes") is False and wipes.get("gallery") is False,
                  f"system wipe: dropped verticals hidden under the game build ({wipes})")

            # C20: the confirm-on-binding decision guardrail. Dispatch a synthetic pending
            # (exactly what chat.js emits from an advanceGame result) and assert the card
            # renders the engine's prompt + legal options, enforces the pick count, and only
            # arms Confirm at exactly N selected. No engine needed — pure module behavior.
            page.evaluate("""
              window.dispatchEvent(new CustomEvent('orwell:pending', { detail: { pending: {
                kind: 'nominations', pick: 2,
                prompt: 'Name two houseguests for eviction.',
                options: [ {id:'npc:1',name:'A'}, {id:'npc:2',name:'B'}, {id:'npc:3',name:'C'} ],
              }}}));
            """)
            page.wait_for_selector("#orwell-decision-card", timeout=3000)
            opts = page.query_selector_all("#orwell-decision-card .odec-opt")
            check(len(opts) == 3, f"decision card renders the engine's legal options ({len(opts)})")
            confirm_disabled = page.evaluate("document.querySelector('#orwell-decision-card .odec-confirm').disabled")
            check(confirm_disabled is True, "decision card: Confirm disarmed until the pick count is met")
            opts[0].click()
            confirm_disabled = page.evaluate("document.querySelector('#orwell-decision-card .odec-confirm').disabled")
            check(confirm_disabled is True, "decision card: 1 of 2 selected still disarmed")
            opts[1].click()
            confirm_disabled = page.evaluate("document.querySelector('#orwell-decision-card .odec-confirm').disabled")
            check(confirm_disabled is False, "decision card: exactly 2 selected arms Confirm")
            opts[2].click()  # pick-count cap: a third selection is refused
            n_sel = page.evaluate('document.querySelectorAll(`#orwell-decision-card .odec-opt[aria-pressed="true"]`).length')
            check(n_sel == 2, "decision card: pick count capped at 2")
            page.evaluate("document.querySelector('#orwell-decision-card .odec-x').click()")
            check(page.query_selector("#orwell-decision-card") is None, "decision card: dismissible (prose path stays open)")

            # C25/A11Y-1: the holding card is a REAL modal — focus lands on the card,
            # Tab never escapes it, everything behind the scrim inert.
            page.evaluate("window._orwellOnboardingMount && window._orwellOnboardingMount()")
            page.wait_for_selector("#orwell-onboarding", timeout=3000)
            in_card = page.evaluate(
                "document.getElementById('orwell-onboarding').contains(document.activeElement)")
            check(in_card is True, "onboarding: initial focus lands in the card")
            for _ in range(12):  # tab hard — focus must stay inside the modal, never escape
                page.keyboard.press("Tab")
            trapped = page.evaluate(
                "document.getElementById('orwell-onboarding').contains(document.activeElement)")
            check(trapped is True, "onboarding: Tab stays INSIDE the card (focus trap)")
            sidebar_inert = page.evaluate("(document.getElementById('sidebar')||{}).inert === true "
                                          "|| document.querySelector('#sidebar') === null "
                                          "|| !!document.querySelector('#sidebar').closest('[inert]')")
            check(sidebar_inert is True, "onboarding: background is inert while mounted")
            page.evaluate("document.getElementById('orwell-onboarding').remove();"
                          "document.querySelectorAll('[inert]').forEach(n => n.inert = false)")

            # C25/E88: the Diary Room is a composer mode in the chat (no dialog) — ruling #4.
            page.evaluate("window._orwellOpenDiaryRoom && window._orwellOpenDiaryRoom()")
            # E88 (ruling #4): no floating dialog — the composer enters DR mode.
            check(page.evaluate("!document.getElementById('orwell-dr-modal')") is True,
                  "diary room: no floating dialog exists")
            check(page.evaluate("window._orwellDiaryRoomActive && window._orwellDiaryRoomActive()") is True,
                  "diary room: composer mode engages via the seam")
            check(page.evaluate("document.body.classList.contains('orwell-dr-mode')") is True,
                  "diary room: the composer carries the mode indicator")
            sb_btn = page.evaluate("(function(){ var b = document.getElementById('sidebar-diary-room-btn'); return !!(b && document.getElementById('sidebar').contains(b)); })()")
            check(sb_btn is True, "diary room: the standing trigger lives in the sidebar")
            dr_focus = page.evaluate("document.activeElement && document.activeElement.id === 'message'")
            check(dr_focus is True, "diary room: focus lands in the composer")
            page.keyboard.press("Escape")
            dr_closed = page.evaluate("!(window._orwellDiaryRoomActive && window._orwellDiaryRoomActive())")
            check(dr_closed is True, "diary room: Escape leaves the composer mode")

            # E90 (ruling #7): the theme trigger is icon-only in the sidebar's
            # bottom cluster, beside the settings gear, with an accessible name.
            tbtn = page.evaluate("""() => {
              const b = document.getElementById('tool-theme-btn');
              if (!b) return { ok: false };
              const bar = document.getElementById('sidebar-user-bar');
              return { ok: true, inCluster: !!(bar && bar.contains(b)),
                       named: !!(b.getAttribute('aria-label') || b.title),
                       textless: (b.textContent || '').trim() === '' };
            }""")
            check(tbtn.get("inCluster") is True, f"theme: trigger docks in the bottom cluster ({tbtn})")
            check(tbtn.get("named") is True, "theme: trigger has an accessible name")
            check(tbtn.get("textless") is True, "theme: trigger renders no text node")

            # H3: the theme picker's ONE home is the standing sidebar entry
            # (#tool-theme-btn — proven docked in the bottom cluster above). The old
            # Settings → Appearance Theme card is gone, so drive the picker the way a
            # player does: a real (trusted) click on the sidebar entry, then assert it
            # opens a populated theme grid. Also pin that the dropped appearance
            # launcher never comes back.
            check(page.evaluate("!document.getElementById('appearance-theme-btn')") is True,
                  "H3: appearance panel ships no theme launcher (the sidebar owns the picker)")
            page.click("#tool-theme-btn")
            page.wait_for_timeout(250)
            theme = page.evaluate(
                """() => {
                  const m = document.getElementById('theme-modal');
                  const grid = document.getElementById('themeGrid');
                  return { opened: m ? !m.classList.contains('hidden') : false,
                           themes: grid ? grid.children.length : 0 };
                }"""
            )
            check(bool(theme.get("opened")) and theme.get("themes", 0) > 0,
                  f"sidebar theme entry opens a populated theme grid ({theme})")

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

            # T20: a game panel's minimize-to-dock BEHAVIOR — carried by the FINALE now
            # (the remaining kit game panel; H5 folded social into the sidebar). Mount the
            # panel, click its minimize control, and assert the panel hides AND a dock chip
            # for it appears in the shared "Windows" dock; then restore via the chip and
            # assert the panel returns. A regression that drops the dock wiring (reverting
            # to an in-place collapse, or losing the chip) fails here, not at a source grep.
            page.evaluate("window._orwellFinaleEnsure && window._orwellFinaleEnsure()")
            page.wait_for_selector("#orwell-finale", timeout=3000)
            check(page.evaluate("getComputedStyle(document.getElementById('orwell-finale')).display !== 'none'") is True,
                  "finale panel: mounts visible")
            page.wait_for_timeout(280)  # let the kit's open animation settle before measuring
            fin_cluster = page.evaluate("""[...document.querySelectorAll('#orwell-finale .ow-controls button')].map(b => {
              const r = b.getBoundingClientRect();
              return { label: b.getAttribute('aria-label'), w: Math.round(r.width), h: Math.round(r.height) };
            })""")
            check(len(fin_cluster) >= 1 and all(c["label"] and c["w"] >= 24 and c["h"] >= 24 for c in fin_cluster),
                  f"finale composes the kit cluster (named, >=24px) ({fin_cluster})")
            # F1 (DWE audit): these are TRUSTED clicks on purpose — the old evaluate()
            # clicks worked on an invisible dock and masked the stranded-window trap.
            page.click("#orwell-finale .ow-min")
            page.wait_for_timeout(500)  # the ruling-#19 fly-out runs ~270ms before the dock renders
            min_state = page.evaluate("""() => {
              const el = document.getElementById('orwell-finale');
              const dock = document.getElementById('minimized-dock');
              const chip = document.querySelector('#minimized-dock .minimized-dock-chip[data-modal-id="orwell-finale"]');
              const dr = dock ? dock.getBoundingClientRect() : null;
              return { hidden: !el || getComputedStyle(el).display === 'none', chip: !!chip,
                       dockVisible: !!dock && getComputedStyle(dock).display !== 'none' && dr.height > 0 };
            }""")
            check(min_state.get("hidden") is True, f"finale panel: minimize HIDES the panel ({min_state})")
            check(min_state.get("chip") is True, f"finale panel: minimize parks a chip in the shared dock ({min_state})")
            check(min_state.get("dockVisible") is True,
                  f"F1: the Windows dock is VISIBLE while holding a chip ({min_state})")
            page.click("#minimized-dock .minimized-dock-chip[data-modal-id='orwell-finale']")
            page.wait_for_timeout(250)
            restored = page.evaluate(
                "(function(){var e=document.getElementById('orwell-finale');return !!e && getComputedStyle(e).display!=='none';})()")
            check(restored is True, "finale panel: restoring from the dock chip re-opens the panel (trusted click)")

            # F2 (DWE audit): drag must MOVE the panel — the slot restack used to revert
            # every windowDrag style write, leaving drag dead and offsets at (0,0).
            hdr = page.query_selector("#orwell-finale .ow-titlebar")
            hb = hdr.bounding_box()
            r0 = page.evaluate("document.getElementById('orwell-finale').getBoundingClientRect().toJSON()")
            page.mouse.move(hb["x"] + hb["width"] / 2, hb["y"] + hb["height"] / 2)
            page.mouse.down()
            for i in range(1, 9):
                page.mouse.move(hb["x"] + hb["width"] / 2 + 150 * i / 8, hb["y"] + hb["height"] / 2 + 120 * i / 8)
            page.mouse.up()
            page.wait_for_timeout(200)
            r1 = page.evaluate("document.getElementById('orwell-finale').getBoundingClientRect().toJSON()")
            moved = abs(r1["x"] - r0["x"]) > 100 or abs(r1["y"] - r0["y"]) > 80
            check(moved is True, f"F2: dragging the title bar MOVES the panel (x {r0['x']:.0f}->{r1['x']:.0f}, y {r0['y']:.0f}->{r1['y']:.0f})")
            off = page.evaluate("""() => {
              const k = Object.keys(localStorage).find(k => k.startsWith('orwell-slot-offset:finale'));
              if (!k) return null;
              try { return JSON.parse(localStorage.getItem(k)); } catch (_) { return null; }
            }""")
            check(bool(off) and (abs(off.get("dx", 0)) > 60 or abs(off.get("dy", 0)) > 40),
                  f"F2: the persisted slot offset is the real drag delta, not (0,0) ({off})")
            page.evaluate("window.OrwellSlots && window.OrwellSlots.restackAll()")  # provoke a restack
            page.wait_for_timeout(250)
            r2 = page.evaluate("document.getElementById('orwell-finale').getBoundingClientRect().toJSON()")
            check(abs(r2["x"] - r1["x"]) < 20 and abs(r2["y"] - r1["y"]) < 20,
                  f"F2: the dragged position survives an unrelated restack ({r1['x']:.0f},{r1['y']:.0f} -> {r2['x']:.0f},{r2['y']:.0f})")

            # The window KIT (Lane F / F-1): one class + one .ow-* family. Exercise a real
            # kit window end-to-end: chrome, trusted drag, Escape-parks, dock restore,
            # close-with-focus-return, clean teardown.
            # Housekeeping: the theme/settings assertions above leave their modals open;
            # a top modal legitimately outranks a kit window on Escape (DWE order), so
            # clear them before testing the kit's own Escape path.
            page.evaluate("""['theme-modal','settings-modal'].forEach(id => {
              const m = document.getElementById(id);
              if (m && !m.classList.contains('hidden')) {
                const b = m.querySelector('.close-btn, .modal-close-btn, [data-action="close"]');
                if (b) b.click(); else m.classList.add('hidden');
              }
            })""")
            page.wait_for_timeout(200)
            kit = page.evaluate("""() => {
              const gear = document.getElementById('user-bar-settings');
              if (gear) gear.focus();
              const w = window.OrwellWindowKit.create({
                id: 'ow-smoke-window', title: 'Production Test', slot: 'top-left', slotKey: 'owsmoke',
                content: '<p>kit smoke</p>', icon: '' });
              w.open(document.activeElement);
              window._owSmoke = w;
              const el = document.getElementById('ow-smoke-window');
              return { mounted: !!el, titlebar: !!el.querySelector('.ow-titlebar'),
                       title: el.querySelector('.ow-title').textContent,
                       focused: el.classList.contains('ow-focused') };
            }""")
            page.wait_for_timeout(280)  # let the open animation settle before measuring geometry
            kit["ctrls"] = page.evaluate("""[...document.querySelectorAll('#ow-smoke-window .ow-controls button')].map(b => {
              const r = b.getBoundingClientRect();
              return { label: b.getAttribute('aria-label'), w: Math.round(r.width), h: Math.round(r.height) };
            })""")
            check(kit.get("mounted") is True and kit.get("titlebar") is True, f"kit: window mounts with titlebar ({kit})")
            check(all(c["w"] >= 24 and c["h"] >= 24 and c["label"] for c in kit.get("ctrls", [])),
                  f"kit: control cluster named + >=24px targets ({kit.get('ctrls')})")
            check(kit.get("focused") is True, "kit: opening focuses (ow-focused on top of the stack)")
            kb = page.query_selector("#ow-smoke-window .ow-titlebar").bounding_box()
            page.mouse.move(kb["x"] + 40, kb["y"] + kb["height"] / 2)
            page.mouse.down()
            for i in range(1, 7):
                page.mouse.move(kb["x"] + 40 + 120 * i / 6, kb["y"] + kb["height"] / 2 + 90 * i / 6)
            page.mouse.up()
            page.wait_for_timeout(150)
            kmoved = page.evaluate("document.getElementById('ow-smoke-window').getBoundingClientRect().toJSON()")
            check(abs(kmoved["x"] - kb["x"]) > 60, f"kit: trusted drag moves the window (x {kb['x']:.0f}->{kmoved['x']:.0f})")
            page.mouse.move(640, 500)  # neutral ground: the arbiter's hovered-window pass must not fire
            page.evaluate("document.body.focus()")
            page.keyboard.press("Escape")
            page.wait_for_timeout(350)
            parked = page.evaluate("""() => ({
              hidden: getComputedStyle(document.getElementById('ow-smoke-window')).display === 'none',
              chip: !!document.querySelector('#minimized-dock .minimized-dock-chip[data-modal-id="ow-smoke-window"]'),
            })""")
            check(parked.get("hidden") is True and parked.get("chip") is True,
                  f"kit: Escape parks the top window to the dock (F7) ({parked})")
            page.click("#minimized-dock .minimized-dock-chip[data-modal-id='ow-smoke-window']")
            page.wait_for_timeout(250)
            check(page.evaluate("getComputedStyle(document.getElementById('ow-smoke-window')).display !== 'none'") is True,
                  "kit: dock chip restores the window (trusted click)")
            page.click("#ow-smoke-window .ow-close")
            page.wait_for_timeout(300)
            closed = page.evaluate("""() => ({
              gone: !document.getElementById('ow-smoke-window'),
              focusBack: document.activeElement && document.activeElement.id === 'user-bar-settings',
            })""")
            check(closed.get("gone") is True, f"kit: close tears the window down ({closed})")
            check(closed.get("focusBack") is True, f"kit: focus returns to the opener (F8) ({closed})")

            # G14 (DWE audit F9b): ONE z-authority for the .modal family —
            # modalManager's _bringToFront defers to ui.js's counter instead of
            # stamping a second 300s ladder with !important. Open theme, park it
            # to the dock, restore from the chip (trusted clicks), THEN open
            # settings fresh: the fresh open must sit visually ABOVE the
            # dock-restored window (elementFromPoint at the content overlap),
            # Escape must close settings first then theme (pickTopModal ==
            # visual order), and no .modal may carry an inline !important z.
            page.click("#tool-theme-btn")
            page.wait_for_timeout(600)  # static node — the `_` was injected at boot
            check(page.evaluate("!document.getElementById('theme-modal').classList.contains('hidden')") is True,
                  "G14: theme opens from the sidebar entry")
            page.click("#theme-modal .modal-minimize-btn, #theme-modal .minimize-btn")
            page.wait_for_timeout(400)
            g14min = page.evaluate("""() => {
              const m = document.getElementById('theme-modal');
              return { parked: m.classList.contains('modal-minimized'),
                       chip: !!document.querySelector('#minimized-dock .minimized-dock-chip[data-modal-id="theme-modal"]'),
                       importantZ: m.style.getPropertyPriority('z-index') === 'important' };
            }""")
            check(g14min.get("parked") is True and g14min.get("chip") is True,
                  f"G14: theme parks to a dock chip ({g14min})")
            check(g14min.get("importantZ") is False,
                  f"G14: a parked window holds NO inline !important z ({g14min})")
            page.click("#minimized-dock .minimized-dock-chip[data-modal-id='theme-modal']")
            page.wait_for_timeout(400)
            check(page.evaluate("getComputedStyle(document.getElementById('theme-modal')).display !== 'none'") is True,
                  "G14: the dock chip restores theme (trusted click)")
            page.click("#user-bar-settings")
            page.wait_for_timeout(500)
            g14 = page.evaluate("""() => {
              const t = document.getElementById('theme-modal');
              const s = document.getElementById('settings-modal');
              const vis = (m) => m && !m.classList.contains('hidden') && getComputedStyle(m).display !== 'none';
              if (!vis(t) || !vis(s)) return { error: 'both must be open', theme: vis(t), settings: vis(s) };
              const r1 = t.querySelector('.modal-content').getBoundingClientRect();
              const r2 = s.querySelector('.modal-content').getBoundingClientRect();
              const L = Math.max(r1.left, r2.left), R = Math.min(r1.right, r2.right);
              const T = Math.max(r1.top, r2.top), B = Math.min(r1.bottom, r2.bottom);
              if (R <= L || B <= T) return { error: 'contents do not overlap' };
              const el = document.elementFromPoint((L + R) / 2, (T + B) / 2);
              const owner = el ? (el.closest('.modal') || {}).id || null : null;
              const importants = [...document.querySelectorAll('.modal')]
                .filter(m => m.style.getPropertyPriority('z-index') === 'important').map(m => m.id);
              return { owner, importants,
                       themeZ: parseInt(getComputedStyle(t).zIndex, 10) || 0,
                       settingsZ: parseInt(getComputedStyle(s).zIndex, 10) || 0 };
            }""")
            check(g14.get("owner") == "settings-modal" and g14.get("settingsZ", 0) > g14.get("themeZ", 0),
                  f"G14: a fresh open sits visually ABOVE the dock-restored window ({g14})")
            check(g14.get("importants") == [], f"G14: no .modal carries an inline !important z-index ({g14})")
            page.mouse.move(640, 700)  # neutral ground: keep the arbiter's hovered-window pass out of it
            page.keyboard.press("Escape")
            page.wait_for_timeout(300)
            g14esc = page.evaluate("""() => ({
              settingsClosed: document.getElementById('settings-modal').classList.contains('hidden'),
              themeOpen: !document.getElementById('theme-modal').classList.contains('hidden'),
            })""")
            check(g14esc.get("settingsClosed") is True and g14esc.get("themeOpen") is True,
                  f"G14: Escape closes the top window (settings) FIRST ({g14esc})")
            page.keyboard.press("Escape")
            page.wait_for_timeout(300)
            check(page.evaluate("document.getElementById('theme-modal').classList.contains('hidden')") is True,
                  "G14: the second Escape closes the dock-restored window (theme)")

            # F8 (wave 3): the WHOLE .modal family returns focus to its opener —
            # focus the gear for real, open settings, Escape, focus is back.
            page.focus("#user-bar-settings")
            page.click("#user-bar-settings")
            page.wait_for_timeout(400)
            check(page.evaluate("__settings_open__ = !document.getElementById('settings-modal').classList.contains('hidden')") is True,
                  "F8: settings opens from the focused gear")
            page.keyboard.press("Escape")
            page.wait_for_timeout(300)
            f8 = page.evaluate("""() => ({
              closed: document.getElementById('settings-modal').classList.contains('hidden'),
              focusBack: document.activeElement && document.activeElement.id === 'user-bar-settings',
            })""")
            check(f8.get("closed") is True, f"F8: Escape closes settings ({f8})")
            check(f8.get("focusBack") is True, f"F8: focus returns to the gear ({f8})")

            # G2 (Lane G): launcher-agnostic restore — a minimized window must
            # come back through the REAL restore path no matter which launcher
            # the user hits. The gear (#user-bar-settings) is NOT the sidebar
            # tool button modalManager's interceptor knew about, so this is the
            # exact reported bug: minimize settings, click the gear, dead air.
            page.click("#user-bar-settings")
            page.wait_for_timeout(300)
            check(page.evaluate("!document.getElementById('settings-modal').classList.contains('hidden')") is True,
                  "G2: settings opens from the gear")
            # The injected `_` (trusted click) — modalManager injects
            # .modal-minimize-btn, or wires the legacy .minimize-btn when
            # app.js's dock got there first; either way it minimizes via
            # modalManager.
            page.click("#settings-modal .modal-minimize-btn, #settings-modal .minimize-btn")
            page.wait_for_timeout(300)
            g2min = page.evaluate("""() => {
              const m = document.getElementById('settings-modal');
              return { minimized: m.classList.contains('modal-minimized'),
                       hidden: getComputedStyle(m).display === 'none',
                       chip: !!document.querySelector('#minimized-dock .minimized-dock-chip[data-modal-id="settings-modal"]') };
            }""")
            check(g2min.get("minimized") is True and g2min.get("hidden") is True and g2min.get("chip") is True,
                  f"G2: the `_` button minimizes settings to a dock chip ({g2min})")
            page.click("#user-bar-settings")  # the launcher itself — trusted click
            page.wait_for_timeout(300)
            g2 = page.evaluate("""() => {
              const m = document.getElementById('settings-modal');
              return { visible: !m.classList.contains('hidden') && getComputedStyle(m).display !== 'none',
                       unminimized: !m.classList.contains('modal-minimized'),
                       chipGone: !document.querySelector('#minimized-dock .minimized-dock-chip[data-modal-id="settings-modal"]') };
            }""")
            check(g2.get("visible") is True and g2.get("unminimized") is True and g2.get("chipGone") is True,
                  f"G2: clicking the gear RESTORES the minimized settings window ({g2})")
            # Interactive: a trusted click INSIDE the restored window lands (no
            # .modal-minimized pointer-events:none residue) — the Account tab
            # takes the click and activates.
            page.click("#settings-modal [data-settings-tab='account']")
            page.wait_for_timeout(150)
            check(page.evaluate("document.querySelector(\"#settings-modal [data-settings-tab='account']\").classList.contains('active')") is True,
                  "G2: the restored settings window is interactive (trusted click inside lands)")
            # Same contract for EVERY window, launcher-agnostic: theme-modal,
            # minimized for real, healed by an arbitrary opener that only
            # removes `.hidden` (exactly what tool-theme-btn / the Settings →
            # Appearance button do) — the observer must run the real restore.
            page.evaluate("document.getElementById('settings-modal').querySelector('.close-btn').click()")
            page.evaluate("document.getElementById('theme-modal').classList.remove('hidden')")
            page.wait_for_timeout(250)
            page.click("#theme-modal .modal-minimize-btn, #theme-modal .minimize-btn")
            page.wait_for_timeout(250)
            check(page.evaluate("document.getElementById('theme-modal').classList.contains('modal-minimized')") is True,
                  "G2: theme window minimizes to the dock")
            page.evaluate("document.getElementById('theme-modal').classList.remove('hidden')")  # any launcher
            page.wait_for_timeout(250)
            g2t = page.evaluate("""() => {
              const m = document.getElementById('theme-modal');
              return { visible: !m.classList.contains('hidden') && getComputedStyle(m).display !== 'none',
                       unminimized: !m.classList.contains('modal-minimized'),
                       chipGone: !document.querySelector('#minimized-dock .minimized-dock-chip[data-modal-id="theme-modal"]') };
            }""")
            check(g2t.get("visible") is True and g2t.get("unminimized") is True and g2t.get("chipGone") is True,
                  f"G2: an arbitrary un-hide heals the minimized theme window too ({g2t})")
            page.evaluate("""() => {
              const tm = document.getElementById('theme-modal');
              const tb = tm.querySelector('.close-btn, .modal-close');
              if (tb) tb.click(); else tm.classList.add('hidden');
            }""")
            page.wait_for_timeout(200)

            # F11 (wave 3): Escape while the decision card holds focus = the x path —
            # dismissed, never submitted.
            page.evaluate("""window.dispatchEvent(new CustomEvent('orwell:pending', { detail: { pending: {
                kind: 'eviction-vote', pick: 1, prompt: 'Cast your vote.',
                options: [ {id:'npc:1',name:'A'}, {id:'npc:2',name:'B'} ] }}}));""")
            page.wait_for_selector("#orwell-decision-card", timeout=3000)
            page.focus("#orwell-decision-card .odec-opt")
            page.keyboard.press("Escape")
            page.wait_for_timeout(150)
            check(page.evaluate("!document.getElementById('orwell-decision-card')") is True,
                  "F11: Escape dismisses the focused decision card (never submits)")

            # G16 (G5 refresh-persistence audit, F1+F2) — driven FOR REAL on an
            # isolated page (its own context/localStorage) with the audit's
            # sanctioned route mocks: a live-game /state + /status + /roster keep
            # the gates and poll loops honest across reloads while the main smoke
            # page stays engine-down. Role-named payloads only (no cast names).
            #   F2 (kit parked-means-parked), on the CAST window: open via the
            #       seam, minimize (trusted click) → RELOAD → re-open via the
            #       seam: it must come back PARKED (hidden + dock chip, no
            #       snap-open) → restore via the chip → RELOAD → re-open: OPEN,
            #       no stale chip.
            #   F1: collapse the status HUD (trusted click) → RELOAD → still
            #       collapsed, restored from the SAME per-user+game key the
            #       header click writes (E71).
            g16 = browser.new_page()
            g16_state = (
                '{"started": true, "week": 1, "phase": "nominations",'
                ' "player": {"id": "player", "name": "The Player", "status": "active"},'
                ' "house": [{"id": "npc:1", "name": "A Houseguest", "status": "active"},'
                ' {"id": "npc:2", "name": "Another Houseguest", "status": "active"}]}'
            )
            g16_status = (
                '{"week": 1, "phase": "nominations",'
                ' "hoh": {"id": "npc:1", "name": "A Houseguest"},'
                ' "nominees": [{"id": "npc:2", "name": "Another Houseguest"}]}'
            )
            g16_roster = (
                '{"imagesAvailable": false, "roster": ['
                '{"id": "player", "name": "The Player", "status": "active", "isPlayer": true},'
                '{"id": "npc:1", "name": "A Houseguest", "status": "active"}]}'
            )

            def _g16_json(body):
                return lambda route: route.fulfill(
                    status=200, content_type="application/json", body=body)

            g16.route("**/api/orwell/state", _g16_json(g16_state))
            g16.route("**/api/orwell/status", _g16_json(g16_status))
            g16.route("**/api/orwell/roster", _g16_json(g16_roster))
            g16.route("**/api/orwell/health", _g16_json('{"engine": true}'))
            g16.route("**/api/orwell/finale", _g16_json('{"finale": null}'))

            def _g16_wait_js(expr, label, tries=75):
                # CSP keeps 'unsafe-eval' off the page, so wait_for_function's
                # string predicate is blocked — poll through evaluate (CDP) instead.
                for _ in range(tries):
                    if g16.evaluate(expr):
                        return True
                    g16.wait_for_timeout(200)
                check(False, label)
                return False

            g16.goto(base + "/", wait_until="load", timeout=30000)
            g16.wait_for_selector("#orwell-status", state="visible", timeout=15000)
            # F1, the act: collapse the HUD via its header (trusted click).
            g16.click("#orwell-status .os-hdr")
            f1_keys = g16.evaluate("""() => {
              const user = (document.body && document.body.dataset.user) || '';
              return {
                collapsed: document.getElementById('orwell-status').classList.contains('os-collapsed'),
                keys: Object.keys(localStorage).filter(k => k.startsWith('orwell-status-collapsed')),
                expected: 'orwell-status-collapsed:The Player:' + user,
              };
            }""")
            check(f1_keys.get("collapsed") is True
                  and f1_keys.get("keys") == [f1_keys.get("expected")],
                  f"G16/F1: the collapse writes under the per-user+game key ({f1_keys})")
            # F2, the act: open the cast window via the seam, then park it (trusted click).
            _g16_wait_js("typeof window._orwellCastEnsure === 'function' && !!window.OrwellWindowKit",
                         "G16: the cast seam + the kit mount")
            g16.evaluate("window._orwellCastEnsure()")
            g16.wait_for_selector("#orwell-cast", state="visible", timeout=15000)
            g16.click("#orwell-cast .ow-min")
            g16.wait_for_selector(  # the ruling-#19 fly-out (~270ms) precedes the chip
                "#minimized-dock .minimized-dock-chip[data-modal-id='orwell-cast']",
                timeout=5000)
            f2_flag = g16.evaluate(
                "localStorage.getItem('orwell-win-parked:orwell-cast:' +"
                " ((document.body && document.body.dataset.user) || ''))")
            check(f2_flag == "1", f"G16/F2: minimize persists the parked flag ({f2_flag!r})")

            # RELOAD #1 — the whole point: both states must survive the refresh.
            g16.reload(wait_until="load", timeout=30000)
            g16.wait_for_selector("#orwell-status", state="visible", timeout=15000)
            f1_after = g16.evaluate("""() => {
              const hud = document.getElementById('orwell-status');
              const hdr = hud && hud.querySelector('.os-hdr');
              return { collapsed: !!hud && hud.classList.contains('os-collapsed'),
                       expanded: hdr ? hdr.getAttribute('aria-expanded') : null };
            }""")
            check(f1_after.get("collapsed") is True and f1_after.get("expanded") == "false",
                  f"G16/F1: after a reload the status HUD is still collapsed ({f1_after})")
            # F2: re-open via the seam — the parked window must mount INTO the dock.
            _g16_wait_js("typeof window._orwellCastEnsure === 'function' && !!window.OrwellWindowKit",
                         "G16: the cast seam + the kit after reload #1")
            g16.evaluate("window._orwellCastEnsure()")
            g16.wait_for_selector(
                "#minimized-dock .minimized-dock-chip[data-modal-id='orwell-cast']",
                timeout=5000)
            after1 = g16.evaluate("""() => {
              const cast = document.getElementById('orwell-cast');
              const dock = document.getElementById('minimized-dock');
              return {
                castHidden: !!cast && getComputedStyle(cast).display === 'none',
                castMinimized: !!cast && cast.classList.contains('modal-minimized'),
                chip: !!document.querySelector('#minimized-dock .minimized-dock-chip[data-modal-id="orwell-cast"]'),
                dockVisible: !!dock && getComputedStyle(dock).display !== 'none'
                  && dock.getBoundingClientRect().height > 0,
              };
            }""")
            check(after1.get("castHidden") is True and after1.get("castMinimized") is True,
                  f"G16/F2: re-opened after a reload, the cast window comes back PARKED ({after1})")
            check(after1.get("chip") is True and after1.get("dockVisible") is True,
                  f"G16/F2: after a reload its dock chip is back too ({after1})")
            # Restore via the chip (trusted click) — visible again, un-parked durably.
            g16.click("#minimized-dock .minimized-dock-chip[data-modal-id='orwell-cast']")
            g16.wait_for_timeout(250)
            restored1 = g16.evaluate("""() => ({
              visible: getComputedStyle(document.getElementById('orwell-cast')).display !== 'none',
              flag: localStorage.getItem('orwell-win-parked:orwell-cast:' +
                ((document.body && document.body.dataset.user) || '')),
            })""")
            check(restored1.get("visible") is True and restored1.get("flag") is None,
                  f"G16/F2: the chip restores a boot-parked window AND clears the flag ({restored1})")

            # RELOAD #2 — restored means restored: the seam must open it VISIBLE now.
            g16.reload(wait_until="load", timeout=30000)
            _g16_wait_js("typeof window._orwellCastEnsure === 'function' && !!window.OrwellWindowKit",
                         "G16: the cast seam + the kit after reload #2")
            g16.evaluate("window._orwellCastEnsure()")
            g16.wait_for_selector("#orwell-cast", state="visible", timeout=15000)
            after2 = g16.evaluate("""() => ({
              visible: getComputedStyle(document.getElementById('orwell-cast')).display !== 'none',
              chipGone: !document.querySelector('#minimized-dock .minimized-dock-chip[data-modal-id="orwell-cast"]'),
            })""")
            check(after2.get("visible") is True and after2.get("chipGone") is True,
                  f"G16/F2: after restore + reload the cast window comes back OPEN, no stale chip ({after2})")
            g16.close()

            # F6 tail (wave 3): the engine-down banner's dismiss is the shared
            # .ow-dismiss affordance (>=24px, kit CSS) — presence/retro are pinned in pytest.
            page.evaluate("window.orwellRefreshEngineStatus && window.orwellRefreshEngineStatus()")
            page.wait_for_timeout(600)
            ban = page.evaluate("""() => {
              const b = document.querySelector('#orwell-engine-status .oes-x');
              if (!b) return { present: false };
              const r = b.getBoundingClientRect();
              return { present: true, owDismiss: b.classList.contains('ow-dismiss'),
                       w: Math.round(r.width), h: Math.round(r.height) };
            }""")
            if ban.get("present"):
                check(ban.get("owDismiss") is True and ban.get("w", 0) >= 24 and ban.get("h", 0) >= 24,
                      f"F6: banner dismiss is the shared ow-dismiss affordance ({ban})")

            # F-3 (the ratchet, runtime half): every window-like surface on the page
            # is KIT-MANAGED — floating game panels carry [data-ow-window], and the
            # bespoke-chrome marker ('Drag to move' titlebars outside the kit) is extinct.
            ratchet = page.evaluate("""() => {
              const panels = ['orwell-finale']
                .map(id => document.getElementById(id)).filter(Boolean);
              const unkitted = panels.filter(el => !el.hasAttribute('data-ow-window')).map(el => el.id);
              const bespoke = [...document.querySelectorAll('[title="Drag to move"]')]
                .filter(el => !el.closest('[data-ow-window]')).length;
              const kitStack = window.OrwellWindowKit ? window.OrwellWindowKit.stackIds() : null;
              return { panels: panels.length, unkitted, bespoke,
                       kitStack: Array.isArray(kitStack) };
            }""")
            check(ratchet.get("unkitted") == [] and ratchet.get("bespoke") == 0,
                  f"F-3: every window-like surface is kit-managed ({ratchet})")
            check(ratchet.get("kitStack") is True, "F-3: the kit seam answers (stackIds)")

            # G3 (sidebar coherence, ruling 2026-06-11): every VISIBLE sidebar button
            # measures the SAME computed padding as the New Chat / Search rows (the
            # .list-item standard), and no collapse chevron renders on a section with
            # <=1 visible child — under the game build the Tools children are all
            # trimmed away, so its chevron was a button that visibly did nothing.
            g3 = page.evaluate("""() => {
              const vis = el => el.getClientRects().length > 0;
              const buttons = [...document.querySelectorAll(
                '#sidebar .list-item, #sidebar .section-header-flex, ' +
                '#sidebar .user-bar-btn, #sidebar .user-bar-left'
              )].filter(vis);
              const pads = [...new Set(buttons.map(el => {
                const s = getComputedStyle(el);
                return [s.paddingTop, s.paddingRight, s.paddingBottom, s.paddingLeft].join(' ');
              }))];
              const deadChevrons = [...document.querySelectorAll('#sidebar .section')]
                .filter(sec => {
                  const kids = [...sec.children].filter(c => !c.classList.contains('section-header-flex'));
                  const shown = kids.filter(k => getComputedStyle(k).display !== 'none' && vis(k));
                  return shown.length <= 1 && [...sec.querySelectorAll('.section-collapse-btn')].some(vis);
                }).map(sec => sec.id || '(anonymous section)');
              return { buttons: buttons.length, pads, deadChevrons };
            }""")
            check(g3.get("buttons", 0) >= 4 and g3.get("pads") == ["8px 8px 8px 8px"],
                  f"G3: every visible sidebar button measures the one 8px padding standard ({g3})")
            check(g3.get("deadChevrons") == [],
                  f"G3: no collapse chevron renders on a <=1-visible-child section ({g3.get('deadChevrons')})")

            # G10: the cast roster composes the kit — open via the seam, prove the
            # chrome, and prove CLOSE actually closes (the bespoke version's close
            # was silently defeated by its own display:flex beating [hidden]).
            page.evaluate("window._orwellCastEnsure && window._orwellCastEnsure()")
            page.wait_for_timeout(400)
            cast = page.evaluate("""() => {
              const el = document.getElementById('orwell-cast');
              if (!el) return { mounted: false };
              return { mounted: true, kit: el.hasAttribute('data-ow-window'),
                       modal: el.getAttribute('aria-modal'),
                       controls: [...el.querySelectorAll('.ow-controls button')].map(b => b.getAttribute('aria-label')) };
            }""")
            check(cast.get("mounted") is True and cast.get("kit") is True,
                  f"G10: the cast window is kit-managed ({cast})")
            check(cast.get("modal") is None and "Close" in (cast.get("controls") or []) and "Minimize" in (cast.get("controls") or []),
                  f"G10: non-modal with the full kit cluster ({cast})")
            page.click("#orwell-cast .ow-close")
            page.wait_for_timeout(350)
            check(page.evaluate("!document.getElementById('orwell-cast')") is True,
                  "G10: close CLOSES (trusted click; the [hidden] defeat is dead)")

            # G15: event-driven freshness — a mutation-path completion must refresh the
            # status HUD NOW (one ~250ms debounce + a beat), never "at the next 20-30s
            # poll". The HUD listener holds a direct reference to its refresh(), so the
            # faithful in-page spy is that refresh's own observable act: the immediate
            # /api/orwell/status fetch (window.orwellRefreshStatus IS the same function —
            # wrapped too, for any caller that goes through the window seam). Exactly two
            # surfaces fetch the status route on the gamechanged wave (the HUD + the
            # decision re-arm, both pinned in pytest), so a >=2 delta inside the short
            # window distinguishes the event wave from a coincidental single poll tick.
            g15_armed = page.evaluate("""() => {
              window._g15 = { events: 0, statusFetches: 0, hudSeamCalls: 0 };
              window.addEventListener('orwell:gamechanged', () => { window._g15.events++; });
              const _fetch = window.fetch;
              window.fetch = function (u) {
                try { if (String(u).indexOf('/api/orwell/status') !== -1) window._g15.statusFetches++; } catch (_) {}
                return _fetch.apply(this, arguments);
              };
              if (typeof window.orwellRefreshStatus === 'function') {
                const _r = window.orwellRefreshStatus;
                window.orwellRefreshStatus = function () { window._g15.hudSeamCalls++; return _r.apply(this, arguments); };
              }
              return typeof window.orwellGameChanged === 'function';
            }""")
            check(g15_armed is True, "G15: the shared dispatcher (window.orwellGameChanged) is mounted")
            g15_direct = page.evaluate("""() => new Promise(res => {
              const ev0 = window._g15.events, f0 = window._g15.statusFetches;
              window.orwellGameChanged('smoke:burst-1');
              window.orwellGameChanged('smoke:burst-2');
              window.orwellGameChanged('smoke:burst-3');
              setTimeout(() => res({ events: window._g15.events - ev0,
                                     statusFetches: window._g15.statusFetches - f0 }), 900);
            })""")
            check(g15_direct.get("events") == 1,
                  f"G15: a burst of helper calls coalesces into ONE gamechanged (debounce) ({g15_direct})")
            check(g15_direct.get("statusFetches", 0) >= 2,
                  f"G15: the status HUD refresh fired event-driven, inside one debounce ({g15_direct})")
            # The decision card's POST path: a routed fake stands in for the engine, the
            # card's success branch must nudge the panels the same way.
            page.route("**/api/orwell/decision",
                       lambda route: route.fulfill(status=200, content_type="application/json",
                                                   body='{"ok": true}'))
            page.evaluate("""window.dispatchEvent(new CustomEvent('orwell:pending', { detail: { pending: {
                kind: 'eviction-vote', pick: 1, prompt: 'G15 smoke: cast your vote.',
                options: [ {id:'npc:1',name:'A'}, {id:'npc:2',name:'B'} ] }}}));""")
            page.wait_for_selector("#orwell-decision-card .odec-opt", timeout=3000)
            g15_decision = page.evaluate("""() => new Promise(res => {
              const ev0 = window._g15.events, f0 = window._g15.statusFetches;
              const card = document.getElementById('orwell-decision-card');
              card.querySelector('.odec-opt').click();
              const confirm = card.querySelector('.odec-confirm');
              const armed = !confirm.disabled;
              confirm.click();
              setTimeout(() => res({ armed,
                                     locked: (card.textContent || '').indexOf('Locked in') !== -1,
                                     events: window._g15.events - ev0,
                                     statusFetches: window._g15.statusFetches - f0 }), 1200);
            })""")
            check(g15_decision.get("armed") is True and g15_decision.get("locked") is True,
                  f"G15: the decision card's POST completed against the routed fake ({g15_decision})")
            check(g15_decision.get("events") == 1 and g15_decision.get("statusFetches", 0) >= 2,
                  f"G15: a bound decision refreshes the panels without waiting a poll period ({g15_decision})")
            page.unroute("**/api/orwell/decision")
            page.evaluate("""() => {
              const c = document.getElementById('orwell-decision-card'); if (c) c.remove();
              const b = document.getElementById('message'); if (b) b.value = '';
            }""")

            # G10 ratchet tightening: any close/minimize-shaped control inside a
            # fixed-position surface must belong to the kit or the legacy .modal family.
            rogue_chrome = page.evaluate("""() => {
              const out = [];
              document.querySelectorAll('button[aria-label="Close"], button[aria-label="Minimize"]').forEach(b => {
                let n = b.parentElement, fixed = null;
                while (n && n !== document.body) {
                  if (getComputedStyle(n).position === 'fixed') { fixed = n; break; }
                  n = n.parentElement;
                }
                if (!fixed) return;
                if (fixed.closest('[data-ow-window]') || fixed.closest('.modal') || fixed.id === 'minimized-dock'
                    || fixed.id === 'orwell-engine-status' || fixed.id === 'orwell-onboarding') return;
                out.push(fixed.id || fixed.className.toString().slice(0, 30));
              });
              return out;
            }""")
            check(rogue_chrome == [], f"F-3+: no bespoke window chrome outside the kit/.modal families ({rogue_chrome})")

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

            # E64 (ruling #3): the status panel is SIDEBAR CHROME — on a phone it lives
            # inside the off-canvas drawer, so it can never cover the composer at all.
            hud_geo = mob.evaluate("""() => {
              if (window._orwellStatusEnsure) window._orwellStatusEnsure();
              const el = document.getElementById('orwell-status');
              const rail = document.getElementById('gadget-rail-body');
              if (!el || !rail) return { ok: false, why: 'missing' };
              const cs = getComputedStyle(el);
              return { ok: true, inRail: rail.contains(el), fixed: cs.position === 'fixed' };
            }""")
            check(hud_geo.get("inRail") is True, f"mobile: status panel lives in the gadget rail ({hud_geo})")
            check(hud_geo.get("fixed") is False, f"mobile: status panel is never fixed-position ({hud_geo})")
            # F3 (wave 1, amended by H5): with The House folded into the sidebar, the
            # finale is the one mobile game sheet — the slot engine's narrow sheet host
            # still owns its position: full-width, below the top bar, clear of the
            # composer (the D2 collision rule on narrow).
            f3 = mob.evaluate("""() => {
              window._orwellFinaleEnsure && window._orwellFinaleEnsure();
              return new Promise(res => setTimeout(() => {
                const f = document.getElementById('orwell-finale').getBoundingClientRect();
                const ta = document.getElementById('message') || document.querySelector('#chat-form textarea');
                const c = ta ? ta.getBoundingClientRect() : null;
                res({ f: { top: f.top, bottom: f.bottom, w: f.width },
                      clearsComposer: !!c && f.bottom <= c.top });
              }, 350));
            }""")
            check(f3["f"]["w"] >= 370, f"F3: the finale sheet stays full-width ({f3})")
            check(f3.get("clearsComposer") is True, f"F3: the finale sheet never covers the composer ({f3})")
            mob.close()

            # H6: the Chats auto-sort control reads "Tidy" ONCE. It is a split
            # control — the main "★ Tidy" (AI) plus an options chevron that
            # reveals the no-AI cleanup sub-row — and that sub-row must carry
            # its own distinct label, never a second bare "Tidy". A fresh boot
            # has zero chats (the section is hidden+collapsed), so un-hiding it
            # is the setup; the dropdown + chevron clicks are real.
            page.evaluate("""() => {
              const sec = document.getElementById('sessions-section');
              if (sec) sec.classList.remove('hidden', 'collapsed');
            }""")
            page.click("#session-sort-btn")
            page.wait_for_timeout(250)

            def h6_visible_tidy_labels():
                return page.evaluate("""() => {
                  const vis = el => el.getClientRects().length > 0 &&
                                    getComputedStyle(el).display !== 'none';
                  const out = [];
                  document.querySelectorAll('#session-sort-dropdown *').forEach(el => {
                    if (!vis(el)) return;
                    const own = [...el.childNodes].filter(n => n.nodeType === 3)
                      .map(n => n.textContent).join(' ');
                    if (/\\bTidy\\b/.test(own)) out.push(el.id || el.className || el.tagName);
                  });
                  return out;
                }""")

            h6_closed = h6_visible_tidy_labels()
            check(h6_closed == ["auto-sort-icon"],
                  f"H6: ONE visible Tidy affordance with the options sub-row closed ({h6_closed})")
            page.click("#auto-sort-sessions-more")  # the chevron reveals the no-AI sub-row
            page.wait_for_timeout(250)
            h6_open = h6_visible_tidy_labels()
            check(h6_open == ["auto-sort-icon"],
                  f"H6: STILL exactly one visible 'Tidy' with the sub-row expanded ({h6_open})")
            h6_noai = page.evaluate("""() => {
              const el = document.getElementById('auto-sort-sessions-noai-btn');
              if (!el) return { present: false };
              return { present: true,
                       visible: el.getClientRects().length > 0 && getComputedStyle(el).display !== 'none',
                       text: (el.textContent || '').replace(/\\s+/g, ' ').trim() };
            }""")
            check(h6_noai.get("visible") is True and h6_noai.get("text", "").startswith("Clean up"),
                  f"H6: the revealed sub-row is the distinctly-labeled no-AI cleanup ({h6_noai})")
            page.evaluate("""() => {
              document.getElementById('session-sort-dropdown').style.display = 'none';
              document.getElementById('auto-sort-sessions-noai-btn').style.display = 'none';
              document.getElementById('sessions-section').classList.add('hidden', 'collapsed');
            }""")

            # H4 (sidebar icons): the collapsed rail's icons ALWAYS match the
            # expanded rows — single icon source. Every rail button is a clone
            # of its data-rail-source row's svg (sidebar-layout.js
            # syncRailIcons), and the JS-injected game chrome (Diary Room /
            # Cast / the status HUD) gets a mirrored rail button the same way.
            # Collapse the sidebar for REAL (the hamburger), then compare
            # per-entry drawing signatures between the two states.
            page.evaluate("""() => {  // clear floaters that could sit over the hamburger
              const ban = document.querySelector('#orwell-engine-status .oes-x');
              if (ban) ban.click();
            }""")
            page.wait_for_timeout(350)
            page.click("#hamburger-btn")
            page.wait_for_timeout(400)
            h4 = page.evaluate("""() => {
              const rail = document.getElementById('icon-rail');
              const sidebar = document.getElementById('sidebar');
              const railShown = rail && getComputedStyle(rail).display !== 'none';
              const collapsed = sidebar && sidebar.classList.contains('hidden');
              const GEOM = ['d','points','cx','cy','r','rx','ry','x','y','x1','y1','x2','y2','width','height'];
              const sig = (svg) => !svg ? null :
                [...svg.querySelectorAll('path,circle,rect,line,polyline,polygon,ellipse')]
                  .map(n => n.tagName + ':' + GEOM.map(a => n.getAttribute(a) || '').join(','))
                  .join('|');
              const iconSel = { 'rail-game-status': '.os-hdr svg' };
              const entries = [...rail.querySelectorAll('.icon-rail-btn[data-rail-source]')].map(btn => {
                const src = document.getElementById(btn.dataset.railSource);
                const srcSvg = src && src.querySelector(iconSel[btn.id] || 'svg');
                return { id: btn.id,
                         visible: btn.getClientRects().length > 0,
                         hasIcon: !!btn.querySelector(':scope > svg'),
                         match: srcSvg ? sig(btn.querySelector(':scope > svg')) === sig(srcSvg) : null };
              });
              const mirrors = ['rail-diary-room', 'rail-cast', 'rail-game-status'].map(id => {
                const b = document.getElementById(id);
                const src = b && document.getElementById(b.dataset.railSource);
                return { id, exists: !!b, hasIcon: !!(b && b.querySelector('svg')),
                         gateMirrors: !!b && !!src &&
                           ((getComputedStyle(src).display === 'none') === (getComputedStyle(b).display === 'none')) };
              });
              return { railShown, collapsed,
                       total: entries.length,
                       comparedVisible: entries.filter(e => e.visible && e.match === true).length,
                       mismatch: entries.filter(e => e.match === false).map(e => e.id),
                       naked: entries.filter(e => e.visible && !e.hasIcon).map(e => e.id),
                       mirrors };
            }""")
            check(bool(h4.get("collapsed")) and bool(h4.get("railShown")),
                  f"H4: the hamburger collapses the sidebar to the icon rail ({h4.get('collapsed')}/{h4.get('railShown')})")
            check(h4.get("mismatch") == [],
                  f"H4: every rail icon EQUALS its expanded row's icon — same glyph both states ({h4.get('mismatch')})")
            check(h4.get("naked") == [],
                  f"H4: no visible paired rail button renders without its icon ({h4.get('naked')})")
            check(h4.get("comparedVisible", 0) >= 3,
                  f"H4: the comparison covered the visible rail ({h4.get('comparedVisible')} of {h4.get('total')} paired entries)")
            check(all(m["exists"] and m["hasIcon"] and m["gateMirrors"] for m in h4.get("mirrors", [])),
                  f"H4: injected game chrome (Diary Room / Cast / status HUD) gets gated rail mirrors with icons ({h4.get('mirrors')})")
            page.click("#hamburger-btn")  # restore the expanded sidebar
            page.wait_for_timeout(250)

            # G13 (gating cascades — the trim-zombie walk): the game build must
            # hide PARENTS/launchers with their items (the G3 Tools-chevron rule
            # generalized to the rest of the chrome): no shortcuts-modal row
            # names a dropped vertical, no overflow/export entry is present
            # whose handler is the build-refusal path, no empty non-admin
            # settings tab button renders, and the build's own trimmed
            # launchers stay invisible. The dropped list is DERIVED from the
            # build's own sources (src.settings + game-trim.css) — never typed
            # into this gate.
            import re as _re
            if ROOT not in sys.path:
                sys.path.insert(0, ROOT)
            from src.settings import GAME_DROP_SET, dropped_script_srcs
            g13_tokens = sorted(GAME_DROP_SET)
            g13_voice_dropped = any("tts-ai" in s for s in dropped_script_srcs())
            if g13_voice_dropped:
                g13_tokens += ["tts", "voice"]
            g13_rx = _re.compile(
                r"\b(" + "|".join(t.replace("_", "[ _-]") for t in g13_tokens) + r")\b",
                _re.IGNORECASE)

            def g13_zombies(labels):
                return [l for l in labels if g13_rx.search(l or "")]

            # (a) the chrome menus: an entry whose action the build refuses is
            # GONE from the DOM (hidden, never click-refused) — and the menus
            # keep their keep-set entries, so the trigger cascade must NOT have
            # over-hidden the launchers themselves.
            check(page.evaluate("!document.getElementById('export-doc-btn')") is True,
                  "G13: the export entry whose handler posts into a dropped vertical is removed from the DOM")
            if g13_voice_dropped:
                check(page.evaluate("!document.getElementById('overflow-tts-btn')") is True,
                      "G13: the TTS overflow entry goes with its unshipped voice module")
            g13_menus = page.evaluate("""() => {
              const vis = el => el && !el.hidden && getComputedStyle(el).display !== 'none';
              const items = (menuId, sel) => [...document.querySelectorAll(`#${menuId} ${sel}`)]
                .filter(vis).map(i => (i.id + ' ' + (i.textContent || '')).replace(/\\s+/g, ' ').trim());
              document.getElementById('export-dl-btn').click();
              const exp = items('export-dropdown-menu', '.export-dropdown-item');
              document.getElementById('overflow-plus-btn').click();
              const ovf = items('overflow-menu', '.overflow-menu-item');
              return { export: exp, overflow: ovf,
                       exportTrigger: vis(document.getElementById('export-dl-btn')),
                       overflowTrigger: vis(document.getElementById('overflow-plus-btn')) };
            }""")
            page.keyboard.press("Escape")  # fold the overflow menu back
            page.evaluate("document.body.click()")  # and dismiss the export dropdown
            page.wait_for_timeout(500)
            check(len(g13_menus["export"]) >= 3,
                  f"G13: the export menu presents its keep-set entries ({g13_menus['export']})")
            check(g13_zombies(g13_menus["export"]) == [],
                  f"G13: no export-menu entry names a dropped vertical ({g13_zombies(g13_menus['export'])})")
            check(len(g13_menus["overflow"]) >= 1,
                  f"G13: the overflow menu still holds keep-set actions ({g13_menus['overflow']})")
            check(g13_zombies(g13_menus["overflow"]) == [],
                  f"G13: no overflow item present whose handler is the refusal path ({g13_zombies(g13_menus['overflow'])})")
            check(g13_menus["exportTrigger"] is True and g13_menus["overflowTrigger"] is True,
                  "G13: menus with keep-set items keep their triggers (the cascade is hide-only, never over-hides)")

            # (b) the shortcuts modal: rows render, none names a dropped
            # vertical, and no category header floats over zero rows.
            page.click("#user-bar-settings")
            page.wait_for_timeout(300)
            page.click("#settings-modal [data-settings-tab='shortcuts']")
            page.wait_for_selector("#shortcuts-list .shortcut-row", timeout=4000)
            g13_sc = page.evaluate("""() => {
              const kids = [...document.getElementById('shortcuts-list').children];
              return {
                labels: [...document.querySelectorAll('#shortcuts-list .shortcut-row .shortcut-label')]
                  .map(e => (e.textContent || '').trim()),
                emptyCats: kids.filter((k, i) => k.classList.contains('shortcut-category') &&
                    (i === kids.length - 1 || kids[i + 1].classList.contains('shortcut-category')))
                  .map(k => (k.textContent || '').trim()),
              };
            }""")
            check(len(g13_sc["labels"]) >= 6,
                  f"G13: the shortcuts list renders its keep-set rows ({len(g13_sc['labels'])})")
            check(g13_zombies(g13_sc["labels"]) == [],
                  f"G13: no shortcuts-modal row names a dropped vertical ({g13_zombies(g13_sc['labels'])})")
            check(g13_sc["emptyCats"] == [],
                  f"G13: no empty shortcut category header renders ({g13_sc['emptyCats']})")

            # (c) the player tier: no settings tab button renders whose page
            # would be empty (every card admin-only) — and the cascade is
            # COMPUTED, not hand-listed: force one tab's cards admin-only and
            # its launcher hides and cannot be landed on.
            page.evaluate("window.__g13WasAdmin = !!window._isAdmin; window._isAdmin = false;")
            page.evaluate("document.querySelector('#settings-modal .close-btn').click()")
            page.wait_for_timeout(300)
            page.click("#user-bar-settings")
            page.wait_for_timeout(250)
            g13_tabs = page.evaluate("""() => {
              const m = document.getElementById('settings-modal');
              return [...m.querySelectorAll('[data-settings-tab]')]
                .filter(b => getComputedStyle(b).display !== 'none')
                .map(b => {
                  const t = b.dataset.settingsTab;
                  const cards = [...m.querySelectorAll(`[data-settings-panel="${t}"] .admin-card`)];
                  return { tab: t, cards: cards.length,
                           allAdminOnly: cards.length > 0 && cards.every(c => c.classList.contains('admin-only')) };
                });
            }""")
            g13_empty_tabs = [t for t in g13_tabs if t["cards"] == 0 or t["allAdminOnly"]]
            check(len(g13_tabs) >= 3 and g13_empty_tabs == [],
                  f"G13: no empty non-admin settings tab button renders ({g13_empty_tabs or [t['tab'] for t in g13_tabs]})")
            page.evaluate("""() => {
              document.querySelectorAll('[data-settings-panel="shortcuts"] .admin-card')
                .forEach(c => c.classList.add('admin-only', 'g13-probe'));
              document.querySelector('#settings-modal .close-btn').click();
            }""")
            page.wait_for_timeout(300)
            page.click("#user-bar-settings")
            page.wait_for_timeout(250)
            g13_probe = page.evaluate("""() => ({
              tabHidden: getComputedStyle(document.querySelector('[data-settings-tab="shortcuts"]')).display === 'none',
              landed: (document.querySelector('#settings-modal [data-settings-tab].active') || { dataset: {} }).dataset.settingsTab,
            })""")
            check(g13_probe.get("tabHidden") is True,
                  f"G13: a tab whose every card went admin-only hides its launcher for the player ({g13_probe})")
            check(g13_probe.get("landed") != "shortcuts",
                  f"G13: the hidden tab is not landable either ({g13_probe})")
            page.evaluate("""() => {
              document.querySelectorAll('.g13-probe').forEach(c => {
                c.classList.remove('admin-only', 'g13-probe');
                c.style.display = '';  // clear the inline hide syncAdminVisibility wrote
              });
              window._isAdmin = window.__g13WasAdmin;
              const m = document.getElementById('settings-modal');
              const b = m && m.querySelector('.close-btn');
              if (b) b.click();
            }""")
            page.wait_for_timeout(300)

            # (d) the rail: collapse to the icon rail for real, then prove every
            # launcher the build's own trim sheet (the unconditional first block
            # of game-trim.css) drops stays invisible, and no VISIBLE rail
            # launcher names a dropped vertical (coordinates with H4: a dropped
            # row hidden under the build yields no rail icon).
            with open(os.path.join(ROOT, "static", "css", "game-trim.css"), encoding="utf-8") as _fh:
                g13_trimmed_ids = sorted(set(_re.findall(r"#([A-Za-z][\w-]*)", _fh.read().split("{", 1)[0])))
            page.click("#hamburger-btn")
            page.wait_for_timeout(400)
            g13_rail = page.evaluate("""(trimmed) => {
              const vis = el => el && getComputedStyle(el).display !== 'none' && el.getClientRects().length > 0;
              return {
                railShown: vis(document.getElementById('icon-rail')),
                rail: [...document.querySelectorAll('#icon-rail .icon-rail-btn')].filter(vis)
                  .map(b => ((b.id || '') + ' ' + (b.title || b.getAttribute('aria-label') || '')).trim()),
                trimmedVisible: trimmed.filter(id => vis(document.getElementById(id))),
              };
            }""", g13_trimmed_ids)
            check(g13_rail["railShown"] is True and len(g13_rail["rail"]) >= 3 and g13_zombies(g13_rail["rail"]) == [],
                  f"G13: no visible rail icon names a dropped vertical ({g13_zombies(g13_rail['rail']) or g13_rail['rail']})")
            check(g13_rail["trimmedVisible"] == [],
                  f"G13: every game-trim'd launcher stays invisible ({g13_rail['trimmedVisible']})")
            page.click("#hamburger-btn")  # restore the expanded sidebar
            page.wait_for_timeout(250)

            # G17 (refresh-persistence audit F3/F5/F7 + F4): the composer draft survives
            # a refresh as ONE per-user sessionStorage record {text, drMode,
            # pendingApproachId}; a Diary-Room draft re-enters DR mode BEFORE its text
            # lands (F5 — a restored confessional must never be sendable to the house);
            # an approach prefill keeps its pending chip; and the casting seat re-arms.
            # Driven for REAL on fresh pages: real typing, real reloads, real clicks.
            g17 = browser.new_page()
            # A STARTED game is staged with the sanctioned route-mock pattern (the G15
            # decision fake above; the G5 audit drove its DR cell against a real game):
            # the Diary-Room gate legitimately EXITS DR mode when no game is running, so
            # an engine-down page could never hold a restored confessional open.
            g17.route("**/api/orwell/state",
                      lambda r: r.fulfill(status=200, content_type="application/json",
                                          body='{"started": true, "week": 2, "phase": "social"}'))
            # The F5 ORDER SPY, armed before every navigation: at the exact moment the
            # restored text lands in #message (the restore's input dispatch), record
            # whether DR mode was ALREADY active on <body>. Synchronous truth, no race.
            g17.add_init_script("""
              window.__g17Order = [];
              window.addEventListener('input', (e) => {
                if (e.target && e.target.id === 'message' && e.target.value) {
                  window.__g17Order.push({
                    dr: document.body.classList.contains('orwell-dr-mode'),
                    text: e.target.value });
                }
              }, true);
            """)

            def g17_settle(p):
                p.wait_for_timeout(2500)
                # the engine-down boot mounts the dark-house card — dismiss like a person
                if p.query_selector("#orwell-onboarding"):
                    p.keyboard.press("Escape")
                    p.wait_for_timeout(200)

            g17.goto(base + "/", wait_until="load", timeout=30000)
            g17_settle(g17)

            # F3 (M1, the commission's literal text): a player-typed draft survives.
            g17.click("#message")
            g17.keyboard.type("I want to pull the HOH aside before the ceremony.")
            g17.wait_for_timeout(600)  # > the write debounce
            g17_rec = g17.evaluate("window._orwellComposerDraftPeek && window._orwellComposerDraftPeek()")
            check(bool(g17_rec) and g17_rec.get("text", "").startswith("I want to pull")
                  and "drMode" in g17_rec and "pendingApproachId" in g17_rec,
                  f"G17/F3: typing writes ONE draft record {{text, drMode, pendingApproachId}} ({g17_rec})")
            g17.reload(wait_until="load")
            g17_settle(g17)
            check(g17.input_value("#message") == "I want to pull the HOH aside before the ceremony.",
                  "G17/F3: the typed draft is restored into the composer after reload")

            # F5 (the privacy gate): a Diary-Room draft re-enters DR mode BEFORE the text.
            g17.click("#message")
            g17.keyboard.press("Control+a")
            g17.keyboard.press("Delete")  # empty the box for real (drops the record)
            g17.evaluate("window._orwellOpenDiaryRoom()")
            check(g17.evaluate("document.body.classList.contains('orwell-dr-mode')") is True,
                  "G17/F5 setup: the composer is in Diary-Room mode")
            g17.keyboard.type("Confessional: I'm secretly working with the nominee.")
            g17.wait_for_timeout(600)
            g17.reload(wait_until="load")
            g17_settle(g17)
            g17_order = g17.evaluate("window.__g17Order")
            check(len(g17_order) >= 1 and g17_order[0].get("dr") is True
                  and g17_order[0].get("text", "").startswith("Confessional:"),
                  f"G17/F5: DR mode was active BEFORE the restored text landed ({g17_order})")
            check(g17.evaluate("document.body.classList.contains('orwell-dr-mode')") is True
                  and g17.evaluate("window._orwellDiaryRoomActive && window._orwellDiaryRoomActive()") is True,
                  "G17/F5: the restored confessional draft sits in an ACTIVE Diary-Room composer")
            check(g17.evaluate("getComputedStyle(document.getElementById('orwell-dr-pill')).display") != "none",
                  "G17/F5: the DR pill is visible with the restored draft")
            check(g17.input_value("#message").startswith("Confessional:"),
                  "G17/F5: the confessional text itself is restored")
            g17.close()

            # F4: the casting-seat prefill re-arms after a refresh (the marker used to
            # one-shot at prefill time, stranding an empty composer forever). Pre-game is
            # staged with routed fakes — the sanctioned G5-audit pattern, same as the G15
            # decision route above: state says started:false, models says one is live.
            f4 = browser.new_page()
            f4.route("**/api/orwell/state",
                     lambda r: r.fulfill(status=200, content_type="application/json",
                                         body='{"started": false}'))
            f4.route("**/api/models",
                     lambda r: r.fulfill(status=200, content_type="application/json",
                                         body='{"items": [{"models": ["m"], "offline": false}]}'))
            f4.goto(base + "/", wait_until="load", timeout=30000)
            f4.wait_for_timeout(3000)  # route() probes + the fresh-session click + the prefill
            f4_seat0 = f4.input_value("#message")
            check(f4_seat0.startswith("I take my seat"),
                  f"G17/F4 setup: pre-game boot prefills the casting-seat line ({f4_seat0!r})")
            check(f4.evaluate("sessionStorage.getItem('orwell-interview-open')") == "1",
                  "G17/F4 setup: the seat marker is set (the F7 one-session fence)")
            # The exact F4 trap: no draft left (composer emptied for real) AND the marker
            # claiming "interview underway" — a refresh used to strand this forever.
            f4.click("#message")
            f4.keyboard.press("Control+a")
            f4.keyboard.press("Delete")
            f4.wait_for_timeout(300)  # the empty write lands (drops the F3 record)
            f4.reload(wait_until="load")
            f4.wait_for_timeout(3000)  # route() + the re-arm's settle delay
            f4_seat1 = f4.input_value("#message")
            check(f4_seat1.startswith("I take my seat"),
                  f"G17/F4: with the marker set and no draft, the seat prefill RE-ARMS after reload ({f4_seat1!r})")
            f4.close()

            # S1+S2 / F1 (2026-06-11 settings-wiring audit): the Shortcuts
            # persist→apply loop, driven for REAL. A rebind saves per-profile
            # (PUT /api/prefs/keybinds, C30) — but the runtime keymap booted
            # from /api/auth/settings only, a key nothing writes anymore, so
            # every custom shortcut silently reverted on reload while the tab
            # still rendered it as saved. Pin: rebind → reload → the new combo
            # is loaded AND fires; the old default no longer does.
            s1 = browser.new_page()
            s1.goto(base + "/", wait_until="load", timeout=30000)
            g17_settle(s1)
            s1.click("#user-bar-settings")
            s1.wait_for_timeout(300)
            s1.click("#settings-modal [data-settings-tab='shortcuts']")
            s1.wait_for_selector("#shortcuts-list .shortcut-key[data-action='search']", timeout=4000)
            s1.click("#shortcuts-list .shortcut-key[data-action='search']")  # start listening
            s1.keyboard.press("Control+Shift+M")  # preview the combo
            s1.keyboard.press("Enter")            # commit → saveKeybinds → the per-user store
            s1.wait_for_timeout(600)
            s1_saved = s1.evaluate(
                "fetch('/api/prefs/keybinds', { credentials: 'same-origin' })"
                ".then(r => r.json()).then(d => (d.value || {}).search)")
            check(s1_saved == "ctrl+shift+m",
                  f"S1/F1: the rebind round-trips through the per-user store ({s1_saved!r})")
            check(s1.evaluate("window._orwellKeybinds.search") == "ctrl+shift+m",
                  "S1/F1: the rebind is live in-page immediately after the save")
            s1.reload(wait_until="load")
            g17_settle(s1)  # the keymap's async boot (global seed → prefs layer) settles
            s1_kb = s1.evaluate("window._orwellKeybinds.search")
            check(s1_kb == "ctrl+shift+m",
                  f"S1/F1: the saved rebind survives a reload ({s1_kb!r}; pre-fix it reverted to 'ctrl+k')")
            s1.keyboard.press("Control+Shift+M")
            s1.wait_for_timeout(250)
            check(s1.evaluate("!document.getElementById('search-overlay').classList.contains('hidden')") is True,
                  "S1/F1: the rebound combo FIRES after reload (search opens)")
            s1.keyboard.press("Control+Shift+M")  # the toggle path closes it again
            s1.wait_for_timeout(250)
            check(s1.evaluate("document.getElementById('search-overlay').classList.contains('hidden')") is True,
                  "S1/F1: the rebound combo toggles closed")
            s1.keyboard.press("Control+k")
            s1.wait_for_timeout(250)
            check(s1.evaluate("document.getElementById('search-overlay').classList.contains('hidden')") is True,
                  "S1/F1: the OLD default no longer fires — the runtime serves the per-user layer")
            # leave the store clean for the next run (null pref ⇒ defaults)
            s1.evaluate(
                "fetch('/api/prefs/keybinds', { method: 'PUT', credentials: 'same-origin',"
                " headers: { 'Content-Type': 'application/json' },"
                " body: JSON.stringify({ value: null }) }).then(r => r.status)")
            s1.wait_for_timeout(300)
            s1.close()

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
