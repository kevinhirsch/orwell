#!/usr/bin/env python3
"""T1-2 — Nightly probe canary: capability probe + one narrated ceremony turn
                     with phantom-claim detection.

Non-blocking, cents-scale, key-gated nightly CI check that exercises a REAL LLM
endpoint through:
  1. T0-4 capability probe (~10 calls, measures forced-tool_choice honoring, JSON
     conformance, reasoning-channel separation) — provider-regression detector.
  2. Scripted ceremony leg: boots the LIVE engine + front-end, registers the
     narrating endpoint, creates a character + session, drives advanceGame until a
     pending ceremony decision, resolves it, then takes ONE narrated turn through
     the FE. The narration is scanned for CLOSED-SET ceremony claims (HOH, noms,
     veto, eviction, tally, expulsion) against the LIVE board via
     `chat_helpers._sentence_has_closed_set_claim`. Each claim is verified against
     the board diff (before vs after the turn). A *phantom claim* = a claim the
     narrator asserts but the board does NOT back.

Purpose: detect NARRATOR regressions (phantom ceremony claims) that the stubbed
CI gates cannot see, at <1% of the decommissioned golden-path fixture cost.

Phantom-claim alarm: fires when the capability probe returns a RED overallTier
(any dimension < 50%) or a YELLOW overallTier (< 90%) across a 7-night observation
window. A transport-level probe failure (all calls failed → 'unknown' tier) also
surfaces as an alarm. The ceremony leg fires individual per-claim alarms when the
narrator asserts a ceremony outcome the board does not confirm, and reports the
total/phantom/rate in the evidence JSON.

Usage:
    cd frontend && OPENROUTER_API_KEY=sk-... python3 scripts/_verify_probe_canary.py

Writes evidence JSON under frontend/data/_probe_canary/.
"""
from __future__ import annotations

