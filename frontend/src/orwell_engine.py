"""Thin async client for the orwell engine's permissioned MCP HTTP API.

The front-end consumes ONLY what these Vault-free player-channel tools return; it
never reaches the engine's Vault (the Vault Wall is enforced structurally on the
engine side, not here). Endpoint comes from ``ORWELL_ENGINE_MCP_URL``.
"""
import os
import time

import httpx

# ORWELL_* are primary; BBAI_* are kept as silent deprecated fallbacks so a pre-rename .env
# keeps working.
ENGINE_URL = (
    os.environ.get("ORWELL_ENGINE_MCP_URL")
    or os.environ.get("BBAI_ENGINE_MCP_URL")
    or "http://127.0.0.1:8765"
)
_TIMEOUT = float(
    os.environ.get("ORWELL_ENGINE_TIMEOUT")
    or os.environ.get("BBAI_ENGINE_TIMEOUT")
    or "30"
)
# C18/audit F8: the FRAMING reads (game state + the moment prompt) run on EVERY chat turn —
# a hung engine must fail the frame in seconds (the fallback prompt takes over), never stall
# the player's turn for the full default timeout.
_FRAMING_TIMEOUT = float(os.environ.get("ORWELL_ENGINE_FRAMING_TIMEOUT") or "3")


def _engine_token() -> str | None:
    """The shared secret the engine enforces when ORWELL_ENGINE_TOKEN is set (B67/ops A1).
    Read at call time (not import time) so tests and live env changes take effect."""
    return os.environ.get("ORWELL_ENGINE_TOKEN") or os.environ.get("BBAI_ENGINE_TOKEN") or None


def _engine_admin_token() -> str | None:
    """Audit E27: the SEPARATE admin/God-Mode secret. When the engine has ORWELL_ENGINE_ADMIN_TOKEN
    set, /admin/* refuses the player token — admin calls must present this one. Falls back to the
    shared token when no admin secret is configured (single-token back-compat)."""
    return os.environ.get("ORWELL_ENGINE_ADMIN_TOKEN") or _engine_token()


def _user_headers(user: str | None, admin: bool = False) -> dict:
    # The front-end is the trusted auth tier (0021): it ASSERTS the authenticated user, and the
    # engine routes the call into that user's isolated sandbox.
    #
    # B67/ops A2: an ANONYMOUS caller sends NO user header. Single-tenant engines default the
    # missing header to "default" server-side (behavior unchanged); under ORWELL_ENGINE_MULTIUSER
    # the engine refuses it (400) instead of silently collapsing anonymous sessions into one
    # shared sandbox. The authenticated-user path is untouched.
    headers: dict = {}
    if user:
        headers["X-Orwell-User"] = user
    token = _engine_admin_token() if admin else _engine_token()
    if token:
        # B67/ops A1: the engine enforces this token on every tool route; without sending it the
        # documented auth-on config 401'd every call and bricked the game. Admin calls send the
        # E27 admin secret (the engine refuses the player token on /admin/*).
        headers["Authorization"] = f"Bearer {token}"
    return headers


class EngineToolError(RuntimeError):
    """The engine RESPONDED with a structured error — it is reachable and answered. Distinct from a
    transport outage (connection refused / timeout / proxy 5xx), which propagates as httpx's own
    ``RequestError``/``HTTPStatusError`` so callers can tell "the engine said no" apart from "the
    engine is down". ``no_game`` flags the engine's intentional "no active game for this user" reply
    (the knownUser guard) — a NORMAL pre-game state the caller should treat as ``started: False``."""

    def __init__(self, message: str, status: int | None = None):
        super().__init__(message)
        self.status = status
        self.no_game = "no active game" in (message or "").lower()


# --- last-error tracking: VISIBLE error reporting for "engine up but erroring" -----------------
# Every failed engine call records here; the next successful call clears it. /api/orwell/health
# surfaces it (recency-gated), so the front-end banner can report a TECHNICAL problem (a failing
# tool, a corrupt-save 500) even while the engine process itself is reachable — not only a hard
# outage. Process-local on purpose: it describes THIS front-end's view of the engine right now.
_LAST_ERROR: dict | None = None
_LAST_ERROR_TTL_S = 90.0


def _record_error(tool: str, kind: str, message: str) -> None:
    global _LAST_ERROR
    _LAST_ERROR = {"ts": time.time(), "tool": tool, "kind": kind, "error": message}


