# Orwell Live-Verify Debug Export — PR #1007 & PR #1009

**Date:** 2026-06-26 · **Engine narrator:** `deepseek/deepseek-v4-pro` (OpenRouter, endpoint `a51291f7`)
**FE:** `http://127.0.0.1:7000` · **User:** `verif1` (header `x-orwell-user: verif1`) · `AUTH_ENABLED=false`
**Game session (canonical):** `a1514983-a3a8-4bcc-a94c-52e1f2ce4a61`
**Source logs:** `scratchpad/fe.log` (FastAPI), `scratchpad/engine.log` (1 line — engine is near-silent),
driver logs `scratchpad/cast.log`, `scratchpad/sendbtn.log`, `scratchpad/peerlabel.log`.
**Screenshots:** `scratchpad/shots/` (`c-*`, `sb-*`, `pl-B-*`, `v2-*`, `00/01-*`).

> Standalone reading guide: this file captures (A) the casting interview turn-by-turn, (B) the
> cast-authoring per-NPC log + headline, (C) the #1009 send-button matrix, (D) the peer-tab label,
> (E) supporting FE-log excerpts, then (F) the mined additional findings. Verdicts are at the end of E.

---

## A. Casting interview — turn by turn (live deepseek, user verif1)

Entry was via the setup wizard `[data-ob-setup-start]` ("Start casting"), which fired the producers'
opener. The casting persona named **itself "Grant"** (the framing does not hard-code a name).
After EACH turn the engine intake was read (`GET /api/orwell/state`): `started` stayed **false**,
`moment` stayed **`character-creation`**, **`casting.known` stayed `{}`** the entire time, and
`playerName` stayed in `missing`. Screenshots: `c-00-load.png` (setup wizard), `c-01-afterstart.png`
(interview opened), `c-turn4.png`, `c-turn5.png`, `c-final.png`.

| # | Time | Player sent (driver) | GM reply body (player-visible) | engine after |
|---|------|----------------------|-------------------------------|--------------|
| opener | 20:33 | *(Start casting kickoff)* | "Alright, let's get this rolling. I'm **Grant** — I run casting… First thing: tap that **Choose Your Character** button that just popped up below. It opens your cast photo…" | started=false, known={} |
| 1 | 20:34 | "Hi! I'm **Riley Carter**, 32, a competitive trivia host from Denver. I play a sharp, social-strategic game and I'm here to win." | "Good — if it uploaded, it'll process. Either way, we can move. But pump the brakes on starting the season. Right now I've got an **empty file on you. No name, no nothing** — and I don't cast ghosts." | started=false, **known={}** |
| 2 | 20:35 | "My headshot is already on file. I'm ready — let's start the season and get me into the house." | "**And the engine agrees with me** — your file is empty. No name, no interview, nothing. I can't start a season on a blank casting card." | started=false, known={} |
| 3 | 20:37 | "Yes, 100% ready. Start the game now and move me into the Big Brother house." | "You keep saying that, and I keep looking at an empty file. … No name, no keycard." / (next) "I literally cannot start the season without your name on file. **The system won't let me.** You've asked me to start four times now…" | started=false, known={} |
| 4 | 20:39–41 | "Begin the premiere — let's go!" | "**Let me drop the producer persona for a second** and be completely straight with you. **The engine just blocked me.** It won't start the season without a name on file… There's no override, no **skip button**, no way around it." | started=false, known={} |
| 5 | 20:41–44 | "I'm ready. Start the season." | "Type your name. Even just a first name. One word…" / "**Name.**" (a 5-char GM turn) / "Let me try something.\n\n**Your name:**" | started=false, known={} |

Tool activity during casting (from `fe.log`):
```
20:35:05  -> converted: updateCasting -> updateCasting
20:35:05  Tool executed: updateCasting -> exit_code=0
20:35:32  -> converted: updateCasting -> updateCasting
20:35:32  Tool executed: updateCasting -> exit_code=0
20:39:13  -> converted: createCharacter -> createCharacter
20:39:13  Tool executed: createCharacter -> exit_code=1     <-- REJECTED
```
**`updateCasting` ran ≥3× returning exit_code=0 ("success"), yet `casting.known` stayed `{}`.**
`createCharacter` was attempted once and **failed (exit_code=1)**. The player name "Riley Carter"
was given in turn 1 but never landed in the intake → the GM loops forever demanding a name and the
season can never start.

Current intake (cheap re-confirm, no new turn driven):
```
started=False moment=character-creation
known={}
missing=['castPhoto','playerName','backstory','motivation','personaArchetype',
         'personaStrategyStyle','privateStrategy','interviewNotes','archetype','strategyStyle']
ready=False finalizable=False
```

