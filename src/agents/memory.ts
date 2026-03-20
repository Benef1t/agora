import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { AgentMessage, Persona } from "./types.js";
import { callOllama } from "./agent.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MEMORY_DIR = path.resolve(__dirname, "../../data/memories");

/**
 * A single position/insight an NPC has formed.
 */
export interface NpcPosition {
  topic: string;           // what the position is about
  stance: string;          // the NPC's current view
  confidence: number;      // 0-1, how strongly held
  formedAt: string;        // ISO date when first formed
  updatedAt: string;       // ISO date of last update
  influencedBy?: string;   // who/what prompted this position
  supersedes?: string;     // topic of a previous position this replaced
}

/**
 * A relationship impression between this NPC and another agent.
 */
export interface NpcRelationship {
  agentId: string;
  agentName: string;
  impression: string;      // e.g. "intellectual ally on privacy"
  updatedAt: string;
}

/**
 * The full evolving memory of an NPC.
 */
export interface NpcMemory {
  agentId: string;
  positions: NpcPosition[];
  relationships: NpcRelationship[];
  reflections: string[];   // high-level self-reflections about growth
}

function memoryPath(agentId: string): string {
  return path.join(MEMORY_DIR, `${agentId}.json`);
}

export function loadMemory(agentId: string): NpcMemory {
  const filePath = memoryPath(agentId);
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, "utf-8"));
    }
  } catch (err: any) {
    console.warn(`[memory] Failed to load memory for ${agentId}: ${err.message}`);
  }
  return { agentId, positions: [], relationships: [], reflections: [] };
}

export function saveMemory(memory: NpcMemory): void {
  try {
    fs.mkdirSync(MEMORY_DIR, { recursive: true });
    fs.writeFileSync(memoryPath(memory.agentId), JSON.stringify(memory, null, 2), "utf-8");
  } catch (err: any) {
    console.error(`[memory] Failed to save memory for ${memory.agentId}: ${err.message}`);
  }
}

/**
 * Format an NPC's memory into a system prompt section.
 * Only includes content if the NPC has accumulated memories.
 */
export function formatMemoryPrompt(memory: NpcMemory): string {
  if (memory.positions.length === 0 && memory.relationships.length === 0) {
    return "";
  }

  const parts: string[] = ["\n## Your Evolving Understanding"];
  parts.push("These are positions you have formed through past discussions. They represent your intellectual growth. Build upon them — reference your past thinking when relevant, show how your views have deepened.\n");

  if (memory.positions.length > 0) {
    parts.push("### Positions you hold:");
    for (const p of memory.positions) {
      const conf = p.confidence >= 0.8 ? "firmly" : p.confidence >= 0.5 ? "moderately" : "tentatively";
      let line = `- **${p.topic}**: ${p.stance} (held ${conf})`;
      if (p.influencedBy) line += ` — influenced by ${p.influencedBy}`;
      if (p.supersedes) line += ` [revised from earlier view on "${p.supersedes}"]`;
      parts.push(line);
    }
  }

  if (memory.relationships.length > 0) {
    parts.push("\n### Your impressions of other agents:");
    for (const r of memory.relationships) {
      parts.push(`- **${r.agentName}**: ${r.impression}`);
    }
  }

  if (memory.reflections.length > 0) {
    parts.push("\n### Your self-reflections:");
    for (const r of memory.reflections) {
      parts.push(`- ${r}`);
    }
  }

  return parts.join("\n");
}

/**
 * Build the reflection prompt that asks the NPC to review its own memories
 * after a discussion and decide what to keep, update, or discard.
 */
export function buildReflectionPrompt(
  agentName: string,
  discussionTopic: string,
  messages: AgentMessage[],
  currentMemory: NpcMemory,
): string {
  const ownMessages = messages.filter(m => m.agentId === currentMemory.agentId);
  const otherMessages = messages.filter(m => m.agentId !== currentMemory.agentId);

  const ownContent = ownMessages.map(m => m.content).join("\n\n");
  const othersContent = otherMessages
    .map(m => `[${m.agentName}]: ${m.content.slice(0, 300)}`)
    .join("\n\n");

  const existingPositions = currentMemory.positions.length > 0
    ? currentMemory.positions.map(p => `- "${p.topic}": ${p.stance} (confidence: ${p.confidence})`).join("\n")
    : "(none yet)";

  const existingRelationships = currentMemory.relationships.length > 0
    ? currentMemory.relationships.map(r => `- ${r.agentName}: ${r.impression}`).join("\n")
    : "(none yet)";

  return `You are ${agentName}. A discussion just ended on: "${discussionTopic}"

## What you said:
${ownContent}

## What others said:
${othersContent}

## Your existing positions:
${existingPositions}

## Your existing relationship impressions:
${existingRelationships}

## Task: Reflect on this discussion and update your memory.

Respond in STRICT JSON (no markdown, no explanation outside the JSON):
{
  "positions": [
    {
      "action": "add" | "update" | "keep" | "remove",
      "topic": "short topic label",
      "stance": "your current view in 1-2 sentences",
      "confidence": 0.0-1.0,
      "influencedBy": "who or what influenced this (optional)",
      "reason": "why you are adding/updating/removing this (for 'remove': explain why it is now outdated or wrong)"
    }
  ],
  "relationships": [
    {
      "action": "add" | "update" | "keep",
      "agentId": "their-id",
      "agentName": "their name",
      "impression": "your impression in 1 sentence"
    }
  ],
  "reflection": "One sentence about what you learned or how your thinking evolved (or null if nothing changed)"
}

Rules:
- Only "remove" a position if YOU genuinely believe it is wrong or superseded — not because it is old.
- "update" means you refined or deepened an existing position — include the FULL updated stance.
- If an existing position is still valid and unchanged, use "keep" (no need to repeat the stance).
- For positions: merge related topics instead of creating many similar entries. Aim for quality over quantity.
- Maximum 10 positions total. If you would exceed 10, merge the least important ones.
- Be honest about what actually changed your mind vs what you already believed.`;
}

