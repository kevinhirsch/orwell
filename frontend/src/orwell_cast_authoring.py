"""Feature 0058 / ledger L28b — the producer-LLM authors each NPC's rich backstory, written BACK
to the engine (the airtight source of truth). Mirrors the 0051 portrait handshake:

    engine seeds the deterministic floor + returns the Vault-free cast
      → the FE producer-LLM authors each houseguest's §3-depth profile (endless variety)
      → the FE writes it back via recordCastProfile (the engine validates / splits across the
        Vault Wall / re-derives threads / re-seals) — the engine is now the source of truth
      → only THEN do the authored physical facets feed the portrait prompts (pipeline order).

Design: the orchestrator (`author_cast`) takes INJECTED `llm_fn` + `write_fn`, so the whole
pipeline is unit-testable without a live model or engine. `kickoff_authoring` wires the real
deps (a resolved utility model + the engine client) and runs it in the BACKGROUND — game start
never blocks on it, and a missing/failed model is a silent no-op (the seeded floor stays
authoritative, exactly like portraits degrade gracefully).

The HARD guarantees are the engine's (it validates non-player-mirroring, splits PUBLIC↔HIDDEN,
never echoes a hidden value). This module only authors + forwards; it never seals anything.
"""
from __future__ import annotations

import asyncio
import json
import re
from typing import Awaitable, Callable, Optional

try:  # the structured logger if present; a no-op stand-in keeps this importable in isolation
    from loguru import logger
except Exception:  # pragma: no cover
    class _L:  # minimal fallback
        def info(self, *a, **k): pass
        def warning(self, *a, **k): pass
        def debug(self, *a, **k): pass
    logger = _L()


# ── the producer-framed authoring prompt ──────────────────────────────────────
#
# ANTI-SYCOPHANCY (mandate #3): an NPC's STORYLINE is authored as if the player does not exist.
# Each houseguest is one of sixteen with their OWN life, rivalries, secrets, and arcs — most of the
# house's drama has nothing to do with the player. The authoring prompt therefore carries NO player
# identity at all: secrets/goals/weakness/biography must NEVER be built around, reference, or revolve
# around the player. The NPC's Day-1 read of the player is a SEPARATE concept owned entirely by the
# engine's seeded, net-zero-balanced floor (the LLM does not author it) — so the authored storyline
# cannot tilt the cast toward the player and the calibration (juryReach) balance is preserved.
_SYSTEM = (
    "You are a Big Brother CASTING PRODUCER building the secret bible for ONE houseguest. "
    "Write a rich, believable, reality-TV-plausible person with real depth and a life that exists "
    "ENTIRELY on its own. Output STRICT JSON only (no prose around it), with these keys:\n"
    '  "biography": a 2-3 sentence presentable backstory (life outside the house),\n'
    '  "physicalCharacteristics": { "heightBuild", "skinTone", "hair", "facialFeatures", '
    '"distinguishingMark", "ageLook", "style" } — short phrases; this single facet is what BOTH '
    "the portrait and the narration read, so make it concrete and distinctive,\n"
    '  "secrets": an array of 2-3 real secrets that could play out,\n'
    '  "trueGoals": an array of 2 true strategic goals (distinct from any public game),\n'
    '  "weakness": one named blind spot the game can exploit on a delay.\n'
    "GROUND EVERYTHING IN THIS SPECIFIC PERSON (the core requirement): the secrets, true goals, and "
    "weakness must be authored FROM this houseguest's OWN backstory, OCCUPATION, ARCHETYPE, and AGE in "
    "the public skeleton — a private chef's secret should read like a private chef's, a firefighter's "
    "weakness like a firefighter's, a 23-year-old's stakes unlike a 50-year-old's. Make the hidden life "
    "cohere with the job and the life-stage; never a generic, interchangeable secret that could belong "
    "to anyone. Their threads may involve OTHER houseguests, pre-show ties, or personal stakes.\n"
    "Hard rules: this houseguest's STORYLINE is fully INDEPENDENT — their secrets, goals, weakness, "
    "and backstory exist on their own but must NEVER be built around, reference, or revolve around any "
    "single 'player' or main character; there is no protagonist here, only a cast of equals. Make this "
    "person VISIBLY distinct from a generic warm, witty professional. JSON only."
)

