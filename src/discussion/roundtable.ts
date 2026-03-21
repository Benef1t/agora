import { v4 as uuid } from "uuid";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { AgentMessage, Persona } from "../agents/types.js";
import type { Discussion, DiscussionConfig, DiscussionFormat } from "./types.js";
import { generateResponse, parseQuotes } from "../agents/agent.js";
import { generateSummary } from "./summarizer.js";
import { ALL_NPCS, NPC_PERSONAS } from "../agents/personas/index.js";
import { matchNPCs } from "./matcher.js";
import { reflectAfterDiscussion } from "../agents/memory.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.resolve(__dirname, "../../data/discussions.json");

export type MessageCallback = (msg: AgentMessage, discussion: Discussion) => void;
export type ArchiveCallback = (discussion: Discussion) => void;
export type StatusChangeCallback = (discussion: Discussion) => void;

const COOLDOWN_MS = 30 * 60 * 1000;
const COOLDOWN_CHECK_INTERVAL_MS = 60 * 1000;
const DEFAULT_PARTICIPANT_COUNT = 5;

function shuffle<T>(arr: T[]): T[] {
  return [...arr].sort(() => Math.random() - 0.5);
}

export class Roundtable {
  private discussions: Map<string, Discussion> = new Map();
  private onMessage?: MessageCallback;
  private onArchive?: ArchiveCallback;
  private onStatusChange?: StatusChangeCallback;
  private cooldownTimer?: ReturnType<typeof setInterval>;

  constructor(opts?: {
    onMessage?: MessageCallback;
    onArchive?: ArchiveCallback;
    onStatusChange?: StatusChangeCallback;
    enableCooldown?: boolean;
  }) {
    this.onMessage = opts?.onMessage;
    this.onArchive = opts?.onArchive;
    this.onStatusChange = opts?.onStatusChange;
    this.loadFromDisk();
    if (opts?.enableCooldown !== false) {
      this.startCooldownChecker();
    }
  }

  private loadFromDisk() {
    try {
      if (!fs.existsSync(DATA_FILE)) return;
      const raw = fs.readFileSync(DATA_FILE, "utf-8");
      const records: Discussion[] = JSON.parse(raw);
      for (const d of records) {
        // Backward compat: old discussions may lack format field
        if (!d.format) d.format = "roundtable";
        this.discussions.set(d.id, d);
      }
      console.log(`[roundtable] Loaded ${this.discussions.size} discussions from disk.`);
    } catch (err: any) {
      console.warn(`[roundtable] Could not load discussions from disk: ${err.message}`);
    }
  }

  private saveToDisk() {
    try {
      const records = Array.from(this.discussions.values());
      fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
      fs.writeFileSync(DATA_FILE, JSON.stringify(records, null, 2), "utf-8");
    } catch (err: any) {
      console.error(`[roundtable] Failed to save discussions to disk: ${err.message}`);
    }
  }

  private startCooldownChecker() {
    this.cooldownTimer = setInterval(() => {
      this.checkAndArchiveIdle();
    }, COOLDOWN_CHECK_INTERVAL_MS);
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
    this.saveToDisk();
    console.log(`[roundtable] Discussion ${discussionId.slice(0, 8)} archived.`);
    this.onArchive?.(discussion);

    // Run NPC reflection in background — each NPC reviews the discussion
    // and updates their evolving memory (positions, relationships, reflections)
    const participantNpcs = discussion.participants
      .map((id) => NPC_PERSONAS[id])
      .filter((p) => p && p.type !== "user");
    for (const npc of participantNpcs) {
      reflectAfterDiscussion(npc, discussion.topic, discussion.messages).catch((err) => {
        console.error(`[roundtable] Reflection failed for ${npc.id}: ${err.message ?? err}`);
      });
    }

    return discussion;
  }

  dispose() {
    if (this.cooldownTimer) clearInterval(this.cooldownTimer);
  }

