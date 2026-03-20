import type { Persona } from "../agents/types.js";

function getOllamaHost() { return process.env.OLLAMA_HOST?.trim(); }
function getOllamaModel() { return process.env.OLLAMA_MODEL?.trim() || "qwen3:latest"; }

const MAX_RETRIES = 2;
const RETRY_DELAYS = [1000, 3000];

/**
 * Extract topic tags from a user message using LLM,
 * then match to the most relevant NPCs by domain overlap.
 */
export async function matchNPCs(
  message: string,
  npcs: Persona[],
  count: number,
): Promise<Persona[]> {
  let tags: string[] = [];

  try {
    tags = await extractTagsWithRetry(message);
  } catch (err: any) {
    console.warn(`[matcher] Tag extraction failed, falling back to random: ${err.message ?? err}`);
    return pickRandom(npcs, count);
  }

  if (tags.length === 0) return pickRandom(npcs, count);

  // Score each NPC by domain tag overlap
  const scored = npcs.map((npc) => {
    const overlap = tags.filter((tag) =>
      npc.domainTags.some(
        (dt) => dt.includes(tag) || tag.includes(dt),
      ),
    ).length;
    return { npc, score: overlap };
  });

  scored.sort((a, b) => b.score - a.score);

  // If top scores are all 0, pick random
  if (scored[0].score === 0) return pickRandom(npcs, count);

  return scored.slice(0, count).map((s) => s.npc);
}

async function extractTagsWithRetry(message: string): Promise<string[]> {
  const ollamaHost = getOllamaHost();
  if (!ollamaHost) throw new Error("OLLAMA_HOST not configured");

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const url = `${ollamaHost}/v1/chat/completions`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: getOllamaModel(),
          stream: false,
          messages: [
            {
              role: "user",
              content: `Extract 3-5 Web3/blockchain-related keyword tags from the following message (lowercase English, comma-separated).
Return only the tags, nothing else. No explanation.

Message: "${message}"`,
            },
          ],
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Ollama error ${res.status}: ${text}`);
      }

      const data = await res.json() as { choices: { message: { content: string } }[] };
      const text = data.choices[0].message.content;

      return text
        .toLowerCase()
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
    } catch (err: any) {
      const isLast = attempt === MAX_RETRIES - 1;
      if (isLast) throw err;
      const delay = RETRY_DELAYS[attempt];
      console.warn(`[matcher] attempt ${attempt + 1} failed: ${err.message ?? err}. Retrying in ${delay}ms...`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  return [];
}

function pickRandom<T>(arr: T[], count: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}
