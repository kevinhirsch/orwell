# 0012 — Two-window lockstep "Messenger mirror" for live game conversations

> **Status:** **Proposed (2026-06-21).** Root-caused in the pre-launch playtest audit as the
> live-stream sibling of the settled-log defect ADR 0008 closed. Operator report: two browser
> windows open on the same game render **divergent** conversations during live generation — *"for
> 30 seconds each window types different responses,"* then they **snap** to the same final state
> after many seconds, *"out of sync and messy."* The hard requirement: windows must mirror
> **byte-identical and in lockstep, like Facebook Messenger** — it must not matter which window
> initiated; the **same tokens appear in all windows at the same time.**
> **Source:** the two-window live-stream parity investigation — distinct from S3-RACE (ADR 0008,
> the settled-**log** divergence, BUILT) and S3-LOOP (ADR 0011, the concurrent 20-step **loop**
> spin, BUILT). Both fixed *adjacent* surfaces; neither makes the **live token stream** itself a
> shared resource.
> **Builds on:** ADR 0003 (the conversation IS the game), ADR 0005 (split authority by openness —
> the engine never normalizes the open-set narration), ADR 0008 (the per-session `seq` log +
> reconcile-by-id + completion broadcast), ADR 0011 (beat-aware concurrent guardrails),
> feature 0064 (the **Messenger model** — any device types anytime; turn-lock/spectator
> *rejected*, `frontend/tests/test_0064_salvage.py`), and feature 0065 (the engine closed-set
> `beatSeq` spine + the 409 `stale-beat` CAS).
> **Inherits / bounded by:** the **Vault Wall** (mandate #2) and **cross-user isolation** (0021) —
> unchanged: the shared run carries the same Vault-free narration the single window already
> renders; no secret state, no new surface. This governs only the **open-set** narration mirror;
> closed-set serialization stays the engine's job (0065).

## Context

ADR 0008 made the **settled message log** consistent across a user's windows — a per-session
`seq`, reconcile-by-id, and a completion broadcast — so two windows converge to a byte-identical
**finished** transcript. ADR 0011 stopped two concurrent sessions from spinning the agent loop.
Both reconcile the **settled** state. Neither touches what happens **during** generation.

The pre-launch audit found the gap squarely **between** them: two windows on the same game **type
different responses for the whole live stream.** Each window runs **its own** generation for the
turn, so the **open-set narration** — which ADR 0005 constitutionally protects as infinite and
**never normalizes** — diverges window-to-window even while the closed set (`beatSeq`, the board)
stays perfectly consistent. The windows only "snap" together when ADR 0008's settled-log
reconcile lands, many seconds later. The shared-reality premise of ADR 0003 ("the conversation
IS the game") is broken in the meantime: two people watching the same game watch two different
games.

### Root cause

The **live token stream is not a shared broadcast resource.** The FE already has a
replay-then-subscribe primitive — `agent_runs._Run`, the buffer ADR 0008's run-by-id work leans
on — but for an ordinary **game turn** it is **bypassed**: the initiating window streams the
agent loop straight to its own DOM, and a second window has nothing to attach to, so it starts a
parallel run of its own. Two runs ⇒ two independent open-set generations ⇒ two transcripts that
agree only on the closed set. Compounding it, the `message-added` completion broadcast leg
(ADR 0008) is **dead** on this path, so even the settled-state convergence is later than it
should be.

This is the **live-stream** analog of ADR 0008's settled-log defect: an optimistic, per-window
private stream where the intended model is **one authoritative run every window renders from.**

## Decision

Make the **live narration stream for a game turn a single authoritative server-side run, fanned
out token-by-token to every open window** on that canonical game session. Windows **do not run
their own generation** — they **subscribe**.

1. **One run, fanned out.** The turn's agent loop streams into **one shared replay buffer**;
   every window on the session tees off it. The initiating window's stream is **teed to the
   shared buffer** rather than rendered privately. Which window initiated is irrelevant — the
   tokens are the same in all of them, at the same time.
2. **Replay-then-live-tail, keyed to the canonical session.** A window subscribes by replaying
   the buffer to catch up, then live-tailing — so a window **opened or refreshed mid-generation**
   joins the in-flight stream and renders the **same** tokens from where it is, not a fresh run.
   Reuse the existing `agent_runs._Run` replay/subscribe primitive (today bypassed for game
   turns), keyed to the engine **canonical session** (the per-game key), **not** the per-tab
   session id.
3. **Closed-set serialization stays the engine's.** 0012 governs **only** the open-set narration
   mirror. Progression, the board, and 409/CAS ordering remain the engine's job under
   feature 0065 (the `beatSeq` spine); ADR 0005's split holds — the engine still never normalizes
   the open-set prose.
4. **Fold in the dead completion leg.** Re-wire the `message-added` broadcast (ADR 0008) so a
   persisted assistant message **always** notifies, closing the settled-state convergence gap on
   this path too.
5. **Single-window behavior is byte-identical.** With one subscriber, the shared run renders
   exactly as today — the tee and replay are inert without a second window.

This is **FE-side** and explicitly **not** a turn-lock or spectator design — feature 0064's
Messenger ruling stands (any window may type anytime; `test_0064_salvage.py` pins the lock design
out of the tree). The implementation design lives in
`docs/audits/2026-06-21-mirror-C-fix-design.md` (parallel work) — the binding **build plan** for
this record.

## Alternatives considered

- **Leaf patch — broadcast the *finished* message faster / lean harder on ADR 0008's reconcile.**
  *Rejected.* It only narrows the snap window; the windows still **diverge for the whole live
  stream** because each still runs its own generation. ADR 0008 reconciles the **settled
  message**, not the **live stream** — by construction it cannot mirror tokens as they arrive.
- **A client turn-lock / spectator (only the initiating window streams; others wait).** *Rejected
  — forbidden by feature 0064's Messenger ruling.* It also regresses the cross-device promise and
  is exactly the design `test_0064_salvage.py` pins out.
- **Normalize/​re-derive the narration so two independent runs agree.** *Rejected — violates
  ADR 0005.* The open set is constitutionally un-normalized; two free generations will not be
  byte-identical, and forcing them to be flattens play. The only way to guarantee identical
  tokens is **one** run shared, not two runs reconciled.

## Consequences

- **Two windows mirror byte-identical, in lockstep, during live play** — the same tokens at the
  same time, regardless of which window initiated — and a window opened/refreshed mid-generation
  joins the in-flight stream. The ADR 0003 shared-reality premise holds *during* the turn, not
  only after it settles.
- **Cost:** the initiating window's stream must be **teed to a shared buffer** (it no longer
  renders a private copy); reconnection/late-join **replays** that buffer. This reuses the
  existing `_Run` primitive rather than adding new transport.
- **The dead `message-added` leg is revived**, so settled-state convergence (ADR 0008) also lands
  promptly on the game-turn path.
- **Vault Wall + cross-user isolation untouched** — the shared run carries the same Vault-free
  narration a single window already renders; keying on the **canonical session** preserves
  cross-user isolation.
- **Single-window play is byte-identical** (the tee/replay are inert with one subscriber).
- **Verification (binding):** a **two-window filmstrip harness** (being built in parallel) must
  show **byte-identical token timelines** across windows during live generation — including a
  window that joins mid-stream — and a **50× concurrent smoke loop** must come out clean. Because
  every automated gate **stubs the LLM**, a **mandatory live-LLM gate** (a real two-window run)
  is required **before merge**.

## Open / to confirm

- **The mid-generation join boundary.** Replay-then-tail must hand a late window the exact buffer
  prefix with no duplicated or dropped tokens at the splice; pin the replay/​live-tail handoff in
  the harness.
- **Canonical-session keying at cold start.** Before a canonical session is bound (the ADR 0011
  cold-start window — two fresh windows each opening a separate run), the fan-out has no shared
  key yet; bind the canonical session **before** the first shared run starts.
- **Buffer retention / teardown.** How long the shared replay buffer is held after `[DONE]`
  (enough for a late refresh to catch the just-finished turn, then released) — a retention knob,
  not a correctness question.
- **The live-LLM gate cadence.** The automated harness proves token-timeline parity against a
  stub; the real-model two-window run is manual-before-merge — confirm whether it folds into the
  CI `frontend` job or stays a dedicated session.
