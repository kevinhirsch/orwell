# PO Decisions Log

A running record of **product-owner rulings** made during development — the decisions only
the owner can make (design direction, mandate trade-offs, PO-gated tuning, priority calls).
Append-only; newest first. Each entry: date · the decision · scope/issue · rationale. This
complements the ADRs (`docs/decisions/0001…`) and the audit rulings
(`docs/audits/2026-06-10-full-product-audit.md` #1–#21) — those are architecture; this is the
live ledger of owner calls as they happen.

---

## 2026-06-23

- **Blocs never cross the Vault Wall as an object — KEEP the invariant (#612, #624).** The emergent
  bloc/coalition structure stays computed-but-hidden; the player infers coalitions from observable
  behavior, never from a surfaced bloc roster/object. Closes #612 and #624 as *not planned*. Rationale:
  the Vault-Wall mandate (#2) and ADR 0002 ("ally/enemy labels are organic, never stored/surfaced")
  win over the convenience of handing the narrator a structured bloc. The 0044 invariant test stands.

- **Social / Diary-Room zeitgeist framing → player channel (#580).** Player-present beats (social,
  diary-room) use the player-channel zeitgeist framing, not the off-screen "world you moved in with"
  framing. The conflicting `zeitgeist.test.ts` assertion is updated to the new behavior (this reverses
  the earlier revert, now PO-sanctioned).

- **Flip `ORWELL_TIME_OF_DAY` default ON (#583).** Its prerequisites shipped (#537 clock pacing, #534
  narration time-of-day pin), so time-of-day is on by default.

- **Flip `owner_filter` `include_shared` default → False (#588).** Security: a NULL-owner row must not
  be readable across users by default. Owner-scheduled; now approved.

- **Reword the "Producer's Vault" term at the post-season retrospective (#607).** Drop the v0 machinery
  term from player-facing retrospective copy.

- **DWE kit program — build the shared substrate FIRST (#643).** Generalize the window kit's 0064
  layout-sync into a kit-agnostic synced-UI-state service so every kit (window/gadget/notice) inherits
  cross-session persistence + realtime two-window mirror by construction — before building #640/#642 or
  doing the #641 migrations.

- **Kit mandates (cross-cutting).** Every DWE kit MUST: (a) persist state across sessions + mirror it in
  realtime across windows/devices (#643); (b) be fully functional AND intelligently touch-adapted on
  mobile/tablet/desktop, not a shrunk desktop (#644). Inherited by every kit member.

- **Live-LLM verification — allowlist model egress in the environment.** The 9 model-behavior items
  (#536/#540/#541/#542/#548/#549/#550/#561/#613) can't be verified while OpenRouter egress is blocked;
  the owner will allowlist egress so the guardrails can be confirmed live and closed.
