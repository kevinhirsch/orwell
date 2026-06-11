# 0051 — In-character images (analyze in, generate out)

> **Status:** **Specced — not built** (spec authored 2026-06-10; decisions locked 2026-06-11;
> implementation is a future queue item). Mixed tier: prompt/descriptor plumbing is engine-side
> (TS gates), the generation pipeline and inline rendering are front-end (pytest + browser smoke).
> The gate split is decided at build time; nothing lands in `cucumber.cjs` until the engine half
> is built to green.
> **Executable spec:** [`0051-in-character-images.feature`](./0051-in-character-images.feature)
> **Provenance:** `docs/audits/2026-06-10-full-product-audit.md` "Future specs" — 0051
> (per the 2026-06-10 ruling, a feature spec, not a defect) · **ruling #9** (image attach —
> the analyze-in half, specced at E94 and shipped FE-side) · D9/E64 portrait surfaces ·
> ADR 0003 (the conversation is the game) · the Vault Wall (CLAUDE.md mandate #2).

## 1. Summary

The model can *produce* images as part of play — a houseguest's sketch, the memory-wall
portrait, a "camera still" of a scene — rendered **inline in the chat**. This completes the
analysis loop ruling #9 opened: E94 made attaching an image a first-class in-character input
("the player is showing something to whoever is present"); 0051 is the output direction.

The first deliverable fires **automatically at move-in**: as part of the `createCharacter` /
season-start beat, the engine generates a **photorealistic cast portrait set** (reality-TV-style
headshots) for each houseguest — no player prompt needed. Subsequent images are player-requested
or engine-offered at key beats. The image model is behind a new **`ImageGenerationPort`**;
the first concrete adapter is wired at build time.

## 2. Why this is a design pass, not a feature toggle

The audit names the questions this spec must answer (and the .feature pins):

1. **Which moments may generate** — player-requested ("draw me the memory wall") vs.
   producer-beat (auto-fires at move-in for portraits; engine-offered at key beats such as an
   eviction "camera still"). Both exist; neither is unbounded.
2. **How generation stays Vault-free** — image prompts are built **only from the player's
   visible state** (the same projection the chat narrator gets). The E11/E15 discipline
   applies to image prompts too: no hidden stat, edge, soul, confessional, or off-screen
   scene content may reach the image model, structurally — the prompt builder lives on the
   outward side of the wall and is sentinel-swept like every player surface.
3. **Seed/style consistency per season** — the house must look like itself: a per-season
   style anchor (seeded at `createCharacter`, persisted in the snapshot) plus each
   houseguest's stable public appearance facets (0004 §8) feed every prompt, so the same
   houseguest renders recognizably as a photorealistic individual across the season and
   across restarts.
4. **Cost/latency gating** — generation is the most expensive lever in the game; budgets
   (per-turn / per-week caps, declared in a constants module, never inline) bound it, and
   an over-budget request is declined **in the production/show frame** ("production is hoarding
   the cameras tonight").
5. **Graceful absence** — when no image-capable model is configured, the game plays
   identically: in-fiction refusal in the production frame ("the feeds can't render that"),
   no error surface, no broken affordance. Mirror of E94(c).

## 3. Decisions (locked 2026-06-11)

| Decision | Choice | Notes |
|---|---|---|
| **Portrait trigger** | Auto on move-in — fires as part of `createCharacter` / season-start, no player prompt | The cast appears; their faces appear with them |
| **Visual style** | Photorealistic — reality-TV-style headshots and scene stills | The per-season style anchor is a photorealistic descriptor seeded at cast time |
| **Image provider** | Provider-agnostic `ImageGenerationPort` | First concrete adapter (DALL-E, Stability AI, etc.) wired at build time; the port is the seam |
| **Decline framing** | Production / show metaphor — "feeds are down," "production is holding the cameras," "that footage hasn't aired yet" | All decline paths (budget, unwitnessed, unresolved) use this frame; no hidden-state leak |

## 4. The rules that bind (non-negotiable)

- **Vault Wall:** the image-prompt builder takes the visible projection only; a structural
  test proves no Vault/engine-only handle is reachable from it, and a sentinel sweep proves
  no hidden content appears in any assembled image prompt.
- **Knowledge scope:** an image may depict only what the **player knows** — witnessed events,
  surfaced facts, public personas. A request to depict an off-screen scene the player never
  witnessed is refused in the production frame (suspicion is not footage). No pathway, no picture.
- **Anti-sycophancy / unresolved outcomes (the P1/P6 discipline):** no image may assert an
  outcome the engine has not resolved and revealed — no "camera still" of an eviction before
  the vote is revealed. Image generation narrates the record; it never front-runs it.
- **Recorded or it didn't happen:** a generated image shown in character is a beat — it is
  recorded (player-witnessed event referencing the image and its subject) like any scene.
  The E22 guard applies to image turns.
- **ADR 0003 — augment, never replace:** images render inline in the chat (no new panel, no
  gallery surface in the game chrome); no interaction that builds or progresses the game may
  *require* the image path; reduced/absent image capability never blocks play.
- **No number crosses:** portrait/scene prompts use qualitative public facets (appearance,
  presentation, archetype-flavored wording) — never stats, edges, or tier internals.
- **Decline framing is always the production frame:** whether the decline is budget, knowledge
  scope, or unresolved outcome, the in-fiction explanation is drawn from the BB production
  aesthetic — never a technical message, never a hint about what the hidden state contains.

## 5. Scope

**In:** the per-season photorealistic style anchor (seeded, persisted); the `ImageGenerationPort`
(provider-agnostic); the Vault-free image-prompt builder over visible state + public appearance
facets; auto-firing cast portrait set at move-in (first deliverable, feeding D9/E64's portrait
surfaces); player-requested images; engine-offered producer-beats; budget gating (constants
module); inline chat rendering; production-frame decline/absence paths; recording of image beats.

**Out:** image *analysis* (that is E94, shipped/landing separately — this spec only pairs
with it); any player-facing gallery/panel; image editing or regeneration of past stills
(E93's no-rewriting rule covers depicted history too); NPC-to-NPC "images" (off-screen life
stays textual in the hidden layer).

## 6. Test strategy (at build time)

- **Engine/TS:** prompt-builder structural isolation (dependency-cruiser scope extension);
  sentinel sweep over assembled prompts; style-anchor persistence + same-seed reproducibility;
  budget constants honored; production-frame refusal on unwitnessed-scene and unresolved-outcome
  requests; image beats recorded; `ImageGenerationPort` wired behind the outward root.
- **FE/pytest + smoke:** inline rendering; auto-portrait generation at move-in (once per season
  start, not on restart); the no-image-model fallback (production-frame copy, no error); no new
  chrome surface.

## 7. Definition of Done

All .feature scenarios green under their decided gates; the Vault-free prompt path proven
structurally (not by prompt wording); portraits stable within a season and varied across seeds;
style anchor is photorealistic and survives restart; play unaffected when generation is
unavailable; the README index row flipped to Done.
