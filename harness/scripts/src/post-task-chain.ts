#!/usr/bin/env node
import fs from "node:fs";
import { CursorAgentError } from "./lib/sdk-types.js";
import { loadHarnessAgents } from "./lib/agent-definitions.js";
import { logSyncResult, syncObsidianEntries, vaultLinkPath } from "./lib/obsidian.js";
import {
  createHarnessOrchestrator,
  dispatchToSubagent,
  runResultPayload,
} from "./lib/harness-orchestrator.js";
import { DEFAULT_MODEL_ID } from "./lib/model-selection.js";
import {
  appendMemoryOutcome,
  appendReasoningPattern,
  appendRolloutEntry,
  evaluateGate,
  newRolloutId,
  runRolloutGateScript,
  writeGradeReport,
  writeReflectionReport,
  type ChainReflection,
  type GateResult,
} from "./lib/ledger.js";
import {
  buildGradingSubagentInput,
  buildReflectionSubagentInput,
  buildRolloutSubagentInput,
  fallbackReflection,
  parseGradeJson,
  parseReflectionJson,
  parseRolloutJson,
} from "./lib/prompts.js";
import {
  formatOptimizerStats,
  optimizeContextBlock,
} from "./lib/context-optimizer.js";
import {
  appendText,
  isoTimestamp,
  loadObsidianConfig,
  readText,
  resolvePaths,
  generationAlreadyLogged,
} from "./lib/paths.js";
import { compressAcceptedLesson } from "./lib/compress-lesson.js";
import {
  captureDeveloperCorrection,
  buildCorrectionAnalysisPrompt,
  parseCorrectionAnalysis,
  synthesizeHeuristicRuleCard,
  runRejectionRecoveryPipeline,
  commitHeuristicRuleToVault,
} from "./lib/git-rejection-recovery.js";
import type { SyncEntry } from "./lib/obsidian.js";

interface CliArgs {
  projectRoot: string;
  sessionId: string;
  generationId: string;
  outputTokens: number;
  transcriptPath: string;
  cursorKey: string;
  openRouterKey: string;
  obsidianToken: string;
  obsidianApiUrl: string;
  dryRun: boolean;
}

function parseArgs(argv: string[]): CliArgs {
const args: CliArgs = {
    projectRoot: process.cwd(),
    sessionId: "unknown",
    generationId: "unknown",
    outputTokens: 0,
    transcriptPath: "",
    cursorKey: "",
    openRouterKey: "",
    obsidianToken: "",
    obsidianApiUrl: "http://127.0.0.1:27123",
    dryRun: false,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const flag = argv[i];
    const next = argv[i + 1];
    switch (flag) {
      case "--project-root":
        args.projectRoot = next ?? args.projectRoot;
        i += 1;
        break;
      case "--session-id":
        args.sessionId = next ?? args.sessionId;
        i += 1;
        break;
      case "--generation-id":
        args.generationId = next ?? args.generationId;
        i += 1;
        break;
      case "--output-tokens":
        args.outputTokens = Number(next ?? 0);
        i += 1;
        break;
      case "--transcript-path":
        args.transcriptPath = next ?? "";
        i += 1;
        break;
case "--cursor-key":
        args.cursorKey = next ?? "";
        i += 1;
        break;
      case "--openrouter-key":
        args.openRouterKey = next ?? "";
        i += 1;
        break;
      case "--obsidian-token":
        args.obsidianToken = next ?? "";
        i += 1;
        break;
      case "--obsidian-api-url":
        args.obsidianApiUrl = next ?? args.obsidianApiUrl;
        i += 1;
        break;
      case "--dry-run":
        args.dryRun = true;
        break;
      default:
        break;
    }
  }

const procEnv = process["env"] as Record<string, string | undefined>;
  if (!args.cursorKey) {
    args.cursorKey = procEnv["CURSOR_API_KEY"] ?? "";
  }
  if (!args.openRouterKey) {
    args.openRouterKey = procEnv["OPENROUTER_API_KEY"] ?? "";
  }
  if (!args.obsidianToken) {
    args.obsidianToken = procEnv["OBSIDIAN_API_KEY"] ?? "";
  }

  return args;
}

