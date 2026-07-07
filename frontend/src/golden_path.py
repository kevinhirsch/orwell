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

#: The one canonical committed fixture — the owner's two-tier topology (2026-07-07):
#: narration z-ai/glm-5.2, utility qwen/qwen3.6-flash. The gate stays model-agnostic:
#: the replay driver globs for whatever single golden_path_*.jsonl is committed.
DEFAULT_FIXTURE = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "tests", "golden", "golden_path_glm-5.2.jsonl")

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
    return record_enabled() or replay_enabled()


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
# time" context section) drifts by the minute — and the DATE line drifts daily, which
# would miss a fixture recorded any earlier day. The spec excludes timestamps from the
# key, so canonicalization neutralizes date/time SHAPES — key-side only; the recorded
# fixture bytes always keep the full original content.
import re as _re

_VOLATILE_RES = (
    # "2026-07-07" / "2026-07-07T14:57:03Z"
    _re.compile(r"\b\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:?\d{2})?)?\b"),
    # "Tuesday, July 7, 2026" / "July 7, 2026"
    _re.compile(r"\b(?:(?:Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day,\s+)?"
                r"(?:January|February|March|April|May|June|July|August|September|October|November|December)"
                r"\s+\d{1,2},\s+\d{4}\b"),
    # "2:57 PM" / "14:57" / "14:57:03"
    _re.compile(r"\b\d{1,2}:\d{2}(?::\d{2})?(?:\s?[AaPp][Mm])?\b"),
    # The presence dwell counter in the moment prompt ("you've been here 4 turns"): it ticks per
    # FRAMED MODEL ROUND, and round counts legitimately vary ±1 with stream timing (an agent-loop
    # continuation decision), so a cosmetic counter would drift every later key. Neutralized in
    # the KEY only — the recorded prompt keeps the real number; every other roster/room detail in
    # the same section still keys (validated by the 0108 unit gates).
    _re.compile(r"you'?ve been here \d+ turns?", _re.IGNORECASE),
)


def _neutralize_volatile(s: str) -> str:
    for rx in _VOLATILE_RES:
        s = rx.sub("<VOLATILE-TIME>", s)
    return s


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
            canon.append(json.dumps(
                {"name": fn.get("name") or t.get("name"), "schema": fn.get("parameters")},
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


def _append_record(rec: Dict[str, Any]) -> None:
    global _seq
    path = fixture_path()
    try:
        with _write_lock:
            rec["seq"] = _seq
            rec["writer"] = _WRITER_ID
            _seq += 1
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "a", encoding="utf-8") as fh:
                fh.write(json.dumps(_scrub(rec), ensure_ascii=False) + "\n")
    except Exception:
        # Recording must never break the live run it is riding — but a silent hole in
        # the fixture WOULD break replay, so make the failure visible in the log.
        import logging
        logging.getLogger(__name__).exception("golden-record: failed to append record")


def record_stream(candidates_model: str, messages: List[Dict],
                  kwargs: Dict[str, Any], chunks: List[str]) -> None:
    """Append one completed streamed call to the fixture (called from the chokepoint's
    ``finally`` with the full ordered chunk list)."""
    from src import llm_trace
    acc = llm_trace.StreamAccumulator()
    for c in chunks:
        acc.observe(c)
    resp = acc.response()
    params = dict(kwargs)
    params["model"] = candidates_model
    _append_record({
        "key": request_key("stream", messages, kwargs.get("tools"), params),
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
        },
    })


def record_call(model: str, messages: List[Dict], params: Dict[str, Any],
                response: Optional[str], error: Optional[str] = None) -> None:
    """Append one completed utility (non-streaming) call to the fixture."""
    params = dict(params)
    params["model"] = model
    _append_record({
        "key": request_key("call", messages, None, params),
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
    os.makedirs(os.path.dirname(path), exist_ok=True)
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
        dump = os.environ.get("ORWELL_GOLDEN_DEBUG_DUMP")
        if dump:
            try:
                with open(dump, "a", encoding="utf-8") as fh:
                    fh.write(json.dumps(_scrub({
                        "kind": kind, "key": key, "digest": digest,
                        "params": _canon_params(params),
                        "messages": _canon_messages(messages),
                    }), ensure_ascii=False) + "\n")
            except Exception:
                pass
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
    r'"soul"', r'"trust"', r'"threat"', r'"affinity"', r'"hidden(?:Target|Agenda)?"',
    r'"grudge"', r'"scheme"', r'"confession(?:al)?"',
)
SECRET_PATTERNS = (r"Bearer\s+[A-Za-z0-9._\-]{8,}", r"\bsk-[A-Za-z0-9._\-]{8,}\b")


def fixture_leak_scan(path: Optional[str] = None) -> List[str]:
    """Scan a serialized fixture for Vault keys / secret material. Returns a list of
    human-readable violations (empty = clean). The 0108 structural test asserts []."""
    import re
    p = path or fixture_path()
    violations: List[str] = []
    if not os.path.isfile(p):
        return [f"fixture missing: {p}"]
    with open(p, "r", encoding="utf-8") as fh:
        for n, line in enumerate(fh, 1):
            for pat in VAULT_KEY_PATTERNS:
                if re.search(pat, line):
                    violations.append(f"line {n}: vault-key pattern {pat}")
            for pat in SECRET_PATTERNS:
                if re.search(pat, line):
                    violations.append(f"line {n}: secret-shaped material {pat}")
    return violations
