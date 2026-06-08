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


async def _call(name: str, args: dict | None = None) -> dict:
    """Invoke a player-channel tool over the engine's HTTP MCP transport."""
    url = ENGINE_URL.rstrip("/") + "/player/call"
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        r = await client.post(url, json={"name": name, "args": args or {}})
        r.raise_for_status()
        data = r.json()
    if "result" not in data:
        raise RuntimeError(data.get("error", "engine call failed"))
    return data["result"]


async def create_character(player_name: str, *, archetype=None, strategy_style=None, seed=None) -> dict:
    """Run OOBE and start a new game. Returns the Vault-free game state."""
    args: dict = {"playerName": player_name}
    if archetype:
        args["archetype"] = archetype
    if strategy_style:
        args["strategyStyle"] = strategy_style
    if seed is not None:
        args["seed"] = seed
    return await _call("createCharacter", args)


async def get_game_state() -> dict:
    """Current Vault-free game state: phase, the player's card, the house roster."""
    return await _call("getGameState", {})


async def get_moment_prompt(moment: str | None = None) -> dict:
    """The managed system prompt to inject for the current (or given) moment."""
    args: dict = {}
    if moment:
        args["moment"] = moment
    return await _call("getMomentPrompt", args)


async def run_competition(comp_type: str | None = None, participant_ids: list | None = None) -> dict:
    """Ask the engine to resolve a competition over the LIVE house. Engine-owned
    stats decide it; we receive only the winner (name) — no stats/scores."""
    args: dict = {}
    if comp_type:
        args["type"] = comp_type
    if participant_ids:
        args["participantIds"] = participant_ids
    return await _call("runCompetition", args)


async def record_interaction(content: str, with_ids: list | None = None, initiator: str = "player") -> dict:
    """Record a player-present scene as an engine event (player-witnessed → the
    player's knowledge, never the Vault)."""
    witness = [initiator] + [w for w in (with_ids or []) if w != initiator]
    if "player" not in witness:
        witness.append("player")
    return await _call("recordInteraction", {"initiator": initiator, "witnessSet": witness, "content": content})


async def surface_information(information: str, pathway: str) -> dict:
    """Surface a fact into the player's knowledge via a named in-game pathway
    (e.g. "overheard", "told-by:npc:2")."""
    return await _call("surfaceInformationTo", {"entity": "player", "fact": {"content": information}, "pathway": pathway})


async def engine_health() -> bool:
    """True if the engine HTTP MCP server answers /health."""
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.get(ENGINE_URL.rstrip("/") + "/health")
            return r.status_code == 200
    except Exception:
        return False
