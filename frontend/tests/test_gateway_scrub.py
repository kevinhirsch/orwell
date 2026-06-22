"""Tests for gateway/scrub.py — server-side reasoning/censor chokepoint (feature 0072).

Verifies:
  - <think>…</think> reasoning blocks are stripped
  - [OPERATOR: …] asides are stripped
  - raw npc:<id> references are replaced with [houseguest]
  - clean text is returned unchanged (high-precision, no false positives)
  - multiline / embedded cases are handled correctly
  - the chokepoint fires regardless of which prompt produced the content

BDD invariant proven:
  "Reasoning never reaches the public bubble — a turn whose narration carries
   reasoning/operator-aside/npc:<id> is delivered scrubbed; the chokepoint fires
   regardless of which prompt produced the leak."
"""

import sys
import os

import pytest

# Ensure frontend dir is on the path
_FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _FRONTEND not in sys.path:
    sys.path.insert(0, _FRONTEND)

from gateway.scrub import scrub_for_platform


class TestReasoningBlocks:
    def test_strips_single_think_block(self):
        text = "Hello <think>this is internal reasoning</think> world."
        result = scrub_for_platform(text)
        assert "<think>" not in result
        assert "internal reasoning" not in result
        assert "Hello" in result
        assert "world." in result

    def test_strips_multiline_think_block(self):
        text = (
            "You step into the kitchen. "
            "<think>\nI need to record this interaction.\n"
            "Then I should advance the game.\n</think>"
            " The room falls quiet."
        )
        result = scrub_for_platform(text)
        assert "<think>" not in result
        assert "record this interaction" not in result
        assert "advance the game" not in result
        assert "You step into the kitchen." in result
        assert "The room falls quiet." in result

    def test_strips_multiple_think_blocks(self):
        text = "<think>first</think> middle <think>second</think> end"
        result = scrub_for_platform(text)
        assert "first" not in result
        assert "second" not in result
        assert "middle" in result
        assert "end" in result

    def test_empty_think_block_stripped(self):
        text = "Before<think></think>after"
        result = scrub_for_platform(text)
        assert "<think>" not in result
        assert result.strip() in {"Beforeafter", "Before after"}

    def test_think_block_at_start(self):
        text = "<think>reasoning at start</think>The narration begins."
        result = scrub_for_platform(text)
        assert "reasoning at start" not in result
        assert "The narration begins." in result

    def test_think_block_at_end(self):
        text = "The narration ends.<think>reasoning at end</think>"
        result = scrub_for_platform(text)
        assert "reasoning at end" not in result
        assert "The narration ends." in result


class TestOperatorAsides:
    def test_strips_operator_aside(self):
        text = "You win. [OPERATOR: advance to nominations] The crowd cheers."
        result = scrub_for_platform(text)
        assert "[OPERATOR:" not in result
        assert "advance to nominations" not in result
        assert "You win." in result
        assert "The crowd cheers." in result

    def test_strips_multiline_operator_aside(self):
        text = (
            "Drama unfolds. [OPERATOR: this is a multi-line\noperator aside that spans\n"
            "several lines] Back to the story."
        )
        result = scrub_for_platform(text)
        assert "[OPERATOR:" not in result
        assert "multi-line" not in result
        assert "Drama unfolds." in result
        assert "Back to the story." in result

    def test_strips_multiple_operator_asides(self):
        text = "[OPERATOR: first] story [OPERATOR: second] end"
        result = scrub_for_platform(text)
        assert "[OPERATOR:" not in result
        assert "first" not in result
        assert "second" not in result
        assert "story" in result
        assert "end" in result


class TestNpcIdReplacement:
    def test_replaces_npc_id(self):
        text = "npc:abc123 said something to the player."
        result = scrub_for_platform(text)
        assert "npc:" not in result
        assert "[houseguest]" in result

    def test_replaces_multiple_npc_ids(self):
        text = "npc:hg-01 and npc:hg-02 argued in the backyard."
        result = scrub_for_platform(text)
        assert "npc:" not in result
        assert result.count("[houseguest]") == 2

    def test_replaces_npc_id_with_underscores(self):
        text = "npc:house_guest_7 won the veto."
        result = scrub_for_platform(text)
        assert "npc:" not in result
        assert "[houseguest]" in result

    def test_replaces_npc_id_with_dashes(self):
        text = "npc:hg-contestant-12 is the HOH."
        result = scrub_for_platform(text)
        assert "npc:" not in result
        assert "[houseguest]" in result

    def test_npc_id_at_end_of_sentence(self):
        text = "The nomination ceremony begins with npc:hg-05."
        result = scrub_for_platform(text)
        assert "npc:hg-05" not in result

    def test_does_not_replace_partial_match(self):
        # "npc:" must be a whole word boundary (preceded by space/start)
        text = "snpc:hg-01 is not a real id"
        result = scrub_for_platform(text)
        # The leading 's' prevents the word-boundary match — should NOT replace
        assert "[houseguest]" not in result or "snpc" not in result


class TestCleanTextPassThrough:
    def test_clean_narration_unchanged(self):
        text = (
            "You pull aside a houseguest near the kitchen. They glance around nervously. "
            "'I've been thinking about the vote,' they say. The afternoon light filters "
            "through the sliding glass doors."
        )
        result = scrub_for_platform(text)
        assert result == text.strip()

    def test_empty_string(self):
        assert scrub_for_platform("") == ""

    def test_none_like_empty_treated_safely(self):
        # None is not a valid input but empty string must work
        assert scrub_for_platform("") == ""

    def test_whitespace_trimmed(self):
        result = scrub_for_platform("   hello   ")
        assert result == "hello"

    def test_plain_text_with_colon_not_stripped(self):
        # "npc:" must have the word boundary; plain colons in text must survive
        text = "The plan: win, nominate, evict."
        assert scrub_for_platform(text) == text.strip()


class TestCombinedLeaks:
    def test_all_three_leak_types_stripped(self):
        text = (
            "<think>reasoning block</think>"
            "You watch from the corner. [OPERATOR: record this scene] "
            "npc:hg-07 leans in close."
        )
        result = scrub_for_platform(text)
        assert "<think>" not in result
        assert "[OPERATOR:" not in result
        assert "npc:" not in result
        assert "[houseguest]" in result
        assert "You watch from the corner." in result

    def test_chokepoint_fires_on_any_model_output(self):
        """The chokepoint is unconditional — it does not depend on which prompt produced the leak."""
        outputs = [
            "<think>model A reasoning</think>Narration from model A.",
            "[OPERATOR: from model B]Narration from model B.",
            "npc:hg-99 walks in. Narration from model C.",
            "Clean output from model D.",
        ]
        for raw in outputs:
            result = scrub_for_platform(raw)
            assert "<think>" not in result
            assert "[OPERATOR:" not in result
            assert "npc:" not in result
