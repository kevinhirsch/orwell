"""ADR 0010 / feature 0069 (slice B) — the token-policy resolver.

Pins the settings-backed call-class -> token-policy map: each class resolves its
owner-ratified reasoning effort + output cap; an admin override (read from a
settings dict passed in) beats the default; malformed input never raises; and no
class is ever reasoning-by-omission (every result carries an explicit decision).

Roles-only by construction — there are no game entities here, only call classes.
The module under test is **pure** (imports nothing), so it loads in a bare env.
"""

import importlib.util
import os

# Load src/token_policy.py directly so the test never depends on the heavy
# `core`/`src` package import path (the module itself imports nothing).
_FRONTEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_MODULE_PATH = os.path.join(_FRONTEND_DIR, "src", "token_policy.py")
_spec = importlib.util.spec_from_file_location("orwell_token_policy_under_test", _MODULE_PATH)
token_policy = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(token_policy)

resolve_token_policy = token_policy.resolve_token_policy
valid_efforts = token_policy.valid_efforts
max_tokens_bounds = token_policy.max_tokens_bounds
CALL_CLASSES = token_policy.CALL_CLASSES


# --- 1. Each class resolves its ratified default effort + default max_tokens ---

def test_narration_defaults_medium_effort():
    pol = resolve_token_policy("narration")
    assert pol["reasoning"] == {"effort": "medium"}
    # max_tokens is None (NOT a flat 4096) by default ⇒ "use the model-aware cap" at the call site.
    # A flat 4096 truncated reasoning-model narration mid-reply (#835/#620 NARR-5); the call site
    # (test below) substitutes _model_max_output_tokens(model). An in-band override still wins.
    assert pol["max_tokens"] is None


def test_utility_extraction_defaults():
    pol = resolve_token_policy("utility-extraction")
    assert pol["reasoning"] is None  # off ⇒ reasoning omitted (pure extraction/classification needs none)
    assert pol["max_tokens"] == 1500


def test_casting_defaults_medium_effort():
    pol = resolve_token_policy("casting")
    assert pol["reasoning"] == {"effort": "medium"}
    # Casting also defaults to None ⇒ model-aware cap: the SAME reasoning-truncation applies
    # (casting turns are short, so 4096 rarely bit, but a reasoning model can still overrun).
    assert pol["max_tokens"] is None


def test_background_authoring_defaults_low_effort():
    pol = resolve_token_policy("background-authoring")
    assert pol["reasoning"] == {"effort": "low"}
    assert pol["max_tokens"] == 1200


def test_caching_true_and_context_budget_none_for_all_classes():
    for call_class in CALL_CLASSES:
        pol = resolve_token_policy(call_class)
        assert pol["caching"] is True
        assert pol["context_budget"] is None


# --- 2. Admin override beats the default; "off" -> reasoning omitted (None) ----

def test_off_override_omits_reasoning():
    settings = {"reasoning_budget": {"narration": "off"}}
    pol = resolve_token_policy("narration", settings)
    assert pol["reasoning"] is None
    # The output cap is unaffected by the reasoning override (still the model-aware default ⇒ None).
    assert pol["max_tokens"] is None


def test_high_override_beats_default():
    settings = {"reasoning_budget": {"background-authoring": "high"}}
    pol = resolve_token_policy("background-authoring", settings)
    assert pol["reasoning"] == {"effort": "high"}


def test_override_is_per_class_only():
    # Overriding one class does not affect another.
    settings = {"reasoning_budget": {"utility-extraction": "off"}}
    assert resolve_token_policy("utility-extraction", settings)["reasoning"] is None
    assert resolve_token_policy("narration", settings)["reasoning"] == {"effort": "medium"}


# --- 3. Garbage override -> class default; unknown class -> narration default ---

def test_garbage_effort_override_falls_back_to_class_default():
    for bad in ("ultra", "", "MEDIUM", 7, None, {"effort": "high"}):
        settings = {"reasoning_budget": {"casting": bad}}
        pol = resolve_token_policy("casting", settings)
        # casting default effort is "medium"; default max_tokens is None (model-aware cap)
        assert pol["reasoning"] == {"effort": "medium"}, bad
        assert pol["max_tokens"] is None, bad


def test_unknown_call_class_falls_back_to_narration_without_raising():
    pol = resolve_token_policy("totally-unknown-class")
    assert pol["reasoning"] == {"effort": "medium"}
    assert pol["max_tokens"] is None  # narration default ⇒ model-aware cap at the call site
    assert pol["caching"] is True
    assert pol["context_budget"] is None


def test_unknown_call_class_still_honors_a_matching_override_if_present():
    # An override keyed to the unknown class name is still respected (defensive,
    # but the resolved defaults come from narration).
    settings = {"reasoning_budget": {"totally-unknown-class": "off"}}
    pol = resolve_token_policy("totally-unknown-class", settings)
    assert pol["reasoning"] is None
    assert pol["max_tokens"] is None  # narration default ⇒ model-aware cap


# --- 4. Defensive settings: None / missing key / non-dict -> defaults ---------