# The keys the engine's recordCastProfile accepts (everything else is dropped before write-back).
# NOTE: `dayOnePerception` is INTENTIONALLY NOT authored here (anti-sycophancy) — the engine owns the
# seeded, balanced Day-1 read. We never send it, so the authoring path carries zero player coupling.
_PUBLIC_KEYS = ("biography", "physicalCharacteristics")
_HIDDEN_KEYS = ("secrets", "trueGoals", "weakness")
_PHYS_KEYS = ("heightBuild", "skinTone", "hair", "facialFeatures", "distinguishingMark", "ageLook", "style")

# Bounded concurrency for `author_cast` (#5): author NPCs in parallel but never flood the utility
# endpoint — at most this many authoring LLM calls are in flight at once.
_AUTHOR_CONCURRENCY = 3

# Quality floor (#3, FE-side guard): a degraded/thin authored field must never overwrite the richer
# deterministic seeded floor in the engine. Since recordCastProfile only overwrites the fields it
# receives, OMITTING a sub-floor field is the whole guard — the engine keeps its prior (seeded) value.
_BIO_MIN_CHARS = 80          # a coherent presentable backstory is more than a clause
_BIO_MIN_SENTENCES = 2       # >= 2 sentence terminators [.!?]
_HIDDEN_ENTRY_MIN_CHARS = 12  # a real secret/weakness is more than a stray word
_SENTENCE_TERMINATORS = re.compile(r"[.!?]")


def _biography_meets_floor(bio: str) -> bool:
    """A presentable backstory must clear the coherence floor (>= 2 sentence terminators AND
    >= 80 chars). Below it the seeded floor is richer, so we drop the authored value entirely."""
    if not bio:
        return False
    return len(bio) >= _BIO_MIN_CHARS and len(_SENTENCE_TERMINATORS.findall(bio)) >= _BIO_MIN_SENTENCES


def build_authoring_messages(npc: dict) -> list[dict]:
    """The producer prompt for ONE houseguest. Seeds the LLM with the houseguest's PUBLIC skeleton
    (name + whatever public facets the engine already exposes) and NOTHING about the player — the
    NPC's storyline is authored as if the player does not exist (anti-sycophancy, mandate #3).
    Returns chat messages for the utility model."""
    name = str(npc.get("name") or "this houseguest")
    skeleton = {
        k: npc.get(k)
        for k in ("name", "age", "vocation", "hometown", "archetype", "demeanor", "presentation", "appearance")
        if npc.get(k) is not None
    }
    user = (
        f"Houseguest to flesh out: {name}.\n"
        f"Public skeleton (build FROM this, never contradict it): {json.dumps(skeleton, ensure_ascii=False)}\n"
        f"Ground {name}'s secrets, true goals, and weakness in THIS skeleton — their specific occupation, "
        f"archetype, age, and backstory — so the hidden life reads like THIS exact person and no one else. "
        f"Write {name}'s secret bible as JSON now — their own independent life, no protagonist."
    )
    return [{"role": "system", "content": _SYSTEM}, {"role": "user", "content": user}]


def _extract_json(text: str) -> Optional[dict]:
    """Pull the first JSON object out of the model's reply (tolerant of ```json fences / chatter)."""
    if not text:
        return None
    fenced = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.S)
    raw = fenced.group(1) if fenced else None
    if raw is None:
        start = text.find("{")
        end = text.rfind("}")
        if start == -1 or end == -1 or end <= start:
            return None
        raw = text[start:end + 1]
    try:
        obj = json.loads(raw)
        return obj if isinstance(obj, dict) else None
    except (ValueError, TypeError):
        return None


