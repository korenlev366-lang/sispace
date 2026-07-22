/**
 * Slash command autocomplete (slash-catalog + Orchestrator wiring).
 * Run: node tests/verify-cursorsi-slash-autocomplete.mjs
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

const catalog = read("cli/src/commands/slash-catalog.ts");
assert(catalog.includes("getSlashCompletion"), "slash-catalog exports getSlashCompletion");
assert(catalog.includes("findActiveSlashSpan"), "slash-catalog exports findActiveSlashSpan");
assert(catalog.includes("extractSlashInvocation"), "slash-catalog exports extractSlashInvocation");
assert(catalog.includes("SLASH_COMMAND_DESCRIPTIONS"), "slash-catalog has descriptions");
assert(catalog.includes('"goal"'), "slash-catalog lists goal");
assert(catalog.includes('"model"'), "slash-catalog lists model");
assert(catalog.includes('"subagent-model"'), "slash-catalog lists subagent-model");

const orch = read("cli/src/tui/Orchestrator.tsx");
assert(orch.includes("getSlashCompletion"), "orchestrator uses slash completion");
assert(orch.includes("SlashAutocomplete"), "orchestrator renders slash dropdown");
assert(orch.includes("showSlashMenu"), "orchestrator toggles slash menu");
assert(
  orch.includes("extractSlashInvocation") || orch.includes("extractKnownSlashInvocation"),
  "orchestrator extracts slash commands",
);

const slash = read("cli/src/commands/slash.ts");
assert(slash.includes("extractSlashInvocation"), "slash router uses extractSlashInvocation");
assert(slash.includes('openModelPicker: "orchestrator"'), "slash router opens orchestrator model picker");
assert(slash.includes('openModelPicker: "subagent"'), "slash router opens subagent model picker");

const orchModel = read("cli/src/tui/Orchestrator.tsx");
assert(orchModel.includes("ModelPicker"), "orchestrator renders ModelPicker");
assert(orchModel.includes("openModelPicker"), "orchestrator opens model picker");

const dropdown = read("cli/src/tui/SlashAutocomplete.tsx");
assert(dropdown.includes("slashCommandDescription"), "dropdown shows descriptions");

const {
  getSlashCompletion,
  extractSlashInvocation,
  SLASH_COMMANDS,
} = await import(
  new URL("../cli/dist/commands/slash-catalog.js", import.meta.url).href
);

const bare = getSlashCompletion("/");
assert(
  bare && bare.candidates.length === SLASH_COMMANDS.length,
  "bare / lists all commands",
);
assert(bare?.value.startsWith("/"), "bare / completion keeps slash token");

const g = getSlashCompletion("/g");
assert(g?.value === "/goal", "/g completes to /goal");
assert(g?.ghostSuffix === "oal", "/g ghost is oal");
const gr = getSlashCompletion("/gr");
assert(gr?.value === "/grade", "/gr completes to /grade");

const mid = getSlashCompletion("please /g");
assert(mid?.value === "please /goal", "mid-prompt /g completes in place");
assert(mid?.ghostSuffix === "oal", "mid-prompt ghost suffix");

assert(
  extractSlashInvocation("context /help") === null,
  "extractSlashInvocation ignores mid-line /help (prompt goes through)",
);
assert(
  extractSlashInvocation("please /chats now") === null,
  "extractSlashInvocation ignores slash when other prompt text exists",
);
assert(
  extractSlashInvocation("/search foo bar") === "/search foo bar",
  "extractSlashInvocation keeps line-start args",
);
assert(
  extractSlashInvocation("  /chats  ") === "/chats",
  "extractSlashInvocation trims pure slash commands",
);

if (failures.length) {
  console.error("verify-cursorsi-slash-autocomplete FAILED:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("verify-cursorsi-slash-autocomplete: all checks passed");
