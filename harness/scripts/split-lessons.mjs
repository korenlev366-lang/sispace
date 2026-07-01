#!/usr/bin/env node
/**
 * Split accepted-lessons.md into individual files under
 * harness/memory/accepted-lessons/ and generate lesson-index.json.
 *
 * Run: node harness/scripts/split-lessons.mjs
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MEMORY_DIR = join(__dirname, "..", "memory");
const ACCEPTED_FILE = join(MEMORY_DIR, "accepted-lessons.md");
const OUT_DIR = join(MEMORY_DIR, "accepted-lessons");
const INDEX_FILE = join(MEMORY_DIR, "lesson-index.json");

/** @type {Record<string, string[]>} */
const TAG_SEED = {
  gnuclient: ["gnuclient", "minecraft", "jvmti", "native-agent"],
  forge: ["forge", "fml", "minecraft"],
  imgui: ["imgui", "overlay", "native"],
  lagrange: ["lagrange", "lag", "packet", "anticheat", "grim"],
  aimassist: ["aimassist", "combat", "vulcan", "anticheat"],
  compaction: ["compaction", "context", "tokens"],
  cursorsi: ["cursorsi", "cli", "tui"],
  sispace: ["sispace", "tauri", "sidecar", "pipeline"],
  obsidian: ["obsidian", "vault", "mcp"],
  harness: ["harness", "curate", "grade", "proposal"],
  ralph: ["ralph", "verify", "goal"],
  css: ["css", "modal", "ui"],
  knockback: ["knockback", "kb", "velocity"],
  sprint: ["sprint", "movement"],
  packet: ["packet", "c03", "c02", "network"],
};

/**
 * @param {string} id
 * @param {string} title
 * @param {string} body
 * @returns {string[]}
 */
function deriveTags(id, title, body) {
  const tags = new Set();
  const lower = (id + " " + title + " " + body.slice(0, 500)).toLowerCase();

  for (const [key, vals] of Object.entries(TAG_SEED)) {
    if (vals.some((v) => lower.includes(v))) {
      vals.forEach((t) => tags.add(t));
    }
  }

  // Extract from Scope line
  const scopeMatch = body.match(/Scope:\s*\*\*(.+?)\*\*/);
  if (scopeMatch) {
    const scope = scopeMatch[1].toLowerCase();
    if (scope.includes("gnuclient")) tags.add("gnuclient");
    if (scope.includes("sispace")) tags.add("sispace");
  }

  // Extract from Recall globs
  const globMatch = body.match(/Recall globs:\s*(.+?)(?:\n|$)/);
  if (globMatch) {
    const globs = globMatch[1];
    if (globs.includes("GNUClient")) tags.add("gnuclient");
    if (globs.includes("native-agent")) tags.add("native-agent");
    if (globs.includes("imgui")) tags.add("imgui");
    if (globs.includes("pipeline")) tags.add("pipeline");
  }

  // Target layer as tag
  const layerMatch = body.match(/Target layer:\s*(.+)/);
  if (layerMatch) {
    const layer = layerMatch[1].trim().toLowerCase();
    if (layer && layer.length < 20) tags.add(layer);
  }

  return [...tags];
}

/**
 * @param {string} title
 * @param {string} body
 * @returns {string}
 */
function deriveOneliner(title, body) {
  // Prefer the Applied change first sentence
  const appliedMatch = body.match(/Applied change:\s*\n+(.+?)(?:\n|$)/s);
  if (appliedMatch) {
    const line = appliedMatch[1].trim();
    if (line.length > 20) {
      return line.replace(/\n/g, " ").slice(0, 160).trim();
    }
  }

  // Fall back to title
  if (title.length > 10) {
    return title.slice(0, 160).trim();
  }

  // Last resort: first non-empty body line
  const firstLine = body.split("\n").find((l) => l.trim().length > 10);
  return (firstLine ?? title).replace(/^[-*]\s*/, "").trim().slice(0, 160);
}

function main() {
  if (!existsSync(ACCEPTED_FILE)) {
    console.error(`File not found: ${ACCEPTED_FILE}`);
    process.exit(1);
  }

  const content = readFileSync(ACCEPTED_FILE, "utf8");

  // Split on ### headings (entries start after "## Entries")
  const entriesIdx = content.indexOf("\n## Entries");
  if (entriesIdx < 0) {
    console.error("Could not find ## Entries section");
    process.exit(1);
  }

  const body = content.slice(entriesIdx + 1);
  const sections = body.split(/\n(?=### )/);

  if (!existsSync(OUT_DIR)) {
    mkdirSync(OUT_DIR, { recursive: true });
  }

  /** @type {Array<{id: string, title: string, oneliner: string, tags: string[], file: string}>} */
  const indexEntries = [];

  for (const section of sections) {
    const headingMatch = section.match(/^###\s+(\S+):?(.*)/);
    if (!headingMatch) continue;

    const id = headingMatch[1].trim();
    const titleRaw = headingMatch[2]?.trim() ?? "";

    // Skip preamble content
    if (!id || id === "Template" || id === "Required" || id === "Entries") continue;

    const sectionBody = section.slice(headingMatch[0].length).trim();
    const title = titleRaw || id;
    const oneliner = deriveOneliner(title, sectionBody);
    const tags = deriveTags(id, title, sectionBody);

    // Sanitize filename
    const safeName = id.replace(/[^A-Za-z0-9._-]/g, "_");
    const fileName = `${safeName}.md`;

    // Write individual file
    const fileContent = `### ${headingMatch[1].trim()}${
      headingMatch[2] ? ":" + headingMatch[2] : ""
    }\n\n${sectionBody.trim()}\n`;
    writeFileSync(join(OUT_DIR, fileName), fileContent, "utf8");

    indexEntries.push({
      id,
      title: title.slice(0, 200),
      oneliner,
      tags,
      file: fileName,
    });

    console.log(`  ${id} → ${fileName} [${tags.join(", ")}]`);
  }

  // Write index
  writeFileSync(
    INDEX_FILE,
    JSON.stringify(
      {
        version: 1,
        generated: new Date().toISOString(),
        source: "harness/memory/accepted-lessons.md",
        entries: indexEntries,
      },
      null,
      2,
    ),
    "utf8",
  );

  console.log(`\nWrote ${indexEntries.length} entries to ${INDEX_FILE}`);
  console.log(`Wrote ${indexEntries.length} files to ${OUT_DIR}/`);
}

main();
