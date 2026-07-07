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
import json
import logging
from typing import Optional

from fastapi import APIRouter, Request, UploadFile, File, Form
from fastapi.responses import JSONResponse, FileResponse, Response
from pydantic import BaseModel

from core.middleware import require_admin
from src import orwell_engine
from src import orwell_portraits
from src import orwell_cast_authoring
from src.auth_helpers import effective_user
from src.rate_limiter import RateLimiter

logger = logging.getLogger(__name__)

# Throttle recurring poll-failure warnings. The status/state/finale routes are polled every ~2s;
# when the engine is unreachable EVERY poll failed and logged a WARNING, which firehosed the logs
# (and ballooned ops-panel.log / the /admin/status viewer — a sustained outage could crash the tab).
# Log the FIRST failure immediately, then at most once per `_WARN_EVERY` seconds per key, so an
# outage leaves a readable heartbeat instead of a flood. Recovery clears the key (next failure logs).
import time as _time

_WARN_EVERY = 30.0
_LAST_WARN: dict[str, float] = {}


def _warn_throttled(key: str, msg: str) -> None:
    now = _time.monotonic()
    last = _LAST_WARN.get(key)
    if last is None or now - last >= _WARN_EVERY:
        _LAST_WARN[key] = now
        logger.warning(msg)


def _clear_warn(key: str) -> None:
    """Call on a successful poll so the next failure logs immediately (outage start is never silent)."""
    _LAST_WARN.pop(key, None)


def _pending_is_player(pending, user: Optional[str]) -> bool:
    """True when `pending` is a player-owned decision the engine is waiting on. The engine ONLY
    projects player-owned pendings to the FE (NPC decisions are resolved internally), so any non-null
    pending dict with a `kind` is player-owned — we still confirm `by` matches the player when it is
    resolvable, never widening the gate. Fail-closed: anything odd ⇒ False (treat as no player gate)."""
    if not isinstance(pending, dict) or not (pending.get("kind") or "").strip():
        return False
    by = pending.get("by")
    # `by` may be a NamedRef dict ({id,name}) or a bare id string in older projections; absent ⇒
    # trust the engine's projection (player-owned by construction).
    if isinstance(by, dict):
        return True
    if isinstance(by, str):
        return True
    return True


def _err_detail(exc: Exception) -> str:
    """A NON-EMPTY, diagnosable failure detail. The field bug: the engine log showed bare
    `state failed:` lines with NO reason — `str(e)` is empty for several exceptions a slow/large
    /state export can raise (a read timeout, a RemoteProtocolError from a connection dropped mid-
    response, a 502 with no body). Always prefix the exception TYPE so the line names a cause; for
    an httpx status error, surface the upstream status too. So a slow export reads as e.g.
    `ReadTimeout: timed out` / `HTTPStatusError: server error '502 Bad Gateway' …`, never blank."""
    msg = str(exc).strip()
    status = ""
    resp = getattr(exc, "response", None)
    if resp is not None and getattr(resp, "status_code", None) is not None:
        status = f" (HTTP {resp.status_code})"
    return f"{type(exc).__name__}: {msg}{status}" if msg else f"{type(exc).__name__}{status or ' (no detail)'}"


# ── L15: a LAST-GOOD roster cache (per user, process-local) ─────────────────────────────────────
# The cast panel polls /roster FAST (3.5s) while portraits land. During cast generation the engine's
# per-user serial queue is busy committing the run's writes, so a getGameState poll can time out
# (the 3s framing timeout) — and the route used to fail open to an EMPTY roster, which made EVERY
# portrait vanish from the open panel (the reported L15 symptom). Instead, remember the last roster
# we successfully built for a user and serve it (flagged `stale`) when a transient read fails, so a
# busy engine never blanks the cast. Cleared when the engine reports the game is over/absent (a real
# "no cast" state must still empty the panel). Vault-free: it caches only the public roster cards.
_LAST_ROSTER: dict = {}
_LAST_ROSTER_TTL_S = 90.0


def _remember_roster(user: Optional[str], cards: list) -> None:
    if cards:
        _LAST_ROSTER[user or ""] = {"cards": cards, "ts": _time.time()}


def _last_good_roster(user: Optional[str]) -> Optional[list]:
    rec = _LAST_ROSTER.get(user or "")
    if rec and (_time.time() - rec["ts"]) <= _LAST_ROSTER_TTL_S:
        return rec["cards"]
    return None


def _forget_roster(user: Optional[str]) -> None:
    _LAST_ROSTER.pop(user or "", None)


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


def _is_live_chat_session(session_id: str) -> bool:
    """GAP-1: is ``session_id`` a LIVE chat-session row? The canonical game-session binding is only
    usable while the chat it names still exists; a chat-wipe (or any out-of-band row removal) leaves
    the id dangling, and the mirror SSE / history / resume endpoints all 404 a dead id forever. The
    binding is always to a real FE chat row, so existence in the ``sessions`` table is the liveness
    test. Errors resolve True (caller-side fail-soft never unbinds a good id on a transient hiccup)."""
    if not session_id:
        return False
    from core.database import Session as _DbSession, SessionLocal as _SessionLocal
    db = _SessionLocal()
    try:
        return db.query(_DbSession.id).filter(_DbSession.id == session_id).first() is not None
    finally:
        db.close()


def _publish_game_updated(user: Optional[str]) -> None:
    """0064 §B/D — ping every device viewing the canonical game session that the board changed (a
    binding decision, a self-evict) so the non-driving device reconciles its HUD INSTANTLY instead of
    waiting up to ~2s for the next poll. Vault-free: a session id + a change-type string only, no
    body. Best-effort — a publish failure must never break the player-facing route (polling stays the
    correctness floor; this is just the latency nicety)."""
    try:
        from src import orwell_game_session, session_events
        sid = orwell_game_session.get_game_session(user)
        if sid:
            session_events.publish(sid, "game-updated")
    except Exception:
        logger.debug("[orwell] game-updated publish skipped", exc_info=True)


# ── DB1/DB2 (#1025): debounce a rapidly-repeated IDENTICAL FAILING decision ──────────────────────
# A buggy/over-eager client (or a 502-misread retry loop) can fire the SAME invalid decision dozens
# of times a second — the prod debug bundle showed 60 refused POSTs in 5.5s, all "a legal finale
# appeal is required", which evicted real history from the 200-line log ring (DB8). Even with the
# status fix below (a client-validation error now reads as a permanent 400, not a "retry me" 502), a
# misbehaving client can still storm. So suppress an identical failing (kind, payload) from the same
# user inside a short window: the engine is never re-hit, and the FE returns the SAME refusal it just
# gave (a stable 400) without logging again. A genuine RE-SUBMISSION (the player edits a field, or the
# window lapses) is never suppressed; a SUCCESS clears the record so the next failure is fresh.
_DECISION_FAIL_WINDOW_S = 2.0
_LAST_DECISION_FAIL: dict[str, dict] = {}


def _decision_fail_key(user: Optional[str], decision: dict) -> str:
    """A stable identity for one (user, decision) attempt — the user plus the canonical JSON of the
    submitted payload, so a byte-identical resubmission collides and an edited one does not."""
    return f"{user or ''}|{json.dumps(decision, sort_keys=True, default=str)}"


def _recent_decision_failure(user: Optional[str], decision: dict) -> Optional[dict]:
    """The cached refusal for this exact (user, decision) if it failed within the debounce window,
    else None. Expired/cleared records are pruned so the dict can't grow unbounded under a storm."""
    key = _decision_fail_key(user, decision)
    rec = _LAST_DECISION_FAIL.get(key)
    if rec and (_time.monotonic() - rec["ts"]) <= _DECISION_FAIL_WINDOW_S:
        return rec
    if rec is not None:
        _LAST_DECISION_FAIL.pop(key, None)
    return None


def _remember_decision_failure(user: Optional[str], decision: dict, status: int, error: str) -> None:
    _LAST_DECISION_FAIL[_decision_fail_key(user, decision)] = {
        "ts": _time.monotonic(), "status": status, "error": error,
    }


def _clear_decision_failure(user: Optional[str], decision: dict) -> None:
    """A successful submit means the prior refusal is stale — drop it so a later identical-looking
    payload is judged fresh, never suppressed against an outcome that no longer holds."""
    _LAST_DECISION_FAIL.pop(_decision_fail_key(user, decision), None)


# ── Calibration instrumentation: capture the per-season PUBLIC outcome when a season finishes ─────
# The owner chose "instrument & gather data first" over tuning the calibration weights. This is the
# data-gathering half: when a season ends, we durably log the public, player-known outcome facts a
# calibration review needs (placement, social-scene count, public comp wins, final jury margin) into
# the append-only per-user log (`orwell_outcomes.py`), readable on the admin surface. Vault-FREE: every
# field comes from the engine's public projections AFTER the season is over (the same facts the player
# themselves see in the recap / finale reveal / their own Journal). Nothing pre-reveal or hidden.