def _clear_error() -> None:
    global _LAST_ERROR
    _LAST_ERROR = None


def last_engine_error() -> dict | None:
    """The most recent engine problem if it is RECENT and not superseded by a success.
    ``kind`` is ``"unreachable"`` (transport) or ``"tool-error"`` (the engine answered with an
    error). The pre-game "no active game" refusal is a normal state and is never recorded."""
    e = _LAST_ERROR
    if e and (time.time() - e["ts"]) <= _LAST_ERROR_TTL_S:
        return e
    return None


# C18/audit F8: one shared AsyncClient (connection pooling) instead of a new client per call.
# Rebuilt if the constructor identity changes (tests monkeypatch httpx.AsyncClient) or the
# client was closed.
_client = None
_client_factory = None


def _shared_client():
    global _client, _client_factory
    factory = httpx.AsyncClient
    if _client is None or _client_factory is not factory or getattr(_client, "is_closed", False):
        _client = factory(timeout=_TIMEOUT)
        _client_factory = factory
    return _client


async def _post_tool(path: str, name: str, args: dict | None, user: str | None, timeout: float | None = None) -> dict:
    """POST one tool call to the engine; shared by the player and admin channels.

    Raises :class:`EngineToolError` when the engine answers with a structured ``{"error": ...}`` body
    (it is UP — e.g. bad args, or no active game). A genuine outage (no JSON error body, refused
    connection, timeout) propagates as httpx's own exception, so the framing layer can fail CLOSED
    on outages while treating "no active game" as an ordinary pre-game state. Failures are recorded
    for the visible health banner (`last_engine_error`); a success clears the record."""
    url = ENGINE_URL.rstrip("/") + path
    try:
        client = _shared_client()
        if True:
            r = await client.post(url, json={"name": name, "args": args or {}},
                                  headers=_user_headers(user, admin=path.startswith("/admin")),
                                  timeout=timeout if timeout is not None else _TIMEOUT)
            if r.status_code >= 400:
                err = None
                try:
                    err = r.json().get("error")
                except Exception:
                    err = None
                if err is not None:
                    exc = EngineToolError(err, status=r.status_code)  # engine answered with a reason
                    if not exc.no_game:  # the pre-game refusal is a normal state, not a problem
                        _record_error(name, "tool-error", f"{err} (HTTP {r.status_code})")
                    raise exc
                r.raise_for_status()  # no structured body → a transport/proxy failure (engine down)
            data = r.json()
    except EngineToolError:
        raise
    except httpx.HTTPStatusError as e:
        _record_error(name, "unreachable", f"engine returned HTTP {e.response.status_code} with no error detail")
        raise
    except Exception as e:
        _record_error(name, "unreachable", f"{type(e).__name__}: {e}")
        raise
    if "result" not in data:
        msg = str(data.get("error", "engine call failed"))
        _record_error(name, "tool-error", msg)
        raise EngineToolError(msg)
    _clear_error()
    return data["result"]


async def _call(name: str, args: dict | None = None, user: str | None = None, timeout: float | None = None) -> dict:
    """Invoke a player-channel tool over the engine's HTTP MCP transport, for `user`'s sandbox.
    `timeout` overrides the default for latency-sensitive FRAMING calls (C18: a hung engine must
    fail a turn's framing in ~2s, not stall it for the full default)."""
    return await _post_tool("/player/call", name, args, user, timeout=timeout)


async def update_casting(fields: dict | None = None, user: str | None = None) -> dict:
    """Record casting-interview answers as they land (0050) — any subset of fields, any number
    of times pre-game (interviewNotes accumulate). Returns the engine's casting status:
    { known, missing, next, ready } — the ENGINE picks the interview's next step. A call after
    the season starts records nothing and reports done."""
    allowed = {"playerName", "archetype", "strategyStyle", "personaArchetype",
               "personaStrategyStyle", "backstory", "motivation", "privateStrategy",
               "interviewNotes"}
    args: dict = {}
    for key, value in (fields or {}).items():
        if key not in allowed or value is None:
            continue
        if key == "interviewNotes":
            notes = [value] if isinstance(value, str) else list(value)
            notes = [str(n) for n in notes if str(n).strip()]
            if notes:
                args[key] = notes
        elif str(value).strip():
            args[key] = str(value)
    return await _call("updateCasting", args, user=user)


