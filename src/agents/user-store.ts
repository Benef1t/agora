import type { Persona, UserAgent } from "./types.js";
import type { ChainAdapter } from "../chain/adapter.js";

/**
 * In-memory store for registered user agents.
 * Each user is keyed by their lowercase EOA wallet address.
 */
export class UserAgentStore {
  private agents: Map<string, UserAgent> = new Map();
  private chainAdapter: ChainAdapter;

  constructor(chainAdapter: ChainAdapter) {
    this.chainAdapter = chainAdapter;
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

    // Mint Bronze certification NFT
    const nftTokenId = await this.chainAdapter.mintAgentNFT(smartWalletAddress, "bronze");

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
    if (agent) agent.lastActiveAt = Date.now();
  }
}
