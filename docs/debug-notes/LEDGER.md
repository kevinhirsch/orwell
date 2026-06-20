# Debug Notes Ledger

Product-owner debug notes captured during play, each investigated by a dispatched agent
and triaged to either **remediation** (contained fix, tested + pushed) or a **spec for
remediation** (a `docs/features/NNNN-*` or queue item). Newest at top.

| # | Date | Note (source) | Surface | Status | Investigation summary | Outcome / artifact |
|---|------|----------------|---------|--------|------------------------|--------------------|
| 1 | 2026-06-20 | "The chat basically skipped the entire interview process after it asked name and photo. Then it told me my profile and that I was basically a floater with no stats. I think the messages the 'user cancelled' just pushed it thru." (PO, Mobile) | Casting interview (0050) / FE agent loop | ✅ Fixed | **Confirmed.** Five compounding causes (PO intuition correct): (1) engine `ready` is name-only (`castingIntake.ts:152`) while photo is casting step #1 — so name+photo flips `ready` before the interview happens; (2) FE force-finalize trusts name-only `ready` and calls `createCharacter("{}")` (`agent_loop.py:3658`); (3) the post-photo hidden production cue contains "continue", which `_LULL_READY_RE` reads as a player lull, escalating the stall counter; (4) cancelled mobile turns (`[Cancelled by user]`) never reset the counter, so aborts march it to forced finalize; (5) `createCharacter` has no completeness guard beyond a name → no archetype → `DEFAULT_ARCHETYPE="floater"`. | **Remediation (contained code fix):** engine adds an additive `finalizable` floor (name + backstory + motivation + a play-style field) distinct from name-only `ready`, plus a narrow `createCharacter` `"casting-incomplete"` refusal on a zero-substance finalize; FE gates the *forced* finalize on `finalizable`, and stops hidden cues / cancelled turns from escalating the stall counter. Tests added engine + FE. **Fixed** — engine `finalizable` floor (`castingIntake.ts`) + typed `createRefused: "casting-incomplete"` backstop (`GameSessionAdapter.ts`, args-identity-aware so direct/admin/fixture creation is unaffected); FE gates the forced finalize on `finalizable`, excludes hidden production cues from lull detection, and skips stall escalation on cancelled/empty turns (`agent_loop.py`). Gates green: typecheck/build clean, unit 1207, BDD 366, FE pytest 1610. **Live mobile re-verify still owed** — needs a keyed playtest session (harness: `docs/audits/playtest-harness/`). |

## Status legend
- 🔍 Investigating — agent dispatched
- 📝 Spec'd — remediation spec written, not yet implemented
- 🔧 Remediating — fix in progress
- ✅ Fixed — fix landed (tested + pushed)
- ⏸️ Needs owner input — blocked on a decision
