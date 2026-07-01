import { CursorAgentError } from "./sdk-types.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadHarnessAgents, pickAgents } from "./agent-definitions.js";
import { createHarnessOrchestrator, dispatchToSubagent } from "./harness-orchestrator.js";
import type { HarnessPaths } from "./paths.js";
import { loadObsidianConfig, readText, resolvePaths } from "./paths.js";
import { logSyncResult, syncObsidianEntries } from "./obsidian.js";
import {
  appendAcceptedLesson,
  appendIterationLog,
  DEFAULT_MAX,
  isPlaceholderVerify,
  loadState,
  MAX_CAP,
  readField,
  runVerify,
  saveState,
  setField,
  validateVerifyCommand,
  validateVerifyCommandShape,
} from "./ralph-state.js";

export interface RalphRunOptions {
  agentAuth: string;
  obsidianToken: string;
  obsidianApiUrl: string;
}

export async function runRalphPostTask(paths: HarnessPaths, opts: RalphRunOptions): Promise<number> {
  let text = readText(paths.ralphGoal);
  if (!text) return 0;

  const state = loadState(paths.ralphGoal);
  if (state.status !== "active") return 0;

  const verify = state.verifyCommand;
  const max = Math.min(state.maxIterations || 10, MAX_CAP);
  let iteration = state.currentIteration || 0;

  while (iteration < max) {
    const { exitCode, output } = runVerify(paths.root, verify);
    text = setField(text, "last_verify_exit", String(exitCode));

    if (exitCode === 0) {
      text = setField(text, "status", "complete");
      text = setField(text, "completed_at", new Date().toISOString().slice(0, 10));
      saveState(paths.ralphGoal, text);
      const entryId = appendAcceptedLesson(paths, state.goal, verify, iteration);

      const obsidian = loadObsidianConfig(paths.obsidianYaml);
      const sync = await syncObsidianEntries(
        obsidian,
        [{ kind: "accepted", id: entryId, body: `Ralph goal verified: ${state.goal}` }],
        { token: opts.obsidianToken, apiUrl: opts.obsidianApiUrl },
      );
      logSyncResult(paths.chainLog, sync);
      process.stdout.write("HARNESS_RALPH_COMPLETE\n");
      process.stdout.write(`ralph-goal: complete entry=${entryId}\n`);
      return 0;
    }

    iteration += 1;
    text = setField(text, "current_iteration", String(iteration));
    text = setField(text, "last_failure_excerpt", output.slice(0, 400));
    appendIterationLog(paths.ralphGoal, iteration, exitCode, output);
    saveState(paths.ralphGoal, text);

    if (iteration >= max) {
      text = setField(text, "status", "failed");
      text = setField(text, "completed_at", new Date().toISOString().slice(0, 10));
      saveState(paths.ralphGoal, text);
      process.stdout.write("HARNESS_RALPH_FAILED\n");
      process.stdout.write(`ralph-goal: failed max=${max} exit=${exitCode}\n`);
      return 2;
    }

    process.stdout.write("HARNESS_RALPH_CONTINUE\n");
    if (output.trim()) {
      process.stdout.write(`${output.slice(0, 400)}\n`);
    }

    if (!opts.agentAuth) {
      return 0;
    }

    try {
      await runFixIteration({
        root: paths.root,
        agentAuth: opts.agentAuth,
        goal: state.goal,
        verify,
        failureOutput: output,
        iteration,
        max,
      });
    } catch (err) {
      const message = err instanceof CursorAgentError ? err.message : String(err);
      process.stderr.write(`ralph-goal: sdk iteration failed: ${message}\n`);
      return 1;
    }
  }

  return 0;
}

async function runFixIteration(args: {
  root: string;
  agentAuth: string;
  goal: string;
  verify: string;
  failureOutput: string;
  iteration: number;
  max: number;
}): Promise<void> {
  const allAgents = loadHarnessAgents(args.root);
  const ralphAgents = pickAgents(allAgents, ["harness-ralph-agent"]);

  await using orchestrator = await createHarnessOrchestrator({
    apiKey: args.agentAuth,
    projectRoot: args.root,
    agents: ralphAgents,
    orchestratorModel: "composer-2.5",
    subagentModel: "composer-2.5",
    name: "harness-ralph-orchestrator",
  });

  const taskPrompt = [
    `Goal: ${args.goal}`,
    `Verify command (must exit 0): ${args.verify}`,
    `Iteration: ${args.iteration}/${args.max}`,
    "The verify command failed. Inspect the repo, make the smallest correct fix toward the goal, and stop.",
    "Failure output:",
    args.failureOutput,
  ].join("\n");

  const run = await dispatchToSubagent(orchestrator, "harness-ralph-agent", taskPrompt);
  if (run.status === "error") {
    throw new Error(`harness-ralph-agent run error: ${run.id}`);
  }
}

export function parseRalphCli(argv: string[]): RalphRunOptions {
  const opts: RalphRunOptions = {
    agentAuth: "",
    obsidianToken: "",
    obsidianApiUrl: "http://127.0.0.1:27123",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const next = argv[i + 1];
    if (flag === "--agent-auth") {
      opts.agentAuth = next ?? "";
      i += 1;
    } else if (flag === "--obsidian-token") {
      opts.obsidianToken = next ?? "";
      i += 1;
    } else if (flag === "--obsidian-api-url") {
      opts.obsidianApiUrl = next ?? opts.obsidianApiUrl;
      i += 1;
    }
  }

  return opts;
}

