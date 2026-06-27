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
    '  "name": a realistic, common, pronounceable FIRST and LAST name (two words) for a reality-TV '
    "contestant — diverse and ordinary, NEVER invented/fantasy/gibberish; do not reuse the houseguest's "
    "current name.\n"
    '  "biography": a 2-3 sentence presentable backstory (life outside the house),\n'
    '  "vocation": a SHORT occupation noun phrase (e.g. "court reporter"). KEEP the skeleton\'s '
    "occupation by default; ONLY change it if your biography genuinely gives this person a different "
    "job — and then set vocation to MATCH the biography. The public occupation and the biography must "
    "name the SAME job, and the secrets must be grounded in THAT job (the engine keys the hidden stakes "
    "off vocation),\n"
    '  "physicalCharacteristics": { "heightBuild", "skinTone", "hair", "facialFeatures", '
    '"distinguishingMark", "ageLook", "style" } — short phrases; this single facet is what BOTH '
    "the portrait and the narration read, so make it concrete and distinctive. The look must COHERE "
    "with the houseguest's heritage/ethnicity in the skeleton (skin tone, hair, features that fit that "
    "background) — never a generic default; vary it widely across the cast,\n"
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
    "person VISIBLY distinct from a generic warm, witty professional.\n"
    "OUTPUT CONTRACT (HARD, #1002): reply with a SINGLE raw JSON object and NOTHING else — no prose, "
    "no markdown, no ```json fences, no preamble, no chain-of-thought in the body. The first character "
    "of your reply MUST be '{' and the last MUST be '}'. JSON only."
)

# #1002: the OpenAI/OpenRouter structured-output request — threaded onto the authoring call so a model
# that honours it returns strict JSON (no prose/reasoning leaking into the body). A provider that
# ignores it is harmless: the prompt reinforcement above + the one-shot retry below still apply.
_RESPONSE_FORMAT = {"type": "json_object"}

# #1044: the authoring sampling temperature. This is a STRUCTURED-OUTPUT task (emit one JSON object),
# not a creative free-write — the variety lives in WHAT each houseguest is, which the per-NPC skeleton +
# the rich prompt already drive. A high temperature (the old 0.9) measurably hurts strict-JSON adherence
# on reasoning models (deepseek-v4-pro) for the complex deep-profile prompt; a moderate value keeps ample
# persona variety while improving the odds the reply is a clean, parseable object on the first pass.
_AUTHOR_TEMPERATURE = 0.6

# #1044: the floor visible-output budget for an authoring call. With reasoning forced OFF (below) the
# whole cap is the answer; a full deep-profile JSON object is ~500-800 tokens, so this leaves generous
# headroom for a verbose biography without truncation. Applied even if an admin set the per-class
# `max_tokens_budget` too low (the observed live value was 1200 — fine once reasoning is off, but we
# never want authoring to truncate a profile mid-object).
_AUTHOR_MIN_OUTPUT_TOKENS = 2000

# #1002: the one-shot reparse retry instruction. DeepSeek (and other reasoning models) reliably emit
# reasoning/prose around the JSON instead of a bare object; when the first reply yields no JSON we retry
# ONCE with this maximally-strict instruction appended before falling back to the seeded floor.
_STRICT_RETRY = (
    "Your previous reply did not contain a parseable JSON object. Reply now with ONLY the JSON object "
    "for this houseguest — start with '{', end with '}', no prose, no markdown, no fences, no reasoning."
)

# #1057: the retry instruction for an EMPTY or TRUNCATED visible body. The live-verify proved that under
# the concurrent authoring burst (15 calls sharing the OpenRouter endpoint with premiere narration),
# deepseek-v4-pro emits an EMPTY `text` channel or a JSON object that is CLIPPED mid-stream (finish_reason
# "length" / the budget exhausted before the closing brace). Neither is the #1002 "the model emitted
# prose INSTEAD of JSON" failure — there was no full body to reparse — so that retry never fired and the
# call fell straight to the floor. This re-issues the call (reasoning already OFF, the roomy
# _AUTHOR_MIN_OUTPUT_TOKENS floor) asking for the COMPLETE object, compactly, so it fits the budget.
_TRUNCATION_RETRY = (
    "Your previous reply was empty or cut off before the JSON object was complete. Reply now with the "
    "COMPLETE JSON object for this houseguest in one piece — start with '{', end with '}', keep every "
    "field concise so the whole object fits, no prose, no markdown, no fences, no reasoning."
)

