#!/usr/bin/env node
/**
 * Sync installable templates into cli/templates/ for npm publish.
 *
 * Copies harness/hooks from the monorepo, then **genericizes** them so the
 * public package has no personal paths, vaults, or project-specific skills.
 *
 * Run: node cli/scripts/sync-templates.mjs
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliRoot = resolve(__dirname, "..");
const repoRoot = resolve(cliRoot, "..");
const outRoot = join(cliRoot, "templates");

const SKIP_DIR_NAMES = new Set([
  "node_modules",
  ".venv",
  ".venv-headroom",
  ".git",
  "dist-info",
  "__pycache__",
  "state",
]);

/** Paths relative to templates/ that must never ship (personal / monorepo-only). */
const SKIP_REL_PATHS = new Set([
  ".cursor/skills/gtk-app",
  "harness/scripts/verify-sispace-gtk-app.sh",
  "harness/scripts/verify-obsidian-integration.sh",
  // Personal migration / vault port utilities — not for public installs
  "harness/scripts/split-lessons.mjs",
  "harness/scripts/port-memory-to-sispace.mjs",
]);

const GENERIC_AGENTS_MD = `# Agent Instructions

## Memory

Before non-trivial work, search project harness memory when available:

- \`harness/memory/accepted-lessons/\` (or \`accepted-lessons.md\`)
- \`harness/memory/user-model.md\`
- \`harness/memory/reasoning-patterns.md\`

If Obsidian MCP is configured, prefer vault search for the same topics.

## Code discipline

- Read a file before editing it
- Make surgical changes — only what the task requires
- No speculative abstractions
- Verify with build/test/output before claiming done
- Match existing conventions in the file you touch

## Communication

- Concise and direct — lead with the answer
- No emojis unless the user uses them
- State assumptions before acting on them
- If stuck after a few attempts, say so instead of spinning

## Project notes

Customize this file for your repo (stack, paths, preferences).
\`cursorsi\` injects it once per session from the git root.
`;

const GENERIC_OBSIDIAN_YAML = `# Obsidian vault index paths (optional).
# Set vault_root to your Obsidian vault, then restart Cursor / cursorsi.

vault_root: ""
vault_prefix: Harness

folders:
  accepted_lessons: Harness/accepted-lessons
  rejected_lessons: Harness/rejected-lessons
  user_model: Harness/user-model
  reasoning_patterns: Harness/reasoning-patterns
  rollout_log: Harness/rollout-log
  tasks: tasks

# REST/MCP search scopes for lesson recall at session start (vault-relative).
lesson_search_globs:
  - Harness/accepted-lessons/**
  - Harness/rejected-lessons/**
  - Harness/user-model/**
  - Harness/reasoning-patterns/**
  - tasks/**
`;

const GENERIC_INSTALL_MD = `# Harness Install

Install cursorsi hooks, agents, commands, and harness scripts into a project.

## Recommended

From the project root:

\`\`\`sh
cursorsi setup
cursorsi setup --force           # overwrite existing copies
cursorsi setup --sync-global     # also refresh ~/.cursor-harness
\`\`\`

## Manual (from a cursorsi install / template tree)

\`\`\`sh
sh path/to/templates/harness/scripts/harness-install.sh
sh path/to/templates/harness/scripts/harness-install.sh --force
sh path/to/templates/harness/scripts/harness-install.sh --sync-global
\`\`\`

### Installed into the target project

| Source | Destination |
| --- | --- |
| \`.cursor/hooks.json\` + \`.cursor/hooks/\` | Same |
| \`.cursor/commands/\` | \`harness-*\` slash commands |
| \`.cursor/agents/\` | Reflection, grading, workflow, checker agents |
| \`.cursor/skills/harness-*\` | Skills |
| \`harness/config/\` | Runtime policy |
| \`harness/scripts/\` | Shell tools + compiled \`dist/\` |
| \`harness/scaffold/\` | Empty ledgers/reports (skip if present) |

### Canonical memory (optional)

When \`SISPACE_HOME\` points at a harness memory tree (or \`~/sispace/harness/memory\` exists):

- Ledgers/reports can live in that canonical store
- Project hooks still run locally

\`\`\`sh
export SISPACE_HOME=/path/to/canonical-harness-home
\`\`\`

### MCP

- Keep Obsidian MCP in \`~/.cursor/mcp.json\` (global)
- Do not commit API tokens

## After install

Restart Cursor (or start a new agent session) so hook changes load.
`;

