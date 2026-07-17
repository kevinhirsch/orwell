# Lane: Apple Genius Pixel-Parity Review

> Source digest: `apple-genius-parity-2026-07-16.md` (banked lane-report digest, 2026-07-16 campaign;
> the digest notes "full report in conversation" — 77 screenshots banked in
> `scratchpad/shots/parity/` at capture time, not preserved in this compendium).
> Lens: Apple-HIG pixel-parity review measured on rendered pixels, not source.

---

METHOD: real FE + engine, deterministic fake model streaming real bubbles, live season seed 51000 driven
to a real comp-round pending; contrast measured on RENDERED pixels. Stack died mid-run (the 3h API gap)
after 77 shots — 5 passes lost, marked UNCAPTURED.

G-VERDICTS: G-4 FIXED (#1668 verified in render, hint 10.39:1) · G-9 FIXED (kit chrome everywhere, no
second window family) · G-10 PASS (one glass plane) · G-11 confirmed-by-design (mobile clamps to
Frosted) · G-3 not-reproducible steady-state (residual: boot dark-ink flash + heavy halo) · G-12 code
ships 0.22, docs say 0.36 — DOC DRIFT (fix docs, keep code) · G-1 HALF-FIXED: `.msg-ai` inherits ink
(9.34:1, #1644) but `.msg-user` bold houseguest names = TEAL ON BLUE FILL 2.18:1 — CONFIRMED-OPEN BLOCK
· G-2 CONFIRMED-OPEN BLOCK: selected theme pill white-on-grey 1.55:1, inactive reads MORE selected
(inverted affordance; flat tier is correct — frosted styling is the bug) · G-7 CONFIRMED-OPEN: settings
inactive tabs 2.50:1 · G-5/G-6/G-8: render lost, source-read suggests fine (admin ops page is dark and
AA-clean in source) — re-capture owed.

NEW: send-btn `title="Attach a file"` vs `aria-label="New chat"` mismatch · frosted mobile sheet mounts
with INVISIBLE BODY ≥1.2s (content-ready gating missing; needs live repro) · 2-light titlebar cluster
vs macOS 3-light · four blue-tinted elements at once with Settings open (tint-economy warning) ·
permanently-light glass over dark chat = owner-ruled "ONE LIGHT GLASS" acknowledged divergence, not a
defect.

DEFERRED-STILL-OPEN: refraction-over-busy-photo hero judgment (lost with stack; mesh wallpaper too
smooth to bend). Specular = hairline PASS. Flat-mobile holds. A11y trio source-verified only.

FIX LIST (ranked): 1 [BLOCK] seg pill → white knob + dark label (one rule, kit class) · 2 [BLOCK] extend
#1644 `color:inherit` to `.msg-user` emphasis · 3 [POLISH] settings nav muted ink ≥4.5:1 (≈#5b6572 on
#f9f9fa) · 4 [POLISH] send-btn title/aria (`chat.js` — DEFERRED, file owned by responding-status agent)
· 5 [POLISH] rail-head halo → thin 0-1px text-shadow floor · 6 [POLISH] sheet mount blank (needs repro
first) · 7 [NIT] 3-light cluster greyed-inert (`orwellWindow.js`) · 8 [NIT] docs 0.36→0.22 reconcile.

OWED RE-CAPTURES: admin status render, the-feed render, a11y trio renders, "Irreversible" badge,
photo-wallpaper refraction hero.

BEST SHOTS: `probe_after_chat.png` (G-1 both halves in one frame) · `d-glass_themewin_seg.png` (G-2) ·
`d-glass_decision(_selected).png` (G-4 fixed) · `d-glass_settings_nav.png` (G-7) ·
`d-glass_settings_titlebar_hover.png` (traffic lights) · `m-flat_themewin_sheet.png` (sheets done
right).
