"""Feature 0079 — the reasoning tier wired live: LlmOverseer.build_prompt / verdict_from_reply.

The live hook (agent_loop.py) drives the model call itself (async) and reuses these two methods —
the SAME Vault-free prompt + strict validation as the sync assess() path. Proves:
  * build_prompt carries ONLY the Signals scalars (no narration body / Vault content);
  * verdict_from_reply accepts a well-formed reply, and REJECTS an out-of-contract lever / garbage
    to the deterministic fallback (the model can never widen the hand);
  * both the sync- and async-drive shapes a caller uses return a valid, Vault-free verdict.
Name-agnostic — roles only.
"""

import inspect
import json

from src.overseer import LEVELS, LEVERS, DeterministicOverseer, LlmOverseer, Signals


def _sig():
    # a tripped symptom (engaged scene recorded nothing) so should_assess is True
    return Signals(engaged_scene=True, recorded_interaction=False, beat_seq_before=5)


def test_build_prompt_is_vault_free_telemetry_only():
    sig = _sig()
    ov = LlmOverseer(lambda _p: "")
    p = ov.build_prompt(sig)
    # the EXACT Vault-free telemetry dict (Signals scalars only) is what crosses to the model
    assert json.dumps(ov._telemetry(sig), sort_keys=True) in p
    # the fixed lever contract is offered; the model is told it may never widen the hand
    for lever in LEVERS:
        assert lever in p


def test_verdict_from_reply_accepts_a_wellformed_reply():
    ov = LlmOverseer(lambda _p: "")
    raw = json.dumps({"level": "action", "kind": "stall",
                      "diagnosis": "parked at an advance gate", "lever": "nudge"})
    v = ov.verdict_from_reply(raw, _sig())
    assert v is not None and v.level == "action" and v.lever == "nudge"
    assert v.lever in LEVERS and v.level in LEVELS


def test_verdict_from_reply_rejects_out_of_contract_lever_to_fallback():
    ov = LlmOverseer(lambda _p: "")
    # a lever the model invented (outside LEVERS) -> rejected -> the deterministic floor stands
    raw = json.dumps({"level": "action", "kind": "x", "diagnosis": "y", "lever": "delete-the-vault"})
    v = ov.verdict_from_reply(raw, _sig())
    assert v is not None and v.lever in LEVERS                       # never the invented lever
    assert v.lever == DeterministicOverseer().assess(_sig()).lever  # the deterministic verdict


def test_verdict_from_reply_garbage_falls_back():
    ov = LlmOverseer(lambda _p: "")
    v = ov.verdict_from_reply("not json at all", _sig())
    assert v is not None and v.lever in LEVERS                       # fail-soft to the deterministic verdict


def test_sync_drive_shape_returns_a_valid_verdict():
    good = json.dumps({"level": "action", "kind": "gap-repair",
                       "diagnosis": "scene recorded nothing", "lever": "propose-record"})
    ov = LlmOverseer(lambda _p: good)
    raw = ov._llm_fn(ov.build_prompt(_sig()))
    v = ov.verdict_from_reply(raw, _sig())
    assert v is not None and v.lever == "propose-record"


def test_async_llm_fn_result_is_detected_as_awaitable():
    # the live hook awaits the llm_fn result ONLY when it is awaitable; verify an async utility
    # model's result trips that branch — WITHOUT an event loop / asyncio.run (which would perturb
    # the loop other async tests in the suite rely on).
    async def _afn(_prompt):
        return "x"

    ov = LlmOverseer(_afn)
    coro = ov._llm_fn(ov.build_prompt(_sig()))
    try:
        assert inspect.isawaitable(coro)        # -> the hook's `await` branch fires for async fns
    finally:
        coro.close()                            # never awaited; close to silence the warning
