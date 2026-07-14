# Golden-path fixtures (0108)

This directory holds the committed **real-model transcript fixture(s)** for the golden-path
replay gate — one JSONL file per recorded run, keying every FE→model request (stable hash of
messages + tool schemas + shape-affecting params) to the recorded response bytes.

- `golden_path_glm-4.7.jsonl` — THE canonical fixture (owner's two-tier topology, 2026-07-07:
  narration `z-ai/glm-4.7`, utility `qwen/qwen3.6-flash`): one real run across casting →
  premiere → Week 1 HOH → nominations → veto → eviction → week roll. **Until it is recorded and
  committed, the `golden-path` CI job is dormant** (it says so with an explicit notice — never a
  silent pass). The gate is model-agnostic — the replay driver picks up whatever single
  `golden_path_*.jsonl` is committed.

Fixture format (2): line 1 is a `kind: meta` self-description — the declared
narration/utility models (replay pins these; no derivation guesswork) — and every record
carries a per-process `writer` stamp. `fixture_integrity_scan` (enforced at record time AND in
the PR replay gate) fails a fixture with more than one record-writer or any record whose model
is off the declared set: both are the signature of the mid-run resolution flip that silently
contaminated the first GLM recording (stale shared-`data/` state re-binding the walk to an old
session's endpoint pin).

Record / regenerate (needs a live narrator key; ~one season-week of real-model calls):

    cd frontend && OPENROUTER_API_KEY=sk-… ORWELL_GOLDEN_RECORD=1 \
        python3 scripts/golden_path_record.py

Replay locally exactly as CI does (key-free, deterministic, twice):

    cd frontend && python3 scripts/golden_path_replay.py --runs 2

Constraints (enforced by `src/golden_path.py:fixture_leak_scan` + `tests/test_0108_golden_path.py`):
the fixture is **Vault-free by construction** (only the FE's Vault-free request projections + the
model's reply), secrets-scrubbed (no bearer/api-key shapes), and its *content* is **format only** —
assertions key on roles/structure, never generated names. Do not hand-edit records; a drifted
prompt is supposed to MISS loudly and be re-recorded, and a record is never clipped (the #1007
truncation signature is an empty body beside a reasoning burst — clipping would hide it).

Design note: `docs/features/0108-real-model-golden-path-gate.md` · runbook:
`frontend/INTEGRATION.md` §golden-path · nightly re-record: `.github/workflows/golden-nightly.yml`.
