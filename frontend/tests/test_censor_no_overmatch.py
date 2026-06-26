"""censor.js must not over-match legitimate content (cosmetic-only blur).

`static/js/censor.js` is a COSMETIC, post-render, click-to-reveal blur over rendered chat
(a MutationObserver pass). It is NOT a security control. Two of its patterns over-matched
and mangled perfectly legitimate content that appears constantly in this repo's own chats:

  - `hash`  (/\\b[0-9a-f]{32,}\\b/) blurred ANY 32+ hex run — git SHAs (40 hex), dashless
    UUIDs (32 hex), MD5s of legit strings, hex colour lists, contract addresses. A bare hex
    run is not a credential; a genuine secret carries meaning only WITH a credential context
    (a `sha:`/`md5:` label or a real key prefix), which the surviving patterns already catch.
  - `internal-ip` (/10.x | 172.16-31.x | 192.168.x/) blurred benign private-IP literals in
    narration / dev-chat. A private IP is not a secret.

Both were DROPPED. This gate proves (1) the patterns are gone at source, (2) the module stays
explicitly cosmetic-only, and (3) the genuine credential patterns still fire — driven through
the actual `PATTERNS` matcher in Node so the test exercises the real regexes, not a copy.

fail-before / pass-after: a git SHA, a dashless UUID and a private-IP literal are NOT blurred,
while a real API key and a bearer token ARE still blurred.
"""

import os
import re
import shutil
import subprocess

import pytest

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CENSOR = os.path.join(FRONTEND, "static", "js", "censor.js")


def _read():
    with open(CENSOR, encoding="utf-8") as f:
        return f.read()


# ── source pins: the over-matching patterns are gone, the module stays cosmetic ──── #

def _patterns_block(src):
    # isolate the `const PATTERNS = [ ... ];` literal so source pins check the LIVE patterns,
    # not the surrounding explanatory comment (which legitimately names the dropped shapes).
    start = src.index("const PATTERNS = [")
    return src[start : src.index("];", start) + 2]


def test_hash_pattern_dropped():
    block = _patterns_block(_read())
    # the bare-hex-run "hash" label/regex must be gone from the live patterns
    assert "label: 'hash'" not in block
    assert "[0-9a-f]{32,}" not in block


def test_internal_ip_pattern_dropped():
    block = _patterns_block(_read())
    # the private-IP "internal-ip" label/regex must be gone from the live patterns
    assert "label: 'internal-ip'" not in block
    assert "192.168" not in block


def test_module_stays_explicitly_cosmetic_only():
    src = _read()
    # the header must still state, in so many words, that this is cosmetic and NOT security.
    # collapse whitespace so the assertion survives comment line-wrapping.
    flat = re.sub(r"\s+", " ", src)
    assert "COSMETIC ONLY" in flat
    assert "NOT a security control" in flat


def test_genuine_credential_patterns_intact():
    src = _read()
    # the real-secret shapes must survive the change
    assert "label: 'email'" in src
    assert "label: 'api-key'" in src
    assert "label: 'token'" in src
    assert "label: 'credential'" in src
    assert "label: 'private-key'" in src
    assert "label: 'jwt'" in src


# ── behavioural: drive the REAL PATTERNS matcher in Node ───────────────────────────── #

_NODE = shutil.which("node")


@pytest.mark.skipif(_NODE is None, reason="node not available")
def test_matcher_skips_legit_content_but_catches_real_secrets():
    # Extract the actual PATTERNS array from censor.js and run each input through the same
    # matcher loop the module uses (escape, .exec, collect matches). This drives the REAL
    # regexes, so the gate fails before the fix (git SHA / UUID / private IP get matched)
    # and passes after.
    program = r"""
    const fs = require('fs');
    const src = fs.readFileSync(process.argv[1], 'utf8');
    // pull out the `const PATTERNS = [ ... ];` literal and eval it (regex/objects only)
    const start = src.indexOf('const PATTERNS = [');
    const arrStart = src.indexOf('[', start);
    // find the matching close bracket for the array
    let depth = 0, end = -1;
    for (let i = arrStart; i < src.length; i++) {
      const c = src[i];
      if (c === '[') depth++;
      else if (c === ']') { depth--; if (depth === 0) { end = i; break; } }
    }
    const arrLit = src.slice(arrStart, end + 1);
    const PATTERNS = (new Function('return ' + arrLit + ';'))();

    function matches(text) {
      const out = [];
      for (const p of PATTERNS) {
        p.re.lastIndex = 0;
        let m;
        while ((m = p.re.exec(text)) !== null) {
          out.push({ text: m[0], label: p.label });
          if (m.index === p.re.lastIndex) p.re.lastIndex++; // guard zero-width
        }
      }
      return out;
    }

    // [text, shouldMatch] — labels are roles only, no game/people names.
    const cases = [
      // MUST NOT be blurred (the false positives we fixed):
      ['the fix landed in commit a1b2c3d4e5f60718293a4b5c6d7e8f9012345678 today', false], // 40-hex git SHA
      ['session id 550e8400e29b41d4a716446655440000 was reused', false],                  // 32-hex dashless UUID
      ['the engine is on 192.168.1.50 and the proxy at 10.0.0.7', false],                 // private IPs
      ['that endurance comp ran to 172.16.31.255 internally', false],                     // 172.16-31 private IP
      ['colours #aabbccddeeff00112233445566778899 in the palette', false],               // 32-hex colour-ish run
      // MUST still be blurred (genuine secrets survive):
      ['use the key sk-ABCDEFGHIJKLMNOPQRSTUVWX1234 for that', true],                     // sk- API key
      ['Authorization: Bearer abcDEF1234567890abcDEF1234567890', true],                   // bearer token
      ['contact host@example.com about it', true],                                        // email
      ['password: hunter2trombone', true],                                                // labelled credential
    ];

    let ok = true;
    for (const [text, shouldMatch] of cases) {
      const got = matches(text);
      const did = got.length > 0;
      if (did !== shouldMatch) {
        ok = false;
        console.error('MISMATCH', JSON.stringify(text), 'expected', shouldMatch,
                      'got', JSON.stringify(got.map(g => g.label + ':' + g.text)));
      }
    }
    console.log(ok ? 'OK' : 'FAIL');
    """
    res = subprocess.run(
        [_NODE, "-e", program, "--", CENSOR], capture_output=True, text=True
    )
    assert "OK" in res.stdout, f"stdout={res.stdout!r} stderr={res.stderr!r}"
