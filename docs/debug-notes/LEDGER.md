# Debug Notes Ledger

Product-owner debug notes captured during play, each investigated by a dispatched agent
and triaged to either **remediation** (contained fix, tested + pushed) or a **spec for
remediation** (a `docs/features/NNNN-*` or queue item). Newest at top.

| # | Date | Note (source) | Surface | Status | Investigation summary | Outcome / artifact |
|---|------|----------------|---------|--------|------------------------|--------------------|
| 1 | 2026-06-20 | "The chat basically skipped the entire interview process after it asked name and photo. Then it told me my profile and that I was basically a floater with no stats. I think the messages the 'user cancelled' just pushed it thru." (PO, Mobile) | Casting interview (0050) / FE agent loop | 🔍 Investigating | Casting interview short-circuited after name+photo → `createCharacter` finalized an empty intake → floater/no-stats. PO hypothesis: cancelled-turn ("user cancelled") messages on mobile push the flow through. | TBD |

## Status legend
- 🔍 Investigating — agent dispatched
- 📝 Spec'd — remediation spec written, not yet implemented
- 🔧 Remediating — fix in progress
- ✅ Fixed — fix landed (tested + pushed)
- ⏸️ Needs owner input — blocked on a decision
