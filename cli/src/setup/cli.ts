/**
 * cursorsi setup — scaffold hooks, harness, config, and home dirs.
 *
 * Usage:
 *   cursorsi setup [--force] [--sync-global] [--home-only] [TARGET_DIR]
 */

import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  cpSync,
  writeFileSync,
  readFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { userSettingsPath, loadUserSettings, saveUserSettings } from "../config/user-settings.js";
import { credentialsPath } from "../config/credentials.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export function resolveTemplatesRoot(): string | null {
  const candidates = [
    // npm package / built cli: dist/setup → ../../templates
    join(__dirname, "../../templates"),
    // monorepo: cli/dist/setup → repo root (has .cursor + harness)
    join(__dirname, "../../.."),
  ];

  for (const root of candidates) {
    if (existsSync(join(root, ".cursor/hooks.json"))) {
      return root;
    }
  }

  return null;
}

function ensureDir(path: string, mode = 0o755): void {
  mkdirSync(path, { recursive: true, mode });
}

function copyIfMissing(
  src: string,
  dest: string,
  force: boolean,
): "copied" | "skipped" | "missing" {
  if (!existsSync(src)) return "missing";
  if (existsSync(dest) && !force) return "skipped";
  ensureDir(dirname(dest));
  cpSync(src, dest, { recursive: true, force: true });
  return "copied";
}

function ensureHomeDirs(): string[] {
  const notes: string[] = [];
  const home = join(homedir(), ".cursorsi");
  ensureDir(home, 0o700);
  notes.push(`home: ${home}`);

  const settingsPath = userSettingsPath();
  ensureDir(dirname(settingsPath));
  if (!existsSync(settingsPath)) {
    // Touch defaults via load/save
    loadUserSettings();
    saveUserSettings({});
    notes.push(`settings: ${settingsPath} (created)`);
  } else {
    notes.push(`settings: ${settingsPath}`);
  }

  const creds = credentialsPath();
  ensureDir(dirname(creds), 0o700);
  notes.push(`credentials: ${creds} (use /auth to fill)`);

  const dbDir = join(homedir(), ".local", "share", "sispace");
  ensureDir(dbDir);
  notes.push(`db dir: ${dbDir}`);

  return notes;
}

function printHelp(): void {
  console.log(`cursorsi setup — install hooks, harness, and config

Usage:
  cursorsi setup [--force] [--sync-global] [--home-only] [TARGET_DIR]

Options:
  --force         Overwrite existing hook/config files
  --sync-global   Also refresh ~/.cursor-harness template
  --home-only     Only create ~/.cursorsi + settings (no project files)
  TARGET_DIR      Project to scaffold (default: cwd)

After setup:
  cursorsi              Start the TUI
  /auth                 Store API keys
  /backend              Pick OpenRouter / Cursor / Compatible

Restart Cursor IDE after installing project hooks.
`);
}

function isCursorsiPackageRoot(dir: string): boolean {
  try {
    const pkgPath = join(dir, "package.json");
    if (!existsSync(pkgPath) || !existsSync(join(dir, "bin/cursorsi.mjs"))) {
      return false;
    }
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { name?: string };
    return pkg.name === "cursorsi";
  } catch {
    return false;
  }
}

