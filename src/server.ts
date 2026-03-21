import dotenv from "dotenv";
dotenv.config({ override: true });
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { Roundtable } from "./discussion/roundtable.js";
import { NPC_PERSONAS, ALL_NPCS } from "./agents/personas/index.js";
import { MockChainAdapter } from "./chain/adapter.js";
import type { ChainAdapter } from "./chain/adapter.js";
import { BaseChainAdapter } from "./chain/base-adapter.js";
import { UserAgentStore } from "./agents/user-store.js";
import type { Persona } from "./agents/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "../public")));

// Use real Base chain adapter when configured, otherwise mock
const chainAdapter: ChainAdapter = process.env.BASE_RPC_URL?.trim()
  ? new BaseChainAdapter()
  : new MockChainAdapter();
const userStore = new UserAgentStore(chainAdapter);

const roundtable = new Roundtable({
  onMessage(msg, discussion) {
    console.log(`[${discussion.id.slice(0, 8)}] ${msg.agentName}: ${msg.content.slice(0, 80)}...`);
    // Push to SSE clients — each NPC message appears immediately
    sseClients.get(discussion.id)?.forEach((res) => {
      res.write(`data: ${JSON.stringify({ type: "message", ...msg })}\n\n`);
    });
  },
  onArchive(discussion) {
    console.log(`[${discussion.id.slice(0, 8)}] Archived: ${discussion.topic}`);
    sseClients.get(discussion.id)?.forEach((res) => {
      res.write(`data: ${JSON.stringify({ type: "archived", summary: discussion.summary })}\n\n`);
    });
  },
  onStatusChange(discussion) {
    // Notify frontend when NPC round completes → discussion is now "open"
    sseClients.get(discussion.id)?.forEach((res) => {
      res.write(`data: ${JSON.stringify({ type: "status", status: discussion.status })}\n\n`);
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
  const { topic, description, npcIds, npcRounds = 1, format, proNpcIds, conNpcIds, hotSeatNpcId } = req.body;
  if (!topic) return res.status(400).json({ error: "topic is required" });

  try {
    const discussion = await roundtable.startDiscussion({
      topic,
      description: description || topic,
      format,
      npcIds,
      npcRounds,
      npcFollowUpCount: 2,
      proNpcIds,
      conNpcIds,
      hotSeatNpcId,
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
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: "text is required" });

  const ollamaHost = process.env.OLLAMA_HOST?.trim();
  const ollamaModel = process.env.OLLAMA_MODEL?.trim() || "qwen3.5:35b";
  if (!ollamaHost) return res.status(500).json({ error: "OLLAMA_HOST not configured" });

  try {
    const url = `${ollamaHost}/v1/chat/completions`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: ollamaModel,
        stream: false,
        messages: [
          {
            role: "user",
            content: `Translate the following text to Chinese (Simplified). Preserve all formatting, markdown, and quote syntax (> @Name: "text"). Only output the translation, nothing else.

Text:
${text}`,
          },
        ],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(500).json({ error: `Ollama error ${response.status}: ${errText}` });
    }

    const data = await response.json() as { choices: { message: { content: string } }[] };
    res.json({ translated: data.choices[0].message.content });
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
