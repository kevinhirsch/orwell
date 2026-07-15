# 1638 — `.ow-pw-reveal` kit treatment (G3)

> 📐 **Build-ready design spec** · 2026-07-15 · for **Workflow 2** of the #1638 total-kit migration.
> Closes the **G3** password-reveal ACCEPTED-GAP row in the
> [total-kit inventory](../audits/2026-07-15-total-kit-migration-inventory.md) §10 / §7.
> **DOC-ONLY** — no source edits ride with this spec.

## 1. What this treatment is

A **password reveal** is the eye toggle that sits inside a secret field and flips its `<input>` between
`type="password"` and `type="text"`. It is not a standalone control — it is a *treatment applied to an
`.ow-field`/`.ow-input`* (an in-field trailing button). `.ow-pw-reveal` standardizes the toggle look,
the eye-open / eye-closed glyph pair, and the accessibility contract, so every secret field across
tiers reveals identically instead of one page implementing it and the rest of the app having no reveal
at all.

**The state of the world today:** the reveal exists in **exactly one place** — the login/auth page
(`login.html` `.pw-toggle`). Every in-app secret field (search API key, admin password, LLM endpoint
API key, …) is a bare `type="password"` with **no reveal at all**. So G3 is two jobs: (1) lift the
login toggle into a kit treatment, and (2) let the in-app secret fields *adopt* it so a user can verify
a pasted API key.

## 2. Consumer inventory (file:line + current markup/CSS)

### G3a — Login/auth page (the only current implementation) — `login.html`

