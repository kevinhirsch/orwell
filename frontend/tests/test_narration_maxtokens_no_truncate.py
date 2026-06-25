"""Regression guard for the narration/casting max_tokens TRUNCATION vector.

#572 reintroduced a flat ``max_tokens=4096`` on live-game NARRATION. On a reasoning model
(deepseek-v4-pro counts reasoning + visible tokens against ``max_tokens``) that truncated the
answer mid-reply — the #835 truncation vector / #620 NARR-5 warning. The fix: with NO in-band
admin override, the per-class default ``max_tokens`` is ``None`` (token_policy) and the agent_loop
call site fills it in with the MODEL-AWARE output cap (``llm_core._model_max_output_tokens(model)``),
which is ≫4096 for a reasoning model. An EXPLICIT, in-band ``max_tokens_budget`` override still wins
(ADR 0010 #1) and the ledger's ``appliedMaxTokens`` records whatever is actually applied.

These tests assert the RESOLUTION (token_policy + the agent_loop ``_effective_max_tokens`` rule) —
no live model is needed. Roles-only: there are no game entities here, only call classes/models.
"""

import importlib.util
import os
import re

_FRONTEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _load_token_policy():
    path = os.path.join(_FRONTEND_DIR, "src", "token_policy.py")
    spec = importlib.util.spec_from_file_location("orwell_token_policy_maxtok_test", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _import_model_max_output_tokens():
    import sys
    if _FRONTEND_DIR not in sys.path:
        sys.path.insert(0, _FRONTEND_DIR)
    from src.llm_core import _model_max_output_tokens
    return _model_max_output_tokens


# The EXACT rule agent_loop applies (kept in lockstep with the source-pin below): the policy's
# max_tokens wins ONLY when it is a positive int (an explicit admin override); otherwise the
# call site substitutes the model-aware cap. ``caller_max_tokens`` is the inherited preset default
# that only stands when there is no policy at all (non-game chat).
def _effective_max_tokens(call_class: str, model: str, settings: dict | None,
                          caller_max_tokens: int = 0) -> int:
    token_policy = _load_token_policy()
    model_max = _import_model_max_output_tokens()
    policy = token_policy.resolve_token_policy(call_class, settings)
    eff = caller_max_tokens
    pol_mt = policy.get("max_tokens")
    if isinstance(pol_mt, int) and not isinstance(pol_mt, bool) and pol_mt > 0:
        eff = pol_mt  # explicit, in-band admin override wins
    else:
        eff = model_max(model)  # default case ⇒ model-aware cap
    return eff


_DEEPSEEK = "deepseek/deepseek-v4-pro"


# --- 1. The bug: no override ⇒ NOT a flat 4096, but the model-aware cap (≫4096) ----------------

def test_narration_no_override_uses_model_aware_cap_not_4096():
    eff = _effective_max_tokens("narration", _DEEPSEEK, settings=None)
    assert eff != 4096, "the flat #572 cap (the truncation vector) must be gone"
    assert eff == _import_model_max_output_tokens()(_DEEPSEEK)
    assert eff > 4096, "a reasoning model must get headroom well past the truncating 4096"


def test_casting_no_override_uses_model_aware_cap_not_4096():
    # Casting turns are short so 4096 rarely bit, but the SAME reasoning-truncation applies.
    eff = _effective_max_tokens("casting", _DEEPSEEK, settings=None)
    assert eff != 4096
    assert eff == _import_model_max_output_tokens()(_DEEPSEEK)
    assert eff > 4096


def test_narration_model_aware_cap_is_positive_int_for_every_provider():
    # Anthropic REQUIRES an explicit cap and the OpenAI/OpenRouter paths apply it only when >0,
    # so the resolved value must always be a positive int — never omitted, never None.
    for model in (_DEEPSEEK, "claude-opus-4-8", "claude-3-5-haiku-20241022", "totally-unknown"):
        eff = _effective_max_tokens("narration", model, settings=None)
        assert isinstance(eff, int) and not isinstance(eff, bool) and eff > 0, model


# --- 2. ADR 0010 #1 preserved: an explicit, in-band admin override still WINS ------------------

def test_explicit_admin_override_wins_and_is_what_would_be_recorded():
    settings = {"max_tokens_budget": {"narration": 16000}}
    eff = _effective_max_tokens("narration", _DEEPSEEK, settings=settings)
    assert eff == 16000  # the admin's value, not the model-aware default
    # `appliedMaxTokens` (the ledger field) records exactly `_effective_max_tokens`, so the override
    # is what gets logged — the resolution above IS the recorded value.


def test_explicit_casting_override_wins():
    settings = {"max_tokens_budget": {"casting": 12000}}
    assert _effective_max_tokens("casting", _DEEPSEEK, settings=settings) == 12000


def test_out_of_band_override_falls_back_to_model_aware_default():
    # A fat-fingered override outside the admissible band is rejected ⇒ the default stands, which is
    # now the model-aware cap (NOT 4096, NOT the bad value).
    settings = {"max_tokens_budget": {"narration": 99}}  # below the 256 floor
    eff = _effective_max_tokens("narration", _DEEPSEEK, settings=settings)
    assert eff == _import_model_max_output_tokens()(_DEEPSEEK)
    assert eff != 99 and eff != 4096


# --- 3. Source-pin: agent_loop resolves the default case via the model-aware helper ------------

def test_agent_loop_resolves_model_aware_default_for_the_no_override_case():
    src = open(os.path.join(_FRONTEND_DIR, "src", "agent_loop.py"), encoding="utf-8").read()
    # The no-override branch must call the model-aware helper with the concrete model.
    assert "_model_max_output_tokens(model)" in src, \
        "agent_loop must fill the default max_tokens with the model-aware cap"
    # The flat-4096 narration default must NOT be reintroduced as the effective cap.
    assert not re.search(r"_effective_max_tokens\s*=\s*4096", src), \
        "the flat 4096 narration cap (the #572/#835 truncation vector) must not be back"
