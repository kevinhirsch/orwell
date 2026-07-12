import { BASE_GAME_MASTER_PROMPT, MOMENT_PROMPTS, buildSystemPrompt } from "./src/engine/momentPrompts";
import { GameSessionAdapter } from "./src/adapters/engine/GameSessionAdapter";

const approxTok = (s: string) => Math.round(s.length / 4);
const row = (label: string, s: string) =>
  console.log(`${label.padEnd(30)} chars=${String(s.length).padStart(6)}  ~tok=${String(approxTok(s)).padStart(6)}`);

console.log("=== RAW PIECES ===");
row("BASE_GAME_MASTER_PROMPT", BASE_GAME_MASTER_PROMPT);
let fragTotal = 0;
for (const k of Object.keys(MOMENT_PROMPTS)) { row(`fragment:${k}`, MOMENT_PROMPTS[k]!); fragTotal += MOMENT_PROMPTS[k]!.length; }
console.log(`(sum of all fragment chars: ${fragTotal})`);

console.log("\n=== ASSEMBLED (buildSystemPrompt) ===");
const g1 = new GameSessionAdapter();
row("assembled:character-creation", buildSystemPrompt("character-creation", g1.getGameState()));

const g2 = new GameSessionAdapter();
g2.createCharacter({ playerName: "The Player", seed: 7 });
const liveView = g2.getGameState();
row("assembled:premiere", buildSystemPrompt("premiere", liveView));
row("assembled:social(in-game)", buildSystemPrompt("social", liveView));
row("assembled:nominations", buildSystemPrompt("nominations", liveView));
row("assembled:eviction", buildSystemPrompt("eviction", liveView));
row("assembled:default", buildSystemPrompt("default", liveView));