| Concern | file:line | Current |
|---|---|---|
| Wrapper | `:443,:457` | `.pw-wrapper` (relative; `input { padding-right: 2.5rem }`) |
| Toggle button | `:445-447`, `:459-461` | `<button type="button" class="pw-toggle" tabindex="-1" aria-label="Show password"><svg…eye…></button>` |
| Toggle CSS | `:326-336` | `.pw-toggle { position:absolute; right:8px; top:50%; transform:translateY(calc(-50% + 1px)); background:none; border:none; padding:4px; cursor:pointer; color: color-mix(--ink 55%) }`; `:hover { color: --ink }` |
| Native-glyph suppression | `:321-325` | `.pw-wrapper input::-ms-reveal, ::-ms-clear { display:none }` (kills Edge's duplicate reveal) |
| Toggle JS | `:731-749` (`wireToggle`) | flips `inp.type`, swaps `innerHTML` eye-open↔eye-closed, updates `aria-label` "Show"↔"Hide password", refocuses input |
| Mobile focus-keep | `:752-757` | `.pw-toggle` `touchstart preventDefault` so tapping the eye doesn't dismiss the keyboard |
| Eye glyphs | `:732-733` | `eyeOpen` (circle iris) / `eyeClosed` (slashed) 24×24 stroke SVGs |

**Accessibility gaps in the current implementation** (fix them as the treatment is canonicalized):
- `tabindex="-1"` — the toggle is **removed from the tab order**, so a keyboard-only user cannot
  reveal the password. (Deliberate on login to keep tab flow password→submit, but questionable as an
  a11y default — see owner decision.)
- Uses `aria-label` swap ("Show"/"Hide") but **no `aria-pressed`** — the toggle's on/off state is not
  exposed as a toggle-button state to AT.

### G3b — In-app secret fields with NO reveal today (adoption targets) — **IN SCOPE**

Game-build-reachable secret fields (settings + accounts are keep-set), each a bare `type="password"`
with no toggle:

| Field | file:line | Panel / reachability |
|---|---|---|
| Web-search API key | `index.html:2069` (`#set-searchApiKey`, `class="settings-select"`) | Settings › search — **IN SCOPE** (search is keep-set) |
| Admin — new-user password | `index.html:2383` (`#adm-newPassword`) | Admin › accounts — IN SCOPE (admin-gated) |
| Admin — endpoint API key | `index.html:2476` (`#adm-epApiKey`) | Admin › model endpoint — IN SCOPE (admin-gated) |
| Endpoint API key | `settings.js:4245` (`#uf-api-key`) | Settings › connections endpoint form — IN SCOPE |
| Generic env/secret fields | `admin.js:1870` | Admin env editor: `type = …includes('secret'\|'token'\|'key'\|'password') ? 'password' : 'text'` — IN SCOPE (admin) |

### G3c — Secret fields on GAME-DROPPED panels — **OUT OF SCOPE** (documented only)

`settings.js` IMAP/SMTP passwords (`:3461,:3469,:4790,:4798`), CalDAV/CardDAV (`:4381,:4485`), vault
master password (`:5183`) — all ride `email`/`calendar`/`contacts`/`vault` ∈ `GAME_DROP_SET`. Not
served in the game build; adopt only if the full inherited workspace becomes a target.

> **Note:** `.settings-select` is (mis)used as the class on `#set-searchApiKey` even though it's an
> `<input>`, not a `<select>` — the §5b inventory already excludes it from the select-migration count.
> Under W6 that input goes to `.ow-input`; G3 then wraps it in `.ow-pw-field` and adds the reveal.

## 3. Proposed markup + CSS contract

### 3.1 Structure — a treatment on the field, not a new control

```html
<div class="ow-pw-field">
  <input type="password" class="ow-input" id="…" autocomplete="current-password">
  <button type="button" class="ow-pw-reveal" aria-pressed="false" aria-label="Show password">
    <svg class="ow-pw-eye" …>…</svg>       <!-- eye-open / eye-closed swapped by JS or CSS state -->
  </button>
</div>
```

- `.ow-pw-field` — the relative wrapper (owns `position:relative` + the trailing padding-reservation on
  its `.ow-input`), the kit successor to `.pw-wrapper`.
- `.ow-pw-reveal` — the in-field trailing toggle button.
- `.ow-pw-eye` — the glyph slot; the open/closed glyph is swapped by the shared helper (below) or via
  a `[aria-pressed="true"]` CSS state that shows/hides two stacked SVGs.

### 3.2 Selectors, tokens, states

| Selector | Role | Declarations |
|---|---|---|
| `.ow-pw-field` | wrapper | `position:relative; display:block` |
| `.ow-pw-field > .ow-input` | field | `padding-inline-end: var(--ow-pw-inset, 2.5rem)` (reserve room for the eye) |
| `.ow-pw-reveal` | toggle | `position:absolute; inset-inline-end: 6px; top:50%; transform:translateY(-50%); display:inline-flex; align-items:center; justify-content:center; background:none; border:none; padding:4px; cursor:pointer; color: var(--ow-control-ink-muted, color-mix(in srgb, var(--fg) 55%, transparent))` |
| `.ow-pw-reveal:hover` | hover | `color: var(--fg)` |
| `.ow-pw-reveal:focus-visible` | focus | `outline: 2px solid var(--ow-focus-ring, var(--ow-ios-blue)); outline-offset: 1px; border-radius: var(--ow-radius-inner)` |
| `.ow-pw-reveal[aria-pressed="true"]` | revealed | shows eye-open glyph (or CSS toggles the stacked SVGs) |
| `.ow-pw-reveal svg` | glyph | `display:block; width:18px; height:18px` |
| `.ow-pw-field .ow-input::-ms-reveal`, `::-ms-clear` | native suppression | `display:none` (kill Edge's duplicate reveal — the `.ow-pw-reveal` is the single affordance) |

**Glyphs** — reuse the login SVG pair verbatim (eye-open = iris circle; eye-closed = slashed) so the
whole product uses one eye. Expose them from a shared helper (see §3.4) rather than re-inlining.

### 3.3 Two-tier + a11y (mandatory)

- **Frosted / Flat:** the reveal is a borderless glyph over the field's own surface, so tier divergence
  is only its ink: frosted uses the neutral `--ow-control-ink-muted`; flat uses `color-mix(--fg …)`.
  Author both in the ELEMENT KIT region beside `.ow-field`.
- **a11y trio:** reduced-motion drops any glyph transition; contrast raises the rest-state ink from
  55%→~80% and thickens the focus ring; reduced-transparency is a no-op (already opaque ink).
- **The a11y contract (fixes the login gaps):**
  - **`aria-pressed`** reflects revealed state (`false` = masked, `true` = shown) — a proper toggle
    button, not just an `aria-label` swap.
  - **`aria-label`** swaps "Show password" ↔ "Hide password" in lockstep with `aria-pressed`.
  - **Keyboard reachable** — `.ow-pw-reveal` is a real `<button>` and, as the kit default, is **in the
    tab order** (no `tabindex="-1"`). Login may keep `tabindex="-1"` as a per-site override if the
    owner wants password→submit tab flow (see decision), but the kit default must be focusable so
    keyboard-only users on the API-key fields can reveal.
  - **Tap target** — the 44px coarse-pointer floor: on `@media (pointer: coarse)` grow the
    `.ow-pw-reveal` hit area to `min-width/height: var(--tap-min, 44px)` (an invisible `::after`
    expander so the visible glyph stays compact), reserving a wider `--ow-pw-inset` on touch.

### 3.4 The shared toggle helper (JS)

Provide one tiny idempotent helper so every consumer wires identically instead of copying
`login.html`'s `wireToggle`:

```js
window.OrwellPwReveal = {
  // wrap an existing .ow-input in .ow-pw-field + trailing .ow-pw-reveal, wired.
  attach(inputEl) { /* build wrapper, insert button, bind click → flip type,
                       toggle aria-pressed, swap aria-label + glyph, refocus input */ }
};
```

Login keeps its inline `wireToggle` (it predates the app bundle and ships on a separate page), but its
CSS + markup adopt `.ow-pw-field`/`.ow-pw-reveal`/`aria-pressed`. In-app fields call
`OrwellPwReveal.attach(...)` after render.

## 4. Migration mapping per consumer

### G3a — Login (`login.html`)

| Current | → Target |
|---|---|
| `.pw-wrapper` | `.ow-pw-field` (keep `.pw-wrapper` dual-class if any selector depends on it) |
| `.pw-toggle` | `.ow-pw-reveal` |
| CSS `:321-336` | delete; inherit the kit treatment (the login page already links `style.css`) |
| `wireToggle` JS | keep, **add `aria-pressed` toggling** alongside the `aria-label` swap and glyph swap |
| `tabindex="-1"` | owner decision (§6) — keep as a login-only override, or drop to match the focusable kit default |

### G3b — In-app secret fields (adoption)

For each in-scope field: after it becomes `.ow-input` (W6 lands `#set-searchApiKey`; the others may
already be plain inputs), call `OrwellPwReveal.attach(el)` (or hand-author the `.ow-pw-field` wrapper).
Net markup delta per field: wrap in `.ow-pw-field` + add the `.ow-pw-reveal` button. No change to the
input's id / name / handler / submit payload.

- `#set-searchApiKey` (`index.html:2069`) — Settings search key.
- `#adm-newPassword` (`index.html:2383`), `#adm-epApiKey` (`index.html:2476`) — admin forms.
- `#uf-api-key` (`settings.js:4245`) — endpoint form.
- `admin.js:1870` env editor — attach when the field is created as `type="password"`.

## 5. Test plan (`frontend/tests/test_1638_pw_reveal_kit.py`)

Source-pinned, mirroring `test_1638_compact_icon_kit.py`.

1. **`test_pw_reveal_primitive_exists`** — `.ow-pw-field` and `.ow-pw-reveal` are authored in the
   ELEMENT KIT region; `.ow-pw-field > .ow-input` reserves trailing inset (`padding-inline-end`), and
   `.ow-pw-reveal` is `position:absolute` trailing-anchored, borderless, `cursor:pointer`.
2. **`test_reveal_a11y_contract`** — the treatment is documented/authored to carry `aria-pressed`
   (assert the demo markup + `OrwellPwReveal.attach` set/toggle `aria-pressed`) and swap the
   `aria-label` Show↔Hide.
3. **`test_reveal_is_keyboard_reachable_by_default`** — the kit `.ow-pw-reveal` in the demo (and the
   `attach` helper) does **not** set `tabindex="-1"` (the kit default is focusable); login may keep the
   override, pinned separately.
4. **`test_focus_is_system_blue`** — `.ow-pw-reveal:focus-visible` uses `--ow-focus-ring`/`--ow-ios-blue`.
5. **`test_native_reveal_suppressed`** — the treatment includes `::-ms-reveal`/`::-ms-clear`
   `display:none` (so Edge's duplicate glyph never appears beside the kit eye).
6. **`test_no_accent_hue_on_glyph`** — the reveal ink uses `--fg`/control-ink tokens, never
   `--accent`/`--ow-accent` (the kit "no accent on chrome" contract).
7. **`test_coarse_pointer_tap_floor`** — `.ow-pw-reveal` `@media (pointer:coarse)` reaches
   `var(--tap-min, 44px)`.
8. **`test_two_tier_authored`** — a frosted-scoped and a flat-tier `.ow-pw-reveal` ink rule exist.
9. **`test_honors_a11y_trio`** — reduced-motion / contrast branches present for the treatment.
10. **`test_shared_helper_exists`** — `OrwellPwReveal.attach` is defined (source pin) and is loaded in
    `index.html` (so in-app fields can adopt it).
11. **Adoption pins (per landed field):** `#set-searchApiKey` / `#adm-epApiKey` / `#uf-api-key` markup
    (or their render sites) are wrapped in `.ow-pw-field` and carry a `.ow-pw-reveal`.
12. **`test_login_adopts_the_treatment`** — `login.html` uses `.ow-pw-field`/`.ow-pw-reveal` and its
    `wireToggle` now toggles `aria-pressed`; the standalone `.pw-toggle { position:absolute … }` CSS
    block is gone (moved to the kit).
13. **`test_demo_and_docs_reference_the_treatment`** — `element_kit_demo.html` shows a masked +
    revealed `.ow-pw-field`; `ELEMENT_KIT.md` documents it.

## 6. Owner decisions needed

1. **Focus order on login (`tabindex="-1"`).** The login toggle is intentionally out of the tab order
   (keeps tab flow password→submit). The kit **default must be focusable** (keyboard users on the
   API-key fields need it). **Decision:** keep `tabindex="-1"` as a *login-only* per-site override
   (recommended — preserves the sign-in flow while the app default is accessible), or drop it
   everywhere for a uniform focusable reveal. This spec assumes the former.
2. **Reveal on secret *API-key* fields — desired, but confirm the security posture.** Showing a pasted
   API key in plaintext is standard and helpful (verify a paste), but it is a secret on screen.
   **Decision:** enable `.ow-pw-reveal` on the search/endpoint API-key fields (recommended — they're
   user-entered credentials the user already holds), or restrict the reveal to *account passwords*
   only. No Vault/engine implication either way (these are FE-entered provider creds, never Vault
   state).
3. **Adopt-everywhere vs login-only for this lane.** Minimum to close G3 is lifting login into the kit.
   The *value* is the in-app fields gaining a reveal they never had. **Decision:** scope W-G3 to
   (a) login migration + (b) the ~4 in-scope in-app fields (recommended), or (a) only and file the
   in-app adoption as a follow-up.

---

## OWNER RULING (2026-07-15)

**Reveal stays "as is" — do NOT expand the eye-toggle to API-key / secret fields.** Workflow-2 scope for this primitive is ONLY to standardize the EXISTING `login.html` toggle onto `.ow-pw-field` / `OrwellPwReveal` (folding in the `tabindex`/`aria-pressed` a11y fixes). The in-app secret inputs (search API key, endpoint API key, admin env) KEEP their current bare `type=password` with no reveal — no behavior change.
