"""Big Brother game routes — onboarding + game state for the MAIN chat.

Bridges the Orwell UI to the Orwell engine: the engine runs OOBE, owns game
state, and supplies the managed per-moment system prompt; Orwell supplies the
configured LLM. The front-end never receives Vault data (engine-enforced).

In-character play now happens in the MAIN chat (the chat path injects the
engine's per-moment game-master prompt — see routes/chat_helpers.py), so there is
no bespoke game chat route here. These endpoints are the onboarding + state seam:

  * onboarding past account creation -> POST /api/orwell/new-game runs OOBE;
  * GET  /api/orwell/state   -> the Vault-free game state (started? player, house);
  * GET  /api/orwell/moment  -> the managed game-master prompt for the moment;
  * GET  /api/orwell/health  -> engine reachability.
"""
import logging
from typing import Optional

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from src import orwell_engine

logger = logging.getLogger(__name__)


class NewGameRequest(BaseModel):
    playerName: str
    archetype: Optional[str] = None
    strategyStyle: Optional[str] = None
    seed: Optional[int] = None


def setup_orwell_routes() -> APIRouter:
    router = APIRouter(prefix="/api/orwell", tags=["orwell"])

    @router.get("/health")
    async def orwell_health():
        ok = await orwell_engine.engine_health()
        return {"engine": ok, "engineUrl": orwell_engine.ENGINE_URL}

    @router.get("/state")
    async def orwell_state():
        try:
            return await orwell_engine.get_game_state()
        except Exception as e:
            logger.warning(f"[orwell] state failed: {e}")
            return JSONResponse(status_code=502, content={"error": f"engine unreachable: {e}"})

    @router.get("/moment")
    async def orwell_moment(moment: Optional[str] = None):
        try:
            return await orwell_engine.get_moment_prompt(moment)
        except Exception as e:
            logger.warning(f"[orwell] moment failed: {e}")
            return JSONResponse(status_code=502, content={"error": f"engine unreachable: {e}"})

    @router.post("/new-game")
    async def orwell_new_game(body: NewGameRequest):
        if not body.playerName.strip():
            return JSONResponse(status_code=400, content={"error": "playerName is required"})
        try:
            return await orwell_engine.create_character(
                body.playerName.strip(),
                archetype=body.archetype,
                strategy_style=body.strategyStyle,
                seed=body.seed,
            )
        except Exception as e:
            logger.warning(f"[orwell] new-game failed: {e}")
            return JSONResponse(status_code=502, content={"error": f"engine unreachable: {e}"})

    return router
