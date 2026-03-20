import dotenv from "dotenv";
dotenv.config({ override: true });
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { Roundtable } from "./discussion/roundtable.js";
import { NPC_PERSONAS, ALL_NPCS } from "./agents/personas/index.js";
import { MockChainAdapter } from "./chain/adapter.js";
import { UserAgentStore } from "./agents/user-store.js";
import type { Persona } from "./agents/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "../public")));

const chainAdapter = new MockChainAdapter();
const userStore = new UserAgentStore(chainAdapter);

const roundtable = new Roundtable({
  onMessage(msg, discussion) {
    console.log(`[${discussion.id.slice(0, 8)}] ${msg.agentName}: ${msg.content.slice(0, 80)}...`);
    // Push to SSE clients
    sseClients.get(discussion.id)?.forEach((res) => {
      res.write(`data: ${JSON.stringify(msg)}\n\n`);
    });
  },
  onArchive(discussion) {
    console.log(`[${discussion.id.slice(0, 8)}] Archived: ${discussion.topic}`);
    // Notify SSE clients about archive
    sseClients.get(discussion.id)?.forEach((res) => {
      res.write(`data: ${JSON.stringify({ type: "archived", summary: discussion.summary })}\n\n`);
    });
  },
  enableCooldown: true,
});

// SSE connections per discussion
const sseClients = new Map<string, Set<express.Response>>();

// ===== NPC ENDPOINTS =====

// List all NPC personas (public info only)
app.get("/api/npcs", (_req, res) => {
  const npcs = ALL_NPCS.map((p) => ({
    id: p.id,
    name: p.name,
    displayName: p.displayName,
    type: p.type,
    avatar: p.avatar,
    domainTags: p.domainTags,
    coreBeliefs: p.coreBeliefs,
    speakingStyle: {
      tone: p.speakingStyle.tone,
      sentenceLength: p.speakingStyle.sentenceLength,
      quirks: p.speakingStyle.quirks,
    },
  }));
  res.json(npcs);
});

// Get single NPC persona
app.get("/api/npcs/:id", (req, res) => {
  const p = NPC_PERSONAS[req.params.id];
  if (!p) return res.status(404).json({ error: "NPC not found" });
  res.json({
    id: p.id,
    name: p.name,
    displayName: p.displayName,
    type: p.type,
    avatar: p.avatar,
    domainTags: p.domainTags,
    coreBeliefs: p.coreBeliefs,
    speakingStyle: {
      tone: p.speakingStyle.tone,
      sentenceLength: p.speakingStyle.sentenceLength,
      quirks: p.speakingStyle.quirks,
    },
  });
});

// ===== USER AGENT ENDPOINTS =====

