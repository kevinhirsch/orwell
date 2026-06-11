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
from fastapi.responses import JSONResponse, FileResponse
from pydantic import BaseModel

from core.middleware import require_admin
from src import orwell_engine
from src import orwell_portraits
from src.auth_helpers import effective_user

logger = logging.getLogger(__name__)


def _current_user(request: Request) -> Optional[str]:
    """The authenticated user the front-end asserts to the engine (per-user sandbox, 0021).

    E29: resolves the EFFECTIVE user — a bearer-token (`ody_`) caller is attributed to the
    token's real owner (`request.state.api_token_owner`), not the shared "api" pseudo-user.
    Before this, every bearer caller collapsed into ONE engine sandbox ("api"): two tokens
    from different owners shared one game — a direct cross-user isolation break (0021).
    Cookie sessions are unchanged (effective_user is identical to current_user for them)."""
    try:
        return effective_user(request)
    except Exception:
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
        """Engine reachability for the visible status banner. `engine` (bool) is kept for back-compat;
        `error` carries the concrete reason (refused / timeout / wrong URL) when it is down, and
        `lastError` reports a recent failed tool call while the engine is otherwise up."""
        detail = await orwell_engine.engine_health_detail()
        return {
            "engine": bool(detail.get("ok")),
            "engineUrl": detail.get("engineUrl"),
            "error": detail.get("error"),
            "lastError": detail.get("lastError"),
            # G8: "creating" while createCharacter is in flight — the banner holds in-fiction
            # (casting being finalized) instead of flashing a false "engine unavailable".
            "busy": detail.get("busy"),
        }

    @router.get("/state")
    async def orwell_state(request: Request):
        try:
            return await orwell_engine.get_game_state(user=_current_user(request))
        except Exception as e:
            logger.warning(f"[orwell] state failed: {e}")
            return JSONResponse(status_code=502, content={"error": f"engine unreachable: {e}"})

    @router.get("/moment")
    async def orwell_moment(request: Request, moment: Optional[str] = None):
        """E15: ADMIN-GATED. The moment prompt is the full GM system prompt (lever manifest,
        casting status, per-moment instruction) — pure meta-knowledge and a prompt-extraction
        shortcut for a player. No player JS consumes this route (the chat path injects the
        prompt server-side via chat_helpers); it stays only as an admin/debug read."""
        from core.middleware import require_admin
        require_admin(request)
        try:
            return await orwell_engine.get_moment_prompt(moment, user=_current_user(request))
        except Exception as e:
            logger.warning(f"[orwell] moment failed: {e}")
            return JSONResponse(status_code=502, content={"error": f"engine unreachable: {e}"})

    @router.get("/status")
    async def orwell_status(request: Request):
        """Vault-free public ceremony status for the status panel (week/phase/HOH/nominees/veto).
        Pre-game ("no active game") is an honest 200 {started:false} — NOT a fake 502 outage
        (field bug: the panel's poll logged a 502 per refresh on a healthy, game-less box)."""
        try:
            st = await orwell_engine.game_status(user=_current_user(request))
            # D3/E66: the last-seen pending decision rides along so the decision card
            # can re-arm after a reload — the engine's own Vault-free legal-options
            # view, cached at the AdvanceView chokepoints. A status poll NEVER
            # advances the game (ADR 0003: progressing is always an explicit act).
            if isinstance(st, dict):
                st["pending"] = orwell_engine.last_pending(_current_user(request))
            return st
        except orwell_engine.EngineToolError as e:
            if e.no_game:
                return {"started": False}
            logger.warning(f"[orwell] status failed: {e}")
            return JSONResponse(status_code=502, content={"error": str(e)})
        except Exception as e:
            logger.warning(f"[orwell] status failed: {e}")
            return JSONResponse(status_code=502, content={"error": f"engine unreachable: {e}"})

    @router.get("/tagline")
    async def orwell_tagline(request: Request):
        """Snarky, state-aware hero one-liner (0033/C33): generated by the FE LLM from the
        public ceremony projection, falling open to the engine's curated line, then the
        static default if the engine is down. The homepage never blocks on it."""
        try:
            from src.orwell_tagline import get_tagline
            return await get_tagline(user=_current_user(request))
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

    @router.get("/recap")
    async def orwell_recap(request: Request):
        """The season's public arc from the EVENT RECORD (0048/C17) — Vault-free, any time
        (mid-season it is simply the story so far). Fails OPEN: {recap: null} on any error."""
        try:
            return {"recap": await orwell_engine.season_recap(user=_current_user(request))}
        except Exception as e:
            logger.warning(f"[orwell] recap failed: {e}")
            return {"recap": None}

    @router.get("/retrospective")
    async def orwell_retrospective(request: Request):
        """The post-season Vault unsealing (0048/C17). The Wall stays ABSOLUTE pre-finale: the
        engine's terminal-state gate returns null for a live season and this route surfaces that
        as a 404 — the unseal affordance does not exist mid-season."""
        try:
            retro = await orwell_engine.season_retrospective(user=_current_user(request))
        except Exception as e:
            logger.warning(f"[orwell] retrospective failed: {e}")
            return JSONResponse(status_code=502, content={"error": f"engine unreachable: {e}"})
        if retro is None:
            return JSONResponse(status_code=404, content={"error": "The season is still live — the Vault opens only after a winner is crowned."})
        return {"retrospective": retro}

    @router.get("/whereabouts")
    async def orwell_whereabouts(request: Request):
        """The Vault-free presence read (0049/C28): the player's room, who is in it, and who is in
        each ADJACENT room — the AMBIENT ground for lingering play (ADR 0003 §4/§7: it augments the
        chat; moving/milling/talking stay prose). Fails OPEN: {whereabouts: null} on any error or
        pre-game, so the page never blocks on it."""
        try:
            return {"whereabouts": await orwell_engine.whereabouts(user=_current_user(request))}
        except Exception as e:
            logger.warning(f"[orwell] whereabouts failed: {e}")
            return {"whereabouts": None}

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

    @router.get("/roster")
    async def orwell_roster(request: Request):
        """The cast roster (0051): each houseguest's name, current status (active / jury /
        evicted) and persisted portrait ref (or null). Built ENTIRELY from the engine's
        Vault-free public projection (getGameState.house + player) merged with the local
        portrait manifest — never a stat, relationship, or hidden element. Fails OPEN to an
        empty roster so the sidebar never blocks the page.

        Also reports `imagesAvailable` so the UI can pick its empty-state copy (a configured-
        but-not-yet-generated set vs. graceful absence — no image model)."""
        user = _current_user(request)
        try:
            state = await orwell_engine.get_game_state(user=user)
        except Exception as e:
            logger.warning(f"[orwell] roster failed: {e}")
            return {"roster": [], "imagesAvailable": False}

        if not isinstance(state, dict) or state.get("started") is False:
            return {"roster": [], "imagesAvailable": False}

        cards = []
        # The player's own card first (when present), then the house.
        player = state.get("player") if isinstance(state.get("player"), dict) else None
        if player and player.get("name"):
            pid = player.get("id") or "player"
            cards.append({
                "id": pid,
                "name": player.get("name"),
                "status": player.get("status") or "active",
                "isPlayer": True,
                "portrait": orwell_portraits.portrait_ref(user, pid),
            })
        house = state.get("house") if isinstance(state.get("house"), list) else []
        for hg in house:
            if not isinstance(hg, dict) or not hg.get("name"):
                continue
            hid = hg.get("id") or hg.get("name")
            cards.append({
                "id": hid,
                "name": hg.get("name"),
                "status": hg.get("status") or "active",
                "isPlayer": False,
                "portrait": orwell_portraits.portrait_ref(user, hid),
            })

        images_available = False
        try:
            images_available = orwell_portraits.image_generation_available(user)
        except Exception:
            images_available = False
        return {"roster": cards, "imagesAvailable": images_available}

    @router.get("/portrait/{houseguest_id}")
    async def orwell_portrait(houseguest_id: str, request: Request):
        """Serve one houseguest's persisted portrait PNG (0051) from this user's portrait dir.
        Per-user scoped (cross-user isolation): a user only ever reads their OWN sandbox's
        portraits. 404 when none is stored (the roster falls back to a placeholder)."""
        user = _current_user(request)
        path = orwell_portraits.portrait_file(user, houseguest_id)
        if path is None:
            return JSONResponse(status_code=404, content={"error": "no portrait"})
        return FileResponse(
            str(path),
            media_type="image/png",
            headers={"Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff"},
        )

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

    class DecisionRequest(BaseModel):
        kind: str
        choice: Optional[list] = None
        use: Optional[bool] = None
        save: Optional[str] = None
        replacement: Optional[str] = None
        vote: Optional[str] = None
        statement: Optional[str] = None
        appeal: Optional[str] = None
        intent: Optional[str] = None

    _DECISION_KINDS = {
        "nominations", "veto-decision", "comp-intent", "houseguests-choice",
        "replacement", "eviction-vote", "tie-break", "final-eviction",
        "goodbye-message", "finale-statement", "finale-answer",
        "juror-question", "juror-vote",
    }

    @router.post("/decision")
    async def orwell_decision(body: DecisionRequest, request: Request):
        """The STRUCTURAL commitment path for a binding decision (C20 / audit U1+U2, per
        ADR 0003): the confirm card posts the player's explicit selection ENGINE-DIRECT, so
        prose can never bind through this surface. The engine validates legality and remains
        idempotent (no-op unless a matching pending exists)."""
        if body.kind not in _DECISION_KINDS:
            return JSONResponse(status_code=400, content={"error": f"unknown decision kind: {body.kind}"})
        decision = {k: v for k, v in body.model_dump().items() if v is not None}
        try:
            res = await orwell_engine.submit_decision(decision, user=_current_user(request))
            orwell_engine.remember_pending(res, user=_current_user(request))  # D3/E66
            return res
        except Exception as e:
            logger.warning(f"[orwell] decision failed: {e}")
            return JSONResponse(status_code=502, content={"error": f"engine unreachable: {e}"})

    @router.post("/new-game")
    async def orwell_new_game(body: NewGameRequest, request: Request):
        # Audit E70 — ADMIN-GATED, coherent with the one-door restart design (E1/D1): players
        # start and restart seasons through the chat tools (the 0050 casting interview →
        # createCharacter; a confirmed restart routes through the engine's one sanctioned reset
        # door). This route bypasses the interview (a soul-shallow character one curl away), so it
        # survives only as a debug/ops door: the deploy smoke and the responsive-matrix harness use
        # it (both run with AUTH_ENABLED=false, which require_admin honors). Raises 403 otherwise.
        require_admin(request)
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
            # A new season = a new cast: scrub the prior portrait set before generating (0051).
            try:
                orwell_portraits.scrub_user(user)
            except Exception:
                pass
            res = await orwell_engine.create_character(
                body.playerName.strip(),
                archetype=body.archetype,
                strategy_style=body.strategyStyle,
                seed=body.seed,
                confirm_restart=body.confirm,
                user=user,
            )
            # Kick off move-in cast portraits (0051) — background, never blocks the response,
            # silent no-op when no image model is configured (graceful absence).
            try:
                prompts = res.get("portraitPrompts") if isinstance(res, dict) else None
                if prompts:
                    orwell_portraits.kickoff_generation(prompts, user)
            except Exception:
                pass
            return res
        except Exception as e:
            logger.warning(f"[orwell] new-game failed: {e}")
            return JSONResponse(status_code=502, content={"error": f"engine unreachable: {e}"})

    return router
