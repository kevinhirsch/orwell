"""0108 — the real-model golden-path gate: record-once / replay-in-CI (the model seam).

Every automated gate stubs the LLM, so the class of bugs living in the model↔engine seam
(tool under-calls, narration desyncs, cast-authoring truncation) ships green and only
surfaces when a human drives a real model. This module is the smallest possible
substitution that closes that hole: it wraps the front-end's TWO public model chokepoints
(``llm_core.stream_llm_with_fallback`` and ``llm_core.llm_call_async`` — the same seam
``llm_trace`` taps) with

  * a RECORD tee    (``ORWELL_GOLDEN_RECORD=1``)      — forward the live bytes unchanged,
    accumulate them, and append one keyed record per model call to the fixture; and
  * a REPLAY short-circuit (``ORWELL_GOLDEN_REPLAY=<fixture>``) — never reach the provider:
    look the request up by its stable key and re-emit the recorded SSE chunks / response.
    A key that is absent from the fixture is a HARD failure (the prompt drifted off the
    recording) — never papered over with a fallback.

With neither env var set the chokepoints never import this module (a bare ``os.environ``
check guards the import), so the disabled path stays byte-identical to today.

The fixture (``frontend/tests/golden/*.jsonl``) is Vault-free by construction — it holds
only the FE's Vault-free request projections plus the model's reply — and every serialized
record passes the same secrets scrub as the 0107 trace. ``VAULT_KEY_PATTERNS`` /
``fixture_leak_scan`` below are the single source for the structural no-Vault gate.

Design note: docs/features/0108-real-model-golden-path-gate.md.
"""

from __future__ import annotations

import hashlib
import json
import os
import threading
from collections import defaultdict
from typing import Any, AsyncIterator, Dict, List, Optional

# ── env gates ────────────────────────────────────────────────────────────────────

RECORD_ENV = "ORWELL_GOLDEN_RECORD"
REPLAY_ENV = "ORWELL_GOLDEN_REPLAY"
FIXTURE_ENV = "ORWELL_GOLDEN_FIXTURE"  # record-side output path override
#: The DECLARED two-tier models + seed for the fixture's self-describing meta line. The
#: record DRIVER sets these on the FE process; the FE writes the meta line itself on the
#: first record so the meta writer and the record writer are the SAME process — the
#: integrity scan's initialized-by-A-populated-by-B rule holds by construction.
META_NARRATION_ENV = "ORWELL_GOLDEN_NARRATION_MODEL"
META_UTILITY_ENV = "ORWELL_GOLDEN_UTILITY_MODEL"
META_SEED_ENV = "ORWELL_GOLDEN_SEED"

#: The one canonical committed fixture — the owner's two-tier topology (2026-07-07):
#: narration z-ai/glm-4.7, utility qwen/qwen3.6-flash. The gate stays model-agnostic:
#: the replay driver globs for whatever single golden_path_*.jsonl is committed.
DEFAULT_FIXTURE = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "tests", "golden", "golden_path_glm-4.7.jsonl")

#: The sentinel the replay-miss error carries — the CI driver greps for it, and the
#: failure message tells a human exactly how to regenerate (spec: "a regenerate-the-
#: fixture message").
MISS_SENTINEL = "GOLDEN-REPLAY-MISS"

REGENERATE_HINT = (
    "a request reached the model chokepoint whose key is not in the golden fixture — "
    "a prompt/tool-schema/params change drifted off the recording. Regenerate it: "
    "cd frontend && ORWELL_GOLDEN_RECORD=1 python3 scripts/golden_path_record.py "
    "(needs a live narrator endpoint; see INTEGRATION.md §golden-path)"
)


def record_enabled() -> bool:
    return os.environ.get(RECORD_ENV, "") == "1"


def replay_enabled() -> bool:
    return bool(os.environ.get(REPLAY_ENV))


def active() -> bool:
    # Contract: never raises — callers gate imports/branches on this. Any error resolves
    # to a definite ``False`` (disabled) rather than propagating out of a hot path.
    try:
        return record_enabled() or replay_enabled()
    except Exception:
        return False


def fixture_path() -> str:
    """Record side: where the fixture is written; replay side: the fixture to load."""
    if replay_enabled():
        return os.environ[REPLAY_ENV]
    return os.environ.get(FIXTURE_ENV) or DEFAULT_FIXTURE


class GoldenReplayMiss(RuntimeError):
    """Replay reached a request whose key the fixture does not hold — hard failure."""


# ── the stable request key ─────────────────────────────────────────────────────────
#
# Stable across runs, sensitive to drift: the ordered messages (role + content), the
# tool schemas (sorted by function name), and the sampling params that shape the output.
# Volatile fields never enter the key: endpoint URL, headers (never handed to us at all),
# user/session ids, timeouts, retry counts, provider routing. The model id IS part of the
# key — the replay driver configures a dead-end endpoint pinned to the recorded model id,
# so a model swap (a real behavioral change) misses loudly instead of replaying stale bytes.

