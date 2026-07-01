/**
 * Static verification for CursorSI CLI Phase 0a skeleton.
 * Run: node tests/verify-cursorsi-phase0a.mjs
 */
import { readFileSync, existsSync } from "node:fs";
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

const bin = read("cli/bin/cursorsi.mjs");
assert(!bin.includes('from "ink"'), "bin must not static-import ink");
assert(!bin.includes("import(\"ink\")"), "bin must not dynamic-import ink at top level");
assert(bin.includes("--version"), "bin handles --version");
assert(bin.includes("../dist/main.js"), "bin lazy-loads dist/main.js");

assert(existsSync(path.join(root, "cli/src/tui/Orchestrator.tsx")), "Orchestrator.tsx exists");
assert(existsSync(path.join(root, "cli/src/tui/StatusBar.tsx")), "StatusBar.tsx exists");
assert(existsSync(path.join(root, "cli/src/tui/SessionPicker.tsx")), "SessionPicker.tsx exists");

const orch = read("cli/src/tui/Orchestrator.tsx");
assert(orch.includes("SessionPicker"), "orchestrator has session overlay");
assert(orch.includes('overlay === "sessions"'), "session overlay toggle");
assert(orch.includes("runSlashCommand"), "slash commands wired");

const slash = read("cli/src/commands/slash.ts");
assert(slash.includes("/reflect"), "slash placeholder reflect");
assert(slash.includes("Phase 0a") || slash.includes("placeholder"), "slash marks placeholder phase");

const pkg = JSON.parse(read("cli/package.json"));
assert(pkg.bin?.cursorsi === "./bin/cursorsi.mjs", "package bin points to entry");

if (failures.length) {
  console.error("verify-cursorsi-phase0a FAILED:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("verify-cursorsi-phase0a: all checks passed");
