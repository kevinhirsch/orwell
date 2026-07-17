"""#1599 WI5 — the no-silent-fail-soft CI lint.

Owner ruling (2026-07-14, issue #1599): NOTHING fails softly unless it is on the explicit
owner allowlist (`frontend/failsoft_allowlist.yaml`, WI6). Every genuine failure (an exception /
non-2xx / a guard that couldn't run / a refused write) must show RED on /admin/status
(INCLUDING when auto-corrected) + log at WARN/ERROR + reach a RED-eligible recorder. An
EXPECTED-empty result (no deal, no NPC, an empty optional, a capability probe that legitimately
returns "unavailable") is normal flow, NOT a failure, and is never flagged.

This lint is the structural enforcement (WI5). It is an AST scan of `frontend/src/**` +
`frontend/routes/**` (plus a lighter regex pass over the TS engine `src/**` and the browser
`frontend/static/js/**`) for fail-soft shapes. It FAILS the build on an un-allowlisted swallow of
a real error.

The flag rule — a handler is a HIT when ALL hold —
  (1) it catches a BROAD exception (`Exception` / `BaseException` / bare `except:`);
  (2) the guarded `try` body touches a RISK surface (an LLM / engine / HTTP / write-back /
      generation call — an `await` or a call whose name carries a risk token);
  (3) the handler NEITHER re-raises NOR reaches a RED-eligible recorder — i.e. it SWALLOWS the
      fault, whether SILENTLY or after only LOGGING. Owner ruling #1599 requires a genuine fault
      to LOG **and** reach a RED recorder, so logging alone is NOT compliance (Greptile P1 /
      CodeRabbit on #1689 flagged the earlier logs-exempt / silent-only rule as under-enforcing;
      a RED recorder itself logs, so reaching one satisfies the log-AND-RED contract).
Narrow-benign catches (`except (ValueError, TypeError): ...`), re-raising handlers, handlers that
reach a RED recorder, and broad-but-benign swallows over NO risk surface (a `.get(default)` optional
read, a capability probe, an `int()`/`json.loads()` coercion) are NOT hits.

A HIT PASSES iff:
  (a) its function/class- or glob-anchored `site` is granted in the allowlist; OR
  (b) it carries an inline `# failsoft-ok[: <id>]` (Python) / `/* failsoft-ok */` (JS/TS) pragma.
(Re-raising or reaching a RED recorder removes it from being a hit at all, per rule (3).)

The companion behavioral coverage lives in `test_1599_failsoft.py` (the recorder + rollup + RED
alarms). Roles only — every probe string here is generic, never cast material.
"""
import ast
import fnmatch
import os
import re

import pytest
import yaml

# ── paths ───────────────────────────────────────────────────────────────────────────────────
_HERE = os.path.dirname(os.path.abspath(__file__))
FE_ROOT = os.path.dirname(_HERE)                       # .../frontend
REPO_ROOT = os.path.dirname(FE_ROOT)                   # .../orwell
ALLOWLIST_PATH = os.path.join(FE_ROOT, "failsoft_allowlist.yaml")

# The FE app surface the AST lint enforces (the game build). The inherited-workspace files are
# swept too — they are grandfathered by file in the allowlist, not exempted here.
_PY_ROOTS = (os.path.join(FE_ROOT, "src"), os.path.join(FE_ROOT, "routes"))
# The five A2-wired files: enforced today (NOT grandfathered). A NEW silent swallow of a real
# error on a risk surface in these files must fail this lint.
A2_ENFORCED = (
    "frontend/src/orwell_portraits.py",
    "frontend/src/orwell_gen_competitions.py",
    "frontend/src/orwell_producer_authoring.py",
    "frontend/src/orwell_tagline.py",
    "frontend/src/orwell_fal_image.py",
)

# ── the flag-shape classifier (kept in lockstep with the WI1 scale-audit method) ──────────────
_RED_RECORDERS = ("record_soft_failure", "record_failure", "record_runtime_failure",
                  "record_io", "record_llm_call", "record_overseer",
                  # verified module-local RED wrappers that themselves call a RED recorder (so a
                  # handler reaching one satisfies the log-AND-RED contract without double-recording):
                  "_note_generation_failure")   # orwell_portraits → log_rings.record_soft_failure