_PARAM_KEYS = (
    "model", "temperature", "max_tokens", "call_class", "prompt_type",
    "response_format", "reasoning", "tool_choice",
)


# Wall-clock text the FE legitimately injects into prompts (the "## Current date and
# time" context section — src/user_time.py current_datetime_prompt) drifts by the minute,
# and the DATE line drifts daily, which would miss a fixture recorded any earlier day. The
# spec excludes timestamps from the key, so canonicalization neutralizes date/time SHAPES
# — key-side only; the recorded fixture bytes always keep the full original content. The
# date/time shapes are neutralized ONLY inside that wall-clock section, so a genuine date
# change in a game fact or a tool result still drifts the key (never masked as a clock tick).
import re as _re

#: The header the FE injects for the wall-clock section, and the pattern that ends it
#: (the next markdown header, or end-of-string).
_WALLCLOCK_HEADER = "## Current date and time"
_NEXT_HEADER_RE = _re.compile(r"\n#{1,6} ")

_WALLCLOCK_RES = (
    # "2026-07-07" / "2026-07-07T14:57:03Z"
    _re.compile(r"\b\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:?\d{2})?)?\b"),
    # "Tuesday, July 7, 2026" / "July 7, 2026"
    _re.compile(r"\b(?:(?:Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day,\s+)?"
                r"(?:January|February|March|April|May|June|July|August|September|October|November|December)"
                r"\s+\d{1,2},\s+\d{4}\b"),
    # "2:57 PM" / "14:57" / "14:57:03"
    _re.compile(r"\b\d{1,2}:\d{2}(?::\d{2})?(?:\s?[AaPp][Mm])?\b"),
)

# The presence dwell counter/labels tick per FRAMED MODEL ROUND, and round counts
# legitimately vary ±1 with stream timing (an agent-loop continuation decision), so a
# cosmetic counter would drift every later key. Record #9's replay diverged on EXACTLY
# this: identical co-present sets and rooms, every dwell +1. They are neutralized
# key-side — but ONLY on the two prompt lines that render them (`Your room:` /
# `With you:` in the whereabouts block, src/engine/momentPrompts.ts), so the same
# parenthetical worded into unrelated prose ("she paused (a moment)") still drifts the
# key like any other game fact (PR #1234 review — the old global sub masked those too).
# The recorded bytes always keep the real labels; every other roster/room detail on the
# same lines still keys (the 0108 unit gates).
_PRESENCE_LINE_RES: tuple = (
    # "With you: A (lingering, 9 turns), B (a moment), C (just arrived)."
    (_re.compile(r"^\s*With you: .*$", _re.MULTILINE), (
        _re.compile(r"\(lingering, \d+ turns?\)", _re.IGNORECASE),
        _re.compile(r"\((?:a moment|just arrived)\)", _re.IGNORECASE),
    )),
    # "Your room: the living room (you've been here 3 turns)." — the tenure clause also
    # renders word forms at t<=1 ("just arrived"/"a moment"), which the old numeric-only
    # global pattern silently missed; [^)]* covers all three.
    (_re.compile(r"^\s*Your room: .*$", _re.MULTILINE), (
        _re.compile(r"\(you'?ve been here [^)]*\)", _re.IGNORECASE),
    )),
)


def _neutralize_presence_lines(s: str) -> str:
    for line_rx, subs in _PRESENCE_LINE_RES:
        def _sub_line(m: "_re.Match[str]") -> str:
            line = m.group(0)
            for rx in subs:
                line = rx.sub("<VOLATILE-TIME>", line)
            return line
        s = line_rx.sub(_sub_line, s)
    return s


# The off-screen-society block carries two MORE tick-timing-volatile framing spans (the
# #1355 record↔replay divergence, at the HOH-competition forced-advance turn) that
# legitimately vary ±1 between the slow live record and the instant replay — exactly like
# the dwell counters / wall-clock above. Both are neutralized key-side ONLY (the recorded
# fixture bytes keep the full original content), and NARROWLY — only the volatile span,
# preserving the surrounding stable framing so a genuine prompt change still drifts the key.
#
# (1) The gossip DRIFT hedge appended to a surfaced fact by src/engine/gossip.ts `distort`:
#     " · <hedge phrase>#<0-999>" (a random hedge word + a random id, re-rolled every
#     retelling — and a retelling can happen ±1 more time between record and replay). The
#     surfaced-fact CONTENT ("word around the house is that A and B are plotting something",
#     "(overheard, muffled) …") reaches the prompt via `renderSurfacedFacts` through the
#     adapter's id-only `humanize` (`humanizeIds`), which — unlike the player-display scrub —
#     does NOT run `tidyPathwaySlugs`, so this marker survives verbatim into the key. The
#     pattern MIRRORS that strip (`src/domain/humanize.ts tidyPathwaySlugs`) so it targets
#     exactly the machine hedge and nothing else; a `\n` guard keeps it to a single fact line.
_GOSSIP_DRIFT_RE = _re.compile(r"\s*·\s*[^·#\n]*#\d+")

