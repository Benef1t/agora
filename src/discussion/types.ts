import type { AgentMessage } from "../agents/types.js";

export type DiscussionStatus = "pending" | "npc_round" | "open" | "archived";

/**
 * Discussion format types:
 * - roundtable: All NPCs discuss freely (default)
 * - debate: Two sides argue for/against a proposition, structured rounds
 * - hearing: One NPC is questioned by others (hot seat)
 * - oracle: NPCs make predictions and stake positions
 */
export type DiscussionFormat = "roundtable" | "debate" | "hearing" | "oracle";

export interface Discussion {
  id: string;
  topic: string;
  description: string;
  format: DiscussionFormat;
  status: DiscussionStatus;
  participants: string[]; // agent IDs
  messages: AgentMessage[];
  createdAt: number;
  updatedAt: number;
  summary?: string; // auto-generated when archived
  // Format-specific metadata
  formatMeta?: {
    // debate: which NPCs are on which side
    proSide?: string[];
    conSide?: string[];
    // hearing: who is in the hot seat
    hotSeatNpc?: string;
    // oracle: prediction outcomes
    predictions?: Record<string, string>;
  };
}

export interface DiscussionConfig {
  topic: string;
  description: string;
  format?: DiscussionFormat;
  npcIds?: string[]; // specific NPCs, or all if omitted
  npcRounds: number; // how many rounds of NPC discussion
  npcFollowUpCount: number; // how many NPCs respond to user messages
  // debate options
  proNpcIds?: string[];
  conNpcIds?: string[];
  // hearing options
  hotSeatNpcId?: string;
}
