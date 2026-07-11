"""Feature #1400 (FE lane) — GENERATIVE COMPETITION DESIGN: the model DRESSES the engine's fixed roll.

The engine resolves each staged competition as ONE calibrated roll UP FRONT — the crown and the full
drop order are fixed before any staging renders. This module is the FE-owned author that, AFTER the roll
commits, invents the week's competition (theme + staging premise + per-round elimination fiction) MATCHED
to that already-decided outcome, and writes it BACK so the engine stays the source of truth
(``recordCompetitionFiction``). The FE owns the concrete utility LLM exactly as it owns the 0062 zeitgeist
/ 0058 cast-authoring write-backs; the engine treats the write-back as presentation-only season flavor.

THE SAFETY PROPERTY (why this is approvable): the model can never touch the result. It is handed the
FIXED drop order and authors prose for each drop IN THAT ORDER; the engine then RE-VALIDATES that every
elimination maps to its fixed drop order EXACTLY and REJECTS any mismatch — on a reject the deterministic
0042 competition-library floor simply stands. Best-effort + background + fail-soft: no model, no usable
output, or a rejected write-back ⇒ the 0042 floor stands (byte-identical to the pre-feature model).

COST CAP (#1400): exactly ONE utility completion per competition (~2/week — one HOH + one veto), fired
fire-and-forget with a per-(user, comp) in-flight guard. Tests inject deps; nothing depends on a live model.
"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Awaitable, Callable, Optional

from src import golden_path

logger = logging.getLogger(__name__)

# The bounds the engine also enforces (defense-in-depth; keeps the ask tight — flavor, not an almanac).
_MAX_THEME = 120
_MAX_PREMISE = 600
_MAX_LINE = 300

# Per-(user, comp-key) in-flight guard so two rapid advances never double-author the same competition.
_IN_FLIGHT: set[str] = set()

StagingFn = Callable[[], Awaitable[Optional[dict]]]   # () -> the competitionStagingView (or None)
LlmFn = Callable[[list], Awaitable[str]]              # messages -> completion text
WriteFn = Callable[[dict], Awaitable[dict]]           # fiction -> { accepted, reason? }


def _key(user: Optional[str], staging: dict) -> str:
    return f"{user or 'default'}:{staging.get('week')}:{staging.get('comp')}"


def _clamp(v: str, n: int) -> str:
    v = " ".join(str(v).split())
    return v[:n].rstrip() if len(v) > n else v


def _synthesis_messages(staging: dict) -> list[dict]:
    """Build the prompt: hand the model the comp type + participants + the FIXED winner + the FIXED drop
    order + the 0042 library scaffold, and ask for a theme/premise plus one fiction line PER DROP, IN THE
    GIVEN ORDER. The model dresses a decided result — the order is fixed and must be honored."""
    winner = (staging.get("winner") or {}).get("name", "the winner")
    drop = [d.get("name", "") for d in staging.get("dropOrder", []) if d.get("name")]
    field = [p.get("name", "") for p in staging.get("participants", []) if p.get("name")]
    lib = staging.get("library") or {}
    ordered = "\n".join(f"{i + 1}. {name}" for i, name in enumerate(drop))
    system = (
        "You are a reality-TV competition producer writing the STAGING of a Big Brother competition. The "
        "OUTCOME IS ALREADY DECIDED and is NOT yours to change — you are dressing a fixed result. Invent a "
        "vivid competition: a THEME (a short title), a PREMISE (how it is set up and played), and one short "
        "FICTION line for EACH elimination, IN THE EXACT ORDER GIVEN. Do NOT reorder, rename, add, or drop "
        "anyone. The winner OUTLASTS the field. Output ONLY a JSON object (no prose, no markdown fence), "
        'exactly these keys: {"theme":"..","premise":"..","winReads":"..","drops":{"<name>":"<one line>"}}. '
        "`drops` maps EACH eliminated houseguest's name (exactly as given) to one short line describing how "
        "they go out, consistent with the theme. Keep each line to one sentence."
    )
    user = (
        f"Competition type: {staging.get('type', 'endurance')} ({staging.get('format', 'endurance')}).\n"
        f"Field (all who competed): {', '.join(field)}.\n"
        f"Winner (outlasts everyone): {winner}.\n"
        f"Eliminated, in the EXACT order they go out (earliest first) — write one line for each, in this order:\n"
        f"{ordered}\n\n"
        f"Library inspiration to riff on (optional): {lib.get('name', '')} — {lib.get('premise', '')}\n\n"
        "JSON only:"
    )
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


def build_fiction(staging: dict, text: str) -> Optional[dict]:
    """Parse the model JSON and build the ``recordCompetitionFiction`` payload, keying every elimination
    to the ENGINE'S FIXED drop order (id + name from the staging view) and pulling the model's line for
    that name. Returns ``None`` when nothing usable parsed OR the model did not cover every drop — so the
    engine's floor stands rather than a doomed write-back. The engine RE-VALIDATES regardless."""
    if not isinstance(text, str) or not text.strip():
        return None
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end <= start:
        return None
    try:
        obj = json.loads(text[start:end + 1])
    except (ValueError, TypeError):
        return None
    if not isinstance(obj, dict):
        return None
    theme = _clamp(obj.get("theme", ""), _MAX_THEME)
    premise = _clamp(obj.get("premise", ""), _MAX_PREMISE)
    if not theme or not premise:
        return None
    win_reads = _clamp(obj.get("winReads", ""), _MAX_LINE)
    drops = obj.get("drops")
    if not isinstance(drops, dict):
        return None
    # Case-insensitive name -> line map from the model's output.
    by_name = {str(k).strip().lower(): str(v).strip() for k, v in drops.items() if str(v).strip()}
    eliminations = []
    for d in staging.get("dropOrder", []):
        name = d.get("name", "")
        did = d.get("id")
        line = by_name.get(str(name).strip().lower())
        if not did or not line:
            return None  # incomplete coverage ⇒ do not attempt a partial write-back (floor stands)
        eliminations.append({"id": did, "fiction": _clamp(line, _MAX_LINE)})
    if not eliminations:
        return None
    payload = {
        "comp": staging.get("comp"),
        "week": staging.get("week"),
        "theme": theme,
        "premise": premise,
        "eliminations": eliminations,
    }
    if win_reads:
        payload["winReads"] = win_reads
    return payload