import json
import os
import re
import socket
import subprocess
import sys
import tempfile
import time
import urllib.parse
import traceback
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
    # 2. Scripted ceremony turn (boot ENGINE + FE, create character,
    #    advanceGame until a pending decision, resolve it, take ONE
    #    narrated turn, then detect PHANTOM claims against the live
    #    board — the core of the #1783 canary).
    # ═══════════════════════════════════════════════════════════════
    print(f"=== ceremony: booting engine + FE for narrated turn ===", flush=True)
    engine_port = _free_port()
    engine_data = tempfile.mkdtemp(prefix="probe-canary-engine-")
    engine: subprocess.Popen | None = None
    fe: subprocess.Popen | None = None
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
    fe_port = _free_port()
    fe_data_dir = tempfile.mkdtemp(prefix="probe-canary-fe-")
    fe = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "app:app", "--host", "127.0.0.1",
         "--port", str(fe_port)], cwd=FRONTEND,
        env=dict(os.environ, ORWELL_GAME_BUILD="1", AUTH_ENABLED="false",
                 LOCALHOST_BYPASS="true", ORWELL_ENGINE_MCP_URL=ebase,
                 PLAYWRIGHT_BROWSERS_PATH=os.environ.get("PLAYWRIGHT_BROWSERS_PATH",
                                                         "/opt/pw-browsers"),
                 DATABASE_URL="sqlite:///" + os.path.join(fe_data_dir, "app.db")),
        stdout=open(os.path.join(OUT, "fe.log"), "w"), stderr=subprocess.STDOUT)
    fbase = f"http://127.0.0.1:{fe_port}"

    ceremony_ok = False
    ceremony_narration = ""
    before_sig: dict = {}
    after_sig: dict = {}
    total_claims = 0
    phantom_claims = 0
    try:
        _wait_http(ebase + "/player/tools", engine, "engine", 60)
        _check("engine-boot", True, f"engine ready on {ebase}")
        _wait_http(fbase + "/openapi.json", fe, "front-end", 120)
        _check("fe-boot", True, f"front-end ready on {fbase}")

        # Register live OpenRouter endpoint (mirror DR wall pattern).
        ep = _post_form(fbase, "/api/model-endpoints", {
            "name": "probe-canary", "base_url": base_url,
            "api_key": key, "skip_probe": "true",
            "endpoint_kind": "openai"})
        ep_id = ep.get("id", "")
        if not ep_id:
            raise RuntimeError(f"model-endpoint registration failed: {ep}")

        # Write settings.json with default_model + utility_model.
        sfile = os.path.join(FRONTEND, "data", "settings.json")
        cur = {}
        if os.path.exists(sfile):
            with open(sfile, encoding="utf-8") as fh:
                cur = json.load(fh)
        cur.update({"default_model": model, "default_endpoint_id": ep_id,
                    "utility_model": "qwen/qwen3.6-27b"})
        tmp = sfile + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(cur, fh, indent=2)
        os.replace(tmp, sfile)

        # Wait until default-chat picks up the model.
        deadline = time.time() + 15
        while time.time() < deadline:
            try:
                if _get(fbase, "/api/default-chat").get("model") == model:
                    break
            except Exception:
                pass
            time.sleep(1)
        _check("endpoint-registered", True, f"endpoint {ep_id} / model {model} active")

        # Create a character (deterministic seed).
        r = _post_json(ebase, "/player/call", {
            "name": "createCharacter",
            "args": {"playerName": "Canary", "seed": SEED},
        })
        if "result" not in r:
            _check("create-character", False, f"createCharacter failed: {r}")
            raise RuntimeError("createCharacter failed")
        _check("create-character", True, "character created")

        # Create a FE session.
        sess_json = _post_form(fbase, "/api/session", {
            "name": "probe-canary", "model": model,
            "skip_validation": "true", "endpoint_id": ep_id})
        sess = sess_json.get("id")
        if not sess:
            raise RuntimeError(f"session creation failed: {sess_json}")
        _check("create-session", True, f"session {sess}")

        # --- helpers ---
        def _state() -> dict:
            """Capture current board state signature."""
            try:
                return _post_json(ebase, "/player/call", {
                    "name": "getGameState", "args": {}}).get("result") or {}
            except Exception:
                return {}

        def _turn(text: str) -> str:
            """Send a narrated turn through the FE and return settled narration."""
            body = json.dumps({"message": text, "session": sess}).encode()
            req = urllib.request.Request(
                fbase + "/api/chat_stream", data=body,
                method="POST",
                headers={"content-type": "application/json"})
            all_chunks = []
            try:
                with urllib.request.urlopen(req, timeout=120) as r:
                    while True:
                        chunk = r.read(65536)
                        if not chunk:
                            break
                        all_chunks.append(chunk)
            except Exception:
                # Poll for settle if stream timed out.
                settle_deadline = time.time() + 300
                while time.time() < settle_deadline:
                    try:
                        st = _get(fbase, f"/api/chat/stream_status/{sess}", timeout=10)
                        if st.get("state") in ("done", "idle"):
                            break
                    except Exception:
                        pass
                    time.sleep(2)
            return b"".join(all_chunks).decode("utf-8", errors="replace")

        # Advance until a player decision pends.
        pending = None
        for i in range(120):
            adv = _post_json(ebase, "/player/call", {
                "name": "advanceGame", "args": {}})
            result = adv.get("result") or {}
            if result.get("pending"):
                pending = result["pending"]
                break

        if not pending:
            _check("advance-game", False,
                   "no player decision pended within 120 advances")
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

                # Capture BEFORE state (right after the ceremony decision committed).
                before_sig = _state()

                # Take ONE narrated turn through the FE.
                _turn("What's happening? Give me the update.")

                # Read settled narration from history.
                try:
                    hist = _get(fbase, f"/api/history/{sess}", timeout=30)
                    msgs = hist.get("history") or []
                    narration_parts = []
                    for m in msgs:
                        if m.get("role") == "assistant":
                            narration_parts.append(m.get("content", ""))
                    ceremony_narration = "\n".join(narration_parts)
                except Exception as e:
                    _check("narration-read", False,
                           f"reading narration failed: {type(e).__name__}: {e}")

                # Capture AFTER state.
                after_sig = _state()

                ceremony_ok = bool(ceremony_narration.strip())
                if ceremony_ok:
                    _check("narrated-turn", True,
                           f"got {len(ceremony_narration)} chars of narration")

                    # ═══════════════════════════════════════════════════
                    # PHANTOM DETECTION — the core of the #1783 canary
                    # ═══════════════════════════════════════════════════
                    sys.path.insert(0, FRONTEND)  # already done above, but idempotent
                    from routes import chat_helpers as _ch

                    sentences = re.split(r'(?<=[.!?])\s+', ceremony_narration)
                    for sent in sentences:
                        sent = sent.strip()
                        if not sent:
                            continue
                        if not _ch._sentence_has_closed_set_claim(sent):
                            continue
                        total_claims += 1

                        # Build compact signatures from raw board state.
                        bf = before_sig or {}
                        af = after_sig or {}

                        is_phantom = False
                        detail_parts = []

                        # Helper: safely extract field.
                        def _sg(d, *keys):
                            for k in keys:
                                v = d.get(k)
                                if isinstance(v, dict):
                                    d = v
                                elif v is not None:
                                    return v
                            return None

                        # Check each claim type against board diffs.
                        # evicted claim: board's evicted field changed.
                        if _ch._CLAIM_EVICTED_RE.search(sent):
                            bef_ev = _sg(bf, "evicted")
                            aft_ev = _sg(af, "evicted")
                            if bef_ev == aft_ev:
                                is_phantom = True
                                detail_parts.append(
                                    f"evicted claim but board evicted unchanged ({bef_ev})")

                        # new HOH claim: board's hoH/ceremony.hoH changed.
                        if _ch._CLAIM_NEW_HOH_RE.search(sent):
                            bef_hoh = _sg(bf, "hoH") or _sg(bf, "ceremony", "hoH")
                            aft_hoh = _sg(af, "hoH") or _sg(af, "ceremony", "hoH")
                            if bef_hoh == aft_hoh:
                                is_phantom = True
                                detail_parts.append(f"new-HOH claim but board HOH unchanged")

                        # self HOH win: playerIsHoh is True.
                        if _ch._CLAIM_SELF_HOH_WIN_RE.search(sent):
                            if af.get("playerIsHoh") is not True:
                                is_phantom = True
                                detail_parts.append("self-HOH-win claim but playerIsHoh not True")

                        # self veto win: playerHasVeto is True.
                        if _ch._CLAIM_SELF_VETO_WIN_RE.search(sent):
                            if af.get("playerHasVeto") is not True:
                                is_phantom = True
                                detail_parts.append("self-veto-win claim but playerHasVeto not True")

                        # nominated: noms actually contain those names.
                        if _ch._CLAIM_NOMINATED_RE.search(sent):
                            bef_noms = _sg(bf, "ceremony", "nominees") or _sg(bf, "nominees") or []
                            aft_noms = _sg(af, "ceremony", "nominees") or _sg(af, "nominees") or []
                            # If noms didn't change and are empty, the claim is phantom.
                            if not aft_noms:
                                is_phantom = True
                                detail_parts.append("nomination claim but board has no nominees")

                        # veto winner: board's vetoHolder matches.
                        if _ch._CLAIM_VETO_WINNER_RE.search(sent):
                            aft_vh = _sg(af, "vetoHolder")
                            if not aft_vh:
                                is_phantom = True
                                detail_parts.append("veto-winner claim but board has no vetoHolder")

                        # veto use: board vetoUsed changed.
                        if _ch._CLAIM_VETO_USE_RE.search(sent):
                            bef_vu = _sg(bf, "vetoUsed") or _sg(bf, "ceremony", "vetoUsed")
                            aft_vu = _sg(af, "vetoUsed") or _sg(af, "ceremony", "vetoUsed")
                            if bef_vu == aft_vu:
                                is_phantom = True
                                detail_parts.append("veto-use claim but board vetoUsed unchanged")

                        # tally/majority: board has evidence the vote was counted.
                        if _ch._CLAIM_TALLY_RE.search(sent):
                            aft_ev_done = _sg(af, "ceremony", "evictionDone")
                            if not aft_ev_done:
                                is_phantom = True
                                detail_parts.append("tally claim but ceremony.evictionDone not set")

                        # evict result: evicted field changed vs before.
                        if _ch._CLAIM_EVICT_RESULT_RE.search(sent):
                            bef_ev = _sg(bf, "evicted")
                            aft_ev = _sg(af, "evicted")
                            if bef_ev == aft_ev:
                                is_phantom = True
                                detail_parts.append(
                                    f"evict-result claim but board evicted unchanged ({bef_ev})")

                        # player expulsion: verify player still in-game.
                        if _ch._CLAIM_PLAYER_EXPULSION_RE.search(sent):
                            aft_ev = _sg(af, "evicted")
                            # If no one was evicted the expulsion claim is phantom.
                            if not aft_ev:
                                is_phantom = True
                                detail_parts.append("expulsion claim but no eviction recorded")

                        if is_phantom:
                            phantom_claims += 1
                            _check(
                                f"phantom-claim-{total_claims}", False,
                                f"PHANTOM: '{sent[:120]}...' — {'; '.join(detail_parts)}")

                else:
                    _check("narrated-turn", False,
                           "no assistant messages found after narrated turn")

    except Exception as e:
        _check("ceremony-turn", False, f"ceremony leg raised: {type(e).__name__}: {e}")
    finally:
        for proc in (fe, engine):
            if proc is not None:
                proc.terminate()
                try:
                    proc.wait(timeout=10)
                except Exception:
                    proc.kill()

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
        "ceremonyNarration": ceremony_narration,
        "totalClaims": total_claims,
        "phantomClaims": phantom_claims,
        "phantomClaimRate": round(phantom_claims / total_claims, 4) if total_claims > 0 else 0,
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