# #1057: how many times to re-issue a call whose VISIBLE body came back EMPTY or TRUNCATED (clipped JSON).
# This is the DOMINANT live failure (provider truncation under the concurrent burst), distinct from the
# #1002 "full body, no JSON" prose case. Bounded + fail-soft: after the budget is spent the call lands on
# the seeded floor exactly as before. A small backoff between attempts gives a transient provider
# overload under the burst time to clear.
_EMPTY_TRUNCATED_RETRIES = 2
_RETRY_BACKOFF_SECONDS = 0.4

# The keys the engine's recordCastProfile accepts (everything else is dropped before write-back).
# NOTE: `dayOnePerception` is INTENTIONALLY NOT authored here (anti-sycophancy) — the engine owns the
# seeded, balanced Day-1 read. We never send it, so the authoring path carries zero player coupling.
# `vocation` (#849): the PUBLIC occupation — forwarded so it stays in lockstep with an authored
# biography and the engine re-grounds the hidden stakes off the job the player will infer.
_PUBLIC_KEYS = ("name", "biography", "vocation", "physicalCharacteristics")
_HIDDEN_KEYS = ("secrets", "trueGoals", "weakness")
_PHYS_KEYS = ("heightBuild", "skinTone", "hair", "facialFeatures", "distinguishingMark", "ageLook", "style")

# Bounded concurrency for `author_cast` (#5): author NPCs in parallel but never flood the utility
# endpoint — at most this many authoring LLM calls are in flight at once.
#
# #1057: lowered 3 → 2. The live-verify proved that at 3 the 15-call authoring burst — running CONCURRENT
# with premiere narration on the SAME OpenRouter endpoint — pushed deepseek-v4-pro into emitting empty /
# truncated `text` (12/15 fell to the floor). Dropping the in-flight authoring load to 2 measurably eases
# the provider pressure while keeping authoring well under a couple of minutes for a 15-NPC cast (15 calls
# / 2 in flight, each a few seconds, plus the empty/truncated retries below). It is fail-soft background
# work, so throughput is secondary to NOT truncating — but 2 (not 1) keeps it from dragging on. The
# empty/truncated retry (below) is the primary defense; this just lowers the rate at which the burst
# trips truncation in the first place.
_AUTHOR_CONCURRENCY = 2

# Quality floor (#3, FE-side guard): a degraded/thin authored field must never overwrite the richer
# deterministic seeded floor in the engine. Since recordCastProfile only overwrites the fields it
# receives, OMITTING a sub-floor field is the whole guard — the engine keeps its prior (seeded) value.
_BIO_MIN_CHARS = 80          # a coherent presentable backstory is more than a clause
_BIO_MIN_SENTENCES = 2       # >= 2 sentence terminators [.!?]
_HIDDEN_ENTRY_MIN_CHARS = 12  # a real secret/weakness is more than a stray word
_SENTENCE_TERMINATORS = re.compile(r"[.!?]")
# `vocation` (#849) is a SHORT occupation noun phrase ("court reporter") — not a sentence. A value that
# is empty or a runaway paragraph is degraded; drop it (the engine keeps the seeded vocation in lockstep).
_VOCATION_MAX_CHARS = 60


# The LLM-authored replacement display name guard — mirrors the engine's `isReasonableName`
# (GameSessionAdapter): exactly two whitespace-separated tokens, each a plausible capitalized name part
# (optional hyphen/apostrophe compound, e.g. "O'Neil"), 2-12 chars, with >= 1 vowel and no run of 4+
# consecutive consonants. A name that fails is DROPPED from the write-back so the engine's seeded corpus
# name (the deterministic floor) simply stands. Rejects "Nerighrengeinen Herneingenenin"; accepts
# "Marcus Webb", "Priya Anand", "Mary-Kate O'Neil".
_NAME_TOKEN = re.compile(r"^[A-Z][a-z]*([-'][A-Z]?[a-z]+)?$")
_NAME_VOWEL = re.compile(r"[aeiouy]", re.I)
_NAME_CONSONANT_RUN = re.compile(r"[bcdfghjklmnpqrstvwxz]{4,}", re.I)


