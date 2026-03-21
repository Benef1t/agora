import type { Discussion } from "./types.js";

function getOllamaHost() { return process.env.OLLAMA_HOST?.trim(); }
function getOllamaModel() { return process.env.OLLAMA_MODEL?.trim() || "qwen3:latest"; }
function getFallbackHost() { return process.env.OLLAMA_FALLBACK_HOST?.trim(); }
function getFallbackModel() { return process.env.OLLAMA_FALLBACK_MODEL?.trim(); }

async function summaryRequest(host: string, model: string, prompt: string): Promise<string> {
  const url = `${host}/v1/chat/completions`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Ollama error ${res.status}: ${text}`);
  }

  const data = await res.json() as { choices: { message: { content: string } }[] };
  return data.choices[0].message.content;
}

/**
 * Generate a concise summary of a discussion using LLM.
 */
export async function generateSummary(discussion: Discussion): Promise<string> {
  const ollamaHost = getOllamaHost();
  if (!ollamaHost) {
    return `Topic: ${discussion.topic}. ${discussion.messages.length} messages total.`;
  }

  const transcript = discussion.messages
    .map((m) => `[${m.agentName}]: ${m.content}`)
    .join("\n\n");

  const prompt = `Generate a concise summary (3-5 paragraphs) for the following discussion. Include:
1. Discussion topic and core questions
2. Key viewpoints from each participant
3. Key disagreements and consensus
4. Summary conclusion

Topic: ${discussion.topic}
Format: ${discussion.format || "roundtable"}

Transcript:
${transcript}`;

  try {
    const result = await summaryRequest(ollamaHost, getOllamaModel(), prompt);
    if (result) return result;
    throw new Error("Empty summary from primary model");
  } catch (err: any) {
    const fbHost = getFallbackHost();
    const fbModel = getFallbackModel();
    if (!fbHost || !fbModel) throw err;
    console.warn(`[summarizer] Primary failed: ${err.message}. Falling back to ${fbModel}@${fbHost}`);
    return summaryRequest(fbHost, fbModel, prompt);
  }
}
