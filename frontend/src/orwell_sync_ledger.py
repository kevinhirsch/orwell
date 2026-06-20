"""Feature 0065 (Part D) — the per-turn LLM↔engine sync/divergence ledger.

The 0065 spine makes the *closed set* (facts, outcomes, bookkeeping) rigorously synced
between the narration LLM and the deterministic engine. Part D is its **observability**
slice: a single, structured, per-turn record of *what the harness did to keep things
synced* — so "I have to debug the harness a lot" stops meaning grepping scattered ad-hoc
``logger.info`` lines.

Each turn produces one entry::

    { turnId, session, beatSeqBefore, beatSeqAfter, toolsCalled, nudgesFired,
      autoBackfills, desyncDetected, staleRejections, idempotencyHits }

Dedup decision vs. PR #406 (REQUIRED by the spec) — SIBLING, not an extension
--------------------------------------------------------------------------------
PR #406 shipped ``src/llm_trace.py`` + the ``log_rings.LLMIO`` ring: a **full LLM I/O
trace** — every model call recorded with the *full request* (system prompt + every
message + tool schemas + sampling params) and the *full response* (assistant text +
reasoning + tool calls + usage). It is:

  * **payload-bearing** (it exists precisely to capture prompt/response *bodies*),
  * **global / not user-scoped** (one ``data/llm-io.jsonl`` archive + one in-memory ring,
    keyed by call, with horizon-days retention + a "Trim now" button), and
  * **per model-call**, not per game turn.

This ledger is deliberately the **inverse**: it is **Vault-free and body-free by
construction** (ids / counts / event NAMES / small booleans only — *never* a message
body, narration, casting answer, or any engine secret), it is **per-``_current_user``
scoped and isolated** (one user can never read another's entries), and it aggregates at
the **turn** grain (counts of nudges / back-fills / stale rejections, the beatSeq
before→after). Folding turn-grain closed-set counters into #406's full-payload,
global, retention-governed archive would either (a) dilute that archive's "everything
in/out of the LLM" purpose, or (b) require re-introducing user scoping and a body-free
discipline that #406 explicitly does not have. So the non-duplicative path is a
**small sibling store** that mirrors the existing per-user FE stores
(``orwell_seasons.py`` / ``orwell_layout.py`` — a bounded JSON map in ``DATA_DIR``,
atomically written, ``_current_user``-keyed) and emits **one structured ``[orwell]``
log line per turn** through the project logger (which the #406 ``log_rings.LIVE`` root
handler already taps for the admin viewer — so the turn line is visible there *without*
this module ever touching #406's payload archive).

Boundaries
----------
  * **Vault-free by construction (hard invariant).** ``record_turn`` coerces every input
    to a small scalar / id / name and drops anything else; no free-form text field is
    ever stored. The closed-set counters carry no game secret.
  * **Bounded.** Per-user retention is a ring (drop oldest beyond the cap).
  * **Per-user isolated.** Entries live under the user's key; ``get_recent`` answers only
    that user's slice.
  * **Logging must never hurt the app.** The recorder swallows its own errors.
"""

from __future__ import annotations

import json
import logging
import threading
import time
from pathlib import Path
from typing import Any, Iterable

from core.atomic_io import atomic_write_json
from src.constants import DATA_DIR

logger = logging.getLogger(__name__)

# A small JSON map {username: [entry, ...]}. Mirrors orwell_seasons / orwell_layout: a
# bounded, human-readable blob in the data dir, atomically written. The factory-reset
# scrub of ``data/`` takes it back to empty.
LEDGER_PATH = Path(DATA_DIR) / "orwell_sync_ledger.json"

_LOCK = threading.Lock()

# Bounded retention: keep at most this many turn entries PER USER (drop oldest).
_MAX_PER_USER = 200

# Defence in depth on the name/id fields a turn may carry. Tool / event names are short
# identifiers; a pathological client can never write a body through them.
_MAX_NAMES = 64
_MAX_NAME_LEN = 80

# The exact field set an entry may hold. NOTHING outside this is ever persisted — the
# Vault-free guarantee is structural, not a matter of careful callers.
_INT_FIELDS = (
    "beatSeqBefore",
    "beatSeqAfter",
    "nudgesFired",
    "autoBackfills",
    "staleRejections",
    "idempotencyHits",
)
_BOOL_FIELDS = ("desyncDetected",)
_ID_FIELDS = ("turnId", "session")  # short identifiers (never a body)
_NAME_LIST_FIELDS = ("toolsCalled",)  # lists of tool/event NAMES only


def _key(user: str | None) -> str:
    # A missing user maps to the same "default" bucket the rest of the relay uses.
    return (user or "default").strip() or "default"


