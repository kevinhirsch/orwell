// Orwell decision guardrail (C20 / audit U1+U2) — confirm-on-binding, per ADR 0003.
//
// NOT a decision-card dashboard: play stays in conversation. This is the light guardrail on
// the COMMITMENT — when the engine pauses the loop on a pending player decision, a small card
// presents the engine's own prompt + LEGAL options, enforces the pick count, and requires one
// explicit Confirm. The confirmed selection posts ENGINE-DIRECT (POST /api/orwell/decision →
// submitDecision), so a hedge in prose can never bind through this surface; the engine still
// validates legality and stays idempotent. Dismissing the card (×) is always allowed — the
// player may instead talk it out with the game master, which drives the same validated seam.
//
// Input: chat.js dispatches `orwell:pending` with {pending} parsed from advanceGame /
// submitDecision tool results (Vault-free PendingDecisionView: kind, prompt, options[],
// appeals?, juror?, pick). Vault-free by construction; fail-open everywhere.
(function () {
  "use strict";

  const CARD_ID = "orwell-decision-card";

  // PendingDecisionView.kind → the SubmitDecisionReq wire field carrying the pick.
  // Mirrors GameSessionAdapter.toDecisionInput: `vote` carries every single-pick kind
  // except `replacement`; `choice` carries the nominations pair.
  const SINGLE_PICK_FIELD = {
    "houseguests-choice": "vote",
    "eviction-vote": "vote",
    "tie-break": "vote",
    "final-eviction": "vote",
    "juror-vote": "vote",
    "goodbye-message": "vote", // E34: the chosen tone rides `vote` (options are the tones)
    "replacement": "replacement",
  };
  const COMP_INTENTS = ["compete", "throw", "play-safe"];

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // J5-06: a confirmed card schedules its own 4s self-removal. Track that timer so a NEW card
  // arming within the window cancels it — otherwise the stale timer fires removeCard() and yanks
  // the freshly-armed (live, unconfirmed) next decision card out from under the player (TRANS-4).
  let _doneTimer = null;
  function removeCard() {
    if (_doneTimer) { clearTimeout(_doneTimer); _doneTimer = null; }
    const old = document.getElementById(CARD_ID);
    if (old) old.remove();
  }

  function ensureStyles() {
    if (document.getElementById("orwell-decision-css")) return;
    const st = document.createElement("style");
    st.id = "orwell-decision-css";
    st.textContent = `
      #${CARD_ID} {
        margin: .6rem auto; max-width: 640px; border-radius: 12px; padding: .8rem .9rem;
        background: var(--panel, #111); color: var(--fg, #9cdef2);
        border: 1px solid var(--accent, var(--red, #e06c75));
        font-size: .85rem; line-height: 1.5;
        /* J5-03: figure/ground — the binding card must lift off the chat stream like every
           OrwellWindow does. Reuse the kit's shadow token (it is the only interactive surface
           that was missing it). */
        box-shadow: var(--win-shadow, 0 8px 32px rgba(0, 0, 0, 0.45));
        /* J5-05: a brief entrance + a transition on the done-state dim, so a binding decision
           neither pops in nor flips to "✓ Locked in" as a silent text swap. */
        animation: odec-in .18s ease-out;
        transition: opacity .2s ease, border-color .2s ease;
      }
      @keyframes odec-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
      @media (prefers-reduced-motion: reduce) { #${CARD_ID} { animation: none; transition: none; } }
      #${CARD_ID} .odec-head { display: flex; align-items: baseline; gap: .5rem; }
      #${CARD_ID} .odec-title { font-weight: 700; letter-spacing: .03em; flex: 1; }
      #${CARD_ID} .odec-x { cursor: pointer; border: none; background: none; color: inherit; opacity: .75; font-size: 1rem; min-width: 44px; min-height: 44px; display: inline-flex; align-items: center; justify-content: center; }
      #${CARD_ID} .odec-x:hover { opacity: .9; }
      #${CARD_ID} .odec-prompt { margin: .35rem 0 .55rem; opacity: .9; }
      /* 0006 staged-rounds: the "still in this round" field — the narrowed roster the player reads to adapt. */
      #${CARD_ID} .odec-stillin { margin: 0 0 .55rem; font-size: .82em; opacity: .92; line-height: 1.45; }
      #${CARD_ID} .odec-stillin strong { letter-spacing: .02em; }
      #${CARD_ID} .odec-opts { display: flex; flex-wrap: wrap; gap: .4rem; }
      #${CARD_ID} .odec-opt {
        cursor: pointer; border-radius: 999px; padding: .3rem .8rem; min-height: 36px;
        /* J5-04: the plain --border (#355a66) on the chip's translucent fill is ~2.25:1 on the
           dark panel — below WCAG 1.4.11's 3:1 for a UI-component boundary. Mix toward --fg so
           the chip edge is visible in both themes (the chip is the ONLY way to make the pick). */
        border: 1px solid color-mix(in srgb, var(--border, #355a66) 55%, var(--fg, #9cdef2)); background: rgba(255,255,255,.05); color: inherit;
        font: inherit;
      }
      #${CARD_ID} .odec-opt[aria-pressed="true"] { border-color: var(--accent, #e06c75); background: var(--accent, #e06c75); color: var(--on-accent, #fff); }
      #${CARD_ID} textarea {
        width: 100%; min-height: 72px; box-sizing: border-box; margin-top: .2rem;
        background: rgba(255,255,255,.05); color: inherit; border: 1px solid var(--border, #355a66);
        border-radius: 8px; padding: .5rem; font: inherit;
      }
      #${CARD_ID} .odec-row { display: flex; align-items: center; gap: .6rem; margin-top: .65rem; }
      #${CARD_ID} .odec-confirm {
        cursor: pointer; border: none; border-radius: 8px; padding: .42rem .95rem; font-weight: 700;
        min-height: 44px;
        background: var(--accent, #e06c75); color: var(--on-accent, #fff); font: inherit;
      }
      #${CARD_ID} .odec-confirm:disabled { opacity: .4; cursor: not-allowed; }
      #${CARD_ID} .odec-note { opacity: .80; font-size: .85rem; flex: 1; }
      #${CARD_ID} .odec-err { color: var(--color-error, var(--red, #e06c75)); margin-top: .4rem; }
      #${CARD_ID}.odec-done { border-color: var(--border, #355a66); opacity: .8; }
      /* Narrow: the note must not squeeze into a thin column beside the button —
         stack it full-width above a full-width Confirm. */
      @media (max-width: 480px) {
        #${CARD_ID} .odec-row { flex-direction: column; align-items: stretch; gap: .5rem; }
        #${CARD_ID} .odec-note { flex: none; order: -1; }
        #${CARD_ID} .odec-confirm { width: 100%; padding: .6rem .95rem; }
      }
    `;
    document.head.appendChild(st);
  }

  // Build the wire payload from the current selection; null = selection incomplete.
  function buildPayload(kind, sel, freeText, useVeto) {
    if (kind === "nominations") return sel.length === 2 ? { kind, choice: sel } : null;
    if (kind === "finale-statement") return { kind, statement: freeText || "" };
    if (kind === "juror-question") return { kind, statement: freeText || "" }; // E37: scoreless free text
    if (kind === "goodbye-message") {
      // E34: a tone is required; the optional message text rides `statement`.
      return sel.length === 1 ? { kind, vote: sel[0], statement: freeText || "" } : null;
    }
    if (kind === "finale-answer") return sel.length === 1 ? { kind, appeal: sel[0] } : null;
    if (kind === "comp-intent") return sel.length === 1 ? { kind, intent: sel[0] } : null;
    // 0006 staged-rounds: the per-round approach rides `intent` exactly like comp-intent (committed for
    // THIS round only). Structured selection only — never read from prose.
    if (kind === "comp-round") return sel.length === 1 ? { kind, intent: sel[0] } : null;
    // 0061 — a confirmed self-eviction needs no pick; ONLY the explicit confirm flag binds it.
    if (kind === "self-evict") return { kind, confirmed: true };
    if (kind === "veto-decision") {
      if (useVeto === false) return { kind, use: false };
      return sel.length === 1 ? { kind, use: true, save: sel[0] } : null;
    }
    const field = SINGLE_PICK_FIELD[kind];
    if (field) return sel.length === 1 ? { kind, [field]: sel[0] } : null;
    return null;
  }

  function titleFor(kind) {
    return {
      "nominations": "Nomination ceremony — your nominations",
      "veto-decision": "Power of Veto — your call",
      "comp-intent": "Competition — set your approach",
      "comp-round": "Competition round — your approach this round",
      "houseguests-choice": "Houseguest's Choice — pick the sixth player",
      "replacement": "Veto ceremony — name the replacement",
      "eviction-vote": "Eviction — cast your vote",
      "tie-break": "Tied vote — as HOH, you decide",
      "final-eviction": "Final 3 — you evict, personally",
      "goodbye-message": "Goodbye message — your tone, your words",
      "finale-statement": "Opening statement — address the jury",
      "finale-answer": "Jury question — choose your appeal",
      "juror-question": "Your jury question — ask the finalist",
      "juror-vote": "Your jury vote — crown a winner",
      "self-evict": "Self-eviction — leave the game?",
    }[kind] || "Your decision";
  }

  function confirmLabelFor(kind, binding) {
    if (kind === "self-evict") return "Confirm — leave the game (final)";
    if (kind === "comp-round") return binding === false ? "Push through this round" : "Lock in your approach";
    return "Confirm — this is binding";
  }

  function render(pending) {
    removeCard();
    if (!pending || !pending.kind) return;
    ensureStyles();
    const chatBox = document.getElementById("chat-history");
    if (!chatBox) return;

    const kind = pending.kind;
    const pick = kind === "nominations" ? 2 : (typeof pending.pick === "number" ? Math.max(1, pending.pick) : 1);
    const multi = pick > 1;
    let sel = [];
    let useVeto = null; // veto-decision only: null=unchosen, true=use (pick save), false=don't

    const card = document.createElement("div");
    card.id = CARD_ID;
    // J4-02: role="form" makes this a named form landmark (AT users can reach it
    // via landmark navigation and know a binding decision is required).
    card.setAttribute("role", "form");
    card.setAttribute("aria-label", titleFor(kind));
    // J4-12: link the card to the instruction note so SR users hear the decision
    // context + the "your selection only" / irreversibility instruction before
    // they Tab into options.
    card.setAttribute("aria-describedby", CARD_ID + "-note");
    // Focused-context-first: while focus is in the card, Escape belongs to the
    // card's own dismiss-only handler (the global arbiter stands down on this marker).
    card.setAttribute("data-ow-escape-scope", "");

    const head = document.createElement("div");
    head.className = "odec-head";
    head.innerHTML = `<span class="odec-title">${esc(titleFor(kind))}</span>`;
    const x = document.createElement("button");
    x.className = "odec-x"; x.type = "button"; x.textContent = "×";
    x.title = "Dismiss — you can decide in conversation instead";
    // J4-03: aria-label must be as descriptive as the title so AT users hear the same
    // context as sighted users who hover. "Dismiss" alone gives no intent signal.
    x.setAttribute("aria-label", "Dismiss — decide in conversation instead");
    x.addEventListener("click", () => { _userDismissed = true; _dismissedSig = _sig(pending); removeCard(); });
    head.appendChild(x);
    card.appendChild(head);
    // F11 (DWE audit): Escape while the card holds focus = the × path — dismiss
    // only, NEVER a submit (the prose path stays open; #233's "Escape is the
    // keyboard way out" applied to the non-binding dismissal). Card-scoped so
    // the global arbiter and composer Escape behaviors are untouched.
    card.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      _userDismissed = true;
      _dismissedSig = _sig(pending);
      removeCard();
    });

    if (pending.prompt) {
      const p = document.createElement("div");
      p.className = "odec-prompt";
      p.textContent = pending.prompt + (pending.juror && pending.juror.name ? ` (asked by ${pending.juror.name})` : "");
      card.appendChild(p);
    }

    // 0006 staged-rounds: show WHO IS STILL IN this elimination round so the player adapts their
    // approach to the narrowed field (e.g. everyone left is an ally → throw; a threat still in → compete).
    if (kind === "comp-round" && Array.isArray(pending.stillIn) && pending.stillIn.length) {
      const still = document.createElement("div");
      still.className = "odec-stillin";
      const names = pending.stillIn.map((r) => esc(r.name || String(r.id))).join(", ");
      const r = (typeof pending.round === "number" && pending.round > 0) ? `Round ${pending.round} — ` : "";
      still.innerHTML = `<strong>${r}Still in:</strong> ${names}`;
      card.appendChild(still);
    }

    const opts = document.createElement("div");
    opts.className = "odec-opts";
    card.appendChild(opts);

    let textarea = null;
    const confirm = document.createElement("button");
    confirm.className = "odec-confirm"; confirm.type = "button";
    // 0006 staged-rounds: only the FIRST comp-round BINDS (the approach the single outcome roll honors);
    // later rounds are non-binding FLAVOR over an already-decided result (audit 2026-06-20) — phrase the
    // confirm so a flavor round reads as "push through", never a fresh stakes commitment.
    confirm.textContent = kind === "comp-round"
      ? (pending.binding === false ? "Push through this round" : "Lock in your approach")
      : "Confirm — this is binding";
    confirm.disabled = true;

    const sync = () => { confirm.disabled = buildPayload(kind, sel, textarea && textarea.value.trim(), useVeto) == null; };

    const addChip = (label, value) => {
      const b = document.createElement("button");
      b.className = "odec-opt"; b.type = "button";
      b.setAttribute("aria-pressed", "false");
      b.textContent = label;
      b.addEventListener("click", () => {
        const on = b.getAttribute("aria-pressed") === "true";
        if (on) {
          sel = sel.filter((v) => v !== value);
          b.setAttribute("aria-pressed", "false");
        } else {
          if (!multi) {
            sel = [];
            opts.querySelectorAll('.odec-opt[aria-pressed="true"]').forEach((n) => n.setAttribute("aria-pressed", "false"));
          } else if (sel.length >= pick) {
            return; // pick-count enforced: deselect something first
          }
          sel.push(value);
          b.setAttribute("aria-pressed", "true");
        }
        sync();
      });
      opts.appendChild(b);
      return b;
    };

    if (kind === "finale-statement") {
      textarea = document.createElement("textarea");
      textarea.placeholder = "Your opening statement to the jury…";
      textarea.setAttribute("aria-label", "Your opening statement to the jury"); // J5-02: placeholders aren't accessible names
      textarea.addEventListener("input", sync);
      card.appendChild(textarea);
      confirm.disabled = false; // a statement may be short; engine treats it as flavor
    } else if (kind === "juror-question") {
      // E37: scoreless free text — the player-juror's own question to the finalist.
      textarea = document.createElement("textarea");
      textarea.placeholder = "Your question to the finalist…";
      textarea.setAttribute("aria-label", "Your question to the finalist"); // J5-02
      textarea.addEventListener("input", sync);
      card.appendChild(textarea);
      confirm.disabled = false; // free text; the engine scores nothing here
    } else if (kind === "goodbye-message") {
      // E34: pick a tone (the binding part) + optional message text (the model voices it).
      (pending.options || []).forEach((o) => addChip(o.name || String(o.id), o.id));
      textarea = document.createElement("textarea");
      textarea.placeholder = "Your goodbye message (optional — the tone is what binds)…";
      textarea.setAttribute("aria-label", "Your goodbye message (optional)"); // J5-02
      textarea.addEventListener("input", sync);
      card.appendChild(textarea);
    } else if (kind === "finale-answer") {
      (Array.isArray(pending.appeals) && pending.appeals.length ? pending.appeals : []).forEach((a) => addChip(String(a), String(a)));
    } else if (kind === "comp-intent" || kind === "comp-round") {
      // 0006 staged-rounds: the same compete/throw/play-safe approaches, but per-round for comp-round.
      const chips = COMP_INTENTS.map((i) => addChip(i, i));
      // audit 2026-06-20: only the FIRST comp-round binds (the intent the single outcome roll honored).
      // A later round is non-binding FLAVOR over an already-decided result — default it to "compete" so
      // the player can one-click "Push through" (still free to pick a different colour, or dismiss).
      if (kind === "comp-round" && pending.binding === false && chips[0]) {
        sel = [COMP_INTENTS[0]];
        chips[0].setAttribute("aria-pressed", "true");
        confirm.disabled = false;
      }
    } else if (kind === "self-evict") {
      // 0061: no options to pick — an explicit Confirm IS the irreversible decision (a Cancel
      // button is added to the row below, posting the engine cancel so the player plays on).
      confirm.disabled = false;
      confirm.textContent = "Confirm — leave the game (final)";
    } else if (kind === "veto-decision") {
      const dont = addChip("Don't use the veto", "__dont__");
      dont.addEventListener("click", () => {
        useVeto = useVeto === false ? null : false;
        sel = [];
        opts.querySelectorAll('.odec-opt[aria-pressed="true"]').forEach((n) => n.setAttribute("aria-pressed", "false"));
        dont.setAttribute("aria-pressed", useVeto === false ? "true" : "false");
        sync();
      });
      (pending.options || []).forEach((o) => {
        const chip = addChip("Save " + (o.name || o.id), o.id);
        chip.addEventListener("click", () => {
          useVeto = sel.length === 1 ? true : null;
          dont.setAttribute("aria-pressed", "false");
          sync();
        });
      });
    } else {
      (pending.options || []).forEach((o) => addChip(o.name || String(o.id), o.id));
    }

    const row = document.createElement("div");
    row.className = "odec-row";
    const note = document.createElement("span");
    note.className = "odec-note";
    note.id = CARD_ID + "-note";
    if (kind === "self-evict") {
      note.textContent = "This ends and forfeits your game — it cannot be undone.";
    } else if (kind === "comp-round") {
      // 0006 staged-rounds (audit 2026-06-20): the first round sets the binding approach; later rounds
      // are color over an already-decided result, so say so plainly rather than implying fresh stakes.
      note.textContent = pending.binding === false
        ? "No stakes here — your approach was locked in round one. Push through, or dismiss to play it out in conversation."
        : "This sets how you play the comp. Your selection only — never read from prose.";
    } else if (kind === "juror-question") {
      // J5-01: this card IS a prose textarea — the generic "never read from prose" note (announced
      // via aria-describedby) directly contradicted the only input on the card.
      note.textContent = "Your own words — type your question, then Confirm. Leave it blank to pass.";
    } else if (kind === "finale-statement") {
      note.textContent = "Your own words — type your statement to the jury, then Confirm.";
    } else if (kind === "goodbye-message") {
      // J5-01: the tone chip binds (the written message is optional) — say so, since Confirm stays
      // disabled until a tone is picked and nothing else explained why.
      note.textContent = "Pick a tone — that's what binds. Your written message is optional.";
    } else {
      note.textContent = multi ? `Select ${pick} — only a legal move counts.` : "Your selection only — never read from prose.";
    }
    row.appendChild(note);
    // 0061: a self-eviction confirmation gets an explicit CANCEL — declining must clear the engine
    // confirmation so the player simply plays on (never a fabricated, half-committed exit).
    if (kind === "self-evict") {
      const cancel = document.createElement("button");
      cancel.className = "odec-opt"; cancel.type = "button";
      cancel.textContent = "Cancel — stay in the house";
      cancel.addEventListener("click", async () => {
        _userDismissed = true;
        _dismissedSig = _sig(pending);
        try {
          await fetch("/api/orwell/self-eviction/cancel", { method: "POST", credentials: "same-origin" });
        } catch (_) { if (window.OrwellReport) window.OrwellReport.fail("self-evict", "cancel-post", _); }
        if (window.orwellGameChanged) window.orwellGameChanged("self-evict:cancel");
        removeCard();
      });
      row.appendChild(cancel);
    }
    row.appendChild(confirm);
    card.appendChild(row);

    // J4-09: pre-declare the error region before it might be populated — dynamic
    // live-region injection is unreliable across AT/browser pairs; a pre-existing
    // role="alert" ensures all AT pairs announce the error text when it's set.
    const err = document.createElement("div");
    err.className = "odec-err";
    err.setAttribute("role", "alert");
    err.setAttribute("aria-live", "assertive");
    err.setAttribute("aria-atomic", "true");
    card.appendChild(err);

    confirm.addEventListener("click", async () => {
      const payload = buildPayload(kind, sel, textarea && textarea.value.trim(), useVeto);
      if (!payload) return;
      confirm.disabled = true;
      confirm.textContent = "Locking in…";
      try {
        const r = await fetch("/api/orwell/decision", {
          method: "POST", credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!r.ok) throw new Error("HTTP " + r.status);
        _userDismissed = true;   // this pending is handled — stop any boot re-assert loop
        _dismissedSig = _sig(pending);
        // G15: a bound decision mutates the game — nudge every panel through the
        // shared debounced dispatcher NOW, not at the next 20–30s poll.
        if (window.orwellGameChanged) window.orwellGameChanged("decision:" + kind);
        card.classList.add("odec-done");
        card.innerHTML = `<div class="odec-head"><span class="odec-title">✓ Locked in.</span></div>`;
        // The play continues in conversation: prefill (never auto-send) so the model
        // narrates the ceremony from FRESH engine state on the player's next turn.
        const box = document.getElementById("message");
        if (box && !box.value.trim()) {
          box.value = "I've made my decision — let's see how the house takes it.";
          box.dispatchEvent(new Event("input", { bubbles: true }));
          box.focus();
        }
        _doneTimer = setTimeout(() => {
          // J5-06: only remove if THIS card is still the lingering done-card — never a card that
          // re-armed into the same id within the 4s window (removeCard() also clears this timer).
          if (card.isConnected && card.classList.contains("odec-done")) card.remove();
          _doneTimer = null;
        }, 4000);
      } catch (_) {
        if (window.OrwellReport) window.OrwellReport.fail("decision", "submit-post", _); // G11: fail open, never silent
        confirm.disabled = false;
        // J4-08: restore the correct confirm label — mirrors the initial render,
        // including the self-evict irreversibility signal and non-binding round phrasing.
        confirm.textContent = confirmLabelFor(kind, pending.binding);
        // J4-09: err is pre-declared with role="alert" — set textContent to trigger announcement
        err.textContent = "That didn't go through (your move wasn't allowed, or the feed glitched). Adjust and try again, or decide in conversation.";
      }
    });

    chatBox.appendChild(card);
    card.scrollIntoView({ block: "nearest" });
    // J3-18: move focus to the card so keyboard/SR users know a binding decision appeared.
    // tabindex=-1 allows programmatic focus without adding the card to the Tab order.
    card.setAttribute("tabindex", "-1");
    card.focus();
  }

  // chat.js dispatches this from advanceGame/submitDecision tool results.
  // D3/E66: a pending decision must survive a reload. The card is event-mounted
  // on live turns; on boot (and on a game change) we re-arm it from the status
  // route's cached `pending` — the engine's own legal-options view. Without this,
  // refreshing mid-decision left the player with no card and no signal.
  let _userDismissed = false;   // set when the player explicitly dismisses (×/Escape)
  // F2 (audit): the signature of the pending the player dismissed, so a later `gamechanged`
  // (or the status re-poll) re-arms a genuinely NEW decision but NEVER re-shoves the SAME card
  // the player just waved away to decide in conversation.
  let _dismissedSig = null;
  const _sig = (p) => (p && p.kind)
    ? p.kind + "|" + ((p.options || []).map((o) => o && o.id).join(",")) + "|" + (p.prompt || "")
    : "";
  async function rearmFromStatus() {
    try {
      const r = await fetch("/api/orwell/status", { credentials: "same-origin" });
      if (!r.ok) return;
      const st = await r.json();
      const pending = st && st.pending && st.pending.kind ? st.pending : null;
      if (!pending) return;
      // F2: don't re-nag the EXACT card the player dismissed — a `gamechanged` / re-poll of the
      // SAME pending must stay dismissed; only a genuinely DIFFERENT pending re-arms.
      if (_userDismissed && _sig(pending) === _dismissedSig) return;
      _userDismissed = false;   // a fresh (different) pending arrived — honor it again
      // The game build mounts #chat-history ASYNCHRONOUSLY and then renders the session's
      // history INTO it after DOMContentLoaded — a boot rearm that fired early either had
      // no host or got wiped when the history re-rendered, so a refresh mid-decision left
      // the player with no card (the E66 path was a no-op in practice). Re-assert the card
      // until it is STABLY mounted (survives the boot history render), then stop — never
      // fight an explicit dismissal or a submit (both set _userDismissed).
      let stable = 0;
      for (let i = 0; i < 25 && !_userDismissed; i++) {
        const host = document.getElementById("chat-history");
        // A lingering "✓ Locked in" (.odec-done) card from the PRIOR decision must not block a NEW
        // pending from arming (audit 2026-06-20): the next round's card could otherwise be suppressed
        // by the done-card still holding CARD_ID during its 4s fade. Treat it as absent so the fresh
        // decision card replaces it; a LIVE (not-done) card is left alone (stable branch below).
        const _doneCard = document.getElementById(CARD_ID);
        if (_doneCard && _doneCard.classList.contains("odec-done")) _doneCard.remove();
        if (host && !document.getElementById(CARD_ID)) {
          window.dispatchEvent(new CustomEvent("orwell:pending", { detail: { pending } }));
          stable = 0;
        } else if (document.getElementById(CARD_ID)) {
          if (++stable >= 3) break;   // survived ~600ms → boot settled, stop re-asserting
        }
        await new Promise((res) => setTimeout(res, 200));
      }
    } catch (_) { /* fail open */ }
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", rearmFromStatus, { once: true });
  } else { rearmFromStatus(); }
  window.addEventListener("orwell:gamechanged", rearmFromStatus);
  // S4-1 (E2E audit) — the structural escape hatch: a pending player decision must be reachable
  // WITHOUT the chat agent ever dispatching it. `orwell:gamechanged` fires only on a LOCAL
  // game-mutating tool, so a pending that surfaces with no such event in this tab (the model
  // narrated past it without calling submitDecision, another device advanced, a missed tool call)
  // would otherwise sit unreachable until a reload. Poll the engine's own `pending` on a slow
  // cadence as a backstop. This deliberately does NOT call rearmFromStatus (which clears
  // _userDismissed) — it surfaces a pending ONLY when the player hasn't dismissed it and no card
  // is already up, so it never re-nags a waved-away card. Fail-open everywhere.
  setInterval(async () => {
    try {
      if (_userDismissed) return;                      // respect an explicit dismissal
      if (document.getElementById(CARD_ID)) return;    // a card is already showing
      if (!document.getElementById("chat-history")) return;
      const r = await fetch("/api/orwell/status", { credentials: "same-origin" });
      if (!r.ok) return;
      const st = await r.json();
      const pending = st && st.pending && st.pending.kind ? st.pending : null;
      if (pending && !document.getElementById(CARD_ID)) {
        window.dispatchEvent(new CustomEvent("orwell:pending", { detail: { pending } }));
      }
    } catch (_) { /* fail open — the conversation path always remains */ }
  }, 15000);

  window.addEventListener("orwell:pending", (e) => {
    try {
      render(e.detail && e.detail.pending);
    } catch (_) { /* fail open — the conversation path always remains */ }
  });
})();
