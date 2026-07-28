#!/usr/bin/env python3
"""T1-2 — Nightly probe canary: capability probe + one scripted ceremony turn.

Non-blocking, cents-scale, key-gated nightly CI check that exercises a REAL LLM
endpoint through the T0-4 capability probe (~10 calls, measures forced-tool_choice
honoring, JSON conformance, reasoning-channel separation) plus one live game
turn (character creation → advanceGame → resolve a pending ceremony decision).

Purpose: detect provider regressions (phantom capability claims) that the stubbed
CI gates cannot see, at <1% of the decommissioned golden-path fixture cost.

Phantom-claim alarm: fires when the capability probe returns a RED overallTier
(any dimension < 50%) or a YELLOW overallTier (< 90%) across a 7-night observation
window. A transport-level probe failure (all calls failed → 'unknown' tier) also
surfaces as an alarm. The ceremony leg alarms only on a hard failure (engine won't
boot, game won't create, advanceGame hangs, decision won't bind).

Usage:
    cd frontend && OPENROUTER_API_KEY=sk-... python3 scripts/_verify_probe_canary.py

Writes evidence JSON under frontend/data/_probe_canary/.
"""
from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.parse
import urllib.request

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.dirname(FRONTEND)
OUT = os.path.join(FRONTEND, "data", "_probe_canary")
os.makedirs(OUT, exist_ok=True)

# Probe defaults — same endpoint family the live game uses.
DEFAULT_MODEL = "z-ai/glm-4.7"
DEFAULT_BASE_URL = "https://openrouter.ai/api/v1"
SEED = 31103  # deterministic game seed (same as m03-live)


def _free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


def _get(base: str, path: str, timeout: float = 20) -> dict:
    with urllib.request.urlopen(base + path, timeout=timeout) as r:
        return json.loads(r.read() or b"{}")


