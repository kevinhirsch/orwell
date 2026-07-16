"""Feature 0116 (phase 2 of the casting upgrade) — the FE model-authoring DRIVER for model-authored
cast GENESIS. Phase 1 (orwell_cast_authoring) re-routes the DEPTH to the model; this drives the
SKELETON itself: the producer-LLM proposes the ENTIRE 15-NPC cast — names, freeform identities,
personas, hidden elements, banded stats, and the pre-show tie graph — and the ENGINE validates,
clamps, repairs, and commits it inside an envelope it owns (``recordCastGenesis`` →
``src/engine/castGenesis.ts``, already shipped). Mirrors the sibling write-back drivers:

    engine pre-seeds the player-INDEPENDENT deterministic FLOOR cast (preSeedCast) + returns the
      Vault-free roster ids
      → THIS module: the producer-LLM proposes the WHOLE skeleton, steered ONLY by a seeded
        season brief (player-BLIND), as strict JSON
      → recordCastGenesis writes it back; the ENGINE validates the proposal against its envelope
        (banded stat clamp — no model number escapes; the cast-wide variance floor; name validators;
        the closed hidden-element kinds + C9 gates; tie-graph sanity; hidden-game-weight stripping),
        folds the committed skeleton onto the byte-stable warmed cast, and seals the hidden half
      → structured, Vault-free violations come back; a bounded re-roll (≤GENESIS_MAX_REROLLS) echoes
        the re-roll violations to the model and re-proposes.
      → only THEN do the 0063 identity seed + the phase-1 deep authoring run (pipeline order:
        SKELETON → identity → author → shoot), each reading the genesis-committed ground truth.

THE HARD BOUNDARY (mandate #3 anti-sycophancy + mandate #2 Vault Wall):
  * genesis is PLAYER-BLIND by construction — NOTHING about the player crosses into the sketch prompt
    (a structural gate over the assembled prompt, §8), so the cast cannot be bent toward a player it
    never saw; the engine's post-hoc near-duplicate nudge catches an accidental collision;
  * the model proposes ONLY descriptive identity + BANDED stats — NEVER a hidden game weight (influence,
    trigger arming/volatility, the Day-1 read of the player, soul baselines, showmance seeds, every
    magnitude stay engine-seeded off the committed cast). No model number escapes the engine's clamp;
  * the model NEVER seals anything — the engine owns the wall + the guarantee. This module only
    proposes + forwards; the private orientation is re-sealed engine-side.

Deterministic FLOOR is byte-neutral: no model / a failed call / garbage output ⇒ no proposal ⇒ the
engine's deterministic factory simply stands (the fail-soft write-back contract that keeps the stubbed
lanes + the golden replay byte-identical, §7). Under the DEFAULT ``strict`` enrichment policy a failure
is LOUD (an ERROR + an admin-visible ledger entry + the strict-failed latch the loud pre-finalize gate
reads, §4 / #1313 precedent); under ``soft`` it is the legacy silent no-op.

Design: the orchestrator (``seed_cast_genesis``) takes INJECTED ``llm_fn`` + ``write_fn``, so the whole
pipeline is unit-testable without a live model or engine. ``run_genesis`` wires the real deps and is
awaited inside the pre-warm author lane (``orwell_prewarm.prewarm_cast``) BEFORE identity + authoring —
genesis is a PRE-GAME operation (``recordCastGenesis`` is refused once the season runs), so it rides the
pre-warm that overlaps the casting interview and is done by finalize; game start never blocks on it.
"""
from __future__ import annotations

import asyncio
import json
from typing import Awaitable, Callable, Optional

try:  # the structured logger if present; a no-op stand-in keeps this importable in isolation
    from loguru import logger
except Exception:  # pragma: no cover
    class _L:  # minimal fallback
        def info(self, *a, **k): pass
        def warning(self, *a, **k): pass
        def error(self, *a, **k): pass
        def debug(self, *a, **k): pass
    logger = _L()


# ── the seeded SEASON BRIEF — a faithful Python port of src/engine/castGenesis.generateSeasonBrief ──────
#
# The engine derives the brief from a DEDICATED side-stream (`${seed}:genesis:brief`) so same seed ⇒ same
# brief (replayable) and the brief is player-INDEPENDENT (derived only from the seed). It STEERS the
# model's open-ended generation and NEVER binds a validator (only the engine's caps/floors/bands bind).
# The engine records ITS OWN brief off the same seed as the world-gen artifact; this faithful port makes
# the FE steer with the SAME brief the engine will record. The pools mirror src/engine/genesisConstants.ts
# (BRIEF_*), and the RNG mirrors SeededRandom (mulberry32) + hashSeed (FNV-1a 32-bit) exactly.

_U32 = 0xFFFFFFFF


def _hash_seed(s: str) -> int:
    """FNV-1a 32-bit, byte-identical to src/engine/characterFactory.hashSeed (Math.imul → mask u32)."""
    h = 0x811c9dc5
    for ch in s:
        h = ((h ^ ord(ch)) * 0x01000193) & _U32
    return h


class _Mulberry32:
    """A faithful port of src/adapters/random/SeededRandom (mulberry32). Unsigned-32-bit throughout —
    every JS `>>> 0` / `Math.imul` / bitwise op is emulated by masking to u32, so the stream is
    byte-identical to the engine's for a given seed. Pure: same seed → same stream."""

    def __init__(self, seed: int) -> None:
        self.state = (seed ^ 0x9e3779b9) & _U32

    def next(self) -> float:
        self.state = (self.state + 0x6d2b79f5) & _U32
        t = self.state
        t = ((t ^ (t >> 15)) * (t | 1)) & _U32
        t ^= (t + (((t ^ (t >> 7)) * (t | 61)) & _U32)) & _U32
        t &= _U32
        return ((t ^ (t >> 14)) & _U32) / 4294967296.0

    def int(self, max_exclusive: int) -> int:
        if max_exclusive <= 0:
            return 0
        return int(self.next() * max_exclusive)

    def pick(self, items):
        return items[self.int(len(items))]


