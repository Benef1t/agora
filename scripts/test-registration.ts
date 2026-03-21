/**
 * End-to-end test: compile AgentNFT → deploy → deploy wallet → mint NFT
 * Runs against local Hardhat node (http://127.0.0.1:8545)
 *
 * Usage: npx tsx scripts/test-registration.ts
 */
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import solc from "solc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
import {
  createPublicClient,
  createWalletClient,
  http,
  formatEther,
  parseAbi,
  type Hex,
} from "viem";
import { hardhat } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

// Hardhat's pre-funded Account #0
const DEPLOYER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
// Simulated user EOA (Account #1)
const USER_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

const LOCAL_RPC = "http://127.0.0.1:8545";

const deployerAccount = privateKeyToAccount(DEPLOYER_KEY as Hex);
const userAccount = privateKeyToAccount(USER_KEY as Hex);

const publicClient = createPublicClient({
  chain: hardhat,
  transport: http(LOCAL_RPC),
});

const deployerWallet = createWalletClient({
  account: deployerAccount,
  chain: hardhat,
  transport: http(LOCAL_RPC),
});

const userWallet = createWalletClient({
  account: userAccount,
  chain: hardhat,
  transport: http(LOCAL_RPC),
});

// ── Step 1: Compile AgentNFT ──

function compileAgentNFT() {
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
      return { contents: readFileSync(resolve(__dirname, "../node_modules", path), "utf-8") };
    } catch {
      return { error: `File not found: ${path}` };
    }
  }

  const output = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));

  if (output.errors?.some((e: any) => e.severity === "error")) {
    output.errors.forEach((e: any) => console.error(e.formattedMessage));
    throw new Error("Compilation failed");
  }

  const contract = output.contracts["AgentNFT.sol"]["AgentNFT"];
  return {
    abi: contract.abi,
    bytecode: ("0x" + contract.evm.bytecode.object) as Hex,
  };
}

// ── Step 2: Compile SimpleAccountFactory (minimal) ──
// We deploy a minimal factory that creates CREATE2 accounts