_LOG_ATTRS = ("debug", "info", "warning", "warn", "error", "exception", "critical", "log")
# A call/attr in the guarded TRY body whose name carries one of these tokens ⇒ the guarded work
# touches an LLM / engine / HTTP / write-back / generation surface (audit class-A). Deliberately
# broad on the risk side and narrow elsewhere: a false risk-positive only over-flags a swallow
# that then needs a grant/pragma, whereas a benign `.get()`/`int()`/`json.loads()` read carries
# none of these tokens and stays unflagged (expected-empty).
_RISK_TOK = ("llm", "engine", "narrat", "portrait", "image", "generate", "author",
             "resolve_endpoint", "resolve_llm", "resolve_authoring", "completion", "embed",
             "search", "fetch", "request", "record_", "write_fn", "writeback", "write_back",
             "capture", "synth", "zeitgeist", "prewarm", "preseed", "pre_seed", "advance",
             "submit", "make_deal", "competition", "tagline", "fiction", "producer",
             "cast_profile", "deep_profile", "world_snapshot", "image_beat", "post", "client",
             "generation", "reconcile", "backfill", "http", "openrouter", "fal", "seedream",
             "dalle", "diffus")
_PRAGMA_RE = re.compile(r"failsoft-ok")


def _exc_is_broad(handler: ast.ExceptHandler) -> bool:
    t = handler.type
    if t is None:
        return True  # bare `except:`
    names = []

    def collect(n):
        if isinstance(n, ast.Name):
            names.append(n.id)
        elif isinstance(n, ast.Attribute):
            names.append(n.attr)
        elif isinstance(n, ast.Tuple):
            for e in n.elts:
                collect(e)
    collect(t)
    return any(n in ("Exception", "BaseException") for n in names)


def _call_name(node: ast.Call) -> str:
    f = node.func
    if isinstance(f, ast.Attribute):
        return f.attr
    if isinstance(f, ast.Name):
        return f.id
    return ""


def _body_signals(body):
    """Does the handler RE-RAISE or reach a RED-eligible recorder?

    Owner ruling #1599 (2026-07-14): a genuine failure must LOG **and** reach a RED-eligible
    recorder. Logging ALONE is therefore NOT compliance — a broad handler that logs (or warns,
    or prints) and then swallows on a risk surface is exactly the fail-soft the ruling forbids
    (Greptile P1 / CodeRabbit on #1689: the old `logs`-exempts / silent-only rule under-enforced
    this). We drop both the `logs` exemption and the trivial-`silent` requirement: a handler is
    "handled" ONLY when it re-raises (the fault propagates) or reaches a RED recorder (which itself
    logs, so it satisfies the log-AND-RED contract). A log-then-return / log-then-continue is a HIT.
    """
    reraise = recorder = False
    for n in ast.walk(ast.Module(body=list(body), type_ignores=[])):
        if isinstance(n, ast.Raise):
            reraise = True
        if isinstance(n, ast.Call) and _call_name(n) in _RED_RECORDERS:
            recorder = True
    return reraise, recorder


def _try_touches_risk(try_body) -> bool:
    for n in ast.walk(ast.Module(body=list(try_body), type_ignores=[])):
        if isinstance(n, ast.Await):
            return True
        if isinstance(n, ast.Call):
            nm = _call_name(n).lower()
            if any(t in nm for t in _RISK_TOK):
                return True
    return False


def _relpath(path: str) -> str:
    return os.path.relpath(path, REPO_ROOT).replace(os.sep, "/")