function logLine(logPath: string, message: string): void {
  appendText(logPath, `[${isoTimestamp()}] ${message}\n`);
}

const TRANSCRIPT_TAIL_LINES = 200;

function readTranscriptTail(transcriptPath: string): string {
  const raw = fs.readFileSync(transcriptPath, "utf8");
  const lines = raw.split(/\r?\n/);
  return lines.slice(-TRANSCRIPT_TAIL_LINES).join("\n");
}

async function sessionContext(
  args: CliArgs,
  paths: ReturnType<typeof resolvePaths>,
  logPath: string,
) {
  const [goals, accepted, reasoningPatterns, transcriptRaw] = await Promise.all([
    optimizeContextBlock(readText(paths.goals), "reflection_goals", paths.config),
    optimizeContextBlock(
      readText(paths.acceptedLessons),
      "reflection_lessons",
      paths.config,
    ),
    optimizeContextBlock(
      readText(paths.reasoningPatterns),
      "reflection_lessons",
      paths.config,
    ),
    args.transcriptPath && fs.existsSync(args.transcriptPath)
      ? optimizeContextBlock(
          readTranscriptTail(args.transcriptPath),
          "reflection_transcript",
          paths.config,
        )
      : Promise.resolve({
          text: "",
          charsBefore: 0,
          charsAfter: 0,
          tokensBefore: 0,
          tokensAfter: 0,
          ghostsRemoved: 0,
          headroomBackend: "skipped",
          headroomTransform: "none",
          truncated: false,
        }),
  ]);

  logLine(logPath, formatOptimizerStats("token-opt goals", goals));
  logLine(logPath, formatOptimizerStats("token-opt lessons", accepted));
  logLine(logPath, formatOptimizerStats("token-opt patterns", reasoningPatterns));
  if (transcriptRaw.charsBefore > 0) {
    logLine(logPath, formatOptimizerStats("token-opt transcript", transcriptRaw));
  }

  return buildReflectionSubagentInput({
    sessionId: args.sessionId,
    outputTokens: args.outputTokens,
    goalsText: goals.text,
    acceptedLessonsExcerpt: accepted.text,
    reasoningPatternsExcerpt: reasoningPatterns.text,
    transcriptExcerpt: transcriptRaw.text,
  });
}

