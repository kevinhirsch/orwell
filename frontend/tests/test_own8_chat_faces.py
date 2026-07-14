"""OWN-8 — chat-transcript sender faces (owner-reported: message avatars showed initials/no
face while the real portraits existed).

Three seams, one shared kit:

  1. `orwellChatFaces.js` — every rendered chat row in the GAME build carries a small designed
     face beside its role label: the player's REAL headshot on user rows, the houseguest's
     roster portrait on NPC-voiced rows, and the kit monogram seeded by the Production name on
     narrator rows. ONE MutationObserver seam on #chat-history covers history / live / resume /
     mirror (chat.js's `_setRoleModelLabel` wipes .role children on relabel, so build-time
     insertion could not survive live anyway). Non-game build: byte-identical (hard-gated on
     body[data-game-build], CSS scoped the same way — the M2-7 pattern).

  2. The M3-2 speaker chips (markdown.js `_speakerChipHtml`) — previously portrait-STARVED
     (monogram always): now portrait-FIRST from the kit's shared roster cache (#1324), designed
     monogram as the no-photo fallback only.

  3. The kit (orwellMonogram.js) — the shared cache keeps the WHOLE public card (name/isPlayer
     joined portrait/status), exposes cardFor()/playerCard(), defines the long-dangling
     `window.orwellResolveHouseguestId` seam markdown.js already probed, and owns the tight
     face-weighted small-avatar crop (`ow-mono-crop`, photos only).

Node batteries drive the PURE pieces headless (no DOM): the chip HTML builder with a stubbed
kit cache (portrait hit → <img>; miss → monogram svg), and the chat-face descriptor resolver
(player/NPC/Production × portrait-vs-fallback).
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess

import pytest

FE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_NODE = shutil.which("node")

FACES = "static/js/orwellChatFaces.js"
KIT = "static/js/orwellMonogram.js"
MD = "static/js/markdown.js"
AVATAR = "static/js/orwellAvatar.js"


def _read(rel: str) -> str:
    with open(os.path.join(FE, rel), encoding="utf-8") as fh:
        return fh.read()


# ── wiring: the consumer exists, loads after its deps, and is game-build-gated ───────────── #

def test_chat_faces_file_exists_and_is_included_after_its_deps():
    html = _read("static/index.html")
    assert "orwellChatFaces.js" in html
    assert html.index("orwellMonogram.js") < html.index("orwellChatFaces.js")
    assert html.index("orwellAvatar.js") < html.index("orwellChatFaces.js")


def test_chat_faces_gate_on_the_game_build_and_scope_their_css():
    js = _read(FACES)
    # the M2-7 pattern: behavior AND styling both hard-gated on the game surface
    assert 'hasAttribute("data-game-build")' in js
    assert js.count("body[data-game-build]") >= 3, "injected CSS must be game-build-scoped"
    # the decoration pipeline bails outside the game build (observer flush + sweep)
    assert "if (!gameBuild()) return;" in js


def test_chat_faces_listen_only_never_dispatch_never_poll_never_fetch():
    js = _read(FACES)
    # g15: LISTENER only — the one dispatcher stays platform.js's
    assert re.search(r"addEventListener\(\s*['\"]orwell:gamechanged['\"]", js)
    assert "new CustomEvent(" not in js, "chat faces must never dispatch gamechanged"
    assert "setInterval(" not in js, "no new poll — one-shot settle timers only"
    assert "fetch(" not in js, "render-only: all data comes from the kit cache / OrwellAvatar"


def test_chat_faces_are_decorative_and_never_the_tap_target():
    js = _read(FACES)
    assert 'setAttribute("aria-hidden", "true")' in js
    assert "pointer-events: none" in js
    # sized with the kit's small-chip family (~22-28px, rounded like .odec-face)
    m = re.search(r"\.ow-chatface \{[^}]*width:\s*(\d+)px", js)
    assert m and 22 <= int(m.group(1)) <= 28


def test_chat_faces_cover_the_role_relabel_wipe():
    """chat.js's _setRoleModelLabel rebuilds .role's children on live relabel — the observer
    must treat a .role childList mutation as a re-decorate trigger, and the idempotence check
    must verify the face is STILL PRESENT (the dataset survives the wipe; the face does not)."""
    js = _read(FACES)
    assert 'classList.contains("role")' in js
    assert 'roleEl.querySelector(".ow-chatface")' in js


# ── the kit: shared cache carries full cards; crop is the kit's, not a fork ──────────────── #

def test_kit_cache_exposes_full_cards_player_card_and_the_resolver_seam():
    js = _read(KIT)
    assert "function cardFor(" in js and "function playerCard(" in js
    assert "cardFor," in js and "playerCard," in js  # exported on window.OrwellMonogram
    # the M3-2 seam markdown.js always probed but nothing defined — the kit owns it now
    assert "window.orwellResolveHouseguestId" in js
    # the cache keeps name/isPlayer beside portrait/status (still the public roster card only)
    assert "isPlayer: !!hg.isPlayer" in js


def test_kit_owns_the_small_avatar_face_crop():
    js = _read(KIT)
    assert ".ow-mono-face.ow-mono-crop img" in js, "the tight crop is the KIT's, one place"
    assert 'if (opts.crop) el.className += " ow-mono-crop";' in js
    # photos only — the monogram tile is already composed for tiny sizes
    m = re.search(r"\.ow-mono-face\.ow-mono-crop img \{[^}]*\}", js)
    assert m and "svg" not in m.group(0)


# ── the speaker chips: portrait-FIRST from the shared cache ──────────────────────────────── #

def test_speaker_chips_consult_the_shared_portrait_cache():
    js = _read(MD)
    fn = js[js.index("function _speakerChipHtml"):]
    fn = fn[: fn.index("\n}\n") + 2]
    assert "portraitFor" in fn, "the chip must resolve a real portrait before the monogram"
    assert "ow-mono-crop" in fn, "chip photos take the kit's small-avatar crop"
    assert "ow-mono-evicted" in fn, "evicted keeps the L16 grayscale rule on the chip too"


@pytest.mark.skipif(_NODE is None, reason="node not available")
def test_chip_renders_portrait_img_on_cache_hit_and_monogram_on_miss():
    """Drive _speakerChipHtml headless with a stubbed kit: a cache HIT must render the portrait
    <img> (crop class on), a MISS must render the designed monogram svg — and the outer chip
    markup (class/id/name attributes) is identical either way."""
    program = r"""
    const fs = require('fs');
    const src = fs.readFileSync(process.argv[1], 'utf8');
    function grabFn(marker) {
      let fn = src.slice(src.indexOf(marker));
      fn = fn.slice(0, fn.indexOf('\n}\n') + 2).replace('export function', 'function');
      return fn;
    }
    const escapeHtml = "function escapeHtml(s){return String(s==null?'':s)"
      + ".replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')"
      + ".replace(/\"/g,'&quot;').replace(/'/g,'&#39;');}";
    const body = [
      escapeHtml,
      grabFn('function _speakerInitials'),
      grabFn('function _resolveSpeakerSeed'),
      grabFn('function ensureSpeakerCss'),
      grabFn('function _speakerChipHtml'),
    ].join('\n');
    // A window whose kit cache KNOWS npc:8 (portrait) and npc:3 (no portrait, evicted).
    const mkWindow = () => ({
      OrwellMonogram: {
        ensureCss: () => {},
        svg: (card) => '<svg class="ow-mono-svg" data-seed="' + card.id + '"></svg>',
        portraitFor: (id) => (
          String(id) === 'npc:8' ? { portrait: '/api/orwell/portrait/npc%3A8', status: 'active' }
          : String(id) === 'npc:3' ? { portrait: null, status: 'active' }
          : String(id) === 'npc:5' ? { portrait: '/api/orwell/portrait/npc%3A5', status: 'evicted' }
          : null),
      },
      orwellResolveHouseguestId: (name) => (name === 'Deja Monroe' ? 'npc:8' : null),
    });
    const fn = new Function('window', body + '\nreturn _speakerChipHtml;');
    const out = {};
    const chip = fn(mkWindow());
    out.hitById = chip('npc:8', 'Deja Monroe');
    out.hitByName = chip(null, 'Deja Monroe');       // resolver maps the name to npc:8
    out.missKnown = chip('npc:3', 'Faith Willis');   // in the roster, no photo yet
    out.missUnknown = chip(null, 'Someone Else');    // not in the roster at all
    out.evicted = chip('npc:5', 'Gone Girl');
    // headless (no window): the initials fallback, never a throw
    const headless = new Function(body + '\nreturn _speakerChipHtml;')();
    out.headless = headless(null, 'Faith Willis');
    process.stdout.write(JSON.stringify(out));
    """
    md_path = os.path.join(FE, MD)
    res = subprocess.run([_NODE, "-e", program, "--", md_path],
                         capture_output=True, text=True, timeout=60)
    assert res.returncode == 0, f"node failed: {res.stderr}"
    r = json.loads(res.stdout)

    # cache hit (by id AND by resolved name): the REAL portrait, cropped, no monogram
    for key in ("hitById", "hitByName"):
        chip = r[key]
        assert '<img src="/api/orwell/portrait/npc%3A8"' in chip, key
        assert "ow-mono-crop" in chip, key
        assert "ow-mono-svg" not in chip, f"{key}: portrait is PRIMARY — no monogram on a hit"
        assert 'class="ow-speaker-chip"' in chip, key
    # cache miss: the designed monogram fallback, no phantom img
    for key in ("missKnown", "missUnknown", "headless"):
        assert "<img" not in r[key], key
    assert 'data-seed="npc:3"' in r["missKnown"]  # roster id still seeds the tile (hue match)
    assert "ow-mono-svg" in r["missKnown"] and "ow-mono-svg" in r["missUnknown"]
    assert "ow-speaker-chip-ini" in r["headless"]  # kit absent → initials tile, never a blank
    # evicted photo keeps the L16 grayscale class
    assert "ow-mono-evicted" in r["evicted"] and "<img" in r["evicted"]


# ── the chat-face resolver: player / NPC / Production × portrait-vs-fallback ─────────────── #

@pytest.mark.skipif(_NODE is None, reason="node not available")
def test_face_resolver_player_npc_production_portrait_first():
    program = r"""
    const fs = require('fs');
    const src = fs.readFileSync(process.argv[1], 'utf8');
    let fn = src.slice(src.indexOf('function resolveFaceDescriptor'));
    fn = fn.slice(0, fn.indexOf('\n  }\n') + 5);
    const resolve = new Function(fn + '\nreturn resolveFaceDescriptor;')();
    const roster = {
      'npc:2': { id: 'npc:2', name: 'Maya Velez', status: 'active', portrait: '/api/orwell/portrait/npc%3A2' },
      'npc:4': { id: 'npc:4', name: 'Cole Danner', status: 'active', portrait: null },
      'player': { id: 'player', name: 'Riley Park', status: 'active', portrait: '/api/orwell/portrait/player', isPlayer: true },
    };
    const byName = {}; for (const k of Object.keys(roster)) byName[roster[k].name.toLowerCase()] = roster[k];
    const deps = (over) => Object.assign({
      narrator: () => 'Production',
      playerCard: () => roster['player'],
      cardFor: (ref) => roster[String(ref)] || byName[String(ref).toLowerCase()] || null,
      avatarPresent: () => false,
      playerName: () => 'Riley Park',
    }, over || {});
    const out = {};
    out.userWithHeadshot = resolve('user', 'You', deps());
    out.userAvatarOnly = resolve('user', 'You', deps({
      playerCard: () => null, avatarPresent: () => true }));
    out.userNothing = resolve('user', 'You', deps({
      playerCard: () => null, playerName: () => null }));
    out.npcWithPortrait = resolve('ai', 'Maya Velez', deps());
    out.npcNoPortrait = resolve('ai', 'Cole Danner', deps());
    out.production = resolve('ai', 'Production', deps());
    out.productionSuffixed = resolve('ai', 'Production (Research)', deps());
    out.unknownVoice = resolve('ai', 'Mystery Guest', deps());
    out.unlabeled = resolve('ai', '', deps());
    process.stdout.write(JSON.stringify(out));
    """
    faces_path = os.path.join(FE, FACES)
    res = subprocess.run([_NODE, "-e", program, "--", faces_path],
                         capture_output=True, text=True, timeout=60)
    assert res.returncode == 0, f"node failed: {res.stderr}"
    r = json.loads(res.stdout)

    # player rows: the REAL casting headshot when one exists (portraits are primary)
    u = r["userWithHeadshot"]
    assert u["card"]["portrait"] == "/api/orwell/portrait/player"
    assert u["crop"] is True and u["forceMono"] is False
    # pre-season: the finalized account avatar backstops the roster card
    ua = r["userAvatarOnly"]
    # The avatar url carries the avatarchanged generation (?v=N) so a REPLACED photo mints a
    # fresh sig + fetch — the headless driver has no listener wired, so the gen reads 0.
    assert ua["card"]["portrait"] == "/api/orwell/avatar?v=0" and ua["crop"] is True
    # nothing on file: the designed monogram fallback (no phantom photo)
    un = r["userNothing"]
    assert un["card"]["portrait"] is None and un["crop"] is False

    # NPC rows: roster portrait when the cache has one; monogram (same roster id seed) otherwise
    n = r["npcWithPortrait"]
    assert n["card"]["portrait"] == "/api/orwell/portrait/npc%3A2" and n["crop"] is True
    nn = r["npcNoPortrait"]
    assert nn["card"]["portrait"] is None and nn["card"]["id"] == "npc:4" and nn["crop"] is False

    # Production rows: the designed kit monogram seeded by the Production name — never a photo
    for key in ("production", "productionSuffixed"):
        p = r[key]
        assert p["forceMono"] is True and p["card"]["name"] == "Production", key
    # unknown attribution still gets a designed tile; an unlabeled row defers (no face yet)
    assert r["unknownVoice"]["forceMono"] is True
    assert r["unlabeled"] is None


# ── the avatar probe is shared, not duplicated ───────────────────────────────────────────── #

def test_avatar_module_exposes_its_probe_verdict():
    js = _read(AVATAR)
    assert "present: function () { return _present; }" in js
    assert "_present = present;" in js