def _scan_python(path: str):
    """Yield (relpath, lineno, func, has_pragma) for every FLAG-shaped handler in a python file."""
    src = open(path, encoding="utf-8").read()
    lines = src.splitlines()
    try:
        tree = ast.parse(src)
    except SyntaxError:
        return  # py_compile is the gate for a genuinely-broken file
    rel = _relpath(path)
    stack = []
    hits = []

    class V(ast.NodeVisitor):
        def visit_FunctionDef(self, n):
            stack.append(n.name)
            self.generic_visit(n)
            stack.pop()
        visit_AsyncFunctionDef = visit_FunctionDef

        def visit_Try(self, n):
            risk = _try_touches_risk(n.body)
            for h in n.handlers:
                if not _exc_is_broad(h):
                    continue  # a narrow, benign catch (ValueError/TypeError/…) — never a hit
                if not risk:
                    continue  # no risk surface in the guarded body ⇒ expected-empty, not a hit
                reraise, recorder = _body_signals(h.body)
                if reraise or recorder:
                    continue  # the fault propagates (re-raise) or is RED-recorded ⇒ handled
                # A broad handler over a risk surface that neither re-raises nor reaches a RED
                # recorder is a fail-soft swallow — logged OR silent (logging alone is NOT
                # compliance, owner ruling #1599). It must carry a RED recorder, an allowlist
                # grant, or a `# failsoft-ok` pragma.
                start = h.lineno
                end = getattr(h, "end_lineno", h.lineno) or h.lineno
                span = "\n".join(lines[start - 1:end])
                has_pragma = bool(_PRAGMA_RE.search(span))
                hits.append((rel, h.lineno, stack[-1] if stack else "<module>", has_pragma))
            self.generic_visit(n)

    V().visit(tree)
    yield from hits


def _python_files():
    for root in _PY_ROOTS:
        for dirpath, _dirs, files in os.walk(root):
            for f in files:
                if f.endswith(".py"):
                    yield os.path.join(dirpath, f)


# ── the allowlist ─────────────────────────────────────────────────────────────────────────────
_RECORDS_NONE_CLASSES = ("telemetry", "recorder-self", "optional-probe")


def _load_allowlist():
    with open(ALLOWLIST_PATH, encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}
    return data.get("allow") or []


def _site_matches(site: str, relpath: str, func: str) -> bool:
    if "*" in site:
        return fnmatch.fnmatch(relpath, site)
    if ":" in site:
        f, fn = site.rsplit(":", 1)
        return relpath == f and func == fn
    return relpath == site


def _covered(relpath: str, func: str, allow) -> bool:
    return any(_site_matches(e.get("site", ""), relpath, func) for e in allow)


# ── the gates ──────────────────────────────────────────────────────────────────────────────────

def test_allowlist_is_wellformed():
    """Every grant is a fully-attributed owner decision; `records: none` is reserved for the
    telemetry / recorder-self / optional-probe classes (the only last-resort tier)."""
    allow = _load_allowlist()
    assert allow, "the allowlist must not be empty (it is the ONE registry the lint reads)"
    seen = set()
    for e in allow:
        for k in ("id", "site", "class", "records", "reason", "approved_by", "approved"):
            assert e.get(k), f"allowlist entry missing '{k}': {e!r}"
        assert e["id"] not in seen, f"duplicate allowlist id: {e['id']}"
        seen.add(e["id"])
        assert e["records"] in ("red-eligible", "none"), \
            f"records must be red-eligible|none: {e!r}"
        if e["records"] == "none":
            assert e["class"] in _RECORDS_NONE_CLASSES, (
                f"records:none is reserved for {_RECORDS_NONE_CLASSES} — {e['id']} is "
                f"class '{e['class']}' (a real-error site must be red-eligible)")


def test_no_uncovered_python_failsoft():
    """The gate: no fail-soft-shaped handler swallowing a real error on a risk surface may exist
    without either a RED-eligible recorder, an allowlist grant, or an inline `# failsoft-ok`."""
    allow = _load_allowlist()
    uncovered = []
    for path in _python_files():
        for relpath, lineno, func, has_pragma in _scan_python(path):
            if has_pragma:
                continue
            if _covered(relpath, func, allow):
                continue
            uncovered.append(f"{relpath}:{lineno} ({func})")
    assert not uncovered, (
        "#1599 no-silent-fail-soft: these handlers swallow a real error on a risk surface with no "
        "RED-eligible record, no allowlist grant, and no `# failsoft-ok` pragma:\n  "
        + "\n  ".join(sorted(uncovered))
        + "\n\nFix ONE of: wire the handler to a RED recorder (record_soft_failure / "
          "record_io(ok=False) / enrichment_policy.record_failure), add an inline "
          "`# failsoft-ok: <id>` if it is genuinely expected-empty, or add an owner grant to "
          "frontend/failsoft_allowlist.yaml."
    )