# Mirror of src/engine/genesisConstants.ts (BRIEF_*). Keep in lockstep with the engine pools so the FE
# steers with the same brief the engine records; a drift is only a cosmetic steering mismatch (the brief
# never binds), but the parity test pins a few known seeds so a silent drift is caught.
BRIEF_DEMOGRAPHIC_SKEWS = (
    "skew younger — a twenties-heavy house with something to prove",
    "skew older — a cast of established adults with real lives on pause",
    "a wide age range, early-twenties up through the fifties",
    "a mostly-thirties professional class at a crossroads",
    "a youth-forward house with a couple of seasoned outliers",
    "an evenly-mixed generational spread, no dominant cohort",
)
BRIEF_REGIONAL_FLAVORS = (
    "a heavy Gulf-coast contingent",
    "a Pacific-Northwest-leaning cast",
    "a Northeast-urban skew",
    "a Midwest-heartland core",
    "a Southern-heavy house",
    "a coast-to-coast spread with no regional center",
    "a Mountain-West and desert-Southwest lean",
    "a mix of small-town roots and big-city transplants",
)
BRIEF_ENSEMBLE_VIBES = (
    "a house built for slow-burn grudges",
    "a loud, clash-forward ensemble that never lets a fight rest",
    "a warm, alliance-heavy crew that bonds fast and hard",
    "a cerebral, strategy-first cast that plays quiet",
    "a chaotic, unpredictable mix where nothing holds",
    "a status-hungry room full of people used to being the main character",
    "an underdog-heavy house of people written off before",
    "a showmance-prone cast with romance in the air",
)


def generate_season_brief(seed: int) -> dict:
    """Derive the seeded season brief — byte-identical to src/engine/castGenesis.generateSeasonBrief.
    Same seed ⇒ same brief; player-INDEPENDENT (seed-only). Returns
    ``{demographicSkew, regionalFlavor, ensembleVibe}``."""
    rng = _Mulberry32(_hash_seed(f"{seed}:genesis:brief"))
    return {
        "demographicSkew": rng.pick(BRIEF_DEMOGRAPHIC_SKEWS),
        "regionalFlavor": rng.pick(BRIEF_REGIONAL_FLAVORS),
        "ensembleVibe": rng.pick(BRIEF_ENSEMBLE_VIBES),
    }


def render_season_brief(b: dict) -> str:
    """One short casting-direction line for the sketch prompt (mirrors engine renderSeasonBrief)."""
    if not isinstance(b, dict):
        return ""
    return (f"This season: {b.get('demographicSkew', '')}; {b.get('regionalFlavor', '')}; "
            f"{b.get('ensembleVibe', '')}.")


# ── the envelope vocabulary (mirrors src/engine/castGenesis.ts + genesisConstants.ts) ───────────────────
# The ENGINE is the authority — it clamps stats into its band, validates names, closes the hidden-element
# kinds, C9-gates them, checks tie-graph sanity, and strips hidden weights — so this vocabulary only shapes
# the PROMPT + a light FE pre-filter. Keep it in sync with the engine so the model proposes valid shapes.
_ARCHETYPES = (
    "comp-beast", "mastermind", "social-butterfly", "floater", "villain", "underdog",
    "flirt", "loyalist", "wildcard", "analyst", "hothead", "peacemaker",
)
_TIE_NATURES = ("casting-callback", "mutual-friend", "shared-hometown", "old-acquaintance")
# The freely-authorable hidden-element kinds. `concealed-aptitude` is engine-stat-gated (a free-text one
# is stripped) and `trigger` is engine-armed (never proposable), so we steer the model AWAY from both —
# the engine strips them regardless; omitting them keeps the per-NPC count above the 3-min floor.
_HIDDEN_KINDS = ("secret-motive", "pre-game-tie", "divergent-persona")

# Mirror of GENESIS_HIDDEN_ELEMENT_RANGE / GENESIS_TIE_BUDGET / GENESIS_MAX_REROLLS / the stat band.
GENESIS_HIDDEN_MIN = 3
GENESIS_HIDDEN_MAX = 6
GENESIS_TIE_BUDGET = 2
#: The bounded re-roll budget N (§4) — mirrors GENESIS_MAX_REROLLS in src/engine/genesisConstants.ts.
GENESIS_MAX_REROLLS = 3
# The stat band the ENGINE owns (src/engine/genesisConstants.ts) — echoed in the prompt as guidance so the
# model proposes in-range; the engine clamps regardless (no model number escapes).
_STAT_MIN, _STAT_MAX = 0.2, 0.9
_TOTAL_LO, _TOTAL_HI = 1.47, 2.1


