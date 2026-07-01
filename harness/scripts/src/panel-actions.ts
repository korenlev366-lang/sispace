#!/usr/bin/env node
import { join } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { loadHarnessAgents } from "./lib/agent-definitions.js";
import {
  createHarnessOrchestrator,
  dispatchToSubagent,
  resetOrchestratorCache,
  runResultPayload,
} from "./lib/harness-orchestrator.js";
import {
  appendRolloutEntry,
  evaluatePanelApplyGate,
  newRolloutId,
  writeGradeReport,
  type ChainGrade,
  type ChainReflection,
  type GateResult,
} from "./lib/ledger.js";
import {
  buildGradingSubagentInput,
  buildPanelApplySubagentInput,
  fallbackReflection,
  parseGradeJson,
  parsePanelApplyJson,
} from "./lib/prompts.js";
import {
  acceptProposal,
  findProposal,
  gradeFromProposal,
  listPendingForBulkApply,
  markProposalApplied,
  needsPanelReapply,
  reflectionFromProposal,
  rejectProposal,
  rewritePendingProposal,
  upsertProposalFields,
  type ProposalEntry,
} from "./lib/proposal-ledger.js";
import { isoTimestamp, readText, resolvePaths, writeText } from "./lib/paths.js";

interface CliArgs {
  action: string;
  projectRoot: string;
  proposalId: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    action: argv[2] ?? "",
    projectRoot: process.cwd(),
    proposalId: "",
  };
  for (let i = 3; i < argv.length; i += 1) {
    const flag = argv[i];
    const next = argv[i + 1];
    if (flag === "--project-root" && next) {
      args.projectRoot = next;
      i += 1;
    } else if (flag === "--proposal-id" && next) {
      args.proposalId = next;
      i += 1;
    }
  }
  return args;
}

function openrouterKey(): string {
  const env = process["env"] as Record<string, string | undefined>;
  return env["OPENROUTER_API_KEY"]?.trim() || env["CURSOR_API_KEY"]?.trim() || "";
}

/** Pause between SDK dispatches to avoid HTTP/2 ENHANCE_YOUR_CALM (too_many_pings). */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const APPLY_ALL_DISPATCH_GAP_MS = 2500;

function readReport(paths: ReturnType<typeof resolvePaths>, name: string): string {
  const p = join(paths.memoryRoot, "harness/reports", name);
  if (!existsSync(p)) return "";
  return readFileSync(p, "utf8");
}

function parseGradeMarkdown(md: string): {
  decision: string | null;
  proposalId: string | null;
  status: string | null;
} {
  if (md.includes("Status: no_proposal")) {
    return { decision: null, proposalId: null, status: "no_proposal" };
  }
  const decision = md.match(/^- Decision:\s*(.+)$/m)?.[1]?.trim() ?? null;
  const proposalId = md.match(/^- Proposal ID:\s*(.+)$/m)?.[1]?.trim() ?? null;
  return { decision, proposalId, status: decision ? "graded" : null };
}

function reflectionFromLatest(
  paths: ReturnType<typeof resolvePaths>,
  sessionId: string,
): ChainReflection {
  const reflectionMd = readReport(paths, "latest-reflection.md");
  const base = fallbackReflection(
    sessionId,
    1500,
    "harness panel action",
  ) as ChainReflection;
  return {
    ...base,
    outcome: reflectionMd.slice(0, 8000),
    markdown: reflectionMd,
    reasoningTrace: readText(paths.reasoningPatterns).slice(0, 2000),
  };
}

