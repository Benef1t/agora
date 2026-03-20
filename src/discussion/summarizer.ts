import type { Discussion } from "./types.js";

function getOllamaHost() { return process.env.OLLAMA_HOST?.trim(); }
function getOllamaModel() { return process.env.OLLAMA_MODEL?.trim() || "qwen3:latest"; }

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
          content: `Generate a concise summary (3-5 paragraphs) for the following discussion. Include:
1. Discussion topic and core questions
2. Key viewpoints from each participant
3. Key disagreements and consensus
4. Summary conclusion

Topic: ${discussion.topic}
Format: ${discussion.format || "roundtable"}

Transcript:
${transcript}`,
        },
      ],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Ollama error ${res.status}: ${text}`);
  }

  const data = await res.json() as { choices: { message: { content: string } }[] };
  return data.choices[0].message.content;
}