# ── the producer-framed genesis sketch prompt (player-BLIND — a structural gate) ────────────────────────
#
# ANTI-SYCOPHANCY (mandate #3): the WHOLE cast is designed as if the player does not exist. The prompt
# carries NO player identity at all — no name, no casting answer, no profile field. The cast is steered
# ONLY by the seeded season brief (player-independent) so it cannot tilt toward (or against) the player,
# and the calibration balance (juryReach) is preserved: the model authors WHO people are; the engine keeps
# HOW MUCH anything weighs (every hidden game weight stays engine-seeded).
_SYSTEM = (
    "You are the CASTING DIRECTOR for a Big Brother season, designing the ENTIRE cast of houseguests "
    "from scratch. Invent a vivid, believable, reality-TV-plausible ENSEMBLE of distinct people — no two "
    "alike, each with their own life, look, voice, and secret game. Output STRICT JSON only (no prose "
    "around it): an object with two keys, \"npcs\" and \"ties\".\n"
    "\"npcs\": an array, ONE object PER houseguest id given below (keep the SAME ids, same order), each with:\n"
    '  "id": the exact houseguest id from the roster below (echo it verbatim).\n'
    '  "name": an ordinary, everyday, pronounceable FIRST and LAST name (EXACTLY two words) for a real '
    "modern American reality-TV contestant — the kind of unremarkable name you meet daily. HARD NAME "
    "RULES (a name that breaks ANY of these is REJECTED and forces the whole cast to be redrawn — get "
    "them right the FIRST time): (1) EXACTLY two plain words, a given name then a surname — NEVER a "
    "single word, NEVER three-plus words, NEVER a lone name. (2) NO titles, honorifics, initials, "
    "middle names, nicknames-in-quotes, hyphenated compounds, numerals, punctuation, emoji, or ANY "
    "markup — letters only, plausible everyday human length (roughly 3-12 letters per word). "
    "(3) NEVER invented, fantasy, gibberish, or stage-name shaped. (4) UNIQUE across the ENTIRE cast — "
    "no two houseguests may share a first name OR a surname; scan the names you have already written "
    "before adding each new one. (5) Prefer common CONTEMPORARY American given names and AVOID overtly "
    "Biblical / scriptural given names (e.g. do NOT use Ryne, Marcus, or Felix, and steer clear of the "
    "old-testament / gospel name set generally).\n"
    '  "identity": ONE vivid sentence capturing who this person IS — their concept in your own words '
    "(this is what the show voices; make each unmistakably distinct).\n"
    f'  "archetype": the single nearest fit from EXACTLY this list: {", ".join(_ARCHETYPES)}.\n'
    '  "vocation": a SHORT occupation noun phrase (e.g. "court reporter").\n'
    '  "hometown": a US hometown (city, state) that fits the season\'s regional flavor.\n'
    '  "demeanor": a short phrase for how they carry themselves (e.g. "warm but guarded").\n'
    '  "background": a short phrase of life context.\n'
    '  "biography": a 2-3 sentence presentable backstory (their life outside the house).\n'
    '  "appearance": a short concrete phrase describing their look.\n'
    '  "age": an integer age, 21-60, fitting the season\'s demographic skew.\n'
    '  "stats": { "physical", "mental", "social" } — three numbers, EACH between '
    f"{_STAT_MIN} and {_STAT_MAX}, whose TOTAL lands roughly between {_TOTAL_LO} and {_TOTAL_HI}. "
    "VARY the totals WIDELY across the cast — real competition beasts (high totals) AND real floaters "
    "(low totals), never fifteen identical mid-liners. These describe raw aptitude, not who wins.\n"
    f'  "hiddenElements": an array of {GENESIS_HIDDEN_MIN} to {GENESIS_HIDDEN_MAX} SECRETS, each '
    '{ "kind", "detail" } where kind is one of "secret-motive" (AT MOST ONE per houseguest), '
    '"pre-game-tie", or "divergent-persona", and detail is one vivid sentence in your own words. '
    "Ground each secret in THIS person's specific life. "
    f"HARD REQUIREMENT: EVERY houseguest MUST have AT LEAST {GENESIS_HIDDEN_MIN} hidden elements "
    f"(aim for {GENESIS_HIDDEN_MIN}-{GENESIS_HIDDEN_MAX}). A houseguest with fewer than "
    f"{GENESIS_HIDDEN_MIN} is INVALID and forces the ENTIRE cast to be re-rolled — count the array "
    "for each houseguest before moving to the next.\n"
    '"ties": an array of 0 to ' + str(GENESIS_TIE_BUDGET) + " pre-show connections between houseguests "
    '(sparse by design — often just one, sometimes none), each { "a", "b", "nature", "backstory" } '
    "where a and b are two DIFFERENT houseguest ids from the roster, nature is one of "
    f"{', '.join(_TIE_NATURES)}, and backstory is one sentence. No houseguest may appear in more than "
    "one tie.\n"
    "COHERE every houseguest's name, look, hometown, vocation, and age with each other and with the "
    "season brief. Make the cast reflect a real, diverse American crew. Assign EVERY id in the roster.\n"
    "IDENTITY COHERENCE (HARD — a contradiction is REJECTED): pin each houseguest's gender presentation "
    "FIRST, then keep EVERY self-reference consistent with it. Within a SINGLE houseguest, NEVER mix "
    "masculine and feminine pronouns for that same person across their identity, biography, appearance, "
    "and secrets (no 'her shyness' beside 'his forearm'). Keep their age consistent with their life story "
    "(do not write 'spent thirty years' or 'grandmother' for someone in their twenties), and keep their "
    "stated occupation the same throughout (the biography and secrets must not name a different job than "
    "the vocation).\n"
    "OUTPUT CONTRACT (HARD): reply with a SINGLE raw JSON object and NOTHING else — no prose, no "
    "markdown, no ```json fences, no preamble. The first character MUST be '{' and the last MUST be '}'."
)

_STRICT_RETRY = (
    "Your previous reply did not contain a parseable JSON object. Reply now with ONLY the JSON object — "
    "start with '{', end with '}', no prose, no markdown, no fences."
)


def build_genesis_messages(roster: list, brief: dict,
                           violation_feedback: Optional[str] = None) -> list[dict]:
    """The producer prompt for the WHOLE cast. Seeds the model with the season BRIEF (player-independent
    steering) and the roster IDS ONLY — never the floor identities (so the model designs fresh, not
    anchored to the pool it is replacing) and NEVER any player field (player-blind, a structural gate).
    ``violation_feedback`` — on a bounded re-roll — quotes back the engine's structured violations so the
    model fixes exactly what failed. Returns chat messages for the utility/narration model."""
    ids = [str(n.get("id")) for n in (roster or []) if isinstance(n, dict) and n.get("id")]
    lines = [
        f"Design the full cast — {len(ids)} houseguests. {render_season_brief(brief)}",
        "Roster ids (author ONE houseguest object per id, echoing the id verbatim, same order):",
        json.dumps(ids, ensure_ascii=False),
    ]
    if violation_feedback:
        lines.append(
            "Your previous proposal had these problems (fix EXACTLY these, keep everything else): "
            + violation_feedback)
    lines.append("Return the cast-genesis JSON now (npcs + ties). JSON only.")
    return [{"role": "system", "content": _SYSTEM}, {"role": "user", "content": "\n".join(lines)}]


