import Anthropic from "@anthropic-ai/sdk";
import type { Discussion } from "./types.js";

let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!_client) _client = new Anthropic();
  return _client;
}

/**
 * Generate a concise summary of a discussion using LLM.
 */
export async function generateSummary(discussion: Discussion): Promise<string> {
  const transcript = discussion.messages
    .map((m) => `[${m.agentName}]: ${m.content}`)
    .join("\n\n");

  const response = await getClient().messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 512,
    messages: [
      {
        role: "user",
        content: `Generate a concise summary (3-5 paragraphs) for the following roundtable discussion. Include:
1. Discussion topic and core questions
2. Key viewpoints from each participant
3. Key disagreements and consensus
4. Summary conclusion

Topic: ${discussion.topic}

Transcript:
${transcript}`,
      },
    ],
  });

  const block = response.content[0];
  if (block.type === "text") return block.text;
  return `Topic: ${discussion.topic}. ${discussion.messages.length} messages total.`;
}
