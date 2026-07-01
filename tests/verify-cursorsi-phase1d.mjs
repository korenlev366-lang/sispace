/**
 * Static verification for CursorSI CLI Phase 1d.
 * Run: node tests/verify-cursorsi-phase1d.mjs
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

const io = read("cli/src/handoff/io.ts");
assert(!io.includes("./paths.js"), "handoff io does not import missing paths.js");
assert(io.includes("handoffFileForId"), "handoff io defines handoffFileForId");
assert(io.includes("findProjectRoot"), "handoff dir uses project root");
assert(io.includes("exportHandoff"), "handoff export helper");

const handoffCli = read("cli/src/handoff/cli.ts");
assert(handoffCli.includes("process.cwd()"), "handoff cli passes cwd");

const kanban = read("cli/src/sispace/kanban.ts");
assert(!kanban.includes("./binary.js"), "kanban inlines binary resolver");
assert(kanban.includes("resolveSispaceBinary"), "kanban resolves sispace binary");
assert(kanban.includes("sispace-"), "kanban checks dist package name");

const query = read("cli/src/search/query.ts");
assert(query.includes("openSharedDbRead"), "search uses shared db read");

const taskRow = read("cli/src/session/task-row.ts");
assert(taskRow.includes("openSharedDbRead"), "task-row uses shared db read");
assert(taskRow.includes("swarm_root_id"), "task-row selects swarm_root_id");

const cliOpts = read("cli/src/runtime/cli-options.ts");
assert(cliOpts.includes("handoffAttachId"), "cli-options has handoffAttachId");
assert(cliOpts.includes("--handoff-attach"), "cli-options parses handoff attach");

const init = read("cli/src/runtime/init.ts");
assert(init.includes("loadHandoffBlob"), "init loads handoff blob");
assert(init.includes("handoffToSessionState"), "init restores handoff session");

const types = read("cli/src/session/types.ts");
assert(types.includes("costSessionTokens"), "session tracks session cost");
assert(types.includes("costProjectTokens"), "session tracks project cost");

const orch = read("cli/src/tui/Orchestrator.tsx");
assert(orch.includes("recordTurnOutputTokens"), "orchestrator records turn cost");

const status = read("cli/src/tui/StatusBar.tsx");
assert(status.includes("formatCostStatusLine"), "status bar shows cost");

const slash = read("cli/src/commands/slash.ts");
assert(slash.includes("handleHandoff"), "slash handles /handoff");
assert(slash.includes("handleSwarm"), "slash handles /swarm");

const swarm = read("cli/src/sispace/swarm.ts");
assert(swarm.includes("getSwarmGraph"), "swarm graph reader for status");
assert(
  !swarm.includes("workerIds.length ? workerIds[0]"),
  "swarm verifier summary uses verifier id not worker",
);

const bin = read("cli/bin/cursorsi.mjs");
assert(bin.includes('coldSub === "kanban"'), "bin wires kanban subcommand");
assert(bin.includes('coldSub === "swarm"'), "bin wires swarm subcommand");
assert(bin.includes('coldSub === "handoff"'), "bin wires handoff subcommand");
assert(bin.includes("Phase 1d"), "bin help mentions Phase 1d");

const pkg = read("package.json");
assert(pkg.includes("verify:cursorsi-1d"), "root package.json has verify script");

assert(existsSync(path.join(root, "cli/src/cost/store.ts")), "cost store exists");
assert(existsSync(path.join(root, "cli/src/db/shared.ts")), "shared db module exists");

if (failures.length) {
  console.error("verify-cursorsi-phase1d FAILED:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("verify-cursorsi-phase1d: all checks passed");
