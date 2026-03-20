/**
 * Demo script — runs a roundtable discussion in the terminal.
 * Usage: npm run demo
 */
import dotenv from "dotenv";
dotenv.config({ override: true });
import { Roundtable } from "./discussion/roundtable.js";

const topic = process.argv[2] || "Crypto 的未来：2030 年加密货币会走向何方？";

console.log("🏛️  Web3 Agora — Terminal Demo");
console.log("━".repeat(60));
console.log(`📋 主题: ${topic}`);
console.log("━".repeat(60));
console.log();

const roundtable = new Roundtable({
  onMessage(msg) {
    console.log(`${getAvatar(msg.agentId)} [${msg.agentName}]`);
    console.log(msg.content);
    console.log();
    console.log("─".repeat(60));
    console.log();
  },
});

function getAvatar(id: string): string {
  const map: Record<string, string> = {
    satoshi: "🥷",
    "bitcoin-chain": "₿",
    "ethereum-chain": "⟠",
    turing: "🖥️",
    einstein: "🧠",
  };
  return map[id] || "👤";
}

async function main() {
  console.log("⏳ NPC 圆桌讨论开始...\n");

  const discussion = await roundtable.startDiscussion({
    topic,
    description: topic,
    npcRounds: 1,
    npcFollowUpCount: 2,
  });

  console.log("━".repeat(60));
  console.log(`✅ 讨论完成！共 ${discussion.messages.length} 条发言`);
  console.log(`📌 讨论 ID: ${discussion.id}`);
  console.log(`📊 状态: ${discussion.status}`);

  // Simulate a user message
  console.log();
  console.log("━".repeat(60));
  console.log("👤 模拟用户 Agent 加入讨论...");
  console.log("━".repeat(60));
  console.log();

  const userMessage = "我认为 ZK rollup 才是真正的未来，它能同时解决隐私和扩展性问题。各位怎么看？";
  console.log(`👤 [测试用户]: ${userMessage}`);
  console.log();
  console.log("─".repeat(60));
  console.log();

  const followUps = await roundtable.addUserMessage(
    discussion.id,
    "测试用户",
    userMessage,
  );

  console.log("━".repeat(60));
  console.log(`✅ ${followUps.length} 个 NPC 进行了跟进回复`);
}

main().catch(console.error);
