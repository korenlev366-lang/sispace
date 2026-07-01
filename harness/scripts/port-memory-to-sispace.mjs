#!/usr/bin/env node
/**
 * Merge ALL harness/memory ledgers from source repos into SISpace canonical store.
 * Usage: node harness/scripts/port-memory-to-sispace.mjs
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const SISPACE = path.join(os.homedir(), "sispace");
const VAULT_ROOT = path.join(os.homedir(), "harness vault");
const VAULT_MIRROR = path.join(SISPACE, "harness", "vault-mirror");
const VAULT_LESSONS = path.join(VAULT_ROOT, "Harness", "accepted-lessons");

/** Obsidian vault folders to mirror into SISpace (vault-relative paths). */
const VAULT_MIRROR_FOLDERS = [
  "Harness/rollout-log",
  "Harness/reasoning-patterns",
  "Harness/accepted-lessons",
];

const SOURCES = [
  path.join(os.homedir(), "linux minecraft thing"),
  path.join(os.homedir(), ".cursor-harness"),
  path.join(os.homedir(), "harness"),
  SISPACE,
].filter((p, i, a) => fs.existsSync(path.join(p, "harness", "memory")) && a.indexOf(p) === i);

const MEMORY_FILES = [
  "reasoning-patterns.md",
  "accepted-lessons.md",
  "rejected-lessons.md",
  "pending-proposals.md",
  "user-model.md",
  "goals.md",
  "ralph-goal.md",
  "tool-override-log.md",
  "project-index.md",
];

