import { satoshi } from "./satoshi.js";
import { bitcoinChain } from "./bitcoin-chain.js";
import { ethereumChain } from "./ethereum-chain.js";
import { turing } from "./turing.js";
import { einstein } from "./einstein.js";
import type { Persona } from "../types.js";

export const NPC_PERSONAS: Record<string, Persona> = {
  satoshi,
  "bitcoin-chain": bitcoinChain,
  "ethereum-chain": ethereumChain,
  turing,
  einstein,
};

export const ALL_NPCS = Object.values(NPC_PERSONAS);

export { satoshi, bitcoinChain, ethereumChain, turing, einstein };
