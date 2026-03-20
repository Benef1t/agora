import { satoshi } from "./satoshi.js";
import { bitcoinChain } from "./bitcoin-chain.js";
import { ethereumChain } from "./ethereum-chain.js";
import { turing } from "./turing.js";
import { einstein } from "./einstein.js";
import { adamSmith } from "./adam-smith.js";
import { johnNash } from "./john-nash.js";
import { solanaChain } from "./solana-chain.js";
import { moneroChain } from "./monero-chain.js";
import { tesla } from "./tesla.js";
import type { Persona } from "../types.js";

export const NPC_PERSONAS: Record<string, Persona> = {
  satoshi,
  "bitcoin-chain": bitcoinChain,
  "ethereum-chain": ethereumChain,
  turing,
  einstein,
  "adam-smith": adamSmith,
  "john-nash": johnNash,
  "solana-chain": solanaChain,
  "monero-chain": moneroChain,
  tesla,
};

export const ALL_NPCS = Object.values(NPC_PERSONAS);

export { satoshi, bitcoinChain, ethereumChain, turing, einstein, adamSmith, johnNash, solanaChain, moneroChain, tesla };