async def create_character(player_name: str | None = None, *, archetype=None, strategy_style=None,
                           seed=None, confirm_restart: bool = False, user: str | None = None,
                           persona_archetype=None, persona_strategy_style=None,
                           backstory=None, motivation=None, private_strategy=None,
                           interview_notes=None) -> dict:
    """Finalize the casting interview (0050) and start a new game in this user's sandbox.
    Returns the Vault-free game state (with the player's casting card).

    The engine finalizes FROM everything `update_casting` recorded; arguments here fill gaps
    or override field-by-field — so `player_name` is optional when the interview already
    recorded one (the engine rejects creation when no name exists anywhere). Over a STARTED
    game the engine no-ops unless `confirm_restart` is set (B36 guard); the /new-game route
    additionally 409s so the UI gets an honest signal instead of a silent no-op.
    """
    args: dict = {}
    if player_name and str(player_name).strip():
        args["playerName"] = str(player_name).strip()
    if archetype:
        args["archetype"] = archetype
    if strategy_style:
        args["strategyStyle"] = strategy_style
    if persona_archetype:
        args["personaArchetype"] = persona_archetype
    if persona_strategy_style:
        args["personaStrategyStyle"] = persona_strategy_style
    if backstory:
        args["backstory"] = backstory
    if motivation:
        args["motivation"] = motivation
    if private_strategy:
        args["privateStrategy"] = private_strategy
    if interview_notes:
        if isinstance(interview_notes, str):  # a lone note arrives as a bare string sometimes
            interview_notes = [interview_notes]
        args["interviewNotes"] = [str(n) for n in interview_notes if str(n).strip()]
    if seed is not None:
        args["seed"] = seed
    if confirm_restart:
        args["confirmRestart"] = True
    return await _call("createCharacter", args, user=user)


async def get_game_state(user: str | None = None, timeout: float | None = None) -> dict:
    """Current Vault-free game state for this user: phase, the player's card, the house roster.

    The engine refuses a no-game user with a 404 "no active game" (it won't mint a sandbox just to
    answer a probe). That is NOT an outage — it is the ordinary pre-game state, so map it to
    ``{"started": False}``. A genuine engine outage still raises, so callers fail closed only then."""
    try:
        return await _call("getGameState", {}, user=user, timeout=timeout if timeout is not None else _FRAMING_TIMEOUT)
    except EngineToolError as e:
        if e.no_game:
            return {"started": False}
        raise


async def get_moment_prompt(moment: str | None = None, user: str | None = None, timeout: float | None = None) -> dict:
    """The managed system prompt to inject for this user's current (or given) moment."""
    args: dict = {}
    if moment:
        args["moment"] = moment
    return await _call("getMomentPrompt", args, user=user, timeout=timeout if timeout is not None else _FRAMING_TIMEOUT)


async def run_competition(comp_type: str | None = None, participant_ids: list | None = None, user: str | None = None) -> dict:
    """Ask the engine to resolve a competition over this user's LIVE house. Engine-owned
    stats decide it; we receive only the winner (name) — no stats/scores."""
    args: dict = {}
    if comp_type:
        args["type"] = comp_type
    if participant_ids:
        args["participantIds"] = participant_ids
    return await _call("runCompetition", args, user=user)


async def record_interaction(content: str, with_ids: list | None = None, initiator: str = "player", kind: str | None = None, user: str | None = None) -> dict:
    """Record a player-present scene as an engine event (player-witnessed → the player's
    knowledge, never the Vault). An optional `kind` folds the hidden relationship impact (0023)."""
    witness = [initiator] + [w for w in (with_ids or []) if w != initiator]
    if "player" not in witness:
        witness.append("player")
    req: dict = {"initiator": initiator, "witnessSet": witness, "content": content}
    if kind:
        req["kind"] = kind
    return await _call("recordInteraction", req, user=user)


async def surface_information(information: str, pathway: str, user: str | None = None) -> dict:
    """Surface a fact into this user's player knowledge via a named in-game pathway
    (e.g. "overheard", "told-by:npc:2")."""
    return await _call("surfaceInformationTo", {"entity": "player", "fact": {"content": information}, "pathway": pathway}, user=user)


async def game_status(user: str | None = None) -> dict:
    """Vault-free public ceremony status for the status panel: week/phase/HOH/nominees/veto."""
    return await _call("gameStatus", {}, user=user)


