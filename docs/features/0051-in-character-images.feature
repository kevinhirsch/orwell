# DRAFT executable spec — SPECCED, NOT BUILT (author: feature-maker; implementer makes it pass).
# Feature 0051 — In-character images: the model PRODUCES images as part of play (a houseguest's
# sketch, the memory-wall portrait, a "camera still"), inline in the chat. Pairs with E94 (attach =
# analyze in; this = generate out). NOT in cucumber.cjs until the engine half is built to green;
# the FE half is pytest/browser-smoke gated. HARD rule: roles only (player, NPC, HOH, nominee,
# evictee). Binding rules: the Vault Wall (prompts from visible state only — E11/E15 discipline),
# knowledge scope (depict only what the player knows), anti-sycophancy (never depict unresolved
# outcomes — P1/P6), recorded-or-it-didn't-happen (image beats are recorded), ADR 0003 (inline in
# the chat; augments, never replaces; graceful absence).
# Decisions locked 2026-06-11: auto-on-move-in portraits · photorealistic style · provider-agnostic
# ImageGenerationPort · all declines in the production/show frame.

Feature: In-character images — Vault-free generation, rendered inline in the chat

  The game can show the player pictures from inside the fiction: photorealistic cast portraits
  at move-in, a sketch a houseguest made, a camera still of a scene the player witnessed. Every
  image prompt is built only from the player's visible state; the house looks like itself all
  season via a per-season photorealistic style anchor; generation is budgeted; and when no
  image-capable model is configured the game plays identically, declining in the production frame.

  Background:
    Given a started game with a generated cast
    And an image-generation pipeline behind the configured ImageGenerationPort

  Scenario: Cast portraits fire automatically at move-in — no player prompt needed
    When the season begins and the createCharacter / season-start beat completes
    Then a photorealistic portrait is generated for each houseguest
    And no player request or prompt was required to trigger generation
    And the portrait set is generated exactly once per season start, not on subsequent restarts

  Scenario: Image prompts are built only from the player's visible state
    Given the engine state contains hidden-layer sentinel content
    When an image prompt is assembled for any sanctioned generation moment
    Then the assembled prompt contains no hidden sentinel content
    And the prompt builder has no dependency on any engine-only store

  Scenario: An image may depict only what the player knows
    Given an off-screen scene whose witness set excludes the player
    When the player requests a camera still of that scene
    Then no image of it is generated
    And the decline is voiced in the production frame without revealing that the scene exists

  Scenario: No image asserts an unresolved outcome
    Given an eviction vote that the engine has not yet resolved and revealed
    When any image generation is requested for that ceremony
    Then no image depicting the result is produced before the engine's reveal
    And if declined, the refusal is voiced in the production frame

  Scenario: The season-start portrait set is photorealistic and built from public facets only
    When the season begins and the cast portrait set is produced
    Then each portrait prompt carries the per-season photorealistic style anchor
    And each portrait prompt is derived from that houseguest's public appearance facets
    And no stat, relationship value, or hidden element appears in any portrait prompt

  Scenario: The house looks like itself — style and identity are stable within a season
    When two images of the same houseguest are generated in the same season
    Then both prompts carry the same per-season photorealistic style anchor and the same appearance facets
    And the style anchor survives a save and engine restart
    And a different seed yields a different style anchor

  Scenario: A generated image shown in character is a recorded beat
    When an image is generated and rendered to the player in character
    Then a player-witnessed event recording that image beat exists in the event record

  Scenario: Generation is budgeted, and over-budget requests decline in the production frame
    Given the generation budget for the current window is exhausted
    When the player requests another image
    Then no image is generated
    And the refusal is voiced in the production/show frame
    And the budget bounds are declared in a constants module

  Scenario: Graceful absence — no image-capable model configured
    Given no configured model has image-generation capability
    When a generation moment arises
    Then the game continues without error
    And the absence is voiced in the production frame
    And no broken affordance or error surface is shown to the player

  Scenario: Images augment the chat and never replace it
    When images are rendered
    Then they appear inline in the chat transcript
    And no game-building or game-progressing interaction requires the image surface
