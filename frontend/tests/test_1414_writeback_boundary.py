"""Issue #1414 — the GENERIC FE-driven write-back boundary gate.

Several engine tools are FE-driven WRITE-BACKS: the front-end owns a concrete provider
(a utility LLM, ``web_search``, the image API), produces content, and writes it BACK so
the ENGINE stays the source of truth (``recordCastProfile``, ``preSeedCast``,
``preSeedNextSeason``, ``recordWorldSnapshot``, ``recordImageBeat`` …). Adding one is the
CLAUDE.md "four-place" change on the engine side —

    src/ports/GameSession.ts  →  src/adapters/engine/GameSessionAdapter.ts
    →  src/surfaces/tools/registry.ts  (PLAYER_TOOLS **and** INFRA_LEVERS)
    →  src/adapters/mcp/McpServer.ts   (requireShape arg-guard + callTool dispatch)

— PLUS the FE call layer: an ``orwell_engine.py`` MCP-call wrapper and a DRIVER that
calls it. If the FE call layer is missing, the write-back is **dead at runtime** and
fails **silently** — the MCP boundary rejects the unknown call and the best-effort,
fail-soft driver swallows it. ``recordCastProfile`` and ``recordWorldSnapshot`` both
shipped exactly this way and no-op'd for a long time (see CLAUDE.md "Wiring an FE-driven
engine write-back").

Today only PER-TOOL boundary tests exist (``tests/unit/castPrewarm.test.ts``,
``tests/unit/worldSnapshotBoundary.test.ts`` …), so a BRAND-NEW write-back can still ship
dead — nothing forces the FE half. This is the generic source-pin. It DERIVES the
write-back set from the engine registry (the ``record*`` / ``preSeed*`` names inside
``INFRA_LEVERS`` in ``src/surfaces/tools/registry.ts``, read as text) and asserts each one
is wired through the FE call layer:

  A. ``frontend/src/orwell_engine.py`` has an MCP-call wrapper — ``_call("<toolName>", …)``
     (the camelCase engine tool name, exactly as the mirror sibling ``recordCastProfile``
     is wired).
  B. some OTHER ``frontend/src/*.py`` module (a driver — ``orwell_cast_authoring.py`` /
     ``orwell_prewarm.py`` / ``orwell_zeitgeist.py`` / ``orwell_gen_competitions.py`` /
     ``orwell_offscreen_texture.py`` / ``orwell_portraits.py`` / … — or
     ``tool_execution.py``) actually CALLS that wrapper: ``<snake_case>(…)``. A caller path
     exists. (We scan every ``frontend/src/*.py`` except ``orwell_engine.py`` itself, so a
     NEW write-back's NEW driver is covered without hard-coding filenames.)

A new write-back that skips the FE wiring therefore trips THIS test until it is either
wired or explicitly parked in ``_FE_EXEMPT`` (below) with a reason — the gate is honest,
not silently skipping.

Style mirrors ``test_1412_mutating_manifest.py`` / ``test_g15_gamechanged.py``: parse the
``.ts`` / ``.py`` as TEXT, stdlib-only, and fail LOUDLY if the parser finds nothing.
"""
import re
from pathlib import Path

FE = Path(__file__).resolve().parents[1]
REPO = FE.parent
REGISTRY = (REPO / "src" / "surfaces" / "tools" / "registry.ts").read_text(encoding="utf-8")
ENGINE = (FE / "src" / "orwell_engine.py").read_text(encoding="utf-8")

# The FE "caller layer": every frontend/src/*.py module EXCEPT orwell_engine.py itself
# (that is where the wrappers are DEFINED — its own docstrings name sibling wrappers, so
# including it would let a wrapper-but-no-real-caller tool false-pass). This is a superset
# of the DoD's "tool_execution.py OR the named drivers": ANY driver counts.
_CALLER_FILES = sorted(p for p in (FE / "src").glob("*.py") if p.name != "orwell_engine.py")
CALLER_CORPUS = "\n".join(p.read_text(encoding="utf-8") for p in _CALLER_FILES)


# ── the ONE honest classification ────────────────────────────────────────────
# A registry write-back that legitimately has NO FE caller YET (engine side wired, FE
# driver not landed / engine-internal). Each entry carries a one-line reason. A tool here
# is NOT silently skipped: ``test_fe_exempt_is_honest`` proves it is (a) still a real
# write-back and (b) genuinely not-yet-wired — so the moment it IS fully wired you MUST
# remove it, and the moment it leaves the registry the exemption is flagged stale.
_FE_EXEMPT = {
    # 0116 phase-2 (model-authored cast genesis). The ENGINE side is fully wired + validated
    # (src/ports/GameSession.ts, src/adapters/mcp/McpServer.ts dispatch, registry PLAYER_TOOLS
    # + INFRA_LEVERS, tests/unit/castGenesisBoundary.test.ts). The FE producer-LLM DRIVER that
    # PROPOSES the 15-NPC skeleton has NOT landed yet; until it does the deterministic
    # cast-genesis floor stands (tests/unit/castGenesisByteNeutral.test.ts). REMOVE this entry
    # the moment the FE genesis driver + its orwell_engine wrapper are wired.
    "recordCastGenesis",
}