const ENTRY_SPLIT =
  /\n(?=### (?:PATTERN|PENDING|ACCEPTED|PROP|REJECTED|GOAL|USER-PREF)-[^\n]+)/;

function isRealEntry(header) {
  if (/### ACCEPTED-YYYYMMDD-NNN/.test(header)) return false;
  if (/### PATTERN-YYYYMMDD-HHMMSS/.test(header)) return false;
  if (/### PENDING-YYYYMMDD-001/.test(header)) return false;
  if (/### USER-PREF-YYYYMMDD/.test(header)) return false;
  if (/### GOAL-YYYYMMDD/.test(header)) return false;
  return true;
}

function findEntriesSection(text) {
  const markers = [
    /^## Entries\s*$/m,
    /^## Current Preferences\s*$/m,
    /^## Active goals\s*$/m,
  ];
  for (const re of markers) {
    const m = text.match(re);
    if (m?.index !== undefined) {
      const label = m[0].trim();
      return { index: m.index, label, len: label.length };
    }
  }
  return null;
}

function parseEntries(text) {
  const section = findEntriesSection(text);
  const preamble = section ? text.slice(0, section.index + section.len) : text;
  const body = section ? text.slice(section.index + section.len) : "";
  const parts = body.split(ENTRY_SPLIT).map((s) => s.trim()).filter(Boolean);

  const entries = new Map();
  for (const part of parts) {
    const header = part.split("\n")[0]?.trim() ?? "";
    if (!header.startsWith("### ") || !isRealEntry(header)) continue;
    const key = header.slice(4).trim();
    entries.set(key, part.trimEnd());
  }
  return { preamble, entries };
}

function loadVaultPropEntries() {
  const entries = new Map();
  if (!fs.existsSync(VAULT_LESSONS)) return entries;

  for (const name of fs.readdirSync(VAULT_LESSONS)) {
    if (!name.endsWith(".md") || !name.startsWith("PROP-")) continue;
    const raw = fs.readFileSync(path.join(VAULT_LESSONS, name), "utf8");
    const body = raw.replace(/^---[\s\S]*?---\n?/, "").trim();
    const id = name.replace(/\.md$/, "");
    const title = id.replace(/^PROP-/, "PROP-").includes(":")
      ? id
      : `${id}: Accepted proposal (Obsidian vault)`;
    const key = `${id}: Accepted proposal (Obsidian vault)`;
    const block = `### ${key}

- Source task: Obsidian vault mirror (\`Harness/accepted-lessons/${name}\`)
- Reason: Ported accepted-lesson substance from harness vault for SISpace canonical memory.
- Target layer: (see vault tags / rollout-log)
- Date: ${raw.match(/^date:\s*"([^"]+)"/m)?.[1] ?? "unknown"}
- Rollback note: Delete this entry and Obsidian mirror \`Harness/accepted-lessons/${name}\`.
- Applied change:

${body}
`;
    entries.set(key, block.trimEnd());
  }
  return entries;
}

function mergeLedger(filename) {
  const destPath = path.join(SISPACE, "harness/memory", filename);
  const merged = { preamble: "", entries: new Map() };

  if (fs.existsSync(destPath)) {
    Object.assign(merged, parseEntries(fs.readFileSync(destPath, "utf8")));
  }

  for (const srcRoot of SOURCES) {
    const srcPath = path.join(srcRoot, "harness/memory", filename);
    if (!fs.existsSync(srcPath)) continue;
    const { entries } = parseEntries(fs.readFileSync(srcPath, "utf8"));
    for (const [key, body] of entries) {
      const prev = merged.entries.get(key);
      if (!prev || body.length > prev.length) merged.entries.set(key, body);
    }
  }

  if (filename === "accepted-lessons.md") {
    for (const [key, body] of loadVaultPropEntries()) {
      const propId = key.split(":")[0];
      // Prefer longer in-repo PROP entry when present
      const existing = [...merged.entries.keys()].find((k) => k.startsWith(propId + ":"));
      if (!existing || body.length > (merged.entries.get(existing)?.length ?? 0)) {
        if (existing && existing !== key) merged.entries.delete(existing);
        merged.entries.set(key, body);
      }
    }
  }

  if (!merged.preamble && fs.existsSync(destPath)) {
    merged.preamble = fs.readFileSync(destPath, "utf8").split(ENTRY_SPLIT)[0].trim();
  }
  if (!merged.preamble) {
    merged.preamble = "# Memory\n\n## Entries";
  }

  const sortedKeys = [...merged.entries.keys()].sort();
  let out = merged.preamble.trimEnd() + "\n\n";
  for (const key of sortedKeys) {
    out += merged.entries.get(key) + "\n\n";
  }
  out = out
    .replace(/No (accepted lessons|pending proposals|reasoning patterns) recorded yet\.?\n*/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd() + "\n";

  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, out, "utf8");
  if (filename === "accepted-lessons.md" && sortedKeys.length < 10) {
    console.error(`  WARN: expected >10 accepted-lessons entries, got ${sortedKeys.length}`);
  }
  return sortedKeys.length;
}

function rolloutId(block) {
  const m = block.match(/^#{2,3} (ROLLOUT-[^\n]+)/);
  return m?.[1]?.trim() ?? null;
}

function parseRolloutBlocks(text) {
  return text
    .split(/\n(?=#{2,3} ROLLOUT-)/)
    .map((b) => b.trim())
    .filter((b) => rolloutId(b));
}

function mergeRolloutLog() {
  const dest = path.join(SISPACE, "harness/reports/rollout-log.md");
  const blocks = new Map();

  if (fs.existsSync(dest)) {
    for (const block of parseRolloutBlocks(fs.readFileSync(dest, "utf8"))) {
      const id = rolloutId(block);
      if (id) blocks.set(id, block);
    }
  }

  let added = 0;
  for (const srcRoot of SOURCES) {
    const src = path.join(srcRoot, "harness/reports/rollout-log.md");
    if (!fs.existsSync(src)) continue;
    for (const block of parseRolloutBlocks(fs.readFileSync(src, "utf8"))) {
      const id = rolloutId(block);
      if (!id) continue;
      const prev = blocks.get(id);
      if (!prev || block.length > prev.length) {
        if (!prev) added += 1;
        blocks.set(id, block);
      }
    }
  }

  const header = fs.existsSync(dest)
    ? fs.readFileSync(dest, "utf8").split(/\n(?=#{2,3} ROLLOUT-)/)[0].trimEnd()
    : `# Rollout Log

Append-only record of harness self-optimization rollouts (canonical store: ${SISPACE}).

## Entries`;

  const sorted = [...blocks.keys()].sort();
  const body = sorted.map((id) => blocks.get(id)).join("\n\n");
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, `${header}\n\n${body}\n`, "utf8");
  return { total: sorted.length, added };
}

/** Append-only logs: post-task-chain.log, retroactive-reflect.log */
function mergeAppendLog(filename) {
  const dest = path.join(SISPACE, "harness/reports", filename);
  const lines = new Set();
  if (fs.existsSync(dest)) {
    for (const line of fs.readFileSync(dest, "utf8").split("\n")) {
      if (line.trim()) lines.add(line);
    }
  }

  let added = 0;
  for (const srcRoot of SOURCES) {
    const src = path.join(srcRoot, "harness/reports", filename);
    if (!fs.existsSync(src)) continue;
    for (const line of fs.readFileSync(src, "utf8").split("\n")) {
      if (!line.trim()) continue;
      if (!lines.has(line)) {
        lines.add(line);
        added += 1;
      }
    }
  }

  const header = `# ${filename} (canonical: ${SISPACE})\n# Ported from: ${SOURCES.map((p) => path.basename(p)).join(", ")}\n\n`;
  const body = [...lines].join("\n") + "\n";
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (!fs.existsSync(dest)) {
    fs.writeFileSync(dest, header + body, "utf8");
  } else {
    const existing = fs.readFileSync(dest, "utf8");
    if (!existing.includes("linux minecraft thing")) {
      fs.writeFileSync(dest, header + existing + "\n# --- lines merged from other repos ---\n" + body, "utf8");
    } else {
      fs.writeFileSync(dest, header + body, "utf8");
    }
  }
  return added;
}

/** Copy Obsidian vault markdown mirrors into harness/vault-mirror/ (idempotent). */
function mirrorObsidianVault() {
  if (!fs.existsSync(VAULT_ROOT)) {
    console.log("  vault-mirror: skipped (vault not found)");
    return { copied: 0, skipped: 0, folders: [] };
  }

  let copied = 0;
  let skipped = 0;
  const folders = [];

  for (const rel of VAULT_MIRROR_FOLDERS) {
    const srcDir = path.join(VAULT_ROOT, rel);
    const destDir = path.join(VAULT_MIRROR, rel);
    if (!fs.existsSync(srcDir)) continue;

    fs.mkdirSync(destDir, { recursive: true });
    let folderCopied = 0;

    for (const name of fs.readdirSync(srcDir)) {
      if (!name.endsWith(".md")) continue;
      const src = path.join(srcDir, name);
      const dest = path.join(destDir, name);
      if (!fs.statSync(src).isFile()) continue;

      const srcStat = fs.statSync(src);
      if (fs.existsSync(dest)) {
        const destStat = fs.statSync(dest);
        if (destStat.mtimeMs >= srcStat.mtimeMs && destStat.size === srcStat.size) {
          skipped += 1;
          continue;
        }
      }
      fs.copyFileSync(src, dest);
      fs.utimesSync(dest, srcStat.atime, srcStat.mtime);
      copied += 1;
      folderCopied += 1;
    }
    folders.push({ rel, files: folderCopied });
  }

  const readme = `# Obsidian vault mirror (canonical copy in SISpace)

Copied from \`${VAULT_ROOT}\` by \`harness/scripts/port-memory-to-sispace.mjs\`.

| Folder | Purpose |
|--------|---------|
| \`Harness/rollout-log/\` | Per-rollout session summaries (one note per ROLLOUT-*) |
| \`Harness/reasoning-patterns/\` | Per-session pattern mirrors |
| \`Harness/accepted-lessons/\` | Per-proposal Obsidian stubs |

Live vault remains at \`${VAULT_ROOT}\`; this tree is for recall when working only in SISpace.
`;
  fs.mkdirSync(VAULT_MIRROR, { recursive: true });
  fs.writeFileSync(path.join(VAULT_MIRROR, "README.md"), readme, "utf8");

  return { copied, skipped, folders };
}

console.log("SISpace full memory port — sources:", SOURCES.map((p) => path.basename(p)).join(", "));
const counts = {};
for (const f of MEMORY_FILES) {
  counts[f] = mergeLedger(f);
  console.log(`  ${f}: ${counts[f]} entries`);
}
const rollouts = mergeRolloutLog();
console.log(`  rollout-log.md: ${rollouts.total} total (${rollouts.added} newly merged)`);
const chainLines = mergeAppendLog("post-task-chain.log");
console.log(`  post-task-chain.log: +${chainLines} lines`);
const retroLines = mergeAppendLog("retroactive-reflect.log");
console.log(`  retroactive-reflect.log: +${retroLines} lines`);
const vault = mirrorObsidianVault();
console.log(
  `  vault-mirror: +${vault.copied} files (${vault.skipped} unchanged) — ${vault.folders.map((f) => `${f.rel}: ${f.files}`).join("; ")}`,
);