# (2) The MOVEMENT-IN-THE-ROOM presence-diff cue (frontend/routes/chat_helpers.py
#     `_render_presence_movement`): "MOVEMENT IN THE ROOM (engine truth) — <who came/went>.
#     Voice it as a natural beat …". WHO came/went between the em-dash and the fixed
#     ". Voice it as a natural beat" is the ±1 volatile span (the per-turn presence diff);
#     the instruction around it is stable framing. Single-line by construction (the parts are
#     "; "-joined, no newlines), so `[^\n]` keeps the match from spanning unrelated prompt text.
_MOVEMENT_LINE_RE = _re.compile(
    r"(MOVEMENT IN THE ROOM \(engine truth\) — )[^\n]*?(\. Voice it as a natural beat)")


def _neutralize_offscreen_society(s: str) -> str:
    s = _GOSSIP_DRIFT_RE.sub(" <VOLATILE-GOSSIP-DRIFT>", s)
    s = _MOVEMENT_LINE_RE.sub(r"\1<VOLATILE-MOVEMENT>\2", s)
    return s


# The SAME per-committed-turn presence-tenure counter neutralized above in the rendered "Your
# room:"/"With you:" PROMPT TEXT (`_neutralize_presence_lines`) is ALSO echoed RAW into a tool
# RESULT a round can hand back to the model on the very next round — e.g. `createCharacter`'s
# response nests a full `whereabouts` snapshot (`{"turnsHere": N, "companions": [{"turnsHere": N},
# …]}`) at season start. That JSON leaf is a distinct code path from the humanized prompt lines
# (it reaches the key via `_canon_messages`' `tool`-role content, not `momentPrompts.ts`), so the
# line-scoped presence subs above never touch it — the exact gap the fresh 2026-07-17 GLM
# recording surfaced: the finalize turn's round-2 request (built from round-1's replayed
# `createCharacter` tool result) keys on the LIVE-recorded tenure snapshot, which the deterministic
# replay reconstruction cannot reproduce bit-for-bit (a real, otherwise-harmless value baked into
# ONE recording run). Neutralized narrowly — the numeric LEAF only, by JSON key name, wherever it
# appears — so every other detail in the same tool-result payload (room assignment, roster, names)
# still drifts the key on a real change.
_TURNSHERE_JSON_RE = _re.compile(r'("turnsHere"\s*:\s*)\d+')


def _neutralize_presence_tenure_json(s: str) -> str:
    return _TURNSHERE_JSON_RE.sub(r"\g<1>0", s)


def _neutralize_volatile(s: str) -> str:
    # Dwell counters/labels are neutralized only on the presence lines that render them.
    s = _neutralize_presence_lines(s)
    # The off-screen-society gossip-drift hedge + the movement-in-the-room cue (#1355) —
    # both tick-timing-volatile framing, narrowly neutralized (see the module notes above).
    s = _neutralize_offscreen_society(s)
    # The same tenure counter, echoed RAW as JSON inside a tool result (see the note above).
    s = _neutralize_presence_tenure_json(s)
    # Date/time shapes are neutralized ONLY inside the wall-clock context section, so a real
    # date/time embedded in game content or a tool result still drifts the key.
    idx = s.find(_WALLCLOCK_HEADER)
    if idx == -1:
        return s
    m = _NEXT_HEADER_RE.search(s, idx + len(_WALLCLOCK_HEADER))
    end = m.start() if m else len(s)
    section = s[idx:end]
    for rx in _WALLCLOCK_RES:
        section = rx.sub("<VOLATILE-TIME>", section)
    return s[:idx] + section + s[end:]


def _canon_content(content: Any) -> Any:
    if content is None:
        return content
    if isinstance(content, str):
        return _neutralize_volatile(content)
    try:
        return _neutralize_volatile(json.dumps(content, sort_keys=True, ensure_ascii=False))
    except Exception:
        return _neutralize_volatile(str(content))


def _canon_messages(messages: Optional[List[Dict]]) -> List[Dict[str, Any]]:
    out = []
    for m in messages or []:
        entry: Dict[str, Any] = {
            "role": m.get("role"),
            "content": _canon_content(m.get("content")),
        }
        # tool-result turns key on which call they answer (name + id are stable within
        # a run's call order; ids are model-issued and replayed verbatim, so they are
        # reproducible under replay and meaningful under record).
        for extra in ("name", "tool_call_id"):
            if m.get(extra) is not None:
                entry[extra] = m.get(extra)
        if m.get("tool_calls"):
            entry["tool_calls"] = _canon_content(m.get("tool_calls"))
        out.append(entry)
    return out