def parse_authored_profile(text: str, houseguest_id: str) -> Optional[dict]:
    """Parse the LLM's reply into a recordCastProfile request, keeping ONLY the schema keys and
    coercing types. Returns None when nothing usable was authored (the seeded floor then stays)."""
    obj = _extract_json(text)
    if obj is None:
        return None
    out: dict = {"houseguestId": houseguest_id}

    if isinstance(obj.get("biography"), str) and obj["biography"].strip():
        bio = obj["biography"].strip()
        # Quality floor (#3): only overwrite the seeded floor with a coherent biography. A thin /
        # degraded one is dropped (omitted), so the engine keeps its richer deterministic value.
        if _biography_meets_floor(bio):
            out["biography"] = bio
        else:
            logger.warning(
                f"[cast-authoring] biography below floor for {houseguest_id} "
                f"({len(bio)} chars, {len(_SENTENCE_TERMINATORS.findall(bio))} sentence(s)) — "
                "omitting so the seeded floor stands")
    phys = obj.get("physicalCharacteristics")
    if isinstance(phys, dict):
        facet = {k: str(phys[k]).strip() for k in _PHYS_KEYS if isinstance(phys.get(k), (str, int)) and str(phys.get(k)).strip()}
        if len(facet) == len(_PHYS_KEYS):  # the facet is the text↔image source of truth — only write it whole
            out["physicalCharacteristics"] = facet

    secrets = obj.get("secrets")
    if isinstance(secrets, list):
        # Light floor (#3): drop trivially-short/empty secrets so a degraded list never replaces
        # the seeded hidden material wholesale. If everything is too thin, omit the field entirely.
        clean = [str(s).strip() for s in secrets if len(str(s).strip()) >= _HIDDEN_ENTRY_MIN_CHARS]
        if clean:
            out["secrets"] = clean[:3]
        elif any(str(s).strip() for s in secrets):
            logger.warning(f"[cast-authoring] all secrets below floor for {houseguest_id} — omitting")
    goals = obj.get("trueGoals")
    if isinstance(goals, list):
        clean = [str(g).strip() for g in goals if str(g).strip()]
        if clean:
            out["trueGoals"] = clean[:2]
    if isinstance(obj.get("weakness"), str) and obj["weakness"].strip():
        weak = obj["weakness"].strip()
        # Light floor (#3): a one-word weakness is degraded — drop it so the seeded value stands.
        if len(weak) >= _HIDDEN_ENTRY_MIN_CHARS:
            out["weakness"] = weak
        else:
            logger.warning(f"[cast-authoring] weakness below floor for {houseguest_id} — omitting")
    # `dayOnePerception` is deliberately NOT forwarded (anti-sycophancy): even if a model echoes it
    # back, the NPC's Day-1 read of the player is the engine's seeded, balanced floor — never authored.

    # Nothing beyond the id ⇒ nothing to write.
    if len(out) <= 1:
        return None
    return out


# ── the orchestrator (injectable — fully unit-testable) ───────────────────────

LlmFn = Callable[[list[dict]], Awaitable[str]]
WriteFn = Callable[[dict], Awaitable[dict]]


