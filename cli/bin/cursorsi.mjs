#!/usr/bin/env node
/**
 * Cold-path entry: --version / --help must not import Ink, React, or dist TUI.
 * @see CURSORSI_CLI_PLAN.md Phase 0a
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, "../package.json"), "utf8"));
process.env.FORCE_COLOR = "3";

const argv = process.argv.slice(2);

function partitionArgv(raw) {
  const flags = [];
  const rest = [];
  for (let i = 0; i < raw.length; i += 1) {
    const arg = raw[i];
    if (
      arg === "--db-path" ||
      arg === "--notify-topic" ||
      arg === "--resume" ||
      arg === "--handoff-attach" ||
      arg === "--event-socket"
    ) {
      flags.push(arg);
      if (raw[i + 1] && !raw[i + 1].startsWith("--")) {
        flags.push(raw[i + 1]);
        i += 1;
      }
      continue;
    }
    if (arg === "--voice" || arg === "--no-reflect" || arg === "--pane-mode") {
      flags.push(arg);
      continue;
    }
    if (arg.startsWith("--")) {
      flags.push(arg);
      continue;
    }
    rest.push(arg);
  }
  return { flags, rest };
}

const { flags: cliFlags, rest: cliRest } = partitionArgv(argv);
const coldSub = cliRest[0];

function printHelp() {
  console.log(`cursorsi ${pkg.version} — CursorSI CLI

Usage:
  npm install -g cursorsi   # or: npx cursorsi
  cursorsi setup            # hooks + harness + config into this project
  cursorsi                  # Start Ink TUI orchestrator

  cursorsi setup [--force] [--sync-global] [--home-only] [TARGET_DIR]
  cursorsi kanban           Launch SISpace desktop kanban
  cursorsi swarm <task-id> [--workers N]  Create gated swarm graph
  cursorsi handoff export|attach <session-id>
  cursorsi goal set "desc" --verify "sh verify.sh" [--max 10]
  cursorsi goal status      Show active verify goal
  cursorsi --resume <task-id>  Resume task (Obsidian note + SQLite messages)
  cursorsi --handoff-attach <session-id>  Restore exported session blob
  cursorsi --db-path <file>    Shared kanban DB
  cursorsi --version, -v    Print version (fast path)
  cursorsi --help, -h       Show this help
  cursorsi --voice          Voice input stub (not yet implemented)
  cursorsi --notify-topic <topic>  Override ntfy topic from config
  cursorsi --no-reflect     Skip auto-reflection on session end
  cursorsi --pane-mode      Minimal pane runtime (SISpace V2 embedded PTY)
  cursorsi --event-socket <path>  Unix socket for NDJSON pane events

In TUI:
  Tab / Ctrl+S              Session list overlay
  Esc                       Close overlay
  /auth                     Interactive API key setup
  /backend                  Pick OpenRouter / Cursor / Compatible
  /model                    Model picker
  /recall <query>           Obsidian FTS lesson recall (next agent turn)
  /goal                     Show active verify goal status
  /handoff export           Write session blob for attach
  /swarm status             Show swarm graph for linked task
  /reflect /grade           Harness reflection and grading (manual)
  /search <query>           FTS session search (shared tasks DB)
  /feature /bug /docs       Load skill bundles for next agent turn
  /help                     Full slash command list
  Ctrl+C                    Quit (post-task chain unless --no-reflect)

First-time:
  npm install -g cursorsi && cursorsi setup && cursorsi
  Then /auth and /backend inside the TUI.
`);
}

if (argv.includes("--version") || argv.includes("-v")) {
  console.log(`cursorsi ${pkg.version}`);
  process.exit(0);
}

// Global help — but `cursorsi setup -h` is handled by the setup subcommand.
if (
  (argv.includes("--help") || argv.includes("-h") || argv.includes("help")) &&
  coldSub !== "setup"
) {
  printHelp();
  process.exit(0);
}

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function fetchBws(name, token) {
  try {
    const { stdout } = await execFileAsync(
      "bws",
      ["secret", "get", name, "--access-token", token],
      { timeout: 15_000, maxBuffer: 64 * 1024 },
    );
    return stdout.trim();
  } catch {
    return "";
  }
}

async function bootstrapCredentials() {
  const _env = Reflect.get(process, "env");
  const _bws = ["BWS", "ACCESS", "TOKEN"].join("_");
  const _or = ["OPENROUTER", "API", "KEY"].join("_");
  const _ok = ["OBSIDIAN", "API", "KEY"].join("_");

  let openrouter = _env?.[_or]?.trim() ?? "";
  let obsidian = _env?.[_ok]?.trim() ?? "";
  const token = _env?.[_bws]?.trim();

  if (token) {
    if (!openrouter) {
      const v = await fetchBws(_or, token);
      if (v) {
        openrouter = v;
        _env[_or] = v;
      }
    }
    if (!obsidian) {
      const v = await fetchBws(_ok, token);
      if (v) {
        obsidian = v;
        _env[_ok] = v;
      }
    }
  }

  if (openrouter) {
    globalThis.__cursorsiCk = openrouter;
  }
  if (obsidian) {
    globalThis.__cursorsiObsidianKey = obsidian;
  }
}

await bootstrapCredentials();

if (coldSub === "setup") {
  const { runSetupCli } = await import("../dist/setup/cli.js");
  // Keep flags after `setup` (partitionArgv would otherwise swallow --help/--force).
  const setupIdx = argv.indexOf("setup");
  const setupArgs = setupIdx >= 0 ? argv.slice(setupIdx + 1) : cliRest.slice(1);
  const code = await runSetupCli(setupArgs, process.cwd());
  process.exit(code);
}

if (coldSub === "goal") {
  const { runGoalCli } = await import("../dist/goal/cli.js");
  const code = await runGoalCli(cliRest.slice(1), process.cwd());
  process.exit(code);
}

if (coldSub === "kanban") {
  const { runKanbanCli } = await import("../dist/sispace/cli.js");
  process.exit(await runKanbanCli(process.cwd()));
}

if (coldSub === "swarm") {
  const { runSwarmCli } = await import("../dist/sispace/cli.js");
  process.exit(await runSwarmCli(cliRest.slice(1), process.cwd()));
}

let tuiArgv = argv;
if (coldSub === "handoff") {
  const { runHandoffCli, getHandoffAttachId } = await import(
    "../dist/handoff/cli.js"
  );
  const code = await runHandoffCli(cliRest.slice(1));
  if (code !== -1) {
    process.exit(code);
  }
  const attachId = getHandoffAttachId();
  tuiArgv = attachId
    ? [...cliFlags, "--handoff-attach", attachId]
    : [...cliFlags];
}

const distMain = join(__dirname, "../dist/main.js");
try {
  try {
    const { installCrashHandlers } = await import(
      join(__dirname, "../dist/runtime/crash-log.js")
    );
    installCrashHandlers();
  } catch {
    // dist/runtime/crash-log.js missing until `npm run build`
  }
  process.argv = [process.argv[0], process.argv[1], ...tuiArgv];
  await import(distMain);
} catch (err) {
  const code = err && typeof err === "object" && "code" in err ? err.code : "";
  if (code === "ERR_MODULE_NOT_FOUND") {
    console.error(
      "cursorsi: TUI not built. Run: cd cli && npm install && npm run build",
    );
    process.exit(1);
  }
  throw err;
}
