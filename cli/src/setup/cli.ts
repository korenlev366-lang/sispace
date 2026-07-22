/**
 * cursorsi setup — install Cursor hooks/skills globally by default.
 *
 * Usage:
 *   cursorsi setup [--force] [--home-only] [--project [DIR]] [--sync-harness]
 *
 * Default: ~/.cursor hooks/commands/agents/skills + ~/.cursor-harness scripts
 * --project: also scaffold the current (or given) project
 */

import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  cpSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  userSettingsPath,
  loadUserSettings,
  saveUserSettings,
} from "../config/user-settings.js";
import { credentialsPath } from "../config/credentials.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const GLOBAL_HOOKS_JSON = `{
  "version": 1,
  "hooks": {
    "beforeSubmitPrompt": [
      {
        "command": "./hooks/before-submit-prompt.sh",
        "matcher": "UserPromptSubmit",
        "timeout": 5,
        "failClosed": false
      }
    ],
    "preToolUse": [
      {
        "command": "./hooks/pre-tool-use.sh",
        "timeout": 5,
        "failClosed": false
      }
    ],
    "sessionEnd": [
      {
        "command": "./hooks/post-task-adapter.sh",
        "timeout": 5,
        "failClosed": false
      }
    ]
  }
}
`;

export function resolveTemplatesRoot(): string | null {
  const candidates = [
    join(__dirname, "../../templates"),
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

function copyTreeFiltered(
  src: string,
  dest: string,
  force: boolean,
  skipNames: Set<string> = new Set(["node_modules", ".venv", "state"]),
): number {
  if (!existsSync(src)) return 0;
  let n = 0;
  const st = statSync(src);
  if (st.isFile()) {
    const r = copyIfMissing(src, dest, force);
    return r === "copied" ? 1 : 0;
  }
  ensureDir(dest);
  for (const name of readdirSync(src)) {
    if (skipNames.has(name) || name.startsWith(".venv")) continue;
    n += copyTreeFiltered(join(src, name), join(dest, name), force, skipNames);
  }
  return n;
}

function ensureHomeDirs(): string[] {
  const notes: string[] = [];
  const home = join(homedir(), ".cursorsi");
  ensureDir(home, 0o700);
  notes.push(`home: ${home}`);

  const settingsPath = userSettingsPath();
  ensureDir(dirname(settingsPath));
  if (!existsSync(settingsPath)) {
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
  console.log(`cursorsi setup — install Cursor hooks/skills (global by default)

Usage:
  cursorsi setup [--force] [--home-only] [--project [DIR]] [--sync-harness]

Default (no flags):
  Install harness hooks, commands, agents, and skills into ~/.cursor/
  and reflection scripts into ~/.cursor-harness/
  (applies to all Cursor workspaces on this machine)

Options:
  --force          Overwrite existing global/project files
  --home-only      Only create ~/.cursorsi + settings
  --project [DIR]  Also scaffold project files (AGENTS.md, config, local harness)
                   DIR defaults to cwd when omitted
  --sync-harness   Force refresh ~/.cursor-harness even if present
                   (also runs on first setup / with --force)

After setup:
  cursorsi              Start the TUI
  /auth                 Store API keys
  /backend              Pick OpenRouter / Cursor / Compatible

Restart Cursor IDE so global hooks reload.
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

function chmodTreeSh(dir: string): void {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) chmodTreeSh(p);
    else if (name.endsWith(".sh")) {
      try {
        chmodSync(p, 0o755);
      } catch {
        // best-effort
      }
    }
  }
}

