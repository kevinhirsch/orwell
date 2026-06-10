"""Thin async client for the orwell engine's permissioned MCP HTTP API.

The front-end consumes ONLY what these Vault-free player-channel tools return; it
never reaches the engine's Vault (the Vault Wall is enforced structurally on the
engine side, not here). Endpoint comes from ``ORWELL_ENGINE_MCP_URL``.
"""
import os
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


def _user_headers(user: str | None) -> dict:
    # The front-end is the trusted auth tier (0021): it ASSERTS the authenticated user, and the
    # engine routes the call into that user's isolated sandbox. Default keeps single-tenant working.
    return {"X-Orwell-User": user or "default"}


async def _call(name: str, args: dict | None = None, user: str | None = None) -> dict:
    """Invoke a player-channel tool over the engine's HTTP MCP transport, for `user`'s sandbox."""
    url = ENGINE_URL.rstrip("/") + "/player/call"
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        r = await client.post(url, json={"name": name, "args": args or {}}, headers=_user_headers(user))
        r.raise_for_status()
        data = r.json()
    if "result" not in data:
        raise RuntimeError(data.get("error", "engine call failed"))
    return data["result"]


async def create_character(player_name: str, *, archetype=None, strategy_style=None, seed=None,
                           confirm_restart: bool = False, user: str | None = None) -> dict:
    """Run OOBE and start a new game in this user's sandbox. Returns the Vault-free game state.

    Over a STARTED game the engine no-ops unless `confirm_restart` is set (B36 guard); the
    /new-game route additionally 409s so the UI gets an honest signal instead of a silent no-op.
    """
    args: dict = {"playerName": player_name}
    if archetype:
        args["archetype"] = archetype
    if strategy_style:
        args["strategyStyle"] = strategy_style
    if seed is not None:
        args["seed"] = seed
    if confirm_restart:
        args["confirmRestart"] = True
    return await _call("createCharacter", args, user=user)


async def get_game_state(user: str | None = None) -> dict:
    """Current Vault-free game state for this user: phase, the player's card, the house roster."""
    return await _call("getGameState", {}, user=user)


async def get_moment_prompt(moment: str | None = None, user: str | None = None) -> dict:
    """The managed system prompt to inject for this user's current (or given) moment."""
    args: dict = {}
    if moment:
        args["moment"] = moment
    return await _call("getMomentPrompt", args, user=user)


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
    """Which houseguests want to approach the player now (0036) — names + a neutral pretext only,
    so scenes start from either side. Vault-free (no hidden motive)."""
    return await _call("socialInitiatives", {}, user=user)


async def make_deal(with_id: str, kind: str, terms: str, user: str | None = None) -> dict:
    """Record a player<->NPC deal (0039). The engine tracks and adjudicates it."""
    return await _call("makeDeal", {"with": with_id, "kind": kind, "terms": terms}, user=user)


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
    """Invoke an admin/God-Mode tool over the engine's HTTP MCP transport, for `user`'s sandbox."""
    url = ENGINE_URL.rstrip("/") + "/admin/call"
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        r = await client.post(url, json={"name": name, "args": args or {}}, headers=_user_headers(user))
        r.raise_for_status()
        data = r.json()
    if "result" not in data:
        raise RuntimeError(data.get("error", "engine call failed"))
    return data["result"]


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


async def engine_health() -> bool:
    """True if the engine HTTP MCP server answers /health."""
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.get(ENGINE_URL.rstrip("/") + "/health")
            return r.status_code == 200
    except Exception:
        return False
