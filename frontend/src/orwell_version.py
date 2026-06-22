"""Front-end build version, derived from the deployed checkout's git history.

The version scheme is PR-number-based: a build's version is the PR number that
shipped it, formatted ``v{X.XX}`` where ``X.XX == PR_NUMBER / 100`` — so PR #355
is ``v3.55``, PR #360 is ``v3.60``, PR #412 is ``v4.12``.

A branch can't know its own *future* PR number, so we derive at startup from the
deployed checkout's git log instead: every squash-/merge-commit subject carries
the PR it closed as a ``#NNNN`` marker (GitHub writes ``... (#NNNN)`` on squash
merges and ``Merge pull request #NNNN ...`` on merge commits). We take the
HIGHEST such number across the history — that is the most recently merged PR, i.e.
the PR this checkout corresponds to (or the one just before this branch's own,
the closest knowable approximation while the branch is still unmerged).

Computed ONCE at import-time use and cached. Git unavailable (a shallow clone
with no history, no ``.git``, ``git`` not on PATH, a tarball deploy) ⇒ a safe
committed fallback so the UI always has something sane to show and never errors.
"""

from __future__ import annotations

import os
import re
import subprocess
from pathlib import Path
from typing import Iterable, List, Optional

# Committed fallback used only when git history is unavailable. Kept as the bare
# numeric string the API/templates render with a "v" prefix, matching the git
# path's output shape. Only matters on a history-less deploy.
FALLBACK_VERSION = "0.00"

# Repo root = two levels up from this file (frontend/src/orwell_version.py ->
# frontend/ -> repo root). The .git dir lives at the repo root, not in frontend/.
_REPO_ROOT = Path(__file__).resolve().parent.parent.parent

# Matches any PR reference in a commit subject: the squash form "(#1234)" and the
# merge-commit form "Merge pull request #1234" both contain "#1234", so a single
# "#<digits>" scan catches every shape GitHub produces. Bounded digit count keeps
# a stray giant "#123456789" issue-ref from poisoning the max.
_PR_REF = re.compile(r"#(\d{1,6})\b")

# Module-level cache — computed once, reused for the process lifetime.
_cached_version: Optional[str] = None
_cached_display: Optional[str] = None


def highest_pr_number(log_lines: Iterable[str]) -> Optional[int]:
    """Return the highest ``#NNNN`` PR number found across the given log subjects.

    Pure (no I/O) so the parsing is unit-testable against fixed sample lines.
    Returns ``None`` when no line carries a PR reference.
    """
    best: Optional[int] = None
    for line in log_lines:
        for m in _PR_REF.finditer(line or ""):
            n = int(m.group(1))
            if best is None or n > best:
                best = n
    return best


def format_version(pr_number: Optional[int]) -> str:
    """Render a PR number as the bare ``X.XX`` version string (no leading 'v').

    ``None`` (or a non-positive number) ⇒ the committed fallback.
    """
    if pr_number is None or pr_number <= 0:
        return FALLBACK_VERSION
    return f"{pr_number / 100:.2f}"


def _git_log_subjects(root: Path) -> List[str]:
    """Commit subjects from the checkout at ``root`` (empty list on any failure).

    The FULL log is scanned (merge commits included) because this repo ships
    with BOTH shapes: squash merges write ``... (#N)`` and merge commits write
    ``Merge pull request #N``. Taking the max across every subject yields the
    genuinely latest merged PR — which is what the build's version should track.
    """
    try:
        out = subprocess.run(
            ["git", "-C", str(root), "log", "--pretty=%s", "-n", "4000"],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
        return [ln for ln in out.stdout.splitlines() if ln.strip()]
    except Exception:
        return []


def _short_sha(root: Path) -> str:
    """The short HEAD commit SHA at ``root`` ("" on any failure)."""
    try:
        out = subprocess.run(
            ["git", "-C", str(root), "rev-parse", "--short", "HEAD"],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
        return out.stdout.strip() if out.returncode == 0 else ""
    except Exception:
        return ""


def _compute_version(root: Path = _REPO_ROOT) -> str:
    """Derive the bare version string from git, falling back when unavailable."""
    # Explicit override wins (a deploy whose build system knows the number).
    override = os.environ.get("ORWELL_FE_VERSION")
    if override:
        return override.strip().lstrip("v") or FALLBACK_VERSION
    pr = highest_pr_number(_git_log_subjects(root))
    return format_version(pr)


def _compute_display(root: Path = _REPO_ROOT) -> str:
    """Derive the fully-formatted build label the UI renders verbatim.

    PR-derived ⇒ ``v{X.XX}``. When NO PR number is derivable — a shallow clone
    (the deploy fetches ``--depth 1``), an unmerged feature branch whose tip
    carries no ``#NNN`` marker, or a tarball — fall back to ``build {short-sha}``,
    a real debuggable identifier, rather than the meaningless ``v0.00``. Only when
    git is entirely unavailable (no ``.git`` / no ``git`` on PATH) does it land on
    ``v{FALLBACK_VERSION}``.
    """
    override = os.environ.get("ORWELL_FE_VERSION")
    if override:
        v = override.strip().lstrip("v")
        return f"v{v}" if v else f"v{FALLBACK_VERSION}"
    pr = highest_pr_number(_git_log_subjects(root))
    if pr and pr > 0:
        return f"v{format_version(pr)}"
    sha = _short_sha(root)
    if sha:
        return f"build {sha}"
    return f"v{FALLBACK_VERSION}"


def get_version() -> str:
    """The bare ``X.XX`` build version (cached). Backward-compatible ``version``
    field; the UI prefers ``get_display_version()`` for what it actually shows."""
    global _cached_version
    if _cached_version is None:
        _cached_version = _compute_version()
    return _cached_version


def get_display_version() -> str:
    """The fully-formatted build label the UI shows verbatim (cached): ``v{X.XX}``
    when PR-derived, else ``build {short-sha}``, else ``v{FALLBACK_VERSION}``."""
    global _cached_display
    if _cached_display is None:
        _cached_display = _compute_display()
    return _cached_display