/** Install Cursor user hooks/skills into ~/.cursor + harness scripts into ~/.cursor-harness. */
function installGlobalCursor(
  templates: string,
  force: boolean,
  syncHarness: boolean,
): void {
  const cursorHome = join(homedir(), ".cursor");
  const harnessHome = join(homedir(), ".cursor-harness");
  const srcCursor = join(templates, ".cursor");

  console.log(`\n› Global Cursor install → ${cursorHome}`);
  ensureDir(cursorHome);

  const hooksJson = join(cursorHome, "hooks.json");
  if (!existsSync(hooksJson) || force) {
    writeFileSync(hooksJson, GLOBAL_HOOKS_JSON, "utf8");
    console.log(`  hooks.json: copied (user-hook paths ./hooks/…)`);
  } else {
    console.log(`  hooks.json: skipped (exists; use --force to overwrite)`);
  }

  const hooksSrc = join(srcCursor, "hooks");
  const hooksDest = join(cursorHome, "hooks");
  const nHooks = copyTreeFiltered(hooksSrc, hooksDest, force);
  chmodTreeSh(hooksDest);
  console.log(`  hooks/: ${nHooks} file(s) copied`);

  for (const rel of ["commands", "agents"] as const) {
    const src = join(srcCursor, rel);
    const dest = join(cursorHome, rel);
    const n = copyTreeFiltered(src, dest, force);
    console.log(`  ${rel}/: ${n} file(s) copied`);
  }

  // Skills: harness-* only
  const skillsSrc = join(srcCursor, "skills");
  if (existsSync(skillsSrc)) {
    let n = 0;
    for (const name of readdirSync(skillsSrc)) {
      if (!name.startsWith("harness-")) continue;
      const src = join(skillsSrc, name);
      if (!statSync(src).isDirectory()) continue;
      n += copyTreeFiltered(src, join(cursorHome, "skills", name), force);
    }
    console.log(`  skills/harness-*: ${n} file(s) copied`);
  }

  // Harness scripts home (post-task chain looks here first)
  const needHarness =
    syncHarness ||
    force ||
    !existsSync(join(harnessHome, "harness/scripts/dist/post-task-chain.js"));

  console.log(`\n› Harness scripts → ${harnessHome}`);
  if (needHarness) {
    ensureDir(harnessHome);
    copyTreeFiltered(
      join(templates, "harness/config"),
      join(harnessHome, "harness/config"),
      force,
    );
    copyTreeFiltered(
      join(templates, "harness/scaffold"),
      join(harnessHome, "harness/scaffold"),
      force,
    );
    copyTreeFiltered(
      join(templates, "harness/scripts"),
      join(harnessHome, "harness/scripts"),
      force,
    );
    // Keep a copy of hooks template for harness-install --sync-global compat
    copyTreeFiltered(srcCursor, join(harnessHome, ".cursor"), force);

    const scriptsDir = join(harnessHome, "harness/scripts");
    if (existsSync(join(scriptsDir, "package.json"))) {
      try {
        console.log(`  BUILD npm install + build in ${scriptsDir}`);
        execFileSync("npm", ["install", "--no-fund", "--no-audit"], {
          cwd: scriptsDir,
          stdio: "inherit",
        });
        execFileSync("npm", ["run", "build"], {
          cwd: scriptsDir,
          stdio: "inherit",
        });
      } catch {
        console.error(
          `  ! harness scripts build failed — run manually in ${scriptsDir}`,
        );
      }
    }
  } else {
    console.log(`  skipped (already present; use --sync-harness or --force)`);
  }
}