# `finaleView()` returns null once the season FLIPS to finished, so the jury-vote MARGIN must be
# captured while the finale is still staging (the `reveal` stage). We cache the last COMPLETE finale
# tally per user (process-local) as the `/finale` panel polls, then read it back at finish-capture.
_LAST_FINALE_TALLY: dict = {}


def _remember_finale_tally(user: Optional[str], finale: Optional[dict]) -> None:
    """Cache the jury-vote margin from an in-progress finale's revealed ballots (Vault-free: the
    reveals are the public finale, ordered). Only stores once EVERY juror's vote is revealed, so the
    cached tally is the full, final margin — exactly what survives the flip to `finished`."""
    if not isinstance(finale, dict):
        return
    reveals = finale.get("reveals")
    finalists = finale.get("finalists")
    if not isinstance(reveals, list) or not reveals or not isinstance(finalists, list):
        return
    tally: dict = {}
    for r in reveals:
        voted = (r or {}).get("votedFor") if isinstance(r, dict) else None
        name = (voted or {}).get("name") if isinstance(voted, dict) else None
        if name:
            tally[name] = tally.get(name, 0) + 1
    if not tally:
        return
    counts = sorted(tally.values(), reverse=True)
    top = counts[0]
    second = counts[1] if len(counts) > 1 else 0
    _LAST_FINALE_TALLY[user or ""] = {"margin": top - second, "total": sum(counts)}


def _last_finale_margin(user: Optional[str]) -> Optional[int]:
    rec = _LAST_FINALE_TALLY.get(user or "")
    return rec.get("margin") if isinstance(rec, dict) else None


# Public comp-win highlight lines from the recap read "<Name> wins Head of Household" / "wins the
# Power of Veto" / "wins the final Head of Household" — the player's VISIBLE competition resume.
def _count_player_comp_wins(highlights: list, player_name: Optional[str]) -> int:
    if not player_name or not isinstance(highlights, list):
        return 0
    needle = player_name.strip().lower()
    wins = 0
    for line in highlights:
        if not isinstance(line, str):
            continue
        low = line.lower()
        if low.startswith(needle + " wins ") and (
            "head of household" in low or "power of veto" in low
        ):
            wins += 1
    return wins


async def _count_player_social_scenes(user: Optional[str]) -> int:
    """How many social scenes the player recorded — counted from their OWN visible projection
    (player-witnessed `conversation` events; recordInteraction writes that type). Public, Vault-free
    by construction (the player witnessed every one). Fail-soft: 0 if the read is unavailable."""
    try:
        vis = await orwell_engine.get_visible_state(user=user)
    except Exception:
        return 0
    events = vis.get("visibleEvents") if isinstance(vis, dict) else None
    if not isinstance(events, list):
        return 0
    return sum(1 for e in events if isinstance(e, dict) and e.get("type") == "conversation")


def _derive_placement(state: dict, recap: dict, player_name: Optional[str]) -> str:
    """The player's final placement (winner | runner-up | jury | evicted) from PUBLIC facts only —
    the recap winner + the player's public 0046 seat. Mirrors the engine's own placement logic."""
    player = state.get("player") if isinstance(state.get("player"), dict) else {}
    status = (player or {}).get("status") or "active"
    winner = recap.get("winner") if isinstance(recap, dict) else None
    winner_name = (winner or {}).get("name") if isinstance(winner, dict) else None
    if status == "active":
        # A finished season with the player still 'active' means they sat in the Final 2.
        if player_name and winner_name and player_name.strip().lower() == winner_name.strip().lower():
            return "winner"
        return "runner-up"
    if status == "jury":
        return "jury"
    return "evicted"


async def _capture_season_outcome(user: Optional[str]) -> bool:
    """If THIS user's season is over, append its public outcome row (idempotent). Returns True on a
    NEW row. Safe to call from any poll — it self-gates on `finished` and never raises (a capture
    failure must never break a player-facing route)."""
    try:
        from src import orwell_outcomes, orwell_seasons

        state = await orwell_engine.get_game_state(user=user)
        if not isinstance(state, dict) or not state.get("started"):
            return False
        is_over = bool(state.get("finished")) or state.get("moment") == "post-season"
        if not is_over:
            return False
        recap = await orwell_engine.season_recap(user=user)
        recap = recap if isinstance(recap, dict) else {}
        player = state.get("player") if isinstance(state.get("player"), dict) else {}
        player_name = (player or {}).get("name")
        winner = recap.get("winner") if isinstance(recap.get("winner"), dict) else None
        winner_name = (winner or {}).get("name") if isinstance(winner, dict) else None
        placement = _derive_placement(state, recap, player_name)
        social = await _count_player_social_scenes(user)
        comp_wins = _count_player_comp_wins(recap.get("highlights") or [], player_name)
        margin = _last_finale_margin(user)
        weeks = recap.get("weeksPlayed")
        return orwell_outcomes.record_outcome(
            user,
            season=orwell_seasons.get_season(user),
            placement=placement,
            social_scenes=social,
            competition_wins=comp_wins,
            jury_margin=margin,
            winner_name=winner_name,
            weeks_played=weeks if isinstance(weeks, int) else None,
        )
    except Exception as e:  # never let instrumentation break a route
        logger.info(f"[orwell] outcome capture skipped: {e}")
        return False


def _roster_cards(state: dict, user: Optional[str]) -> list:
    """The Vault-free roster cards (0051) from the engine's public projection: id, name,
    status, isPlayer, the persisted portrait ref (or null), and the engine's deep-profile
    `authored` flag. Shared by /roster, the G9 portrait backfill, AND the deep cast-authoring
    backfill so "what's missing" (portrait or deep profile) is computed the same way everywhere.

    `authored` is the engine's Vault-free per-houseguest boolean (true = deep-profile authored,
    false/absent = still on the deterministic floor). It is carried through verbatim so
    `orwell_cast_authoring.unauthored_ids` can flag the floor NPCs — the FE never derives it."""
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
            "authored": bool(player.get("authored")),
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
            "authored": bool(hg.get("authored")),
        })
    return cards


def _roster_payload(user: Optional[str], cards: list, *, stale: bool) -> dict:
    """The /roster response body from a set of roster cards: the cards plus the portrait-set
    counters, whether an image provider is configured, the live generation progress (L15), and a
    `stale` flag when these cards came from the last-good cache (a transient read failure). Every
    field is Vault-free (counts + a stale flag only). Fully fail-soft — a sub-helper raising never
    changes the cards we already have."""
    counts = {"total": 0, "present": 0, "missing": 0}
    try:
        counts = orwell_portraits.completeness(user, cards)
    except Exception:
        pass
    images_available = False
    try:
        images_available = orwell_portraits.image_generation_available(user)
    except Exception:
        images_available = False
    # L15: the live run progress (counts only, never a name) so the panel reports honest
    # "Generating N of M…" and stays on the fast cadence ONLY while a run is genuinely active.
    progress = None
    try:
        progress = orwell_portraits.generation_progress(user)
    except Exception:
        progress = None
    # M1-9 (audit A9): the last completed run's honest verdict — a 0-of-N run must flip the
    # panel's copy to "failing", never an eternal "Generating…". Counts only, Vault-free.
    last_run = None
    try:
        last_run = orwell_portraits.last_run_outcome(user)
    except Exception:
        last_run = None
    payload = {
        "roster": cards,
        "portraitLastRun": last_run,
        "imagesAvailable": images_available,
        "portraitsPresent": counts["present"],
        "portraitsTotal": counts["total"],
    }
    if progress is not None:
        payload["generation"] = progress
    if stale:
        payload["stale"] = True
    return payload


class NewGameRequest(BaseModel):
    # 0056: optional when keepCharacter is set — the engine carries the prior player's name.
    playerName: str = ""
    archetype: Optional[str] = None
    strategyStyle: Optional[str] = None
    seed: Optional[int] = None
    # Required to restart over a STARTED game (C12 / audit A2): without it the route 409s and
    # the engine-side B36 guard would no-op anyway. UI must ask the player explicitly.
    confirm: bool = False
    # 0056 — season-to-season continuity: on a confirmed restart, KEEP the existing houseguest
    # (carry their CHARACTER into the new season) instead of running fresh casting. The engine
    # re-supplies the prior player's authored fields, so no playerName is needed here when set.
    keepCharacter: bool = False


class NextSeasonRequest(BaseModel):
    # 0057: keep the existing houseguest (0056) into the new cast, or recreate from casting.
    keep: bool = True
    # Explicit confirm — starting a new season ends the current one (mirrors /new-game's guard).
    confirm: bool = False


