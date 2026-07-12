"""#737 (part of the #660 'all UI into kits' epic) — THE PLAYER-TIER SURFACE REGISTRY
+ a generalized coverage / drift assertion.

The per-kit convention gates each freeze ONE family's end state:
  • test_f3_window_ratchet.py  — floating windows → OrwellWindow (`.ow-*`)
  • test_og_gadget_kit.py      — rail gadgets     → OrwellGadget (`.og-*`)
  • test_on_notice_kit.py      — above-composer   → OrwellNotice (`.on-*`)
  • test_0753_sheet_kit.py     — bottom sheets    → OrwellSheet (`.ow-sheet-*`)
  • test_0773_element_kit.py   — atomic controls  → the element kit (`.ow-btn` …)

What was MISSING (the epic's 'always-updated guarantee'): a SINGLE registry that
enumerates every player-tier surface family and the kit each composes, plus a drift
guard so a NEW surface kit cannot be added without registering it — exactly the way
the F-3 ratchet refuses a new hand-rolled window.

This is that additive layer. `surface_registry.json` is the manifest; this file:
  (a) proves every registered family resolves to a REAL kit/component (its source
      file + composition seam + CSS family + governing gate all exist);
  (b) THE RATCHET — the set of `window.Orwell*Kit = {` composition seams defined in
      static/js MUST equal the set of registered `kind:'kit'` families. A new kit
      that isn't registered fails here; a registered kit whose definition disappears
      or moves file fails too. Never silent.

This drift guard (b) closes the "new KIT slips in unregistered" hole — but only for chrome
that EXPOSES a `window.Orwell*Kit` seam. The complementary hole — a new **orphan** surface
family that hand-rolls bespoke floating chrome and composes NO kit at all (so it has no seam
for (b) to see, and no `data-<ns>-*` marker for the browser_smoke runtime census to see) — is
closed by the UNIVERSAL scan in tests/test_1454_orphan_chrome_ratchet.py (#1454): a single
static gate that fails on ANY `static/js` module authoring un-registered `position: fixed`
surface chrome. Together they make "a new surface family cannot be introduced without composing
a registered kit or being registered" hold for BOTH the kit-seam and the orphan cases.

It does NOT re-implement the per-family gates (they own the deep chrome/a11y pins) and
it does NOT build a visual/screenshot matrix (that is #113's job). One manifest, one
coverage/drift contract.
"""
import os
import re
import glob
import json

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JS_DIR = os.path.join(FRONTEND, "static", "js")
TESTS_DIR = os.path.dirname(os.path.abspath(__file__))
MANIFEST = os.path.join(TESTS_DIR, "surface_registry.json")

# The composition-seam definition signature: an ASSIGNMENT of an object literal to a
# `window.Orwell<Name>Kit` global (the create()-style factory). This is a DEFINITION,
# never a consumer read (`window.OrwellWindowKit.create(...)`) nor a defensive shim
# (`= window.OrwellWindowKit || {}` — that starts with `window`, not `{`).
_KIT_DEF_RX = re.compile(r"window\.(Orwell\w+Kit)\s*=\s*\{")

VALID_KINDS = {"kit", "component", "css"}
REQUIRED_KEYS = {"id", "family", "kit", "kind", "seam_check", "file",
                 "css_family", "css_source", "gate"}


def _read(*rel):
    with open(os.path.join(FRONTEND, *rel), encoding="utf-8") as f:
        return f.read()


def _load_manifest():
    with open(MANIFEST, encoding="utf-8") as f:
        return json.load(f)


def _families():
    return _load_manifest()["families"]


def _defined_kit_seams():
    """{seam_name -> relpath} for every `window.Orwell*Kit = {` DEFINITION in static/js."""
    out = {}
    for path in glob.glob(os.path.join(JS_DIR, "**", "*.js"), recursive=True):
        name = os.path.relpath(path, JS_DIR)
        with open(path, encoding="utf-8") as fh:
            for m in _KIT_DEF_RX.finditer(fh.read()):
                out.setdefault(m.group(1), name)
    return out


# ── the manifest is well-formed ──────────────────────────────────────────────


def test_manifest_loads_and_documents_itself():
    doc = _load_manifest()
    assert "_doc" in doc and "737" in doc["_doc"]
    assert "_drift_guard" in doc, "the manifest must document the drift-guard contract"
    assert isinstance(doc.get("families"), list) and doc["families"], "no families registered"


def test_every_entry_is_well_formed():
    seen_ids, seen_seams = set(), set()
    for e in _families():
        missing = REQUIRED_KEYS - set(e)
        assert not missing, f"registry entry {e.get('id')!r} missing keys {sorted(missing)}"
        assert e["kind"] in VALID_KINDS, f"{e['id']}: bad kind {e['kind']!r}"
        assert e["id"] not in seen_ids, f"duplicate family id {e['id']!r}"
        seen_ids.add(e["id"])
        seam = e.get("seam")
        if seam:
            assert seam not in seen_seams, f"duplicate seam {seam!r}"
            seen_seams.add(seam)
        # a kind:'kit' family MUST advertise a window.Orwell*Kit seam (the drift-guard key).
        if e["kind"] == "kit":
            assert e.get("seam", "").endswith("Kit"), (
                f"{e['id']}: a kind:'kit' family must declare a window.Orwell*Kit seam"
            )