def test_no_uncovered_js_ts_failsoft():
    """The lighter regex pass: an EMPTY `catch {}` / `catch (_) {}` in the browser JS
    (`frontend/static/js/**`) or the TS engine (`src/**`) must be covered by a glob grant or a
    `/* failsoft-ok */` pragma. (Both trees are currently glob-grandfathered — this holds the line
    against a NEW empty catch appearing in a tree that is NOT covered.)"""
    allow = _load_allowlist()
    empty_catch = re.compile(r"catch\s*(?:\([^)]*\))?\s*\{\s*\}")
    trees = [
        (os.path.join(FE_ROOT, "static", "js"), ".js"),
        (os.path.join(REPO_ROOT, "src"), ".ts"),
    ]
    uncovered = []
    for root, ext in trees:
        if not os.path.isdir(root):
            continue
        for dirpath, _d, files in os.walk(root):
            if "node_modules" in dirpath or "__tests__" in dirpath or "/tests" in dirpath:
                continue
            for f in files:
                if not f.endswith(ext) or f.endswith((".test.ts", ".spec.ts")):
                    continue
                p = os.path.join(dirpath, f)
                rel = _relpath(p)
                src = open(p, encoding="utf-8", errors="replace").read()
                for m in empty_catch.finditer(src):
                    # A pragma on the same or previous line exempts this catch.
                    upto = src[:m.start()]
                    line_start = upto.rfind("\n") + 1
                    window = src[max(0, line_start - 200):m.end()]
                    if _PRAGMA_RE.search(window):
                        continue
                    if _covered(rel, "<js>", allow):
                        break  # a whole-tree glob grant covers this file; stop scanning it
                    ln = upto.count("\n") + 1
                    uncovered.append(f"{rel}:{ln}")
    assert not uncovered, (
        "#1599 no-silent-fail-soft (JS/TS): empty catch block(s) with no grant/pragma:\n  "
        + "\n  ".join(sorted(set(uncovered)))
    )


def test_a2_files_are_enforced_not_grandfathered():
    """The five A2-wired files must NOT carry a file-level grandfather grant — they are enforced,
    so a regression (a NEW silent swallow) fails the lint instead of hiding behind a file grant."""
    allow = _load_allowlist()
    for f in A2_ENFORCED:
        offenders = [e["id"] for e in allow if e.get("site") == f]
        assert not offenders, (
            f"{f} is A2-enforced and must not be file-grandfathered (offending grants: "
            f"{offenders}). Wire the real terminal to a RED recorder, or pragma an expected-empty "
            "site — do not grandfather the whole file.")


def test_a2_terminals_reach_a_red_recorder():
    """Guard against a silent removal of the A2 wiring: each A2 driver whose live failure path is a
    genuine fault must still reference the shared RED recorder in its source (portraits' terminal
    generation/persist failure, the gen-comp / producer enrichment terminals, the tagline
    fall-open). fal_image routes its transport failures UP to the portraits terminal, so it is
    covered there (no double-record)."""
    must_record = {
        "src/orwell_portraits.py": "record_soft_failure",
        "src/orwell_gen_competitions.py": "record_soft_failure",
        "src/orwell_producer_authoring.py": "record_soft_failure",
        "src/orwell_tagline.py": "record_soft_failure",
    }
    for rel, needle in must_record.items():
        src = open(os.path.join(FE_ROOT, rel), encoding="utf-8").read()
        assert needle in src, (
            f"{rel} lost its #1599 RED-recorder wiring (expected a `{needle}` call on the terminal "
            "failure path).")
