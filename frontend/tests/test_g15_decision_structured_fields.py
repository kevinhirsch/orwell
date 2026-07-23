"""G15 — FE decision-card renders PendingDecisionView evictee/finalist/offer.

Source-pinned structural tests: verify the renderer reads the structured
fields and the wire contract is unchanged via buildPayload byte parity.
"""
import json
import os
import re
import shutil
import subprocess
import tempfile

import pytest

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*rel):
    with open(os.path.join(FRONTEND, *rel), encoding="utf-8") as f:
        return f.read()


def DECISION_JS():
    return _read("static", "js", "orwellDecision.js")


# ── source-level assertions ──────────────────────────────────────────────────────

def test_file_contains_evictee_reference():
    assert ".evictee" in DECISION_JS()


def test_file_contains_finalist_reference():
    assert ".finalist" in DECISION_JS()


def test_file_contains_offer_reference():
    assert ".offer" in DECISION_JS()


def test_goodbye_block_references_pending_evictee():
    """The goodbye-message render block references pending.evictee."""
    assert "pending.evictee && pending.evictee.name" in DECISION_JS()


def test_juror_question_block_references_pending_finalist():
    """The juror-question render block references pending.finalist."""
    assert "pending.finalist && pending.finalist.name" in DECISION_JS()


def test_deal_offer_block_references_pending_offer():
    """The deal-offer render block references pending.offer."""
    assert "pending.offer && pending.offer.from && pending.offer.from.name" in DECISION_JS()


def test_css_contains_odec_structured_selector():
    js = DECISION_JS()
    assert ".odec-structured" in js


def test_deal_offer_renders_options_via_add_chip():
    """The deal-offer renders accept/decline chips via addChip."""
    js = DECISION_JS()
    # Find the deal-offer block — starts with the kind check and ends before the
    # generic else. Use a marker unique to the deal-offer block: the addChip call
    # after the structured offer rendering.
    m = re.search(
        r'kind === "deal-offer"'
        r'.+?'
        r'\(pending\.options \|\| \[\]\)\.forEach\(\(o\) => addChip\(o\.name',
        js, re.S
    )
    assert m, "deal-offer block with addChip not found"


# ── the C20 byte-parity fixture: the REAL buildPayload, unreimplemented ──────────

def _extract_single_pick_field():
    js = DECISION_JS()
    start = js.index("const SINGLE_PICK_FIELD = {")
    end = js.index("\n  };\n", start) + len("\n  };")
    return js[start:end]


def _extract_build_payload():
    js = DECISION_JS()
    start = js.index("function buildPayload(kind, sel, freeText, useVeto) {")
    end = js.index("\n  }\n", start) + len("\n  }")
    return js[start:end]


def _run_build_payload(kind, sel, free_text=None, use_veto=None):
    if shutil.which("node") is None:
        pytest.skip("node not available")
    harness = (
        f"{_extract_single_pick_field()}\n"
        f"{_extract_build_payload()}\n"
        f"console.log(JSON.stringify(buildPayload("
        f"{json.dumps(kind)}, {json.dumps(sel)}, {json.dumps(free_text)}, {json.dumps(use_veto)}"
        f")));\n"
    )
    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False) as f:
        f.write(harness)
        path = f.name
    try:
        res = subprocess.run(["node", path], capture_output=True, text=True, timeout=20)
    finally:
        os.unlink(path)
    assert res.returncode == 0, res.stderr
    out = res.stdout.strip().splitlines()[-1]
    return json.loads(out) if out != "undefined" else None


FIXTURE = [
    (
        "deal-offer",
        ["accept"],
        None,
        None,
        {"kind": "deal-offer", "vote": "accept"},
    ),
]


@pytest.mark.parametrize("kind,sel,free_text,use_veto,expected", FIXTURE)
def test_build_payload_deal_offer_contract_unchanged(
    kind, sel, free_text, use_veto, expected
):
    """The deal-offer wire contract is unchanged — accept/decline rides `vote`."""
    assert _run_build_payload(kind, sel, free_text, use_veto) == expected