export async function runSetupCli(
  args: string[],
  cwd: string,
): Promise<number> {
  if (args.includes("-h") || args.includes("--help")) {
    printHelp();
    return 0;
  }

  let force = false;
  let syncGlobal = false;
  let homeOnly = false;
  let target = cwd;

  for (let i = 0; i < args.length; i += 1) {
    const a = args[i]!;
    if (a === "--force") force = true;
    else if (a === "--sync-global") syncGlobal = true;
    else if (a === "--home-only") homeOnly = true;
    else if (a.startsWith("-")) {
      console.error(`Unknown option: ${a}`);
      printHelp();
      return 1;
    } else {
      target = resolve(a);
    }
  }

  console.log("cursorsi setup");
  console.log("─".repeat(40));

  for (const line of ensureHomeDirs()) {
    console.log(`  ${line}`);
  }

  if (homeOnly) {
    console.log("\nDone (home only). Run `cursorsi` then `/auth`.");
    return 0;
  }

  const templates = resolveTemplatesRoot();
  if (!templates) {
    console.error(
      "\n! Templates not found. Reinstall the cursorsi package, or run from a sispace checkout after `npm run sync:templates`.",
    );
    return 1;
  }

  console.log(`  templates: ${templates}`);
  ensureDir(target);

  if (isCursorsiPackageRoot(target)) {
    console.error(
      `\n! Refusing to scaffold into the cursorsi package itself (${target}).\n  Run setup from your project directory, e.g. \`cd ~/my-app && cursorsi setup\`.`,
    );
    return 1;
  }

  if (resolve(target) === resolve(templates)) {
    console.error(`\n! Refusing to scaffold into the templates directory.`);
    return 1;
  }

  // Project-local memory/skills
  ensureDir(join(target, ".cursorsi/memory"));
  ensureDir(join(target, ".cursorsi/skills"));
  console.log(`  .cursorsi/: ${join(target, ".cursorsi")}`);

  // Config + invoke-chain + generic AGENTS.md (not covered by harness-install)
  const cfgSrc = join(templates, "config");
  if (existsSync(cfgSrc)) {
    const r = copyIfMissing(cfgSrc, join(target, "config"), force);
    console.log(`  config/: ${r}`);
  }

  const agentsSrc = join(templates, "AGENTS.md");
  if (existsSync(agentsSrc)) {
    const r = copyIfMissing(agentsSrc, join(target, "AGENTS.md"), force);
    console.log(`  AGENTS.md: ${r}`);
  }

  const invokeSrc = join(templates, "scripts/invoke-chain.sh");
  if (existsSync(invokeSrc)) {
    const dest = join(target, "scripts/invoke-chain.sh");
    const r = copyIfMissing(invokeSrc, dest, force);
    if (r === "copied") {
      try {
        chmodSync(dest, 0o755);
      } catch {
        // best-effort
      }
    }
    console.log(`  scripts/invoke-chain.sh: ${r}`);
  }

  // Prefer harness-install.sh when present (full hooks + harness + build)
  const installSh = join(templates, "harness/scripts/harness-install.sh");
  if (existsSync(installSh)) {
    const shArgs = [installSh];
    if (force) shArgs.push("--force");
    if (syncGlobal) shArgs.push("--sync-global");
    shArgs.push(target);
    console.log(`\n› Running harness-install…`);
    try {
      execFileSync("sh", shArgs, {
        cwd: templates,
        stdio: "inherit",
        env: {
          ...process.env,
          // When templates are the package templates/, treat them as HARNESS_HOME
          // harness-install discovers itself via script path.
        },
      });
    } catch (err) {
      console.error(
        `! harness-install failed: ${err instanceof Error ? err.message : err}`,
      );
      return 1;
    }
  } else {
    // Minimal fallback: copy .cursor + harness config/scaffold/scripts
    console.log("\n› harness-install.sh missing — copying core templates…");
    for (const rel of [".cursor", "harness/config", "harness/scaffold", "harness/scripts"]) {
      const src = join(templates, rel);
      const dest = join(target, rel);
      const r = copyIfMissing(src, dest, force);
      console.log(`  ${rel}: ${r}`);
    }
  }

  // Marker so findProjectRoot works even before harness dist rebuild
  const marker = join(target, ".cursorsi/README.md");
  if (!existsSync(marker) || force) {
    writeFileSync(
      marker,
      `# cursorsi project

Created by \`cursorsi setup\`.

- Memory: \`.cursorsi/memory/\`
- Skills: \`.cursorsi/skills/\`
- Config: \`config/sispace.yaml\`
- Hooks: \`.cursor/\`
`,
      "utf8",
    );
  }

  // Write a tiny install stamp
  const stamp = join(target, ".cursorsi/setup.json");
  writeFileSync(
    stamp,
    JSON.stringify(
      {
        setupAt: new Date().toISOString(),
        templatesRoot: templates,
        packageVersion: readPackageVersion(),
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );

  console.log(`
Done.

Next:
  1. cursorsi          # start TUI in ${target}
  2. /auth             # store OpenRouter / Cursor / compatible keys
  3. /backend          # pick which backend to use
  4. Restart Cursor IDE if you use project hooks
`);
  return 0;
}

function readPackageVersion(): string {
  try {
    const pkgPath = join(__dirname, "../../package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}