const GENERIC_OBSIDIAN_SYNC_MD = `# Obsidian sync (searchable index)

Repo markdown files are the **source of truth**. Obsidian vault notes under \`Harness/\` are an optional searchable mirror updated by the post-task chain.

- **Vault root:** set in \`harness/config/obsidian.yaml\` (\`vault_root\`)
- **Harness directory:** \`{vault_root}/Harness/\`

## Vault layout

| Folder | Repo source |
| --- | --- |
| \`Harness/accepted-lessons/\` | Entries from \`accepted-lessons.md\` |
| \`Harness/rejected-lessons/\` | Entries from \`rejected-lessons.md\` |
| \`Harness/user-model/\` | Entries from \`user-model.md\` |
| \`Harness/reasoning-patterns/\` | Reasoning trace from reflection |
| \`Harness/rollout-log/\` | Entries from \`rollout-log.md\` |

Config: \`harness/config/obsidian.yaml\`

Never store API tokens in committed files.
`;

const GENERIC_CONFIG_README = `# Harness config

Edit these files for your environment:

- \`harness.yaml\` — auto-apply / reflection policy
- \`obsidian.yaml\` — optional Obsidian vault root (leave empty if unused)
- \`thresholds.yaml\` — grading / token thresholds
`;

function shouldSkipDir(name) {
  if (SKIP_DIR_NAMES.has(name)) return true;
  if (name.startsWith(".venv")) return true;
  return false;
}

function shouldSkipRel(relPosix) {
  if (SKIP_REL_PATHS.has(relPosix)) return true;
  for (const skip of SKIP_REL_PATHS) {
    if (relPosix === skip || relPosix.startsWith(`${skip}/`)) return true;
  }
  return false;
}

function copyTree(src, dest, relBase = "") {
  if (!existsSync(src)) {
    console.warn(`sync-templates: skip missing ${relative(repoRoot, src)}`);
    return;
  }
  const rel = relBase.replace(/\\/g, "/");
  if (rel && shouldSkipRel(rel)) return;

  mkdirSync(dirname(dest), { recursive: true });
  const st = statSync(src);
  if (st.isFile()) {
    cpSync(src, dest);
    return;
  }
  mkdirSync(dest, { recursive: true });
  for (const name of readdirSync(src)) {
    if (shouldSkipDir(name)) continue;
    const childRel = rel ? `${rel}/${name}` : name;
    if (shouldSkipRel(childRel)) continue;
    copyTree(join(src, name), join(dest, name), childRel);
  }
}

/** Replace personal absolute paths / usernames in text files. */
function scrubText(text) {
  return text
    .replaceAll("/home/lev/sispace", "$HOME/sispace")
    .replaceAll("/home/lev/harness vault", "${OBSIDIAN_VAULT:-}")
    .replaceAll("/home/lev/linux minecraft thing/gnu client dev/Harness", "")
    .replaceAll("/home/lev/linux minecraft thing/gnu client", "")
    .replaceAll("/home/lev/linux minecraft thing", "")
    .replaceAll("/home/lev/", "$HOME/")
    .replaceAll("https://github.com/lev/sispace", "https://github.com/korenlev366-lang/sispace")
    .replaceAll("https://github.com/korenlev366-lang/sispace.git", "https://github.com/korenlev366-lang/sispace")
    .replace(/Lev's monorepo/gi, "this project")
    .replace(/\bLev\b/g, "the user");
}

function walkFiles(dir, fn) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walkFiles(p, fn);
    else fn(p);
  }
}

