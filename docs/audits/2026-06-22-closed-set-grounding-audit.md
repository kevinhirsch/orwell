# Closed-set grounding audit — 2026-06-22

> 📋 **Audit record** · 2026-06-22 · The over-imaginative-LLM problem, made systematic ·
> **Status:** **ACTIVE — framing + open rows**

## Why this exists

A live transcript (2026-06-22, move-in night) showed the narrator **inventing the room** — placing
houseguests where the engine hadn't, teleporting them between non-adjacent bedrooms, materializing
a houseguest who existed nowhere. Investigation (feature **0067**) found this is not a one-off: it
is a **closed-set fact authored by the open set**, and the owner's question was the right one —
*"if it appears here, isn't this systemic? How do we guardrail the LLM without compromising its
ability to storytell — is it just whack-a-mole?"*

The answer is **no, not whack-a-mole** — *if* we stop treating each report as a new bug and instead
audit the closed set **as a set**. This doc is that enumeration.

## The principle — ADR 0005 (authority splits by openness, not layer)

- **Closed set** — facts with exactly one right answer, engine-owned. The model must **never**
  author them. Finite and enumerable (this table).
- **Open set** — the meaning/texture of social play (mood, glances, delivery, room feel). The model
  invents it freely; the engine **never** normalizes it (`expressiveNonCollapse` is the permanent
  gate).

Over-imagination is a **bug only in the closed set**. In the open set it is the product working.

### The two-part cure every closed-set fact needs

1. **Feed, don't constrain** — hand the model the ground truth so it never *needs* to invent
   (gold standard: knowledge-bounded `npcVoice` — you can't fabricate what you're fed the truth of).
2. **Reconcile, don't pre-censor** — a closed-set-only pre-emission guard catches a divergent
   *fact* before the player sees it, mirroring the 0065 board guard and the ADR-0005 desync guard
   that *"may fire only on closed-set board claims, never on creative prose."* It touches **claims
   about facts**, never the prose. (A guard that touched flavor would fail `expressiveNonCollapse`.)

The "whack-a-mole" feeling is the symptom of a closed-set fact that was mis-filed as open. The fix
is to audit the set once and close the gaps, not to react per-incident.

## The closed-set ledger (feed + reconcile status)

Status: ✅ grounded · ◐ partial · ❌ gap · n/a.

| Closed-set fact | Feed (model handed truth) | Reconcile (pre-emission guard) | Status | Notes / owner |
|---|---|---|---|---|
| Competition / vote / nomination **outcomes** | ✅ 0065 delta feed | ✅ 0065 pre-emission outcome guard | ✅ | `resolveCompetition` removed from the player channel; the engine is the sole outcome authority. |
| **What an NPC knows** (and may reveal) | ✅ knowledge-bounded `npcVoice` | ✅ npcVoice sentinel | ✅ | The model "cannot voice what this NPC never learned." The template for doing it right. |
| **Where the game is set** (LA house) | ✅ base-prompt pin | ◐ no automated guard | ◐ | L22 fix (had relocated to the player's hometown). A setting-claim guard is unbuilt; low rate. |
| **Casting/DR private content** → NPC mouths | ✅ filtered out of NPC voicing | ✅ npcVoice sentinel + base-prompt pin | ✅ | L25. Player-level/OOC channel has no NPC pathway. |
| **Who is present / where people are** | ❌ → ✅ via **0067** | ❌ → ✅ via **0067** | ❌→◐ | **The trigger.** 0067 adds the per-turn occupancy feed + the presence desync guard. |
| **Who exists** (roster / identity) | ◐ roster in state | ❌ → ✅ via **0067** | ❌→◐ | "Nia from nowhere." Folded into 0067's presence/identity guard (same scene fact). |
| **Day / week / phase / titles** (HUD facts) | ✅ in context | ◐ relies on the OOC classifier (L36) | ◐ | The model occasionally narrates the wrong day/phase; candidate for a HUD-fact guard. |
| **Relationship history / what was said before** | ◐ store-recall (L27) | ◐ no contradiction guard | ◐ | Continuity is the store *recalled*, not the chat *remembered* (L27/L27b). A "did this happen?" recall check is the natural next guard. |
| **Pending decision / legal options** | ✅ decision card | ✅ engine validates the submission | ✅ | The card presents the legal set; the engine rejects an illegal choice. |
| **Persistence / saved state** | n/a (not narrated) | ✅ orchestrator integrity checkpoint | ✅ | Fail-closed commit (0031). |
| **Vault / hidden state** | n/a (never fed) | ✅ structural (dependency-cruiser) + sentinel | ✅ | Mandate #2 — never fed, so never leakable. |

## Findings

1. **The set is small and enumerable.** The fear ("we'll be adding guardrails forever") is
   unfounded *for the closed set* — it is the rows above, not an open-ended list. The open set is
   infinite and is deliberately **never** guarded.
2. **Two clear gaps**, both closed in spirit by **0067**: **presence** and **roster/identity** (one
   scene fact, one guard).
3. **Two partials worth a follow-on**, lower urgency: **HUD facts** (day/week/phase) and
   **relationship-history continuity** — each wants a small closed-set guard on the 0065 pattern
   when live play shows it matters. Not started; tracked here.
4. **The pattern is reusable.** Every gap closes the same way: add the fact to the 0065 delta feed
   + add a closed-set-only pre-emission guard. No new mechanism per incident.

## Open items

- **CSG-1 ☐ (0067)** — presence + roster/identity feed + desync guard. *Owner: feature 0067.*
- **CSG-2 ☐** — HUD-fact (day/week/phase/title) pre-emission guard, if live play shows drift past
  the L36 OOC classifier. *Candidate; not started.*
- **CSG-3 ☐** — relationship-history continuity guard (a recall-backed "did this actually happen?"
  check before the narrator asserts a past event). *Candidate; ties to L27b; not started.*
- **CSG-4 ☐** — setting-claim guard (automate the L22 LA-house pin). *Low priority; prompt-pin holds.*

This ledger is the authoritative list of closed-set grounding gaps going forward; close a row only
with its verifying artifact.
