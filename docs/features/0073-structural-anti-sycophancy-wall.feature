Feature: 0073 — structural anti-sycophancy wall: game-build boundary is a CI gate
  The anti-sycophancy wall (ORWELL_GAME_BUILD) is proven unconditionally in CI, not just
  at runtime when the env flag happens to be set. The gate is env-pinned so it can't pass
  with the wall accidentally disabled.

  # HARD: no names — roles only; no game logic touched.

  Scenario: set purity — no feature is simultaneously kept and dropped
    Given the GAME_KEEP_SET and GAME_DROP_SET definitions
    Then their intersection is empty
    And every drop-set feature returns is_feature_enabled False under game build
    And every keep-set feature returns is_feature_enabled True under game build

  Scenario: context injection is zeroed under game build
    Given the game build is forced on
    When front_end_context_sources is called
    Then every inherited source key (memory, rag, skills, web) is False
    And web auto-injection is off even though web_search is a keep-set tool

  Scenario: JS strip covers every drop-set script under game build
    Given the game build is forced on
    When dropped_script_srcs is called
    Then every entry in GAME_DROP_SCRIPTS appears in the result
    When strip_dropped_scripts is applied to HTML containing all drop-set script tags
    Then every drop-set script tag is absent from the output
    And a non-drop-set script tag is unchanged in the output

  Scenario: drop-set routes are absent at HTTP under game build
    Given the front-end boots with the game build forced on
    When a representative drop-set API endpoint is requested
    Then the response is 404
    When a keep-set endpoint is requested
    Then the response is not 404

  Scenario: the gate is env-pinned and cannot pass with the wall off
    Given the test environment has ORWELL_GAME_BUILD unset or set to 0
    When the game-build wall test suite runs
    Then it internally forces game build on before each assertion
    And the set-purity and HTTP assertions still hold

  Scenario: the wall gate touches no mandate surface
    Given the game-build wall test helpers
    Then the wall test helpers import no Vault type
    And the wall test helpers alter no game projection, narration, or engine tool
