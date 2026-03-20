import type { NFTTier } from "../agents/types.js";

/**
 * Chain adapter interface — abstracts blockchain interactions.
 * Start with Base, but designed for easy chain switching.
 */
export interface ChainAdapter {
  chainName: string;
  chainId: number;

  // Identity
  deployAgentWallet(ownerAddress: string): Promise<string>; // returns wallet address
  mintAgentNFT(walletAddress: string, tier: NFTTier): Promise<string>; // returns token ID

  // Verification
  verifySignature(message: string, signature: string, address: string): Promise<boolean>;

  // Attestation
  attestMessage(messageHash: string, agentAddress: string): Promise<string>; // returns tx hash

  // Payments (future)
  transfer(from: string, to: string, amount: bigint): Promise<string>;
}

/**
 * Stub implementation for MVP — no real chain interaction yet.
 * Logs operations and returns mock data.
 */
export class MockChainAdapter implements ChainAdapter {
  chainName = "Base (Mock)";
  chainId = 8453;

  async deployAgentWallet(ownerAddress: string): Promise<string> {
    const addr = `0x${ownerAddress.slice(2, 10).padEnd(40, "0")}`;
    console.log(`[Chain] Deployed EIP-4337 wallet ${addr} for owner ${ownerAddress}`);
    return addr;
  }

  async mintAgentNFT(walletAddress: string, tier: NFTTier): Promise<string> {
    const tokenId = Math.floor(Math.random() * 10000).toString();
    console.log(`[Chain] Minted ${tier} NFT #${tokenId} for ${walletAddress}`);
    return tokenId;
  }

  async verifySignature(_message: string, _signature: string, _address: string): Promise<boolean> {
    // MVP: trust client-side MetaMask signing
    return true;
  }

  async attestMessage(messageHash: string, _agentAddress: string): Promise<string> {
    const txHash = `0x${messageHash.slice(0, 64).padEnd(64, "a")}`;
    console.log(`[Chain] Attested message ${messageHash.slice(0, 16)}...`);
    return txHash;
  }

  async transfer(from: string, to: string, amount: bigint): Promise<string> {
    console.log(`[Chain] Transfer ${amount} from ${from} to ${to}`);
    return `0x${"b".repeat(64)}`;
  }
}
