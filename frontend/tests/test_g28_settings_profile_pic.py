"""Lane G28 — the profile-picture control in Settings → Account.

The same upload + 3-option AI studio (G26/G27) lives in the user area, so the profile pic
can be changed outside of casting. It reuses the one studio implementation
(`window.OrwellHeadshotStudio.mount`) and the same routes; finalizing updates the avatar.

JS/HTML-as-text source pins (the suite convention); the runtime behaviour is the same studio
the BE route tests + browser smoke already cover.
"""

import os

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(rel):
    with open(os.path.join(FRONTEND, rel), encoding="utf-8") as f:
        return f.read()


def test_account_tab_ships_a_profile_picture_card_with_a_mount():
    html = _read("static/index.html")
    account = html[html.index('data-settings-panel="account"'):html.index('data-settings-panel="', html.index('data-settings-panel="account"') + 10)]
    assert "Profile picture" in account
    assert 'id="settings-headshot"' in account


def test_settings_mounts_the_shared_studio_into_the_account_card():
    js = _read("static/js/settings.js")
    acct = js[js.index("function initAccount"):js.index("function initAccount") + 3000]
    assert "window.OrwellHeadshotStudio.mount" in acct
    assert "el('settings-headshot')" in acct
    # it refreshes the avatar so the circle reflects a change made here
    assert "OrwellAvatar" in acct


def test_studio_is_exposed_as_a_reusable_mount():
    js = _read("static/js/orwellHeadshot.js")
    assert "window.OrwellHeadshotStudio = { mount: buildStudio }" in js
    # the studio body is class-scoped (not id-scoped) so it styles in Settings too
    assert ".ow-headshot-studio" in js
    assert 'body.classList.add("ow-headshot-studio")' in js
    # the same routes back both hosts
    assert "/api/orwell/portrait/studio/generate" in js
    assert "/api/orwell/portrait/studio/finalize" in js
