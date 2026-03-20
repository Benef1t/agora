import { v4 as uuid } from "uuid";
import type { AgentMessage } from "../agents/types.js";
import type { Discussion, DiscussionConfig } from "./types.js";
import { generateResponse, parseQuotes } from "../agents/agent.js";
import { generateSummary } from "./summarizer.js";
import { ALL_NPCS, NPC_PERSONAS } from "../agents/personas/index.js";
import { matchNPCs } from "./matcher.js";

export type MessageCallback = (msg: AgentMessage, discussion: Discussion) => void;
export type ArchiveCallback = (discussion: Discussion) => void;

const COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes
const COOLDOWN_CHECK_INTERVAL_MS = 60 * 1000; // check every 1 minute

export class Roundtable {
  private discussions: Map<string, Discussion> = new Map();
  private onMessage?: MessageCallback;
  private onArchive?: ArchiveCallback;
  private cooldownTimer?: ReturnType<typeof setInterval>;

  constructor(opts?: {
    onMessage?: MessageCallback;
    onArchive?: ArchiveCallback;
    enableCooldown?: boolean;
  }) {
    this.onMessage = opts?.onMessage;
    this.onArchive = opts?.onArchive;
    if (opts?.enableCooldown !== false) {
      this.startCooldownChecker();
    }
  }

  /**
   * Periodically check for idle discussions and archive them.
   */
  private startCooldownChecker() {
    this.cooldownTimer = setInterval(() => {
      this.checkAndArchiveIdle();
    }, COOLDOWN_CHECK_INTERVAL_MS);
    // Allow the process to exit even if the timer is still active
    if (this.cooldownTimer.unref) this.cooldownTimer.unref();
  }

  private async checkAndArchiveIdle() {
    const now = Date.now();
    for (const discussion of this.discussions.values()) {
      if (discussion.status !== "open") continue;
      if (now - discussion.updatedAt >= COOLDOWN_MS) {
        await this.archiveDiscussion(discussion.id);
      }
    }
  }

  /**
   * Archive a discussion: generate summary, set status to archived.
   */
  async archiveDiscussion(discussionId: string): Promise<Discussion | undefined> {
    const discussion = this.discussions.get(discussionId);
    if (!discussion || discussion.status === "archived") return discussion;

    try {
      discussion.summary = await generateSummary(discussion);
    } catch (err: any) {
      console.error(`[roundtable] Summary generation failed for ${discussionId}: ${err.message ?? err}`);
      discussion.summary = `Topic: ${discussion.topic}. ${discussion.messages.length} messages total.`;
    }

    discussion.status = "archived";
    discussion.updatedAt = Date.now();
    console.log(`[roundtable] Discussion ${discussionId.slice(0, 8)} archived.`);
    this.onArchive?.(discussion);
    return discussion;
  }

  dispose() {
    if (this.cooldownTimer) clearInterval(this.cooldownTimer);
  }

  /**
   * Create a new discussion and run the initial NPC rounds.
   */
  async startDiscussion(config: DiscussionConfig): Promise<Discussion> {
    const npcs = config.npcIds
      ? config.npcIds.map((id) => NPC_PERSONAS[id]).filter(Boolean)
      : ALL_NPCS;

    const discussion: Discussion = {
      id: uuid(),
      topic: config.topic,
      description: config.description,
      status: "npc_round",
      participants: npcs.map((n) => n.id),
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.discussions.set(discussion.id, discussion);

    // Run NPC rounds
    for (let round = 0; round < config.npcRounds; round++) {
      for (const npc of npcs) {
        try {
          const rawContent = await generateResponse({
            persona: npc,
            discussionHistory: discussion.messages,
            currentTopic: `${config.topic}\n${config.description}`,
          });

          const { content, quotes } = parseQuotes(rawContent, discussion.messages);

          const msg: AgentMessage = {
            id: uuid(),
            agentId: npc.id,
            agentName: npc.name,
            content,
            timestamp: Date.now(),
            quotes: quotes.length > 0 ? quotes : undefined,
            replyTo: quotes.length > 0 ? quotes[0].messageId : undefined,
          };

          discussion.messages.push(msg);
          discussion.updatedAt = Date.now();
          this.onMessage?.(msg, discussion);
        } catch (err: any) {
          console.error(`[roundtable] NPC ${npc.id} failed in round ${round + 1}: ${err.message ?? err}`);
        }
      }
    }

    discussion.status = "open";
    discussion.updatedAt = Date.now();
    return discussion;
  }

  /**
   * Handle a user agent's message — triggers NPC follow-ups.
   */
  async addUserMessage(
    discussionId: string,
    agentName: string,
    content: string,
    followUpCount = 2,
    replyTo?: string,
    quotes?: { messageId: string; agentName: string; excerpt: string }[],
  ): Promise<AgentMessage[]> {
    const discussion = this.discussions.get(discussionId);
    if (!discussion) throw new Error(`Discussion ${discussionId} not found`);
    if (discussion.status !== "open") throw new Error("Discussion is not open");

    // Add user message
    const userMsg: AgentMessage = {
      id: uuid(),
      agentId: `user-${agentName}`,
      agentName,
      content,
      timestamp: Date.now(),
      replyTo,
      quotes: quotes && quotes.length > 0 ? quotes : undefined,
    };
    discussion.messages.push(userMsg);
    discussion.updatedAt = Date.now();
    this.onMessage?.(userMsg, discussion);

    // Match relevant NPCs to follow up
    const availableNPCs = ALL_NPCS.filter((n) =>
      discussion.participants.includes(n.id),
    );
    const respondents = await matchNPCs(content, availableNPCs, followUpCount);

    const followUps: AgentMessage[] = [];
    for (const npc of respondents) {
      try {
        const rawResponse = await generateResponse({
          persona: npc,
          discussionHistory: discussion.messages,
          currentTopic: `${discussion.topic}\n${discussion.description}`,
        });

        const { content, quotes: parsedQuotes } = parseQuotes(rawResponse, discussion.messages);

        const msg: AgentMessage = {
          id: uuid(),
          agentId: npc.id,
          agentName: npc.name,
          content,
          replyTo: parsedQuotes.length > 0 ? parsedQuotes[0].messageId : userMsg.id,
          quotes: parsedQuotes.length > 0 ? parsedQuotes : undefined,
          timestamp: Date.now(),
        };

        discussion.messages.push(msg);
        discussion.updatedAt = Date.now();
        followUps.push(msg);
        this.onMessage?.(msg, discussion);
      } catch (err: any) {
        console.error(`[roundtable] NPC ${npc.id} follow-up failed: ${err.message ?? err}`);
      }
    }

    return followUps;
  }

  getDiscussion(id: string): Discussion | undefined {
    return this.discussions.get(id);
  }

  listDiscussions(): Discussion[] {
    return Array.from(this.discussions.values());
  }
}
