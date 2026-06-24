#!/usr/bin/env python3
"""The responsive matrix gate (Stream S, mechanism part 5 — ruling #16).

Boots the real front-end (and, when available, the real engine with a staged
game) and drives the UI across the viewport matrix with MEASURABLE assertions:

  overflow  — no page-level horizontal scroll; no surface wider than its box
  overlap   — no registered game surface intersects another or the composer
              (the D2 collision rule, executable)
  crowding  — no visible text below the --fs-2xs floor (~11px); no nowrap
              line-box overflow
  touch     — ≥44px interactive boxes at coarse-pointer viewports (WCAG 2.5.5)
  200% pass — doubling the root font must not break the page

KNOWN failures carry a finding ID in XFAIL below and report as xfail (exit 0).
When a finding lands, its xfail flips to a hard assertion by REMOVING the entry
— the gate ratchets. An xpass prints a nudge to remove the entry.

Engine-staged surfaces (status HUD, decision card, …) are exercised when an
engine is reachable (ORWELL_MATRIX_ENGINE=url) or buildable; otherwise the run
covers the page chrome (composer, sidebar, settings, theme modal) — still the
S1/S5/S9 regression net. Usage:  python3 scripts/responsive_matrix.py

J5-19 — the ENDGAME mobile sweep (opt-in). stage_game() only creates a fresh
(turn-0) game, so the endgame surfaces (#orwell-retro self-gates on
recap.finished; the endgame decision card needs a live finale pending) never
render under the default run — leaving the endgame mobile UX asserted by
source-string tests only. Set ORWELL_MATRIX_FINISH=1 (with a reachable engine)
to fast-forward the staged season to FINISHED via the engine's player-channel
advanceGame/submitDecision loop, then mount #orwell-retro + the endgame decision
card and re-run the SAME overlap/tap/crowding sweep at the phone tiers. It is
guarded (off by default; no-op without an engine or a started game) and fail-
soft, so it can never change the default fresh-game run.
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
# J5-19 opt-in: drive the staged game to a FINISHED season so the endgame surfaces
# (#orwell-retro, the endgame decision card) actually RENDER at the phone viewports — they
# self-gate on recap.finished / a live finale pending and never appear on a fresh turn-0 game,
# so the default stage_game() run measures ZERO endgame layout. Off by default (it needs a
# reachable engine and mutates the shared sandbox); CI/operators set ORWELL_MATRIX_FINISH=1.
FINISH_SEASON = os.environ.get("ORWELL_MATRIX_FINISH", "") not in ("", "0", "false", "no")
# The user identity the FE asserts to the engine. The matrix boots the FE anonymous
# (AUTH_ENABLED=false) → the FE sends NO X-Orwell-User header → the engine routes to its
# single-tenant "default" sandbox. To drive THAT SAME game directly we must match: send no
# user header too (override with ORWELL_MATRIX_USER only if the FE is wired multi-user).
MATRIX_USER = os.environ.get("ORWELL_MATRIX_USER", "")

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
    # (empty — the chrome PR's anchor slots + sidebar moves made the D2 collision
    # rule structural; add ONLY with a finding ID, remove when the finding lands.)
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
    # 120s boot budget: on a loaded self-hosted runner (the whole CI fan-out
    # hammering one host during a merge wave) uvicorn's first 200 can take well
    # past 30s. Matches the deploy/smoke.sh FE-boot wait so neither flakes.
    for _ in range(240):
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


def _engine_tool(name, args=None):
    """Call a player-channel engine tool the SAME way the FE does (POST /player/call, no model
    cost — the engine narrator is the deterministic Echo). Returns the parsed `result` (or None).
    Fail-soft: any transport/JSON error → None, so this can never break the matrix run."""
    try:
        headers = {"Content-Type": "application/json"}
        if MATRIX_USER:
            headers["X-Orwell-User"] = MATRIX_USER
        r = httpx.post(f"{ENGINE_URL}/player/call",
                       json={"name": name, "args": args or {}}, headers=headers, timeout=60)
        if r.status_code != 200:
            return None
        return (r.json() or {}).get("result")
    except Exception:
        return None


# The autoResolve mapping mirrors the committed fast-forward harness
# (docs/audits/playtest-harness/s4ff.mjs autoResolve) — pick the cheapest legal answer for every
# pending kind so the loop reaches a finale/finished state deterministically. No content authoring:
# the engine owns every outcome; these are throwaway picks purely to advance the closed-set loop.
def _auto_resolve(p):
    kind = p.get("kind")
    opts = p.get("options") or []

    def opt(i):
        return opts[i]["id"] if len(opts) > i and isinstance(opts[i], dict) else None

    if kind == "nominations":
        return {"kind": kind, "choice": [opt(0), opt(1)]}
    if kind == "veto-decision":
        return {"kind": kind, "use": False}
    if kind in ("comp-intent", "comp-round"):
        return {"kind": kind, "intent": "compete"}
    if kind == "houseguests-choice":
        return {"kind": kind, "vote": opt(0)}
    if kind == "replacement":
        return {"kind": kind, "replacement": opt(0)}
    if kind in ("eviction-vote", "tie-break", "final-eviction", "juror-vote"):
        return {"kind": kind, "vote": opt(0)}
    if kind == "goodbye-message":
        return {"kind": kind, "vote": opt(0), "statement": "Take care."}
    if kind == "finale-statement":
        return {"kind": kind, "statement": "I played my own game."}
    if kind == "finale-answer":
        appeals = p.get("appeals") or ["own-game"]
        return {"kind": kind, "appeal": appeals[0]}
    if kind == "juror-question":
        return {"kind": kind, "statement": "What was your biggest move?"}
    if kind == "self-evict":
        # Never volunteer the player out of the game during a fast-forward.
        return None
    return {"kind": kind}


# A finale-family pending is where the high-stakes endgame decision card lives (final eviction, the
# juror vote, the finalist statement, …). We capture the LAST such pending seen while driving so the
# audit can render a real endgame decision card even after the game has finished (the card renders
# purely from its Vault-free PendingDecisionView detail — measuring it needs no live game).
_FINALE_KINDS = {"final-eviction", "finale-statement", "finale-answer",
                 "juror-question", "juror-vote", "goodbye-message", "tie-break"}


def finish_game():
    """Drive the staged game to a FINISHED season via the engine's player channel (opt-in,
    fail-soft, idempotent). Returns (finished: bool, endgame_pending: dict|None) — the latter is
    the last finale-family pending observed, so the audit can also render the endgame decision card.

    Guarded three ways so it can NEVER perturb the default run:
      • only when ORWELL_MATRIX_FINISH is set AND an engine URL is configured;
      • only if a started game is actually present (else it is a no-op);
      • every engine call is fail-soft (a transport error simply ends the loop).
    """
    if not (FINISH_SEASON and ENGINE_URL):
        return False, None
    gs = _engine_tool("getGameState")
    if not (isinstance(gs, dict) and gs.get("started")):
        return False, None  # nothing to finish — leave the matrix run untouched
    finished = bool(gs.get("finished"))
    endgame_pending = None
    consec_fail = 0
    for _ in range(4000):  # generous bound; a real season ends in well under this
        adv = _engine_tool("advanceGame")
        if not isinstance(adv, dict):
            consec_fail += 1
            if consec_fail > 5:
                break
            continue
        consec_fail = 0
        if adv.get("finished"):
            finished = True
            break
        p = adv.get("pending")
        if not p:
            continue
        if p.get("kind") in _FINALE_KINDS:
            endgame_pending = p  # remember the latest endgame card for the audit
        decision = _auto_resolve(p)
        if decision is None:  # e.g. self-evict — do not resolve; just keep advancing
            continue
        sub = _engine_tool("submitDecision", decision)
        if not isinstance(sub, dict):
            consec_fail += 1
            if consec_fail > 5:
                break
            continue
        if sub.get("finished"):
            finished = True
            break
    return finished, endgame_pending


GAME_SURFACES = ["#orwell-status", "#orwell-presence",
                 "#orwell-retro", "#orwell-decision-card", "[id*='ofin']", "[class*='odec']"]
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

    # --- #740: the gadget RAIL / cast-PIN card never sits over the composer ----
    # The conversation IS the game, so the composer (.chat-input-bar) must never be occluded by a
    # rail or pinned cast card. The desktop rail is an in-flow flex column (clears by construction);
    # the mobile drawer is a deliberate modal slide-over (opened on purpose, dismissed by ×/tap-out),
    # so a CLOSED rail and the OPEN drawer are both legitimate non-findings — we only flag a rail/pin
    # card that is actually painting over the composer while NOT the intentionally-open drawer.
    if cbox:
        rail_overlap = page.evaluate(
            """
            (() => {
              const comp = document.querySelector('.chat-input-bar');
              if (!comp) return [];
              const cs0 = getComputedStyle(comp);
              if (cs0.display === 'none' || cs0.visibility === 'hidden') return [];
              const cb = comp.getBoundingClientRect();
              if (cb.width <= 0 || cb.height <= 0) return [];
              const pad = 2;  // border/shadow grace, matching the py _intersects
              const hits = (b) => !(b.right - pad <= cb.left || cb.right - pad <= b.left ||
                                    b.bottom - pad <= cb.top || cb.bottom - pad <= b.top);
              const out = [];
              const rail = document.getElementById('gadget-rail');
              const drawerOpen = rail && rail.classList.contains('grail-open');
              // The cast-pin card + the whole rail (only when it has gone floating, never the
              // in-flow desktop column or the deliberate open drawer).
              const cands = [];
              if (rail && !rail.hasAttribute('hidden') && !drawerOpen) {
                const rp = getComputedStyle(rail).position;
                if (rp === 'fixed' || rp === 'absolute') cands.push(['gadget-rail(floating)', rail]);
              }
              const pin = document.getElementById('orwell-cast-pin');
              if (pin && getComputedStyle(pin).display !== 'none' && !drawerOpen) {
                // A cast-pin card that has escaped the rail body (orphaned onto <body>) and floats.
                const inRail = !!pin.closest('#gadget-rail-body');
                const pp = getComputedStyle(pin).position;
                if (!inRail && (pp === 'fixed' || pp === 'absolute')) cands.push(['cast-pin(orphaned)', pin]);
              }
              for (const [name, el] of cands) {
                const b = el.getBoundingClientRect();
                if (b.width > 4 && b.height > 4 && hits(b)) out.push(name);
              }
              return out;
            })()
            """
        )
        for name in (rail_overlap or []):
            report("fail", f"{vp_name} overlap:{name} intersects the composer")
        if not rail_overlap:
            report("pass", f"{vp_name} rail/cast-pin clears composer")

    # --- crowding: visible text at or above the floor; nowrap overflow -------
    crowd = page.evaluate(f"""
      (() => {{
        const out = [];
        const els = document.querySelectorAll('#settings-modal *, .settings-layout *, #orwell-status *, #chat-form *');
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
    # RESP-4 (#625): floor is the PROJECT 44px (WCAG 2.5.5), not the old 36px that let 36–43px
    # controls ship green. Selectors widened past `button`/`select` to the kit + composer + game
    # chrome that the narrow set missed (anchors-as-buttons, the gadget-rail/cast/window controls,
    # the composer icon buttons, the scroll-to-latest fab). The gadget-rail drawer is opened first
    # (fail-soft) so its panel controls are actually IN VIEW for the sweep instead of stowed.
    if coarse:
        try:
            page.evaluate("(document.querySelector('.gadget-rail-open,#gadget-rail-open')||{click(){}}).click()")
            page.wait_for_timeout(350)
        except Exception:
            pass
        small = page.evaluate("""
          [...document.querySelectorAll(
             'button, [role=button], a[role=button], a.btn, select, .settings-nav-item,'
             + '.input-icon-btn, .export-dl-btn, .scroll-nav-btn, #orwell-scroll-bottom,'
             + '.gadget-rail-open, .gadget-rail-head button, .ow-controls button, .ow-dismiss,'
             + '.minimized-dock-x, .oc-pin, .oc-backfill, .opt-dismiss')]
            .filter(e => e.offsetParent !== null && !e.classList.contains('tap-exempt'))
            .map(e => { const r = e.getBoundingClientRect();
                        return { t: (e.innerText || e.ariaLabel || e.id || '?').slice(0, 20), w: r.width, h: r.height }; })
            .filter(b => b.w > 0 && b.h > 0 && (b.w < 44 || b.h < 44))
            .slice(0, 8)
        """)
        for s in small:
            report("fail", f"{vp_name} touch: {s['t']!r} {s['w']:.0f}x{s['h']:.0f}")
        if not small:
            report("pass", f"{vp_name} touch floors")


def _intersects(a, b):
    pad = 2  # px of grace for borders/shadows
    return not (a["x"] + a["width"] - pad <= b["x"] or b["x"] + b["width"] - pad <= a["x"] or
                a["y"] + a["height"] - pad <= b["y"] or b["y"] + b["height"] - pad <= a["y"])


# #758 — a top system-banner must RESERVE space + COMPRESS the fixed-chrome layer below it: no
# window / sidebar / rail / composer may sit UNDER the banner, and the lowest window stays in the
# viewport (compressed, not shifted off the bottom). The banner is position:fixed; the body
# padding-top only re-flows in-flow content — the fixed layer must consume --on-banner-inset.
#
# #758b — when MULTIPLE top banners stack (engine-status + a reconnecting notice + …, all in the
# ONE #orwell-notice-banner host), the reserved inset must equal the host's TOTAL live height, so
# nothing is covered by any banner. This sweep forces TWO banners (incl. a long multi-line one that
# wraps) and asserts BOTH that --on-banner-inset == the host height AND that no chrome sits under
# the combined stack.
def audit_banner(page, vp_name, width, height):
    # Force TWO deterministic top banners via the notice kit's own API, then open a top-slotted kit
    # window (+ a TALL one to prove compression) and show the rail. Fail-soft: if the kit/seam
    # isn't present (a degraded chrome-only DOM) the sweep no-ops rather than flaking.
    # The tall-window COMPRESSION probe runs on the wide tier only: on the narrow tier kit windows
    # are full-width SHEETS (the slot sheet-host) whose max-height cap (min(70dvh,560px)) can itself
    # exceed a tiny phone viewport — a sheet-host concern, not the banner-reserve one. On narrow we
    # still assert the load-bearing invariant: nothing renders UNDER the banner.
    wide = width > 768
    shown = page.evaluate(
        """(wide) => {
            const K = window.OrwellNoticeKit;
            if (!K || !K.create) return false;
            try {
              const n = K.create({ id: 'matrix-banner', kind: 'system-notice', severity: 'error',
                                   title: 'System: connection lost', placement: 'top-banner', persistDismiss: false });
              if (n.setBody) n.setBody('The house is offline — reconnecting…');
              n.show();
              // #758b: a SECOND, long multi-line banner (engine-status style) so the host stacks two
              // cards and its height wraps — exercising the union-inset / re-measure path.
              const n2 = K.create({ id: 'matrix-banner-2', kind: 'system-notice', severity: 'warn',
                                    title: 'Big Brother engine unavailable.', placement: 'top-banner', persistDismiss: false });
              if (n2.setBody) n2.setBody('The app could not reach the game service at http://127.0.0.1:8765 — '
                + 'connection refused. The show cannot load until it is back. A long reason that wraps to '
                + 'several lines on a narrow viewport, exercising the height-measurement race.');
              n2.show();
            } catch (_) { return false; }
            try {
              if (window.OrwellWindowKit) {
                window.OrwellWindowKit.create({ id: 'matrix-banner-win', title: 'Banner Top', slot: 'top-left',
                  content: '<div style=\"height:140px\">top</div>' }).open();
                if (wide) window.OrwellWindowKit.create({ id: 'matrix-banner-tall', title: 'Banner Tall', slot: 'top-center',
                  content: '<div style=\"height:760px\">tall</div>' }).open();
              }
            } catch (_) {}
            try { (document.querySelector('.gadget-rail-open,#gadget-rail-open') || { click() {} }).click(); } catch (_) {}
            return true;
        }""",
        wide,
    )
    if not shown:
        report("pass", f"{vp_name} banner-inset (skipped — notice kit unavailable)")
        return
    page.wait_for_timeout(500)
    m = page.evaluate(
        """() => {
            const host = document.getElementById('orwell-notice-banner');
            const br = host ? host.getBoundingClientRect() : null;
            const insetVar = parseFloat(getComputedStyle(document.body).getPropertyValue('--on-banner-inset')) || 0;
            const cardCount = host ? host.children.length : 0;
            const sels = ['.ow-window', '#sidebar', '#gadget-rail', '.chat-input-bar', '#chat-form'];
            const rows = []; let lowestWin = -1;
            for (const sel of sels) {
              document.querySelectorAll(sel).forEach(el => {
                const cs = getComputedStyle(el);
                if (cs.display === 'none' || cs.visibility === 'hidden') return;
                const r = el.getBoundingClientRect();
                if (r.width < 2 || r.height < 2) return;
                rows.push({ sel, top: r.top, bottom: r.bottom });
                if (sel === '.ow-window' && r.bottom > lowestWin) lowestWin = r.bottom;
              });
            }
            return { bannerBottom: br ? br.bottom : 0, bannerHeight: br ? br.height : 0,
                     insetVar: insetVar, cardCount: cardCount, rows, lowestWin };
        }"""
    )
    bb = m["bannerBottom"]
    if bb <= 1:
        report("pass", f"{vp_name} banner-inset (banner did not render)")
        page.evaluate("['matrix-banner','matrix-banner-2'].forEach(id=>{const e=document.getElementById(id);if(e)e.remove();})")
        return
    # #758b: the reserved inset must equal the host's TOTAL live height (the union of ALL stacked
    # top banners) — a stale/short inset is exactly how the engine-status banner covered content.
    if abs(m["insetVar"] - m["bannerHeight"]) > 2:
        report("fail", f"{vp_name} banner-inset: --on-banner-inset {m['insetVar']:.0f} != banner host height "
                       f"{m['bannerHeight']:.0f} ({m['cardCount']} stacked banners — the union must be reserved)")
    else:
        report("pass", f"{vp_name} banner-inset union ({m['cardCount']} banners, inset {m['insetVar']:.0f}px == host)")
    under = [r for r in m["rows"] if r["top"] < bb - 2]   # 2px grace
    for r in under:
        report("fail", f"{vp_name} banner-inset: {r['sel']} top {r['top']:.0f} is under the banner bottom {bb:.0f}")
    # COMPRESSION (wide tier only): the lowest window must stay in the viewport — a tall window
    # shrinks below the banner rather than running off the bottom. The narrow sheet-host tier is
    # exempt (its sheets scroll/stack by design; the under-banner check still applies there).
    off_bottom = wide and m["lowestWin"] > height + 2
    if off_bottom:
        report("fail", f"{vp_name} banner-inset: lowest window bottom {m['lowestWin']:.0f} > viewport {height}")
    if not under and not off_bottom:
        report("pass", f"{vp_name} banner-inset ({len(m['rows'])} surfaces all below the banner"
                       f"{', in-viewport' if wide else ''})")
    # tear the forced banners + probe windows back down so the rest of the sweep measures clean
    page.evaluate(
        """() => {
            ['matrix-banner-win','matrix-banner-tall'].forEach(id => {
              const el = document.getElementById(id); if (el) el.remove();
            });
            const h = document.getElementById('orwell-notice-banner'); if (h) h.textContent = '';
            try { document.body.style.removeProperty('--on-banner-inset'); document.body.style.paddingTop = ''; } catch (_) {}
        }"""
    )
    page.wait_for_timeout(150)


def mount_endgame_card(page, endgame_pending):
    """Render the endgame decision card by dispatching the engine's own Vault-free pending detail
    over the `orwell:pending` window event (exactly how chat.js arms it). The card renders from the
    detail alone — no live game is needed to MEASURE its layout (the matrix never clicks Confirm).
    Returns True if a card mounted. Fail-soft."""
    if not endgame_pending:
        return False
    try:
        import json as _json
        page.evaluate(
            "(p) => window.dispatchEvent(new CustomEvent('orwell:pending', { detail: { pending: p } }))",
            endgame_pending if isinstance(endgame_pending, dict) else _json.loads(_json.dumps(endgame_pending)),
        )
        page.wait_for_timeout(600)  # let the card's entrance animation settle
        return bool(page.query_selector("#orwell-decision-card"))
    except Exception:
        return False


def remove_endgame_card(page):
    """Tear the decision card back down so the next sub-pass measures a surface in ISOLATION — the
    live finale card and the post-season retro never co-exist in a real game (one is live, one is
    finished), so measuring them together would manufacture a false cross-surface overlap."""
    try:
        page.evaluate("(document.getElementById('orwell-decision-card')||{remove(){}}).remove()")
    except Exception:
        pass


def mount_retro(page):
    """Build+show #orwell-retro via its headless seam (window._orwellRetroEnsure, mirrored from the
    other panels). On a finished season its own 30s poll fills the body (winner headline, highlights,
    the 44px 'Open the Vault' button); we wait for one tick so the tap sweep sees the real button.
    Returns True if the panel mounted visible. Fail-soft."""
    try:
        page.evaluate("typeof window._orwellRetroEnsure === 'function' && window._orwellRetroEnsure()")
        page.wait_for_timeout(1500)
        # The earlier card pass may have force-hidden the panel (display:none) to isolate the card;
        # clear that so the panel is its natural self for the retro measurement. (Its own poll would
        # restore it on the next 30s tick, but the matrix can't wait that long.)
        page.evaluate("(document.getElementById('orwell-retro')||{}).style&&(document.getElementById('orwell-retro').style.display='')")
        el = page.query_selector("#orwell-retro")
        return bool(el and el.is_visible())
    except Exception:
        return False


def main():
    from playwright.sync_api import sync_playwright
    proc = boot_fe()
    with_game = stage_game()
    print(f"== matrix: game surfaces {'STAGED' if with_game else 'absent (no engine — chrome-only run)'}")
    # J5-19 (opt-in): drive the staged season to a finished/endgame state so the endgame surfaces
    # actually render at the phone viewports. No-op + fail-soft unless ORWELL_MATRIX_FINISH is set and
    # the engine is reachable with a started game — it can never alter the default fresh-game run.
    finished, endgame_pending = (finish_game() if with_game else (False, None))
    if FINISH_SEASON:
        print(f"== matrix: endgame {'FINISHED' if finished else 'not reached'}"
              f"{' (endgame card captured)' if endgame_pending else ''}")
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            for vp_name, w, h, coarse in VIEWPORTS:
                ctx = browser.new_context(viewport={"width": w, "height": h},
                                          has_touch=coarse)
                page = ctx.new_page()
                page.goto(FE, wait_until="domcontentloaded")
                audit_page(page, vp_name, w, h, coarse, with_game)

                # #758: a top system-banner must reserve space + compress the fixed-chrome layer
                # below it (no window/sidebar/rail/composer under the banner; lowest window stays
                # in-viewport). Forced shown here so it's measured at every viewport tier.
                audit_banner(page, vp_name, w, h)

                # J5-19: the endgame mobile sweep — only the phone tiers, only when a finished/endgame
                # season was actually reached. The endgame decision card (live finale) and the
                # post-season retro never co-exist in a real game, so each is mounted + measured in
                # ISOLATION by the SAME overflow/overlap/tap/crowding sweep — covering endgame UX that
                # was previously asserted by source-string tests only, never a viewport render.
                if (finished or endgame_pending) and vp_name in ("phone-390", "tiny-320"):
                    if mount_endgame_card(page, endgame_pending):
                        # On a finished season the retro panel may already be self-visible from its
                        # own background poll; hide it for THIS pass so the live-card layout is
                        # measured alone (the two are never simultaneous in a real game).
                        page.evaluate("(document.getElementById('orwell-retro')||{}).style&&(document.getElementById('orwell-retro').style.display='none')")
                        audit_page(page, vp_name + "+endgame-card", w, h, coarse, with_game)
                        remove_endgame_card(page)
                    if mount_retro(page):
                        audit_page(page, vp_name + "+retro", w, h, coarse, with_game)

                # G6: the settings tab rail keeps its LEFT orientation in any
                # modal wider than the 480 token (explicit user preference);
                # top-bar stacking is the last resort below it. #553: Settings is
                # now a kit OrwellWindow built lazily on first open — so #settings-modal
                # does NOT exist until opened. Open it for real (the gear fires
                # settings.js open(); a programmatic .click() works regardless of the
                # gear's own visibility), measure, then close via the kit ×.
                page.evaluate(
                    "(document.getElementById('user-bar-settings') ||"
                    " document.getElementById('tool-settings-btn') ||"
                    " document.getElementById('rail-settings') || {click(){}}).click()")
                page.wait_for_timeout(350)  # let the kit window mount + the open fade settle
                rail = page.evaluate("""
                  (() => {
                    const overlay = document.querySelector('#settings-modal');
                    if (!overlay) return null;
                    const m = overlay.querySelector('.settings-modal-content');
                    const r = overlay.querySelector('.settings-sidebar');
                    const p = overlay.querySelector('.settings-panels');
                    let out = null;
                    if (m && r && p) {
                      const rb = r.getBoundingClientRect(), pb = p.getBoundingClientRect();
                      out = { modalW: m.getBoundingClientRect().width,
                              left: rb.x < pb.x && rb.height > rb.width };
                    }
                    return out;
                  })()
                """)
                page.evaluate(
                    "(document.querySelector('#settings-modal .ow-close') || {click(){}}).click()")
                page.wait_for_timeout(250)  # let the close fly-away finish + the node teardown
                if rail is None:
                    report("fail", f"{vp_name} settings-rail: modal nodes missing")
                elif rail["modalW"] > 480 and not rail["left"]:
                    report("fail", f"{vp_name} settings-rail: stacked at a {rail['modalW']:.0f}px modal "
                                   "(G6 — the LEFT rail must survive above the 480 token)")
                elif rail["modalW"] <= 480 and rail["left"]:
                    report("fail", f"{vp_name} settings-rail: not stacked below the 480 token ({rail['modalW']:.0f}px)")
                else:
                    report("pass", f"{vp_name} settings-rail ({'left' if rail['left'] else 'stacked'} @ {rail['modalW']:.0f}px)")

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
