# Legacy meta-feedback — the logged v1 season (genesis + Days 2–14)

> **LEGACY / MIGRATION REFERENCE — NOT THE SOURCE OF TRUTH. FORMAT & FEEDBACK ONLY.**
>
> These are verbatim transcripts of the **original chat-prompt implementation** (the v1 game
> `docs/legacy/BB_GameBible.md` governed), captured from claude.ai share links: the **genesis
> design session** where the three-document system was invented, and every logged gameplay
> session of the one season played (in-game Days 2–14, spanning Mar 22 – Jun 2026). They are
> kept because the **meta-feedback logged inside them is the empirical origin** of the Bible's
> "CRITICAL" sections and, through them, of the rebuild's structural mandates — each logged
> failure here became an engine feature. The full cross-reference is
> `docs/audits/2026-06-10-v1-transcript-meta-feedback-audit.md`.
>
> The same hard rules as the rest of `docs/legacy/` apply, doubly:
>
> - **Content is illustrative only.** The player persona ("Ryne") and every houseguest name in
>   these files are the legacy example. Never hard-code them, seed data from them, or reference
>   them in tests (roles only).
> - **Never ingest as data.** No fixture, seed, test, or canonical state may be derived from
>   these transcripts. They are evidence about *how the old game played*, nothing else.
> - **They contain the old game's Vault breaches.** Several sessions log live leaks (stat
>   numbers, hidden backstory, Vault structure, an internal "luck modifier", unsourced NPC
>   intent) — preserved deliberately, as the failure record the Vault Wall exists to prevent.
>   They are spoilers for a finished, abandoned save only.

| File | Session | Captured from `claude.ai/share/…` |
|---|---|---|
| [`genesis-design-session.md`](./genesis-design-session.md) | **The genesis** ("Big Brother Sim Parameters", Mar 22 →) — the design dialogue that invented the three-document system, named every LLM limitation in advance, authored the player + cast architecture, later hardened the Bible after each failure, **named the project Orwell**, and reviewed the rebuild | `b8d611d2-02fc-4102-9bf4-778f3aeaeac1` |
| [`bb-day-2.md`](./bb-day-2.md) | **Day 2** (Week 1 social day; pacing feedback; the eavesdrop beat; manual doc-handoff protocol) | `94f5e3c5-07fd-4cc5-9583-ebfb155894a2` |
| [`bb-day-3.md`](./bb-day-3.md) | **Day 3** (nominations; veto draw; **three logged Vault breaches**; veto-safety rule correction) | `75863456-13aa-490c-b464-04992688783d` |
| [`bb-day-4-5.md`](./bb-day-4-5.md) | **Day 4–5** (veto comp; vote-math drift 14→11→13; a confabulated scene; the "timeline is wack" ruling; NPC-initiative complaint; forgotten save files) | `7e6aca23-5e4e-48d9-b706-a8bae885b202` |
| [`bb-day-5.md`](./bb-day-5.md) | **Day 5** (Week-1 veto ceremony; the amended protocol holding) | `5f3a2f4e-4eac-4661-bbfb-9c01988d4c19` |
| [`bb-day-6.md`](./bb-day-6.md) | **Day 6** (Week-1 eviction; **the competition narrative-rigging catch** — "you chose drama as a key decider over realism"; player declines a rerun as "cheating") | `85429552-e04c-4a62-94cd-792013498fae` |
| [`bb-day-7.md`](./bb-day-7.md) | **Day 7** (Week 2 opens; intel pipelines; honest vote math) | `62bbccc7-70dc-4410-857c-1e4a00d47008` |
| [`bb-day-8.md`](./bb-day-8.md) | **Day 8** (Week-2 nominations; a near-leak of predetermined NPC psychology; veto-draw randomness correction) | `efd9a986-b461-4dda-82e5-8d84cd125a93` |
| [`bb-day-8-9.md`](./bb-day-8-9.md) | **Day 8 night – Day 9** (veto draw **with the Houseguest's Choice chip**; the three-iteration competition redesign; jury-math corrections; a presence/staging error — an NPC wrongly in earshot; the "finality language" ruling) | `af0a8e94-281f-459c-93de-e38ebaf0fb78` |
| [`bb-day-10-11.md`](./bb-day-10-11.md) | **Day 10–11** (veto ceremony; pacing re-enforcement; a proactive full game-state verification) | `8ab69b89-9f23-4d4d-8135-ddebc9981763` |
| [`bb-day-12.md`](./bb-day-12.md) | **Day 12** (Week-2 eviction; first "is that chance or game design?" probe) | `e0347e9f-e2e9-4bbd-b15f-7b025eb07f6b` |
| [`bb-day-13.md`](./bb-day-13.md) | **Day 13** (Week 3; a Vault slip — unsourced NPC intent — caught and corrected) | `4f949854-87a1-48da-ad25-350e0aeccdf8` |
| [`bb-day-14.md`](./bb-day-14.md) | **Day 14** (the final logged session — **the "insufficient friction" sycophancy confession**, a last Vault-Wall reminder, and an abrupt mid-scene end; ~1/7th the length of the prior sessions) | `debdc3a3-940c-4d8f-bd79-e612b8a7c3e3` |

Transcripts are stored as fetched (rendered to markdown via a reader proxy); line numbers
cited by the audit are approximate against these files.