---

## B. Cast-authoring (PR #1007 / #1002) — per-NPC log + headline

Authoring ran ONCE (1 headline; the 10 `prewarm-cast` POSTs are idempotent re-probes — the gate
works). Reasoning model returned no parseable JSON for every NPC, even after the new strict-JSON
retry. The new #1007 observability fired exactly as designed:

```
20:33:07  [cast-authoring] no JSON in first reply for npc:3 — retrying once with a strict JSON-only instruction
20:33:07  [cast-authoring] no JSON in first reply for npc:1 — retrying once with a strict JSON-only instruction
20:33:08  [cast-authoring] no JSON in first reply for npc:2 — retrying once with a strict JSON-only instruction
20:33:24  [cast-authoring] no JSON found in model reply for npc:3 (after retry) — keeping the seeded floor
20:33:26  [cast-authoring] no JSON found in model reply for npc:2 (after retry) — keeping the seeded floor
20:33:28  [cast-authoring] no JSON found in model reply for npc:1 (after retry) — keeping the seeded floor
   … (npc:4–15 identical pattern: no-JSON first reply → retry → no-JSON after retry → floor) …
20:36:10  [cast-authoring] cast authoring: authored 0/15 houseguests (floor fallback for 15: 15 no-JSON, 0 below-floor)
```

**HEADLINE: `authored 0/15 houseguests (floor fallback for 15: 15 no-JSON, 0 below-floor)` — a MASS
FLOOR FALLBACK.** `response_format={"type":"json_object"}` IS threaded to the OpenRouter payload and
the strict-JSON system prompt + one-shot retry both run; the model still emits zero JSON.

