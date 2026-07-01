/**
 * Filesystem verification for harness vault graph connectivity (task t_46c16801).
 * Run: node tests/verify-obsidian-vault-graph.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const vaultRoot = process.env.OBSIDIAN_VAULT_ROOT ?? "/home/lev/harness vault";
const failures = [];
const passes = [];

function ok(msg) {
  passes.push(msg);
}
function bad(msg) {
  failures.push(msg);
}

function readVault(rel) {
  const full = path.join(vaultRoot, rel);
  if (!existsSync(full)) {
    bad(`missing vault file: ${rel}`);
    return "";
  }
  return readFileSync(full, "utf8");
}

// Hub notes
for (const hub of ["Harness/README.md", "SISpace/README.md"]) {
  const body = readVault(hub);
  if (body) {
    ok(`hub exists: ${hub}`);
    if (body.includes("## Related")) ok(`${hub} has ## Related`);
    else bad(`${hub} missing ## Related`);
    if (body.includes("[[Harness/README]]") || body.includes("[[SISpace/README]]")) {
      ok(`${hub} cross-links hub notes`);
    } else {
      bad(`${hub} missing hub cross-link`);
    }
  }
}

// Task note t_46c16801
const taskPath = "SISpace/tasks/t_46c16801.md";
const taskBody = readVault(taskPath);
if (taskBody) {
  ok("task note t_46c16801 exists");
  if (taskBody.includes("[[SISpace/tasks/t_")) ok("t_46c16801 uses path-qualified task links");
  else bad("t_46c16801 missing path-qualified [[SISpace/tasks/t_…]] links");
  if (!taskBody.includes("t_101ce2e5")) ok("t_46c16801 has no broken t_101ce2e5 link");
  else bad("t_46c16801 still references t_101ce2e5");
  if (taskBody.includes("[[Harness/README]]") && taskBody.includes("[[SISpace/README]]")) {
    ok("t_46c16801 links to both hub notes");
  } else {
    bad("t_46c16801 missing hub wikilinks");
  }
}

// Post-task sync notes: ## Related on recent rollout/lesson pair from Harness/README
const readmeHarness = readVault("Harness/README.md");
const rolloutMatch = readmeHarness.match(/\[\[(Harness\/rollout-log\/[^\]]+)\]\]/);
const lessonMatch = readmeHarness.match(/\[\[(Harness\/accepted-lessons\/[^\]]+)\]\]/);
if (rolloutMatch) {
  const rolloutBody = readVault(`${rolloutMatch[1]}.md`);
  if (rolloutBody) {
    if (rolloutBody.includes("## Related")) ok(`sync rollout ${rolloutMatch[1]} has ## Related`);
    else bad(`sync rollout ${rolloutMatch[1]} missing ## Related (post-task chain not applied to vault?)`);
  }
}
if (lessonMatch) {
  const lessonBody = readVault(`${lessonMatch[1]}.md`);
  if (lessonBody) {
    if (lessonBody.includes("## Related")) ok(`sync lesson ${lessonMatch[1]} has ## Related`);
    else bad(`sync lesson ${lessonMatch[1]} missing ## Related (post-task chain not applied to vault?)`);
  }
}

// Lesson hook smoke (no token → skip path; with token → additional_context)
const hook = path.join(repoRoot, ".cursor/hooks/obsidian-lesson-context.py");
if (existsSync(hook)) ok("obsidian-lesson-context.py present");
else bad("obsidian-lesson-context.py missing");

const apiKey = (process.env.OBSIDIAN_API_KEY ?? "").trim();
if (apiKey) {
  const searchUrl = `${(process.env.OBSIDIAN_API_URL ?? "http://127.0.0.1:27123").replace(/\/$/, "")}/search/simple/?query=harness&contextLength=80`;
  try {
    const res = await fetch(searchUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (res.ok) {
      const hits = await res.json();
      ok(`POST search returns HTTP ${res.status} (${Array.isArray(hits) ? hits.length : 0} hits)`);
    } else {
      bad(`POST search returned HTTP ${res.status}`);
    }
  } catch (err) {
    bad(`POST search failed: ${err instanceof Error ? err.message : String(err)}`);
  }
} else {
  ok("POST search skipped (OBSIDIAN_API_KEY unset)");
  ok("lesson hook additional_context skipped (OBSIDIAN_API_KEY unset — run with key to verify live)");
}

for (const p of passes) console.log(`PASS ${p}`);
for (const f of failures) console.log(`FAIL ${f}`);
console.log(`summary pass=${passes.length} fail=${failures.length}`);
process.exit(failures.length === 0 ? 0 : 1);
