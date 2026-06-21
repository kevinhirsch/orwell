"""Feature 0068 / ADR 0007 — Admin "Public deployment / Connect to the internet" UI lane.

Source-pinned convention test (mirrors test_g1_health_logs's UI assertions): the System-panel
card exists and is admin-only DOM; it carries the wizard's domain + connector-token inputs (the
token masked); admin.js ships ``initPublicDeployment``, calls the three documented endpoints, and
wires the panel into the init flow the same way the Health & Logs card is wired.

Name-agnostic — "admin"/"user" are ACCOUNT ROLES, never houseguests. This lane only edits
static/index.html + static/js/admin.js; the routes are proved in test_public_deployment_routes.py.
"""

import os
import re


def _read_static(*parts):
    base = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "static")
    with open(os.path.join(base, *parts), encoding="utf-8") as f:
        return f.read()


# ── The card: present, admin-only DOM, in the System panel ────────────────────

def test_public_deployment_card_exists():
    html = _read_static("index.html")
    assert 'id="adm-public-deployment-card"' in html


def test_public_deployment_card_is_admin_only():
    html = _read_static("index.html")
    m = re.search(r'id="adm-public-deployment-card"[^>]*class="([^"]*)"|'
                  r'class="([^"]*)"[^>]*id="adm-public-deployment-card"', html)
    assert m, "the Public deployment card must exist in Settings"
    classes = (m.group(1) or m.group(2) or "")
    assert "admin-only" in classes, "the Public deployment card must be admin-only DOM"


def test_public_deployment_card_lives_in_the_system_panel():
    html = _read_static("index.html")
    system_panel = html.split('data-settings-panel="system"')[1]
    assert 'id="adm-public-deployment-card"' in system_panel
    # exactly one card — nothing duplicated into player chrome
    assert html.count('id="adm-public-deployment-card"') == 1


# ── The wizard inputs: domain + connector token (token masked) ────────────────

def test_card_has_domain_and_token_inputs():
    html = _read_static("index.html")
    assert 'id="adm-pubdep-domains"' in html
    assert 'id="adm-pubdep-token"' in html
    # the Connect / Disconnect controls are present
    assert 'id="adm-pubdep-connect-toggle"' in html
    assert 'id="adm-pubdep-disconnect"' in html


def test_token_input_is_masked():
    html = _read_static("index.html")
    # the connector-token field MUST be a masked password input — never plain text
    m = re.search(r'<input[^>]*id="adm-pubdep-token"[^>]*>', html)
    assert m, "the connector-token input must exist"
    assert 'type="password"' in m.group(0), "the connector token must be type=password (masked)"


def test_no_inline_script_added():
    # CSP forbids inline <script> in the card; the wizard is wired in admin.js, not inline.
    html = _read_static("index.html")
    card = html.split('id="adm-public-deployment-card"')[1].split("admin-danger-card")[0]
    assert "<script" not in card


# ── admin.js: the driver + the three endpoints + the init wiring ──────────────

def test_admin_js_ships_init_public_deployment():
    js = _read_static("js", "admin.js")
    assert "initPublicDeployment" in js
    # hooked into the init flow the same way initHealthLogs is (the System-tab inits list)
    assert "initHealthLogs, initPublicDeployment" in js or re.search(
        r"initPublicDeployment\b", js), "initPublicDeployment must be wired into initAll"


def test_admin_js_calls_the_three_endpoints():
    js = _read_static("js", "admin.js")
    assert "/api/admin/public-deployment-status" in js
    assert "/api/admin/public-deployment/apply" in js
    assert "/api/admin/public-deployment/disconnect" in js


def test_admin_js_polls_ops_status_for_the_action():
    js = _read_static("js", "admin.js")
    # progress for the apply rides the shared ops-status endpoint under the action key
    assert "/api/admin/ops-status" in js
    assert "public-deployment" in js


def test_admin_js_never_renders_the_token_back():
    # the token is write-only: it is read from the input and sent, never assigned back into it
    # from a response. The only assignment to the token input clears it after apply.
    js = _read_static("js", "admin.js")
    assert "tunnelToken" in js  # the apply body carries the token field
    # the only write to the token input's value is the post-apply clear
    assigns = re.findall(r"tokenInput\.value\s*=\s*([^;]+);", js)
    assert assigns, "expected the post-apply token clear"
    for rhs in assigns:
        assert rhs.strip() in ("''", '""'), f"token input may only be cleared, not populated: {rhs}"