export function cmdSet(paths: HarnessPaths, goal: string, verify: string, max: number): number {
  if (!goal || goal.length < 12) {
    process.stderr.write("ralph-goal: goal too short\n");
    return 1;
  }
  if (!verify || isPlaceholderVerify(verify)) {
    process.stderr.write("ralph-goal: verify command must be runnable\n");
    return 1;
  }

  const shapeError = validateVerifyCommandShape(verify);
  if (shapeError) {
    process.stderr.write(`ralph-goal: ${shapeError}\n`);
    return 1;
  }

  const missing = validateVerifyCommand(paths.root, verify);
  if (missing === 127) {
    process.stderr.write("ralph-goal: verify command not found\n");
    return 1;
  }

  if (max > MAX_CAP) {
    process.stderr.write(`ralph-goal: max iterations cannot exceed ${MAX_CAP}\n`);
    return 1;
  }

  const capped = Math.min(Math.max(max || DEFAULT_MAX, 1), MAX_CAP);
  let text = readText(paths.ralphGoal);
  if (!text) text = "# Ralph Goal\n\nstatus: idle\n";

  if (readField(text, "status") === "active") {
    process.stderr.write("ralph-goal: loop already active\n");
    return 1;
  }

  text = setField(text, "goal", goal);
  text = setField(text, "verify_command", verify);
  text = setField(text, "max_iterations", String(capped));
  text = setField(text, "current_iteration", "0");
  text = setField(text, "status", "active");
  text = setField(text, "started_at", new Date().toISOString().slice(0, 10));
  text = setField(text, "completed_at", "");
  text = setField(text, "last_verify_exit", "");
  text = setField(text, "last_failure_excerpt", "");
  saveState(paths.ralphGoal, text);
  process.stdout.write(`ralph-goal: set active max=${capped}\n`);
  return 0;
}

export function cmdStatus(paths: HarnessPaths): number {
  const state = loadState(paths.ralphGoal);
  process.stdout.write(
    [
      "Ralph loop status",
      `  goal: ${state.goal}`,
      `  verify_command: ${state.verifyCommand}`,
      `  max_iterations: ${state.maxIterations}`,
      `  current_iteration: ${state.currentIteration}`,
      `  status: ${state.status}`,
      `  started_at: ${state.startedAt}`,
      `  completed_at: ${state.completedAt}`,
    ].join("\n") + "\n",
  );
  return 0;
}

export function cmdPauseResume(paths: HarnessPaths, mode: "paused" | "active"): number {
  let text = readText(paths.ralphGoal);
  const status = readField(text, "status");
  if (mode === "paused" && status !== "active") return 1;
  if (mode === "active" && status !== "paused") return 1;
  text = setField(text, "status", mode);
  saveState(paths.ralphGoal, text);
  process.stdout.write(`ralph-goal: ${mode === "paused" ? "paused" : "resumed"}\n`);
  return 0;
}

export function cmdCancel(paths: HarnessPaths): number {
  let text = readText(paths.ralphGoal) || "# Ralph Goal\n";
  for (const [k, v] of [
    ["status", "idle"],
    ["goal", ""],
    ["verify_command", ""],
    ["max_iterations", "10"],
    ["current_iteration", "0"],
    ["started_at", ""],
    ["completed_at", ""],
    ["last_verify_exit", ""],
    ["last_failure_excerpt", ""],
  ] as const) {
    text = setField(text, k, v);
  }
  saveState(paths.ralphGoal, text);
  process.stdout.write("ralph-goal: cancelled\n");
  return 0;
}

async function cliMain(): Promise<number> {
  const sub = process.argv[2] ?? "";
  const paths = resolvePaths(process.cwd());
  const opts = parseRalphCli(process.argv.slice(3));

  switch (sub) {
    case "set": {
      let goal = "";
      let verify = "";
      let max = 10;
      for (let i = 3; i < process.argv.length; i += 1) {
        if (process.argv[i] === "--goal") goal = process.argv[++i] ?? "";
        else if (process.argv[i] === "--verify") verify = process.argv[++i] ?? "";
        else if (process.argv[i] === "--max") max = Number(process.argv[++i] ?? 10);
      }
      return cmdSet(paths, goal, verify, max);
    }
    case "status":
      return cmdStatus(paths);
    case "pause":
      return cmdPauseResume(paths, "paused");
    case "resume":
      return cmdPauseResume(paths, "active");
    case "cancel":
      return cmdCancel(paths);
    case "post-task":
      return runRalphPostTask(paths, opts);
    default:
      process.stderr.write("usage: ralph-goal.js set|status|pause|resume|cancel|post-task\n");
      return 1;
  }
}

const isDirectRun =
  typeof process.argv[1] === "string" &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  cliMain()
    .then((code) => process.exit(code))
    .catch((err) => {
      process.stderr.write(`ralph-goal: fatal: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    });
}