def _extract_json(text: str) -> Optional[dict]:
    """Pull the first usable JSON OBJECT out of the model's reply — robust to prose-wrapped output.
    Reuses the sibling cast-authoring extractor (balanced-brace, string-aware) when importable; falls
    back to a first-``{``/last-``}`` slice otherwise. Genesis returns a single ``{npcs, ties}`` object."""
    if not text:
        return None
    try:
        from src.orwell_cast_authoring import _extract_json as _shared
        return _shared(text)
    except Exception:
        pass
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        return None
    try:
        obj = json.loads(text[start:end + 1])
        return obj if isinstance(obj, dict) else None
    except (ValueError, TypeError):
        return None


def _salvage_truncated_npcs(text: str) -> Optional[dict]:
    """2026-07-13 salvage guard: recover the COMPLETE leading npc entries from a TRUNCATED sketch
    reply (a ``finish_reason=length`` completion chops the JSON mid-array, so ``_extract_json``
    finds nothing). Scans the ``"npcs": [...`` array with a string-aware balanced-brace walk and
    ``json.loads``-es each complete ``{...}`` element until the text runs out or breaks.

    A partial-but-valid leading set IS committable by design: the engine envelope natively supports
    a partial proposal (positional binding + the deterministic floor for every unproposed slot —
    ``parse_genesis_proposal`` already forwards subsets), so half a model-authored cast beats a
    whole deterministic floor. Returns ``{"npcs": [...]}`` (raw dicts — the caller's normal
    per-entry filtering still applies) or ``None`` when nothing complete could be recovered. Ties
    are deliberately NOT salvaged (they trail the npcs array, so truncation already ate them; the
    engine treats absent ties as an empty graph)."""
    if not isinstance(text, str) or not text:
        return None
    m = text.find('"npcs"')
    if m == -1:
        return None
    start = text.find("[", m)
    if start == -1:
        return None
    entries: list = []
    i = start + 1
    n = len(text)
    while i < n:
        ch = text[i]
        if ch in " \t\r\n,":
            i += 1
            continue
        if ch == "]":
            break  # the array closed cleanly (truncation hit later — e.g. inside ties)
        if ch != "{":
            break  # unexpected shape — keep only what parsed so far
        depth = 0
        in_str = False
        esc = False
        j = i
        end = -1
        while j < n:
            c = text[j]
            if in_str:
                if esc:
                    esc = False
                elif c == "\\":
                    esc = True
                elif c == '"':
                    in_str = False
            else:
                if c == '"':
                    in_str = True
                elif c == "{":
                    depth += 1
                elif c == "}":
                    depth -= 1
                    if depth == 0:
                        end = j
                        break
            j += 1
        if end == -1:
            break  # this element was cut off mid-object — stop; keep the complete ones before it
        try:
            one = json.loads(text[i:end + 1])
        except (ValueError, TypeError):
            break
        if isinstance(one, dict):
            entries.append(one)
        i = end + 1
    if not entries:
        return None
    return {"npcs": entries}


def recover_reasoning_channel_json(reasoning: str) -> Optional[str]:
    """S3b (RC4): recover a genesis/authoring JSON payload the model MISROUTED into the reasoning
    channel. glm-4.7 (and other reasoners) sometimes emit the whole answer as ``reasoning``/``thinking``
    deltas and leave the visible body EMPTY — even with ``reasoning:{enabled:false}`` sent (verified in
    the live bundle: 6 NPCs fell to the floor because the parser read ``''`` while the JSON sat in the
    reasoning channel). Rather than discard paid-for content, we strict-scan the reasoning text for a
    parseable JSON object (the balanced-brace extractor, then the truncation salvage) and return the
    recovered JSON STRING so the normal parser can consume it. Returns ``None`` when the reasoning holds
    no usable JSON object (then the caller keeps the empty visible body ⇒ the deterministic floor stands).

    The RED-eligible ``reasoning-channel-misroute`` health event is recorded by the CALLER (which holds
    the owner + call-class context); this helper is a pure detector."""
    if not isinstance(reasoning, str) or not reasoning.strip():
        return None
    obj = _extract_json(reasoning)
    if obj is None:
        obj = _salvage_truncated_npcs(reasoning)
    if obj is None:
        return None
    try:
        return json.dumps(obj, ensure_ascii=False)
    except (ValueError, TypeError):
        return None


def _clean_str(v, max_len: int = 500) -> Optional[str]:
    """A light FE pre-filter: a non-empty string, whitespace-collapsed + length-capped. The ENGINE
    re-neutralizes + caps everything again (C8), so this only keeps the payload tidy."""
    if not isinstance(v, str):
        return None
    s = " ".join(v.split())
    if not s:
        return None
    return s[:max_len]