async function runPostTaskSubagentChain(args: CliArgs, paths: ReturnType<typeof resolvePaths>) {
if (!args.openRouterKey) {
    return {
      reflection: fallbackReflection(args.sessionId, args.outputTokens, "OpenRouter credential not provided — set OPENROUTER_API_KEY or pass --openrouter-key"),
      grade: null,
      rolloutAgent: null,
      runIds: [] as string[],
      heuristicEntry: null,
    };
  }

  if (args.dryRun) {
    return {
      reflection: fallbackReflection(args.sessionId, args.outputTokens, "dry-run mode"),
      grade: null,
      rolloutAgent: null,
      runIds: ["dry-run"],
      heuristicEntry: null,
    };
  }

  let agents: Record<string, import("./lib/sdk-types.js").AgentDefinition>;
  try {
    agents = loadHarnessAgents(paths.root);
    if (!agents["harness-reflection-agent"]) {
      throw new Error("harness-reflection-agent missing");
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      reflection: fallbackReflection(args.sessionId, args.outputTokens, `agent definitions: ${message}`),
      grade: null,
      rolloutAgent: null,
      runIds: [],
      heuristicEntry: null,
    };
  }

  const runIds: string[] = [];

  try {
await using orchestrator = await createHarnessOrchestrator({
      apiKey: args.openRouterKey,
      projectRoot: paths.root,
      tokenOptimizerConfigDir: paths.config,
      agents,
      orchestratorModel: DEFAULT_MODEL_ID,
      subagentModel: DEFAULT_MODEL_ID,
      name: "harness-post-task-orchestrator",
    });

    const reflectionRun = await dispatchToSubagent(
      orchestrator,
      "harness-reflection-agent",
      await sessionContext(args, paths, paths.chainLog),
    );
    runIds.push(reflectionRun.id);

    if (reflectionRun.status === "error") {
      const reflectionError = runResultPayload(reflectionRun);
      logLine(paths.chainLog, `reflection subagent error ${reflectionRun.id}: ${reflectionError}`);
      return {
        reflection: fallbackReflection(
          args.sessionId,
          args.outputTokens,
          `reflection subagent error ${reflectionRun.id}: ${reflectionError}`,
        ),
        grade: null,
        rolloutAgent: null,
        runIds,
        heuristicEntry: null,
      };
    }

    const reflectionRaw = runResultPayload(reflectionRun);
    let reflection: ChainReflection;
    try {
      ({ reflection } = parseReflectionJson(reflectionRaw));
    } catch (parseErr) {
      const message = parseErr instanceof Error ? parseErr.message : String(parseErr);
      logLine(paths.chainLog, `reflection parse failed: ${message}`);
      logLine(paths.chainLog, `reflection raw output:\n${reflectionRaw}`);
      reflection = fallbackReflection(
        args.sessionId,
        args.outputTokens,
        `reflection parse failed: ${message}`,
      );
    }

    // -- Git-driven rejection recovery --
    let heuristicEntry: import("./lib/obsidian.js").SyncEntry | null = null;
    try {
      const correction = captureDeveloperCorrection(paths.root);
      if (correction) {
        logLine(paths.chainLog, `git-rejection-recovery: diff detected (${correction.filesChanged.length} files: ${correction.filesChanged.join(", ")})`);
        const correctionPrompt = buildCorrectionAnalysisPrompt(correction, reflection, args.sessionId);
        const correctionRun = await dispatchToSubagent(
          orchestrator,
          "harness-reflection-agent",
          correctionPrompt,
          "git-rejection-recovery",
        );
        runIds.push(correctionRun.id);
        if (correctionRun.status !== "error") {
          const correctionRaw = runResultPayload(correctionRun);
          try {
            const analysis = parseCorrectionAnalysis(correctionRaw);
            logLine(paths.chainLog, `git-rejection-recovery: analysis parsed (failureMode=${analysis.failureMode} severity=${analysis.severity})`);
            heuristicEntry = synthesizeHeuristicRuleCard(
              analysis,
              correction,
              args.sessionId,
              reflection.proposal?.proposalId,
            );
            logLine(paths.chainLog, `git-rejection-recovery: rule card synthesized (id=${heuristicEntry.id})`);
          } catch (parseErr) {
            const message = parseErr instanceof Error ? parseErr.message : String(parseErr);
            logLine(paths.chainLog, `git-rejection-recovery: analysis parse failed - ${message}`);
          }
        } else {
          logLine(paths.chainLog, `git-rejection-recovery: correction subagent error (${correctionRun.id})`);
        }
      } else {
        logLine(paths.chainLog, "git-rejection-recovery: no diff - skipping");
      }
    } catch (recoveryErr) {
      const message = recoveryErr instanceof Error ? recoveryErr.message : String(recoveryErr);
      logLine(paths.chainLog, `git-rejection-recovery: skipped - ${message}`);
    }
    // -- End rejection recovery --

    let grade = null;
    try {
      const gradingRun = await dispatchToSubagent(
        orchestrator,
        "harness-grading-agent",
        buildGradingSubagentInput(reflection),
      );
      runIds.push(gradingRun.id);

      if (gradingRun.status === "error") {
        logLine(paths.chainLog, `grading subagent error ${gradingRun.id}: ${runResultPayload(gradingRun)}`);
      } else {
        const gradeRaw = runResultPayload(gradingRun);
        try {
          ({ grade } = parseGradeJson(gradeRaw));
        } catch (gradeParseErr) {
          const message = gradeParseErr instanceof Error ? gradeParseErr.message : String(gradeParseErr);
          logLine(paths.chainLog, `grade parse failed: ${message}`);
          logLine(paths.chainLog, `grade raw output:\n${gradeRaw}`);
          grade = null;
        }
      }
    } catch (gradeErr) {
      const message = gradeErr instanceof Error ? gradeErr.message : String(gradeErr);
      logLine(paths.chainLog, `grading step failed: ${message}`);
    }

    const targetLayer = reflection.proposal?.targetLayer ?? null;
    const gate = targetLayer ? runRolloutGateScript(paths, targetLayer) : evaluateGate(paths, null);

    let rolloutAgent = null;
    if (agents["harness-rollout-agent"]) {
      const rolloutRun = await dispatchToSubagent(
        orchestrator,
        "harness-rollout-agent",
        buildRolloutSubagentInput({
          reflection,
          grade,
          gate,
          sessionId: args.sessionId,
        }),
      );
      runIds.push(rolloutRun.id);
      if (rolloutRun.status !== "error") {
        try {
          ({ rollout: rolloutAgent } = parseRolloutJson(runResultPayload(rolloutRun)));
        } catch {
          rolloutAgent = null;
        }
      }
    }

    return { reflection, grade, rolloutAgent, runIds, heuristicEntry };
  } catch (err) {
    const message = err instanceof CursorAgentError ? err.message : String(err);
    return {
      reflection: fallbackReflection(args.sessionId, args.outputTokens, `orchestrator failed: ${message}`),
      grade: null,
      rolloutAgent: null,
      runIds,
      heuristicEntry: null,
    };
  }
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv);
  const paths = resolvePaths(args.projectRoot);
  if (generationAlreadyLogged(paths.chainLog, args.generationId)) {
    logLine(paths.chainLog, `skip duplicate generation=${args.generationId}`);
    return 0;
  }