# ── derive the write-back set from registry.ts INFRA_LEVERS ───────────────────

def _infra_lever_names() -> set[str]:
    start = REGISTRY.index("const INFRA_LEVERS")
    end = REGISTRY.index("export const PLAYER_AGENT_LEVERS", start)
    block = re.sub(r"//[^\n]*", "", REGISTRY[start:end])  # strip // comments FIRST
    names = set(re.findall(r'"([A-Za-z][A-Za-z0-9]*)"', block))
    assert names, "failed to parse INFRA_LEVERS from registry.ts — parser or file shape changed"
    return names


def _writebacks() -> set[str]:
    """The FE-driven write-backs advertised in INFRA_LEVERS: the record*/preSeed* names."""
    wb = {n for n in _infra_lever_names() if n.startswith("record") or n.startswith("preSeed")}
    assert wb, "found no record*/preSeed* write-backs in INFRA_LEVERS — parser broke"
    # Anchor: the reference already-wired write-back MUST be in the derived set, else the
    # derivation silently under-matched (parser / file-shape drift).
    assert "recordCastProfile" in wb, f"parser missed the anchor recordCastProfile: {sorted(wb)}"
    return wb


def _snake(name: str) -> str:
    return re.sub(r"([A-Z])", r"_\1", name).lower().lstrip("_")


def _has_mcp_wrapper(tool: str) -> bool:
    # Every wrapper is `... await _call("<toolName>", …)` in orwell_engine.py (the camelCase
    # engine tool name), exactly like the mirror sibling recordCastProfile.
    return re.search(rf"""_call\(\s*["']{re.escape(tool)}["']""", ENGINE) is not None


def _has_fe_caller(tool: str) -> bool:
    # A driver invokes the snake_case wrapper: `orwell_engine.record_cast_profile(...)` /
    # `engine.pre_seed_cast(...)`. Match the canonical `<snake>(…)` call in the caller corpus.
    return re.search(rf"{re.escape(_snake(tool))}\s*\(", CALLER_CORPUS) is not None


# ── tests ────────────────────────────────────────────────────────────────────

def test_writeback_set_parses():
    wb = _writebacks()
    # Sanity: the known-live write-backs are all discovered (a loud tripwire on parser drift).
    for expected in ("recordCastProfile", "recordWorldSnapshot", "recordImageBeat",
                     "recordOffscreenSceneTexture", "recordCompetitionFiction",
                     "preSeedCast", "preSeedNextSeason"):
        assert expected in wb, (
            f"expected FE-driven write-back {expected} not derived from registry.ts "
            f"INFRA_LEVERS: {sorted(wb)}"
        )


def test_every_writeback_is_wired_in_the_fe_call_layer():
    """The gate: no registry write-back may be dead-at-runtime for want of FE wiring."""
    dead = []
    for tool in sorted(_writebacks()):
        if tool in _FE_EXEMPT:
            continue
        missing = []
        if not _has_mcp_wrapper(tool):
            missing.append(f'orwell_engine.py `_call("{tool}", …)` wrapper')
        if not _has_fe_caller(tool):
            missing.append(f"a caller (driver / tool_execution.py) that invokes {_snake(tool)}(…)")
        if missing:
            dead.append(f"{tool}  (missing: {' AND '.join(missing)})")
    assert not dead, (
        "FE-driven write-back(s) advertised in registry.ts INFRA_LEVERS but NOT wired in the "
        "FE call layer (orwell_engine.py / caller) — they will be DEAD AT RUNTIME (the "
        "four-place gotcha: the MCP boundary rejects the unknown call and the best-effort "
        "driver swallows it). Wire each end to end (orwell_engine.py MCP-call wrapper + a "
        "driver that calls it), or add it to _FE_EXEMPT with a reason:\n  - "
        + "\n  - ".join(dead)
    )


def test_fe_exempt_is_honest():
    wb = _writebacks()
    # (a) No stale exemption: every exempt name is still a real record*/preSeed* write-back
    #     in the registry (a rename / removal must not leave a dangling exemption).
    stale = sorted(_FE_EXEMPT - wb)
    assert not stale, (
        "_FE_EXEMPT names that are no longer record*/preSeed* write-backs in registry.ts "
        f"INFRA_LEVERS (remove them): {stale}"
    )
    # (b) No needless exemption: an exempt tool must genuinely be NOT-yet-wired. The moment
    #     it is fully FE-wired the exemption is a lie — remove it so the real gate guards it.
    wired_but_exempt = sorted(t for t in _FE_EXEMPT if _has_mcp_wrapper(t) and _has_fe_caller(t))
    assert not wired_but_exempt, (
        "_FE_EXEMPT tool(s) are now fully FE-wired — remove them from _FE_EXEMPT so the "
        f"boundary gate guards them: {wired_but_exempt}"
    )