def parse_genesis_proposal(text: str, valid_ids: set) -> dict:
    """Parse the model reply into a ``recordCastGenesis`` request ``{npcs: [...], ties: [...]}``, keeping
    ONLY recognized shapes for KNOWN houseguest ids. A light FE pre-filter mirroring the engine's
    validation (the engine clamps/validates/repairs regardless, so this is best-effort): a non-dict entry,
    an unknown id, a garbage stat, or an out-of-set tie nature is dropped. Returns ``{}`` when nothing
    usable was proposed (the deterministic floor then stands). PLAYER-BLIND — no player field is read or
    written; the engine seals the hidden half."""
    obj = _extract_json(text)
    if obj is None:
        # 2026-07-13 salvage guard: a cap-truncated reply (finish_reason=length survived even the
        # doubled-cap retry) still carries complete leading npc objects — commit those (the engine
        # positionally binds + floors the rest) instead of discarding the whole proposal.
        obj = _salvage_truncated_npcs(text)
        if obj is not None:
            _n = len(obj.get("npcs") or [])
            logger.warning(
                f"[cast-genesis] reply was truncated mid-JSON — salvaged {_n} complete leading "
                f"houseguest entr{'y' if _n == 1 else 'ies'} (the engine floors the rest)")
    if obj is None:
        return {}
    npcs_out: list = []
    raw_npcs = obj.get("npcs")
    if isinstance(raw_npcs, list):
        for raw in raw_npcs:
            if not isinstance(raw, dict):
                continue
            hid = raw.get("id")
            hid = str(hid) if hid is not None else None
            # Keep an entry with a KNOWN id (explicit binding) or NO id (engine positional binding).
            # Drop an entry whose id is present-but-unknown (a stale/hallucinated slot).
            if hid is not None and hid not in valid_ids:
                continue
            one: dict = {}
            if hid is not None:
                one["id"] = hid
            for k, cap in (("name", 60), ("identity", 300), ("vocation", 60), ("hometown", 60),
                           ("demeanor", 120), ("background", 200), ("biography", 500),
                           ("presentation", 200), ("appearance", 300)):
                cleaned = _clean_str(raw.get(k), cap)
                if cleaned:
                    one[k] = cleaned
            arche = raw.get("archetype")
            if isinstance(arche, str) and arche.strip() in _ARCHETYPES:
                one["archetype"] = arche.strip()
            age = raw.get("age")
            if isinstance(age, (int, float)) and not isinstance(age, bool):
                one["age"] = int(age)
            stats = raw.get("stats")
            if isinstance(stats, dict):
                st = {}
                for sk in ("physical", "mental", "social"):
                    sv = stats.get(sk)
                    if isinstance(sv, (int, float)) and not isinstance(sv, bool):
                        st[sk] = float(sv)
                if st:
                    one["stats"] = st
            hidden = raw.get("hiddenElements")
            if isinstance(hidden, list):
                els = []
                for el in hidden:
                    if not isinstance(el, dict):
                        continue
                    kind = el.get("kind")
                    detail = _clean_str(el.get("detail"), 300)
                    if isinstance(kind, str) and kind.strip() and detail:
                        els.append({"kind": kind.strip(), "detail": detail})
                if els:
                    one["hiddenElements"] = els[:GENESIS_HIDDEN_MAX]
            # Keep the slot even if only an id survived — the engine positionally binds + floors the rest.
            if one:
                npcs_out.append(one)
    ties_out: list = []
    raw_ties = obj.get("ties")
    if isinstance(raw_ties, list):
        for raw in raw_ties:
            if not isinstance(raw, dict):
                continue
            a = raw.get("a")
            b = raw.get("b")
            a = str(a) if a is not None else None
            b = str(b) if b is not None else None
            if not a or not b or a == b or a not in valid_ids or b not in valid_ids:
                continue
            tie = {"a": a, "b": b}
            nature = raw.get("nature")
            if isinstance(nature, str) and nature.strip() in _TIE_NATURES:
                tie["nature"] = nature.strip()
            backstory = _clean_str(raw.get("backstory"), 300)
            if backstory:
                tie["backstory"] = backstory
            ties_out.append(tie)
    if not npcs_out:
        return {}
    out: dict = {"npcs": npcs_out}
    if ties_out:
        out["ties"] = ties_out
    return out


def _reroll_feedback(violations: list) -> Optional[str]:
    """Quote back ONLY the ``re-roll`` violations (the ones the model must fix) as a short, Vault-free
    feedback string for the next attempt. Clamped/stripped/ignored/dropped actions are engine-handled and
    need no model fix. Returns None when nothing needs a re-roll."""
    if not isinstance(violations, list):
        return None
    items = []
    for v in violations:
        if not isinstance(v, dict) or v.get("action") != "re-roll":
            continue
        scope = v.get("scope")
        field = v.get("rule") or v.get("field") or "a field"
        if scope == "npc" and v.get("npcId"):
            items.append(f"houseguest {v.get('npcId')}: {field}")
        else:
            items.append(f"cast-wide: {field}")
        if len(items) >= 12:
            break
    return "; ".join(items) if items else None


# ── the orchestrator (injectable — fully unit-testable) ────────────────────────

LlmFn = Callable[[list[dict]], Awaitable[str]]
WriteFn = Callable[[dict], Awaitable[dict]]

#: S3c (RC3): the roster chunk size for the production genesis path. Splitting the 15-NPC sketch into
#: smaller per-chunk completions (3×5) makes any ONE call far less likely to end finish_reason=length
#: (each chunk is ~5× smaller than the whole skeleton), and a failing chunk is retried ALONE instead of
#: re-grinding the whole cast. The per-chunk proposals are combined into ONE atomic write-back so the
#: engine still validates the whole cast at once (its cross-cast name dedupe + tie sanity stay
#: authoritative). ``seed_cast_genesis`` defaults to NO chunking (one whole-cast call) so direct-call
#: unit tests stay byte-identical; the live ``_run_genesis_once`` opts in.
GENESIS_CHUNK_SIZE = 5