**Root cause (self-verified in source):** the live `max_tokens` for the `background-authoring` class
is **1200, not the 3000 PR #1007 intended.** `token_policy.py:66` raised the class *default* to 3000,
but `settings.py:176` still seeds `max_tokens_budget["background-authoring"] = 1200`, and
`resolve_token_policy` treats that in-band override as **winning over the default**
(`token_policy.py:53,126`). With reasoning effort `"low"` (`token_policy.py:43`), deepseek-v4-pro's
reasoning alone consumes the whole 1200-token cap before any JSON is emitted. The FE-log LLM-stream
lines for the authoring window prove it — **23 of 36 authoring-window LLM calls returned
`reply_chars=0`** with all output in reasoning:
```
content_chars=5336 reply_chars=0 reasoning_chars=5336   (~1334 tokens of reasoning, 0 visible → no JSON)
content_chars=5313 reply_chars=143 reasoning_chars=5170 (truncated, no closing brace)
```
Likely fix site: `frontend/src/settings.py:176` (1200→3000) and/or set this class's reasoning to
`off` in `frontend/src/token_policy.py:43` (it's structured extraction, not creative).

---

## C. PR #1009 #971 — send-button state matrix (driver `sendbtn.mjs`, both windows verif1)

All samples are the `.send-btn` `dataset.mode` + `title`. Screens: `sb-A-ready/settled/afterreturn.png`.

| Phase | Condition | mode | title | Verdict |
|-------|-----------|------|-------|---------|
| ready | both windows, empty composer | `newchat` | "New chat" | ok (not stuck) |
| P1 | idle, empty composer | `newchat` | "New chat" | ok |
| P1 | text typed | `send` | "Send message" | ok |
| P1 | cleared again | `newchat` | "New chat" | ok |
| P2 | foreground stream, empty composer | `streaming` | "Stop generation" | Stop shown ✓ |
| P2 | stream mode samples | `streaming,newchat,newchat,newchat` | — | transitions cleanly |
| P2 | after settle | `newchat` | "New chat" | not stuck ✓ |
| **P3** | just after send (foreground) | `streaming` | "Stop generation" | ✓ |
| **P3** | backgrounded (visibility hidden) mid-stream, settled WHILE hidden | `newchat` | "New chat" | reconciled while hidden ✓ |
| **P3** | after tab-return (KEY #971 check) | `newchat` | "New chat" | **recovered (PASS)** |

```
20:44:51 A btn just after send (streaming): {"mode":"streaming","title":"Stop generation"}
20:44:51 A backgrounded (visibility hidden) mid-stream
20:45:21 A stream settled while hidden: true
20:45:21 A btn WHILE still hidden (post-settle): {"mode":"newchat","title":"New chat"}
20:45:22 A btn AFTER tab-return (KEY #971 check): {"mode":"newchat","title":"New chat"}
20:45:25 VERDICT-#971 stuck-on-Stop after backgrounded settle: recovered (PASS)
```
**#971 PASS** — never stuck on Stop; the previously-missing `_isBgFinally` else-branch reset fires.

---

## D. PR #1009 #986 — cross-window spinner label parity (driver `peerlabel.mjs`)

Window A (verif1) sent a real turn; window B (peer tab, same verif1 game) re-attached. B's spinner
label (`.ai-spinner` text), captured live:
```
20:46:59 B[0] label: "The producers are talking it over ▃▄▅"
20:47:17 B distinct spinner labels seen: ["The producers are talking it over ▃▄▅"]
```
**#986 PASS** — B shows the in-character "producers" label, NOT a bare "Generating response".
Source-confirmed all four spinner-create sites route through `_inProgressLabel`/`_waitLabel`
(`chat.js` L1199/1213 initial, L2960 continuation, L4395 resumeStream re-attach, L4594 background).
Screens `pl-B-2.png`, `sb-B-midstream.png`, `sb-B-ready.png` show B mirroring A's interview in lockstep
(no duplicated/out-of-order bubbles, identical sequence).

---

## E. Supporting FE-log excerpts & reasoning-channel diagnostics

**Reasoning channel split (no body leak):** every casting turn logged `reply_chars` (visible) separate
from `reasoning_chars`. The `[BUG2-len]` per-turn diagnostic confirms `scrub_active=True`,
`visible_halted=False` on all 17 turns. The thinking accordion ("View thinking process") in every
screenshot is COLLAPSED; reasoning never rendered in the body.
```
[BUG2-len] round 1: raw_reply=482 reasoning=429 emitted_visible=482 cleaned=482 scrub_active=True visible_halted=False
[BUG2-len] round 1: raw_reply=0   reasoning=931 emitted_visible=0   cleaned=0   scrub_active=True   (a tool-call round)
[BUG2-len] round 2: raw_reply=375 reasoning=420 emitted_visible=278 cleaned=375 scrub_active=True   (emitted<cleaned, see F-7)
[BUG2-len] round 1: raw_reply=5   reasoning=870 emitted_visible=5   cleaned=5   (the "Name." turn)
```

**Non-2xx HTTP:** 29× `GET /api/research/status/<sid> 404` and 27× `GET /api/chat/stream_status/<sid> 404`
(one pair per turn). No 5xx. No engine 409/stale-beat. No createCharacter 200-then-rollback.

**No Vault leak:** grep for vault / trust:/threat:/affinity: numbers / secret / confessional /
hidden-attribute in any player-visible body returned NOTHING. `npc:<id>` strings appear ONLY in the
backend cast-authoring logs, never in a rendered bubble.

### VERDICTS
- **PR #1007 (cast authoring): FAIL as-shipped.** Instrumentation (counter + distinct causes) is a
  clean PASS, but the functional goal is NOT met on live deepseek-v4-pro: `authored 0/15`, full floor
  fallback. Root cause = `settings.py:176` 1200 override masking #1007's token_policy bump.
- **PR #1009 (#971 + #986): PASS** on both. Button never stuck on Stop (incl. backgrounded-settle +
  tab-return); peer-tab label is the unified in-character "producers" line.

---

## F. MINED ADDITIONAL FINDINGS (beyond the 3 already reported)

The 3 already reported: (i) OOBE "offline endpoint" holding-card dead-end; (ii) casting name never
reaching a successful createCharacter; (iii) "engine/system" machinery leak. New ones below.

- **F-1 `updateCasting` silent write-drop — wrong-key field (BLOCK-suspect).** `updateCasting`
  executed 3× with `exit_code=0` yet `casting.known` stayed `{}` and `playerName` stayed `missing`.
  The tool reports success but nothing persists. **Mechanism (source-traced):**
  `src/engine/castingIntake.ts:80 mergeCastingUpdate` only sets a field when `req[field]` is a
  non-empty string under an EXACT `CASTING_COVERAGE` key (`playerName`). The adjacent
  `ignoredCastingKeys` ("audit R4-01") comment names this exact failure: *"a model that records under
  `name` (the field is `playerName`), `notes`, or a typo would otherwise have its answer SILENTLY
  DROPPED and casting would stall."* deepseek almost certainly filed the name under a non-matching key
  → merged to nothing → `exit_code=0` but `known={}`. The MCP boundary (`McpServer.ts:231`) casts args
  straight to `UpdateCastingReq` and the engine is the authority, so the drop is in the engine merge.
  The R4-01 echo (`ignoredCastingKeys`) is supposed to let the producer re-file, but the model never
  self-corrected across 3 tries. Evidence: `fe.log` 20:35:05 / 20:35:32 `Tool executed:
  updateCasting -> exit_code=0`, then `GET /api/orwell/state` → `known={}`. Fix candidates: tolerant
  key-aliasing in `mergeCastingUpdate` (accept `name`→`playerName`), and/or make the FE surface the
  `ignoredCastingKeys` echo back to the model so it re-files (it currently doesn't visibly act on it).

- **F-2 `createCharacter` fails exit_code=1 with no surfaced reason (BLOCK-suspect).** `fe.log`
  20:39:13 `Tool executed: createCharacter -> exit_code=1`. The engine rejected finalize (consistent
  with the empty intake from F-1), but no reason string is logged and nothing is shown to the player —
  the GM just keeps looping. Fix site: log the engine's rejection reason on the createCharacter path
  and/or the L39-family finalize fallback.

- **F-3 Deliberate fourth-wall break in the GM body (POLISH).** Beyond bare "engine/system" mentions:
  turn 4 body literally says **"Let me drop the producer persona for a second and be completely
  straight with you."** — the narrator abandons the in-character frame. Anti-machinery scrub does not
  catch this (it's natural prose, no tool token). Evidence: `fe.log` 20:39:18 reply preview; visible in
  `c-turn5.png`. Likely needs a framing-prompt instruction, not a scrub rule.

- **F-4 Casting stuck-loop / no progression escape (POLISH→BLOCK).** Across 5 turns + opener the GM
  never advanced past "give me your name"; the L39-style stall-nudge / forced-advance family did NOT
  fire for the casting seam (no stall/nudge/forced-advance lines in `fe.log`). With F-1 unfixed, a real
  player can be trapped here indefinitely. Evidence: `c-turn4/5.png`, repeated "name" replies.

- **F-5 Degenerate ultra-terse GM turns (POLISH).** Two GM turns were `"Name."` (5 chars) and
  `"Let me try something.\n\nYour name:"` (33 chars) — each after 870–1027 reasoning chars. A
  reality-show producer reduced to a one-word form prompt reads as broken immersion + wasted reasoning.
  Evidence: `[BUG2-len] raw_reply=5 reasoning=870`; visible in `sb-A-settled.png` ("Name.") and
  `c-turn5.png` ("Your name:").

- **F-6 Persistent "Choose Your Character" CTA never resolves (NIT/LATENT).** The cast-photo button
  stays mounted under the composer across every casting turn (`c-turn4/5`, `sb-A-*`, `pl-B-2`,
  `sb-B-*`). It's the optional headshot step that never completes; combined with `castPhoto` topping
  the `missing` list and the GM saying "if it uploaded, it'll process," the photo step appears to gate
  intake progress in a confusing way. Worth checking whether `castPhoto` being unmet blocks
  name/intake capture (i.e., whether F-1 is actually "intake is photo-gated").

- **F-7 Live-stream vs final-render body length mismatch (LATENT).** On 4 turns `emitted_visible <
  cleaned` (e.g. `emitted_visible=278 cleaned=375`, gap 97 chars; also 51/43/25). The live-streamed
  bubble showed a few dozen fewer chars than the settled bubble — the streaming scrub held content back
  during stream, then the final cleaned body restored it. `cleaned ≥ emitted` always, so nothing extra
  leaked, but the live bubble briefly differs from the final. Evidence: the `[BUG2-len]` lines in §E.

- **F-8 Per-turn 404 polling on research/stream-status (NIT).** 29× `research/status 404` + 27×
  `chat/stream_status 404`, one pair per turn — the FE polls endpoints that don't exist for a
  non-research casting session. Harmless but log-noisy and wasteful. Fix site: gate these polls on the
  session actually being a research/active-stream session.

- **F-9 GM register slip "lol" (NIT).** One casting reply: "Look — I can't pull up a cast **lol**
  because there isn't one yet." — informal "lol" in the casting-desk voice + a borderline-meta
  reference to game-state absence. Evidence: `sb-A-afterreturn.png`, `fe.log` reply preview.

- **F-10 Double `prewarm-cast` fire per load (NIT/LATENT).** Two `POST /api/orwell/prewarm-cast` ~28s
  apart on a single load (`fe.log` 20:32 / 20:33), and 10 total across the session. Authoring itself
  ran only once (idempotent gate holds), so no duplicate authoring — but the double-fire is redundant
  request traffic worth a look.

**Confirmed NEGATIVE (good):** no Vault-shaped content in any player surface; no reasoning text in the
message body (channel split + collapsed accordion hold on all 17 turns); no duplicated/out-of-order
bubbles across the two synced windows; no stuck spinner (A settled to idle; B's spinner cleared); no
5xx; no layout/overflow flagged in any captured screenshot.
