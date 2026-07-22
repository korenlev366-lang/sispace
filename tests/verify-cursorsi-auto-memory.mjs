/**
 * Static + light runtime checks for auto-memory / auto-skill.
 * Run: node tests/verify-cursorsi-auto-memory.mjs
 */
import { readFileSync, existsSync, mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

assert(existsSync(path.join(root, "cli/src/memory/auto-extract.ts")), "auto-extract.ts");
assert(existsSync(path.join(root, "cli/src/memory/project-memory.ts")), "project-memory.ts");
assert(existsSync(path.join(root, "cli/src/memory/paths.ts")), "paths.ts");

const settings = read("cli/src/config/user-settings.ts");
assert(settings.includes("enableAutoMemory"), "settings enableAutoMemory");
assert(settings.includes("enableAutoSkill"), "settings enableAutoSkill");

const catalog = read("cli/src/commands/slash-catalog.ts");
assert(catalog.includes('"memory"'), "/memory in catalog");

const slash = read("cli/src/commands/slash.ts");
assert(slash.includes("handleMemory"), "handleMemory");

const sessionAgent = read("cli/src/sdk/session-agent.ts");
assert(sessionAgent.includes("askUserHintInjected"), "once-only ask hint");
assert(sessionAgent.includes("projectMemoryInjected"), "project memory inject");
assert(sessionAgent.includes("buildProjectMemoryInjectBlock"), "memory inject helper");

const autoReflect = read("cli/src/harness/auto-reflect.ts");
assert(autoReflect.includes("triggerAutoExtractOnSessionEnd"), "session-end extract");

const {
  resolveMemorySettings,
  AUTO_SKILL_TOOL_THRESHOLD,
} = await import(
  pathToFileURLSafe(path.join(root, "cli/dist/memory/auto-extract.js"))
);
const { buildProjectMemoryInjectBlock } = await import(
  pathToFileURLSafe(path.join(root, "cli/dist/memory/project-memory.js"))
);
const { ensureProjectMemoryDirs, AUTO_SKILL_SOURCE } = await import(
  pathToFileURLSafe(path.join(root, "cli/dist/memory/paths.js"))
);

assert(AUTO_SKILL_TOOL_THRESHOLD === 20, "skill threshold 20");
assert(AUTO_SKILL_SOURCE === "auto-skill", "auto-skill source tag");

const flags = resolveMemorySettings({
  version: 1,
  backend: "openrouter",
});
assert(flags.enableAutoMemory === true, "auto-memory default on");
assert(flags.enableAutoSkill === true, "auto-skill default on");

const off = resolveMemorySettings({
  version: 1,
  backend: "openrouter",
  memory: { enableAutoMemory: false, enableAutoSkill: false },
});
assert(off.enableAutoMemory === false, "auto-memory can disable");
assert(off.enableAutoSkill === false, "auto-skill can disable");

const tmp = mkdtempSync(join(tmpdir(), "cursorsi-mem-"));
ensureProjectMemoryDirs(tmp);
const memDir = join(tmp, ".cursorsi", "memory");
const skillDir = join(tmp, ".cursorsi", "skills", "demo-skill");
mkdirSync(skillDir, { recursive: true });
writeFileSync(join(memDir, "prefs.md"), "User prefers concise answers.\n");
writeFileSync(
  join(skillDir, "SKILL.md"),
  "---\nname: demo-skill\ndescription: Demo\nsource: auto-skill\n---\n\n# Demo\n",
);
const block = buildProjectMemoryInjectBlock(tmp);
assert(block?.includes("Project memory"), "inject includes memory");
assert(block?.includes("demo-skill"), "inject includes skill index");

function pathToFileURLSafe(p) {
  return new URL(`file://${p}`).href;
}

if (failures.length) {
  console.error("verify-cursorsi-auto-memory FAILED:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("verify-cursorsi-auto-memory: all checks passed");
