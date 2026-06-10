"""Queue C21 (slice) — the memory wall: roster · attrition · self-status badge.

The status HUD showed 4 lines of a 16-person game. This adds the roster a real houseguest
sees on the memory wall — names + status only, all from the engine's already-Vault-free
getGameState().house[] and the public ceremony status. Static source contract (the HUD is
pure JS), like the other HUD tests, plus a Vault-free guard that the roster consumes only
public facets.
"""

import os
import re

STATIC = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "static", "js")


def _panel() -> str:
    with open(os.path.join(STATIC, "orwellStatusPanel.js"), encoding="utf-8") as f:
        return f.read()


def test_roster_is_rendered_from_state():
    src = _panel()
    assert "renderRoster(" in src
    assert "/api/orwell/state" in src          # getGameState — the roster source
    assert 'id="os-roster"' in src


def test_attrition_count_shown():
    src = _panel()
    # active/total derived from house[] + the player; rendered in the roster header
    assert "activeCount" in src and "/\" + total" in src


def test_self_role_badge_from_public_facts_only():
    src = _panel()
    assert "function selfBadge(" in src
    badge = src[src.index("function selfBadge("): src.index("function selfBadge(") + 700]
    # derived by id-comparison against public ceremony facts — HOH / block / veto / seat
    for token in ('"HOH"', '"ON THE BLOCK"', '"VETO"', '"EVICTED"', '"JURY"'):
        assert token in badge, token
    # NEVER a safe/target standing read (0020)
    for forbidden in ("safe", "target", "trust", "threat", "danger"):
        assert forbidden not in badge.lower(), f"self badge must not assert a standing: {forbidden}"


def test_roster_consumes_only_public_facets():
    # Vault-free by construction: the roster touches name / status / id only, never any
    # hidden stat, soul, or relationship field.
    src = _panel()
    body = src[src.index("function renderRoster("): src.index("function renderRoster(") + 1400]
    accessed = set(re.findall(r"\.(\w+)", body))
    # NB: not ".hidden" — that's the DOM property on the badge element, not a game field.
    leaky = {"trust", "affinity", "threat", "stats", "physical", "mental", "social",
             "soul", "emotional", "archetype", "confidence"}
    assert not (accessed & leaky), f"roster reads hidden fields: {accessed & leaky}"


def test_evicted_houseguests_grouped_and_dimmed():
    src = _panel()
    assert "os-out" in src                      # evicted rows dimmed/struck through
    # eviction seat trail or jury seat marker on the way out
    assert '"jury"' in src and "out" in src


def test_roster_fails_open_without_state():
    # /state best-effort: render must guard a null state and still show ceremony rows.
    src = _panel()
    assert "if (!house)" in src
    assert "st._state !== undefined" in src     # roster only renders when state was fetched