async def get_visible_state(user: str | None = None) -> dict:
    """The player's own visible projection: witnessed events + things they know for certain."""
    return await _call("getVisibleStateFor", {}, user=user)


async def render_scene(mode: str | None = None, user: str | None = None) -> dict:
    """Ask the engine to narrate the current moment from the VISIBLE projection only
    (`mode="dialogue"` for NPC dialogue, otherwise scene narration). Vault-free."""
    args: dict = {}
    if mode:
        args["mode"] = mode
    return await _call("renderScene", args, user=user)


async def social_read(target: str | None = None, user: str | None = None) -> dict:
    """An honest, Vault-free read of the room (or a single houseguest by id). May hint at
    tension the player could plausibly perceive; never names off-screen events."""
    args: dict = {}
    if target:
        args["target"] = target
    return await _call("socialRead", args, user=user)


async def ask_producers(question: str, user: str | None = None) -> dict:
    """Player-level interrogation of the producers. Answers from visible state only — never
    confirms or denies Vault content (the Vault Wall holds even here)."""
    return await _call("askProducers", {"question": question}, user=user)


async def end_of_session_summary(user: str | None = None) -> dict:
    """Confirm only that an updated save exists for this user (no Vault content)."""
    return await _call("endOfSessionSummary", {}, user=user)


async def advance_game(user: str | None = None) -> dict:
    """Advance the weekly loop by one beat (HOH→noms→veto→ceremony→eviction→finale).
    NPC beats resolve automatically; returns the beat event, any pending player decision,
    and the public status. Vault-free."""
    return await _call("advanceGame", {}, user=user)


async def submit_decision(decision: dict, user: str | None = None) -> dict:
    """Resolve the player's pending decision (nominations / use veto / replacement /
    eviction vote) and continue the loop. `decision` is the validated payload."""
    return await _call("submitDecision", decision or {}, user=user)


async def player_tagline(user: str | None = None) -> dict:
    """A snarky, state-aware Big Brother one-liner for the homepage hero (0033). Vault-free;
    reflects the player's current public standing. Returns ``{"text": "..."}``."""
    return await _call("playerTagline", {}, user=user)


async def social_initiatives(user: str | None = None) -> dict:
    """Which houseguests want to approach the player now (0036/E60) — names + a coarse motive
    (bond | probe) the GM voices in its own words, so scenes start from either side. Vault-free
    (never a relationship number)."""
    return await _call("socialInitiatives", {}, user=user)


async def make_deal(with_id: str, kind: str, terms: str, user: str | None = None) -> dict:
    """Record a player<->NPC deal (0039). The engine tracks and adjudicates it."""
    return await _call("makeDeal", {"with": with_id, "kind": kind, "terms": terms}, user=user)


async def season_recap(user: str | None = None) -> dict:
    """The season's public arc from the event record (0048) — Vault-free, any time."""
    return await _call("seasonRecap", {}, user=user)


async def season_retrospective(user: str | None = None):
    """The post-season Vault unsealing (0048): the FINISHED season's hidden story, or ``None``
    while a season is live (the gate is the engine's terminal state, never a prompt)."""
    return await _call("seasonRetrospective", {}, user=user)


async def npc_voice(npc_id: str, user: str | None = None):
    """The knowledge-bounded voicing projection for one active houseguest (B65) — persona,
    room/co-presence, what THEY know/suspect, organic stances. ``None`` for unknown/departed."""
    return await _call("npcVoice", {"id": npc_id}, user=user)


async def whereabouts(user: str | None = None):
    """The Vault-free presence read (0049): the player's room, who is in it, and who is in each
    ADJACENT room — names only, never motives or non-adjacent rooms. ``None`` pre-game."""
    return await _call("whereabouts", {}, user=user)


async def finale_view(user: str | None = None):
    """The Vault-free in-progress finale projection (0037 §8.1): finalists, the current stage, and the
    votes revealed SO FAR — or ``None`` when no finale is staging. Never a lean/tally/manner or the
    pre-reveal winner. Used by the finale panel; the chat agent still drives the binding decisions."""
    return await _call("finaleView", {}, user=user)


async def diary_room(entry: str, user: str | None = None) -> dict:
    """Record the player's out-of-character Diary-Room entry (0036). The player's own knowledge,
    with no in-game pathway to any houseguest — never reaches the house."""
    return await _call("diaryRoom", {"entry": entry}, user=user)


