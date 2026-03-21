import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import type { Persona, UserAgent } from "./types.js";
import type { ChainAdapter } from "../chain/adapter.js";

const DATA_FILE = resolve(process.cwd(), "data/agents.json");

/**
 * Persistent store for registered user agents.
 * Each user is keyed by their lowercase EOA wallet address.
 * Data is persisted to data/agents.json.
 */
export class UserAgentStore {
  private agents: Map<string, UserAgent> = new Map();
  private chainAdapter: ChainAdapter;

  constructor(chainAdapter: ChainAdapter) {
    this.chainAdapter = chainAdapter;
    this.load();
  }

  private load(): void {
    try {
      if (existsSync(DATA_FILE)) {
        const data = JSON.parse(readFileSync(DATA_FILE, "utf-8")) as UserAgent[];
        for (const agent of data) {
          this.agents.set(agent.walletAddress.toLowerCase(), agent);
        }
        console.log(`[UserStore] Loaded ${this.agents.size} agents from disk`);
      }
    } catch (err: any) {
      console.warn(`[UserStore] Failed to load agents: ${err.message}`);
    }
  }

  private save(): void {
    try {
      const dir = dirname(DATA_FILE);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(DATA_FILE, JSON.stringify(Array.from(this.agents.values()), null, 2));
    } catch (err: any) {
      console.error(`[UserStore] Failed to save agents: ${err.message}`);
    }
  }

  /**
   * Register a new user agent: deploy smart contract wallet + mint Bronze NFT.
   */
  async register(walletAddress: string, persona: Persona): Promise<UserAgent> {
    const key = walletAddress.toLowerCase();
    if (this.agents.has(key)) {
      throw new Error("Agent already registered for this wallet");
    }

    // Deploy EIP-4337 smart contract wallet
    const smartWalletAddress = await this.chainAdapter.deployAgentWallet(walletAddress);

    // Mint Bronze certification NFT to user's EOA (smart wallets may not support ERC-1155 receiver)
    const nftTokenId = await this.chainAdapter.mintAgentNFT(walletAddress, "bronze");

    const agent: UserAgent = {
      walletAddress: key,
      smartWalletAddress,
      nftTokenId,
      nftTier: "bronze",
      persona,
      registeredAt: Date.now(),
      lastActiveAt: Date.now(),
    };

    this.agents.set(key, agent);
    this.save();
    console.log(`[UserStore] Registered agent "${persona.name}" for wallet ${key.slice(0, 10)}...`);
    return agent;
  }

  getByAddress(address: string): UserAgent | undefined {
    return this.agents.get(address.toLowerCase());
  }

  list(): UserAgent[] {
    return Array.from(this.agents.values());
  }

  /**
   * Update last active timestamp when user participates.
   */
  touch(address: string): void {
    const agent = this.agents.get(address.toLowerCase());
    if (agent) {
      agent.lastActiveAt = Date.now();
      this.save();
    }
  }
}
