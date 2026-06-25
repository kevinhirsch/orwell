// "See latest" scroll-to-bottom button (#538).
//
// A floating down-arrow that appears in the chat container ONLY when the reader has scrolled up
// away from the bottom (the chat already reasons about "near bottom" within 120px elsewhere — this
// reuses the same threshold). Clicking it re-enables auto-scroll and SMOOTH-scrolls to the newest
// message (instant under prefers-reduced-motion); it hides itself the moment the reader is back at
// the bottom. An optional unread badge counts how many messages landed while the reader was
// scrolled away, clearing on click / on reaching bottom. It is the SINGLE jump-to-bottom button —
// #887 retired the duplicate squircle (#scroll-bottom-btn) and this one absorbed its
// composer-anchored placement (sits just above the .chat-input-bar, recomputed on scroll/resize).
//
// Pure FE, no engine/Vault coupling. Reduced-motion safe (the appear/disappear transition is
// dropped under prefers-reduced-motion). Fails open: any error simply leaves the button hidden.
(function () {
  "use strict";

  var NEAR_BOTTOM_PX = 120; // matches chat.js's "nearBottom" threshold
  var BTN_ID = "orwell-scroll-bottom";
  var _box = null;       // #chat-history (the scroll container)
  var _btn = null;
  var _bar = null;       // .chat-input-bar (the composer — we anchor just above it)
  var _unread = 0;
  var _lastMsgCount = 0;

  function chatBox() {
    if (_box && document.body.contains(_box)) return _box;
    _box = document.getElementById("chat-history");
    return _box;
  }

  function chatBar() {
    if (_bar && document.body.contains(_bar)) return _bar;
    _bar = document.querySelector(".chat-input-bar");
    return _bar;
  }

  function prefersReducedMotion() {
    try {
      return window.matchMedia &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch (_) { return false; }
  }

  // Composer-anchored placement (ported from the retired #scroll-bottom-btn inline script,
  // #887): sit just above the .chat-input-bar, right-aligned, recomputed on scroll/resize so the
  // button never lands in a fixed spot that overlaps the decision card or the composer.
  function reposition() {
    var btn = _btn;
    var bar = chatBar();
    if (!btn) return;
    if (!bar) return; // no composer yet → leave defaults; reposition() reruns on resize/scroll
    var rect = bar.getBoundingClientRect();
    btn.style.bottom = (window.innerHeight - rect.top + 16) + "px";
    btn.style.right = (window.innerWidth - rect.right + 8) + "px";
  }

  function nearBottom(box) {
    return (box.scrollHeight - box.scrollTop - box.clientHeight) < NEAR_BOTTOM_PX;
  }

  function ensureCss() {
    if (document.getElementById(BTN_ID + "-css")) return;
    var st = document.createElement("style");
    st.id = BTN_ID + "-css";
    st.textContent =
      // Composer-anchored: position:fixed + JS-set bottom/right (reposition()) anchor it just
      // above the .chat-input-bar — matching the retired squircle's placement (#887). The
      // bottom/right defaults below only apply before the first reposition() / if no composer.
      "#" + BTN_ID + " {" +
      "  position: fixed; right: 18px; bottom: 96px; z-index: 40;" +
      "  width: 38px; height: 38px; border-radius: 50%;" +
      "  display: flex; align-items: center; justify-content: center;" +
      "  background: color-mix(in srgb, var(--panel, #1b1b1b) 88%, transparent);" +
      "  color: var(--fg, #cfd8e3);" +
      // Neutral hairline (the kit's glass-rim border) — no accent hue on the outline, in any
      // state (#887). Only the unread badge keeps the sanctioned accent.
      "  border: 1px solid var(--ow-glass-rim-border, rgba(255,255,255,0.12));" +
      "  box-shadow: 0 2px 10px rgba(0,0,0,.35); cursor: pointer;" +
      "  opacity: 0; transform: translateY(6px); pointer-events: none;" +
      "  transition: opacity .18s ease, transform .18s ease; }" +
      "#" + BTN_ID + ".osb-show { opacity: .92; transform: translateY(0); pointer-events: auto; }" +
      "#" + BTN_ID + ":hover, #" + BTN_ID + ":focus-visible { opacity: 1; outline: none; }" +
      "#" + BTN_ID + " svg { width: 18px; height: 18px; }" +
      "#" + BTN_ID + " .osb-badge {" +
      "  position: absolute; top: -5px; right: -5px; min-width: 16px; height: 16px;" +
      "  padding: 0 4px; border-radius: 999px; font: 600 10px/16px 'Fira Code', ui-monospace, monospace;" +
      "  text-align: center; color: var(--on-accent, #fff);" +
      "  background: var(--accent, var(--red, #e06c75)); display: none; }" +
      "#" + BTN_ID + " .osb-badge.osb-has { display: block; }" +
      "@media (prefers-reduced-motion: reduce) {" +
      "  #" + BTN_ID + " { transition: none; transform: none; }" +
      "  #" + BTN_ID + ".osb-show { transform: none; } }";
    document.head.appendChild(st);
  }

  function ensureBtn() {
    if (_btn && document.body.contains(_btn)) return _btn;
    var container = document.getElementById("chat-container");
    if (!container) return null;
    ensureCss();
    _btn = document.createElement("button");
    _btn.id = BTN_ID;
    _btn.type = "button";
    _btn.setAttribute("aria-label", "Scroll to latest message");
    _btn.title = "See latest";
    _btn.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>' +
      '<span class="osb-badge" aria-hidden="true"></span>';
    // Appended to chat-container; position:fixed + reposition() anchors it to the composer rect.
    container.appendChild(_btn);
    _btn.addEventListener("click", function () {
      try {
        if (window.uiModule && window.uiModule.setAutoScroll) window.uiModule.setAutoScroll(true);
        // Smooth-scroll to the newest message (#887). uiModule.scrollHistory() only animates the
        // last ~300px, so from far up we drive the scroll ourselves with the smooth path —
        // honoring prefers-reduced-motion (instant when reduced).
        var b = chatBox();
        if (b) {
          var top = b.scrollHeight - b.clientHeight;
          if (prefersReducedMotion()) {
            b.scrollTop = top;
          } else if (typeof b.scrollTo === "function") {
            b.scrollTo({ top: top, behavior: "smooth" });
          } else {
            b.scrollTop = top;
          }
        }
      } catch (_) {}
      clearUnread();
      update();
    });
    reposition();
    return _btn;
  }

  function setBadge(n) {
    var btn = ensureBtn();
    if (!btn) return;
    var badge = btn.querySelector(".osb-badge");
    if (!badge) return;
    if (n > 0) {
      badge.textContent = n > 99 ? "99+" : String(n);
      badge.classList.add("osb-has");
    } else {
      badge.textContent = "";
      badge.classList.remove("osb-has");
    }
  }

  function clearUnread() {
    _unread = 0;
    setBadge(0);
  }

  function update() {
    var box = chatBox();
    var btn = ensureBtn();
    if (!box || !btn) return;
    reposition();
    var hasContent = box.scrollHeight - box.clientHeight > NEAR_BOTTOM_PX;
    if (nearBottom(box) || !hasContent) {
      btn.classList.remove("osb-show");
      clearUnread();
    } else {
      btn.classList.add("osb-show");
    }
  }

  // Count messages that arrive while the reader is scrolled away → the unread badge.
  function watchNewMessages(box) {
    if (typeof MutationObserver === "undefined") return;
    try { _lastMsgCount = box.querySelectorAll(".msg").length; } catch (_) { _lastMsgCount = 0; }
    var mo = new MutationObserver(function () {
      var count;
      try { count = box.querySelectorAll(".msg").length; } catch (_) { count = _lastMsgCount; }
      if (count > _lastMsgCount && !nearBottom(box)) {
        _unread += (count - _lastMsgCount);
        setBadge(_unread);
      }
      _lastMsgCount = count;
      update();
    });
    mo.observe(box, { childList: true, subtree: true });
  }

  function start() {
    var box = chatBox();
    if (!box) return;
    ensureBtn();
    box.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", function () { reposition(); update(); });
    // Keep the button glued to the composer as it grows/shrinks (multi-line input, etc.).
    var bar = chatBar();
    if (bar && typeof ResizeObserver !== "undefined") {
      try { new ResizeObserver(reposition).observe(bar); } catch (_) {}
    }
    watchNewMessages(box);
    update();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