logLine(
    paths.chainLog,
    `start generation=${args.generationId} tokens=${args.outputTokens} cursor=${args.cursorKey ? "set" : "missing"} openrouter=${args.openRouterKey ? "set" : "missing"} obsidian=${args.obsidianToken ? "set" : "missing"}`,
  );

  const { reflection, grade, rolloutAgent, runIds, heuristicEntry } = await runPostTaskSubagentChain(args, paths);
  const targetLayer = reflection.proposal?.targetLayer ?? null;
  const gateResult: GateResult = targetLayer
    ? runRolloutGateScript(paths, targetLayer)
    : evaluateGate(paths, null);

  const runId = runIds.length ? runIds.join(",") : undefined;

  writeReflectionReport(paths, reflection, args.sessionId, args.outputTokens);
  writeGradeReport(paths, grade, args.sessionId);

  if (appendReasoningPattern(paths, args.sessionId, reflection)) {
    logLine(paths.chainLog, `reasoning pattern appended session=${args.sessionId}`);
  }

  if (grade && reflection.proposal) {
    appendMemoryOutcome(paths, grade, reflection.proposal);
  }

  const rolloutId = newRolloutId();
  const obsidianConfig = loadObsidianConfig(paths.obsidianYaml);
  const rolloutLink = vaultLinkPath(obsidianConfig.folders.rolloutLog, rolloutId);
  const syncEntries: Array<{
    kind: string;
    id: string;
    body: string;
    links?: string[];
  }> = [
    {
      kind: "rollout",
      id: rolloutId,
      body: rolloutAgent?.changeSummary ?? `Rollout entry for session ${args.sessionId}`,
      links:
        grade && reflection.proposal
          ? [
              grade.decision === "reject"
                ? vaultLinkPath(obsidianConfig.folders.rejectedLessons, grade.proposalId)
                : vaultLinkPath(obsidianConfig.folders.acceptedLessons, grade.proposalId),
            ]
          : undefined,
    },
    {
      kind: "reasoning",
      id: args.sessionId,
      body: reflection.reasoningTrace || reflection.markdown || reflection.outcome,
      links: [rolloutLink],
    },
  ];

  if (grade && reflection.proposal) {
    if (grade.decision === "reject") {
      syncEntries.push({
        kind: "rejected",
        id: grade.proposalId,
        body: grade.reason,
        links: [rolloutLink],
      });
    } else if (grade.decision === "accept" || grade.decision === "accept with human review") {
      syncEntries.push({
        kind: "accepted",
        id: grade.proposalId,
        body: reflection.proposal.summary,
        links: [rolloutLink],
      });

      // Auto-compress the newly accepted lesson into lesson-index.json
      try {
        const date = new Date().toISOString().slice(0, 10);
        const lessonBody = [
          `- Source task: post-task SDK chain`,
          `- Reason: ${grade.reason}`,
          `- Target layer: ${reflection.proposal.targetLayer}`,
          `- Date: ${date}`,
          `- Rollback note: ${grade.rollbackNote}`,
          `- Applied change:`,
          ``,
          reflection.proposal.summary,
        ].join("\n");
        const compressResult = await compressAcceptedLesson(
          paths.memoryRoot,
          args.cursorKey,
          grade.proposalId,
          lessonBody,
        );
        if (compressResult.ok) {
          logLine(paths.chainLog, `compress-lesson: ${compressResult.message}`);
        } else {
          logLine(paths.chainLog, `compress-lesson failed: ${compressResult.message}`);
        }
      } catch (compressErr) {
        logLine(
          paths.chainLog,
          `compress-lesson error: ${compressErr instanceof Error ? compressErr.message : String(compressErr)}`,
        );
      }
    }
  }

  // -- Inject heuristic rule card if git rejection recovery produced one --
  if (heuristicEntry) {
    syncEntries.push({
      kind: "heuristic",
      id: heuristicEntry.id,
      body: heuristicEntry.body,
      links: heuristicEntry.links,
    });

    // Also write directly to vault via commitHeuristicRuleToVault for guaranteed delivery
    try {
      const heuristicResult = await commitHeuristicRuleToVault(
        heuristicEntry,
        obsidianConfig,
        { token: args.obsidianToken, apiUrl: args.obsidianApiUrl },
      );
      logSyncResult(paths.chainLog, heuristicResult);
    } catch (heuristicErr) {
      logLine(paths.chainLog, `git-rejection-recovery: direct vault write failed - ${heuristicErr instanceof Error ? heuristicErr.message : String(heuristicErr)}`);
    }
  }
  // -- End heuristic injection --

  const sync = await syncObsidianEntries(obsidianConfig, syncEntries, {
    token: args.obsidianToken,
    apiUrl: args.obsidianApiUrl,
  });
  logSyncResult(paths.chainLog, sync);

  const obsidianSummary = sync.synced.length
    ? `synced ${sync.synced.length} note(s)`
    : sync.skipped.join("; ") || sync.errors.join("; ") || "none";

  appendRolloutEntry(paths, {
    rolloutId,
    sessionId: args.sessionId,
    outputTokens: args.outputTokens,
    reflection,
    grade,
    gate: gateResult,
    agentRunId: runId,
    obsidianSync: obsidianSummary,
    rolloutAgent,
  });

  logLine(
    paths.chainLog,
    `done rollout=${rolloutId} gate=${gateResult.action} obsidian=${obsidianSummary} agents=${runIds.length}`,
  );

  try {
    const { runRalphPostTask } = await import("./lib/ralph-agent-loop.js");
    await runRalphPostTask(paths, {
      agentAuth: args.cursorKey,
      obsidianToken: args.obsidianToken,
      obsidianApiUrl: args.obsidianApiUrl,
    });
  } catch (err) {
    logLine(paths.chainLog, `ralph hook skipped: ${err instanceof Error ? err.message : String(err)}`);
  }

  return 0;
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`post-task-chain: fatal: ${message}\n`);
  process.exit(1);
});
