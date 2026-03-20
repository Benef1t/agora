import Anthropic from "@anthropic-ai/sdk";
import type { Persona, AgentMessage, AgentContext, QuotedContent } from "./types.js";
import { loadMemory, formatMemoryPrompt } from "./memory.js";

let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!_client) _client = new Anthropic();
  return _client;
}

function getOllamaHost() { return process.env.OLLAMA_HOST?.trim(); }
function getOllamaModel() { return process.env.OLLAMA_MODEL?.trim() || "qwen3:latest"; }

export async function callOllama(system: string, user: string): Promise<string> {
  const url = `${getOllamaHost()}/v1/chat/completions`;
  console.log(`[ollama] POST ${url} model=${getOllamaModel()}`);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: getOllamaModel(),
      stream: false,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
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

const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 3000, 8000]; // ms, exponential-ish backoff

async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      const isLast = attempt === MAX_RETRIES - 1;
      const status = err?.status ?? err?.error?.status;
      const message = err?.message ?? "";
      // Don't retry on 4xx client errors (except 429 rate limit)
      if (status && status >= 400 && status < 500 && status !== 429) {
        throw err;
      }
      // Don't retry on authentication/configuration errors
      if (message.includes("authentication") || message.includes("apiKey") || message.includes("authToken")) {
        throw err;
      }
      if (isLast) throw err;
      const delay = RETRY_DELAYS[attempt];
      console.warn(
        `[retry] ${label} attempt ${attempt + 1} failed: ${err.message ?? err}. Retrying in ${delay}ms...`,
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error("unreachable");
}

function buildSystemPrompt(persona: Persona): string {
  const beliefs = Object.entries(persona.coreBeliefs)
    .map(([k, v]) => `- ${k}: ${v >= 0.8 ? "strong conviction" : v >= 0.5 ? "moderate" : "skeptical"} (${v})`)
    .join("\n");

  const examples = persona.fewShotExamples
    .map((e) => `Topic: ${e.topic}\n${persona.name}: ${e.response}`)
    .join("\n\n");

  // Load evolving memory for this NPC
  const memory = persona.type !== "user" ? loadMemory(persona.id) : null;
  const memoryPrompt = memory ? formatMemoryPrompt(memory) : "";

  return `${persona.systemPrompt}

## Core Beliefs (conviction 0-1)
${beliefs}

## Speaking Style
- Tone: ${persona.speakingStyle.tone}
- Sentence length: ${persona.speakingStyle.sentenceLength}
- Quirks: ${persona.speakingStyle.quirks.join("; ")}

## Never Say
${persona.speakingStyle.forbidden.map((f) => `- ${f}`).join("\n")}

## Example Responses
${examples}
${memoryPrompt}
## Rules
- ALWAYS respond in English
- Stay in character at all times
- Keep responses to 2-4 paragraphs — be substantive but concise
- IMPORTANT: When referencing or replying to another agent, you MUST use the quote format on its own line: > @AgentName: "quoted excerpt"
  Then write your response on the next line. Example:
  > @Satoshi Nakamoto: "privacy is a fundamental right"
  I agree with this position because...
- You may quote multiple people using multiple > lines
- Only quote the most relevant sentence or phrase, not entire paragraphs
- NEVER just mention someone's name without quoting them — always use the > @Name: "quote" format
- Do not give investment advice or price predictions
- Engage directly with others' arguments — agree, disagree, or build upon them
- Bring your unique perspective; do not repeat what others have already said
- If in a DEBATE, argue your assigned side passionately but fairly
- If in a HEARING, ask probing questions (as questioner) or defend thoroughly (as hot seat)
- If in an ORACLE council, commit to specific predictions with reasoning`;
}

function buildUserPrompt(context: AgentContext): string {
  const history = context.discussionHistory
    .map((m) => `[${m.agentName} (msg:${m.id})]: ${m.content}`)
    .join("\n\n");

  return `Current discussion topic: ${context.currentTopic}

${history ? `## Previous Discussion\n${history}\n\n` : ""}Respond as ${context.persona.name}.${
    context.discussionHistory.length > 0
      ? " Reply to the point(s) you find most worth responding to. Use > @Name: \"quoted text\" to quote specific parts of their message before your response."
      : " Give your opening statement on this topic."
  }`;
}

/**
 * Parse > @Name: "quoted text" lines from LLM output.
 * Returns extracted quotes and the cleaned content without quote lines.
 */
export function parseQuotes(
  rawContent: string,
  history: AgentMessage[],
): { content: string; quotes: QuotedContent[] } {
  const quotes: QuotedContent[] = [];
  const lines = rawContent.split("\n");
  const contentLines: string[] = [];

  for (const line of lines) {
    // Match: > @AgentName: "quoted text" or > @AgentName: "quoted text"
    const quoteMatch = line.match(
      /^>\s*@([^:]+):\s*["\u201c]([^"\u201d]+)["\u201d]/,
    );
    if (quoteMatch) {
      const quotedName = quoteMatch[1].trim();
      const excerpt = quoteMatch[2].trim();
      // Find the source message
      const sourceMsg = [...history].reverse().find(
        (m) =>
          m.agentName === quotedName ||
          m.agentName.toLowerCase() === quotedName.toLowerCase() ||
          m.agentId === quotedName,
      );
      quotes.push({
        messageId: sourceMsg?.id ?? "",
        agentName: quotedName,
        excerpt,
      });
      contentLines.push(line); // keep the quote line in content for display
    } else {
      contentLines.push(line);
    }
  }

  return {
    content: contentLines.join("\n").trim(),
    quotes,
  };
}

export async function generateResponse(context: AgentContext): Promise<string> {
  const label = `generateResponse(${context.persona.id})`;
  const system = buildSystemPrompt(context.persona);
  const user = buildUserPrompt(context);
  console.log(`[agent] Calling Ollama (${getOllamaModel()} @ ${getOllamaHost()}) for ${context.persona.id}`);
  return withRetry(() => callOllama(system, user), label);
}