function scaffoldProject(
  templates: string,
  target: string,
  force: boolean,
): number {
  if (isCursorsiPackageRoot(target)) {
    console.error(
      `\n! Refusing to scaffold into the cursorsi package itself (${target}).`,
    );
    return 1;
  }
  if (resolve(target) === resolve(templates)) {
    console.error(`\n! Refusing to scaffold into the templates directory.`);
    return 1;
  }

  console.log(`\n› Project scaffold → ${target}`);
  ensureDir(target);
  ensureDir(join(target, ".cursorsi/memory"));
  ensureDir(join(target, ".cursorsi/skills"));
  console.log(`  .cursorsi/: ${join(target, ".cursorsi")}`);

  const cfgSrc = join(templates, "config");
  if (existsSync(cfgSrc)) {
    console.log(`  config/: ${copyIfMissing(cfgSrc, join(target, "config"), force)}`);
  }

  const agentsSrc = join(templates, "AGENTS.md");
  if (existsSync(agentsSrc)) {
    console.log(
      `  AGENTS.md: ${copyIfMissing(agentsSrc, join(target, "AGENTS.md"), force)}`,
    );
  }

  const invokeSrc = join(templates, "scripts/invoke-chain.sh");
  if (existsSync(invokeSrc)) {
    const dest = join(target, "scripts/invoke-chain.sh");
    const r = copyIfMissing(invokeSrc, dest, force);
    if (r === "copied") {
      try {
        chmodSync(dest, 0o755);
      } catch {
        // ignore
      }
    }
    console.log(`  scripts/invoke-chain.sh: ${r}`);
  }

  const installSh = join(templates, "harness/scripts/harness-install.sh");
  if (existsSync(installSh)) {
    console.log(`\n› Running harness-install (project)…`);
    try {
      const shArgs = [installSh];
      if (force) shArgs.push("--force");
      shArgs.push(target);
      execFileSync("sh", shArgs, {
        cwd: templates,
        stdio: "inherit",
        env: { ...process.env },
      });
    } catch (err) {
      console.error(
        `! harness-install failed: ${err instanceof Error ? err.message : err}`,
      );
      return 1;
    }
  }

  const marker = join(target, ".cursorsi/README.md");
  if (!existsSync(marker) || force) {
    writeFileSync(
      marker,
      `# cursorsi project

Created by \`cursorsi setup --project\`.

Global hooks/skills live in \`~/.cursor/\` (from plain \`cursorsi setup\`).
This folder holds project memory and optional local harness overrides.
`,
      "utf8",
    );
  }

  writeFileSync(
    join(target, ".cursorsi/setup.json"),
    JSON.stringify(
      {
        setupAt: new Date().toISOString(),
        templatesRoot: templates,
        packageVersion: readPackageVersion(),
        mode: "project",
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );

  return 0;
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
  let homeOnly = false;
  let syncHarness = false;
  let doProject = false;
  let projectDir: string | null = null;

  for (let i = 0; i < args.length; i += 1) {
    const a = args[i]!;
    if (a === "--force") force = true;
    else if (a === "--home-only") homeOnly = true;
    else if (a === "--sync-harness" || a === "--sync-global") {
      // --sync-global kept as alias for older docs
      syncHarness = true;
    } else if (a === "--project") {
      doProject = true;
      const next = args[i + 1];
      if (next && !next.startsWith("-")) {
        projectDir = resolve(next);
        i += 1;
      } else {
        projectDir = cwd;
      }
    } else if (a.startsWith("-")) {
      console.error(`Unknown option: ${a}`);
      printHelp();
      return 1;
    } else {
      // Bare path = --project <dir> shorthand
      doProject = true;
      projectDir = resolve(a);
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

  installGlobalCursor(templates, force, syncHarness);

  if (doProject) {
    const code = scaffoldProject(templates, projectDir ?? cwd, force);
    if (code !== 0) return code;
  }

  writeFileSync(
    join(homedir(), ".cursorsi/setup.json"),
    JSON.stringify(
      {
        setupAt: new Date().toISOString(),
        templatesRoot: templates,
        packageVersion: readPackageVersion(),
        mode: doProject ? "global+project" : "global",
        cursorHome: join(homedir(), ".cursor"),
        harnessHome: join(homedir(), ".cursor-harness"),
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );

  console.log(`
Done.

Installed globally (all Cursor workspaces):
  ~/.cursor/hooks.json + hooks/ commands/ agents/ skills/harness-*
  ~/.cursor-harness/   (post-task reflection scripts)

Next:
  1. Restart Cursor IDE so global hooks reload
  2. cursorsi          # start TUI
  3. /auth             # store OpenRouter / Cursor / compatible keys
  4. /backend          # pick which backend to use
${doProject ? "" : "\nOptional: cursorsi setup --project   # AGENTS.md + local harness in a repo\n"}`);
  return 0;
}

function readPackageVersion(): string {
  try {
    const pkgPath = join(__dirname, "../../package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
      version?: string;
    };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}
