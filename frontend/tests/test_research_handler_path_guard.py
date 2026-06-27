"""Security: the duplicate research handler must contain session_id → path (issue #1094).

`frontend/services/research/research_handler.py` is a duplicate of the live
`frontend/src/research_handler.py` (its header still reads `# src/research_handler.py`)
and is imported by `services/research/service.py`. The live copy guards its
session_id → path join with `_research_json_path` (a regex allowlist plus a
`relative_to` containment check); this duplicate previously lacked it, so a
`session_id` containing "/" or ".." could read/write outside data/deep_research.

These tests prove the ported guard rejects traversal at the helper and at the
`start_research` entry sink, while a normal id still resolves inside the root.

Roles only — the `session_id` values here are adversarial fixtures, not data.
"""
import importlib

rh = importlib.import_module("services.research.research_handler")

ROOT = rh.RESEARCH_DATA_DIR.resolve()


def test_valid_session_id_resolves_inside_root():
    path = rh._research_json_path("session-abc123")
    assert path is not None
    path.relative_to(ROOT)  # raises if it escaped
    assert path.name == "session-abc123.json"
    assert path.parent == ROOT


def test_dotdot_traversal_is_rejected():
    assert rh._research_json_path("../../etc/passwd") is None


def test_slash_in_id_is_rejected():
    assert rh._research_json_path("nested/evil") is None


def test_absolute_style_id_is_rejected():
    assert rh._research_json_path("/etc/shadow") is None


def test_non_string_and_empty_are_rejected():
    assert rh._research_json_path(None) is None
    assert rh._research_json_path("") is None
    assert rh._research_json_path(123) is None


def test_overlong_id_is_rejected():
    # The allowlist caps the id length to avoid pathological names.
    assert rh._research_json_path("a" * 129) is None


def test_start_research_rejects_traversal_session_id():
    # The entry sink must refuse a malicious id before scheduling any task.
    handler = rh.ResearchHandler()
    try:
        handler.start_research(
            session_id="../../escape",
            query="role: HOH strategy",
            llm_endpoint="http://127.0.0.1:9/v1/chat/completions",
            llm_model="stub-model",
        )
        raised = False
    except ValueError:
        raised = True
    assert raised, "start_research must raise ValueError on a traversal session_id"