async def author_cast(cast: list[dict], llm_fn: LlmFn, write_fn: WriteFn,
                      on_authored: Optional[Callable[[str], None]] = None,
                      *, concurrency: int = _AUTHOR_CONCURRENCY) -> int:
    """For each NPC in `cast`: build the producer prompt → `llm_fn` → parse → `write_fn`
    (recordCastProfile). Best-effort PER houseguest: one failure never aborts the rest (the seeded
    floor stays authoritative for any NPC that couldn't be authored). Returns how many were written.

    The PLAYER is skipped (only the player's profile is human-authored, at OOBE). Anything without an
    id is skipped. The engine owns the wall (validation / split / seal); this never seals anything.
    The player's identity is NOT threaded in at all — NPC storylines are authored player-independent
    (anti-sycophancy, mandate #3).

    Authoring runs with BOUNDED concurrency (#5): NPCs are authored in parallel (the engine write-back
    is idempotent per houseguest, so there is no cross-NPC ordering dependency), but at most
    `concurrency` LLM calls are in flight at once so the utility endpoint is never flooded.

    `on_authored(houseguest_id)` — when supplied — is fired AFTER each successful, engine-accepted
    write-back (per-NPC portrait gating, #7). It is best-effort: a callback raising never aborts
    authoring. It is never fired for an NPC that wasn't authored / was refused.
    """
    sem = asyncio.Semaphore(max(1, int(concurrency)))

    async def _author_one(npc: dict) -> int:
        hid = npc.get("id")
        if not hid or hid == "player":
            return 0
        async with sem:
            try:
                text = await llm_fn(build_authoring_messages(npc))
            except Exception as e:  # the model can fail for one houseguest; carry on
                logger.warning(f"[cast-authoring] llm failed for {hid}: {e}")
                return 0
            profile = parse_authored_profile(text or "", hid)
            if not profile:
                return 0
            try:
                res = await write_fn(profile)
            except Exception as e:
                logger.warning(f"[cast-authoring] write-back failed for {hid}: {e}")
                return 0
        if not (isinstance(res, dict) and res.get("accepted")):
            return 0
        # The write-back landed — signal this one NPC's completion so its portrait can shoot now (#7).
        if on_authored is not None:
            try:
                on_authored(hid)
            except Exception as e:  # pragma: no cover - defensive: a gate callback must never abort
                logger.warning(f"[cast-authoring] on_authored({hid}) failed: {e}")
        return 1

    results = await asyncio.gather(*[_author_one(npc) for npc in (cast or [])])
    written = sum(results)
    logger.info(f"[cast-authoring] authored {written} houseguest profile(s)")
    return written


# ── the live wiring (best-effort, background; graceful no-op when no model) ────

async def _resolve_llm_fn(owner: Optional[str]) -> Optional[LlmFn]:
    """Build a one-shot completion fn over the user's UTILITY model (background-safe, like the email
    triage path). Returns None when no usable endpoint resolves — authoring then silently no-ops."""
    try:
        from src.endpoint_resolver import resolve_endpoint, resolve_utility_fallback_candidates
        from src.llm_core import stream_llm_with_fallback
    except Exception:
        return None
    url, model, headers = resolve_endpoint("utility", owner=owner)
    if not url or not model:
        url, model, headers = resolve_endpoint("default", owner=owner)
    if not url or not model:
        return None
    candidates = [(url, model, headers)] + (resolve_utility_fallback_candidates(owner=owner) or [])

    # ADR 0010: the background-authoring reasoning budget (admin-overridable). Fail-open.
    _policy = None
    try:
        from src.token_policy import resolve_token_policy
        from src.settings import get_setting as _gs
        _policy = resolve_token_policy("background-authoring", {"reasoning_budget": _gs("reasoning_budget", {})})
    except Exception:
        _policy = None

    async def _fn(messages: list[dict]) -> str:
        parts: list[str] = []
        _usage: dict = {}
        async for chunk in stream_llm_with_fallback(candidates, messages, temperature=0.9, policy=_policy):
            # stream_llm yields SSE-ish data lines; keep only the assistant text deltas.
            piece = _delta_text(chunk)
            if piece:
                parts.append(piece)
                continue
            # ADR 0010: capture the usage envelope (the trailing 'usage' SSE event) for the meter.
            s = str(chunk or "")
            if s.startswith("data:"):
                _body = s[5:].strip()
                if _body and _body != "[DONE]":
                    try:
                        _d = json.loads(_body)
                    except (ValueError, TypeError):
                        _d = None
                    if isinstance(_d, dict) and _d.get("type") == "usage":
                        _ud = _d.get("data") or {}
                        if _ud:
                            _usage = {
                                "input_tokens": _ud.get("input_tokens", 0),
                                "output_tokens": _ud.get("output_tokens", 0),
                                "cached_tokens": _ud.get("cached_tokens", 0) or 0,
                                "reasoning_tokens": _ud.get("reasoning_tokens", 0) or 0,
                                "cost": _ud.get("cost"),
                                "provider": _ud.get("provider"),
                            }
        # ADR 0010: one Vault-free token/cost entry per authoring call, keyed by the canonical game
        # session so it aggregates with the game's narration spend. Fail-open; never seen by the player.
        if owner and _usage:
            try:
                from src import orwell_token_ledger as _tl
                _sess = None
                try:
                    from src import orwell_game_session as _gs2
                    _sess = _gs2.get_game_session(owner)
                except Exception:
                    _sess = None
                _tl.record_turn(
                    owner, session=_sess or owner, turn_id=None, call_class="background-authoring",
                    input_tokens=_usage.get("input_tokens", 0), cached_tokens=_usage.get("cached_tokens", 0),
                    reasoning_tokens=_usage.get("reasoning_tokens", 0), output_tokens=_usage.get("output_tokens", 0),
                    cost=float(_usage.get("cost") or 0), provider=_usage.get("provider"),
                )
            except Exception:
                pass
        return "".join(parts)

    return _fn


