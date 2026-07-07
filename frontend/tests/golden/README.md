# Golden-path fixtures (0108)

This directory holds the committed **real-model transcript fixture(s)** for the golden-path
replay gate — one JSONL file per recorded run, keying every FE→model request (stable hash of
messages + tool schemas + shape-affecting params) to the recorded response bytes.

- `golden_path_deepseek_v4_pro.jsonl` — THE canonical fixture: one real run of the deploy-default
  narrator across casting → premiere → Week 1 HOH → nominations → veto → eviction → week roll.
  **Until it is recorded and committed, the `golden-path` CI job is dormant** (it says so with an
  explicit notice — never a silent pass).

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