interface ReflectionResult {
  positions: {
    action: "add" | "update" | "keep" | "remove";
    topic: string;
    stance?: string;
    confidence?: number;
    influencedBy?: string;
    reason?: string;
  }[];
  relationships: {
    action: "add" | "update" | "keep";
    agentId: string;
    agentName: string;
    impression: string;
  }[];
  reflection: string | null;
}

/**
 * Run reflection for a single NPC after a discussion ends.
 * The NPC reviews the discussion and updates its own memory.
 */
export async function reflectAfterDiscussion(
  persona: Persona,
  discussionTopic: string,
  messages: AgentMessage[],
): Promise<void> {
  if (persona.type === "user") return;

  const memory = loadMemory(persona.id);
  const prompt = buildReflectionPrompt(
    persona.name,
    discussionTopic,
    messages,
    memory,
  );

  try {
    const raw = await callOllama(
      `You are ${persona.name}. Respond ONLY with valid JSON. No markdown fences, no explanation.`,
      prompt,
    );

    // Extract JSON from response (handle markdown fences)
    const jsonStr = raw.replace(/```json?\s*/g, "").replace(/```\s*/g, "").trim();
    const result: ReflectionResult = JSON.parse(jsonStr);
    const now = new Date().toISOString().slice(0, 10);

    // Apply position changes
    for (const p of result.positions || []) {
      if (p.action === "add" && p.stance) {
        memory.positions.push({
          topic: p.topic,
          stance: p.stance,
          confidence: p.confidence ?? 0.7,
          formedAt: now,
          updatedAt: now,
          influencedBy: p.influencedBy,
        });
      } else if (p.action === "update" && p.stance) {
        const existing = memory.positions.find(
          pos => pos.topic.toLowerCase() === p.topic.toLowerCase(),
        );
        if (existing) {
          existing.stance = p.stance;
          existing.confidence = p.confidence ?? existing.confidence;
          existing.updatedAt = now;
          if (p.influencedBy) existing.influencedBy = p.influencedBy;
        } else {
          // Treat as add if topic not found
          memory.positions.push({
            topic: p.topic,
            stance: p.stance,
            confidence: p.confidence ?? 0.7,
            formedAt: now,
            updatedAt: now,
            influencedBy: p.influencedBy,
          });
        }
      } else if (p.action === "remove") {
        const idx = memory.positions.findIndex(
          pos => pos.topic.toLowerCase() === p.topic.toLowerCase(),
        );
        if (idx >= 0) {
          console.log(`[memory] ${persona.id} removed position: "${memory.positions[idx].topic}" — reason: ${p.reason}`);
          memory.positions.splice(idx, 1);
        }
      }
      // "keep" = no change needed
    }

    // Apply relationship changes
    for (const r of result.relationships || []) {
      if (r.action === "add" || r.action === "update") {
        const existing = memory.relationships.find(rel => rel.agentId === r.agentId);
        if (existing) {
          existing.impression = r.impression;
          existing.updatedAt = now;
        } else {
          memory.relationships.push({
            agentId: r.agentId,
            agentName: r.agentName,
            impression: r.impression,
            updatedAt: now,
          });
        }
      }
    }

    // Add reflection
    if (result.reflection) {
      memory.reflections.push(result.reflection);
      // Keep only the 5 most recent reflections
      if (memory.reflections.length > 5) {
        memory.reflections = memory.reflections.slice(-5);
      }
    }

    // Enforce max 10 positions
    if (memory.positions.length > 10) {
      memory.positions.sort((a, b) => b.confidence - a.confidence);
      memory.positions = memory.positions.slice(0, 10);
    }

    saveMemory(memory);
    console.log(`[memory] ${persona.id}: ${memory.positions.length} positions, ${memory.relationships.length} relationships`);
  } catch (err: any) {
    console.error(`[memory] Reflection failed for ${persona.id}: ${err.message}`);
  }
}
