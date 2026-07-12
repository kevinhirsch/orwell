"""#1414 (R3): every name chat.js imports from a decomposed `chat*.js` sibling MUST be exported
there — or native-ESM module instantiation throws a link-time SyntaxError ("does not provide an
export named 'X'") BEFORE any code runs, chat.js never loads, app.js's `import './js/chat.js'`
fails, and app init halts partway (settings modal never mounts, FOUC/theme not cleared, the
send button never becomes visible).

This exact bug shipped in PR7: `_isSkippableUserPrompt` was moved into chatReconcile.js as a plain
`function` (verbatim, where it had been module-local in chat.js) while chat.js was updated to
IMPORT it — an unresolved import that `node --check` (single-file syntax) and the string-grep
source pins both pass, and that only a real browser boot catches. This guard closes that gap in
fe-unit so a future R3 extraction can't reintroduce a boot-halt.
"""
import os
import re

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(rel):
    with open(os.path.join(FRONTEND, rel), encoding="utf-8") as f:
        return f.read()


def _collect_exports(src):
    """Every named export of a module (default export intentionally ignored — a default import
    is not the failure mode this guards)."""
    names = set()
    for m in re.finditer(r"export\s+(?:async\s+)?function\s+([\w$]+)", src):
        names.add(m.group(1))
    for m in re.finditer(r"export\s+(?:const|let|var)\s+([\w$]+)", src):
        names.add(m.group(1))
    for m in re.finditer(r"export\s+class\s+([\w$]+)", src):
        names.add(m.group(1))
    # `export { A, B as C }` re-export blocks — the exported name is after `as`, else the name.
    for m in re.finditer(r"export\s*\{([^}]*)\}", src):
        for part in m.group(1).split(","):
            part = part.strip()
            if not part:
                continue
            names.add(part.split(" as ")[-1].strip() if " as " in part else part)
    return names


# Named imports (the `{ ... }` form, possibly with a leading `default,`) from a local chat*.js
# sibling — the R3 decomposition family. Multiline-aware (the outbox/reconcile blocks span lines).
_IMPORT_RE = re.compile(
    r"import\s+(?:[\w$]+\s*,\s*)?\{([^}]*)\}\s*from\s*'(\./chat[\w]*\.js)'", re.S)


def test_chatjs_named_imports_from_chat_siblings_are_exported():
    chat = _read("static/js/chat.js")
    seen = 0
    for m in _IMPORT_RE.finditer(chat):
        names_blob, modpath = m.group(1), m.group(2)
        names = [n.strip().split(" as ")[0].strip()
                 for n in names_blob.split(",") if n.strip()]
        target = _read("static/js/" + modpath[2:])
        exported = _collect_exports(target)
        for name in names:
            seen += 1
            assert name in exported, (
                f"chat.js imports '{name}' from {modpath}, but {modpath} does not EXPORT it "
                f"— native-ESM instantiation throws a link-time SyntaxError before any code runs, "
                f"so chat.js never loads and app boot halts. Add `export` to its declaration.")
    # Sanity: the reconcile module (PR7) is present and its imports were actually checked.
    assert seen >= 10, "expected chat.js to import a batch of names from its chat* siblings"
