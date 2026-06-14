// Orwell casting headshot (feature G26) — the player's OWN portrait, uploaded during casting.
//
// During the pre-game casting interview the producer offers an OPTIONAL headshot step: upload
// a photo to be your houseguest portrait, two ways —
//   • exact     — your photo, cropped to your face, used as-is (no AI);
//   • reference — an AI studio portrait that keeps your likeness (the G24 candid style).
//
// It is OPTIONAL and NON-BLOCKING: skip it and your portrait generates from your described
// look like everyone else's. Shown ONLY pre-game (state.started === false) on the game build,
// removed the moment the season starts. Vault-safe by construction: it sends only the player's
// own uploaded image — never any game state. Fail-open everywhere.
(function () {
  "use strict";

  const ID = "orwell-headshot";
  const ready = (fn) =>
    document.readyState === "loading"
      ? document.addEventListener("DOMContentLoaded", fn, { once: true })
      : fn();

  async function getJSON(url, opts) {
    const r = await fetch(url, Object.assign({ credentials: "same-origin" }, opts || {}));
    return r.ok ? r.json() : null;
  }

  function ensureCss() {
    if (document.getElementById("orwell-headshot-css")) return;
    const s = document.createElement("style");
    s.id = "orwell-headshot-css";
    s.textContent = `
      #${ID} { margin: 0 auto 8px; max-width: 760px; width: 100%;
        border: 1px solid var(--border, #355a66); border-radius: 10px;
        background: color-mix(in srgb, var(--panel, #1b1f27) 92%, transparent);
        font-size: 13px; overflow: hidden; }
      #${ID} .hs-head { display: flex; align-items: center; gap: 8px; cursor: pointer;
        padding: 8px 12px; user-select: none; color: var(--fg, #cfd8e3); }
      #${ID} .hs-head .hs-chev { margin-left: auto; opacity: .6; transition: transform .15s; }
      #${ID}.hs-open .hs-head .hs-chev { transform: rotate(90deg); }
      #${ID} .hs-body { display: none; padding: 4px 12px 12px; }
      #${ID}.hs-open .hs-body { display: block; }
      #${ID} .hs-row { display: flex; gap: 12px; align-items: flex-start; flex-wrap: wrap; }
      #${ID} .hs-preview { width: 84px; height: 84px; border-radius: 8px; flex: none;
        border: 1px solid var(--border, #355a66); background: #0d0f14 center/cover no-repeat;
        display: flex; align-items: center; justify-content: center; font-size: 26px; opacity: .8; }
      #${ID} .hs-opts { flex: 1; min-width: 220px; display: flex; flex-direction: column; gap: 7px; }
      #${ID} label.hs-opt { display: flex; gap: 8px; align-items: flex-start; cursor: pointer; line-height: 1.35; }
      #${ID} label.hs-opt small { display: block; opacity: .65; }
      #${ID} .hs-actions { display: flex; gap: 8px; align-items: center; margin-top: 10px; flex-wrap: wrap; }
      #${ID} .hs-btn { font: inherit; font-size: 12.5px; padding: 6px 12px; border-radius: 8px; cursor: pointer;
        background: var(--brand-color, var(--accent, #4a9)); color: var(--bg, #111); border: 1px solid transparent; font-weight: 600; }
      #${ID} .hs-btn[disabled] { opacity: .5; cursor: default; }
      #${ID} .hs-btn-ghost { background: transparent; color: var(--fg, #cfd8e3); border-color: var(--border, #355a66); font-weight: 400; }
      #${ID} .hs-msg { opacity: .75; font-size: 12px; }
      @media (prefers-reduced-motion: reduce) { #${ID} .hs-head .hs-chev { transition: none; } }`;
    document.head.appendChild(s);
  }

  function buildCard() {
    const el = document.createElement("div");
    el.id = ID;
    el.innerHTML = `
      <div class="hs-head" role="button" tabindex="0" aria-expanded="false">
        <span>📷</span><b>Casting headshot</b><span class="hs-msg" id="hs-summary">optional</span>
        <span class="hs-chev">▶</span>
      </div>
      <div class="hs-body">
        <div class="hs-row">
          <div class="hs-preview" id="hs-preview">👤</div>
          <div class="hs-opts">
            <input type="file" id="hs-file" accept="image/*" aria-label="Choose a photo">
            <label class="hs-opt"><input type="radio" name="hs-mode" value="reference" checked>
              <span>Make my studio portrait look like me<small>AI recreates you in the house style, keeping your likeness</small></span></label>
            <label class="hs-opt"><input type="radio" name="hs-mode" value="exact">
              <span>Use my photo as-is<small>Cropped to your face, no AI</small></span></label>
          </div>
        </div>
        <div class="hs-actions">
          <button type="button" class="hs-btn" id="hs-save" disabled>Save headshot</button>
          <button type="button" class="hs-btn hs-btn-ghost" id="hs-remove" style="display:none">Remove</button>
          <span class="hs-msg" id="hs-status"></span>
        </div>
      </div>`;
    return el;
  }

  function wire(el) {
    const head = el.querySelector(".hs-head");
    const fileInput = el.querySelector("#hs-file");
    const preview = el.querySelector("#hs-preview");
    const saveBtn = el.querySelector("#hs-save");
    const removeBtn = el.querySelector("#hs-remove");
    const status = el.querySelector("#hs-status");
    const summary = el.querySelector("#hs-summary");

    const toggle = () => {
      const open = el.classList.toggle("hs-open");
      head.setAttribute("aria-expanded", open ? "true" : "false");
    };
    head.addEventListener("click", toggle);
    head.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } });

    let pending = null; // the chosen File
    fileInput.addEventListener("change", () => {
      pending = fileInput.files && fileInput.files[0];
      saveBtn.disabled = !pending;
      if (pending) {
        const url = URL.createObjectURL(pending);
        preview.style.backgroundImage = `url("${url}")`;
        preview.textContent = "";
      }
    });

    function reflect(meta) {
      const present = meta && meta.present;
      summary.textContent = present
        ? (meta.mode === "exact" ? "your photo — on file" : "studio portrait — on file")
        : "optional";
      removeBtn.style.display = present ? "" : "none";
    }

    saveBtn.addEventListener("click", async () => {
      if (!pending) return;
      const mode = (el.querySelector('input[name="hs-mode"]:checked') || {}).value || "reference";
      saveBtn.disabled = true; status.textContent = "Uploading…";
      try {
        const fd = new FormData();
        fd.append("file", pending);
        fd.append("mode", mode);
        const r = await fetch("/api/orwell/portrait/intake", { method: "POST", credentials: "same-origin", body: fd });
        const d = r.ok ? await r.json() : null;
        if (d && d.ok) {
          status.textContent = "Saved — this becomes your portrait when the season starts.";
          reflect({ present: true, mode: d.mode });
        } else {
          status.textContent = (d && d.error) || "That image couldn't be used — try another.";
          saveBtn.disabled = false;
        }
      } catch (e) {
        if (window.OrwellReport) window.OrwellReport.fail("headshot", "upload", e);
        status.textContent = "Upload failed — the photo service is offline.";
        saveBtn.disabled = false;
      }
    });

    removeBtn.addEventListener("click", async () => {
      status.textContent = "Removing…";
      try {
        await fetch("/api/orwell/portrait/intake", { method: "DELETE", credentials: "same-origin" });
      } catch (_) {}
      status.textContent = "Removed — your portrait will be generated from your described look.";
      reflect({ present: false });
      saveBtn.disabled = !pending;
    });

    // Reflect any existing intake on mount.
    getJSON("/api/orwell/portrait/intake").then((m) => { if (m) reflect(m); }).catch(() => {});
  }

  function mount() {
    if (document.getElementById(ID)) return;
    const bar = document.querySelector(".chat-input-bar");
    if (!bar || !bar.parentNode) return;
    ensureCss();
    const el = buildCard();
    bar.parentNode.insertBefore(el, bar);
    wire(el);
  }

  function unmount() {
    const el = document.getElementById(ID);
    if (el) el.remove();
  }

  async function route() {
    const gameBuild = document.body && document.body.hasAttribute("data-game-build");
    if (!gameBuild) return;            // only the game build runs casting
    try {
      const st = await getJSON("/api/orwell/state");
      if (st && st.started === false) mount();   // pre-game casting → offer the headshot
      else unmount();                            // a season is running (or unknown) → not shown
    } catch (_) { /* engine unreachable → stay silent (onboarding owns the dark-house card) */ }
  }

  // Re-evaluate when the game state flips (season start removes it; a reset re-offers it).
  window.addEventListener("orwell:gamechanged", route);
  ready(route);
})();