async function runGrade(projectRoot: string): Promise<string> {
  const token = openrouterKey();
  if (!token) {
    throw new Error("No OPENROUTER_API_KEY or CURSOR_API_KEY in environment.");
  }

  const paths = resolvePaths(projectRoot);
  const reflectionMd = readReport(paths, "latest-reflection.md");
  if (!reflectionMd.trim()) {
    throw new Error(
      "No latest-reflection.md. Run reflect first or complete a session with reflection.",
    );
  }
  const agents = loadHarnessAgents(projectRoot);
  if (!agents["harness-grading-agent"]) {
    throw new Error("harness-grading-agent definition missing");
  }

  const sessionId = `sispace-panel-grade-${Date.now()}`;
  const reflection = reflectionFromLatest(paths, sessionId);

  await using orchestrator = await createHarnessOrchestrator({
    apiKey: token,
    projectRoot,
    agents,
    name: "sispace-panel-grade",
  });

  const gradingRun = await dispatchToSubagent(
    orchestrator,
    "harness-grading-agent",
    buildGradingSubagentInput(reflection),
  );

  if (gradingRun.status === "error") {
    throw new Error(`Grading subagent error (run ${gradingRun.id})`);
  }

  const gradeRaw = runResultPayload(gradingRun);
  let grade: ChainGrade | null = null;
  try {
    ({ grade } = parseGradeJson(gradeRaw));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Grade parse failed: ${msg}`);
  }

  writeGradeReport(paths, grade, sessionId);

  if (!grade) {
    return "Grading complete: no proposal to grade (grade null).";
  }

  return `Grade written to harness/reports/latest-grade.md — decision: ${grade.decision}`;
}

async function applyOneProposal(
  paths: ReturnType<typeof resolvePaths>,
  entry: ProposalEntry,
  orchestrator: Awaited<ReturnType<typeof createHarnessOrchestrator>>,
  projectRoot: string,
): Promise<{
  rolloutId: string;
  gate: GateResult;
  proposalId: string;
  applyStatus: string;
}> {
  const reflection = reflectionFromProposal(entry);
  const grade = gradeFromProposal(entry);
  const targetLayer = reflection.proposal?.targetLayer ?? null;
  const gate = evaluatePanelApplyGate(targetLayer);

  const sessionId = `sispace-panel-apply-${entry.id}-${Date.now()}`;

  const applyRun = await dispatchToSubagent(
    orchestrator,
    "harness-workflow-agent",
    buildPanelApplySubagentInput({
      reflection,
      grade,
      sessionId,
      projectRoot,
    }),
  );

  if (applyRun.status === "error") {
    throw new Error(`Apply subagent error for ${entry.id} (run ${applyRun.id})`);
  }

  let applyResult = parsePanelApplyJson("{}");
  try {
    applyResult = parsePanelApplyJson(runResultPayload(applyRun));
  } catch {
    applyResult = {
      status: "failed",
      deliverableSummary: runResultPayload(applyRun).slice(0, 500),
      filesTouched: [],
      verificationEvidence: "panel apply parse failed",
    };
  }

  const rolloutId = newRolloutId();
  appendRolloutEntry(paths, {
    rolloutId,
    sessionId,
    outputTokens: 1500,
    reflection: {
      ...reflection,
      outcome: applyResult.deliverableSummary || reflection.outcome,
      filesChanged: applyResult.filesTouched,
      verificationEvidence: applyResult.verificationEvidence,
    },
    grade,
    gate,
    agentRunId: applyRun.id,
    obsidianSync: "panel apply-all",
    rolloutAgent: {
      changeSummary: applyResult.deliverableSummary || reflection.proposal?.summary || "",
      verificationEvidence: applyResult.verificationEvidence,
      notes: `Panel apply status: ${applyResult.status}`,
    },
  });

  return {
    rolloutId,
    gate,
    proposalId: entry.id,
    applyStatus: applyResult.status,
  };
}

async function runApply(projectRoot: string): Promise<string> {
  const token = openrouterKey();
  if (!token) {
    throw new Error("No OPENROUTER_API_KEY or CURSOR_API_KEY in environment.");
  }

  const paths = resolvePaths(projectRoot);
  const agents = loadHarnessAgents(projectRoot);
  if (!agents["harness-workflow-agent"]) {
    throw new Error("harness-workflow-agent definition missing");
  }

  const pending = listPendingForBulkApply(paths);
  if (pending.length === 0) {
    throw new Error("No pending proposals to apply.");
  }

  const results: string[] = [];
  let failed = 0;
  for (let i = 0; i < pending.length; i += 1) {
    let entry = pending[i]!;
    if (needsPanelReapply(entry.body)) {
      entry = {
        ...entry,
        body: upsertProposalFields(entry.body, { Status: "accepted (re-apply)" }),
      };
      rewritePendingProposal(paths, entry);
    }
    entry = acceptProposal(paths, entry.id);

    // Fresh orchestrator per proposal: reusing one HTTP/2 session across many
    // SDK dispatches triggers NGHTTP2_ENHANCE_YOUR_CALM from the Cursor API.
    resetOrchestratorCache();
    await using orchestrator = await createHarnessOrchestrator({
      apiKey: token,
      projectRoot,
      agents,
      name: `sispace-panel-apply-${entry.id}`,
    });

    const { rolloutId, gate, proposalId, applyStatus } = await applyOneProposal(
      paths,
      entry,
      orchestrator,
      projectRoot,
    );
    if (applyStatus === "failed") {
      failed += 1;
    }
    results.push(
      `${proposalId} → ${rolloutId} (gate: ${gate.action}, status: ${applyStatus})`,
    );

    if (applyStatus === "complete" || applyStatus === "partial") {
      const updated = findProposal(paths, proposalId);
      if (updated?.source === "pending") {
        updated.body = markProposalApplied(updated.body);
        rewritePendingProposal(paths, updated);
      }
    }

    if (i + 1 < pending.length) {
      await sleep(APPLY_ALL_DISPATCH_GAP_MS);
    }
  }

  const summary = `Apply-all complete (${results.length} proposals, ${failed} failed):\n${results.join("\n")}`;
  if (failed === results.length) {
    throw new Error(summary);
  }
  return summary;
}

async function runAccept(projectRoot: string, proposalId: string): Promise<string> {
  if (!proposalId) {
    throw new Error("accept requires --proposal-id <PROP-... or PENDING-...>");
  }
  const paths = resolvePaths(projectRoot);
  if (!findProposal(paths, proposalId)) {
    throw new Error(`Proposal not found: ${proposalId}`);
  }
  acceptProposal(paths, proposalId);
  return `Accepted ${proposalId} — recorded in pending-proposals and accepted-lessons.`;
}

async function runReject(projectRoot: string, proposalId: string): Promise<string> {
  if (!proposalId) {
    throw new Error("reject requires --proposal-id <PROP-... or PENDING-...>");
  }
  const paths = resolvePaths(projectRoot);
  if (!findProposal(paths, proposalId)) {
    throw new Error(`Proposal not found: ${proposalId}`);
  }
  rejectProposal(paths, proposalId);
  return `Rejected ${proposalId} — recorded in rejected-lessons.`;
}

async function runCurate(projectRoot: string): Promise<string> {
  const token = openrouterKey();
  if (!token) {
    throw new Error("No OPENROUTER_API_KEY or CURSOR_API_KEY in environment.");
  }

  const paths = resolvePaths(projectRoot);
  const agents = loadHarnessAgents(projectRoot);
  if (!agents["harness-workflow-agent"]) {
    throw new Error("harness-workflow-agent definition missing");
  }

  const accepted = readText(paths.acceptedLessons).slice(0, 4000);
  const rejected = readText(paths.rejectedLessons).slice(0, 2000);
  const pending = readText(paths.pendingProposals).slice(0, 2000);
  const userModel = readText(paths.userModel).slice(0, 2000);

  const prompt = [
    "Harness curate workflow (read-only emit).",
    "Inventory skills, accepted/rejected lessons, pending proposals, and user-model.",
    "Output a curation draft listing stale/overlapping skills with evidence and recommended actions.",
    "Do not edit skill files — write proposals only.",
    "",
    "Accepted lessons excerpt:",
    accepted || "(none)",
    "",
    "Rejected lessons excerpt:",
    rejected || "(none)",
    "",
    "Pending proposals excerpt:",
    pending || "(none)",
    "",
    "User model excerpt:",
    userModel || "(none)",
  ].join("\n");

  await using orchestrator = await createHarnessOrchestrator({
    apiKey: token,
    projectRoot,
    agents,
    name: "sispace-panel-curate",
  });

  const run = await dispatchToSubagent(
    orchestrator,
    "harness-workflow-agent",
    prompt,
  );

  if (run.status === "error") {
    throw new Error(`Curate subagent error (run ${run.id})`);
  }

  const body = [
    "# Curate Draft",
    "",
    `- Timestamp: ${isoTimestamp()}`,
    `- Session: sispace-panel-curate`,
    `- Agent run: ${run.id}`,
    "",
    runResultPayload(run),
    "",
  ].join("\n");

  const outPath = join(paths.memoryRoot, "harness/reports/curate-draft.md");
  writeText(outPath, body);
  return `Curate draft written to harness/reports/curate-draft.md (run ${run.id})`;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv);
  if (!args.action) {
    process.stderr.write(
      "Usage: panel-actions.js <grade|apply|accept|reject|curate> --project-root <path> [--proposal-id <id>]\n",
    );
    return 1;
  }

  try {
    let message: string;
    switch (args.action) {
      case "grade":
        message = await runGrade(args.projectRoot);
        break;
      case "apply":
        message = await runApply(args.projectRoot);
        break;
      case "accept":
        message = await runAccept(args.projectRoot, args.proposalId);
        break;
      case "reject":
        message = await runReject(args.projectRoot, args.proposalId);
        break;
      case "curate":
        message = await runCurate(args.projectRoot);
        break;
      default:
        throw new Error(`Unknown action: ${args.action}`);
    }
    process.stdout.write(`${message}\n`);
    return 0;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`panel-actions ${args.action}: ${msg}\n`);
    return 1;
  }
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`panel-actions: fatal: ${message}\n`);
  process.exit(1);
});
