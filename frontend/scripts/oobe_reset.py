#!/usr/bin/env python3
"""Front-end store reset to exact OOBE — preserving ONLY the API-key / LLM-provider config.

This is the FE-store half of ``deploy/orwell-oobe-reset.sh`` (the "keep API keys" tier).
It returns the front-end data dir to a first-run state — clearing ALL accounts, chats,
sessions, memory, MCP server configs, uploads, portraits, and every user setting — while
PRESERVING exactly the configuration an operator should never have to re-enter: the
configured LLM/image providers and the keys that decrypt them.

What "API-key / LLM-provider config" means here (and where it lives):

  * ``app.db`` → table ``model_endpoints`` — the admin-configured providers: each row's
    ``base_url``, the (Fernet-encrypted) ``api_key``, model pools, image vs llm type, etc.
    This is the PRIMARY provider config in the modern build (src/endpoint_resolver.py).
  * ``data/settings.json`` → the model/endpoint SELECTION keys are RESET to the OOB defaults
    (issue #860): a reset does NOT carry the previously-selected models — only operational flags
    (image_gen_enabled, image_quality, vision_enabled) survive. After the reset the defaults stand
    (narrator deepseek/deepseek-v4-pro on OpenRouter, portrait gemini-2.5-flash-image), and the
    preserved endpoint(s) + key(s) keep the provider usable (resolution binds the empty default
    endpoint to the first enabled endpoint — the preserved OpenRouter one).
  * ``data/.app_key`` → the Fernet key that decrypts ``model_endpoints.api_key`` (and the
    other EncryptedText columns). Preserving the endpoints WITHOUT this key would leave the
    stored keys permanently undecryptable, so it is preserved as a FILE (see the shell
    script's keep-list) and read here only to validate round-trips.
  * ``data/api_keys.json`` + ``data/.key`` → the legacy ``APIKeyManager`` provider keys.
    Preserved as FILES by the shell script's keep-list (not touched here).

Everything else in ``app.db`` (accounts live in ``data/auth.json``, not the DB; sessions,
chat_messages, memories, mcp_servers, documents, gallery, tasks, crew, …) is DROPPED: this
script rebuilds the SQLite file from scratch carrying ONLY the preserved ``model_endpoints``
rows, so no stray user data can survive a column we forgot to enumerate.

Design notes:
  * Operates on the SQLite file directly via the stdlib ``sqlite3`` — NO SQLAlchemy / ``core``
    import chain — so it runs in the bare deploy/CI env and is trivially unit-testable.
  * Idempotent + safe to re-run: a second run on an already-OOBE store is a clean no-op
    (no endpoints to carry, fresh empty DB) and never raises on a missing file.
  * Paths come from env (``DATA_DIR`` / ``DATABASE_URL``) exactly like the app, so a test
    points it at a temp dir; defaults match the app (``<frontend>/data``).
  * NEVER touches ``data/.env`` (the engine EnvironmentFile) — that file is the shell
    script's concern and lives in the ENGINE config dir, not the FE store.
"""

from __future__ import annotations

import json
import os
import sqlite3
import sys

# Reset semantics (issue #860, owner ruling 2026-06-25): a factory/OOBE reset preserves ONLY the
# API key(s) + the provider endpoint record(s) (the model_endpoints rows, carried separately) — it
# does NOT preserve the SELECTED MODELS. After a reset the model selections revert to the OOB
# defaults (narrator deepseek/deepseek-v4-pro on OpenRouter, portrait gemini-2.5-flash-image), so a
# stale/placeholder pick (e.g. the "sakana/fugu-ultra" the owner was stuck on) can never ride across
# a reset. The provider's API key stays usable because the endpoint record + its encrypted key are
# preserved, and `default_endpoint_id`/`image_endpoint_id` reverting to "" binds resolution to the
# first enabled endpoint (the preserved OpenRouter one) — see DEFAULT_SETTINGS in src/settings.py.
#
# We therefore preserve ONLY operational (non-model-selection) flags. Every model/endpoint SELECTION
# key is deliberately DROPPED so it falls back to its DEFAULT_SETTINGS value on the next load.
PRESERVED_SETTINGS_KEYS = (
    "image_gen_enabled", "image_quality", "vision_enabled",
)

# The model/endpoint SELECTION keys that a reset RESETS to defaults (by NOT preserving them). Listed
# explicitly so the source-pinned test can assert none of them survives a reset.
RESET_TO_DEFAULT_SELECTION_KEYS = (
    "default_endpoint_id", "default_model", "default_model_fallbacks",
    "utility_endpoint_id", "utility_model", "utility_model_fallbacks",
    "research_endpoint_id", "research_model",
    "vision_endpoint_id", "vision_model", "vision_model_fallbacks",
    "image_endpoint_id", "image_model",
)


def _frontend_dir() -> str:
    # <frontend>/  (this file is <frontend>/scripts/oobe_reset.py)
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def data_dir() -> str:
    return os.environ.get("DATA_DIR") or os.path.join(_frontend_dir(), "data")


def db_path() -> str:
    """The SQLite file path, honoring DATABASE_URL exactly as core/database.py does."""
    url = os.environ.get("DATABASE_URL", "")
    if url.startswith("sqlite:///"):
        p = url[len("sqlite:///"):]
        # A relative sqlite URL (./data/app.db) resolves against the FE dir, like the app.
        return p if os.path.isabs(p) else os.path.join(_frontend_dir(), p)
    return os.path.join(data_dir(), "app.db")


def settings_path() -> str:
    return os.path.join(data_dir(), "settings.json")