def _load() -> dict:
    try:
        data = json.loads(LEDGER_PATH.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except FileNotFoundError:
        return {}
    except Exception:
        # A corrupt store must never break the game: fall back to "no ledger".
        return {}


# ── coercion (the Vault-free floor) ──────────────────────────────────────────────


def _clean_int(v: Any) -> int:
    try:
        n = int(v)
    except (TypeError, ValueError):
        return 0
    return n if n >= 0 else 0


def _clean_id(v: Any) -> str:
    """A short identifier — coerced to a clipped string (never a body)."""
    if v is None:
        return ""
    try:
        s = str(v)
    except Exception:
        return ""
    return s[:_MAX_NAME_LEN]


def _clean_names(v: Any) -> list[str]:
    """A list of tool/event NAMES — short tokens only, deduped-by-position, bounded.
    A single string is treated as a one-element list; anything unusable ⇒ []."""
    if v is None:
        return []
    if isinstance(v, str):
        items: Iterable[Any] = [v]
    elif isinstance(v, (list, tuple)):
        items = v
    else:
        return []
    out: list[str] = []
    for item in items:
        if len(out) >= _MAX_NAMES:
            break
        try:
            s = str(item).strip()
        except Exception:
            continue
        if s:
            out.append(s[:_MAX_NAME_LEN])
    return out


def _entry(
    *,
    session: Any,
    turn_id: Any,
    beat_seq_before: Any,
    beat_seq_after: Any,
    tools_called: Any,
    nudges_fired: Any,
    auto_backfills: Any,
    desync_detected: Any,
    stale_rejections: Any,
    idempotency_hits: Any,
) -> dict:
    """Build the bounded, Vault-free entry. Every field is coerced to a scalar / id /
    name; there is no path for a free-form body to land in the stored shape."""
    return {
        "ts": int(time.time() * 1000),
        "turnId": _clean_id(turn_id),
        "session": _clean_id(session),
        "beatSeqBefore": _clean_int(beat_seq_before),
        "beatSeqAfter": _clean_int(beat_seq_after),
        "toolsCalled": _clean_names(tools_called),
        "nudgesFired": _clean_int(nudges_fired),
        "autoBackfills": _clean_int(auto_backfills),
        "desyncDetected": bool(desync_detected),
        "staleRejections": _clean_int(stale_rejections),
        "idempotencyHits": _clean_int(idempotency_hits),
    }


# ── public API ───────────────────────────────────────────────────────────────────


def record_turn(
    user: str | None,
    *,
    session: Any = None,
    turn_id: Any = None,
    beat_seq_before: Any = 0,
    beat_seq_after: Any = 0,
    tools_called: Any = None,
    nudges_fired: Any = 0,
    auto_backfills: Any = 0,
    desync_detected: Any = False,
    stale_rejections: Any = 0,
    idempotency_hits: Any = 0,
) -> None:
    """Append one Vault-free per-turn sync record for ``user`` (``_current_user``-scoped),
    bounded by a per-user ring, and emit one structured ``[orwell]`` log line.

    Every argument is coerced to a small scalar / id / tool-name; message bodies,
    narration, casting answers, and any engine secret CANNOT be stored — that is a hard
    invariant, enforced by the coercion in ``_entry`` rather than by careful callers.
    Errors are swallowed: ledgering must never hurt the app."""
    try:
        entry = _entry(
            session=session,
            turn_id=turn_id,
            beat_seq_before=beat_seq_before,
            beat_seq_after=beat_seq_after,
            tools_called=tools_called,
            nudges_fired=nudges_fired,
            auto_backfills=auto_backfills,
            desync_detected=desync_detected,
            stale_rejections=stale_rejections,
            idempotency_hits=idempotency_hits,
        )
        k = _key(user)
        with _LOCK:
            data = _load()
            bucket = data.get(k)
            if not isinstance(bucket, list):
                bucket = []
            bucket.append(entry)
            if len(bucket) > _MAX_PER_USER:
                bucket = bucket[-_MAX_PER_USER:]  # bounded — drop oldest
            data[k] = bucket
            atomic_write_json(str(LEDGER_PATH), data, indent=2)
        _log_line(k, entry)
    except Exception as e:  # pragma: no cover - defence in depth
        try:
            logger.debug("[orwell] sync-ledger record failed: %s", e)
        except Exception:
            pass


def get_recent(user: str | None, limit: int = 50) -> list[dict]:
    """The user's most-recent ledger entries (newest last), capped at ``limit``.
    Strictly per-user: never returns another user's entries. A missing/corrupt store
    answers ``[]``."""
    try:
        n = int(limit)
    except (TypeError, ValueError):
        n = 50
    if n <= 0:
        return []
    with _LOCK:
        bucket = _load().get(_key(user))
    if not isinstance(bucket, list):
        return []
    return [e for e in bucket if isinstance(e, dict)][-n:]


def clear(user: str | None) -> None:
    """Drop the user's ledger (used by a full account/factory reset). Per-user scoped."""
    k = _key(user)
    with _LOCK:
        data = _load()
        if k in data:
            del data[k]
            atomic_write_json(str(LEDGER_PATH), data, indent=2)


def _log_line(user_key: str, entry: dict) -> None:
    """One structured ``[orwell]`` line per turn — picked up by the #406 LIVE root-logger
    ring for the admin viewer. Counts + ids + tool names only (no body)."""
    try:
        tools = ",".join(entry.get("toolsCalled") or []) or "-"
        logger.info(
            "[orwell] sync-ledger turn user=%s session=%s turn=%s beat=%s→%s "
            "tools=[%s] nudges=%s backfills=%s desync=%s stale=%s idem=%s",
            user_key,
            entry.get("session") or "-",
            entry.get("turnId") or "-",
            entry.get("beatSeqBefore"),
            entry.get("beatSeqAfter"),
            tools,
            entry.get("nudgesFired"),
            entry.get("autoBackfills"),
            entry.get("desyncDetected"),
            entry.get("staleRejections"),
            entry.get("idempotencyHits"),
        )
    except Exception:  # pragma: no cover
        pass