  // ==================== NPC message helper ====================
  private async generateNpcMessage(
    npc: Persona,
    discussion: Discussion,
    topicOverride?: string,
  ): Promise<AgentMessage | null> {
    try {
      const rawContent = await generateResponse({
        persona: npc,
        discussionHistory: discussion.messages,
        currentTopic: topicOverride ?? `${discussion.topic}\n${discussion.description}`,
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
      return msg;
    } catch (err: any) {
      console.error(`[roundtable] NPC ${npc.id} failed: ${err.message ?? err}`);
      return null;
    }
  }

  // ==================== DISCUSSION STARTERS ====================

  async startDiscussion(config: DiscussionConfig): Promise<Discussion> {
    const format = config.format ?? "roundtable";

    switch (format) {
      case "debate":
        return this.startDebate(config);
      case "hearing":
        return this.startHearing(config);
      case "oracle":
        return this.startOracle(config);
      default:
        return this.startRoundtable(config);
    }
  }

  // ---- Select NPCs by topic relevance (or use specified IDs) ----
  private async selectNPCs(config: DiscussionConfig, count?: number): Promise<Persona[]> {
    if (config.npcIds) {
      return config.npcIds.map((id) => NPC_PERSONAS[id]).filter(Boolean);
    }
    const topicText = `${config.topic} ${config.description}`;
    return matchNPCs(topicText, ALL_NPCS, count ?? DEFAULT_PARTICIPANT_COUNT);
  }

  // ---- Roundtable (original format) ----
  private async startRoundtable(config: DiscussionConfig): Promise<Discussion> {
    const npcs = await this.selectNPCs(config);

    const discussion: Discussion = {
      id: uuid(),
      topic: config.topic,
      description: config.description,
      format: "roundtable",
      status: "npc_round",
      participants: npcs.map((n) => n.id),
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.discussions.set(discussion.id, discussion);

    // Generate NPC messages in background — each is pushed via SSE as it completes
    this.generateNpcRoundsInBackground(discussion, npcs, config.npcRounds);

    return discussion;
  }

  /**
   * Generate NPC messages in background. Each message is pushed to SSE as it completes.
   * When all rounds finish, discussion status changes to "open" and an SSE event is sent.
   */
  private async generateNpcRoundsInBackground(
    discussion: Discussion,
    npcs: Persona[],
    rounds: number,
    messageSpecs?: { npc: Persona; topicOverride?: string }[],
  ): Promise<void> {
    const specs: { npc: Persona; topicOverride?: string }[] = messageSpecs ??
      Array.from({ length: rounds }, () => shuffle(npcs).map((npc) => ({ npc }))).flat();

    (async () => {
      for (const spec of specs) {
        await this.generateNpcMessage(spec.npc, discussion, spec.topicOverride);
      }
      discussion.status = "open";
      discussion.updatedAt = Date.now();
      this.saveToDisk();
      // Notify SSE clients that NPC round is complete
      this.onStatusChange?.(discussion);
      console.log(`[roundtable] Discussion ${discussion.id.slice(0, 8)} NPC round complete, now open.`);
    })().catch((err) => {
      console.error(`[roundtable] Background generation failed: ${err.message ?? err}`);
      discussion.status = "open";
      discussion.updatedAt = Date.now();
      this.saveToDisk();
      this.onStatusChange?.(discussion);
    });
  }

  // ---- Debate: two sides argue for/against ----
  private async startDebate(config: DiscussionConfig): Promise<Discussion> {
    const allNpcs = await this.selectNPCs(config);

    let proNpcs: Persona[];
    let conNpcs: Persona[];
    if (config.proNpcIds && config.conNpcIds) {
      proNpcs = config.proNpcIds.map((id) => NPC_PERSONAS[id]).filter(Boolean);
      conNpcs = config.conNpcIds.map((id) => NPC_PERSONAS[id]).filter(Boolean);
    } else {
      const shuffled = shuffle(allNpcs);
      const mid = Math.ceil(shuffled.length / 2);
      proNpcs = shuffled.slice(0, mid);
      conNpcs = shuffled.slice(mid);
    }

    const discussion: Discussion = {
      id: uuid(),
      topic: config.topic,
      description: config.description,
      format: "debate",
      status: "npc_round",
      participants: [...proNpcs, ...conNpcs].map((n) => n.id),
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      formatMeta: {
        proSide: proNpcs.map((n) => n.id),
        conSide: conNpcs.map((n) => n.id),
      },
    };
    this.discussions.set(discussion.id, discussion);

    const proNames = proNpcs.map((n) => n.name).join(", ");
    const conNames = conNpcs.map((n) => n.name).join(", ");

    // Build message specs for all rounds
    const specs: { npc: Persona; topicOverride?: string }[] = [];
    for (let round = 0; round < config.npcRounds; round++) {
      const roundLabel = round === 0 ? "opening statement" : "rebuttal";
      for (const npc of shuffle(proNpcs)) {
        specs.push({
          npc,
          topicOverride: `DEBATE FORMAT — You are arguing FOR the proposition: "${config.topic}"\n${config.description}\n\nYour side (FOR): ${proNames}\nOpposing side (AGAINST): ${conNames}\nThis is your ${roundLabel}. Make your strongest case.`,
        });
      }
      for (const npc of shuffle(conNpcs)) {
        specs.push({
          npc,
          topicOverride: `DEBATE FORMAT — You are arguing AGAINST the proposition: "${config.topic}"\n${config.description}\n\nYour side (AGAINST): ${conNames}\nOpposing side (FOR): ${proNames}\nThis is your ${roundLabel}. Counter the arguments made.`,
        });
      }
    }

    this.generateNpcRoundsInBackground(discussion, allNpcs, config.npcRounds, specs);
    return discussion;
  }

  // ---- Hearing: one NPC in the hot seat, others question ----
  private async startHearing(config: DiscussionConfig): Promise<Discussion> {
    const allNpcs = await this.selectNPCs(config);

    const hotSeatId = config.hotSeatNpcId || shuffle(allNpcs)[0].id;
    const hotSeatNpc = NPC_PERSONAS[hotSeatId];
    const questioners = allNpcs.filter((n) => n.id !== hotSeatId);

    const discussion: Discussion = {
      id: uuid(),
      topic: config.topic,
      description: config.description,
      format: "hearing",
      status: "npc_round",
      participants: allNpcs.map((n) => n.id),
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      formatMeta: {
        hotSeatNpc: hotSeatId,
      },
    };
    this.discussions.set(discussion.id, discussion);

    // Build message specs: opening → Q&A rounds
    const specs: { npc: Persona; topicOverride?: string }[] = [];
    specs.push({
      npc: hotSeatNpc,
      topicOverride: `HEARING FORMAT — You are in the hot seat being questioned about: "${config.topic}"\n${config.description}\n\nGive your opening statement. The following agents will question you: ${questioners.map((n) => n.name).join(", ")}. Defend your position clearly.`,
    });
    for (const questioner of shuffle(questioners)) {
      specs.push({
        npc: questioner,
        topicOverride: `HEARING FORMAT — You are questioning ${hotSeatNpc.name} about: "${config.topic}"\n${config.description}\n\nAsk a probing, challenging question based on what ${hotSeatNpc.name} has said. Be direct and push for specifics.`,
      });
      specs.push({
        npc: hotSeatNpc,
        topicOverride: `HEARING FORMAT — You are in the hot seat. ${questioner.name} just questioned you about: "${config.topic}"\n\nRespond to their question directly. Defend your position.`,
      });
    }

    this.generateNpcRoundsInBackground(discussion, allNpcs, 1, specs);
    return discussion;
  }

  // ---- Oracle: NPCs make predictions ----
  private async startOracle(config: DiscussionConfig): Promise<Discussion> {
    const npcs = await this.selectNPCs(config);

    const discussion: Discussion = {
      id: uuid(),
      topic: config.topic,
      description: config.description,
      format: "oracle",
      status: "npc_round",
      participants: npcs.map((n) => n.id),
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      formatMeta: {
        predictions: {},
      },
    };
    this.discussions.set(discussion.id, discussion);

    // Build specs: prediction round + reaction round
    const specs: { npc: Persona; topicOverride?: string }[] = [];
    for (const npc of shuffle(npcs)) {
      specs.push({
        npc,
        topicOverride: `ORACLE COUNCIL — Make your prediction about: "${config.topic}"\n${config.description}\n\nStructure your response as:\n1. Your prediction (be specific — include timeframe, outcome, and confidence level)\n2. Your reasoning (why you believe this, based on your domain expertise)\n3. Key risks that could invalidate your prediction\n\nBe bold. Oracles must commit to a position.`,
      });
    }
    for (const npc of shuffle(npcs)) {
      specs.push({
        npc,
        topicOverride: `ORACLE COUNCIL — Review the other predictions about: "${config.topic}"\n\nChallenge or support the predictions you find most interesting. Which oracle do you agree/disagree with most, and why? What are they missing?`,
      });
    }

    this.generateNpcRoundsInBackground(discussion, npcs, 1, specs);
    return discussion;
  }

  // ==================== USER MESSAGE ====================

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

    const availableNPCs = ALL_NPCS.filter((n) =>
      discussion.participants.includes(n.id),
    );
    const respondents = await matchNPCs(content, availableNPCs, followUpCount);

    const followUps: AgentMessage[] = [];
    for (const npc of respondents) {
      const msg = await this.generateNpcMessage(npc, discussion);
      if (msg) followUps.push(msg);
    }

    this.saveToDisk();
    return followUps;
  }

  getDiscussion(id: string): Discussion | undefined {
    return this.discussions.get(id);
  }

  listDiscussions(): Discussion[] {
    return Array.from(this.discussions.values());
  }
}