def _canon_tools(tools: Optional[List[Dict]]) -> List[str]:
    canon = []
    for t in tools or []:
        try:
            fn = (t.get("function") or {}) if isinstance(t, dict) else {}
            # The description is model-facing instruction text: changing it alters live
            # behavior, so it MUST enter the key or CI would replay a stale fixture.
            desc = fn.get("description")
            if desc is None and isinstance(t, dict):
                desc = t.get("description")
            canon.append(json.dumps(
                {"name": fn.get("name") or t.get("name"),
                 "description": desc, "schema": fn.get("parameters")},
                sort_keys=True, ensure_ascii=False))
        except Exception:
            canon.append(str(t))
    return sorted(canon)


def _canon_params(params: Dict[str, Any]) -> Dict[str, Any]:
    out = {}
    for k in _PARAM_KEYS:
        v = params.get(k)
        if v is not None:
            out[k] = v if isinstance(v, (str, int, float, bool)) else _canon_content(v)
    return out


def _sha(obj: Any) -> str:
    return hashlib.sha256(
        json.dumps(obj, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()


def request_key(kind: str, messages: Optional[List[Dict]],
                tools: Optional[List[Dict]], params: Dict[str, Any]) -> str:
    return _sha({
        "kind": kind,
        "messages": _canon_messages(messages),
        "tools": _canon_tools(tools),
        "params": _canon_params(params),
    })


def request_digest(messages: Optional[List[Dict]], tools: Optional[List[Dict]],
                   params: Dict[str, Any]) -> Dict[str, Any]:
    """The human-diffable side-channel stored beside the key (never part of the key)."""
    return {
        "messages_sha": _sha(_canon_messages(messages)),
        "tools_sha": _sha(_canon_tools(tools)),
        "params": _canon_params(params),
    }


# ── record side ────────────────────────────────────────────────────────────────────

_write_lock = threading.Lock()
_seq = 0

#: Fixture format 2 = a leading ``kind: meta`` line (declared two-tier models + writer
#: identity) written by the record script, and a ``writer`` stamp on every record.
FIXTURE_FORMAT = 2

#: Per-process fixture-writer identity. One recording must have exactly ONE record
#: writer: the first GLM fixture was silently contaminated when the walk's model
#: resolution flipped mid-run to a stale endpoint, and nothing structural could tell
#: the two traffic sources apart after the fact. The stamp makes any interleaving —
#: a second process appending to the same path, or a forked worker — a detectable,
#: hard integrity failure instead of a corrupted-but-green fixture.
import secrets as _secrets

_WRITER_ID = f"{os.getpid()}.{_secrets.token_hex(3)}"


def _scrub(obj: Any) -> Any:
    """Defence in depth — the 0107 scrub (bearer/sk-…/secret-shaped keys). Headers are
    never handed to this module in the first place."""
    try:
        from src import llm_trace
        return llm_trace._scrub(obj)
    except Exception:
        return obj


def _meta_record(first_rec: Dict[str, Any]) -> Dict[str, Any]:
    """The self-describing meta line, written by THIS process on its first record so meta
    writer == record writer (the integrity scan's initialized-vs-populated rule). Models
    come from the driver-set envs; absent (a bare unit-test record), the first record's own
    model stands in for both tiers so format-2 shape always holds."""
    narration = os.environ.get(META_NARRATION_ENV, "") or str(first_rec.get("model") or "")
    utility = os.environ.get(META_UTILITY_ENV, "") or narration
    seed_raw = os.environ.get(META_SEED_ENV, "")
    try:
        seed: Optional[int] = int(seed_raw) if seed_raw else None
    except ValueError:
        seed = None
    return {
        "kind": "meta", "format": FIXTURE_FORMAT,
        "narration_model": narration, "utility_model": utility,
        "seed": seed, "writer": _WRITER_ID,
    }


def _append_record(rec: Dict[str, Any]) -> None:
    global _seq
    path = fixture_path()
    try:
        with _write_lock:
            rec["seq"] = _seq
            rec["writer"] = _WRITER_ID
            _seq += 1
            os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
            need_meta = not os.path.exists(path) or os.path.getsize(path) == 0
            with open(path, "a", encoding="utf-8") as fh:
                if need_meta:
                    fh.write(json.dumps(_meta_record(rec), ensure_ascii=False) + "\n")
                fh.write(json.dumps(_scrub(rec), ensure_ascii=False) + "\n")
    except Exception:
        # Recording must never break the live run it is riding — but a silent hole in
        # the fixture WOULD break replay, so make the failure visible in the log.
        import logging
        logging.getLogger(__name__).exception("golden-record: failed to append record")


def dropped_sidecar_path(path: Optional[str] = None) -> str:
    """The sidecar file beside the fixture that records every stream the record run
    could NOT persist as replayable. A non-empty sidecar means the take is structurally
    unreplayable (replay would hard-miss at that request), so the record script fails
    loudly on it instead of printing RECORD OK over a poisoned fixture."""
    return (path or fixture_path()) + ".dropped.jsonl"


def _append_dropped(reason: str, candidates_model: str, kwargs: Dict[str, Any],
                    resp: Dict[str, Any], chunks: List[str], key: str) -> None:
    """Best-effort diagnostics for a stream the record run dropped (never fixture content —
    key/model/shape only, so the sidecar can be printed verbatim in the record report).
    The request key lets the record script tell a BENIGN drop (the FE transparently
    retried the same request and the retry's success was persisted under this key — replay
    just consumes the success) from a POISONED take (no persisted record shares the key,
    so replay hard-misses there)."""
    try:
        with open(dropped_sidecar_path(), "a", encoding="utf-8") as fh:
            fh.write(json.dumps({
                "reason": reason,
                "key": key,
                "model": candidates_model,
                "call_class": kwargs.get("call_class") or "narration",
                "finish_reason": resp.get("finishReason"),
                "error": resp.get("error"),
                "chunk_count": len(chunks),
                "output_chars": len(resp.get("text") or ""),
            }, ensure_ascii=False) + "\n")
    except Exception:
        import logging
        logging.getLogger(__name__).exception("golden-record: failed to append dropped-stream sidecar")


def fixture_keys(path: Optional[str] = None) -> set:
    """Every replayable request key the fixture holds (record-script helper for the
    benign-vs-poisoned dropped-stream triage)."""
    keys = set()
    p = path or fixture_path()
    try:
        with open(p, encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    rec = json.loads(line)
                except Exception:
                    continue
                if isinstance(rec, dict) and rec.get("key"):
                    keys.add(rec["key"])
    except OSError:
        pass
    return keys


def _debug_dump_request(kind: str, key: str, digest: Optional[Dict[str, Any]],
                        params: Dict[str, Any], messages: Optional[List[Dict]]) -> None:
    """Opt-in drift forensics (``ORWELL_GOLDEN_DEBUG_DUMP=<path>``): append this request's
    CANONICAL form (key + digest + neutralized messages). On the replay side the miss path
    calls this so a drifted prompt can be diffed instead of guessed at from the sha; on the
    record side record_stream/record_call call it for EVERY persisted request so the two
    dumps can be byte-diffed turn-by-turn. Best-effort, never raises, off by default."""
    dump = os.environ.get("ORWELL_GOLDEN_DEBUG_DUMP")
    if not dump:
        return
    try:
        # noqa: the dump path is an operator/CI-controlled env var (opt-in drift
        # diagnosis), never user input — not an untrusted-path traversal.
        with open(dump, "a", encoding="utf-8") as fh:  # nosec B108
            fh.write(json.dumps(_scrub({
                "kind": kind, "key": key, "digest": digest,
                "params": _canon_params(params),
                "messages": _canon_messages(messages),
            }), ensure_ascii=False) + "\n")
    except OSError:
        # Best-effort diagnostic only — a write failure must never affect the run.
        pass


def record_stream(candidates_model: str, messages: List[Dict],
                  kwargs: Dict[str, Any], chunks: List[str],
                  *, completed: Optional[bool] = None) -> None:
    """Append one streamed call to the fixture (called from the chokepoint's ``finally``
    with the full ordered chunk list).

    Persistence rule (2026-07-17 — the finalize-turn replay miss): a stream is persisted
    whenever it carried NO error chunk and the caller did not veto it (``completed=False``).
    That deliberately INCLUDES a clean stream with no finishReason and no ``[DONE]`` — the
    live model (GLM-4.7) really does end a stream empty-handed sometimes, the FE's refire
    belts handle it live, and replay must re-emit the same empty stream to walk the same
    belt path; the old finish-marker requirement silently dropped those streams and made
    the take unreplayable (replay hard-missed at the finalize turn). ``meta.completed_normally``
    still records whether finish markers were seen, for diagnosis.

    An ERRORED or caller-vetoed stream is still never persisted — the FE's live reaction
    (retry / model fallback) can't be reproduced from a poisoned record — but it is now
    logged to the dropped-stream sidecar so the record script FAILS the take loudly
    instead of shipping a fixture that replay cannot walk."""
    from src import llm_trace
    acc = llm_trace.StreamAccumulator()
    for c in chunks:
        acc.observe(c)
    resp = acc.response()
    if completed is False or resp.get("error"):
        params = dict(kwargs)
        params["model"] = candidates_model
        _append_dropped("vetoed" if completed is False else "error-chunk",
                        candidates_model, kwargs, resp, chunks,
                        request_key("stream", messages, kwargs.get("tools"), params))
        return
    completed_normally = (
        bool(resp.get("finishReason")) or any("[DONE]" in c for c in chunks))
    params = dict(kwargs)
    params["model"] = candidates_model
    _key = request_key("stream", messages, kwargs.get("tools"), params)
    _debug_dump_request("stream", _key,
                        request_digest(messages, kwargs.get("tools"), params),
                        params, messages)
    _append_record({
        "key": _key,
        "call_class": kwargs.get("call_class") or "narration",
        "model": candidates_model,
        "request_digest": request_digest(messages, kwargs.get("tools"), params),
        "kind": "stream",
        "chunks": list(chunks),
        "meta": {
            "finish_reason": resp.get("finishReason"),
            "output_chars": len(resp.get("text") or ""),
            "reasoning_chars": len(resp.get("reasoning") or ""),
            "tool_call_seen": bool(resp.get("toolCalls")),
            "error": resp.get("error"),
            "completed_normally": completed_normally,
        },
    })


def record_call(model: str, messages: List[Dict], params: Dict[str, Any],
                response: Optional[str], error: Optional[str] = None) -> None:
    """Append one completed utility (non-streaming) call to the fixture."""
    params = dict(params)
    params["model"] = model
    _key = request_key("call", messages, None, params)
    _debug_dump_request("call", _key, request_digest(messages, None, params),
                        params, messages)
    _append_record({
        "key": _key,
        "call_class": params.get("call_class") or "utility",
        "model": model,
        "request_digest": request_digest(messages, None, params),
        "kind": "call",
        "response": response,
        "meta": {"error": error, "output_chars": len(response or "")},
    })


# ── the fixture's self-description + integrity gate ────────────────────────────────


def write_meta(path: str, *, narration_model: str, utility_model: str,
               seed: Optional[int] = None) -> None:
    """Start a FRESH fixture with its self-describing meta line (the record script calls
    this after deleting the old fixture, before the FE boots). Replay derives the models
    to pin from here instead of guessing from record shapes — the old first-stream/-call
    heuristic mis-derived on two-tier fixtures because cast-identity calls are streamed
    on the UTILITY tier but default to ``call_class: narration``."""
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(json.dumps({
            "kind": "meta", "format": FIXTURE_FORMAT,
            "narration_model": narration_model, "utility_model": utility_model,
            "seed": seed, "writer": _WRITER_ID,
        }, ensure_ascii=False) + "\n")


def fixture_meta(path: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """The fixture's leading meta record, or None (a format-1 fixture)."""
    p = path or fixture_path()
    try:
        with open(p, "r", encoding="utf-8") as fh:
            first = fh.readline().strip()
        rec = json.loads(first) if first else None
        return rec if isinstance(rec, dict) and rec.get("kind") == "meta" else None
    except Exception:
        return None


def fixture_model_census(path: Optional[str] = None) -> Dict[str, int]:
    """model id → record count over the fixture's records (meta line excluded)."""
    p = path or fixture_path()
    census: Dict[str, int] = {}
    if not os.path.isfile(p):
        return census
    with open(p, "r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except Exception:
                continue
            if rec.get("kind") == "meta":
                continue
            m = rec.get("model") or "<none>"
            census[m] = census.get(m, 0) + 1
    return census


def fixture_integrity_scan(path: Optional[str] = None, *,
                           narration_model: Optional[str] = None,
                           utility_model: Optional[str] = None) -> List[str]:
    """Structural trust gate for a recorded fixture (the record script asserts [] before
    ever suggesting a commit). Two rules, each the scar of a real corruption:

    * exactly ONE record-writer process — the first GLM fixture interleaved a second
      traffic source and stayed silently green until replay missed 27 keys; and
    * every record's model within the DECLARED two-tier set — mid-run the walk's model
      resolution flipped to a stale stub endpoint (a previous run's canonical-session
      binding), so 90 of 251 "GLM" records were stub narration.

    Returns human-readable violations (empty = trustworthy).
    """
    p = path or fixture_path()
    if not os.path.isfile(p):
        return [f"fixture missing: {p}"]
    violations: List[str] = []
    meta = fixture_meta(p)
    allowed = {m for m in (narration_model, utility_model) if m}
    if meta:
        allowed |= {m for m in (meta.get("narration_model"), meta.get("utility_model")) if m}
        for want, have in (("narration_model", narration_model), ("utility_model", utility_model)):
            if have and meta.get(want) and meta.get(want) != have:
                violations.append(
                    f"meta declares {want}={meta.get(want)!r} but the run intended {have!r}")
    else:
        violations.append("no meta line — record via scripts/golden_path_record.py "
                          "(format 2 fixtures are self-describing)")
    writers: set = set()
    with open(p, "r", encoding="utf-8") as fh:
        for n, line in enumerate(fh, 1):
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except Exception:
                violations.append(f"line {n}: unparseable record")
                continue
            if rec.get("kind") == "meta":
                if n != 1:
                    violations.append(f"line {n}: meta record not first — a second recording "
                                      "appended onto an existing fixture")
                continue
            writers.add(rec.get("writer") or "<unstamped>")
    if len(writers) > 1:
        violations.append(
            f"multiple record writers {sorted(writers)} — concurrent processes appended "
            "to one fixture path (run exactly one golden driver at a time)")
    # Note: the meta line is written by the recorder/driver process; fixture records are
    # appended by the FE uvicorn subprocess (a different OS PID → different _WRITER_ID).
    # The meta-vs-records writer comparison therefore always fires on a real recording run
    # and has been removed.  The multi-writer check above (len(writers) > 1) is the only
    # single-writer enforcement needed: it flags genuinely concurrent record writers while
    # tolerating the legitimate recorder-vs-FE-subprocess split.
    if allowed:
        for m, c in sorted(fixture_model_census(p).items()):
            if m not in allowed:
                violations.append(
                    f"foreign model in fixture: {m} ({c} records) — model resolution "
                    f"flipped off the declared set {sorted(allowed)} mid-run (stale "
                    "session/endpoint state, or a provider fallback)")
    return violations


# ── replay side ────────────────────────────────────────────────────────────────────

_replay_lock = threading.Lock()
_replay_fixture: Optional[Dict[str, List[Dict]]] = None
_replay_cursor: Dict[str, int] = {}
_replay_hits = 0


def _load_fixture() -> Dict[str, List[Dict]]:
    global _replay_fixture
    with _replay_lock:
        if _replay_fixture is not None:
            return _replay_fixture
        path = fixture_path()
        if not os.path.isfile(path):
            raise GoldenReplayMiss(
                f"{MISS_SENTINEL}: fixture not found at {path} — {REGENERATE_HINT}")
        by_key: Dict[str, List[Dict]] = defaultdict(list)
        with open(path, "r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                rec = json.loads(line)
                if rec.get("kind") == "meta" or "key" not in rec:
                    continue  # the format-2 self-description line is not a replayable record
                by_key[rec["key"]].append(rec)
        for entries in by_key.values():
            entries.sort(key=lambda r: r.get("seq", 0))
        _replay_fixture = dict(by_key)
        return _replay_fixture


def _lookup(key: str, kind: str, params: Dict[str, Any],
            digest: Optional[Dict[str, Any]] = None,
            messages: Optional[List[Dict]] = None) -> Dict[str, Any]:
    """Resolve one request against the fixture. Same-key repeats consume the recorded
    list in call order, then stick on the last entry (a benign idempotent retry never
    forces a re-record); an unknown key is the hard drift failure."""
    global _replay_hits
    fixture = _load_fixture()
    entries = fixture.get(key)
    if not entries:
        # Diagnosis aid: with ORWELL_GOLDEN_DEBUG_DUMP=<path>, append the full live
        # request (scrubbed) so a drifted prompt can be diffed against the recording
        # instead of guessed at from the sha alone.
        _debug_dump_request(kind, key, digest, params, messages)
        raise GoldenReplayMiss(
            f"{MISS_SENTINEL}: no fixture entry for {kind} request key {key[:16]}… "
            f"(model={params.get('model')}, call_class={params.get('call_class')}, "
            f"live_digest={json.dumps(digest or {}, sort_keys=True)[:400]}) — "
            f"{REGENERATE_HINT}")
    with _replay_lock:
        idx = _replay_cursor.get(key, 0)
        rec = entries[min(idx, len(entries) - 1)]
        _replay_cursor[key] = idx + 1
        _replay_hits += 1
    return rec


async def replay_stream(candidates_model: str, messages: List[Dict],
                        kwargs: Dict[str, Any]) -> AsyncIterator[str]:
    """Re-emit the recorded SSE chunks for this request, byte-for-byte, in order.
    Never touches the network; never reaches ``_stream_llm_with_fallback_impl``."""
    params = dict(kwargs)
    params["model"] = candidates_model
    key = request_key("stream", messages, kwargs.get("tools"), params)
    rec = _lookup(key, "stream", params,
                  digest=request_digest(messages, kwargs.get("tools"), params),
                  messages=messages)
    for chunk in rec.get("chunks") or []:
        yield chunk


def replay_call(model: str, messages: List[Dict], params: Dict[str, Any]) -> str:
    params = dict(params)
    params["model"] = model
    key = request_key("call", messages, None, params)
    rec = _lookup(key, "call", params,
                  digest=request_digest(messages, None, params),
                  messages=messages)
    if rec.get("meta", {}).get("error"):
        raise RuntimeError(f"golden-replay: recorded call errored: {rec['meta']['error']}")
    return rec.get("response") or ""


def replay_stats() -> Dict[str, Any]:
    fixture = _replay_fixture or {}
    return {
        "hits": _replay_hits,
        "distinct_keys_used": len(_replay_cursor),
        "fixture_keys": len(fixture),
        "fixture_records": sum(len(v) for v in fixture.values()),
    }


# ── the structural Vault gate (single source for the fixture-leak test) ─────────────
#
# The fixture may only ever hold Vault-free projections + the model's reply. These are
# the forbidden shapes the 0108 gate scans the SERIALIZED fixture for (templated on the
# 0107 / redaction gates). ``npc:<id>`` is additionally forbidden in any PLAYER-FACING
# body (the reply text the transcript renders), where it would be a machinery leak.

VAULT_KEY_PATTERNS = (
    # `hidden` requires the ENGINE Vault field suffixes (hiddenTarget/hiddenAgenda): the
    # fixture stores MODEL OUTPUT only (prompts are digests), and the cast-authoring
    # write-back legitimately AUTHORS hidden profile content in flight TO the engine —
    # record #11's identity stream carried `"hiddenLifeStakes"` and the bare-word pattern
    # false-failed a leak-clean fixture. Engine Vault state can never reach these bytes
    # structurally; the scan hunts engine FIELD NAMES echoed back, not the sanctioned
    # authoring direction.
    # KEY POSITION ONLY (trailing `\s*:`). These are all engine Vault FIELD NAMES, and every one
    # is also a common English word the NARRATOR legitimately says (trust/threat/soul/grudge/
    # scheme/confession). A real engine echo is always a JSON key with its value — `{"trust": 0.7}`
    # — so it always carries the colon; a bare narration VALUE (`{"delta": "trust"}`, e.g. the word
    # "untrustworthy" streamed token-by-token) is NOT a Vault leak and must not trip the gate. Without
    # the colon anchor the scan false-fails a leak-clean fixture on ordinary narration prose (it would
    # block essentially every re-record). Requiring key position loses no true-positive coverage: the
    # secret is the NUMBER, which only ever reaches bytes as a `"<field>": <value>` pair.
    r'"soul"\s*:', r'"trust"\s*:', r'"threat"\s*:', r'"affinity"\s*:',
    r'"hidden(?:Target|Agenda)"\s*:', r'"grudge"\s*:', r'"scheme"\s*:', r'"confession(?:al)?"\s*:',
)
SECRET_PATTERNS = (r"Bearer\s+[A-Za-z0-9._\-]{8,}", r"\bsk-[A-Za-z0-9._\-]{8,}\b")


def _decoded_string_leaves(line: str) -> List[str]:
    """Every JSON string leaf of a fixture line (recursively), so a Vault key embedded
    inside a JSON string VALUE — where it serializes escaped as ``\\"trust\\"`` and the raw
    ``"trust"`` pattern would miss it — is surfaced as the un-escaped ``"trust"``. A leaf
    that is itself serialized JSON (nested escaping) is decoded one level further."""
    out: List[str] = []
    try:
        obj = json.loads(line)
    except Exception:
        return out
    stack = [obj]
    seen = 0
    while stack and seen < 100000:  # bound: a pathological fixture line can't wedge the scan
        seen += 1
        cur = stack.pop()
        if isinstance(cur, str):
            out.append(cur)
            s = cur.strip()
            if s[:1] in ("{", "["):
                try:
                    stack.append(json.loads(cur))
                except Exception:
                    pass
        elif isinstance(cur, dict):
            for k, v in cur.items():
                out.append(k)
                stack.append(v)
        elif isinstance(cur, list):
            stack.extend(cur)
    return out


def fixture_leak_scan(path: Optional[str] = None) -> List[str]:
    """Scan a serialized fixture for Vault keys / secret material. Returns a list of
    human-readable violations (empty = clean). The 0108 structural test asserts [].

    Both the RAW line and every DECODED JSON string leaf are scanned: a Vault key inside a
    prompt/tool-result string value serializes escaped (``\\"trust\\"``) and would slip past
    a raw-line ``"trust"`` pattern — decoding the string surfaces the bare key."""
    import re
    p = path or fixture_path()
    violations: List[str] = []
    if not os.path.isfile(p):
        return [f"fixture missing: {p}"]
    with open(p, "r", encoding="utf-8") as fh:
        for n, line in enumerate(fh, 1):
            texts = [line]
            texts.extend(_decoded_string_leaves(line))
            for pat in VAULT_KEY_PATTERNS:
                if any(re.search(pat, t) for t in texts):
                    violations.append(f"line {n}: vault-key pattern {pat}")
            for pat in SECRET_PATTERNS:
                if any(re.search(pat, t) for t in texts):
                    violations.append(f"line {n}: secret-shaped material {pat}")
    return violations
