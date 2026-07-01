/**
 * Static verification for CursorSI CLI Phase 0c (FTS session search).
 * Run: node tests/verify-cursorsi-phase0c.mjs
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

const fts = read("cli/src/search/fts.ts");
assert(fts.includes("discoverySearch"), "fts exports discoverySearch");
assert(fts.includes("scrollMessages"), "fts exports scrollMessages");
assert(fts.includes("browseMessages"), "fts exports browseMessages");
assert(fts.includes("task_messages_fts"), "fts uses FTS5 virtual table");

const parseArgs = read("cli/src/search/parse-args.ts");
assert(parseArgs.includes("parseSearchSlashArgs"), "parse-args for slash");
assert(parseArgs.includes("--task"), "scroll/browse flags");

const slash = read("cli/src/commands/slash.ts");
assert(slash.includes("handleSearch"), "slash wires /search");
assert(slash.includes("runTaskSearch"), "slash calls runTaskSearch");
assert(slash.includes("formatSearchResult"), "slash formats inline results");

const query = read("cli/src/search/query.ts");
assert(query.includes("openSharedDb"), "query opens shared sqlite");

const pkg = JSON.parse(read("cli/package.json"));
assert(
  (pkg.engines?.node ?? "").includes("22"),
  "node engine >=22 for node:sqlite FTS",
);

assert(existsSync(path.join(root, "cli/loc.json")), "loc.json for db file name");

const format = read("cli/src/search/format.ts");
assert(format.includes("formatDiscoveryLines"), "discovery formatter");

if (failures.length) {
  console.error("verify-cursorsi-phase0c FAILED:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("verify-cursorsi-phase0c: all checks passed");