async def _gather_chunked_proposal(roster: list, brief: dict, llm_fn: LlmFn, valid_ids: set,
                                   feedback: Optional[str], chunk_size: int) -> dict:
    """S3c: gather a whole-cast proposal by sketching the roster in CHUNKS (default 5 NPCs each), then
    COMBINE the per-chunk proposals into one ``{npcs, ties}`` for a single atomic write-back. Each chunk
    is proposed with ONLY its own ids valid (so a chunk can't hallucinate a sibling slot), a FAILED chunk
    is retried ONCE alone (strict-JSON), and names are de-duped across chunks (a colliding name field is
    dropped so the engine floors that slot — its authoritative dedupe still runs). A chunk that fails both
    tries is skipped (the engine floors its slots). Ties are combined, kept sparse (≤ budget), and no NPC
    is allowed into two ties. Returns the combined proposal, or ``{}`` when EVERY chunk failed."""
    ids = [str(n.get("id")) for n in (roster or []) if isinstance(n, dict) and n.get("id")]
    chunks = [roster[i:i + chunk_size] for i in range(0, len(roster), chunk_size)] if roster else []
    combined_npcs: list = []
    combined_ties: list = []
    used_given: set = set()
    used_surname: set = set()
    used_full: set = set()
    tied: set = set()
    any_ok = False
    for ci, chunk in enumerate(chunks):
        chunk_ids = {str(n.get("id")) for n in chunk if isinstance(n, dict) and n.get("id")}
        if not chunk_ids:
            continue
        messages = build_genesis_messages(chunk, brief, feedback)
        try:
            text = await llm_fn(messages)
        except Exception as e:
            logger.warning(f"[cast-genesis] chunk {ci} llm failed: {e}")
            text = ""
        prop = parse_genesis_proposal(text or "", chunk_ids)
        if not prop:
            # Retry ONLY this failed chunk once (strict-JSON) — never re-grind the whole cast.
            try:
                text = await llm_fn(messages + [{"role": "user", "content": _STRICT_RETRY}])
            except Exception as e:
                logger.warning(f"[cast-genesis] chunk {ci} strict retry failed: {e}")
                text = ""
            prop = parse_genesis_proposal(text or "", chunk_ids)
        if not prop:
            logger.info(f"[cast-genesis] chunk {ci} produced nothing usable — the engine floors its slots")
            continue
        any_ok = True
        for npc in prop.get("npcs") or []:
            name = npc.get("name")
            if isinstance(name, str) and name.strip():
                toks = name.strip().lower().split()
                given = toks[0] if toks else ""
                surname = toks[-1] if toks else ""
                full = name.strip().lower()
                if full in used_full or (given and given in used_given) or (surname and surname in used_surname):
                    npc.pop("name", None)  # cross-chunk collision — drop the name; the engine floors it
                else:
                    used_full.add(full)
                    if given:
                        used_given.add(given)
                    if surname:
                        used_surname.add(surname)
            combined_npcs.append(npc)
        for tie in prop.get("ties") or []:
            if len(combined_ties) >= GENESIS_TIE_BUDGET:
                break
            a = tie.get("a")
            b = tie.get("b")
            if not a or not b or a == b or a in tied or b in tied:
                continue  # no NPC in two ties (sparse-by-design)
            combined_ties.append(tie)
            tied.add(a)
            tied.add(b)
    if not any_ok or not combined_npcs:
        return {}
    out: dict = {"npcs": combined_npcs}
    if combined_ties:
        out["ties"] = combined_ties[:GENESIS_TIE_BUDGET]
    logger.info(f"[cast-genesis] chunked gather combined {len(combined_npcs)} of {len(ids)} "
                f"houseguest proposal(s) across {len(chunks)} chunk(s)")
    return out


async def seed_cast_genesis(roster: list, seed: int, llm_fn: LlmFn, write_fn: WriteFn,
                            *, chunk_size: Optional[int] = None) -> dict:
    """Propose the WHOLE cast skeleton → parse → write back (recordCastGenesis) → bounded re-roll
    (≤GENESIS_MAX_REROLLS), echoing the engine's structured re-roll violations back to the model.
    Best-effort + fail-soft: any failure leaves the engine's deterministic FLOOR cast in place
    (byte-neutral). Returns ``{committed, accepted, varianceOk, rerolls, reason?}`` — Vault-free counts.

    ``chunk_size`` (S3c/RC3): when set (e.g. 5), the sketch is gathered in CHUNKS — smaller completions
    that rarely truncate, with a failed chunk retried alone — then combined into ONE atomic write-back.
    ``None`` (the default) keeps the single whole-cast call (byte-identical to before; the live path opts
    into chunking, direct-call unit tests do not).

    PLAYER-BLIND: the roster is the warmed FLOOR cast's Vault-free cards; only the IDS are used to bind
    proposals — no player field is threaded in, and the model never sees the floor identities."""
    valid_ids = {str(n.get("id")) for n in (roster or []) if isinstance(n, dict) and n.get("id")}
    if not valid_ids:
        return {"committed": 0, "accepted": False, "varianceOk": True, "rerolls": 0, "reason": "empty-roster"}
    brief = generate_season_brief(seed)
    feedback: Optional[str] = None
    best = {"committed": 0, "accepted": False, "varianceOk": True, "rerolls": 0, "reason": "no-usable-proposal"}
    _chunked = isinstance(chunk_size, int) and 0 < chunk_size < len(valid_ids)
    for attempt in range(1 + GENESIS_MAX_REROLLS):
        if _chunked:
            proposal = await _gather_chunked_proposal(roster, brief, llm_fn, valid_ids, feedback, chunk_size)
            if not proposal:
                logger.debug("[cast-genesis] every chunk failed — keeping the deterministic floor")
                best["reason"] = "no-usable-proposal"
                break
        else:
            messages = build_genesis_messages(roster, brief, feedback)
            try:
                text = await llm_fn(messages)
            except Exception as e:  # the model can fail — carry on, the floor stands
                logger.warning(f"[cast-genesis] llm failed (attempt {attempt}): {e}")
                best["reason"] = "llm-failed"
                break
            proposal = parse_genesis_proposal(text or "", valid_ids)
            if not proposal:
                # No parseable/usable proposal — one strict-JSON reparse retry, then fall to the floor.
                if attempt == 0:
                    try:
                        text = await llm_fn(messages + [{"role": "user", "content": _STRICT_RETRY}])
                    except Exception as e:
                        logger.warning(f"[cast-genesis] strict-json retry failed: {e}")
                        text = ""
                    proposal = parse_genesis_proposal(text or "", valid_ids)
                if not proposal:
                    logger.debug("[cast-genesis] nothing usable proposed — keeping the deterministic floor")
                    best["reason"] = "no-usable-proposal"
                    break
        try:
            res = await write_fn(proposal)
        except Exception as e:
            logger.warning(f"[cast-genesis] write-back failed (attempt {attempt}): {e}")
            best["reason"] = "write-back-failed"
            break
        if not (isinstance(res, dict) and res.get("accepted")):
            _reason = res.get("reason") if isinstance(res, dict) else f"non-dict ({type(res).__name__})"
            logger.warning(f"[cast-genesis] write-back not accepted: {_reason or 'accepted=false'}")
            best["reason"] = str(_reason or "not-accepted")
            break
        violations = res.get("violations") if isinstance(res.get("violations"), list) else []
        best = {
            "committed": int(res.get("committed") or 0),
            "accepted": True,
            "varianceOk": bool(res.get("varianceOk", True)),
            "rerolls": attempt,
        }
        feedback = _reroll_feedback(violations)
        if not feedback and best["varianceOk"]:
            # A clean commit — no re-roll violations, cast cleared the variance floor. Done.
            logger.info(f"[cast-genesis] committed skeleton for {best['committed']} houseguest(s) "
                        f"(attempt {attempt}, clean)")
            return best
        # Re-roll: echo the violations (or the variance failure) back and try again, up to the budget.
        if not feedback and not best["varianceOk"]:
            feedback = "cast-wide: the stat totals are too flat — spread them WIDELY (real beasts AND real floaters)"
        logger.info(f"[cast-genesis] re-rolling (attempt {attempt} → {attempt + 1}); violations: {feedback}")
    if best.get("accepted"):
        logger.info(f"[cast-genesis] committed skeleton for {best['committed']} houseguest(s) "
                    f"after {best['rerolls']} re-roll(s) (residual violations tolerated — engine floored the rest)")
    return best