def _table_columns(conn: sqlite3.Connection, table: str) -> list[str]:
    return [row[1] for row in conn.execute(f"PRAGMA table_info({table})").fetchall()]


def export_model_endpoints(path: str) -> list[dict]:
    """Read every model_endpoints row as a list of column→value dicts.

    Returns [] when the DB or table is absent (a fresh / already-reset store). The rows
    stay EXACTLY as stored — the encrypted ``api_key`` ciphertext is carried verbatim, so
    it still decrypts under the preserved ``.app_key`` after the rebuild (no re-encryption,
    no plaintext ever materialized here)."""
    if not os.path.isfile(path):
        return []
    conn = sqlite3.connect(path)
    try:
        if not conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='model_endpoints'"
        ).fetchone():
            return []
        cols = _table_columns(conn, "model_endpoints")
        out = []
        for row in conn.execute(f"SELECT {', '.join(cols)} FROM model_endpoints").fetchall():
            out.append(dict(zip(cols, row)))
        return out
    finally:
        conn.close()


def export_preserved_settings(path: str) -> dict:
    """Read ONLY the allowlisted OPERATIONAL settings keys from settings.json (global level).

    Per issue #860, the model/endpoint SELECTION keys are deliberately NOT preserved — a reset
    resets the selected models to the OOB defaults (so a stale/placeholder pick can never ride
    across). Only operational flags (image_gen_enabled, image_quality, vision_enabled) survive;
    everything else, including default_model / image_model, reverts to DEFAULT_SETTINGS on load.

    Per-user prefs (data/user_prefs.json) are deliberately NOT preserved — they belong to
    accounts, which the reset removes."""
    try:
        with open(path, "r", encoding="utf-8") as f:
            saved = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return {}
    if not isinstance(saved, dict):
        return {}
    return {k: saved[k] for k in PRESERVED_SETTINGS_KEYS if k in saved}


def rebuild_db_with_endpoints(path: str, rows: list[dict], columns: list[str]) -> None:
    """Recreate the SQLite file from scratch carrying ONLY the model_endpoints rows.

    The old file is removed first so NO other table (sessions, memories, mcp_servers, …)
    can survive — the rebuilt DB has exactly one table with exactly the preserved rows.
    The app's own ``init_db()`` re-creates every other table (and runs migrations) on the
    next boot; we only need the provider config present for the resolver to work pre-login.
    """
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    try:
        os.remove(path)
    except FileNotFoundError:
        pass
    # SQLite side files — remove so a half-written WAL/SHM can't resurrect dropped rows.
    for suffix in ("-wal", "-shm", "-journal"):
        try:
            os.remove(path + suffix)
        except FileNotFoundError:
            pass

    if not rows or not columns:
        # Nothing to carry — leave the file ABSENT so the app's init_db() creates a pristine
        # schema on next boot. (Creating an endpoints-only DB here would make init_db skip the
        # other tables it lazily creates; an absent file is the cleanest OOBE state.)
        return

    conn = sqlite3.connect(path)
    try:
        # A minimal, app-compatible model_endpoints schema. The app's SQLAlchemy
        # create_all + migrations will reconcile/extend it on next boot; we only need the
        # columns we are carrying to round-trip. Use the exported column set verbatim.
        col_defs = ", ".join(f'"{c}" TEXT' for c in columns)
        conn.execute(f'CREATE TABLE model_endpoints ({col_defs})')
        placeholders = ", ".join("?" for _ in columns)
        col_list = ", ".join(f'"{c}"' for c in columns)
        for row in rows:
            conn.execute(
                f'INSERT INTO model_endpoints ({col_list}) VALUES ({placeholders})',
                tuple(row.get(c) for c in columns),
            )
        conn.commit()
    finally:
        conn.close()


def write_preserved_settings(path: str, preserved: dict) -> None:
    """Write a fresh settings.json carrying ONLY the preserved LLM-selection keys.

    The app merges this over DEFAULT_SETTINGS at load, so omitted keys revert to their
    OOBE defaults — exactly the intent. An empty preserved dict writes ``{}`` (a clean,
    all-defaults file), still a valid OOBE state."""
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(preserved, f, indent=2)
    os.replace(tmp, path)


def reset_frontend_store() -> dict:
    """The full FE-store OOBE reset (DB + settings). Returns a small summary dict.

    Preconditions (the shell script's job): services stopped; the file keep-list
    (.app_key, .key, api_keys.json) preserved; everything else under the FE data dir
    already removed. This step rebuilds app.db + settings.json from the in-memory
    exports it takes FIRST — so call it BEFORE the shell scrubs app.db/settings.json,
    OR (the safer order) let it read, then write the fresh versions itself."""
    dbp = db_path()
    setp = settings_path()

    endpoints = export_model_endpoints(dbp)
    columns = list(endpoints[0].keys()) if endpoints else []
    preserved = export_preserved_settings(setp)

    rebuild_db_with_endpoints(dbp, endpoints, columns)
    write_preserved_settings(setp, preserved)

    return {
        "db": dbp,
        "settings": setp,
        "endpoints_preserved": len(endpoints),
        "settings_keys_preserved": sorted(preserved.keys()),
    }


def main(argv: list[str] | None = None) -> int:
    summary = reset_frontend_store()
    print(
        "[oobe-reset] preserved {n} LLM/image endpoint(s) and {k} setting key(s); "
        "rebuilt {db}".format(
            n=summary["endpoints_preserved"],
            k=len(summary["settings_keys_preserved"]),
            db=summary["db"],
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