def _post_json(base: str, path: str, body: dict, timeout: float = 60) -> dict:
    req = urllib.request.Request(
        base + path,
        data=json.dumps(body).encode(),
        method="POST",
        headers={"content-type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read() or b"{}")


def _post_form(base: str, path: str, form: dict, timeout: float = 30) -> dict:
    req = urllib.request.Request(
        base + path,
        data=urllib.parse.urlencode(form).encode(),
        method="POST",
        headers={"content-type": "application/x-www-form-urlencoded"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read() or b"{}")


def _wait_http(url: str, proc: subprocess.Popen | None, what: str, budget: int = 120) -> None:
    for _ in range(budget):
        if proc is not None and proc.poll() is not None:
            raise RuntimeError(f"{what} exited early")
        try:
            urllib.request.urlopen(url, timeout=2)
            return
        except Exception:
            time.sleep(1)
    raise RuntimeError(f"{what} never became ready")


def main() -> int:
    key = os.environ.get("OPENROUTER_API_KEY") or ""
    if not key:
        print("SKIP: OPENROUTER_API_KEY not set — canary is a clean skip.")
        return 0

    model = os.environ.get("CANARY_MODEL", DEFAULT_MODEL)
    base_url = os.environ.get("CANARY_BASE_URL", DEFAULT_BASE_URL)
    all_checks: list[dict] = []
    phantom_alarms: list[str] = []

    def _check(name: str, ok: bool, detail: str) -> None:
        entry = {"check": name, "ok": ok, "detail": detail}
        all_checks.append(entry)
        print(f"  [{'PASS' if ok else 'ALARM'}] {name} — {detail}", flush=True)
        if not ok:
            phantom_alarms.append(name)

    # ═══════════════════════════════════════════════════════════════
    # 1. Capability probe (~10 LLM calls, cents-scale)
    # ═══════════════════════════════════════════════════════════════
    print(f"=== probe: running capability probe against {model} ===", flush=True)
    try:
        # Import the T0-4 probe module from the front-end source.
        sys.path.insert(0, FRONTEND)
        from src.capability_probe import run_capability_probe

        profile = run_capability_probe(base_url, key, model, timeout=12)
        profile_path = os.path.join(OUT, "capability_profile.json")
        with open(profile_path, "w", encoding="utf-8") as f:
            json.dump(profile, f, indent=1)
        print(f"  probe complete: tier={profile.get('overallTier')} "
              f"toolChoiceRate={profile.get('toolChoice', {}).get('honoredRate')} "
              f"jsonRate={profile.get('json', {}).get('conformanceRate')} "
              f"reasoningSeparated={profile.get('reasoning', {}).get('separated')}",
              flush=True)

        # Phantom-claim alarm: RED or YELLOW overallTier means a provider claims
        # capabilities it cannot reliably deliver. 'unknown' (all calls failed
        # transport-level) also counts — no usable signal is an alarm-worthy gap.
        tier = profile.get("overallTier", "unknown")
        if tier == "red":
            _check("probe-overall-tier", False, f"overallTier=RED — provider capability RED")
        elif tier == "yellow":
            _check("probe-overall-tier", False, f"overallTier=YELLOW — provider capability YELLOW (below 90%)")
        elif tier == "unknown":
            _check("probe-signal", False, f"overallTier=unknown — all probe calls failed (transport gap)")
        else:
            _check("probe-overall-tier", True, f"overallTier=GREEN")

    except Exception as e:
        _check("probe-run", False, f"probe raised: {type(e).__name__}: {e}")
        profile = {"error": str(e), "overallTier": "error"}

    # ═══════════════════════════════════════════════════════════════
    # 2. Scripted ceremony turn (boot engine, create character,
    #    advanceGame until a player decision pends, resolve it)
    # ═══════════════════════════════════════════════════════════════
    print(f"=== ceremony: booting engine and driving one turn ===", flush=True)
    engine_port = _free_port()
    engine_data = tempfile.mkdtemp(prefix="probe-canary-engine-")
    engine = subprocess.Popen(
        ["node", os.path.join(REPO, "dist", "main.js")],
        cwd=REPO,
        env=dict(os.environ,
                 ORWELL_DATA_DIR=engine_data,
                 ORWELL_ENGINE_PORT=str(engine_port)),
        stdout=open(os.path.join(OUT, "engine.log"), "w"),
        stderr=subprocess.STDOUT,
    )
    ebase = f"http://127.0.0.1:{engine_port}"

    ceremony_ok = False
    try:
        _wait_http(ebase + "/player/tools", engine, "engine", 60)
        _check("engine-boot", True, f"engine ready on {ebase}")

        # Create a character (deterministic seed).
        r = _post_json(ebase, "/player/call", {
            "name": "createCharacter",
            "args": {"playerName": "Canary", "seed": SEED},
        })
        if "result" not in r:
            _check("create-character", False, f"createCharacter failed: {r}")
        else:
            _check("create-character", True, "character created")

            # Advance until a player decision pends.
            pending = None
            for i in range(120):
                adv = _post_json(ebase, "/player/call", {"name": "advanceGame", "args": {}})
                result = adv.get("result") or {}
                if result.get("pending"):
                    pending = result["pending"]
                    break

            if not pending:
                _check("advance-game", False, "no player decision pended within 120 advances")
            else:
                kind = pending.get("kind", "?")
                _check("advance-game", True, f"pending decision: {kind}")

                # Resolve the pending decision.
                options = pending.get("options") or []
                body: dict = {"kind": kind}
                if kind == "nominations" and len(options) >= 2:
                    body["choice"] = [options[0]["id"], options[1]["id"]]
                elif kind == "veto-decision":
                    body["use"] = False
                elif kind == "comp-intent":
                    body["intent"] = "compete"
                elif kind == "finale-statement":
                    body["statement"] = "canary"
                elif kind == "finale-answer":
                    body["appeal"] = (pending.get("appeals") or ["own-game"])[0]
                elif options:
                    body["vote"] = options[0]["id"]
                    body["replacement"] = options[0]["id"]

                r2 = _post_json(ebase, "/player/call", {
                    "name": "submitDecision",
                    "args": body,
                })
                result2 = r2.get("result") or {}
                if result2.get("pending") and result2["pending"].get("kind") == kind:
                    _check("resolve-decision", False,
                           f"decision did not bind (same kind '{kind}' still pends)")
                else:
                    _check("resolve-decision", True, f"{kind} = bound")
                    ceremony_ok = True

    except Exception as e:
        _check("ceremony-turn", False, f"ceremony leg raised: {type(e).__name__}: {e}")
    finally:
        engine.terminate()
        try:
            engine.wait(timeout=10)
        except Exception:
            engine.kill()

    # ═══════════════════════════════════════════════════════════════
    # 3. Write evidence and report verdict
    # ═══════════════════════════════════════════════════════════════
    now_ts = int(time.time() * 1000)
    evidence = {
        "probedAt": now_ts,
        "model": model,
        "baseUrl": base_url,
        "capabilityProfile": profile,
        "checks": all_checks,
        "phantomAlarms": phantom_alarms,
        "ceremonyComplete": ceremony_ok,
        "alarmCount": len(phantom_alarms),
    }
    ev_path = os.path.join(OUT, "probe_canary_evidence.json")
    with open(ev_path, "w", encoding="utf-8") as f:
        json.dump(evidence, f, indent=1)

    print(f"\n=== DONE: {len(phantom_alarms)} phantom alarms ===", flush=True)
    if phantom_alarms:
        for a in phantom_alarms:
            print(f"  ALARM: {a}", flush=True)
        print(f"::warning title=probe-canary::phantom claim(s) detected — "
              f"{len(phantom_alarms)} alarm(s); evidence in {OUT}", flush=True)
        return 1
    else:
        print("  all checks passed — no phantom claims.", flush=True)
        return 0


if __name__ == "__main__":
    sys.exit(main())