async def author_competition(staging_fn: StagingFn, llm_fn: LlmFn, write_fn: WriteFn) -> dict:
    """Orchestrate: read the staging view → synthesize fiction → write it back. Injected deps make the
    whole lane testable without a live model/engine. Returns the write-back result (``{accepted, reason?}``)
    or ``{"accepted": False, "reason": ...}`` — the deterministic 0042 floor then stands. Never raises."""
    try:
        staging = await staging_fn()
    except Exception as e:  # a staging read hiccup ⇒ floor stands
        logger.warning("[gen-comp] staging read failed: %s", e)
        return {"accepted": False, "reason": "no-staging"}
    if not isinstance(staging, dict) or not staging.get("dropOrder"):
        return {"accepted": False, "reason": "no-staging"}  # generation off, or no comp resolved yet
    try:
        text = await llm_fn(_synthesis_messages(staging))
    except Exception as e:
        logger.warning("[gen-comp] synthesis failed: %s", e)
        return {"accepted": False, "reason": "llm-failed"}
    fiction = build_fiction(staging, text or "")
    if not fiction:
        return {"accepted": False, "reason": "no-fiction"}
    try:
        return await write_fn(fiction)
    except Exception as e:
        logger.warning("[gen-comp] write-back failed: %s", e)
        return {"accepted": False, "reason": "write-failed"}


# ── live wiring (best-effort, background; graceful no-op when no model / generation off) ─────────────

async def run_author(owner: Optional[str], staging: Optional[dict] = None) -> dict:
    """Resolve the live deps and author the current competition's fiction over the ALREADY-FETCHED staging
    view (or fetch it when not supplied). Silent no-op (not accepted) when no utility model resolves OR
    there is no staging view (generation disabled, or no comp has resolved its roll) — the engine's
    deterministic 0042 floor then stands."""
    from src import orwell_engine
    if staging is None:
        try:
            staging = await orwell_engine.competition_staging_view(user=owner)
        except Exception:
            return {"accepted": False, "reason": "no-staging"}
    if not isinstance(staging, dict) or not staging.get("dropOrder"):
        return {"accepted": False, "reason": "no-staging"}

    try:
        from src.orwell_cast_authoring import _resolve_llm_fn  # the shared background-utility completion
    except Exception:
        return {"accepted": False, "reason": "no-model"}
    llm_fn = await _resolve_llm_fn(owner)
    if llm_fn is None:
        logger.debug("[gen-comp] no utility model — the 0042 competition floor stands")
        return {"accepted": False, "reason": "no-model"}

    ready = staging  # already validated non-None with a drop order above

    async def _write(fiction: dict) -> dict:
        return await orwell_engine.record_competition_fiction(fiction, user=owner)

    result = await author_competition(lambda: _ready(ready), llm_fn, _write)
    # If the fiction landed on the live game, push a server-side "game-updated" so open pages reconcile.
    if isinstance(result, dict) and result.get("accepted"):
        try:
            from src import orwell_game_session
            orwell_game_session.publish_game_updated(owner)
        except Exception:
            pass
    return result


async def _ready(staging: dict) -> dict:
    """Return the already-fetched staging view (avoids a second engine round-trip inside author_competition)."""
    return staging


def kickoff_fiction(owner: Optional[str]) -> None:
    """Fire-and-forget the competition-fiction author in the background, ONCE per staged competition.
    Never blocks the turn; never raises into the caller. A per-(user, week, comp) in-flight guard stops a
    rapid re-advance from double-authoring the same competition. A no-op under golden record/replay (its
    live model call is inherently non-reproducible; the engine's floor stands, exactly as with no model).
    One cheap staging read gates everything — no staged comp ⇒ no model is ever spun up."""
    if golden_path.active():
        logger.info("[gen-comp] skipped: golden record/replay mode (determinism)")
        return

    async def _runner():
        try:
            from src import orwell_engine
            staging = await orwell_engine.competition_staging_view(user=owner)
        except Exception:
            return
        if not isinstance(staging, dict) or not staging.get("dropOrder"):
            return  # generation off, or no comp has resolved its roll — nothing to dress
        k = _key(owner, staging)
        if k in _IN_FLIGHT:
            return
        _IN_FLIGHT.add(k)
        try:
            await run_author(owner, staging)
        except Exception as e:  # pragma: no cover - defensive
            logger.warning("[gen-comp] background author failed: %s", e)
        finally:
            _IN_FLIGHT.discard(k)

    try:
        loop = asyncio.get_running_loop()
        loop.create_task(_runner())
    except RuntimeError:
        # No running loop (a sync caller / test) — run to completion synchronously.
        try:
            asyncio.run(_runner())
        except Exception:
            pass