# ── strict-failure latch for the loud pre-finalize gate (§4 / #1313 precedent) ─────────────────────────
# Under the DEFAULT strict enrichment policy a genesis run that ends on the deterministic floor (no model,
# a failed call, or exhausted re-rolls with no accepted commit) is a LOUD failure — and casting finalize
# must be held/refused BEFORE the player commits their character (never a silent floor). This latch is what
# the do_create_character pre-finalize gate reads. Cleared on the new-season scrub.
_STRICT_FAILED: set = set()

# Idempotency: the seed for which genesis already COMMITTED per user. Genesis is kicked from TWO seams
# (the interview-open pre-warm `prewarm_cast` — the async overlap — AND the `do_create_character`
# pre-finalize belt that guarantees it runs even when the pre-warm route was never hit, e.g. the
# HTTP/golden flow). Keyed by (user, seed) so the SECOND kick for the same warmed cast is a no-op — no
# duplicate LLM sketch call, no double fold. Cleared on the new-season scrub.
_COMMITTED: dict = {}


def _key(user: Optional[str]) -> str:
    return str(user) if user else "default"


def mark_strict_failed(user: Optional[str]) -> None:
    _STRICT_FAILED.add(_key(user))


def clear_strict_failed(user: Optional[str]) -> None:
    _STRICT_FAILED.discard(_key(user))


def strict_failed(user: Optional[str]) -> bool:
    """True iff the last genesis run for this user FAILED under the strict policy (ended on the floor) —
    the loud pre-finalize gate refuses casting finalize when this is set."""
    return _key(user) in _STRICT_FAILED


def genesis_committed(user: Optional[str], seed) -> bool:
    """True iff genesis already committed a skeleton for this user's CURRENT warmed seed — the
    idempotency guard shared by the pre-warm kick and the pre-finalize belt (no duplicate sketch call)."""
    return seed is not None and _COMMITTED.get(_key(user)) == seed


def _mark_committed(user: Optional[str], seed, committed: int) -> None:
    if seed is not None:
        _COMMITTED[_key(user)] = seed


def reset_state(user: Optional[str] = None) -> None:
    """New-season scrub: clear the strict-failed latch + the idempotency latch so a fresh cast starts
    clean (``user=None`` clears everyone). Also drops the in-flight dedup handles (the tasks
    themselves self-clean and are never cancelled — an old-season run just finishes unobserved)."""
    if user is None:
        _STRICT_FAILED.clear()
        _COMMITTED.clear()
        _IN_FLIGHT.clear()
    else:
        _STRICT_FAILED.discard(_key(user))
        _COMMITTED.pop(_key(user), None)
        for k in [k for k in _IN_FLIGHT if k[0] == _key(user)]:
            _IN_FLIGHT.pop(k, None)


def refusal_message() -> str:
    """The clear, player-visible casting-finalize refusal (strict policy, genesis failed)."""
    return (
        "Casting can't finalize yet (strict enrichment policy): the season's cast could not be "
        "model-authored, so it would fall back to the generic deterministic floor. Configure a chat "
        "model endpoint (Settings → Models), retry, or set enrichment_policy=soft to allow the "
        "deterministic floor.")


# ── the live wiring (best-effort, background; graceful no-op when no model) ─────

async def _resolve_llm_fn(owner: Optional[str]) -> Optional[LlmFn]:
    """Resolve the model for the cast-genesis SKETCH call. Genesis is expressive, end-to-end character
    work like deep authoring, so it routes to the cast-authoring resolver (NARRATION model by default, hot
    sampling temperature, explicit utility fallback). Returns None when no usable text model resolves —
    genesis then silently no-ops and the engine's deterministic floor stands.

    2026-07-13 (the prod cap fix): the sketch is ONE completion carrying the WHOLE 15-NPC skeleton
    JSON, so the resolver is asked for the GENESIS output-cap floor
    (``token_policy.GENESIS_SKETCH_MIN_OUTPUT_TOKENS`` ≥ 8000) — the one-NPC-sized class cap (3000)
    chopped the proposal mid-JSON (``finish_reason=length`` → ``no-usable-proposal``). Signature-
    tolerant: a legacy ``(owner)`` test stub for ``resolve_authoring_llm_fn`` keeps intercepting."""
    try:
        from src.orwell_cast_authoring import resolve_authoring_llm_fn
    except Exception:
        return None
    try:
        try:
            from src.token_policy import GENESIS_SKETCH_MIN_OUTPUT_TOKENS as _floor
        except Exception:  # pragma: no cover - token_policy is a sibling pure module
            _floor = 8000
        try:
            import inspect
            params = inspect.signature(resolve_authoring_llm_fn).parameters
            takes_floor = "min_output_tokens" in params or any(
                p.kind is inspect.Parameter.VAR_KEYWORD for p in params.values())
        except (TypeError, ValueError):
            takes_floor = False
        if takes_floor:
            return await resolve_authoring_llm_fn(owner, min_output_tokens=_floor)
        return await resolve_authoring_llm_fn(owner)  # a legacy-signature stub (tests)
    except Exception:
        return None


