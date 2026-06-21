"""ADR 0013 — a cast photo requires a MODEL-AUTHORED identity.

The portrait warm (`orwell_prewarm.warm_portraits`) must shoot a face ONLY when its houseguest's
own authoring gate has fired (a real model write-back via `_on_authored`). An NPC the model could
NOT author — or one stuck behind a total authoring hang — must get NO photo (a seeded/un-authored
face would mismatch the rich authored text the player eventually sees). The portrait backfill shoots
it later, once authoring actually lands.
"""
import asyncio
import importlib

prewarm = importlib.import_module("src.orwell_prewarm")


def _run(coro):
    # FE convention: drive on the existing session loop (NEVER asyncio.run, which closes the loop
    # and breaks every subsequent test that shares it).
    return asyncio.get_event_loop().run_until_complete(coro)


def _drive():
    # warm_portraits nests tasks (the `_run` dispatcher spawns a per-NPC `_shoot_one` each); pump the
    # loop a few turns so they all settle.
    for _ in range(6):
        _run(asyncio.sleep(0))


class _FakePortraits:
    def __init__(self):
        self.shot = []

    def kickoff_generation(self, entries, user):
        for e in entries:
            self.shot.append(prewarm._prompt_id(e))


def _setup(user, ids):
    prewarm.reset(user)
    st = prewarm._state(user)
    st.author_started = True
    st.prompts = [{"id": i} for i in ids]
    for i in ids:
        st.npc_event(i)  # pre-create the per-NPC gate
    return st


def test_photo_only_for_model_authored_npc():
    """Authored NPCs get a photo; an un-authored NPC (gate never fired, whole-cast done) gets none."""
    U = "adr11-mix"
    st = _setup(U, ["npc:1", "npc:2", "npc:3"])
    # npc:1 + npc:3 authored (their write-backs landed); npc:2 the model could NOT author.
    st.npc_event("npc:1").set()
    st.npc_event("npc:3").set()
    st.author_done.set()  # whole-cast authoring finished (success OR failure)
    fake = _FakePortraits()
    _run(prewarm.warm_portraits(U, portraits=fake, timeout=2.0))
    _drive()
    assert set(fake.shot) == {"npc:1", "npc:3"}, \
        f"only model-authored NPCs get a photo (got {fake.shot})"
    assert "npc:2" not in fake.shot, "an un-authored NPC must get NO photo (ADR 0013)"


def test_no_photo_when_nothing_authored():
    """If the whole cast finishes with NO NPC authored, zero photos shoot (never seeded faces)."""
    U = "adr11-none"
    st = _setup(U, ["npc:1", "npc:2"])
    st.author_done.set()  # whole-cast done, but no per-NPC gate ever fired
    fake = _FakePortraits()
    _run(prewarm.warm_portraits(U, portraits=fake, timeout=2.0))
    _drive()
    assert fake.shot == [], f"no NPC authored ⇒ no photos (got {fake.shot})"


def test_declines_when_author_warm_never_started():
    """No author warm at all ⇒ warm_portraits declines (createCharacter's fallback owns that path)."""
    U = "adr11-noauthor"
    prewarm.reset(U)
    st = prewarm._state(U)
    st.author_started = False
    fake = _FakePortraits()
    res = _run(prewarm.warm_portraits(U, portraits=fake, timeout=2.0))
    assert res.get("started") is False and res.get("reason") == "author-warm-not-started"
    assert fake.shot == []