def _delta_text(chunk) -> str:
    """Extract assistant text from a stream_llm chunk (a dict delta or an SSE 'data:' line)."""
    if isinstance(chunk, dict):
        return str(chunk.get("content") or chunk.get("text") or "")
    s = str(chunk or "")
    if s.startswith("data:"):
        body = s[5:].strip()
        if body and body != "[DONE]":
            try:
                d = json.loads(body)
                if isinstance(d, dict):
                    return str(d.get("content") or d.get("text") or "")
            except (ValueError, TypeError):
                return ""
        return ""
    return s


async def run_authoring(cast: list[dict], owner: Optional[str],
                        on_authored: Optional[Callable[[str], None]] = None,
                        write: Optional[WriteFn] = None) -> int:
    """Resolve the live deps and author the cast. Silent no-op (returns 0) if no model resolves.
    No player identity is threaded in — NPC storylines are authored player-independent.
    `on_authored(houseguest_id)` fires per successful write-back (per-NPC portrait gating, #7).

    `write` overrides the write-back sink (default: `record_cast_profile` onto the active/pre-game cast).
    The 0065 advance-warm passes a sink that routes through `pre_seed_next_season(profile=…)` so the
    authored profile lands on the NEXT-season HOLDING store — NEVER the live cast (mid-season,
    `record_cast_profile` would author the running house, the wrong cast)."""
    llm_fn = await _resolve_llm_fn(owner)
    if llm_fn is None:
        logger.debug("[cast-authoring] no utility model — keeping the seeded floor")
        return 0
    from src import orwell_engine

    async def _write(profile: dict) -> dict:
        return await orwell_engine.record_cast_profile(profile, user=owner)

    return await author_cast(cast, llm_fn, write or _write, on_authored)


def kickoff_authoring(cast: list[dict], owner: Optional[str],
                      then: Optional[Callable[[], None]] = None,
                      on_authored: Optional[Callable[[str], None]] = None,
                      write: Optional[WriteFn] = None) -> None:
    """Fire-and-forget: author the cast in the background BEFORE portraits (the authored physical
    facet feeds the portrait prompt — pipeline order), then call `then` (e.g. the portrait kickoff)
    REGARDLESS of authoring success, so the picture still generates from the seeded facets if the
    model was unavailable. Never blocks game start; never raises into the caller.
    The player's identity is NOT passed in — NPC storylines are authored player-independent.

    `on_authored(houseguest_id)` — when supplied — fires after EACH NPC's successful write-back so a
    consumer can gate that one houseguest's portrait the moment it is authored (#7). `then` still
    fires once at the very end (whole-cast done), success or failure, so a whole-cast fallback /
    gate-release can never hang."""
    async def _runner():
        try:
            await run_authoring(cast, owner, on_authored, write)
        except Exception as e:  # pragma: no cover - defensive
            logger.warning(f"[cast-authoring] background run failed: {e}")
        finally:
            if then is not None:
                try:
                    then()
                except Exception:
                    pass
    try:
        loop = asyncio.get_running_loop()
        loop.create_task(_runner())
    except RuntimeError:
        # No running loop (e.g. a sync caller / test) — run to completion synchronously, then chain.
        try:
            asyncio.run(_runner())
        except Exception:
            if then is not None:
                then()