class ResetProgressRequest(BaseModel):
    # 0057: the settings 'red zone' — explicit confirm to wipe progress toward the current season.
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
            # Issue 1: a brief, soft "reconnecting…" while a transient outage is being retried —
            # the banner shows a recover-in-progress line instead of a hard red outage.
            "reconnecting": bool(detail.get("reconnecting")),
            # G8: "creating" while createCharacter is in flight — the banner holds in-fiction
            # (casting being finalized) instead of flashing a false "engine unavailable".
            "busy": detail.get("busy"),
        }

    @router.get("/state")
    async def orwell_state(request: Request):
        try:
            # /state is a shared HUD poller (status/presence/night/finale/cast panels), NOT the
            # chat-blocking frame — so it uses the wider POLL timeout, not the tight framing default.
            # A generation-busy engine briefly slowed this read enough to ReadTimeout at 3s (prod
            # bundle 2026-06-22); the poll bound lets the transient resolve instead of 502-ing.
            st = await orwell_engine.get_game_state(
                user=_current_user(request), timeout=orwell_engine._POLL_TIMEOUT)
            _clear_warn("state")
            return st
        except Exception as e:
            detail = _err_detail(e)
            _warn_throttled("state", f"[orwell] state failed: {detail}")
            return JSONResponse(status_code=502, content={"error": f"engine unreachable: {detail}"})

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
            detail = _err_detail(e)
            _warn_throttled("moment", f"[orwell] moment failed: {detail}")
            return JSONResponse(status_code=502, content={"error": f"engine unreachable: {detail}"})

    @router.get("/status")
    async def orwell_status(request: Request):
        """Vault-free public ceremony status for the status panel (week/phase/HOH/nominees/veto).
        Pre-game ("no active game") is an honest 200 {started:false} — NOT a fake 502 outage
        (field bug: the panel's poll logged a 502 per refresh on a healthy, game-less box)."""
        try:
            st = await orwell_engine.game_status(user=_current_user(request))
            # D3/E66: the current pending decision rides along so the decision card can re-arm after
            # a reload. The engine's own `pending` (now on gameStatus, persisted 0030) is AUTHORITATIVE
            # — a present value, INCLUDING null, is engine truth and is trusted as-is. Only fall back to
            # the FE-cached last-seen when the engine OMITS the key entirely (an older engine that never
            # exposed it). R9-FE-1: the old `or` treated a present null as "missing" and re-surfaced a
            # stale card from the FE cache after a decision the model resolved via its own tool path (which
            # never refreshes that cache). A status poll NEVER advances the game (ADR 0003).
            if isinstance(st, dict) and "pending" not in st:
                st["pending"] = orwell_engine.last_pending(_current_user(request))
            _clear_warn("status")
            return st
        except orwell_engine.EngineToolError as e:
            if e.no_game:
                return {"started": False}
            detail = _err_detail(e)
            _warn_throttled("status", f"[orwell] status failed: {detail}")
            return JSONResponse(status_code=502, content={"error": detail})
        except Exception as e:
            detail = _err_detail(e)
            _warn_throttled("status", f"[orwell] status failed: {detail}")
            return JSONResponse(status_code=502, content={"error": f"engine unreachable: {detail}"})

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

    # NOTE: there is deliberately NO player-facing /initiatives route. An NPC wanting to approach is
    # IN-FICTION INTENT, not a fact the player may learn from a UI notification — surfacing it would
    # hand NPCs a one-way "notification" advantage the player's own social play never gets (the game
    # is dialogical: connections form through chat). The socialInitiatives engine lever stays GM-only
    # (the model voices the approach organically in the narration); it must never reach the player
    # through a route/panel. New connections surface through chat; the deals surface only RECORDS
    # locked-in deals after the fact. (Owner ruling 2026-06-18.)

    @router.get("/recap")
    async def orwell_recap(request: Request):
        """The season's public arc from the EVENT RECORD (0048/C17) — Vault-free, any time
        (mid-season it is simply the story so far). Fails OPEN: {recap: null} on any error."""
        user = _current_user(request)
        try:
            recap = await orwell_engine.season_recap(user=user)
            # Calibration instrumentation: the recap is polled at the finale, so this is a natural
            # finish-detection point — log the public outcome once the season is over (idempotent).
            if isinstance(recap, dict) and recap.get("finished"):
                await _capture_season_outcome(user)
                # J5-18: surface the PLAYER's own payoff — their final placement and (if a finalist)
                # the jury margin — alongside the winner the panel already headlines. Both are PUBLIC
                # post-season facts (the same fields the seasons ledger captures via _derive_placement
                # / _last_finale_margin, reused here). Vault-free, player-scoped, fail-open: any error
                # simply omits the fields and the panel falls back to the winner-only headline.
                try:
                    state = await orwell_engine.get_game_state(user=user)
                    if isinstance(state, dict):
                        player = state.get("player") if isinstance(state.get("player"), dict) else {}
                        player_name = (player or {}).get("name")
                        recap["placement"] = _derive_placement(state, recap, player_name)
                        margin = _last_finale_margin(user)
                        if margin is not None:
                            recap["margin"] = margin
                except Exception as e:  # never let the player-payoff enrichment break the recap route
                    logger.info(f"[orwell] recap placement enrichment skipped: {e}")
            _clear_warn("recap")
            return {"recap": recap}
        except Exception as e:
            _warn_throttled("recap", f"[orwell] recap failed: {_err_detail(e)}")
            return {"recap": None}

    @router.get("/retrospective")
    async def orwell_retrospective(request: Request):
        """The post-season Vault unsealing (0048/C17). The Wall stays ABSOLUTE pre-finale: the
        engine's terminal-state gate returns null for a live season and this route surfaces that
        as a 404 — the unseal affordance does not exist mid-season."""
        try:
            retro = await orwell_engine.season_retrospective(user=_current_user(request))
        except orwell_engine.EngineToolError as e:
            # No active game (never started) — there is simply no season to unseal yet. Same 404 as
            # a live season, never a false "engine unreachable" 502 (the engine answered, it refused).
            if e.no_game:
                return JSONResponse(status_code=404, content={"error": "No season to unseal — there is no active game."})
            detail = _err_detail(e)
            _warn_throttled("retrospective", f"[orwell] retrospective failed: {detail}")
            return JSONResponse(status_code=502, content={"error": detail})
        except Exception as e:
            detail = _err_detail(e)
            _warn_throttled("retrospective", f"[orwell] retrospective failed: {detail}")
            return JSONResponse(status_code=502, content={"error": f"engine unreachable: {detail}"})
        if retro is None:
            return JSONResponse(status_code=404, content={"error": "The season is still live — the Vault opens only after a winner is crowned."})
        return {"retrospective": retro}

    @router.get("/whereabouts")
    async def orwell_whereabouts(request: Request):
        """The Vault-free presence read (0049/C28): the player's room, who is in it, and who is in
        each ADJACENT room — the AMBIENT ground for lingering play (ADR 0003 §4/§7: it augments the
        chat; moving/milling/talking stay prose). Fails OPEN: {whereabouts: null} on any error or
        pre-game, so the page never blocks on it.

        ADR 0009 (D1) — the per-turn occupancy FREEZE: serve the snapshot THIS turn's prose was grounded
        in (plus the FE's own narrated moves), so the gadget never rearranges to a newer off-screen
        reshuffle than the scene the player just read. `freeze_view` falls back to this live read whenever
        the FE is not fully confident, so it can never show a houseguest in a wrong room."""
        try:
            _user = _current_user(request)
            _live = await orwell_engine.whereabouts(user=_user)
            try:
                from routes.chat_helpers import freeze_view
                return {"whereabouts": freeze_view(_user, _live)}
            except Exception:
                return {"whereabouts": _live}
        except Exception as e:
            logger.warning(f"[orwell] whereabouts failed: {e}")
            return {"whereabouts": None}

    @router.get("/finale")
    async def orwell_finale(request: Request):
        """The Vault-free in-progress finale projection for the finale panel (0037 §8.2): finalists,
        stage, and the votes revealed so far — null when no finale is staging. Fails OPEN: {finale: null}
        on any error, so the page never blocks on it."""
        user = _current_user(request)
        try:
            finale = await orwell_engine.finale_view(user=user)
            # Calibration instrumentation: cache the full jury margin from the revealed ballots while
            # the finale is still staging (it vanishes once the season flips to `finished`).
            _remember_finale_tally(user, finale if isinstance(finale, dict) else None)
            _clear_warn("finale")
            return {"finale": finale}
        except orwell_engine.EngineToolError as e:
            # Issue 2: pre-game ("no active game") is a NORMAL state, not a finale failure — the
            # panel just isn't staging yet. Return {finale: null} quietly (no log spam) so polling
            # before a game exists never floods `[orwell] finale failed: no active game`.
            if e.no_game:
                return {"finale": None}
            _warn_throttled("finale", f"[orwell] finale failed: {_err_detail(e)}")
            return {"finale": None}
        except Exception as e:
            _warn_throttled("finale", f"[orwell] finale failed: {_err_detail(e)}")
            return {"finale": None}

    @router.get("/roster")
    async def orwell_roster(request: Request):
        """The cast roster (0051): each houseguest's name, current status (active / jury /
        evicted) and persisted portrait ref (or null). Built ENTIRELY from the engine's
        Vault-free public projection (getGameState.house + player) merged with the local
        portrait manifest — never a stat, relationship, or hidden element. Fails OPEN to an
        empty roster so the sidebar never blocks the page.

        Also reports `imagesAvailable` so the UI can pick its empty-state copy (a configured-
        but-not-yet-generated set vs. graceful absence — no image model).

        L15: while a generation run is in flight the engine is busy committing the run's writes,
        so a state read can transiently time out — we serve the LAST-GOOD roster (flagged `stale`)
        instead of blanking the panel, and surface the live `generation` progress so the cast shows
        "Generating N of M…" instead of going dark or dropping the connection."""
        user = _current_user(request)
        # L15: a roster read tolerates a busier engine than a chat-framing read — use the wider
        # POLL timeout (still bounded) so a generation-busy queue doesn't blank the cast on every poll.
        try:
            state = await orwell_engine.get_game_state(user=user, timeout=orwell_engine._POLL_TIMEOUT)
        except Exception as e:
            # Transient read failure (e.g. the per-user queue is busy committing portraits): keep
            # the cast on screen by serving the last roster we built, never an empty one.
            cached = _last_good_roster(user)
            if cached is not None:
                _warn_throttled("roster", f"[orwell] roster read failed — serving last-good roster: {_err_detail(e)}")
                return _roster_payload(user, cached, stale=True)
            _warn_throttled("roster", f"[orwell] roster failed: {_err_detail(e)}")
            return {"roster": [], "imagesAvailable": False}

        _clear_warn("roster")
        if not isinstance(state, dict) or state.get("started") is False:
            _forget_roster(user)  # a real "no cast" state must empty the panel
            return {"roster": [], "imagesAvailable": False}

        cards = _roster_cards(state, user)
        _remember_roster(user, cards)  # the fresh good roster — the fallback above serves it

        # G9 backfill: seasons that predate 0051 (or whose generation failed) have no stored
        # portraits — once a provider IS configured, generate the missing set in the background
        # via the engine's live `getPortraitPrompt` tool. Debounced per user in orwell_portraits
        # (one attempt per process per window); fire-and-forget, NEVER blocks this response.
        try:
            if orwell_portraits.image_generation_available(user):
                missing = orwell_portraits.missing_portrait_ids(user, cards)
                if missing:
                    orwell_portraits.kickoff_backfill(missing, user)
        except Exception as e:
            logger.info(f"[orwell] portrait backfill kick failed: {e}")

        # Deep-authoring backfill: NPCs still on the deterministic floor (the LLM author never ran, or
        # ran without a model) get re-authored in the background so no houseguest stays a thin template
        # forever (mandate #1, anti-"sameness"). Debounced per user in orwell_cast_authoring;
        # fire-and-forget, NEVER blocks this response. A missing utility model is a silent no-op.
        try:
            unauthored = orwell_cast_authoring.unauthored_ids(user, cards)
            if unauthored:
                orwell_cast_authoring.kickoff_authoring_backfill(unauthored, user)
        except Exception as e:
            logger.info(f"[orwell] cast-authoring backfill kick failed: {e}")

        return _roster_payload(user, cards, stale=False)

    @router.post("/portraits/backfill")
    async def orwell_portraits_backfill(request: Request):
        """The manual "Generate cast portraits" retry lever (G9). Player-or-admin: the
        prompts the backfill fetches are the engine's Vault-free player-channel reads
        (`getPortraitPrompt`), so the gate is the same as the roster's. Shares the per-user
        debounce with the roster-driven backfill (a failing provider is never hammered).
        Returns {kicked, missing, available}; fail-open shapes, never a 5xx to the player."""
        user = _current_user(request)
        try:
            available = orwell_portraits.image_generation_available(user)
        except Exception:
            available = False
        try:
            state = await orwell_engine.get_game_state(user=user)
        except Exception as e:
            logger.warning(f"[orwell] portraits/backfill failed: {e}")
            return {"kicked": False, "missing": [], "available": available}
        if not isinstance(state, dict) or state.get("started") is False:
            return {"kicked": False, "missing": [], "available": available}
        missing = orwell_portraits.missing_portrait_ids(user, _roster_cards(state, user))
        kicked = False
        if available and missing:
            # The MANUAL lever — a deliberate click runs now, bypassing the auto-poll
            # debounce (it still stamps the window so a roster poll can't pile on).
            kicked = orwell_portraits.kickoff_backfill(missing, user, force=True)
        return {"kicked": kicked, "missing": missing, "available": available}

    @router.post("/cast-authoring/backfill")
    async def orwell_cast_authoring_backfill(request: Request):
        """The manual "re-author the cast" retry lever — mirrors /portraits/backfill (the
        reliability spine for deep cast-authoring). Player-or-admin: authoring reads only the
        engine's Vault-free public roster + writes back via recordCastProfile (which the engine
        validates / walls), so the gate is the same as the roster's. Shares the per-user debounce
        with the roster-driven backfill (a failing/absent utility model is never hammered). No
        image-provider precondition — authoring needs a TEXT model, resolved inside the authoring
        path (absent ⇒ a silent no-op, the deterministic floor stands). Returns {kicked, missing};
        fail-open shapes, never a 5xx to the player."""
        user = _current_user(request)
        try:
            state = await orwell_engine.get_game_state(user=user)
        except Exception as e:
            logger.warning(f"[orwell] cast-authoring/backfill failed: {e}")
            return {"kicked": False, "missing": []}
        if not isinstance(state, dict) or state.get("started") is False:
            return {"kicked": False, "missing": []}
        missing = orwell_cast_authoring.unauthored_ids(user, _roster_cards(state, user))
        kicked = False
        if missing:
            # The MANUAL lever — a deliberate click runs now, bypassing the auto-poll debounce
            # (it still stamps the window so a roster poll can't pile on).
            kicked = orwell_cast_authoring.kickoff_authoring_backfill(missing, user, force=True)
        return {"kicked": kicked, "missing": missing}

    # ── 0065: cast pre-warm — author the cast deeply BEFORE any portrait is generated ──────
    @router.post("/prewarm-cast")
    async def orwell_prewarm_cast(request: Request):
        """AUTHOR WARM (earliest): the FE calls this the instant a model is selectable (casting open,
        before the season begins). The engine pre-seeds the player-INDEPENDENT cast and the FE deeply
        authors it in the background. Idempotent; fail-open. Player-channel (Vault-free roster only)."""
        user = _current_user(request)
        try:
            from src import orwell_prewarm
            return await orwell_prewarm.prewarm_cast(user)
        except Exception as e:  # never block onboarding on a pre-warm hiccup
            logger.info(f"[orwell] prewarm-cast failed: {e}")
            return {"warmed": False, "count": 0}

    @router.post("/warm-portraits")
    async def orwell_warm_portraits(request: Request):
        """PORTRAIT WARM (held until the first interview turn): generate the cast portraits in the
        background — but ONLY after author warm has fully finished. A fully warmed authorship before any
        photo, ever. Idempotent; fail-open; declines if no author warm ran (createCharacter's fallback
        owns portraits then)."""
        user = _current_user(request)
        try:
            from src import orwell_prewarm
            return await orwell_prewarm.warm_portraits(user)
        except Exception as e:
            logger.info(f"[orwell] warm-portraits failed: {e}")
            return {"started": False}

    @router.post("/prewarm-next-season")
    async def orwell_prewarm_next_season(request: Request):
        """PHASE 1 (0065 advance-warm): the FE calls this when the CURRENT season's FINALE DAY begins
        (the finale starts staging). It fires the REAL mid-season warm in the background: the engine's
        `preSeedNextSeason` warms the NEXT season's cast DATA (names + deep profiles), NOT images, off a
        NEW seed into a per-user HOLDING STORE that survives the cutover rotation — WITHOUT touching the
        active season — and the FE deeply authors it (write-back onto the holding store). The confirmed
        next-season cutover ADOPTS the held cast, so the deep data is ready truly IN ADVANCE. Idempotent;
        fail-open. Player-channel (the warm reads only the Vault-free roster). Images are a SEPARATE
        Phase-2 warm fired at the next-season confirm and gated off this one (warm-portraits)."""
        user = _current_user(request)
        try:
            from src import orwell_prewarm
            return orwell_prewarm.prewarm_next_season(user)
        except Exception as e:  # never disturb the finale on a pre-warm hiccup
            logger.info(f"[orwell] prewarm-next-season failed: {e}")
            return {"armed": False}

    # ── G26/G27: the player's own casting headshot + the account avatar ───────────────────
    # Player-channel (not admin): it sets the PLAYER's OWN portrait and the account's circle
    # avatar — the same exposure as the backfill lever. 'exact' = the cropped photo, finalized
    # at once (no AI). 'reference' = stored, then the studio generates options to pick from.
    # Vault-safe: only the player's own image, never game state.
    _MAX_HEADSHOT_BYTES = 12 * 1024 * 1024

    @router.post("/portrait/intake")
    async def orwell_portrait_intake(request: Request,
                                     file: UploadFile = File(...),
                                     mode: str = Form("reference")):
        user = _current_user(request)
        try:
            raw = await file.read()
        except Exception:
            return JSONResponse(status_code=400, content={"error": "could not read the upload"})
        if not raw or len(raw) > _MAX_HEADSHOT_BYTES:
            return JSONResponse(status_code=413, content={"error": "image missing or too large (max 12MB)"})
        if not (file.content_type or "").lower().startswith("image/"):
            return JSONResponse(status_code=400, content={"error": "that file is not an image"})
        meta = orwell_portraits.save_player_intake(user, raw, mode)
        if not meta:
            return JSONResponse(status_code=400, content={"error": "could not decode that image"})
        finalized = False
        if meta["mode"] == "exact":
            # No selection step — the cropped photo IS the portrait + avatar, applied now.
            cropped = orwell_portraits._normalize_upload(orwell_portraits._read_intake_source(user) or b"", square=True)
            finalized = bool(cropped) and orwell_portraits.finalize_player_headshot(user, cropped, kind="upload")
        return {"ok": True, "mode": meta["mode"], "finalized": finalized}

    @router.get("/portrait/intake")
    async def orwell_portrait_intake_status(request: Request):
        return orwell_portraits.intake_status(_current_user(request))

    @router.delete("/portrait/intake")
    async def orwell_portrait_intake_clear(request: Request):
        orwell_portraits.clear_player_intake(_current_user(request))
        return {"ok": True}

    # ── Cast-photo casting step (the FIRST step of the casting interview, optional) ────────
    # The cast photo opens casting (0050) and is SKIPPABLE. The FE records how the player
    # handled it into the engine's casting state machine via updateCasting({castPhoto}) so
    # the engine can advance `casting.next`/`ready`. Idempotent and Vault-free — it records
    # only the player's OWN step metadata. Pre-game only; the engine no-ops once a season has
    # started (we pass through whatever it returns).
    #
    # B66 (augment-not-replace, ADR 0003 §4): this is a SANCTIONED FE-side casting record, not a
    # UI replacement of the interview. The photo box is a FE-only affordance the narration model
    # genuinely CANNOT observe (it never sees the upload/skip), so the FE must mark the outcome —
    # exactly the error-correction the other sanctioned paths (ensure_turn_recorded,
    # _pre_resolve_npc_ceremony) embody. It records ONLY the photo-step marker, never a
    # substantive casting answer, never advances the week, and never replaces the model-run
    # interview. `_CAST_PHOTO_STATUSES` is the scoping allowlist guard (the b66 marker).
    _CAST_PHOTO_STATUSES = ("uploaded", "skipped")

    class CastPhotoRequest(BaseModel):
        status: str

    @router.post("/casting/photo")
    async def orwell_casting_photo(body: CastPhotoRequest, request: Request):
        if body.status not in _CAST_PHOTO_STATUSES:
            return JSONResponse(
                status_code=400,
                content={"error": "status must be 'uploaded' or 'skipped'"},
            )
        try:
            return await orwell_engine.update_casting(
                {"castPhoto": body.status}, user=_current_user(request)
            )
        except orwell_engine.EngineToolError as e:
            # "No active game" is the benign pre/post-game state (the engine is reachable; it
            # refused), NOT an outage — a clean 409 so the FE never shows a false "unreachable".
            if e.no_game:
                return JSONResponse(status_code=409, content={"started": False, "error": "no active game"})
            logger.warning(f"[orwell] casting/photo failed: {e}")
            return JSONResponse(status_code=502, content={"error": str(e)})
        except Exception as e:
            logger.warning(f"[orwell] casting/photo failed: {e}")
            return JSONResponse(status_code=502, content={"error": f"engine unreachable: {e}"})

    @router.post("/portrait/studio/generate")
    async def orwell_portrait_studio_generate(request: Request):
        """Generate up to 3 AI studio OPTIONS off the uploaded photo (image-to-image). Call it
        again for a fresh set (back-and-forth, indefinitely)."""
        user = _current_user(request)
        try:
            res = await orwell_portraits.generate_studio_candidates(user, 3)
        except Exception as e:
            logger.warning(f"[orwell] studio generate failed: {e}")
            return {"generated": 0, "reason": "the photo service is offline"}
        cands = [{"index": i, "ref": f"/api/orwell/portrait/studio/candidate/{i}"}
                 for i in range(res.get("generated", 0))]
        return {"generated": res.get("generated", 0), "candidates": cands, "reason": res.get("reason")}

    @router.get("/portrait/studio/candidate/{index}")
    async def orwell_portrait_studio_candidate(index: int, request: Request):
        user = _current_user(request)
        p = orwell_portraits._candidate_path(user, index)
        if not p.exists():
            return Response(status_code=404)
        return FileResponse(str(p), media_type="image/png")

    @router.post("/portrait/studio/finalize")
    async def orwell_portrait_studio_finalize(request: Request):
        """Pick a studio candidate (by index) — it becomes the player portrait + the avatar."""
        user = _current_user(request)
        try:
            body = await request.json()
        except Exception:
            body = {}
        index = body.get("index")
        p = orwell_portraits._candidate_path(user, int(index)) if index is not None else None
        if p is None or not p.exists():
            return JSONResponse(status_code=400, content={"error": "no such candidate — generate options first"})
        try:
            png = p.read_bytes()
        except OSError:
            return JSONResponse(status_code=400, content={"error": "candidate could not be read"})
        ok = orwell_portraits.finalize_player_headshot(user, png, kind="studio")
        return {"ok": ok, "finalized": ok}

    # ── G30: the persistent headshot library (cached, reusable options) ───────────────────
    @router.get("/portrait/library")
    async def orwell_portrait_library(request: Request):
        """The player's cached headshots — pick any to make it current, anytime."""
        return {"headshots": orwell_portraits.list_headshots(_current_user(request))}

    @router.get("/portrait/library/{hid}")
    async def orwell_portrait_library_item(hid: str, request: Request):
        p = orwell_portraits.headshot_path(_current_user(request), hid)
        if p is None:
            return Response(status_code=404)
        return FileResponse(str(p), media_type="image/png", headers={"Cache-Control": "no-cache"})

    @router.post("/portrait/library/select")
    async def orwell_portrait_library_select(request: Request):
        """Make a cached headshot the CURRENT one (avatar + season portrait)."""
        user = _current_user(request)
        try:
            body = await request.json()
        except Exception:
            body = {}
        hid = body.get("id")
        ok = orwell_portraits.select_headshot(user, str(hid)) if hid is not None else False
        if not ok:
            return JSONResponse(status_code=400, content={"error": "no such headshot"})
        return {"ok": True, "selected": str(hid)}

    @router.delete("/portrait/library/{hid}")
    async def orwell_portrait_library_delete(hid: str, request: Request):
        return {"ok": orwell_portraits.delete_headshot(_current_user(request), hid)}

    @router.get("/avatar")
    async def orwell_user_avatar(request: Request):
        """The account's circle profile pic (G27) — the finalized headshot. 204 ⇒ the UI shows
        the initial. Player-channel: a user's OWN avatar only."""
        p = orwell_portraits.user_avatar_path(_current_user(request))
        if p is None:
            # 204 (not 404) when unset: the UI uses this purely as a presence
            # probe, and a 404 logs a console/resource error on every load
            # (S1-2). 204 carries the same "no avatar" signal without the noise.
            return Response(status_code=204)
        return FileResponse(str(p), media_type="image/png",
                            headers={"Cache-Control": "no-cache"})

    @router.get("/portraits/log")
    async def orwell_portraits_log(request: Request):
        """ADMIN-GATED (G9 observability, same require_admin contract as the admin transcript
        routes): the capped generation-attempt log — {ts, houseguestId, ok, errorClass,
        durationMs, detail?} per attempt, oldest first. No Vault risk: ids, error classes, and
        (on failures) a short PROVIDER-supplied reason — never a prompt, stat, or hidden
        element."""
        require_admin(request)
        return {"log": orwell_portraits.read_attempt_log()}

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
        except orwell_engine.EngineToolError as e:
            # "No active game" is a benign pre/post-game state (the engine is reachable; it refused),
            # NOT an outage — return a clean 409 so the FE never shows a false "engine unreachable".
            if e.no_game:
                return JSONResponse(status_code=409, content={"started": False, "error": "no active game"})
            logger.warning(f"[orwell] diary-room failed: {e}")
            return JSONResponse(status_code=502, content={"error": str(e)})
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
        # 0061 — self-eviction: ONLY confirmed:true executes the irreversible walk-out.
        confirmed: Optional[bool] = None
        # CON-4 / INTEGRATION2-1 — the 0065 at-most-once token. The client mints ONE stable key per
        # card render (reused on a retry of THAT card) so a delayed-duplicate POST — a lost 200 the
        # client retries, or a double-tap across two mirrored windows both showing the card — cannot
        # apply twice / to the wrong staged round. Vault-free; not a decision field (popped off below).
        idempotency_key: Optional[str] = None

    _DECISION_KINDS = {
        "nominations", "veto-decision", "comp-intent", "comp-round", "houseguests-choice",
        "replacement", "eviction-vote", "tie-break", "final-eviction",
        "goodbye-message", "finale-statement", "finale-answer",
        "juror-question", "juror-vote",
        # 0061 — the sanctioned confirmed self-eviction rides the same validated decision seam.
        "self-evict",
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
        # CON-4: the idempotency key is a SYNC-SPINE token, not a decision field — pull it out of the
        # decision dict (the engine's SubmitDecisionReq would reject the unknown key otherwise).
        _client_idem = decision.pop("idempotency_key", None)
        user = _current_user(request)
        # CON-4 / INTEGRATION2-1 — wire this ENGINE-DIRECT commitment path into the 0065 sync spine
        # (every OTHER mutating surface already is). `expected_beat_seq` refuses a decision computed
        # against a board a concurrent window already moved (the wrong-staged-round race); the
        # idempotency key (client-minted per card, reused on retry) makes a duplicate POST a verbatim
        # replay. Fail-open: any hiccup resolving the token leaves the call byte-identical to before.
        try:
            from routes.chat_helpers import last_beat_seq as _last_beat_seq, _refresh_beat_seq, _mint_idempotency_key
            _dec_ebs = _last_beat_seq(user)
            _dec_ik = _client_idem if isinstance(_client_idem, str) and _client_idem.strip() else _mint_idempotency_key()
        except Exception:
            _last_beat_seq = _refresh_beat_seq = None  # type: ignore
            _dec_ebs = None
            _dec_ik = _client_idem if isinstance(_client_idem, str) and _client_idem.strip() else None
        # DB1/DB2 (#1025): if this EXACT decision just failed (within the debounce window), replay the
        # cached refusal WITHOUT re-hitting the engine or re-logging. Stops a buggy client from
        # storming the engine + log ring with the same invalid POST 60×/5s. An edited payload or a
        # lapsed window is judged fresh (different/expired key); a success clears the record.
        _dup = _recent_decision_failure(user, decision)
        if _dup is not None:
            return JSONResponse(status_code=_dup["status"],
                                content={"error": _dup["error"], "debounced": True})
        try:
            res = await orwell_engine.submit_decision(
                decision, expected_beat_seq=_dec_ebs, idempotency_key=_dec_ik, user=user)
            if _refresh_beat_seq is not None:
                _refresh_beat_seq(user, res if isinstance(res, dict) else {})  # CON-4: track new beatSeq
            # D3/E66 + F5: mirror the engine's `pending` into the FE cache. remember_pending now KEEPS
            # the cache when a view OMITS `pending` (the route's omit-fallback for an old engine). A
            # SUCCESSFUL submit, though, means the just-resolved card is gone — so if the engine's result
            # didn't carry an explicit `pending`, clear it here rather than keep a stale card that would
            # re-arm on the next status reload. (A present `pending`, incl. null, is handled as engine truth.)
            # F14 (#1013): the player's goodbye-message resolves the LAST player-owned gate of the
            # eviction sub-loop, but submitDecision returns only the goodbye BEAT — the engine still
            # owes `goodbye → eviction-result → rollWeek`, and ONLY advanceGame delivers it. The model
            # reliably under-calls that advance (the same under-call class as everywhere), wedging the
            # week at `phase:eviction`. So when the goodbye is in and the engine raised NO new player
            # pending, drive ONE follow-up advanceGame here to roll the result. Engine-direct (never
            # authoring content); idempotent; if it instead surfaces a new player pending, we keep that.
            _gb_done = (body.kind == "goodbye-message"
                        and isinstance(res, dict)
                        and not _pending_is_player(res.get("pending"), user))
            if _gb_done:
                try:
                    # CON-16: guard the follow-up advance with an idempotency key derived from the
                    # goodbye card's key, so a retried goodbye POST cannot double-roll the eviction
                    # result. Refresh last-seen after so the FE tracks the new beat.
                    _gb_ik = (_dec_ik + ":gb-adv") if isinstance(_dec_ik, str) else None
                    res = await orwell_engine.advance_game(
                        expected_beat_seq=None, idempotency_key=_gb_ik, user=user)
                    if _refresh_beat_seq is not None:
                        _refresh_beat_seq(user, res if isinstance(res, dict) else {})
                except Exception as _adv_e:
                    logger.warning(f"[orwell] post-goodbye follow-up advance skipped: {_adv_e}")
            if isinstance(res, dict) and "pending" not in res:
                orwell_engine.clear_pending(user=user)
            else:
                orwell_engine.remember_pending(res, user=user)
            _publish_game_updated(user)  # 0064: instant cross-device HUD reconcile
            _clear_decision_failure(user, decision)  # DB1/DB2: a success retires any prior refusal
            return res
        except orwell_engine.EngineToolError as e:
            # A stale decision-card POST after the game has ended (or pre-game) — the engine refused
            # because there is no active game. Benign 409, not a false "engine unreachable" 502.
            if e.no_game:
                return JSONResponse(status_code=409, content={"started": False, "error": "no active game"})
            # CON-4: a `stale-beat` CAS refusal means a concurrent window already moved the board under
            # this decision (the wrong-staged-round race the token exists to catch). Reconcile silently
            # and return the CURRENT state — the card the player saw is already resolved; surfacing a raw
            # 409 error would be wrong. (A genuine duplicate of the SAME card is instead a verbatim replay
            # via the shared idempotency key, so this path is only the truly-superseded case.)
            try:
                from routes.chat_helpers import _is_stale_beat_error, _handle_stale_beat
                if _is_stale_beat_error(e):
                    await _handle_stale_beat(user, e)
                    _cur = await orwell_engine.get_game_state(user=user)
                    orwell_engine.remember_pending(_cur, user=user)
                    _publish_game_updated(user)
                    return _cur
            except Exception:
                pass  # reconcile failed — fall through to the normal error handling below
            # DB1/DB2 (#1025): the engine ANSWERED with a structured error — it is reachable. Propagate
            # the engine's REAL status (e.g. a deliberate 400 client/validation refusal like "a legal
            # finale appeal is required", E31) instead of a hardcoded 502. 502 is in the client's
            # _TRANSIENT_STATUSES ("retry me"), so rewriting a permanent 400 into 502 invited a retry
            # storm. Reserve 502 for genuine unreachability (the bare `except` below). A missing/odd
            # status falls back to 502 so an unclassifiable engine answer still reads as a problem.
            status = e.status if isinstance(e.status, int) and 400 <= e.status < 600 else 502
            _warn_throttled(f"decision-fail:{user or ''}", f"[orwell] decision failed (HTTP {status}): {e}")
            _remember_decision_failure(user, decision, status, str(e))  # debounce an identical repeat
            return JSONResponse(status_code=status, content={"error": str(e)})
        except Exception as e:
            # No structured engine answer — a genuine transport outage. THIS is the 502 case. NOT
            # debounced: an outage is transient and the client SHOULD be free to retry into a recovery
            # (the engine client's own backoff already throttles the wire); only an engine-ANSWERED
            # refusal (above) is a permanent verdict worth suppressing on an identical repeat.
            _warn_throttled(f"decision-fail:{user or ''}", f"[orwell] decision failed: {e}")
            return JSONResponse(status_code=502, content={"error": f"engine unreachable: {e}"})

    @router.post("/self-eviction/request")
    async def orwell_self_eviction_request(request: Request):
        """0061 step 1 — the player expressed an OOC intent to LEAVE/quit. Raise the self-evict
        CONFIRMATION on the engine (it names the irreversible stakes) and change NO state: the house
        never hears it, and nothing evicts until the player explicitly confirms. The confirmed exit
        then rides the validated /decision seam ({kind:'self-evict', confirmed:true})."""
        try:
            res = await orwell_engine.request_self_eviction(user=_current_user(request))
            orwell_engine.remember_pending(res, user=_current_user(request))
            _publish_game_updated(_current_user(request))  # 0064: instant cross-device HUD reconcile
            return res
        except orwell_engine.EngineToolError as e:
            if e.no_game:
                return JSONResponse(status_code=409, content={"started": False, "error": "no active game"})
            logger.warning(f"[orwell] self-eviction request failed: {e}")
            return JSONResponse(status_code=502, content={"error": str(e)})
        except Exception as e:
            logger.warning(f"[orwell] self-eviction request failed: {e}")
            return JSONResponse(status_code=502, content={"error": f"engine unreachable: {e}"})

    @router.post("/self-eviction/cancel")
    async def orwell_self_eviction_cancel(request: Request):
        """0061 — the player declined the self-evict confirmation. Clear it; they remain ACTIVE and in
        the house, unchanged."""
        try:
            res = await orwell_engine.cancel_self_eviction(user=_current_user(request))
            orwell_engine.remember_pending(res, user=_current_user(request))
            _publish_game_updated(_current_user(request))  # 0064: instant cross-device HUD reconcile
            return res
        except orwell_engine.EngineToolError as e:
            if e.no_game:
                return JSONResponse(status_code=409, content={"started": False, "error": "no active game"})
            logger.warning(f"[orwell] self-eviction cancel failed: {e}")
            return JSONResponse(status_code=502, content={"error": str(e)})
        except Exception as e:
            logger.warning(f"[orwell] self-eviction cancel failed: {e}")
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
        # 0056: a name is required UNLESS keeping the existing character (the engine carries it).
        if not body.playerName.strip() and not body.keepCharacter:
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
            # 0065 (belt-and-suspenders): explicitly drop the cast pre-warm state so a stale warm
            # gate can never bleed into the fresh cast. (prewarm self-resets on seed change too.)
            try:
                from src import orwell_prewarm
                orwell_prewarm.reset(user)
            except Exception:
                pass
            res = await orwell_engine.create_character(
                body.playerName.strip() or None,
                archetype=body.archetype,
                strategy_style=body.strategyStyle,
                seed=body.seed,
                confirm_restart=body.confirm,
                keep_character=body.keepCharacter,  # 0056: carry the prior character into the new season
                user=user,
            )
            # Restart-door hygiene (D3/E66): a fresh season wipes the prior season's cached
            # decision card so no phantom pending bleeds onto the status route until season 2's
            # first advance. The casting card has no `pending`, so this clears _LAST_PENDING.
            orwell_engine.remember_pending(res, user=user)
            # 0064: a new season is a new chat — unbind the canonical game session so devices
            # rebind to a fresh chat (a dead season's transcript never narrates the new one).
            try:
                from src import orwell_game_session
                orwell_game_session.clear_game_session(user)
            except Exception:
                pass
            # Kick off move-in cast portraits (0051) — background, never blocks the response,
            # silent no-op when no image model is configured (graceful absence).
            try:
                prompts = res.get("portraitPrompts") if isinstance(res, dict) else None
                if prompts:
                    orwell_portraits.kickoff_generation(prompts, user)
            except Exception:
                pass
            # M1-2 / ADR 0006 (audit A2): a sandbox now exists, so re-apply the persisted in-game
            # clock immediately — the boot apply legitimately failed pre-game ("no active game"),
            # and this debug/ops door may start a season with no framed chat turn to lazy-apply it.
            # Best-effort; never blocks the response.
            try:
                from routes.chat_helpers import _apply_persisted_time_of_day_once
                await _apply_persisted_time_of_day_once(user)
            except Exception:
                pass
            return res
        except Exception as e:
            logger.warning(f"[orwell] new-game failed: {e}")
            return JSONResponse(status_code=502, content={"error": f"engine unreachable: {e}"})

    # ── 0064: the canonical game chat session (one game = one chat, every device on it) ──────
    class BindGameSessionRequest(BaseModel):
        sessionId: str = ""

    @router.get("/game-session")
    async def orwell_game_session(request: Request):
        """Feature 0064: the user's CANONICAL game chat session id — the one chat every device
        opens for the game, so the existing cross-device sync engages instead of each device
        running its own parallel casting interview. Vault-free (a session id carries no secret);
        scoped to the caller's own user. ``{sessionId: <id or null>}`` — null means nothing is
        bound yet (the first device binds it via POST after it creates the chat).

        GAP-1: the stored id is VALIDATED to be a LIVE chat-session row before it is handed out. A
        stale binding — one that survived a chat-wipe, or otherwise points at a row that no longer
        exists — is unbound here, so ``sessionSync.js`` never subscribes the mirror stream to a dead
        channel (which 404s forever and can collapse a live window's DOM on convergence)."""
        from src import orwell_game_session
        user = _current_user(request)
        sid = orwell_game_session.resolve_live_game_session(user, _is_live_chat_session)
        return {"sessionId": sid}

    @router.post("/game-session")
    async def orwell_bind_game_session(body: BindGameSessionRequest, request: Request):
        """Feature 0064: bind a chat session as the user's canonical game session — FIRST-WRITER-
        WINS, so two devices racing the first open converge on ONE id (a racing second caller
        adopts the already-bound id). Returns the EFFECTIVE bound id and whether the caller's id
        was the one bound. Per-user keyed ⇒ a caller can only ever bind within their own bucket."""
        from src import orwell_game_session
        user = _current_user(request)
        requested = (body.sessionId or "").strip()
        if not requested:
            return JSONResponse(status_code=400, content={"error": "sessionId is required"})
        effective = orwell_game_session.bind_game_session(user, requested)
        return {"sessionId": effective, "bound": effective == requested}

    # ── 0064 Part F: window / HUD layout, synced across the user's devices ──────────────────
    class LayoutPatchRequest(BaseModel):
        windowId: str
        state: dict = {}
        # An opaque per-tab token so the originating device can ignore its OWN broadcast echo
        # (there is no stream to key self-echo on, unlike a chat run).
        origin: str = ""

    @router.get("/layout")
    async def orwell_layout(request: Request):
        """Feature 0064 (F): the user's synced window/HUD layout — open/minimized/docked + size +
        position per window. Vault-free (geometry carries no secret); scoped to the caller. The kit
        seeds from this on load so every device shows the same arrangement."""
        from src import orwell_layout
        return orwell_layout.get_layout(_current_user(request))

    @router.patch("/layout")
    async def orwell_patch_layout(body: LayoutPatchRequest, request: Request):
        """Feature 0064 (F): persist a window's state change (last-write-wins per field) and FAN it
        out to the user's other devices over the canonical game session's SSE channel as a
        `layout-changed` event (ids + geometry numbers only — never a message body or Vault). The
        originating device ignores the echo via `origin`."""
        from src import orwell_layout, orwell_game_session, session_events
        user = _current_user(request)
        saved = orwell_layout.patch_layout(user, body.windowId, body.state)
        if not saved:
            return JSONResponse(status_code=400, content={"error": "no usable layout fields"})
        # Broadcast to the user's other devices (best-effort): they all view the canonical game
        # session, so its existing per-session SSE channel reaches every one of them.
        try:
            sid = orwell_game_session.get_game_session(user)
            if sid:
                session_events.publish(sid, "layout-changed",
                                       {"windowId": body.windowId, "state": saved, "origin": body.origin or ""})
        except Exception:
            logger.debug("[orwell] layout-changed publish skipped", exc_info=True)
        return {"windowId": body.windowId, "state": saved}

    # ── 0057: seasons as levels — the per-user season number + the two restart actions ──────
    @router.get("/season")
    async def orwell_season(request: Request):
        """Feature 0057: the user's current season number ('level', 1-based). Vault-free; a count
        carries no game secret, and the store always answers (a corrupt/missing store ⇒ season 1)."""
        from src import orwell_seasons
        return {"season": orwell_seasons.get_season(_current_user(request))}

    @router.post("/next-season")
    async def orwell_next_season(body: NextSeasonRequest, request: Request):
        """Feature 0057: start the NEXT season once this one has ENDED (any ending). Increments the
        user's season number (a cleared level). Player-reachable for the caller's OWN game only —
        `_current_user` scopes every engine call to their sandbox; it routes through the engine's
        ONE sanctioned reset door (createCharacter+confirmRestart for keep; manageSandbox reset for
        recreate). Not admin-gated (ruling: anyone may advance their own season, 0057)."""
        from src import orwell_seasons
        user = _current_user(request)
        if not body.confirm:
            return JSONResponse(status_code=400, content={"error": "confirm=true is required to start a new season"})
        try:
            state = await orwell_engine.get_game_state(user=user)
            if not isinstance(state, dict) or not state.get("started"):
                return JSONResponse(status_code=409, content={"started": False, "error": "no season to advance from"})
            # The level must be CLEARED before the next one: the season must be over (any ending).
            # Gate on the engine's `finished` over-signal (B6-01), with the post-season MOMENT as a
            # robust fallback for engine version skew (the same terminal state the retrospective uses).
            is_over = bool(state.get("finished")) or state.get("moment") == "post-season"
            if not is_over:
                return JSONResponse(status_code=409, content={"error": "the current season is not over yet"})
            # Calibration instrumentation (belt): the season is provably OVER here, so capture its
            # public outcome BEFORE the reset wipes the engine sandbox — idempotent, so it never
            # double-logs a season the recap poll already captured. Never blocks the season advance.
            await _capture_season_outcome(user)
            # A new season is a new cast: scrub the prior portrait set before generating (0051).
            try:
                orwell_portraits.scrub_user(user)
            except Exception:
                pass
            # 0065 (belt-and-suspenders): explicitly drop the cast pre-warm state so a stale warm
            # gate can never bleed into the fresh cast. (prewarm self-resets on seed change too.)
            try:
                from src import orwell_prewarm
                orwell_prewarm.reset(user)
            except Exception:
                pass
            if body.keep:
                # Keep the houseguest (0056): a confirmed restart carrying the prior CHARACTER.
                res = await orwell_engine.create_character(None, confirm_restart=True, keep_character=True, user=user)
            else:
                # Recreate: reset to OOBE so the casting interview (0050) runs fresh for the new season.
                res = await orwell_engine.manage_sandbox("reset", user=user)
            # D3/E66 restart-door hygiene: clear the prior season's cached decision card so no phantom
            # pending (e.g. last season's juror-vote) rides the status route into the new season.
            orwell_engine.remember_pending(res, user=user)
            # 0064: rotate the canonical game session so the new season opens in a fresh chat.
            try:
                from src import orwell_game_session
                orwell_game_session.clear_game_session(user)
            except Exception:
                pass
            season = orwell_seasons.increment_season(user)  # the level is cleared — advance the counter
            try:
                prompts = res.get("portraitPrompts") if isinstance(res, dict) else None
                if prompts:
                    orwell_portraits.kickoff_generation(prompts, user)
            except Exception:
                pass
            return {"season": season, "kept": bool(body.keep), "state": res}
        except Exception as e:
            logger.warning(f"[orwell] next-season failed: {e}")
            return JSONResponse(status_code=502, content={"error": f"engine unreachable: {e}"})

    @router.post("/conclude-season")
    async def orwell_conclude_season(request: Request):
        """LW10 (audit 2026-06-21): when the PLAYER has been evicted PRE-JURY — their game is over but
        the house plays on — fast-forward the deterministic season to its crowned winner so the player
        lands on the (working) post-season retrospective (0048) + 'new season' hand-off, rather than
        nudging the house forward one week at a time with no terminal signal (0046's 'terminal recap').
        Player-reachable for the caller's OWN out-game only: gated on player.status == 'evicted' (a juror
        keeps their finale vote, so they are NOT swept here). Idempotent once the season is over."""
        user = _current_user(request)
        try:
            state = await orwell_engine.get_game_state(user=user)
            if not isinstance(state, dict) or not state.get("started"):
                return JSONResponse(status_code=409, content={"started": False, "error": "no season to conclude"})
            if state.get("finished") or state.get("moment") == "post-season":
                return {"finished": True, "alreadyOver": True}  # idempotent — the retrospective already gates
            player = state.get("player") or {}
            if player.get("status") != "evicted":
                return JSONResponse(status_code=409, content={
                    "error": "the season can only be concluded early once the player has been evicted pre-jury"})
            # The player is OUT (no player decision pends), so drive the deterministic loop to the crown
            # in ONE engine call — auto-resolving each remaining NPC ceremony with legal defaults.
            res = await orwell_engine.advance_to_finale(user=user)
            # Restart-door hygiene: refresh the FE-cached pending so no stale card rides into the recap.
            try:
                orwell_engine.remember_pending(await orwell_engine.game_status(user=user), user=user)
            except Exception:
                pass
            return {"finished": True, "result": res}
        except Exception as e:
            logger.warning(f"[orwell] conclude-season failed: {e}")
            return JSONResponse(status_code=502, content={"error": f"engine unreachable: {e}"})

    @router.post("/reset-progress")
    async def orwell_reset_progress(body: ResetProgressRequest, request: Request):
        """Feature 0057: the settings 'red zone' — wipe progress toward the CURRENT season and start
        it over from casting. Does NOT increment the season number (you restart the level, you never
        skip ahead). Player-reachable for the caller's OWN game only; routes through the engine's one
        sanctioned reset (manageSandbox reset ⇒ OOBE)."""
        user = _current_user(request)
        if not body.confirm:
            return JSONResponse(status_code=400, content={"error": "confirm=true is required to reset progress"})
        try:
            try:
                orwell_portraits.scrub_user(user)
            except Exception:
                pass
            # 0065 (belt-and-suspenders): explicitly drop the cast pre-warm state so a stale warm
            # gate can never bleed into the fresh cast. (prewarm self-resets on seed change too.)
            try:
                from src import orwell_prewarm
                orwell_prewarm.reset(user)
            except Exception:
                pass
            res = await orwell_engine.manage_sandbox("reset", user=user)  # the one sanctioned door
            orwell_engine.remember_pending(res, user=user)  # clear the prior season's cached decision card
            # 0064: rotate the canonical game session so the restarted level opens in a fresh chat.
            try:
                from src import orwell_game_session
                orwell_game_session.clear_game_session(user)
            except Exception:
                pass
            return {"reset": True, "state": res}  # season number is deliberately UNTOUCHED
        except Exception as e:
            logger.warning(f"[orwell] reset-progress failed: {e}")
            return JSONResponse(status_code=502, content={"error": f"engine unreachable: {e}"})


    # The FE's house style for user-facing feature failure is fail-OPEN (the panel
    # simply isn't there) — correct UX, structurally SILENT. This is the beacon sink
    # that makes those silences observable: orwellReport.js POSTs {surface, errorClass,
    # detail} from inside the fail-open catches, and the line lands in the G1b LIVE
    # ring via the root logger (src/log_rings.py), visible on /admin/status. NOT
    # admin-gated (player-context JS sends it); rate-limited per user (IP when
    # anonymous); shape-validated (three short strings only); NO storage beyond the
    # ring. Always answers 204 — the reporter never reads the response (sendBeacon
    # can't), and a misbehaving client gets silence, never an error to chase.
    _fe_report_limiter = RateLimiter(max_requests=30, window_seconds=60)
    _FE_REPORT_CAPS = {"surface": 80, "errorClass": 120, "detail": 300}

    @router.post("/fe-report")
    async def orwell_fe_report(request: Request):
        # Manual parse: sendBeacon may land as text/plain — content-type is no gate.
        try:
            data = json.loads((await request.body()).decode("utf-8", "replace") or "{}")
        except Exception:
            return Response(status_code=204)  # malformed body: drop silently
        if not isinstance(data, dict):
            return Response(status_code=204)
        fields = {}
        for key, cap in _FE_REPORT_CAPS.items():
            v = data.get(key, "")
            if not isinstance(v, str):
                return Response(status_code=204)  # three short strings only
            fields[key] = " ".join(v.split())[:cap]  # one ring line: collapse whitespace, clip
        if not fields["surface"]:
            return Response(status_code=204)
        who = _current_user(request) or (request.client.host if request.client else "anon")
        if not _fe_report_limiter.check(f"fe-report:{who}"):
            return Response(status_code=204)  # over the window: drop silently
        # A `startup`-tagged report is a benign boot race: a HUD poll fired before the
        # engine connection was ready (a network "Failed to fetch" before the first
        # confirmed engine contact, inside the boot grace window — see orwellReport.js).
        # Downgrade those to DEBUG so they don't spam the live ring at INFO; every genuine
        # (post-connect) failure is untagged and still logs at INFO, staying observable.
        level = logging.DEBUG if data.get("startup") is True else logging.INFO
        logger.log(level, "[fe-fail] %s: %s — %s",
                   fields["surface"], fields["errorClass"], fields["detail"])
        return Response(status_code=204)

    return router
