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

  function removeCard() {
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
      }
      #${CARD_ID} .odec-head { display: flex; align-items: baseline; gap: .5rem; }
      #${CARD_ID} .odec-title { font-weight: 700; letter-spacing: .03em; flex: 1; }
      #${CARD_ID} .odec-x { cursor: pointer; border: none; background: none; color: inherit; opacity: .55; font-size: 1rem; }
      #${CARD_ID} .odec-x:hover { opacity: .9; }
      #${CARD_ID} .odec-prompt { margin: .35rem 0 .55rem; opacity: .9; }
      /* 0006 staged-rounds: the "still in this round" field — the narrowed roster the player reads to adapt. */
      #${CARD_ID} .odec-stillin { margin: 0 0 .55rem; font-size: .82em; opacity: .92; line-height: 1.45; }
      #${CARD_ID} .odec-stillin strong { letter-spacing: .02em; }
      #${CARD_ID} .odec-opts { display: flex; flex-wrap: wrap; gap: .4rem; }
      #${CARD_ID} .odec-opt {
        cursor: pointer; border-radius: 999px; padding: .3rem .8rem;
        border: 1px solid var(--border, #355a66); background: rgba(255,255,255,.05); color: inherit;
        font: inherit;
      }
      #${CARD_ID} .odec-opt[aria-pressed="true"] { border-color: var(--accent, #e06c75); background: var(--accent, #e06c75); color: #fff; }
      #${CARD_ID} textarea {
        width: 100%; min-height: 72px; box-sizing: border-box; margin-top: .2rem;
        background: rgba(255,255,255,.05); color: inherit; border: 1px solid var(--border, #355a66);
        border-radius: 8px; padding: .5rem; font: inherit;
      }
      #${CARD_ID} .odec-row { display: flex; align-items: center; gap: .6rem; margin-top: .65rem; }
      #${CARD_ID} .odec-confirm {
        cursor: pointer; border: none; border-radius: 8px; padding: .42rem .95rem; font-weight: 700;
        background: var(--accent, #e06c75); color: #fff; font: inherit;
      }
      #${CARD_ID} .odec-confirm:disabled { opacity: .4; cursor: not-allowed; }
      #${CARD_ID} .odec-note { opacity: .65; font-size: .78em; flex: 1; }
      #${CARD_ID} .odec-err { color: var(--red, #e06c75); margin-top: .4rem; }
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
      "finale-statement": "Finale — your statement to the jury",
      "finale-answer": "Jury question — choose your appeal",
      "juror-question": "Your jury question — ask the finalist",
      "juror-vote": "Your jury vote — crown a winner",
      "self-evict": "Self-eviction — leave the game?",
    }[kind] || "Your decision";
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
    card.setAttribute("role", "group");
    card.setAttribute("aria-label", titleFor(kind));
    // Focused-context-first: while focus is in the card, Escape belongs to the
    // card's own dismiss-only handler (the global arbiter stands down on this marker).
    card.setAttribute("data-ow-escape-scope", "");

    const head = document.createElement("div");
    head.className = "odec-head";
    head.innerHTML = `<span class="odec-title">${esc(titleFor(kind))}</span>`;
    const x = document.createElement("button");
    x.className = "odec-x"; x.type = "button"; x.textContent = "×";
    x.title = "Dismiss — you can decide in conversation instead";
    x.setAttribute("aria-label", "Dismiss");
    x.addEventListener("click", () => { _userDismissed = true; removeCard(); });
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
      textarea.addEventListener("input", sync);
      card.appendChild(textarea);
      confirm.disabled = false; // a statement may be short; engine treats it as flavor
    } else if (kind === "juror-question") {
      // E37: scoreless free text — the player-juror's own question to the finalist.
      textarea = document.createElement("textarea");
      textarea.placeholder = "Your question to the finalist…";
      textarea.addEventListener("input", sync);
      card.appendChild(textarea);
      confirm.disabled = false; // free text; the engine scores nothing here
    } else if (kind === "goodbye-message") {
      // E34: pick a tone (the binding part) + optional message text (the model voices it).
      (pending.options || []).forEach((o) => addChip(o.name || String(o.id), o.id));
      textarea = document.createElement("textarea");
      textarea.placeholder = "Your goodbye message (optional — the tone is what binds)…";
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
    if (kind === "self-evict") {
      note.textContent = "This ends and forfeits your game — it cannot be undone.";
    } else if (kind === "comp-round") {
      // 0006 staged-rounds (audit 2026-06-20): the first round sets the binding approach; later rounds
      // are color over an already-decided result, so say so plainly rather than implying fresh stakes.
      note.textContent = pending.binding === false
        ? "Just color — your approach was locked in the first round. Push through, or dismiss to play it out in conversation."
        : "This sets how you play the comp. Your selection only — never read from prose.";
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
        setTimeout(removeCard, 4000);
      } catch (_) {
        if (window.OrwellReport) window.OrwellReport.fail("decision", "submit-post", _); // G11: fail open, never silent
        confirm.disabled = false;
        confirm.textContent = kind === "comp-round" ? "Lock in this round" : "Confirm — this is binding";
        let err = card.querySelector(".odec-err");
        if (!err) {
          err = document.createElement("div");
          err.className = "odec-err";
          card.appendChild(err);
        }
        err.textContent = "That didn't go through (your move wasn't allowed, or the feed glitched). Adjust and try again, or decide in conversation.";
      }
    });

    chatBox.appendChild(card);
    card.scrollIntoView({ block: "nearest" });
  }

  // chat.js dispatches this from advanceGame/submitDecision tool results.
  // D3/E66: a pending decision must survive a reload. The card is event-mounted
  // on live turns; on boot (and on a game change) we re-arm it from the status
  // route's cached `pending` — the engine's own legal-options view. Without this,
  // refreshing mid-decision left the player with no card and no signal.
  let _userDismissed = false;   // set when the player explicitly dismisses (×/Escape)
  async function rearmFromStatus() {
    try {
      const r = await fetch("/api/orwell/status", { credentials: "same-origin" });
      if (!r.ok) return;
      const st = await r.json();
      const pending = st && st.pending && st.pending.kind ? st.pending : null;
      if (!pending) return;
      _userDismissed = false;   // a fresh pending arrived — honor it again
      // The game build mounts #chat-history ASYNCHRONOUSLY and then renders the session's
      // history INTO it after DOMContentLoaded — a boot rearm that fired early either had
      // no host or got wiped when the history re-rendered, so a refresh mid-decision left
      // the player with no card (the E66 path was a no-op in practice). Re-assert the card
      // until it is STABLY mounted (survives the boot history render), then stop — never
      // fight an explicit dismissal or a submit (both set _userDismissed).
      let stable = 0;
      for (let i = 0; i < 25 && !_userDismissed; i++) {
        const host = document.getElementById("chat-history");
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

  window.addEventListener("orwell:pending", (e) => {
    try {
      render(e.detail && e.detail.pending);
    } catch (_) { /* fail open — the conversation path always remains */ }
  });
})();
