/**
 * Narrator configuration (feature 0027 §4): provider, endpoint, model, key, and
 * resilience knobs — ALL from the environment, the same source the deploy `.env`
 * uses. **No secret is ever a literal in this (committed) source**: `apiKey` is
 * read from env only and is `undefined` when unset. Tunable numbers default here
 * and are overridable via env (a future God-Mode knob).
 */
export type NarratorProvider = "ollama" | "anthropic" | "openai";

export interface NarratorConfig {
  provider: NarratorProvider;
  endpoint: string;
  model: string;
  /** Read from env ONLY — never committed. Undefined when the env var is unset. */
  apiKey: string | undefined;
  timeoutMs: number;
  maxRetries: number;
}

/** The chat/completions path per provider (request *shape* differs; see LlmNarrativePort). */
const PROVIDER_PATH: Record<NarratorProvider, string> = {
  ollama: "/api/chat",
  anthropic: "/v1/messages",
  openai: "/chat/completions",
};

/** Public API base per provider — used only when env does not override the endpoint. */
const PROVIDER_ENDPOINT: Record<NarratorProvider, string> = {
  ollama: "http://127.0.0.1:11434",
  anthropic: "https://api.anthropic.com",
  openai: "https://api.openai.com/v1",
};

export function providerPath(provider: NarratorProvider): string {
  return PROVIDER_PATH[provider] ?? PROVIDER_PATH.ollama;
}

function isProvider(v: string): v is NarratorProvider {
  return v === "ollama" || v === "anthropic" || v === "openai";
}

type Env = Record<string, string | undefined>;

/**
 * Load the narrator config from env. Honors the project convention: `ORWELL_*`
 * primary with a silent `BBAI_*` fallback. Unknown provider → safe default
 * (`ollama`, a loopback local model — no key required).
 */
export function loadNarratorConfig(env: Env = process.env): NarratorConfig {
  const get = (key: string): string | undefined => env[`ORWELL_${key}`] ?? env[`BBAI_${key}`];

  const raw = (get("NARRATOR_PROVIDER") ?? "ollama").toLowerCase();
  const provider: NarratorProvider = isProvider(raw) ? raw : "ollama";

  const num = (key: string, fallback: number): number => {
    const v = Number(get(key));
    return Number.isFinite(v) && v > 0 ? v : fallback;
  };

  return {
    provider,
    endpoint: get("NARRATOR_ENDPOINT") ?? PROVIDER_ENDPOINT[provider],
    model: get("NARRATOR_MODEL") ?? "default",
    apiKey: get("NARRATOR_API_KEY"), // env only — no literal, undefined if unset
    timeoutMs: num("NARRATOR_TIMEOUT_MS", 20_000),
    maxRetries: num("NARRATOR_MAX_RETRIES", 2),
  };
}
