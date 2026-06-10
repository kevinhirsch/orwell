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

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from src import orwell_engine

logger = logging.getLogger(__name__)


def _current_user(request: Request) -> Optional[str]:
    """The authenticated user the front-end asserts to the engine (per-user sandbox, 0021)."""
    return getattr(getattr(request, "state", None), "current_user", None)


class NewGameRequest(BaseModel):
    playerName: str
    archetype: Optional[str] = None
    strategyStyle: Optional[str] = None
    seed: Optional[int] = None
    # Required to restart over a STARTED game (C12 / audit A2): without it the route 409s and
    # the engine-side B36 guard would no-op anyway. UI must ask the player explicitly.
    confirm: bool = False


def setup_orwell_routes() -> APIRouter:
    router = APIRouter(prefix="/api/orwell", tags=["orwell"])

    @router.get("/health")
    async def orwell_health():
        ok = await orwell_engine.engine_health()
        return {"engine": ok, "engineUrl": orwell_engine.ENGINE_URL}

    @router.get("/state")
    async def orwell_state(request: Request):
        try:
            return await orwell_engine.get_game_state(user=_current_user(request))
        except Exception as e:
            logger.warning(f"[orwell] state failed: {e}")
            return JSONResponse(status_code=502, content={"error": f"engine unreachable: {e}"})

    @router.get("/moment")
    async def orwell_moment(request: Request, moment: Optional[str] = None):
        try:
            return await orwell_engine.get_moment_prompt(moment, user=_current_user(request))
        except Exception as e:
            logger.warning(f"[orwell] moment failed: {e}")
            return JSONResponse(status_code=502, content={"error": f"engine unreachable: {e}"})

    @router.get("/status")
    async def orwell_status(request: Request):
        """Vault-free public ceremony status for the status panel (week/phase/HOH/nominees/veto)."""
        try:
            return await orwell_engine.game_status(user=_current_user(request))
        except Exception as e:
            logger.warning(f"[orwell] status failed: {e}")
            return JSONResponse(status_code=502, content={"error": f"engine unreachable: {e}"})

    @router.get("/tagline")
    async def orwell_tagline(request: Request):
        """Snarky, state-aware hero one-liner (0033). Fails OPEN: a default line if the engine is
        down, so the homepage never blocks on it."""
        try:
            return await orwell_engine.player_tagline(user=_current_user(request))
        except Exception as e:
            logger.warning(f"[orwell] tagline failed: {e}")
            return {"text": "The house is waiting."}

    @router.get("/initiatives")
    async def orwell_initiatives(request: Request):
        """Houseguests who want to approach the player now (0036). Vault-free; empty on error."""
        try:
            return {"initiatives": await orwell_engine.social_initiatives(user=_current_user(request))}
        except Exception as e:
            logger.warning(f"[orwell] initiatives failed: {e}")
            return {"initiatives": []}

    @router.get("/finale")
    async def orwell_finale(request: Request):
        """The Vault-free in-progress finale projection for the finale panel (0037 §8.2): finalists,
        stage, and the votes revealed so far — null when no finale is staging. Fails OPEN: {finale: null}
        on any error, so the page never blocks on it."""
        try:
            return {"finale": await orwell_engine.finale_view(user=_current_user(request))}
        except Exception as e:
            logger.warning(f"[orwell] finale failed: {e}")
            return {"finale": None}

    class DiaryRoomRequest(BaseModel):
        entry: str

    @router.post("/diary-room")
    async def orwell_diary_room(body: DiaryRoomRequest, request: Request):
        """Record the player's OOC Diary-Room entry (0036) — never reaches any houseguest."""
        if not body.entry.strip():
            return JSONResponse(status_code=400, content={"error": "entry is required"})
        try:
            return await orwell_engine.diary_room(body.entry.strip(), user=_current_user(request))
        except Exception as e:
            logger.warning(f"[orwell] diary-room failed: {e}")
            return JSONResponse(status_code=502, content={"error": f"engine unreachable: {e}"})

    @router.post("/new-game")
    async def orwell_new_game(body: NewGameRequest, request: Request):
        if not body.playerName.strip():
            return JSONResponse(status_code=400, content={"error": "playerName is required"})
        user = _current_user(request)
        try:
            # Guard the season (C12, mirrors the engine's B36 no-op guard with an HONEST signal):
            # a started game is never silently replaced — the caller must pass confirm=true.
            state = await orwell_engine.get_game_state(user=user)
            if isinstance(state, dict) and state.get("started") and not body.confirm:
                return JSONResponse(
                    status_code=409,
                    content={
                        "error": "A game is already in progress. Pass confirm=true to end this season and start a new one.",
                        "started": True,
                    },
                )
            return await orwell_engine.create_character(
                body.playerName.strip(),
                archetype=body.archetype,
                strategy_style=body.strategyStyle,
                seed=body.seed,
                confirm_restart=body.confirm,
                user=user,
            )
        except Exception as e:
            logger.warning(f"[orwell] new-game failed: {e}")
            return JSONResponse(status_code=502, content={"error": f"engine unreachable: {e}"})

    return router