function assertSource() {
  const hooks = join(repoRoot, ".cursor/hooks.json");
  const chain = join(repoRoot, "harness/scripts/dist/post-task-chain.js");
  if (!existsSync(hooks)) {
    console.error(`sync-templates: missing ${hooks}`);
    process.exit(1);
  }
  if (!existsSync(chain)) {
    console.error(
      `sync-templates: missing ${chain} — build harness first: npm run build --prefix harness/scripts`,
    );
    process.exit(1);
  }
}

assertSource();
rmSync(outRoot, { recursive: true, force: true });
mkdirSync(outRoot, { recursive: true });

copyTree(join(repoRoot, ".cursor"), join(outRoot, ".cursor"), ".cursor");
copyTree(join(repoRoot, "harness/config"), join(outRoot, "harness/config"), "harness/config");
copyTree(join(repoRoot, "harness/scaffold"), join(outRoot, "harness/scaffold"), "harness/scaffold");
copyTree(join(repoRoot, "harness/scripts"), join(outRoot, "harness/scripts"), "harness/scripts");
copyTree(join(repoRoot, "config"), join(outRoot, "config"), "config");
copyTree(
  join(repoRoot, "scripts/invoke-chain.sh"),
  join(outRoot, "scripts/invoke-chain.sh"),
  "scripts/invoke-chain.sh",
);

// Overlay generic public files (never ship personal vault / install paths).
writeFileSync(join(outRoot, "AGENTS.md"), GENERIC_AGENTS_MD, "utf8");
writeFileSync(join(outRoot, "harness/config/obsidian.yaml"), GENERIC_OBSIDIAN_YAML, "utf8");
writeFileSync(join(outRoot, ".cursor/commands/harness-install.md"), GENERIC_INSTALL_MD, "utf8");
writeFileSync(join(outRoot, ".cursor/hooks/lib/obsidian-sync.md"), GENERIC_OBSIDIAN_SYNC_MD, "utf8");
writeFileSync(join(outRoot, "harness/config/README.md"), GENERIC_CONFIG_README, "utf8");

// Keep @AGENTS.md rule, but ensure it points at the generic file setup copies.
writeFileSync(
  join(outRoot, ".cursor/rules/00-system.mdc"),
  `---
description: Project agent instructions (AGENTS.md)
alwaysApply: true
---

@AGENTS.md
`,
  "utf8",
);

const TEXT_EXT = new Set([
  ".md",
  ".mdc",
  ".json",
  ".yaml",
  ".yml",
  ".sh",
  ".py",
  ".ts",
  ".js",
  ".mjs",
  ".txt",
]);

walkFiles(outRoot, (filePath) => {
  const ext = filePath.slice(filePath.lastIndexOf("."));
  if (!TEXT_EXT.has(ext)) return;
  const before = readFileSync(filePath, "utf8");
  const after = scrubText(before);
  if (after !== before) writeFileSync(filePath, after, "utf8");
});

// Soft-check: fail sync if obvious personal leftovers remain.
const leftovers = [];
walkFiles(outRoot, (filePath) => {
  const ext = filePath.slice(filePath.lastIndexOf("."));
  if (!TEXT_EXT.has(ext)) return;
  const text = readFileSync(filePath, "utf8");
  if (
    text.includes("/home/lev/") ||
    text.includes("Lev's monorepo") ||
    text.includes("GNUClient") ||
    text.includes("gtk-app") ||
    // path-like vault defaults only (not prose "harness vault")
    /(?:\/|\$HOME\/|")harness vault/.test(text)
  ) {
    leftovers.push(relative(outRoot, filePath));
  }
});
if (leftovers.length) {
  console.error("sync-templates: personal leftovers still present (failing):");
  for (const f of leftovers.slice(0, 40)) console.error(`  - ${f}`);
  process.exit(1);
}

writeFileSync(
  join(outRoot, "README.md"),
  `# cursorsi templates (public)

Generic hooks, harness agents/commands, and config for \`cursorsi setup\`.

Personal vault paths and project-specific skills are stripped at sync time.
Do not edit by hand — run \`npm run sync:templates\` in cli/.
`,
  "utf8",
);

console.log(`sync-templates: wrote ${outRoot} (genericized for public npm)`);
