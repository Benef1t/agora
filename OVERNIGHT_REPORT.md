# Overnight Work Report — 2026-03-20

## Summary

Completed all three priority tasks (chain adapter, NPC tuning, discussion formats) plus additional improvements. All changes compile cleanly and have been tested with live Ollama (qwen3.5:35b) on the running server.

---

## Task 1: Chain Adapter (Base / EIP-4337)

**Status: DONE (code complete, needs contract deployment for full functionality)**

- Created `src/chain/base-adapter.ts` — a real Base chain adapter using **viem**
- Features implemented:
  - `verifySignature()` — real EIP-191 signature verification via `viem.verifyMessage`
  - `deployAgentWallet()` — uses SimpleAccountFactory if configured, otherwise deterministic mock
  - `mintAgentNFT()` — ERC-1155 minting with tier-based token IDs (bronze=1, silver=2, gold=3, genesis=4)
  - `transfer()` — real ETH transfer when wallet client is configured
  - `attestMessage()` — mock (needs EAS contract)
- `server.ts` updated to conditionally use `BaseChainAdapter` when `BASE_RPC_URL` is set
- **Research conclusion**: ZeroDev SDK (`@zerodev/sdk`) is the practical choice over Elytro (which has no npm package). The current adapter uses viem's native SimpleAccountFactory pattern and can be upgraded to ZeroDev when bundler/paymaster integration is needed.

**Remaining**: Deploy ERC-1155 and SimpleAccountFactory contracts to Base Sepolia, set env vars.

---

## Task 2: NPC Prompt & Few-shot Tuning

**Status: DONE**

Changes made to all 5 NPC personas:
- Added a **3rd few-shot example** to each NPC that demonstrates the `> @Name: "quote"` format in action
- Each new example shows the NPC responding to another specific NPC, reinforcing cross-referencing behavior
- Added **format-aware rules** to the global system prompt in `agent.ts`:
  - Debate: argue assigned side passionately
  - Hearing: probe (as questioner) or defend (as hot seat)
  - Oracle: commit to specific predictions
- Added rules for engagement quality: "do not repeat what others said", "engage directly with arguments"

**Quality verification**: Tested with live discussions. NPCs are producing substantive, differentiated responses with proper quoting.

---

## Task 3: Discussion Formats

**Status: DONE (engine + API + frontend)**

### Engine (`roundtable.ts`)
- **Debate**: Two sides (pro/con), configurable or auto-split. Structured rounds with side-specific prompts.
- **Hearing**: One NPC in hot seat gives opening statement, others question, hot seat responds to each.
- **Oracle**: All NPCs make structured predictions (prediction + reasoning + risks), then cross-react.
- Backward compatibility: old discussions without `format` field default to "roundtable".

### API (`server.ts`)
- POST `/api/discussions` now accepts `format`, `proNpcIds`, `conNpcIds`, `hotSeatNpcId` parameters

### Frontend (`index.html`)
- Format selector dropdown in +New modal (roundtable/debate/hearing/oracle)
- Hearing format shows hot seat NPC selector
- Discussion cards show format icon and label
- Format-specific loading messages

### Types (`types.ts`)
- `DiscussionFormat = "roundtable" | "debate" | "hearing" | "oracle"`
- `formatMeta` field for format-specific data (pro/con sides, hot seat NPC, predictions)

### Test Results
- **Debate** (5 msgs): Pro/con NPCs argued their sides, quoted each other, stayed on-side
- **Oracle** (10 msgs): 5 predictions + 5 cross-reactions, specific timeframes and confidence levels
- **Hearing** (9 msgs): Opening statement + 4 Q&A pairs, questioners were probing, hot seat defended

---

## Bonus: Full Ollama Migration

Switched **all remaining Claude API calls** to Ollama:
- `matcher.ts` — tag extraction for NPC matching (was Haiku, now Ollama)
- `summarizer.ts` — discussion archival summaries (was Haiku, now Ollama)
- The project now has **zero Claude API dependency** for runtime operations

---

## Agent Participation

Created a roundtable discussion about UI/UX improvements for Agora. Posted my feedback as "Claude (Dev Agent)" — NPCs (Turing and Satoshi) responded with relevant follow-ups about formalization of interaction patterns and decentralized search.

### My Top UI/UX Recommendations

1. **Mobile responsiveness** — sidebar collapse, touch-friendly voting
2. **Markdown rendering** — NPC responses use formatting that isn't rendered
3. **Threaded replies** — flat lists get confusing at 10+ messages
4. **Format-specific layouts** — debate pro/con columns, hearing hot seat highlight, oracle prediction cards
5. **Discussion preview snippets** — show first lines on home feed
6. **Real-time notifications** — toast when NPCs respond to you
7. **Agent profiles** — clickable avatars showing persona, beliefs, history
8. **Message search** — search within content, not just topics
9. **Spectator count** — show live viewer count
10. **Pagination** — large discussions need lazy loading

---

## Files Changed

| File | Change |
|------|--------|
| `src/chain/base-adapter.ts` | NEW — Real Base chain adapter (viem) |
| `src/discussion/roundtable.ts` | Rewritten — 4 format starters, backward compat |
| `src/discussion/types.ts` | Updated — DiscussionFormat, formatMeta |
| `src/discussion/matcher.ts` | Changed from Claude Haiku to Ollama |
| `src/discussion/summarizer.ts` | Changed from Claude Haiku to Ollama |
| `src/agents/agent.ts` | Added format-aware rules to system prompt |
| `src/agents/personas/*.ts` | All 5 NPCs: added 3rd few-shot example |
| `src/server.ts` | Accept format params, conditional BaseChainAdapter |
| `public/index.html` | Format selector in +New modal, format badges |
| `CLAUDE.md` | Updated completed items and tech stack |

---

## What's NOT Done

1. **Contract deployment** — ERC-1155 + SimpleAccountFactory need to be deployed to Base Sepolia
2. **ZeroDev/bundler integration** — Needs ZeroDev SDK for full EIP-4337 (gasless tx, paymaster)
3. **Mobile responsive CSS** — Identified as priority but not implemented
4. **Markdown rendering** — Frontend still shows raw markdown
5. **Threaded replies** — Architecture would need message tree structure
6. **Format-specific UI layouts** — Debate columns, oracle cards, etc.
