import { describe, it, expect } from "vitest";
import type { NarrationContext } from "../../src/ports/NarrativePort";
import { DeterministicNarrator } from "../../src/adapters/narrative/DeterministicNarrator";
import { loadNarratorConfig } from "../../src/adapters/narrative/narratorConfig";
import {
  LlmNarrativePort,
  buildProviderRequest,
  buildBody,
  buildHeaders,
  extractText,
  safeFallbackLine,
  type NarratorTransport,
} from "../../src/adapters/narrative/LlmNarrativePort";
import { PLAYER, npc } from "../../src/domain/ids";

const ctx: NarrationContext = {
  forEntity: PLAYER,
  mode: "scene",
  visibleEvents: [
    { id: "e1", ts: 1, type: "house-event", initiator: npc(1), witnessSet: [PLAYER, npc(1)], hidden: false, content: "A house meeting was called." },
  ],
  knowledge: [],
  systemPrompt: "You are the house.",
};

async function collect(it: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const c of it) out.push(c);
  return out;
}

describe("0027 — NarrativePort LLM adapter (voices, never decides)", () => {
  it("the deterministic narrator streams to exactly the full narration", async () => {
    const narrator = new DeterministicNarrator(3);
    const full = await narrator.narrate(ctx);
    const chunks = await collect(narrator.narrateStream(ctx));
    expect(chunks.join("")).toBe(full); // streaming == full
    expect(chunks.length).toBeGreaterThan(1); // genuinely chunked
    expect(await narrator.narrate(ctx)).toBe(full); // deterministic
  });

  it("config comes from env (ORWELL_* primary, BBAI_* fallback); no secret default", () => {
    const def = loadNarratorConfig({});
    expect(def.provider).toBe("ollama");
    expect(def.apiKey).toBeUndefined(); // never a literal in source

    const cfg = loadNarratorConfig({
      ORWELL_NARRATOR_PROVIDER: "anthropic",
      ORWELL_NARRATOR_ENDPOINT: "https://example.test",
      ORWELL_NARRATOR_MODEL: "m1",
      ORWELL_NARRATOR_API_KEY: "from-env",
    });
    expect(cfg).toMatchObject({ provider: "anthropic", endpoint: "https://example.test", model: "m1", apiKey: "from-env" });

    expect(loadNarratorConfig({ BBAI_NARRATOR_MODEL: "fallback" }).model).toBe("fallback"); // silent BBAI_* fallback
    expect(loadNarratorConfig({ ORWELL_NARRATOR_PROVIDER: "bogus" }).provider).toBe("ollama"); // unknown → safe default
  });

  it("builds provider-agnostic requests (routing, headers, body) from the same context", () => {
    for (const provider of ["ollama", "anthropic", "openai"] as const) {
      const req = buildProviderRequest(
        { provider, endpoint: "http://h", model: "m", apiKey: "K", timeoutMs: 1, maxRetries: 0 },
        ctx,
      );
      expect(req.url.startsWith("http://h")).toBe(true);
      const headers = buildHeaders(req);
      const body = buildBody(req) as Record<string, unknown>;
      if (provider === "anthropic") {
        expect(headers["x-api-key"]).toBe("K");
        expect(headers["authorization"]).toBeUndefined();
        expect(body["system"]).toBeTypeOf("string");
      } else if (provider === "openai") {
        expect(headers["authorization"]).toBe("Bearer K");
        expect((body["messages"] as Array<{ role: string }>)[0]!.role).toBe("system");
      } else {
        expect(headers["authorization"]).toBeUndefined(); // local ollama needs no key
        expect(body["stream"]).toBe(false);
      }
    }
  });

  it("extracts narration text from each provider's response shape", () => {
    expect(extractText("anthropic", { content: [{ text: "a" }, { text: "b" }] })).toBe("ab");
    expect(extractText("openai", { choices: [{ message: { content: "hi" } }] })).toBe("hi");
    expect(extractText("ollama", { message: { content: "yo" } })).toBe("yo");
    expect(extractText("ollama", {})).toBe(""); // tolerant of an empty shape
  });

  it("a provider failure degrades to the safe fallback (bounded retries) and changes no state", async () => {
    const erroring: NarratorTransport = {
      // eslint-disable-next-line require-yield
      async *stream() {
        throw new Error("provider timed out");
      },
    };
    const port = new LlmNarrativePort(
      { provider: "ollama", endpoint: "http://h", model: "m", apiKey: undefined, timeoutMs: 50, maxRetries: 0 },
      erroring,
    );
    expect(await port.narrate(ctx)).toBe(safeFallbackLine(ctx)); // plain, deterministic, Vault-free
  });

  it("retries up to the bound, then succeeds; the stream concatenates to narrate", async () => {
    let calls = 0;
    const flaky: NarratorTransport = {
      async *stream() {
        calls++;
        if (calls < 2) throw new Error("transient");
        yield "Once ";
        yield "upon";
      },
    };
    const port = new LlmNarrativePort(
      { provider: "ollama", endpoint: "http://h", model: "m", apiKey: undefined, timeoutMs: 50, maxRetries: 2 },
      flaky,
    );
    expect(await port.narrate(ctx)).toBe("Once upon");
    expect(calls).toBe(2); // one retry consumed
  });

  it("only voices the engine's text — it returns text, never a winner/state mutation", async () => {
    // A 'hallucinating' provider claims a bogus result; the port still only returns text.
    const hallucinating: NarratorTransport = {
      async *stream() {
        yield "And the winner is nobody at all.";
      },
    };
    const port = new LlmNarrativePort(
      { provider: "ollama", endpoint: "http://h", model: "m", apiKey: undefined, timeoutMs: 50, maxRetries: 0 },
      hallucinating,
    );
    const text = await port.narrate(ctx);
    expect(typeof text).toBe("string"); // a string — no handle to game state exists on the port
  });
});