# --- God Mode / admin channel (0016) --------------------------------------------------
# These cross the engine's ADMIN channel (/admin/call), not the player channel. The
# admin channel is STILL Vault-free by construction (the human can never read the Vault,
# even in God Mode — the spoiler wall). Callers MUST be gated to admins on the front-end
# side (the agent tools below are in _ADMIN_TOOLS); the engine isolates per user (0021).

async def _admin_call(name: str, args: dict | None = None, user: str | None = None) -> dict:
    """Invoke an admin/God-Mode tool over the engine's HTTP MCP transport, for `user`'s sandbox.
    Shares `_post_tool`'s semantics: structured engine errors raise :class:`EngineToolError`, real
    outages propagate as httpx errors, and failures feed the visible health banner."""
    return await _post_tool("/admin/call", name, args, user)


async def inspect_non_vault_state(user: str | None = None) -> dict:
    """God Mode: inspect non-Vault game state (never the Vault — walled even for admin)."""
    return await _admin_call("inspectNonVaultState", {}, user=user)


async def override_mechanic(mechanic: str, value, user: str | None = None) -> dict:
    """God Mode: override a non-Vault mechanic in the sandbox; returns updated non-Vault state."""
    return await _admin_call("overrideMechanic", {"mechanic": mechanic, "value": value}, user=user)


async def configure_game(settings: dict, user: str | None = None) -> dict:
    """God Mode: set non-Vault tunables (temperature/relationship config, reserve-twist COUNT —
    never twist CONTENT, which stays Vault-sealed)."""
    return await _admin_call("configure", settings or {}, user=user)


async def manage_sandbox(op: str | None = None, user: str | None = None) -> dict:
    """God Mode: sandbox lifecycle for THIS user's sandbox only (create | reset | save | load)."""
    args: dict = {}
    if op:
        args["op"] = op
    return await _admin_call("manageSandbox", args, user=user)


async def engine_health_detail() -> dict:
    """Engine reachability plus a human-readable reason when something is wrong — for VISIBLE
    front-end error reporting. ``{"ok": bool, "engineUrl": str, "error"?: str, "lastError"?: dict}``.
    ``ok`` reflects the engine process answering /health; ``lastError`` additionally reports a RECENT
    failed tool call (a technical problem while the engine is up — e.g. a corrupt-save 500), with
    ``{tool, kind, error, ageSeconds}``. Never raises."""
    detail: dict
    try:
        r = await _shared_client().get(ENGINE_URL.rstrip("/") + "/health", timeout=5.0)
        if r.status_code == 200:
            detail = {"ok": True, "engineUrl": ENGINE_URL}
        else:
            detail = {"ok": False, "engineUrl": ENGINE_URL, "error": f"engine returned HTTP {r.status_code}"}
    except Exception as e:
        # Connection refused / DNS / timeout: the most common real failure (engine not running, or a
        # wrong ORWELL_ENGINE_MCP_URL). Report the concrete reason so the operator can act on it.
        detail = {"ok": False, "engineUrl": ENGINE_URL, "error": f"{type(e).__name__}: {e}"}
    le = last_engine_error()
    if le:
        detail["lastError"] = {
            "tool": le["tool"], "kind": le["kind"], "error": le["error"],
            "ageSeconds": int(time.time() - le["ts"]),
        }
    return detail


async def engine_health() -> bool:
    """True if the engine HTTP MCP server answers /health."""
    return bool((await engine_health_detail()).get("ok"))


# ── D3/E66: the last-seen pending decision, per user ─────────────────────────
# Every AdvanceView flows through this server (the agent's advanceGame/
# submitDecision tools and the /api/orwell/decision route), so caching the last
# `pending` here lets GET /api/orwell/status re-arm the decision card after a
# reload WITHOUT any poll ever advancing the game (ADR 0003: progressing is an
# explicit act). The cache holds the engine's own Vault-free legal-options view,
# nothing more; it clears whenever an AdvanceView shows no pending.
_LAST_PENDING: dict = {}


def remember_pending(view, user=None) -> None:
    """Record (or clear) the pending decision from any AdvanceView-shaped dict."""
    try:
        key = user or ""
        pending = view.get("pending") if isinstance(view, dict) else None
        if pending:
            _LAST_PENDING[key] = pending
        else:
            _LAST_PENDING.pop(key, None)
    except Exception:
        pass


def last_pending(user=None):
    """The last pending decision this server saw for the user (or None)."""
    return _LAST_PENDING.get(user or "")