def _is_reasonable_name(s: str) -> bool:
    tokens = (s or "").strip().split()
    if len(tokens) != 2:
        return False
    for token in tokens:
        if not (2 <= len(token) <= 12):
            return False
        if not _NAME_TOKEN.match(token):
            return False
        if not _NAME_VOWEL.search(token):
            return False
        if _NAME_CONSONANT_RUN.search(token):
            return False
    return True


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
    # Include `ethnicity` (the engine-guaranteed heritage, 0063) so the authored look COHERES with it —
    # without it the model invents complexion/features unmoored from the seeded identity and reliably
    # defaults skin tone to a generic "olive". (The engine RE-GROUNDS skinTone to the heritage on
    # write-back regardless, so this is for the surrounding facets — hair, features, style.)
    skeleton = {
        k: npc.get(k)
        for k in ("name", "age", "vocation", "hometown", "archetype", "demeanor", "presentation", "appearance", "ethnicity")
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


def _balanced_json_objects(text: str):
    """Yield each top-level balanced ``{...}`` candidate substring in `text`, in order, string-aware
    (braces inside JSON string literals are ignored). This survives a prose preamble/epilogue AND a
    trailing second object/garbage that a naive first-`{`/last-`}` slice would swallow (e.g.
    ``Here is the profile: {…} Hope that helps!``). Each candidate is a complete brace-balanced span."""
    depth = 0
    start = -1
    in_str = False
    esc = False
    for i, ch in enumerate(text):
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == "{":
            if depth == 0:
                start = i
            depth += 1
        elif ch == "}":
            if depth > 0:
                depth -= 1
                if depth == 0 and start != -1:
                    yield text[start:i + 1]
                    start = -1


def _extract_json(text: str) -> Optional[dict]:
    """Pull the first usable JSON OBJECT out of the model's reply — robust to prose-wrapped output.

    Strategy (in order):
      1. a ```json … ``` fenced block, if present;
      2. otherwise scan for the first *balanced* ``{…}`` span and parse it (string-aware so braces
         inside string values don't throw off the balance) — surviving a prose preamble/epilogue and
         a stray trailing object. If the first balanced span fails to parse, try the next one.
    A reasoning model that emits "Here's the profile: {…}" or wraps the object in commentary therefore
    still yields the profile instead of nuking the whole houseguest to the seeded floor (#1044)."""
    if not text:
        return None
    fenced = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.S)
    if fenced:
        try:
            obj = json.loads(fenced.group(1))
            if isinstance(obj, dict):
                return obj
        except (ValueError, TypeError):
            pass  # fall through to the balanced-brace scan
    # Balanced-brace scan: tolerant of prose around the object and a stray trailing object/garbage
    # (the naive first-`{`/last-`}` slice would over-grab and fail to parse in both cases).
    for candidate in _balanced_json_objects(text):
        try:
            obj = json.loads(candidate)
        except (ValueError, TypeError):
            continue
        if isinstance(obj, dict):
            return obj
    return None


def parse_authored_profile(text: str, houseguest_id: str) -> Optional[dict]:
    """Parse the LLM's reply into a recordCastProfile request, keeping ONLY the schema keys and
    coercing types. Returns None when nothing usable was authored (the seeded floor then stays)."""
    obj = _extract_json(text)
    if obj is None:
        return None
    out: dict = {"houseguestId": houseguest_id}

    if isinstance(obj.get("name"), str) and obj["name"].strip():
        name = obj["name"].strip()
        # Guard (mirrors the engine): only forward a reasonable two-token human name. A gibberish/
        # fantasy/malformed name is DROPPED so the engine's seeded corpus name (the floor) stands.
        if _is_reasonable_name(name):
            out["name"] = name
        else:
            logger.warning(
                f"[cast-authoring] unreasonable name for {houseguest_id} ({name!r}) — "
                "dropping so the corpus name stands")

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
    # The PUBLIC occupation (#849) — forwarded so the engine keeps it in lockstep with the biography and
    # re-grounds the hidden stakes off the job the player will infer. A blank / runaway value is dropped
    # (the engine then leaves the seeded vocation — and its keyed stakes — untouched). Single line only.
    if isinstance(obj.get("vocation"), str) and obj["vocation"].strip():
        voc = " ".join(obj["vocation"].split())  # collapse whitespace/newlines to a clean noun phrase
        if len(voc) <= _VOCATION_MAX_CHARS:
            out["vocation"] = voc
        else:
            logger.warning(
                f"[cast-authoring] vocation too long for {houseguest_id} ({len(voc)} chars) — "
                "omitting so the seeded vocation stands")
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