# 2026-07-13 in-flight dedup: genesis is kicked from TWO seams (the interview-open pre-warm and the
# do_create_character pre-finalize belt). The `_COMMITTED` idempotency latch only engages AFTER a
# commit, so a finalize that lands while the pre-warm's run is STILL GRINDING used to start a SECOND
# full sketch grind (double LLM spend) — and, because the finalize kick is awaited inside the chat
# turn, the player's casting chat hung for the WHOLE fresh grind. One task per (user, seed): the
# second kick awaits the SAME in-flight run (shielded, so an awaiter's cancellation — e.g. a client
# disconnect on the pre-warm route — never kills the shared run).
_IN_FLIGHT: dict = {}


async def run_genesis(roster: list, seed: int, owner: Optional[str], *,
                      write: Optional[WriteFn] = None) -> dict:
    """Resolve the live deps and model-author the cast skeleton onto the pre-warmed floor. Under ``soft``
    a missing model / failed run is the legacy silent no-op (the deterministic floor stands byte-
    identically). Under the DEFAULT ``strict`` policy the failure is LOUD: an ERROR + an admin-visible
    ledger entry + the strict-failed latch the loud pre-finalize gate reads (§4 / #1313 precedent).

    PLAYER-BLIND: no player identity is threaded in — the cast is proposed off the seeded brief alone.
    Returns the ``seed_cast_genesis`` result dict (Vault-free counts). Concurrency-safe per
    (user, seed): a second kick while a run is in flight AWAITS that run instead of re-grinding."""
    # Idempotency: genesis is kicked from BOTH the interview-open pre-warm AND the do_create_character
    # pre-finalize belt — if it already committed for THIS warmed seed, this second kick is a no-op (no
    # duplicate sketch call, no double fold).
    if genesis_committed(owner, seed):
        return {"committed": 0, "accepted": True, "varianceOk": True, "rerolls": 0,
                "reason": "already-committed"}
    k = (_key(owner), seed)
    task = _IN_FLIGHT.get(k)
    if task is None or task.done():
        task = asyncio.get_running_loop().create_task(
            _run_genesis_once(roster, seed, owner, write=write))
        _IN_FLIGHT[k] = task

        def _cleanup(t, _k=k):
            if _IN_FLIGHT.get(_k) is t:
                _IN_FLIGHT.pop(_k, None)
        task.add_done_callback(_cleanup)
    else:
        logger.info("[cast-genesis] a run for this (user, seed) is already in flight — "
                    "awaiting it instead of starting a second sketch grind")
    # shield: if THIS awaiter is cancelled (e.g. the pre-warm HTTP request disconnects), the shared
    # run keeps going so the other seam (the pre-finalize belt) still gets its result.
    return await asyncio.shield(task)


async def _run_genesis_once(roster: list, seed: int, owner: Optional[str], *,
                            write: Optional[WriteFn] = None) -> dict:
    """The single-flight body of ``run_genesis`` (see the dedup wrapper above)."""
    strict = False
    try:
        from src import enrichment_policy
        strict = enrichment_policy.is_strict()
    except Exception:
        strict = False
    # A fresh run starts clean — clear any prior strict-failed latch for this user before re-evaluating.
    clear_strict_failed(owner)

    def _fail_loud(reason: str, detail: Optional[str] = None) -> None:
        if not strict:
            return
        mark_strict_failed(owner)
        try:
            from src import enrichment_policy
            enrichment_policy.record_failure(owner, "cast-genesis", reason, detail=detail)
        except Exception:
            pass

    llm_fn = await _resolve_llm_fn(owner)
    if llm_fn is None:
        if strict:
            _fail_loud("no model resolved for the cast-genesis call class",
                       detail="the deterministic cast skeleton must not stand silently under the strict policy")
        else:
            logger.debug("[cast-genesis] no utility/narration model — keeping the deterministic floor")
        return {"committed": 0, "accepted": False, "varianceOk": True, "rerolls": 0, "reason": "no-model"}
    from src import orwell_engine

    async def _write(proposal: dict) -> dict:
        return await orwell_engine.record_cast_genesis(proposal, user=owner)

    # S3c: the LIVE path chunks the roster (3×5) — smaller completions rarely truncate, and a failed
    # chunk is retried alone instead of re-grinding the whole cast (RC3). The combined proposal is still
    # written back in one atomic call (the engine's cross-cast dedupe + variance floor stay authoritative).
    result = await seed_cast_genesis(roster, seed, llm_fn, write or _write, chunk_size=GENESIS_CHUNK_SIZE)
    # STRICT: a run that committed NOTHING (all already logged inside seed_cast_genesis) is ledgered
    # loudly + latches the pre-finalize gate. Soft: byte-identical legacy silent floor.
    if isinstance(result, dict) and result.get("accepted") and int(result.get("committed") or 0) > 0:
        _mark_committed(owner, seed, int(result.get("committed") or 0))  # idempotency: no second sketch call
    else:
        _fail_loud("cast genesis committed nothing (model or write-back failed)",
                   detail=f"result={result}")
    return result