# ── (a) every registered family resolves to a REAL kit / component ───────────


def test_every_registered_family_resolves_to_a_real_kit():
    for e in _families():
        src_path = os.path.join(FRONTEND, "static", "js", e["file"]) \
            if e["file"] != "style.css" else os.path.join(FRONTEND, "static", "style.css")
        assert os.path.exists(src_path), f"{e['id']}: source file {e['file']} is missing"
        src = _read("static", e["file"]) if e["file"] == "style.css" \
            else _read("static", "js", e["file"])
        # the composition seam / region marker is defined in the declared file.
        assert e["seam_check"] in src, (
            f"{e['id']}: seam_check {e['seam_check']!r} not found in {e['file']} — "
            "the registry points at a family that no longer defines its seam."
        )
        # the CSS family marker exists in its declared source (proves the family is real).
        css_src = _read("static", e["css_source"]) if e["css_source"] == "style.css" \
            else _read("static", "js", e["css_source"])
        assert e["css_family"] in css_src, (
            f"{e['id']}: css_family {e['css_family']!r} not found in {e['css_source']}."
        )
        # the governing convention gate exists.
        gate = os.path.join(TESTS_DIR, e["gate"])
        assert os.path.exists(gate), f"{e['id']}: governing gate {e['gate']} is missing"


def test_component_and_css_families_are_covered():
    # the registry is not windows-only: it must index the shared render components
    # (monogram, avatar) and the CSS element kit, so 'every surface family' is honest.
    kinds = {e["kind"] for e in _families()}
    assert {"kit", "component", "css"} <= kinds, (
        f"the registry must cover kits AND shared components AND the css element kit; got {kinds}"
    )
    ids = {e["id"] for e in _families()}
    for expected in ("portrait-monogram", "account-avatar", "atomic-controls"):
        assert expected in ids, f"the registry omits the {expected!r} surface family"


def test_element_kit_demo_driver_is_not_shipped():
    # the element kit's demo driver is demo-page-only (mirrors test_0773) — it must not
    # leak into the app shell. Pin it here too so the registry note stays honest.
    entry = next(e for e in _families() if e["id"] == "atomic-controls")
    driver = entry.get("demo_driver")
    assert driver, "the atomic-controls entry should name its demo driver"
    index = _read("static", "index.html")
    assert driver not in index, f"{driver} is a demo-only driver — it must not ship in index.html"


# ── (b) THE RATCHET — registry ⇄ defined kit seams stay in lock-step ─────────


def test_drift_guard_kit_seams_stay_in_sync():
    defined = _defined_kit_seams()                     # seams actually defined in static/js
    registered = {e["seam"].replace("window.", ""): e   # kit seams the manifest registers
                  for e in _families() if e["kind"] == "kit"}

    # (1) every DEFINED kit seam is REGISTERED — a NEW orwell*.js surface kit that isn't
    #     in the manifest fails here (the epic's always-updated guarantee).
    unregistered = set(defined) - set(registered)
    assert not unregistered, (
        f"NEW composition kit(s) {sorted(unregistered)} define a window.Orwell*Kit seam "
        f"(in {[defined[s] for s in sorted(unregistered)]}) but are NOT in "
        "surface_registry.json — register the surface family (id/family/kit/seam/file/"
        "css_family/gate) so the coverage guarantee stays complete (#737, mirroring the "
        "F-3 window ratchet)."
    )

    # (2) every REGISTERED kit seam is actually DEFINED — a registered kit whose seam
    #     vanished (deleted/renamed) fails here (stale registry).
    dangling = set(registered) - set(defined)
    assert not dangling, (
        f"registered kit seam(s) {sorted(dangling)} are not defined by any static/js file "
        "anymore — remove the stale registry entry or restore the kit."
    )

    # (3) each registered kit is defined in the FILE the manifest names (catches a kit
    #     moving file without updating the registry).
    for seam, entry in registered.items():
        assert defined[seam] == entry["file"], (
            f"kit {seam} is defined in {defined[seam]} but the registry says {entry['file']} — "
            "update surface_registry.json to the file that owns the seam."
        )


def test_ratchet_covers_the_four_composite_kits():
    # a belt on the drift guard: the four known composite kits are all present (so a
    # regression that empties the manifest can't make the ratchet vacuously pass).
    registered = {e["seam"] for e in _families() if e["kind"] == "kit"}
    for seam in ("window.OrwellWindowKit", "window.OrwellGadgetKit",
                 "window.OrwellNoticeKit", "window.OrwellSheetKit"):
        assert seam in registered, f"the registry lost the {seam} family"


def test_kit_def_signature_matches_only_definitions():
    # guard the drift-guard's own signature: it matches an object-literal DEFINITION, never
    # a consumer read or a defensive `|| {}` shim (which would corrupt the seam census).
    assert _KIT_DEF_RX.search("window.OrwellWindowKit = {")
    assert _KIT_DEF_RX.search("  window.OrwellFooKit = {\n")           # indented (IIFE) form
    assert not _KIT_DEF_RX.search("window.OrwellWindowKit.create(x)")  # a consumer read
    assert not _KIT_DEF_RX.search("const k = window.OrwellWindowKit;")  # an assignment FROM
    assert not _KIT_DEF_RX.search("window.OrwellWindowKit = window.OrwellWindowKit || {}")
