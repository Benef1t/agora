/**
 * Persona type system for NPC agents.
 *
 * The agent personality calibration methodology used here — including
 * coreBeliefs with conviction scores (0–1), speakingStyle with quirks/
 * forbidden constraints, and few-shot examples for behavioral grounding —
 * is inspired by the SocioVerse framework:
 *
 *   Zhang, X. et al. "SocioVerse: A World Model for Social Simulation
 *   Powered by LLM Agents and A Pool of 10 Million Real-World Users."
 *   arXiv:2504.10157 (2025). https://arxiv.org/abs/2504.10157
 *   GitHub: https://github.com/FudanDISC/SocioVerse (Apache-2.0)
 */
export interface Persona {
  id: string;
  name: string;
  displayName: string;
  type: "historical" | "chain" | "user";
  avatar: string;
  domainTags: string[];
  coreBeliefs: Record<string, number>; // belief → conviction 0-1
  speakingStyle: SpeakingStyle;
  systemPrompt: string;
  fewShotExamples: FewShotExample[];
}

export interface SpeakingStyle {
  tone: string;
  sentenceLength: "short" | "medium" | "long";
  quirks: string[]; // unique speech patterns
  forbidden: string[]; // things this agent would never say
}

export interface FewShotExample {
  topic: string;
  response: string;
}

export interface QuotedContent {
  messageId: string; // ID of the message being quoted
  agentName: string; // who said it
  excerpt: string; // the quoted text excerpt
}

export interface AgentMessage {
  id: string; // unique message ID
  agentId: string;
  agentName: string;
  content: string;
  timestamp: number;
  replyTo?: string; // message ID being replied to
  quotes?: QuotedContent[]; // quoted excerpts from other messages
}

export type NFTTier = "bronze" | "silver" | "gold" | "genesis";

export interface UserAgent {
  walletAddress: string;       // EOA address (0x...)
  smartWalletAddress: string;  // EIP-4337 deployed wallet
  nftTokenId: string;          // certification NFT token ID
  nftTier: NFTTier;
  persona: Persona;            // user-created persona with type: "user"
  registeredAt: number;
  lastActiveAt: number;
}

export interface AgentContext {
  persona: Persona;
  discussionHistory: AgentMessage[];
  currentTopic: string;
}