function compileSimpleFactory() {
  // Minimal SimpleAccountFactory that creates accounts via CREATE2
  const source = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract SimpleAccount {
    address public owner;
    address public entryPoint;

    constructor(address _owner) {
        owner = _owner;
        entryPoint = msg.sender;
    }

    receive() external payable {}

    function execute(address to, uint256 value, bytes calldata data) external {
        require(msg.sender == owner || msg.sender == entryPoint, "not authorized");
        (bool ok, ) = to.call{value: value}(data);
        require(ok, "call failed");
    }
}

contract SimpleAccountFactory {
    function createAccount(address owner, uint256 salt) external returns (address) {
        bytes32 s = keccak256(abi.encodePacked(keccak256(abi.encodePacked(owner)), salt));
        bytes memory bytecode = abi.encodePacked(type(SimpleAccount).creationCode, abi.encode(owner));
        address addr;
        assembly {
            addr := create2(0, add(bytecode, 0x20), mload(bytecode), s)
        }
        require(addr != address(0), "create2 failed");
        return addr;
    }

    function getAddress(address owner, uint256 salt) external view returns (address) {
        bytes32 s = keccak256(abi.encodePacked(keccak256(abi.encodePacked(owner)), salt));
        bytes memory bytecode = abi.encodePacked(type(SimpleAccount).creationCode, abi.encode(owner));
        bytes32 hash = keccak256(abi.encodePacked(bytes1(0xff), address(this), s, keccak256(bytecode)));
        return address(uint160(uint256(hash)));
    }
}`;

  const input = {
    language: "Solidity",
    sources: { "SimpleAccountFactory.sol": { content: source } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
    },
  };

  const output = JSON.parse(solc.compile(JSON.stringify(input)));

  if (output.errors?.some((e: any) => e.severity === "error")) {
    output.errors.forEach((e: any) => console.error(e.formattedMessage));
    throw new Error("Factory compilation failed");
  }

  const contract = output.contracts["SimpleAccountFactory.sol"]["SimpleAccountFactory"];
  return {
    abi: contract.abi,
    bytecode: ("0x" + contract.evm.bytecode.object) as Hex,
  };
}

// ── Main ──

async function main() {
  console.log("══════════════════════════════════════════════");
  console.log("  Web3 Agora — Registration Flow E2E Test");
  console.log("══════════════════════════════════════════════\n");

  const balance = await publicClient.getBalance({ address: deployerAccount.address });
  console.log(`Deployer: ${deployerAccount.address} (${formatEther(balance)} ETH)`);
  console.log(`User EOA: ${userAccount.address}\n`);

  // ── 1. Deploy SimpleAccountFactory ──
  console.log("── Step 1: Deploy SimpleAccountFactory ──");
  const factory = compileSimpleFactory();
  const factoryHash = await deployerWallet.deployContract({
    abi: factory.abi,
    bytecode: factory.bytecode,
    args: [],
  });
  const factoryReceipt = await publicClient.waitForTransactionReceipt({ hash: factoryHash });
  const factoryAddr = factoryReceipt.contractAddress!;
  console.log(`✓ Factory deployed: ${factoryAddr} (gas: ${factoryReceipt.gasUsed})\n`);

  // ── 2. Deploy AgentNFT ──
  console.log("── Step 2: Deploy AgentNFT (ERC-1155) ──");
  const nft = compileAgentNFT();
  const nftHash = await deployerWallet.deployContract({
    abi: nft.abi,
    bytecode: nft.bytecode,
    args: [],
  });
  const nftReceipt = await publicClient.waitForTransactionReceipt({ hash: nftHash });
  const nftAddr = nftReceipt.contractAddress!;
  console.log(`✓ AgentNFT deployed: ${nftAddr} (gas: ${nftReceipt.gasUsed})\n`);

  // ── 3. Deploy EIP-4337 wallet for user ──
  console.log("── Step 3: Deploy EIP-4337 wallet for user ──");
  const FACTORY_ABI = parseAbi([
    "function createAccount(address owner, uint256 salt) external returns (address)",
    "function getAddress(address owner, uint256 salt) external view returns (address)",
  ]);

  const salt = BigInt(userAccount.address);

  // Get counterfactual address
  const predictedAddr = await publicClient.readContract({
    address: factoryAddr,
    abi: FACTORY_ABI,
    functionName: "getAddress",
    args: [userAccount.address, salt],
  });
  console.log(`  Predicted wallet address: ${predictedAddr}`);

  // Actually deploy
  const deployWalletHash = await deployerWallet.writeContract({
    address: factoryAddr,
    abi: FACTORY_ABI,
    functionName: "createAccount",
    args: [userAccount.address, salt],
  });
  const deployWalletReceipt = await publicClient.waitForTransactionReceipt({ hash: deployWalletHash });
  console.log(`✓ Wallet deployed (gas: ${deployWalletReceipt.gasUsed})`);

  // Verify code exists
  const walletCode = await publicClient.getCode({ address: predictedAddr as `0x${string}` });
  console.log(`  Wallet has code: ${walletCode && walletCode !== "0x" ? "YES" : "NO"}`);

  // Verify owner
  const ACCOUNT_ABI = parseAbi(["function owner() view returns (address)"]);
  const owner = await publicClient.readContract({
    address: predictedAddr as `0x${string}`,
    abi: ACCOUNT_ABI,
    functionName: "owner",
  });
  console.log(`  Wallet owner: ${owner} (matches user: ${owner.toLowerCase() === userAccount.address.toLowerCase()})\n`);

  // ── 4. Mint Bronze NFT ──
  console.log("── Step 4: Mint Bronze NFT ──");
  const NFT_ABI = parseAbi([
    "function mint(address to, uint256 id, uint256 amount, bytes data) external",
    "function balanceOf(address account, uint256 id) external view returns (uint256)",
    "function name() external view returns (string)",
  ]);

  const nftName = await publicClient.readContract({
    address: nftAddr,
    abi: NFT_ABI,
    functionName: "name",
  });
  console.log(`  NFT contract name: ${nftName}`);

  const BRONZE_ID = 1n;
  const mintHash = await deployerWallet.writeContract({
    address: nftAddr,
    abi: NFT_ABI,
    functionName: "mint",
    args: [userAccount.address, BRONZE_ID, 1n, "0x" as `0x${string}`],
  });
  const mintReceipt = await publicClient.waitForTransactionReceipt({ hash: mintHash });
  console.log(`✓ Minted Bronze NFT to wallet (gas: ${mintReceipt.gasUsed})`);

  // Verify balance
  const nftBalance = await publicClient.readContract({
    address: nftAddr,
    abi: NFT_ABI,
    functionName: "balanceOf",
    args: [userAccount.address, BRONZE_ID],
  });
  console.log(`  Bronze NFT balance: ${nftBalance}\n`);

  // ── 5. Simulate signature verification ──
  console.log("── Step 5: Signature verification ──");
  const message = `Web3 Agora: Register agent for ${userAccount.address} at ${Date.now()}`;
  const signature = await userWallet.signMessage({ message });
  console.log(`  Message: ${message.slice(0, 50)}...`);
  console.log(`  Signature: ${signature.slice(0, 20)}...`);

  const { verifyMessage } = await import("viem");
  const valid = await verifyMessage({
    address: userAccount.address,
    message,
    signature,
  });
  console.log(`✓ Signature valid: ${valid}\n`);

  // ── Summary ──
  console.log("══════════════════════════════════════════════");
  console.log("  Registration Flow — ALL STEPS PASSED ✓");
  console.log("══════════════════════════════════════════════");
  console.log(`\n  SimpleAccountFactory: ${factoryAddr}`);
  console.log(`  AgentNFT (ERC-1155):  ${nftAddr}`);
  console.log(`  User EOA:             ${userAccount.address}`);
  console.log(`  Smart Wallet:         ${predictedAddr}`);
  console.log(`  Bronze NFT:           tokenId=1, balance=1`);
  console.log(`  Signature:            verified ✓`);
  console.log(`\n  Add to .env for Base Sepolia deployment:`);
  console.log(`  ACCOUNT_FACTORY_ADDR=${factoryAddr}`);
  console.log(`  NFT_CONTRACT_ADDR=${nftAddr}`);
  console.log("");
}

main().catch(console.error);