def test_settings_none_behaves_as_defaults():
    assert resolve_token_policy("narration", None) == resolve_token_policy("narration")


def test_settings_missing_reasoning_budget_key():
    pol = resolve_token_policy("narration", {"some_other_setting": 1})
    assert pol["reasoning"] == {"effort": "medium"}


def test_settings_not_a_dict_never_raises():
    for bad in ("a string", 42, ["list"], object()):
        pol = resolve_token_policy("narration", bad)  # must not raise
        assert pol["reasoning"] == {"effort": "medium"}
        assert pol["max_tokens"] is None


def test_reasoning_budget_not_a_dict_never_raises():
    for bad in ("nope", 5, ["x"]):
        pol = resolve_token_policy("narration", {"reasoning_budget": bad})
        assert pol["reasoning"] == {"effort": "medium"}


# --- 5. No class is reasoning-by-omission: explicit key + int max_tokens -------

def test_every_class_has_explicit_reasoning_decision_and_max_tokens():
    for call_class in CALL_CLASSES:
        pol = resolve_token_policy(call_class)
        assert "reasoning" in pol
        # The decision is explicit: either an effort map or an explicit None.
        assert pol["reasoning"] is None or isinstance(pol["reasoning"], dict)
        if isinstance(pol["reasoning"], dict):
            assert pol["reasoning"]["effort"] in ("low", "medium", "high")
        # max_tokens is EITHER a positive int (a literal class cap) OR None (use the model-aware
        # cap at the call site). It is never <= 0, and the key is always present.
        assert "max_tokens" in pol
        mt = pol["max_tokens"]
        assert mt is None or (isinstance(mt, int) and not isinstance(mt, bool) and mt > 0)


def test_every_class_explicit_under_off_override_too():
    # Even when the override turns reasoning off, the key is present (== None),
    # never silently absent.
    for call_class in CALL_CLASSES:
        settings = {"reasoning_budget": {call_class: "off"}}
        pol = resolve_token_policy(call_class, settings)
        assert "reasoning" in pol
        assert pol["reasoning"] is None
        mt = pol["max_tokens"]
        assert mt is None or (isinstance(mt, int) and not isinstance(mt, bool) and mt > 0)


# --- helper surface -----------------------------------------------------------

def test_valid_efforts_exposes_the_admin_acceptable_set():
    efforts = valid_efforts()
    assert "off" in efforts
    assert set(efforts) == {"off", "low", "medium", "high"}


# --- 6. ADR 0010 #1: per-class max_tokens is admin-editable at runtime --------

def test_max_tokens_override_beats_default():
    settings = {"max_tokens_budget": {"narration": 8000}}
    pol = resolve_token_policy("narration", settings)
    assert pol["max_tokens"] == 8000
    # the reasoning effort is untouched by a max_tokens override
    assert pol["reasoning"] == {"effort": "medium"}


def test_max_tokens_override_is_per_class_only():
    settings = {"max_tokens_budget": {"casting": 9000}}
    assert resolve_token_policy("casting", settings)["max_tokens"] == 9000
    # narration untouched ⇒ its default (None ⇒ model-aware cap), not the casting override
    assert resolve_token_policy("narration", settings)["max_tokens"] is None


def test_both_overrides_compose():
    settings = {
        "reasoning_budget": {"narration": "high"},
        "max_tokens_budget": {"narration": 12000},
    }
    pol = resolve_token_policy("narration", settings)
    assert pol["reasoning"] == {"effort": "high"}
    assert pol["max_tokens"] == 12000


def test_out_of_band_or_garbage_max_tokens_falls_back_to_class_default():
    lo, hi = max_tokens_bounds()
    for bad in (0, -1, lo - 1, hi + 1, "4096", 4096.0, True, None, [4096]):
        settings = {"max_tokens_budget": {"narration": bad}}
        pol = resolve_token_policy("narration", settings)
        # class default stands (None ⇒ model-aware cap); the bad value is never the cap
        assert pol["max_tokens"] is None, bad
    # a non-reasoning class with a LITERAL default still falls back to that literal
    for bad in (0, -1, "1500"):
        pol = resolve_token_policy("utility-extraction", {"max_tokens_budget": {"utility-extraction": bad}})
        assert pol["max_tokens"] == 1500, bad


def test_in_band_bounds_inclusive():
    lo, hi = max_tokens_bounds()
    assert resolve_token_policy("narration", {"max_tokens_budget": {"narration": lo}})["max_tokens"] == lo
    assert resolve_token_policy("narration", {"max_tokens_budget": {"narration": hi}})["max_tokens"] == hi


def test_max_tokens_budget_not_a_dict_never_raises():
    for bad in ("nope", 5, ["x"], object()):
        pol = resolve_token_policy("narration", {"max_tokens_budget": bad})
        assert pol["max_tokens"] is None  # narration default ⇒ model-aware cap


def test_max_tokens_bounds_shape():
    lo, hi = max_tokens_bounds()
    assert isinstance(lo, int) and isinstance(hi, int) and 0 < lo < hi
