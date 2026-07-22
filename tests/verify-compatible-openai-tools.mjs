#!/usr/bin/env node
/**
 * Regression: CompatibleAgent must export real OpenAI/Anthropic tool schemas.
 * @openrouter/agent nests name/inputSchema under `.function`; a flat-only
 * unwrap previously yielded 0 tools and local models faked markdown "tool" use.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "cli/package.json"));

// Prefer built dist (what cursorsi runs); fall back to asserting package is built.
const { openaiToolsForObsidian, anthropicToolsForObsidian } = await import(
  join(root, "cli/dist/sdk/openai-tools.js")
);

const openai = openaiToolsForObsidian(false);
const anthropic = anthropicToolsForObsidian(false);

assert.ok(openai.length >= 10, `expected >=10 openai tools, got ${openai.length}`);
assert.ok(anthropic.length >= 10, `expected >=10 anthropic tools, got ${anthropic.length}`);

const names = openai.map((t) => t.function.name);
assert.ok(names.includes("read_file"), `missing read_file in ${names.join(",")}`);
assert.ok(names.includes("execute_bash"), `missing execute_bash in ${names.join(",")}`);

for (const t of openai) {
  assert.equal(t.type, "function");
  assert.equal(typeof t.function.name, "string");
  assert.equal(typeof t.function.description, "string");
  assert.equal(typeof t.function.parameters, "object");
  assert.ok(t.function.parameters && t.function.parameters.type === "object");
  assert.ok(!("$schema" in (t.function.parameters || {})), "$schema must be stripped");
}

for (const t of anthropic) {
  assert.equal(typeof t.name, "string");
  assert.equal(typeof t.input_schema, "object");
  assert.ok(t.input_schema && t.input_schema.type === "object");
}

// With Obsidian tools enabled, count should grow
const withObs = openaiToolsForObsidian(true);
assert.ok(withObs.length > openai.length, "obsidian tools should add entries");

console.log(
  `ok — openai=${openai.length} anthropic=${anthropic.length} withObs=${withObs.length} names=${names.join(",")}`,
);
void require;
