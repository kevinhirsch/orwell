#!/usr/bin/env python3
"""0108 — the golden-path driver core (shared by record + replay).

Boots the REAL engine (node dist/main.js, fresh temp data dir, fixed season seed) and the
REAL front-end (uvicorn, game build), points the FE's model resolution at either a live
narrator endpoint (record) or a dead-end endpoint pinned to the fixture's model id
(replay — the golden seam short-circuits before any network), then walks the golden path
through the REAL chat endpoint exactly as a player would:

    casting interview → finalize/season start → premiere → Week 1 HOH → nominations →
    veto → veto ceremony → eviction (staged reveal) → the week rolls

asserting the eight 0108 invariants (roles/structure/engine truth — NEVER generated
names; the fixture content is format only). Player decisions bind through the sanctioned
``POST /api/orwell/decision`` route with a fixed legal policy (first option / compete /
no-veto), so the walk is deterministic under a fixed seed.

Replay additionally asserts the record/replay contract: zero fixture misses, zero
provider reach, and (``--runs 2``) run-to-run determinism of the driver's own digest.

Design note: docs/features/0108-real-model-golden-path-gate.md.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.parse
import urllib.request

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.dirname(FRONTEND)
sys.path.insert(0, FRONTEND)

# ── the fixed, deterministic walk (roles only — no cast names anywhere) ────────────

SEASON_SEED = 108108

CASTING_SCRIPT = [
    "Hi — I'm Sam Vale, 33, I run a tiny bookshop and I argue about reality TV for fun.",
    "Backstory: grew up the middle of five kids, learned to read a room before I could read. "
    "I'm here because I've watched every season twice and I want to play, not spectate.",
    "My game: loyal to a fault until the numbers say otherwise. Social first, comps when it counts.",
    "Use whatever photo is on file for me — I'm not precious about it.",
    "That's everything. I'm ready — send me into the house.",
]

WEEK_PROMPTS = [
    "I take a lap through the house and see who's holding court where.",
    "I find whoever seems most switched-on and talk a little game with them.",
    "Let's keep the week moving — what does production have for us next?",
    "I check in on how the house is reading the power structure right now.",
    "Time to see this through. What happens next?",
]

# Invariant 7 — the same leak definitions the game-build scrub enforces
# (frontend/static/js/markdown.js) + the golden fixture gate (src/golden_path.py).
RAW_NPC_ID_RE = re.compile(r"\bnpc:\d+\b", re.I)
REASONING_LINE_RE = re.compile(
    r"^\s*(?:let me\b|looking at\b|the game state\b|i need to\b|i should\b|i'm going to\b"
    r"|based on the (?:roster|state)\b|the (?:roster|cast|state) (?:shows|is)\b)", re.I)
THINK_BLOCK_RE = re.compile(r"<think\b.*?</think>", re.S | re.I)


class Invariants:
    """PASS/FAIL/SKIP ledger for the eight golden-path invariants + the replay contract."""

    def __init__(self) -> None:
        self.rows: list[dict] = []

    def record(self, num: str, name: str, ok: bool | None, detail: str = "") -> None:
        status = "SKIP" if ok is None else ("PASS" if ok else "FAIL")
        self.rows.append({"invariant": num, "name": name, "status": status, "detail": detail})
        print(f"  [{status}] {num} {name}" + (f" — {detail}" if detail else ""), flush=True)

    @property
    def failed(self) -> list[dict]:
        return [r for r in self.rows if r["status"] == "FAIL"]


class GoldenDriver:
    def __init__(self, *, mode: str, fixture: str, model: str, utility_model: str = "",
                 provider_url: str = "", provider_key: str = "",
                 engine_port: int = 8971, fe_port: int = 7971,
                 turn_timeout: int = 420, settle: float = 1.0,
                 turn_budget: int = 60, work_dir: str | None = None) -> None:
        assert mode in ("record", "replay")
        self.mode = mode
        self.fixture = os.path.abspath(fixture)
        self.model = model
        # The two-tier production topology (owner, 2026-07-07): narration on the premium
        # narrator, the utility/background call classes on the cheap tier. Empty ⇒ one model
        # for both (the pre-split behavior).
        self.utility_model = utility_model or model
        self.provider_url = provider_url
        self.provider_key = provider_key
        self.engine_port = engine_port
        self.fe_port = fe_port
        self.turn_timeout = turn_timeout
        self.settle = settle
        self.turn_budget = turn_budget
        self.work = work_dir or tempfile.mkdtemp(prefix="golden-path-")
        self.engine = f"http://127.0.0.1:{engine_port}"
        self.fe = f"http://127.0.0.1:{fe_port}"
        self.fe_log = os.path.join(self.work, "fe.log")
        self.engine_log = os.path.join(self.work, "engine.log")
        self.procs: list[subprocess.Popen] = []
        self.inv = Invariants()
        self.timeline: list[dict] = []   # (turn, phase, beatSeq, week) after every step
        self.digest_parts: list[str] = []
        self.session: str = ""

    # ── plumbing ──────────────────────────────────────────────────────────────────

    def _get(self, base: str, path: str, timeout: int = 20):
        with urllib.request.urlopen(base + path, timeout=timeout) as r:
            return json.load(r)

    def _post_json(self, base: str, path: str, body: dict, timeout: int = 60):
        req = urllib.request.Request(
            base + path, data=json.dumps(body).encode(), method="POST",
            headers={"content-type": "application/json"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.load(r)

    def _post_form(self, base: str, path: str, form: dict, timeout: int = 60):
        req = urllib.request.Request(
            base + path, data=urllib.parse.urlencode(form).encode(), method="POST",
            headers={"content-type": "application/x-www-form-urlencoded"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.load(r)

    def _wait(self, url: str, budget: int, proc: subprocess.Popen, what: str) -> None:
        for _ in range(budget):
            if proc.poll() is not None:
                raise RuntimeError(f"{what} exited early — see logs under {self.work}")
            try:
                urllib.request.urlopen(url, timeout=2)
                return
            except Exception:
                time.sleep(1)
        raise RuntimeError(f"{what} never became ready ({url})")

    # ── boot ──────────────────────────────────────────────────────────────────────

    def scrub_stale_state(self) -> None:
        """Pre-flight hygiene against the SHARED frontend data store (the FE has no
        per-run data dir; only the engine gets a fresh one). Runs file-level, before the
        FE boots. The trap that actually fired: ``data/orwell_game_session.json``
        persists the canonical game-session binding ACROSS runs, and at game-start the
        FE re-binds the walk onto the previous run's chat session — whose row pins that
        run's endpoint+model. In the first GLM recording that silently flipped narration
        to a stale stub endpoint mid-run (90 of 251 records contaminated; the #1086 seam
        class, reproduced by the harness). Every scrub target below is driver-owned or
        golden-specific — a developer's own endpoints/sessions are left alone."""
        data = os.path.join(FRONTEND, "data")
        for name in ("orwell_game_session.json", "orwell_layout.json"):
            p = os.path.join(data, name)
            if os.path.exists(p):
                os.remove(p)
                print(f"  scrub: removed stale {name}", flush=True)
        settings_file = os.path.join(data, "settings.json")
        try:
            with open(settings_file, "r", encoding="utf-8") as fh:
                cur = json.load(fh)
            if cur.pop("default_model_fallbacks", None):
                with open(settings_file, "w", encoding="utf-8") as fh:
                    json.dump(cur, fh, indent=2)
                print("  scrub: cleared default_model_fallbacks", flush=True)
        except Exception:
            pass
        db = os.path.join(data, "app.db")
        if os.path.isfile(db):
            import sqlite3
            try:
                con = sqlite3.connect(db, timeout=5)
                try:
                    # NOT name-only: the FE auto-titles sessions after a few turns (a
                    # harness session renamed to e.g. "Casting interview" escaped the
                    # first name-based scrub), so match the harness-owned ENDPOINT
                    # bindings too — the dead-end replay URL and the stub model id.
                    ids = [r[0] for r in con.execute(
                        "select id from sessions where name = 'golden-path' "
                        "or endpoint_url like '%golden-replay-dead-end%' "
                        "or model = 'orwell-stub-narrator'")]
                    if ids:
                        qs = ",".join("?" * len(ids))
                        con.execute(f"delete from chat_messages where session_id in ({qs})", ids)
                        con.execute(f"delete from sessions where id in ({qs})", ids)
                    con.execute("delete from model_endpoints "
                                "where name in ('golden-record', 'golden-replay')")
                    con.commit()
                    if ids:
                        print(f"  scrub: dropped {len(ids)} stale golden session(s)", flush=True)
                finally:
                    con.close()
            except Exception as e:
                print(f"  scrub: app.db cleanup skipped ({e})", flush=True)
        # A crashed previous run's FE/engine still listening would corrupt (a live RECORD
        # env appends to the same fixture path) or block this one. Best-effort clear.
        for port in (self.engine_port, self.fe_port):
            try:
                subprocess.run(["fuser", "-k", f"{port}/tcp"],
                               capture_output=True, timeout=10)
            except Exception:
                pass

    def boot(self) -> None:
        dist = os.path.join(REPO, "dist", "main.js")
        if not os.path.isfile(dist):
            raise RuntimeError("engine bundle missing — run `npm run build` at the repo root first")
        engine_data = os.path.join(self.work, "engine-data")
        os.makedirs(engine_data, exist_ok=True)
        env = dict(os.environ, ORWELL_DATA_DIR=engine_data,
                   ORWELL_ENGINE_PORT=str(self.engine_port))
        self.procs.append(subprocess.Popen(
            ["node", dist], cwd=REPO, env=env,
            stdout=open(self.engine_log, "w"), stderr=subprocess.STDOUT))
        self._wait(f"{self.engine}/player/tools", 60, self.procs[-1], "engine")

        fe_env = dict(os.environ,
                      ORWELL_GAME_BUILD="1", AUTH_ENABLED="false", LOCALHOST_BYPASS="true",
                      ORWELL_ENGINE_MCP_URL=self.engine)
        if self.mode == "record":
            fe_env["ORWELL_GOLDEN_RECORD"] = "1"
            fe_env["ORWELL_GOLDEN_FIXTURE"] = self.fixture
            fe_env.pop("ORWELL_GOLDEN_REPLAY", None)
        else:
            fe_env["ORWELL_GOLDEN_REPLAY"] = self.fixture
            fe_env.pop("ORWELL_GOLDEN_RECORD", None)
            fe_env.pop("ORWELL_GOLDEN_FIXTURE", None)
        py = sys.executable
        self.procs.append(subprocess.Popen(
            [py, "-m", "uvicorn", "app:app", "--host", "127.0.0.1", "--port", str(self.fe_port)],
            cwd=FRONTEND, env=fe_env,
            stdout=open(self.fe_log, "w"), stderr=subprocess.STDOUT))
        self._wait(f"{self.fe}/openapi.json", 120, self.procs[-1], "front-end")

    def configure_model(self) -> None:
        """Point the FE's model resolution at the run's endpoint. Replay pins a DEAD
        endpoint (never dialed — the golden seam short-circuits first) carrying the
        fixture's model id so the request keys match the recording."""
        if self.mode == "record":
            base_url, key = self.provider_url, self.provider_key
        else:
            base_url, key = "http://127.0.0.1:9/golden-replay-dead-end", "golden-replay-no-key"
        ep = self._post_form(self.fe, "/api/model-endpoints", {
            "name": f"golden-{self.mode}", "base_url": base_url, "api_key": key,
            "skip_probe": "true", "endpoint_kind": "auto",
        })
        self.endpoint_id = ep["id"]
        import src.settings as settings_mod  # noqa: PLC0415 — path prepended above
        settings_file = os.path.join(FRONTEND, "data", "settings.json")
        try:
            with open(settings_file, "r", encoding="utf-8") as fh:
                current = json.load(fh)
        except Exception:
            current = {}
        current["default_endpoint_id"] = ep["id"]
        current["default_model"] = self.model
        # Per-class routing (the FE's existing utility_model seam): background/utility call
        # classes resolve the cheap tier; narration stays on the narrator model.
        current["utility_endpoint_id"] = ep["id"]
        current["utility_model"] = self.utility_model
        os.makedirs(os.path.dirname(settings_file), exist_ok=True)
        # ATOMIC write (tmp + rename): this bypasses the FE's save seam, so a plain
        # truncate-then-write could be read mid-write by the app (JSONDecodeError →
        # silent defaults). The rename makes every reader see old-or-new, never torn.
        tmp = f"{settings_file}.golden.{os.getpid()}"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(current, fh, indent=2)
        os.replace(tmp, settings_file)
        # VERIFY past the settings TTL cache: src.settings.load_settings serves a ~2s
        # in-process cache and the direct file write above can't invalidate it, so the
        # first read(s) after the write may legitimately serve PRE-write content (this
        # transiently resolved a foreign model once and killed a paid record run at the
        # guard below). Poll until the cache expires and the golden model resolves;
        # only a STABLE mismatch is a real failure.
        deadline = time.time() + 15
        resolved: dict = {}
        while time.time() < deadline:
            resolved = self._get(self.fe, "/api/default-chat")
            if resolved.get("model") == self.model:
                break
            time.sleep(1.0)
        if resolved.get("model") != self.model:
            raise RuntimeError(f"default-chat did not resolve the golden model: {resolved}")

    def preseed(self) -> None:
        """Pin the season seed BEFORE the first casting turn — the determinism anchor."""
        r = self._post_json(self.engine, "/player/call",
                            {"name": "preSeedCast", "args": {"seed": SEASON_SEED}})
        if "result" not in r:
            raise RuntimeError(f"preSeedCast failed: {r}")
        self._quiesce_beats("post-preseed")

    def _quiesce_beats(self, label: str, stable_polls: int = 3, budget_s: int | None = None,
                       poll_s: float = 1.0, quiet: bool = False) -> None:
        """Wait until the engine's beatSeq stops moving — a serialization barrier so the
        fire-and-forget background write-backs (cast identity, prewarm, and the per-turn
        _auto_record_scene fold) land at a DEFINED point relative to the walk in BOTH
        modes, instead of racing the next turn's prompt build (a background commit
        landing mid-race shifts turnsHere/beatSeq in every later prompt and drifts the
        replay keys — the exact turnsHere 4-vs-3 divergence the validation caught)."""
        budget = budget_s if budget_s is not None else (120 if self.mode == "record" else 45)
        last, stable = None, 0
        deadline = time.time() + budget
        while time.time() < deadline:
            try:
                r = self._post_json(self.engine, "/player/call",
                                    {"name": "getGameState", "args": {}})
                seq = (r.get("result") or {}).get("beatSeq")
            except Exception:
                seq = None
            stable = stable + 1 if (seq is not None and seq == last) else 0
            last = seq
            if stable >= stable_polls:
                if not quiet:
                    print(f"  quiesce[{label}]: beatSeq stable at {seq}", flush=True)
                return
            time.sleep(poll_s)
        print(f"  quiesce[{label}]: budget elapsed (beatSeq {last}) — proceeding", flush=True)

    # ── the walk ──────────────────────────────────────────────────────────────────

    def _turn(self, text: str) -> str:
        """One real player turn through POST /api/chat_stream; returns the settled
        assistant text persisted for the turn (read back from history)."""
        body = json.dumps({"message": text, "session": self.session}).encode()
        req = urllib.request.Request(
            f"{self.fe}/api/chat_stream", data=body, method="POST",
            headers={"content-type": "application/json"})
        deadline = time.time() + self.turn_timeout
        with urllib.request.urlopen(req, timeout=self.turn_timeout) as r:
            while time.time() < deadline:
                chunk = r.read(65536)
                if not chunk:
                    break
        time.sleep(self.settle)
        # Per-turn serialization: the post-turn background fold (_auto_record_scene's
        # recordInteraction) must land BEFORE the next prompt builds, in both modes —
        # otherwise turnsHere/beatSeq in the next system prompt race the write and the
        # replay keys drift (the turnsHere 4-vs-3 class).
        self._quiesce_beats("post-turn", stable_polls=2, budget_s=20, poll_s=0.3, quiet=True)
        msgs = self._history()
        for m in reversed(msgs):
            if m.get("role") == "assistant":
                return str(m.get("content") or "")
        return ""

    def _history(self) -> list[dict]:
        h = self._get(self.fe, f"/api/history/{self.session}")
        return h.get("messages") or h.get("history") or (h if isinstance(h, list) else [])

    def _state(self) -> dict:
        return self._get(self.fe, "/api/orwell/state")

    def _note_state(self, turn_no: int, last_text: str) -> dict:
        st = self._state()
        row = {"turn": turn_no, "phase": st.get("phase"), "beatSeq": st.get("beatSeq"),
               "week": st.get("week"), "started": st.get("started"),
               "pending": (st.get("pending") or {}).get("kind")}
        self.timeline.append(row)
        self.digest_parts.append(json.dumps(
            {"t": turn_no, "sha": hashlib.sha256(last_text.encode()).hexdigest()[:16], **row},
            sort_keys=True))
        return st

    @staticmethod
    def _decision_body(p: dict) -> dict | None:
        k = p.get("kind")
        o = p.get("options") or []
        oid = lambda i: o[i]["id"] if len(o) > i else None  # noqa: E731
        return {
            "nominations": {"kind": k, "choice": [oid(0), oid(1)]},
            "veto-decision": {"kind": k, "use": False},
            "comp-intent": {"kind": k, "intent": "compete"},
            "comp-round": {"kind": k, "intent": "compete"},
            "houseguests-choice": {"kind": k, "vote": oid(0)},
            "replacement": {"kind": k, "replacement": oid(0)},
            "eviction-vote": {"kind": k, "vote": oid(0)},
            "tie-break": {"kind": k, "vote": oid(0)},
            "goodbye-message": {"kind": k, "vote": oid(0), "statement": "Play hard out there."},
        }.get(k)

    def walk(self) -> None:
        self.session = self._post_form(self.fe, "/api/session", {
            "name": "golden-path", "endpoint_id": getattr(self, "endpoint_id", ""),
            "model": self.model, "skip_validation": "true",
        }).get("id") or ""
        if not self.session:
            raise RuntimeError("could not create a chat session")
        print(f"session {self.session} · mode={self.mode} · seed={SEASON_SEED}", flush=True)

        # ── casting → season start (invariant 1) ───────────────────────────────────
        started = False
        photo_beat_seen = False
        turn_no = 0
        for line in CASTING_SCRIPT + ["I'm ready. Let's start the season.", "Ready when you are."]:
            turn_no += 1
            text = self._turn(line)
            if re.search(r"\bheadshot\b|\bphoto\b|\bportrait\b", text or "", re.I):
                photo_beat_seen = True
            st = self._note_state(turn_no, text)
            if st.get("started"):
                started = True
                break
        self.inv.record("I1", "casting finalizes and the season starts", started,
                        f"after {turn_no} casting turns")
        if not started:
            return
        # Serialize the create-kicked background write-backs before probing the opener /
        # walking the week — same barrier in both modes (see _quiesce_beats).
        self._quiesce_beats("post-create")

        # ── the producers' opener fires unprompted (invariant 2, #967) ─────────────
        before = sum(1 for m in self._history() if m.get("role") == "assistant")
        opener = False
        opener_budget = 90 if self.mode == "record" else 30
        for _ in range(opener_budget):
            time.sleep(1)
            msgs = self._history()
            assistants = sum(1 for m in msgs if m.get("role") == "assistant")
            users = [m for m in msgs if m.get("role") == "user"]
            if assistants > before and str(users[-1].get("content", "")).strip() in (
                    CASTING_SCRIPT[-1], "I'm ready. Let's start the season.", "Ready when you are."):
                opener = True
                break
        self.inv.record("I2", "producers' opener fires without a player prompt", opener,
                        f"assistant turns {before}→{assistants}")

        # ── post-photo resume (invariant 3, #969) ───────────────────────────────────
        if photo_beat_seen:
            sent = [str(m.get("content") or "") for m in self._history() if m.get("role") == "user"]
            manual_continue = any(re.fullmatch(r"\s*continue\s*", s, re.I) for s in sent)
            self.inv.record("I3", "post-photo resume without a manual continue",
                            not manual_continue, "photo beat occurred in casting")
        else:
            self.inv.record("I3", "post-photo resume without a manual continue", None,
                            "no headshot beat surfaced in this run's casting")

        # ── cast authoring depth (invariant 4, #1007) ───────────────────────────────
        authored, total = 0, 15
        authoring_budget = 600 if self.mode == "record" else 90
        deadline = time.time() + authoring_budget
        while time.time() < deadline:
            try:
                health = self._get(self.fe, "/api/admin/health")
                comp = (health.get("orwell") or {}).get("castAuthoring") or health.get("castAuthoring") or {}
                authored = int(comp.get("authored") or 0)
                total = int(comp.get("total") or 15)
                if authored >= 13:
                    break
            except Exception:
                pass
            time.sleep(5)
        self.inv.record("I4", "cast authoring lands >=13/15 deep profiles",
                        authored >= 13, f"{authored}/{total} deep-authored")

        # ── the week: HOH → noms → veto → ceremony → eviction → roll (I5, I6, I8) ──
        phases_seen: list[str] = []
        stuck = 0
        last_key = None
        eviction_turns = 0
        prompt_i = 0
        week_rolled = False
        start_beat = self.timeline[-1]["beatSeq"] or 0
        for _ in range(self.turn_budget):
            st = self._state()
            pend = st.get("pending") or {}
            if pend.get("kind"):
                body = self._decision_body(pend)
                if body is None:
                    self.inv.record("I5", "phase advances (decision shape)", False,
                                    f"no fixed policy for pending kind {pend.get('kind')}")
                    return
                self._post_json(self.fe, "/api/orwell/decision", body)
                time.sleep(self.settle)
                continue
            turn_no += 1
            text = self._turn(WEEK_PROMPTS[prompt_i % len(WEEK_PROMPTS)])
            prompt_i += 1
            st = self._note_state(turn_no, text)
            phase = st.get("phase") or "?"
            if not phases_seen or phases_seen[-1] != phase:
                phases_seen.append(phase)
            if phase == "eviction":
                eviction_turns += 1
            key = (phase, st.get("beatSeq"))
            stuck = stuck + 1 if key == last_key else 0
            last_key = key
            if stuck >= 10:
                break
            house = st.get("house") or []
            evicted = any((h.get("status") or "") in ("evicted", "jury") for h in house) \
                if isinstance(house, list) else False
            if (st.get("week") or 1) >= 2 or (evicted and phase in ("hoh-competition", "hoh")):
                week_rolled = True
                break

        beats = [r["beatSeq"] for r in self.timeline if isinstance(r.get("beatSeq"), int)]
        monotonic = all(b2 >= b1 for b1, b2 in zip(beats, beats[1:]))
        expected = ["nominations", "veto", "eviction"]
        order_ok = all(any(e in p for p in phases_seen) for e in expected)
        self.inv.record("I5", "phases advance monotonically with no stuck beat",
                        monotonic and order_ok and stuck < 10,
                        f"phases={phases_seen} stuck={stuck} beats {beats[0] if beats else '?'}"
                        f"→{beats[-1] if beats else '?'}")

        engine_errors = []
        try:
            health = self._get(self.fe, "/api/admin/health")
            engine_errors = [e for e in (health.get("recentToolErrors") or [])
                             if "StaleBeat" in str(e)]
        except Exception:
            pass
        self.inv.record("I6", "eviction reveal batched; no premature result / stale-beat trip",
                        2 <= eviction_turns <= 12 and not engine_errors,
                        f"eviction turns={eviction_turns}, stale-beat errors={len(engine_errors)}")

        leaks: list[str] = []
        for m in self._history():
            if m.get("role") != "assistant":
                continue
            body_text = THINK_BLOCK_RE.sub("", str(m.get("content") or ""))
            if RAW_NPC_ID_RE.search(body_text):
                leaks.append("raw npc:<id> in player-facing body")
            if "<think" in body_text:
                leaks.append("unclosed reasoning block reached the body")
            # Mirror the render-side L6b scrub (markdown.js): a CONTIGUOUS run of planning
            # lines at the START of the body is dropped before the player ever sees it — so
            # only what SURVIVES that strip is player-facing. (The first GLM 5.2 record run
            # false-positived on leading "Let me ground myself…" lines the scrub eats; a
            # planning line MID-body still fails, because the scrub deliberately doesn't
            # reach past the first narration line.)
            lines = body_text.splitlines()
            i = 0
            while i < len(lines) and (not lines[i].strip() or REASONING_LINE_RE.match(lines[i])):
                i += 1
            for line in lines[i:]:
                if REASONING_LINE_RE.match(line):
                    leaks.append(f"operator/planning line survives the scrub: {line.strip()[:60]!r}")
                    break
        self.inv.record("I7", "every player-facing body is clean", not leaks,
                        "; ".join(sorted(set(leaks)))[:200] if leaks else
                        f"{sum(1 for m in self._history() if m.get('role') == 'assistant')} bodies scanned")

        end_beat = beats[-1] if beats else 0
        self.inv.record("I8", "the week rolls into the next HOH reign",
                        week_rolled and end_beat > start_beat,
                        f"week_rolled={week_rolled}, beatSeq {start_beat}→{end_beat}")

    # ── the replay contract ───────────────────────────────────────────────────────

    def assert_replay_contract(self) -> None:
        log = open(self.fe_log, encoding="utf-8", errors="replace").read()
        from src import golden_path as gp
        misses = log.count(gp.MISS_SENTINEL)
        self.inv.record("R1", "zero fixture misses", misses == 0, f"{misses} misses in FE log")
        provider_lines = [ln for ln in log.splitlines() if "LLM stream to http" in ln]
        self.inv.record("R2", "no outbound provider call", not provider_lines,
                        f"{len(provider_lines)} stream-impl lines (must be 0 under replay)")

    def digest(self) -> str:
        return hashlib.sha256("\n".join(self.digest_parts).encode()).hexdigest()

    # ── lifecycle ─────────────────────────────────────────────────────────────────

    def shutdown(self) -> None:
        for p in self.procs:
            try:
                p.terminate()
            except Exception:
                pass
        for p in self.procs:
            try:
                p.wait(timeout=10)
            except Exception:
                try:
                    p.kill()
                except Exception:
                    pass
        self.procs.clear()

    def report(self, path: str | None = None) -> dict:
        rep = {"mode": self.mode, "fixture": self.fixture, "model": self.model,
               "seed": SEASON_SEED, "invariants": self.inv.rows,
               "timeline": self.timeline, "digest": self.digest(), "work": self.work}
        if path:
            with open(path, "w", encoding="utf-8") as fh:
                json.dump(rep, fh, indent=1)
        return rep


