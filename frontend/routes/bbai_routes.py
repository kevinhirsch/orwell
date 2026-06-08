"""Big Brother game routes — onboarding + in-character chat.

Bridges the orwell UI to the bbai engine: the engine runs OOBE, owns game
state, and supplies the managed per-moment system prompt; orwell supplies the
configured LLM. The front-end never receives Vault data (engine-enforced).

This is the seam that fixes both reported gaps:
  * no onboarding past account creation -> POST /api/bbai/new-game runs OOBE;
  * the model answers as a generic assistant -> /api/bbai/chat injects the
    engine's managed game-master system prompt for the current moment.
"""
import logging
from typing import List, Optional

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from src import bbai_engine
from src.endpoint_resolver import resolve_endpoint
from src.llm_core import llm_call_async

logger = logging.getLogger(__name__)


class NewGameRequest(BaseModel):
    playerName: str
    archetype: Optional[str] = None
    strategyStyle: Optional[str] = None
    seed: Optional[int] = None


class ChatTurn(BaseModel):
    role: str
    content: str


class BbChatRequest(BaseModel):
    message: str
    moment: Optional[str] = None
    history: List[ChatTurn] = []


def _current_user(request: Request) -> Optional[str]:
    return getattr(getattr(request, "state", None), "current_user", None)


def setup_bbai_routes() -> APIRouter:
    router = APIRouter(prefix="/api/bbai", tags=["bbai"])

    @router.get("/health")
    async def bbai_health():
        ok = await bbai_engine.engine_health()
        return {"engine": ok, "engineUrl": bbai_engine.ENGINE_URL}

    @router.get("/state")
    async def bbai_state():
        try:
            return await bbai_engine.get_game_state()
        except Exception as e:
            logger.warning(f"[bbai] state failed: {e}")
            return JSONResponse(status_code=502, content={"error": f"engine unreachable: {e}"})

    @router.post("/new-game")
    async def bbai_new_game(body: NewGameRequest):
        if not body.playerName.strip():
            return JSONResponse(status_code=400, content={"error": "playerName is required"})
        try:
            return await bbai_engine.create_character(
                body.playerName.strip(),
                archetype=body.archetype,
                strategy_style=body.strategyStyle,
                seed=body.seed,
            )
        except Exception as e:
            logger.warning(f"[bbai] new-game failed: {e}")
            return JSONResponse(status_code=502, content={"error": f"engine unreachable: {e}"})

    @router.post("/chat")
    async def bbai_chat(body: BbChatRequest, request: Request):
        # 1) The managed, Vault-free system prompt for this moment (engine-owned).
        try:
            mp = await bbai_engine.get_moment_prompt(body.moment)
            system_prompt = mp["systemPrompt"]
            moment = mp.get("moment")
        except Exception as e:
            logger.warning(f"[bbai] moment prompt failed: {e}")
            return JSONResponse(status_code=502, content={"error": f"engine unreachable: {e}"})

        # 2) Resolve the user's configured default chat model (same as orwell chat).
        owner = _current_user(request)
        url, model, headers = resolve_endpoint("default", owner=owner)
        if not url or not model:
            return JSONResponse(status_code=400, content={
                "error": "No default chat model is configured. Pick one in orwell settings, then retry.",
            })

        # 3) Inject the system prompt at the head of the conversation and call the LLM.
        messages: List[dict] = [{"role": "system", "content": system_prompt}]
        for turn in body.history[-20:]:
            if turn.role in ("user", "assistant"):
                messages.append({"role": turn.role, "content": turn.content})
        messages.append({"role": "user", "content": body.message})

        try:
            reply = await llm_call_async(url, model, messages, headers=headers)
        except Exception as e:
            logger.warning(f"[bbai] llm call failed: {e}")
            return JSONResponse(status_code=502, content={"error": f"LLM call failed: {e}"})

        return {"reply": reply, "moment": moment, "model": model}

    return router
