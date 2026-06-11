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
            check(page.evaluate("!document.querySelector('.osoc-box')") is True,
                  "diary room: no dialog box node is created")
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

            # T20: the social HUD's minimize-to-dock BEHAVIOR (the source-pins in
            # tests/test_orwell_huds.py only prove the wiring is present — this proves it WORKS in
            # the browser). Mount the panel, click its minimize control, and assert the panel hides
            # AND a dock chip for it appears in the shared "Windows" dock; then restore via the chip
            # and assert the panel returns. A regression that drops the dock wiring (reverting to an
            # in-place collapse, or losing the chip) fails here, not just at the source grep.
            page.evaluate("window._orwellSocialEnsure && window._orwellSocialEnsure()")
            page.wait_for_selector("#orwell-social", timeout=3000)
            check(page.evaluate("getComputedStyle(document.getElementById('orwell-social')).display !== 'none'") is True,
                  "social HUD: mounts visible")
            page.evaluate("document.querySelector('#orwell-social .osoc-min').click()")
            page.wait_for_timeout(200)  # let the dock re-render
            min_state = page.evaluate("""() => {
              const el = document.getElementById('orwell-social');
              const chip = document.querySelector('#minimized-dock .minimized-dock-chip[data-modal-id="orwell-social"]');
              return { hidden: !el || getComputedStyle(el).display === 'none', chip: !!chip };
            }""")
            check(min_state.get("hidden") is True, f"social HUD: minimize HIDES the panel ({min_state})")
            check(min_state.get("chip") is True, f"social HUD: minimize parks a chip in the shared dock ({min_state})")
            page.evaluate("document.querySelector('#minimized-dock .minimized-dock-chip[data-modal-id=\"orwell-social\"]').click()")
            page.wait_for_timeout(200)
            restored = page.evaluate(
                "(function(){var e=document.getElementById('orwell-social');return !!e && getComputedStyle(e).display!=='none';})()")
            check(restored is True, "social HUD: restoring from the dock chip re-opens the panel")

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
              const sb = document.getElementById('sidebar');
              if (!el || !sb) return { ok: false, why: 'missing' };
              const cs = getComputedStyle(el);
              return { ok: true, inSidebar: sb.contains(el), fixed: cs.position === 'fixed' };
            }""")
            check(hud_geo.get("inSidebar") is True, f"mobile: status panel is sidebar chrome ({hud_geo})")
            check(hud_geo.get("fixed") is False, f"mobile: status panel is never fixed-position ({hud_geo})")
            # C26/M1: the social HUD (still a window) stays a full-width top sheet that
            # never covers the composer.
            soc_geo = mob.evaluate("""() => {
              if (window._orwellSocialEnsure) window._orwellSocialEnsure();
              const el = document.getElementById('orwell-social');
              const ta = document.getElementById('message') || document.querySelector('#chat-form textarea');
              if (!el || !ta) return { ok: false };
              const r = el.getBoundingClientRect(), c = ta.getBoundingClientRect();
              return { fullWidth: r.width >= window.innerWidth * 0.95, clearsComposer: r.bottom <= c.top };
            }""")
            check(soc_geo.get("fullWidth") is True, f"mobile: social HUD is a full-width sheet ({soc_geo})")
            check(soc_geo.get("clearsComposer") is True, f"mobile: social HUD never covers the composer ({soc_geo})")

            # E89 belt: even if the engine FAILS OPEN and hands the UI approaches before the first
            # ceremony resolves, the FE renders NO chip. We drive the belt CLOSED and feed it two
            # approaches; the strip must stay empty.
            belt = mob.evaluate("""() => {
              if (!window._orwellSocialDriveApproaches) return { ok: false };
              const early = window._orwellSocialDriveApproaches(false, [
                { houseguest: { id: 'npc:1', name: 'A Houseguest' }, motive: 'bond' },
                { houseguest: { id: 'npc:2', name: 'Another' }, motive: 'probe' },
              ]);
              // The belt helper itself: the premiere HOH competition reads pre-ceremony.
              const preHoh = window._orwellFirstCeremonyResolved({ started: true, week: 1, phase: 'hoh-competition' });
              const postNoms = window._orwellFirstCeremonyResolved({ started: true, week: 1, phase: 'nominations' });
              return { ok: true, earlyCount: early.count, preHoh, postNoms };
            }""")
            check(belt.get("ok") is True, "social belt: the test seam is present")
            check(belt.get("earlyCount") == 0, f"E89: no chip renders on engine fail-open before the first ceremony ({belt})")
            check(belt.get("preHoh") is False, "E89: the premiere HOH competition reads pre-ceremony")
            check(belt.get("postNoms") is True, "E89: the first nominations beat opens the belt")

            # E60: once the belt is OPEN, bond vs probe render DISTINCT, motive-tagged chips.
            motive = mob.evaluate("""() => {
              const r = window._orwellSocialDriveApproaches(true, [
                { houseguest: { id: 'npc:1', name: 'A Houseguest' }, motive: 'bond' },
                { houseguest: { id: 'npc:2', name: 'Another' }, motive: 'probe' },
              ]);
              return r;
            }""")
            check(motive.get("count") == 2, f"E60: both approaches render once the belt opens ({motive})")
            check(motive.get("motives") == ["bond", "probe"], f"E60: chips are tagged by motive ({motive})")
            classes = motive.get("classes") or []
            check(len(set(classes)) == 2 and None not in classes,
                  f"E60: bond and probe carry DISTINCT framing classes ({motive})")
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
