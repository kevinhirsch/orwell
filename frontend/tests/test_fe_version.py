"""Front-end build version derivation (CHANGE 1).

The version shown on the login screen and in Settings is derived from the
deployed checkout's git history: the HIGHEST merged-PR number across the commit
subjects, rendered ``v{PR/100}`` (PR #355 -> v3.55, #360 -> v3.60, #412 -> v4.12).
A branch can't know its own future PR number, so we read the closest knowable
approximation — the highest PR already in the log — at startup and cache it.

These tests pin the pure parsing/formatting against fixed sample git-log lines
(no real git, no I/O) plus the fallback when no PR ref is present.
"""

import importlib

ver = importlib.import_module("src.orwell_version")


# ── parsing: highest_pr_number over sample log subjects ──────────────────────

def test_picks_highest_pr_across_both_marker_shapes():
    # GitHub writes "(#N)" on squash merges and "Merge pull request #N" on merge
    # commits — a single "#N" scan must catch both, and pick the max.
    lines = [
        "feat(fe): expose the descriptor end-to-end (#357)",
        "Merge pull request #360 from kevinhirsch/claude/mvp002-postgres",
        "docs: reconcile drifted status (#359)",
        "fix(engine): shape-guard the descriptor (#355)",
    ]
    assert ver.highest_pr_number(lines) == 360


def test_squash_paren_form_alone():
    lines = ["chore: bump deps (#42)", "feat: a thing (#314)", "fix: b (#305)"]
    assert ver.highest_pr_number(lines) == 314


def test_no_pr_reference_returns_none():
    lines = ["initial commit", "wip", "fixup without a number"]
    assert ver.highest_pr_number(lines) is None


def test_empty_log_returns_none():
    assert ver.highest_pr_number([]) is None


def test_ignores_giant_issue_like_numbers():
    # A 7+ digit "#12345678" (an accidental issue paste) must not poison the max;
    # only bounded PR-sized refs count.
    lines = ["ref #12345678 in body", "feat: real pr (#318)"]
    assert ver.highest_pr_number(lines) == 318


def test_tolerates_blank_and_none_lines():
    lines = ["", None, "feat: x (#7)"]
    assert ver.highest_pr_number(lines) == 7


# ── formatting: PR number -> "X.XX" ──────────────────────────────────────────

def test_format_examples_from_spec():
    assert ver.format_version(355) == "3.55"
    assert ver.format_version(360) == "3.60"
    assert ver.format_version(412) == "4.12"


def test_format_pads_two_decimals():
    assert ver.format_version(300) == "3.00"
    assert ver.format_version(1) == "0.01"
    assert ver.format_version(40) == "0.40"


def test_format_none_or_nonpositive_falls_back():
    assert ver.format_version(None) == ver.FALLBACK_VERSION
    assert ver.format_version(0) == ver.FALLBACK_VERSION
    assert ver.format_version(-5) == ver.FALLBACK_VERSION


# ── display label: PR -> "vX.XX", else short SHA -> "build <sha>", else fallback ──

def test_display_prefers_pr_version(monkeypatch):
    # When the log carries a PR marker, the clean vX.XX label wins (SHA ignored).
    monkeypatch.setattr(ver, "_git_log_subjects", lambda root=None: ["feat: x (#517)"])
    monkeypatch.setattr(ver, "_short_sha", lambda root=None: "deadbee")
    assert ver._compute_display() == "v5.17"


def test_display_falls_back_to_build_sha_when_no_pr(monkeypatch):
    # Shallow clone / unmerged branch: the (1-commit) log has no PR marker, so show the
    # real short SHA as "build <sha>" — never the meaningless v0.00.
    monkeypatch.setattr(ver, "_git_log_subjects", lambda root=None: ["fix(deploy): set bind host"])
    monkeypatch.setattr(ver, "_short_sha", lambda root=None: "2612cb3")
    assert ver._compute_display() == "build 2612cb3"


def test_display_falls_back_to_fallback_when_no_git(monkeypatch):
    # No PR ref AND no SHA (no .git / git not on PATH / tarball) ⇒ the committed fallback,
    # 'v'-prefixed, so the UI still shows something sane and never errors.
    monkeypatch.setattr(ver, "_git_log_subjects", lambda root=None: [])
    monkeypatch.setattr(ver, "_short_sha", lambda root=None: "")
    assert ver._compute_display() == "v" + ver.FALLBACK_VERSION


def test_display_override_env_wins(monkeypatch):
    # ORWELL_FE_VERSION overrides everything (a build system that knows the number),
    # always 'v'-prefixed for display.
    monkeypatch.setenv("ORWELL_FE_VERSION", "v9.99")
    assert ver._compute_display() == "v9.99"
    monkeypatch.setenv("ORWELL_FE_VERSION", "7.07")
    assert ver._compute_display() == "v7.07"


# ── end-to-end shape: derived against THIS repo's real history ───────────────

def test_get_version_is_a_dotted_pair_and_display_has_v():
    v = ver.get_version()
    # X.XX shape (two-decimal). The repo has merged PRs, so the git path resolves.
    parts = v.split(".")
    assert len(parts) == 2 and parts[0].isdigit() and len(parts[1]) == 2
    assert ver.get_display_version() == "v" + v


def test_get_version_is_cached():
    # Second call returns the same cached object — computed once.
    assert ver.get_version() is ver.get_version()


def test_override_env_wins(monkeypatch):
    # An explicit ORWELL_FE_VERSION overrides git derivation (strips a leading v).
    monkeypatch.setenv("ORWELL_FE_VERSION", "v9.99")
    assert ver._compute_version() == "9.99"
    monkeypatch.setenv("ORWELL_FE_VERSION", "7.07")
    assert ver._compute_version() == "7.07"