def fixture_models(fixture: str) -> tuple[str, str]:
    """(narration_model, utility_model) the fixture was recorded against. Format-2
    fixtures declare both in their leading meta line — authoritative, no guessing. The
    format-1 fallback derives narration from the first streamed record and utility from
    the first non-stream record; that heuristic MIS-DERIVES two-tier fixtures (cast-
    identity calls are streamed on the utility tier but default to call_class narration),
    which is exactly why format 2 exists. Replay pins BOTH on the dead-end endpoint so
    every request key matches the recording."""
    from src import golden_path as gp
    meta = gp.fixture_meta(fixture)
    if meta and meta.get("narration_model"):
        return meta["narration_model"], meta.get("utility_model") or meta["narration_model"]
    narration, utility = "", ""
    with open(fixture, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            rec = json.loads(line)
            if rec.get("kind") == "stream" and not narration:
                narration = rec.get("model") or ""
            elif rec.get("kind") == "call" and not utility:
                utility = rec.get("model") or ""
            if narration and utility:
                break
    if not narration and not utility:
        raise RuntimeError(f"fixture is empty: {fixture}")
    narration = narration or utility
    return narration, (utility or narration)


def run_once(**kw) -> GoldenDriver:
    d = GoldenDriver(**kw)
    try:
        d.scrub_stale_state()
        d.boot()
        d.configure_model()
        d.preseed()
        d.walk()
        if d.mode == "replay":
            d.assert_replay_contract()
    finally:
        d.shutdown()
    return d
