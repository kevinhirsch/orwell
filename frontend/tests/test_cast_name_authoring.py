"""LLM-generated cast names (the FE half) — the producer also authors a `name`, guarded by
`_is_reasonable_name` (mirrors the engine). A valid name is forwarded on the write-back; a
gibberish/malformed name is dropped so the engine's seeded corpus name (the floor) stands.

The names below are FORMAT-only test fixtures — never canonical cast.
"""
import json

from src import orwell_cast_authoring as A

GIBBERISH = "Nerighrengeinen Herneingenenin"


def test_is_reasonable_name_accepts_ordinary_names():
    assert A._is_reasonable_name("Marcus Webb")
    assert A._is_reasonable_name("Priya Anand")
    assert A._is_reasonable_name("Mary-Kate O'Neil")


def test_is_reasonable_name_rejects_gibberish_and_malformed():
    assert not A._is_reasonable_name(GIBBERISH)
    assert not A._is_reasonable_name("Madonna")        # single token
    assert not A._is_reasonable_name("marcus webb")    # not capitalized
    assert not A._is_reasonable_name("X Y")            # too short / no vowel
    assert not A._is_reasonable_name("Brrtthh Smith")  # 4+ consonant run


def test_parse_keeps_a_valid_name():
    text = json.dumps({
        "name": "Marcus Webb",
        "biography": "A welder from a small steel town who reads people for a living. He came here to win it all.",
    })
    out = A.parse_authored_profile(text, "npc:1")
    assert out is not None
    assert out["name"] == "Marcus Webb"


def test_parse_drops_an_unreasonable_name_but_keeps_the_rest():
    text = json.dumps({
        "name": GIBBERISH,
        "biography": "A welder from a small steel town who reads people for a living. He came here to win it all.",
    })
    out = A.parse_authored_profile(text, "npc:1")
    assert out is not None
    assert "name" not in out          # dropped → the corpus name stands
    assert "biography" in out          # the rest still applies
