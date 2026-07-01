/**
 * Static verification for CursorSI Pi-style context compaction.
 * Run: npm run verify:cursorsi-compaction
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

function assert(cond, msg) {
  if (!cond) failures.push(msg);
}

function read(rel) {
  return readFileSync(path.join(root, rel), "utf8");
}

const schema = read("cli/src/db/compaction-schema.ts");
assert(schema.includes("session_compactions"), "SQLite session_compactions table");
assert(schema.includes("first_kept_entry_id"), "compaction stores firstKeptEntryId");

const compaction = read("cli/src/session/compaction.ts");
assert(compaction.includes("findCompactionCutPoint"), "cut point finder");
assert(compaction.includes("shouldAutoCompact"), "auto-trigger threshold");
assert(compaction.includes("contextWindow - config.reserveTokens"), "threshold uses contextWindow - reserve");
assert(compaction.includes("isMessageBoundaryLine"), "user/assistant boundaries");
assert(compaction.includes("isToolOrSystemLine"), "never cut at tool results");
assert(compaction.includes("## Goal"), "Pi structured summary format");
assert(compaction.includes("<read-files>"), "read-files tags in prompt");
assert(compaction.includes("Agent.create"), "summary via Agent.create");
assert(compaction.includes("countTokens") || compaction.includes("token-counter"), "tiktoken-based token estimate");

const config = read("cli/src/config/sispace.ts");
assert(config.includes("parseCompactionSection"), "compaction settings parser");
assert(config.includes("reserve_tokens"), "reserve_tokens setting");
assert(config.includes("keep_recent_tokens"), "keep_recent_tokens setting");

const yaml = read("config/sispace.yaml");
assert(yaml.includes("compaction:"), "sispace.yaml compaction section");
assert(yaml.includes("reserve_tokens: 16384"), "default reserve_tokens");
assert(yaml.includes("keep_recent_tokens: 20000"), "default keep_recent_tokens");

const slash = read("cli/src/commands/slash.ts");
assert(slash.includes('key === "compact"'), "/compact slash handler");
assert(slash.includes("runSessionCompaction"), "slash calls compaction");

const catalog = read("cli/src/commands/slash-catalog.ts");
assert(catalog.includes('"compact"'), "slash autocomplete includes compact");

const sendTurn = read("cli/src/runtime/send-turn.ts");
assert(sendTurn.includes("compactionSummaryBlock"), "compaction injected on compose");

const orch = read("cli/src/tui/Orchestrator.tsx");
assert(orch.includes("shouldAutoCompact"), "orchestrator auto-compaction");
assert(orch.includes("Compacted — summarized"), "TUI compaction log line");

const status = read("cli/src/tui/StatusBar.tsx");
assert(status.includes("[compacted]"), "status bar compacted badge");

const types = read("cli/src/session/types.ts");
assert(types.includes("compactionSummaryBlock"), "CliSession compaction fields");

const obsWrite = read("cli/src/obsidian/write.ts");
assert(obsWrite.includes("appendSection"), "Obsidian compaction section append");
assert(compaction.includes("writeCompactionToObsidian"), "task note Compaction section");

if (failures.length) {
  console.error("verify-cursorsi-compaction FAILED:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("verify-cursorsi-compaction: all checks passed");
