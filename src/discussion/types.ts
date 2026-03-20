import type { AgentMessage } from "../agents/types.js";

export type DiscussionStatus = "pending" | "npc_round" | "open" | "archived";

export interface Discussion {
  id: string;
  topic: string;
  description: string;
  status: DiscussionStatus;
  participants: string[]; // agent IDs
  messages: AgentMessage[];
  createdAt: number;
  updatedAt: number;
  summary?: string; // auto-generated when archived
}

export interface DiscussionConfig {
  topic: string;
  description: string;
  npcIds?: string[]; // specific NPCs, or all if omitted
  npcRounds: number; // how many rounds of NPC discussion
  npcFollowUpCount: number; // how many NPCs respond to user messages
}
