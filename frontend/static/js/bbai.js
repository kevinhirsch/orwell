// Big Brother front-end. Talks to the bbai engine via the odysseus bridge routes
// (/api/bbai/*). The engine owns game state and the managed per-moment system
// prompt; odysseus supplies the LLM. No Vault data ever reaches this page.

const MOMENTS = [
  "character-creation", "premiere", "social", "diary-room",
  "hoh-competition", "nominations", "veto-competition",
  "veto-ceremony", "eviction", "jury-finale",
];

const el = (id) => document.getElementById(id);
const state = { history: [] };

async function api(path, opts) {
  const res = await fetch(path, Object.assign({ headers: { "content-type": "application/json" } }, opts));
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `request failed (${res.status})`);
  return data;
}

async function refreshHealth() {
  const s = el("engine-status");
  try {
    const h = await api("/api/bbai/health");
    if (h.engine) { s.textContent = "engine online"; s.className = "bb-status ok"; }
    else { s.textContent = "engine offline — start bbai-engine"; s.className = "bb-status bad"; }
    return h.engine;
  } catch {
    s.textContent = "engine unreachable"; s.className = "bb-status bad";
    return false;
  }
}

function show(view) {
  el("onboarding").classList.toggle("hidden", view !== "onboarding");
  el("game").classList.toggle("hidden", view !== "game");
}

function renderGame(gs) {
  state.game = gs;
  const p = gs.player || {};
  el("player-card").innerHTML =
    `<div class="name">${escapeHtml(p.name || "You")}</div>` +
    `<div>${escapeHtml(p.archetype || "")}${p.strategyStyle ? " · " + escapeHtml(p.strategyStyle) : ""}</div>`;
  el("house-count").textContent = `(${(gs.house || []).length})`;
  el("house-list").innerHTML = (gs.house || [])
    .map((h) => `<li>${escapeHtml(h.name)}</li>`).join("");

  const sel = el("moment");
  sel.innerHTML = MOMENTS.map((m) => `<option value="${m}">${m}</option>`).join("");
  sel.value = MOMENTS.includes(gs.moment) ? gs.moment : "premiere";

  show("game");
}

function addMsg(who, text, cls) {
  const wrap = el("transcript");
  const div = document.createElement("div");
  div.className = `bb-msg ${cls}`;
  div.innerHTML = `<div class="who">${escapeHtml(who)}</div><div class="bubble">${escapeHtml(text)}</div>`;
  wrap.appendChild(div);
  wrap.scrollTop = wrap.scrollHeight;
  return div;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function startGame(e) {
  e.preventDefault();
  el("oobe-error").textContent = "";
  const playerName = el("player-name").value.trim();
  if (!playerName) { el("oobe-error").textContent = "Enter a name."; return; }
  const body = {
    playerName,
    archetype: el("archetype").value || null,
    strategyStyle: el("strategy").value || null,
    seed: Math.floor(Math.random() * 1e9),
  };
  el("enter-house").disabled = true;
  try {
    const gs = await api("/api/bbai/new-game", { method: "POST", body: JSON.stringify(body) });
    state.history = [];
    el("transcript").innerHTML = "";
    renderGame(gs);
    addMsg("Producers", `Welcome to the house, ${playerName}. Say hello when you're ready.`, "system");
  } catch (err) {
    el("oobe-error").textContent = err.message;
  } finally {
    el("enter-house").disabled = false;
  }
}

async function sendChat(e) {
  e.preventDefault();
  const input = el("chat-input");
  const msg = input.value.trim();
  if (!msg) return;
  input.value = "";
  addMsg("You", msg, "player");
  state.history.push({ role: "user", content: msg });

  const pending = addMsg("Big Brother", "…", "host");
  el("send").disabled = true;
  try {
    const data = await api("/api/bbai/chat", {
      method: "POST",
      body: JSON.stringify({ message: msg, moment: el("moment").value, history: state.history.slice(0, -1) }),
    });
    pending.querySelector(".bubble").textContent = data.reply;
    state.history.push({ role: "assistant", content: data.reply });
  } catch (err) {
    pending.querySelector(".bubble").textContent = `⚠ ${err.message}`;
    pending.classList.remove("host"); pending.classList.add("system");
  } finally {
    el("send").disabled = false;
  }
}

async function init() {
  el("oobe-form").addEventListener("submit", startGame);
  el("chat-form").addEventListener("submit", sendChat);
  el("reset-game").addEventListener("click", () => { show("onboarding"); });

  await refreshHealth();
  try {
    const gs = await api("/api/bbai/state");
    if (gs && gs.started) renderGame(gs);
    else show("onboarding");
  } catch {
    show("onboarding");
  }
}

document.addEventListener("DOMContentLoaded", init);