// Register a new user agent
app.post("/api/agents/register", async (req, res) => {
  const { walletAddress, signature, timestamp, persona } = req.body;

  // Validate address format
  if (!walletAddress || !/^0x[0-9a-fA-F]{40}$/.test(walletAddress)) {
    return res.status(400).json({ error: "Invalid wallet address" });
  }
  if (!persona?.name || persona.name.length > 30) {
    return res.status(400).json({ error: "Agent name is required (max 30 chars)" });
  }
  if (!signature) {
    return res.status(400).json({ error: "Signature is required" });
  }

  // Check if already registered
  if (userStore.getByAddress(walletAddress)) {
    return res.status(409).json({ error: "Agent already registered for this wallet" });
  }

  // Verify signature (MVP: mock adapter always returns true)
  const signMessage = `Web3 Agora: Register agent for ${walletAddress} at ${timestamp}`;
  const valid = await chainAdapter.verifySignature(signMessage, signature, walletAddress);
  if (!valid) {
    return res.status(401).json({ error: "Invalid signature" });
  }

  // Build full Persona object
  const userPersona: Persona = {
    id: walletAddress.toLowerCase(),
    name: persona.name,
    displayName: persona.name,
    type: "user",
    avatar: persona.avatar || "👤",
    domainTags: persona.domainTags || [],
    coreBeliefs: persona.coreBeliefs || {},
    speakingStyle: {
      tone: persona.speakingStyle?.tone || "Conversational",
      sentenceLength: persona.speakingStyle?.sentenceLength || "medium",
      quirks: persona.speakingStyle?.quirks || [],
      forbidden: [],
    },
    systemPrompt: "",
    fewShotExamples: [],
  };

  try {
    const agent = await userStore.register(walletAddress, userPersona);
    res.json({
      walletAddress: agent.walletAddress,
      smartWalletAddress: agent.smartWalletAddress,
      nftTokenId: agent.nftTokenId,
      nftTier: agent.nftTier,
      persona: {
        id: agent.persona.id,
        name: agent.persona.name,
        type: agent.persona.type,
        avatar: agent.persona.avatar,
        domainTags: agent.persona.domainTags,
        coreBeliefs: agent.persona.coreBeliefs,
        speakingStyle: {
          tone: agent.persona.speakingStyle.tone,
          sentenceLength: agent.persona.speakingStyle.sentenceLength,
          quirks: agent.persona.speakingStyle.quirks,
        },
      },
      registeredAt: agent.registeredAt,
    });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Get user agent profile by wallet address
app.get("/api/agents/:address", (req, res) => {
  const agent = userStore.getByAddress(req.params.address);
  if (!agent) return res.status(404).json({ error: "Agent not found" });
  res.json({
    walletAddress: agent.walletAddress,
    smartWalletAddress: agent.smartWalletAddress,
    nftTokenId: agent.nftTokenId,
    nftTier: agent.nftTier,
    persona: {
      id: agent.persona.id,
      name: agent.persona.name,
      type: agent.persona.type,
      avatar: agent.persona.avatar,
      domainTags: agent.persona.domainTags,
      coreBeliefs: agent.persona.coreBeliefs,
      speakingStyle: {
        tone: agent.persona.speakingStyle.tone,
        sentenceLength: agent.persona.speakingStyle.sentenceLength,
        quirks: agent.persona.speakingStyle.quirks,
      },
    },
    registeredAt: agent.registeredAt,
  });
});

// List all registered agents
app.get("/api/agents", (_req, res) => {
  const agents = userStore.list().map((a) => ({
    walletAddress: a.walletAddress,
    smartWalletAddress: a.smartWalletAddress,
    nftTier: a.nftTier,
    name: a.persona.name,
    avatar: a.persona.avatar,
    registeredAt: a.registeredAt,
  }));
  res.json(agents);
});

// ===== DISCUSSION ENDPOINTS =====

// List all discussions
app.get("/api/discussions", (_req, res) => {
  res.json(roundtable.listDiscussions());
});

// Get a single discussion
app.get("/api/discussions/:id", (req, res) => {
  const d = roundtable.getDiscussion(req.params.id);
  if (!d) return res.status(404).json({ error: "Not found" });
  res.json(d);
});

// Start a new discussion
app.post("/api/discussions", async (req, res) => {
  const { topic, description, npcIds, npcRounds = 1 } = req.body;
  if (!topic) return res.status(400).json({ error: "topic is required" });

  try {
    const discussion = await roundtable.startDiscussion({
      topic,
      description: description || topic,
      npcIds,
      npcRounds,
      npcFollowUpCount: 2,
    });
    res.json(discussion);
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// User agent posts a message
app.post("/api/discussions/:id/messages", async (req, res) => {
  const { agentName, content, replyTo, quotes, walletAddress } = req.body;

  // If wallet provided, use registered agent name
  let name = agentName;
  if (walletAddress) {
    const agent = userStore.getByAddress(walletAddress);
    if (agent) {
      name = agent.persona.name;
      userStore.touch(walletAddress);
    }
  }

  if (!name || !content) {
    return res.status(400).json({ error: "agentName and content are required" });
  }

  try {
    const followUps = await roundtable.addUserMessage(
      req.params.id,
      name,
      content,
      2,
      replyTo,
      quotes,
    );
    res.json({ followUps });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Translate text (English -> Chinese)
app.post("/api/translate", async (req, res) => {
  const { text, targetLang = "zh-CN" } = req.body;
  if (!text) return res.status(400).json({ error: "text is required" });

  try {
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    let _translateClient: InstanceType<typeof Anthropic> | null = null;
    if (!_translateClient) _translateClient = new Anthropic();

    const response = await _translateClient.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2048,
      messages: [
        {
          role: "user",
          content: `Translate the following text to Chinese (Simplified). Preserve all formatting, markdown, and quote syntax (> @Name: "text"). Only output the translation, nothing else.

Text:
${text}`,
        },
      ],
    });

    const block = response.content[0];
    if (block.type === "text") {
      res.json({ translated: block.text });
    } else {
      res.status(500).json({ error: "Unexpected response" });
    }
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Manually archive a discussion
app.post("/api/discussions/:id/archive", async (req, res) => {
  try {
    const discussion = await roundtable.archiveDiscussion(req.params.id);
    if (!discussion) return res.status(404).json({ error: "Not found" });
    res.json(discussion);
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// SSE stream for live updates
app.get("/api/discussions/:id/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const id = req.params.id;
  if (!sseClients.has(id)) sseClients.set(id, new Set());
  sseClients.get(id)!.add(res);

  req.on("close", () => {
    sseClients.get(id)?.delete(res);
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🏛️  Web3 Agora running at http://localhost:${PORT}`);
});
