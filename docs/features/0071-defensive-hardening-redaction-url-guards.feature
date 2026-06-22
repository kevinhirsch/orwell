Feature: 0071 — defensive hardening: log redaction & URL/path guards
  Two mandate-neutral hardening drop-ins adapted from hermes: broader secret redaction on the FE log path,
  and fail-closed SSRF / path-traversal guards for outward fetches. No Vault surface, no game logic.

  Scenario: vendor-prefixed keys and auth headers are masked
    Given a string containing a vendor-prefixed API key and an Authorization header
    When the string is redacted
    Then neither the key nor the header value appears verbatim
    And surrounding non-secret text is unchanged

  Scenario: URL secrets in query params are masked
    Given a URL containing a secret query parameter
    When the URL is redacted
    Then the secret value does not appear verbatim

  Scenario: redaction is applied on the log path
    Given the FE logging path with redaction wired
    When a log record containing a secret shape is emitted
    Then the persisted log line shows the secret masked

  Scenario: the URL guard fails closed on unsafe addresses
    Given the URL safety guard
    Then a loopback URL is rejected
    And a private-range URL is rejected
    And a link-local or IPv6-scope-id URL is rejected
    And a public URL is allowed

  Scenario: the path join rejects traversal
    Given a base directory and the safe-join helper
    When a segment contains a parent-directory or absolute traversal
    Then the join is refused
    When a normal relative segment is joined
    Then it resolves under the base directory

  Scenario: the helpers touch no mandate surface
    Given the redaction and URL-safety helpers
    Then they import no Vault type
    And they alter no game projection or narration