def _no_json_in(text: str) -> bool:
    """#1002 observability: True iff the reply contained NO parseable JSON object at all (the strongest
    suspect — a reasoning model emitting prose/reasoning instead of a bare object). Distinct from "JSON
    parsed but every field landed below the quality floor"; the two no-op causes are logged separately so
    the silent fallback is diagnosable."""
    return _extract_json(text or "") is None


def _has_unbalanced_open_brace(text: str) -> bool:
    """True iff `text` contains an UNCLOSED top-level ``{`` — i.e. a JSON object the provider started
    streaming but never finished (the live truncation shape: the body opens the object, streams several
    fields, then the stream is cut by finish_reason "length" / a mid-stream provider error before the
    closing brace). String-aware so a brace inside a string literal is ignored. Distinct from "no JSON at
    all" (pure prose, no opening brace) — that is the #1002 case, not truncation."""
    depth = 0
    in_str = False
    esc = False
    saw_open = False
    for ch in text or "":
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == "{":
            depth += 1
            saw_open = True
        elif ch == "}":
            if depth > 0:
                depth -= 1
    return saw_open and depth > 0


def _classify_visible_body(text: str) -> str:
    """#1057: classify a model reply's VISIBLE body so the authoring loop can pick the right recovery.
    Returns one of:
      • "ok"        — a usable JSON object is present (parse it; no retry needed);
      • "empty"     — the visible body is empty/whitespace-only (the provider returned nothing — RETRY);
      • "truncated" — an UNCLOSED ``{`` (the object was clipped mid-stream by length/error — RETRY);
      • "no_json"   — a NON-empty, brace-balanced body with no parseable object (genuine prose — the
                      #1002 reparse case, a different retry).
    The two RETRY shapes (empty / truncated) are the live-verify's dominant failure (provider
    truncation under the concurrent burst); the existing #1002 reparse only covered "no_json"."""
    if _extract_json(text or "") is not None:
        return "ok"
    if not (text or "").strip():
        return "empty"
    if _has_unbalanced_open_brace(text or ""):
        return "truncated"
    return "no_json"


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

    #1057 — ROBUSTNESS to the live concurrent-burst failure (the live-verify authored only 3/15):
      • the LLM call retries on an EMPTY or TRUNCATED visible body (provider truncation under the burst),
        not just on the #1002 "full body, no JSON" prose case;
      • lower concurrency (2) eases the provider pressure that triggers the truncation;
      • the engine write-back is SERIALIZED through a single-flight lock and retried on a transient
        `degradation` / refused result, so concurrent `recordCastProfile` calls no longer collide on the
        orchestrator integrity checkpoint (the live-verify's 3 `degradation` refusals).
    All three stay fail-soft: after the bounded retries the call simply lands on the seeded floor.
    """
    sem = asyncio.Semaphore(max(1, int(concurrency)))
    # #1057: SERIALIZE the engine write-back. The per-NPC recordCastProfile write-backs collide on the
    # orchestrator integrity checkpoint when they run concurrently (the live-verify's 3 `degradation`
    # refusals dropped good profiles). A single-flight lock funnels every write-back through one at a time
    # — authoring still parallelizes the (slow) LLM calls, only the (fast) commit is serialized.
    write_lock = asyncio.Lock()
    # #1002 / #1057: per-season tallies for the end-of-run diagnostic counter — how many NPCs fell back to
    # the deterministic floor, and WHY. The breakdown distinguishes every no-op cause so a live-verify can
    # read exactly where the loss is (no-JSON prose vs. empty/truncated provider output vs. a write-back
    # degradation vs. JSON parsed but below the quality floor).
    floor_no_json = 0     # a reasoning model emitted prose, no parseable object (the #1002 case)
    floor_empty = 0       # #1057: the provider returned an EMPTY visible body (after retries)
    floor_truncated = 0   # #1057: the provider returned a CLIPPED/unbalanced object (after retries)
    floor_degradation = 0  # #1057: the write-back was refused as a transient degradation (after retries)
    floor_below = 0       # JSON parsed but nothing cleared the quality floor (seeded floor is richer)

    async def _call_with_retries(npc: dict, hid: str):
        """Issue the authoring call(s) for one NPC and return its parsed profile (or None).

        Layered, bounded, fail-soft recovery for the live failure modes:
          1. first call;
          2. #1057 — EMPTY or TRUNCATED visible body ⇒ re-issue (up to `_EMPTY_TRUNCATED_RETRIES`,
             small backoff) asking for the COMPLETE object (the dominant burst-truncation failure);
          3. #1002 — a NON-empty body with NO parseable JSON (genuine prose) ⇒ ONE strict-JSON reparse.
        Returns (profile_or_None, last_text) so the caller can classify the final no-op cause."""
        messages = build_authoring_messages(npc)
        try:
            text = await llm_fn(messages)
        except Exception as e:  # the model can fail for one houseguest; carry on
            logger.warning(f"[cast-authoring] llm failed for {hid}: {e}")
            return None, ""
        profile = parse_authored_profile(text or "", hid)
        # #1057: retry on EMPTY / TRUNCATED visible body — the provider returned nothing usable because the
        # body was empty or the object was clipped mid-stream (burst truncation), NOT because it emitted
        # prose instead of JSON. Re-issue asking for the complete object; reasoning is already OFF and the
        # roomy _AUTHOR_MIN_OUTPUT_TOKENS floor is applied in `_resolve_llm_fn`.
        attempt = 0
        while profile is None and _classify_visible_body(text or "") in ("empty", "truncated") \
                and attempt < _EMPTY_TRUNCATED_RETRIES:
            attempt += 1
            shape = _classify_visible_body(text or "")
            logger.info(
                f"[cast-authoring] {shape} visible body for {hid} (attempt {attempt}/"
                f"{_EMPTY_TRUNCATED_RETRIES}) — re-issuing for the complete object")
            if _RETRY_BACKOFF_SECONDS:
                await asyncio.sleep(_RETRY_BACKOFF_SECONDS)
            try:
                text = await llm_fn(messages + [{"role": "user", "content": _TRUNCATION_RETRY}])
            except Exception as e:
                logger.warning(f"[cast-authoring] llm empty/truncated retry failed for {hid}: {e}")
                break
            profile = parse_authored_profile(text or "", hid)
        # #1002: one-shot reparse retry — a NON-empty body with NO JSON object at all (genuine prose).
        # Distinct from the empty/truncated case above; only fires when there WAS a full body to reparse.
        if profile is None and _classify_visible_body(text or "") == "no_json":
            logger.info(
                f"[cast-authoring] no JSON in reply for {hid} — retrying once with a "
                "strict JSON-only instruction")
            try:
                text = await llm_fn(messages + [{"role": "user", "content": _STRICT_RETRY}])
            except Exception as e:
                logger.warning(f"[cast-authoring] llm retry failed for {hid}: {e}")
            else:
                profile = parse_authored_profile(text or "", hid)
        return profile, (text or "")

    async def _write_with_retries(profile: dict, hid: str):
        """#1057: commit one profile through the SERIALIZED single-flight write-back, retrying a transient
        `degradation` / refused result (a concurrency collision on the orchestrator integrity checkpoint,
        not a permanent reject). Returns the accepted result dict, or None on a terminal failure. The
        write-back is idempotent per houseguest, so a retry is safe."""
        last = None
        for attempt in range(1 + _EMPTY_TRUNCATED_RETRIES):
            if attempt and _RETRY_BACKOFF_SECONDS:
                await asyncio.sleep(_RETRY_BACKOFF_SECONDS)
            try:
                async with write_lock:  # serialize: never two recordCastProfile commits at once
                    res = await write_fn(profile)
            except Exception as e:
                logger.warning(f"[cast-authoring] write-back failed for {hid}: {e}")
                return None
            if isinstance(res, dict) and res.get("accepted"):
                return res
            last = res
            _reason = res.get("reason") if isinstance(res, dict) else f"non-dict result ({type(res).__name__})"
            # A transient degradation/refused commit is a concurrency collision — retry. Anything else is
            # a permanent reject (validation etc.) — don't hammer it; fall through to the floor.
            _rs = str(_reason or "").lower()
            if "degrad" in _rs or "integrity" in _rs or "checkpoint" in _rs:
                if attempt < _EMPTY_TRUNCATED_RETRIES:
                    logger.info(
                        f"[cast-authoring] write-back degradation for {hid} (attempt "
                        f"{attempt + 1}/{1 + _EMPTY_TRUNCATED_RETRIES}) — retrying serialized")
                    continue
                logger.warning(
                    f"[cast-authoring] write-back still degraded for {hid} after retries — "
                    "keeping the seeded floor")
                return "degradation"  # sentinel for the diagnostic tally
            # permanent / unexpected non-accept
            logger.warning(f"[cast-authoring] write-back not accepted for {hid}: {_reason or 'accepted=false'}")
            return None
        return last

    async def _author_one(npc: dict) -> int:
        nonlocal floor_no_json, floor_empty, floor_truncated, floor_degradation, floor_below
        hid = npc.get("id")
        if not hid or hid == "player":
            return 0
        async with sem:
            profile, text = await _call_with_retries(npc, hid)
            if not profile:
                # #1002 / #1057: close the silent-None gap — distinguish the no-op causes so a whole-cast
                # floor-fallback is diagnosable, not silent. Classify the FINAL reply body.
                shape = _classify_visible_body(text or "")
                if shape == "empty":
                    floor_empty += 1
                    logger.warning(
                        f"[cast-authoring] empty model reply for {hid} (after retries) — "
                        "keeping the seeded floor")
                elif shape == "truncated":
                    floor_truncated += 1
                    logger.warning(
                        f"[cast-authoring] truncated model reply for {hid} (after retries) — "
                        "keeping the seeded floor")
                elif shape == "no_json":
                    floor_no_json += 1
                    logger.warning(
                        f"[cast-authoring] no JSON found in model reply for {hid} (after retry) — "
                        "keeping the seeded floor")
                else:  # parsed JSON, but every field landed below the quality floor
                    floor_below += 1
                    logger.warning(
                        f"[cast-authoring] JSON parsed but all fields below the quality floor for {hid} "
                        "— keeping the seeded floor")
                return 0
            # #1057: the write-back is SERIALIZED + degradation-retried (it must not run concurrently
            # against the orchestrator integrity checkpoint).
            res = await _write_with_retries(profile, hid)
        if res == "degradation":
            floor_degradation += 1
            return 0
        if not (isinstance(res, dict) and res.get("accepted")):
            # FEPY-5 (#621): a rejected/odd write-back was silently dropped here — already logged inside
            # `_write_with_retries`; the seeded floor still stands (best-effort, never aborts).
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
    # #1002 / #1057: the per-season diagnostic counter — the headline "did the LLM actually enrich the
    # cast, or did it all fall back to the thin deterministic floor?" line. `total` counts the authorable
    # NPCs (the player is human-authored and skipped); the floor tallies break down EVERY no-op cause so a
    # mass fallback is immediately diagnosable in the logs — empty / truncated / degradation are each
    # visible now (the live-verify's dominant failures), beside the original no-JSON / below-floor.
    total = sum(1 for npc in (cast or []) if npc.get("id") and npc.get("id") != "player")
    floor = total - written
    logger.info(
        f"[cast-authoring] cast authoring: authored {written}/{total} houseguests "
        f"(floor fallback for {floor}: {floor_no_json} no-JSON, {floor_empty} empty, "
        f"{floor_truncated} truncated, {floor_degradation} degradation, {floor_below} below-floor)")
    return written


# ── the live wiring (best-effort, background; graceful no-op when no model) ────

async def _resolve_llm_fn(owner: Optional[str], *, prefix: str = "utility",
                          fallbacks_key: str = "utility") -> Optional[LlmFn]:
    """Build a one-shot completion fn over the user's UTILITY model (background-safe, like the email
    triage path). Returns None when no usable endpoint resolves — authoring then silently no-ops.

    Feature 0081: pass ``prefix='faithfulness', fallbacks_key='faithfulness'`` to resolve the DEDICATED
    faithfulness-judge model (settings ``faithfulness_*``) instead — ``resolve_endpoint`` itself chains
    faithfulness → utility → default. The default call ``_resolve_llm_fn(owner)`` is byte-identical to
    before (same utility resolution, same utility fallback chain, same image-filter + streaming tail)."""
    try:
        from src.endpoint_resolver import (resolve_endpoint, resolve_utility_fallback_candidates,
                                           _resolve_fallback_candidates)
        from src.llm_core import stream_llm_with_fallback
    except Exception:
        return None
    url, model, headers = resolve_endpoint(prefix, owner=owner)
    if not url or not model:
        url, model, headers = resolve_endpoint("default", owner=owner)
    if not url or not model:
        return None
    if fallbacks_key == "utility":
        _extra = resolve_utility_fallback_candidates(owner=owner) or []
    else:
        _extra = _resolve_fallback_candidates(f"{fallbacks_key}_model_fallbacks", owner=owner) or []
    candidates = [(url, model, headers)] + _extra

    # #546: an image-only model (dall-e / flux / gpt-image / …) resolves fine as an endpoint but can
    # NOT do JSON/chat authoring — POSTing prose messages to it degrades silently (empty/garbage text
    # ⇒ the parse fails and the write-back no-ops). Drop any image-only candidate so we only keep a
    # real text/chat model. Fail-soft: if that empties the list, return None and the engine's
    # deterministic floor simply stands (same as "no model configured").
    try:
        from src.orwell_portraits import _is_image_model
    except Exception:
        _is_image_model = None  # type: ignore
    if _is_image_model is not None:
        kept = [(u, m, h) for (u, m, h) in candidates if not _is_image_model(m)]
        if len(kept) != len(candidates):
            dropped = [m for (_u, m, _h) in candidates if _is_image_model(m)]
            logger.warning(
                "[utility-llm] skipping image-only model(s) %s for JSON authoring — "
                "they cannot do text/chat completion", dropped,
            )
        candidates = kept
        if not candidates:
            logger.warning(
                "[utility-llm] no text/chat utility model resolved (only image model(s)) — "
                "keeping the engine deterministic floor"
            )
            return None

    # ADR 0010: the background-authoring reasoning + output budget (admin-overridable). Fail-open.
    _policy = None
    _max_tokens = 0
    try:
        from src.token_policy import resolve_token_policy
        from src.settings import get_setting as _gs
        _policy = resolve_token_policy("background-authoring", {
            "reasoning_budget": _gs("reasoning_budget", {}),
            "max_tokens_budget": _gs("max_tokens_budget", {}),
        })
        # #1002: APPLY the per-class output cap (raised to a comfortable floor in token_policy) as the
        # call's max_tokens — a full authored JSON profile must fit even on a reasoning model that counts
        # reasoning+visible against the same budget. Without this the call ran with no positive cap.
        _mt = _policy.get("max_tokens") if isinstance(_policy, dict) else None
        if isinstance(_mt, int) and not isinstance(_mt, bool) and _mt > 0:
            _max_tokens = _mt
    except Exception:
        _policy = None
        _max_tokens = 0

    # #1044 — the SECOND root cause (the live 0/15 that survived the #1007 budget raise): the resolved
    # `background-authoring` policy turns reasoning ON (effort "low") on a reasoning model. On
    # deepseek-v4-pro the rich deep-profile prompt makes the model spend the ENTIRE output budget on
    # reasoning tokens (`thinking: true` deltas) and a mid-stream provider error / budget exhaustion
    # then lands BEFORE any visible JSON — so the body is empty/truncated prose and `_extract_json`
    # finds nothing. Authoring is pure STRUCTURED EXTRACTION (emit one JSON object) — reasoning adds no
    # value here, only burns the budget. Force reasoning OFF for the authoring call (independent of the
    # admin effort knob, which governs the player-facing narrator, not this background utility task):
    # `_apply_reasoning_budget` translates `reasoning=None` into an explicit `{"enabled": false}` on
    # OpenRouter, so visible JSON streams from the first token. Verified live: reasoning-off + a roomy
    # cap returns a clean, parseable object every call.
    if isinstance(_policy, dict):
        _policy = dict(_policy)
        _policy["reasoning"] = None  # explicit OFF (omit-vs-disable handled by _apply_reasoning_budget)
    # Guarantee a comfortable visible-output budget regardless of any admin `max_tokens_budget` override
    # that set the authoring cap too low (a full JSON profile is ~500-800 tokens; with reasoning OFF the
    # whole cap is the answer, but keep generous headroom so a verbose biography never truncates).
    if _max_tokens < _AUTHOR_MIN_OUTPUT_TOKENS:
        _max_tokens = _AUTHOR_MIN_OUTPUT_TOKENS

    async def _fn(messages: list[dict]) -> str:
        parts: list[str] = []
        _usage: dict = {}
        # #1002: request strict JSON (response_format) so a model that honours it can't leak prose/
        # reasoning into the body. Threads through stream_llm_with_fallback → stream_llm onto the
        # OpenAI-style payload; a provider that ignores it is harmless (the strict prompt + the one-shot
        # retry in author_cast still apply). The policy already supplies the (raised, #1002) token budget.
        async for chunk in stream_llm_with_fallback(
            candidates, messages, temperature=_AUTHOR_TEMPERATURE, policy=_policy,
            max_tokens=_max_tokens, response_format=_RESPONSE_FORMAT):
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
                    # DB3 (#1026): the cap WAS applied on the wire (max_tokens=_max_tokens above); log it so
                    # the ledger shows appliedMaxTokens=_max_tokens, not cap=0. Omitting it mis-logged cap=0.
                    applied_max_tokens=_max_tokens,
                    cost=float(_usage.get("cost") or 0), provider=_usage.get("provider"),
                )
            except Exception:
                pass
        return "".join(parts)

    return _fn


def _delta_text(chunk) -> str:
    """Extract the assistant's VISIBLE-content text from one `stream_llm` SSE chunk.

    #1044 — the real, load-bearing shape: `stream_llm` emits visible content as
    ``data: {"delta": "<text>"}`` and reasoning/thinking as ``data: {"delta": "<text>", "thinking": true}``
    (see `_stream_delta_event` in `llm_core`). The old reader only looked at ``content``/``text`` keys, so
    it dropped EVERY content chunk — the authoring `_fn` returned an empty string, `_extract_json` found
    nothing, and the whole cast fell back to the seeded floor (`authored 0/15`) even when the model
    streamed perfect JSON.

    We now:
      • read the `delta` key (the real streaming key) first, then fall back to `content`/`text` for any
        dict-shaped chunk (back-compat);
      • SKIP thinking/reasoning deltas (``thinking: true``) — reasoning must never pollute the JSON body;
      • SKIP non-text event chunks (``type`` set: usage / finish / tool_calls / model_actual / …).
    """
    if isinstance(chunk, dict):
        if chunk.get("thinking") or chunk.get("type"):
            return ""
        return str(chunk.get("delta") or chunk.get("content") or chunk.get("text") or "")
    s = str(chunk or "")
    if s.startswith("data:"):
        body = s[5:].strip()
        if body and body != "[DONE]":
            try:
                d = json.loads(body)
            except (ValueError, TypeError):
                return ""
            if isinstance(d, dict):
                # Drop reasoning deltas and typed meta events (usage/finish/tool_calls/model_actual);
                # keep ONLY the visible-content `delta` (then content/text for any older shape).
                if d.get("thinking") or d.get("type"):
                    return ""
                return str(d.get("delta") or d.get("content") or d.get("text") or "")
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

    # Only the DEFAULT sink mutates the LIVE cast; a `write` override targets the next-season
    # holding store (which deliberately does not touch the live board), so don't push for it.
    is_live_write = write is None
    written = await author_cast(cast, llm_fn, write or _write, on_authored)
    # #617: enrichment landed on the live game — push a server-side "game-updated" so open pages
    # reconcile now instead of waiting for the next poll. Best-effort/fail-soft.
    if written and is_live_write:
        try:
            from src import orwell_game_session
            orwell_game_session.publish_game_updated(owner)
        except Exception:
            pass
    return written


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
