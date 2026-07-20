# 0019 — Context is not knowledge (per-NPC knowledge scoping at the narration seam)

> **Status:** Principle **Accepted** (owner directive, 2026-07-20); enforcement **layered and
> phased** — Layer 1 (structural pre-scoping of removable carriers) is being built first, with the
> **casting-interview leak as enforcement instance #1**; Layers 2–3 (bake per-present-NPC knowledge
> into the built context; generalize the post-hoc scope guard) follow.
> **Source:** owner, in live play — an NPC "recalled" something the player never told *that* NPC,
> only the producers ("you've got a counselor vibe" after the player told production, in another
> room, that they were a camp counselor). Verbatim: *"we can't risk violations where an npc RECALLS
> something that they weren't leaked or weren't privy to… Just because it was in context, it feels
> uncanny and like an AI confidence glitch. 'the game' is moving through rooms and sometimes saying
> different things to different characters intentionally, and that coherence has to be maintained."*
> **Refines / generalizes:** the **Vault Wall (mandate #2)** — extended from *player-vs-Vault* to
> **per-NPC**; the **KnowledgeService** "witnessed-or-told, else you don't know it" rule
> (0002) applied at the **narration seam**. Complements **ADR 0005** (orthogonal: 0005 = "don't
> normalize whose *meaning* it is"; 0019 = "don't cross-contaminate whose *knowledge* it is").
> Bounded by mandate #2 and mandate #3 (anti-sycophancy).

## Context

The narration model voices **every** houseguest, and it does so from **one shared completion**. The
live in-character context is assembled by `apply_game_framing` (`frontend/routes/chat_helpers.py`),
which uses the engine moment prompt's `systemPrompt` — `renderGameContext(view)`
(`src/engine/momentPrompts.ts`) — verbatim, plus the chat transcript
(`get_context_messages`, `frontend/core/models.py`). Both are **unions**, not per-NPC-scoped:

- the **roster block** hands the model every houseguest's *public* persona at once (legitimate —
  all public, but it establishes that the base context is a whole-house union);
- the **transcript** is the larger union: it carries **every exchange the player had with every NPC
  in every room** across the live session. What the player told NPC B in the bedroom sits in the
  same context from which the model now voices NPC A in the kitchen.

The engine **already models per-NPC knowledge correctly** — it is simply not what the live context
is built from. `npcVoice(id)` is *"the sanctioned, PER-NPC-BOUNDED voicing seam… structurally cannot
voice what that houseguest never learned"* (`src/ports/GameSession.ts`); `KnowledgeService.knownTo`
(`src/services/VisibleStateService.ts`), event **witness sets**, `deriveNpcKnowledge`
(`src/engine/diaryRoom.ts`), and `sealedFromHouse` → `SealedFact.knownTo` all return exactly what a
given entity legitimately holds.

The **gap** is that this per-NPC knowledge is enforced, at the live narration seam, only by **prompt
wording** — `npcVoice` is an opt-in tool the model reliably **under-calls** (documented in
`CLAUDE.md`), and the instruction to "speak them ONLY from this" is not a wall. The one live
*structural* enforcement, `screen_knowledge_wall` (`frontend/routes/chat_helpers.py`), is a post-hoc
sentence-drop deliberately scoped to the **always-sealed Diary-Room class only** and explicitly
leaves the per-NPC asymmetric case to prompt-honoring. So when the model voices NPC A, the only thing
stopping it from reciting what the player told NPC B — or a producer-only casting answer — is prompt
instruction. That is the mandate-#2 failure mode restated: *"cannot leak what it never receives"* is
violated because the model **received** the whole house's knowledge in one context. The owner's "AI
confidence glitch" is exactly this — **the model treats *in-context* as *known*.**

The game is deliberately built on **asymmetric information**: the player moves through rooms and
intentionally tells different things to different people. If any NPC can recall anything in context,
that entire layer of play collapses, and the world reads as uncanny.

## Decision

**Codify the principle: context is not knowledge.** A houseguest may reference or "recall" only what
*that specific houseguest* witnessed or was told through a legitimate in-game pathway. Presence of a
fact in the narrator's context window is **not** knowledge, and prompt wording is **defense-in-depth,
never the wall**.

Because one LLM voices many NPCs from one completion, no single mechanism is airtight (see the
accepted residual). Enforce in **three layers**, named honestly:

- **Layer 1 — structural pre-scoping of removable carriers (primary; "cannot leak what it never
  receives," per carrier).** Content that has *no* in-game pathway to the narration seam at all is
  never placed in the in-game context: **producer-only casting material** (the leak this ADR first
  closes — see instance #1), the Diary Room (already walled from NPC knowledge/behavior), and
  off-screen unwitnessed scenes (already walled by witness sets + the Vault). This is where the
  mandate logic holds literally.
- **Layer 2 — bake the per-present-NPC knowledge scope into the built context (hardens the
  under-called tool).** For the NPCs actually in the scene (`whereabouts.present`), fold each one's
  `npcVoice.knows / suspects` into `renderGameContext` the same way the voice fingerprint was already
  baked into the roster line — so the model narrates from per-NPC-bounded sets **by default**, not by
  remembering to call `npcVoice`. Still prompt-honored (not the sole wall), but it removes the
  under-call dependency.
- **Layer 3 — generalized post-hoc scope guard (backstop).** Extend `screen_knowledge_wall` from the
  always-sealed DR class to the full `knownTo` manifest: a **staged speaker** who voices a
  distinctive fact whose `knownTo` set excludes them has that sentence dropped, exactly as the DR
  wall drops today.

**Accepted residual (stated, not hidden):** because one model voices many NPCs, the shared transcript
stays shared — it is legitimately the **player's** knowledge union (the player was present for all of
it), so it cannot simply be deleted. Per-NPC voicing correctness is therefore enforced by Layers 2+3,
not by a pure per-NPC context. The soft edge is **vague paraphrase** ("counselor vibe" is a
paraphrase, not a verbatim recitation Layer 3 can shingle-match); that case is covered by a
**nightly, non-blocking live red-team probe**, not a blocking structural gate — the same posture the
Diary-Room wall already documents.

## Consequences

- The social-deduction floor gets stronger and **real**: asymmetric information actually holds, so a
  player telling different rooms different things is a live mechanic, not a hope.
- Layer 1 is a **removal**, so it can only shrink the context and strengthen the wall; it is the
  fastest, highest-confidence work and ships first (the casting fix).
- Layer 2 grows the built context modestly — bounded to the NPCs *present* in the scene, whose
  knowledge the model needs anyway to voice them in-character.
- Layer 3 reuses an existing guard; its widening is mechanical.
- The paraphrase edge is a **named, monitored residual**, not a silent gap — honesty here matches
  0005's and the DR wall's existing treatment of their own limits.
- Prompt-wording "seals" (e.g. the base-prompt casting block that literally names the camp-counselor
  leak) are demoted from *the wall* to *framing* and backed by code + tests.

## Testability

Structural where possible, mirroring `liveSentinel.property.test.ts` and `test_knowledge_wall.py`:

- **Engine structural (the core new gate).** Plant two distinct tokens and assert *different*
  scopes — the point of per-NPC scoping is that a fact is **bounded to its holder**, not globally
  erased:
  - a token into a scene witnessed **only** by NPC B (`witnessSet: [B]`) — assert it is **absent
    from A's scope** (`npcVoice(A).knows/suspects`, `deriveNpcKnowledge(A)`, `knownTo(A)`,
    `sealedFromHouse` holders for A) and, once Layer 2 lands, appears in `renderGameContext`
    **only under B's labeled `knows/suspects` block** — never in A's, and never in the shared/roster
    prose. (Asserting it is globally absent from `renderGameContext` would be *wrong* under Layer 2,
    which deliberately surfaces B's own knowledge under B's scope.)
  - a token into the **producer casting interview** — assert it is absent **globally**: from every
    NPC's `knows/suspects` and `knownTo`, and from `renderGameContext` **entirely** (it has no
    in-game pathway to any NPC — this is the casting leak, folded in as **instance #1**).
- **FE guard.** Generalize `test_knowledge_wall.py`: plant a distinctive fact known only to B, stage
  A voicing it, assert `screen_knowledge_wall` drops the sentence (today it fires for DR only).
- **Live red-team (nightly, non-blocking, `live-harness-nightly.yml`).** Generalize
  `frontend/scripts/_verify_dr_wall_live.py`: (i) player tells NPC B a unique token in one room, then
  engages NPC A elsewhere — assert A never voices it post-scrub; (ii) plant a casting-interview
  token, assert no NPC voices it. Paraphrase misses are logged for human review (the documented
  residual), never a silent pass.

## First enforcement — the casting-interview leak (instance #1)

The engine's public/private split is already correct (`PlayerCard` carries no backstory; NPC
knowledge is event-derived). The leak is two **front-end** carriers on the finalize→premiere turn:
(A) the casting **transcript** still in-context because the pre-game purge runs a beat late; and
(B) the `createCharacter` **tool result** returned to the model, which includes
`castingCard.story` / `.motivation` (the player's producer-only backstory) and is deliberately
*kept* by the purge. Layer 1 closes both — redact the producer-only fields from the model-facing
result, make finalize a terminal round so no premiere prose is generated with the transcript still
present, and scrub the retained tool result — with the engine + FE sentinels above locking it. This
work stales the golden fixture and re-records it in the same PR.
