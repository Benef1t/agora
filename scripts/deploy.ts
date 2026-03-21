/**
 * Compile & deploy AgentNFT (ERC-1155) to Base Sepolia.
 *
 * Usage: npx tsx scripts/deploy.ts
 * Requires: BASE_RPC_URL, DEPLOYER_PRIVATE_KEY in .env
 */
import "dotenv/config";
import { readFileSync } from "fs";
import { resolve } from "path";
import solc from "solc";
import {
  createPublicClient,
  createWalletClient,
  http,
  formatEther,
  type Hex,
} from "viem";
import { baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

const DEPLOYER_KEY = process.env.DEPLOYER_PRIVATE_KEY?.trim();
const RPC_URL = process.env.BASE_RPC_URL?.trim() || "https://sepolia.base.org";

if (!DEPLOYER_KEY) {
  console.error("DEPLOYER_PRIVATE_KEY not set");
  process.exit(1);
}

const account = privateKeyToAccount(DEPLOYER_KEY as Hex);

const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(RPC_URL),
});

const walletClient = createWalletClient({
  account,
  chain: baseSepolia,
  transport: http(RPC_URL),
});

function compileSolidity() {
  const source = readFileSync(resolve(__dirname, "../contracts/AgentNFT.sol"), "utf-8");

  const input = {
    language: "Solidity",
    sources: { "AgentNFT.sol": { content: source } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
    },
  };

  function findImports(path: string) {
    try {
      const resolved = resolve(__dirname, "../node_modules", path);
      return { contents: readFileSync(resolved, "utf-8") };
    } catch {
      return { error: `File not found: ${path}` };
    }
  }

  console.log("Compiling AgentNFT.sol...");
  const output = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));

  if (output.errors?.some((e: any) => e.severity === "error")) {
    console.error("Compilation errors:");
    output.errors.forEach((e: any) => console.error(e.formattedMessage));
    process.exit(1);
  }

  const contract = output.contracts["AgentNFT.sol"]["AgentNFT"];
  return {
    abi: contract.abi,
    bytecode: ("0x" + contract.evm.bytecode.object) as Hex,
  };
}

async function main() {
  console.log("=== AgentNFT Deployment ===");
  console.log(`Network: Base Sepolia`);
  console.log(`Deployer: ${account.address}`);

  const balance = await publicClient.getBalance({ address: account.address });
  console.log(`Balance: ${formatEther(balance)} ETH`);

  if (balance === 0n) {
    console.error("\nNo ETH! Get test ETH from a faucet:");
    console.error("  https://www.alchemy.com/faucets/base-sepolia");
    console.error(`  Address: ${account.address}`);
    process.exit(1);
  }

  const { abi, bytecode } = compileSolidity();
  console.log(`Bytecode size: ${(bytecode.length - 2) / 2} bytes`);

  console.log("\nDeploying...");
  const hash = await walletClient.deployContract({
    abi,
    bytecode,
    args: [],
  });

  console.log(`TX: ${hash}`);
  console.log("Waiting for confirmation...");

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log(`\nContract deployed!`);
  console.log(`Address: ${receipt.contractAddress}`);
  console.log(`Block: ${receipt.blockNumber}`);
  console.log(`Gas used: ${receipt.gasUsed}`);

  console.log(`\nAdd to .env:`);
  console.log(`NFT_CONTRACT_ADDR=${receipt.contractAddress}`);
}

main().catch(console.error);
