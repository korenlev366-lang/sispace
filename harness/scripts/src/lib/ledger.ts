import fs from "node:fs";
import { execSync } from "node:child_process";
import type { HarnessPaths } from "./paths.js";
import { appendText, isoTimestamp, readText, timestampId, writeText } from "./paths.js";

export interface GateResult {
  action: "apply" | "log_only" | "blocked_locked_layer" | "blocked" | "no_proposal";
  target_layer?: string;
  category?: string;
  auto_apply_enabled?: boolean;
  category_enabled?: boolean;
  reason?: string;
}

export interface ChainProposal {
  proposalId: string;
  targetLayer: string;
  summary: string;
  rollbackNote: string;
}

export interface ChainGrade {
  proposalId: string;
  hardGateResult: "pass" | "fail";
  totalScore: number;
  decision: "accept" | "accept with human review" | "revise" | "reject";
  reason: string;
  rollbackNote: string;
  scores?: Record<string, number>;
}

export interface ChainReflection {
  taskGoal: string;
  outcome: string;
  filesChanged: string[];
  verificationEvidence: string;
  reasoningTrace: string;
  proposal: ChainProposal | null;
  noProposalReason: string;
  markdown: string;
  problemType?: string;
  approachWorked?: string;
  approachFailed?: string;
  whenToApply?: string;
}

export interface ChainResult {
  reflection: ChainReflection;
  grade: ChainGrade | null;
  gate: GateResult;
  rolloutId: string;
}

function normalizeLayer(layer: string): string {
  const key = layer.toLowerCase().replace(/\s+/g, "-");
  switch (key) {
    case "rule":
    case "rules":
      return "rules";
    case "hook":
    case "hooks":
      return "hooks";
    case "skill":
    case "skills":
      return "skills";
    case "command":
    case "commands":
      return "commands";
    case "doc":
    case "docs":
    case "documentation":
      return "docs";
    case "backtest":
    case "backtests":
    case "test":
    case "tests":
      return "backtests";
    case "user-model":
    case "user_model":
    case "usermodel":
      return "user-model";
    default:
      return key;
  }
}

function isLocked(category: string): boolean {
  return ["rules", "hooks", "skills", "commands", "mcp", "user-model"].includes(category);
}

/** True when post-task auto-apply must not touch files without human /harness-apply. */
export function isLockedLayer(targetLayer: string): boolean {
  return isLocked(normalizeLayer(targetLayer));
}

/** Panel apply-all is explicit human review — always permit implementation. */
export function evaluatePanelApplyGate(targetLayer: string | null): GateResult {
  if (!targetLayer) {
    return { action: "no_proposal", reason: "proposal has no target layer" };
  }
  return {
    action: "apply",
    target_layer: targetLayer,
    category: normalizeLayer(targetLayer),
    auto_apply_enabled: true,
    category_enabled: true,
    reason: "panel apply-all (explicit human review)",
  };
}

function readYamlFlag(configText: string, section: string, key: string): string {
  const lines = configText.split("\n");
  let inSection = false;
  for (const line of lines) {
    if (line.match(/^auto_apply:/)) inSection = section === "enabled";
    if (inSection && section === "enabled" && line.match(/^\s+enabled:/)) {
      return line.split(":")[1]?.trim() ?? "false";
    }
    if (line.match(/^\s+categories:/)) inSection = section === "category";
    if (inSection && section === "category") {
      const m = line.match(new RegExp(`^\\s+${key}:\\s*(\\S+)`));
      if (m) return m[1];
    }
    if (inSection && line.match(/^[^ \t]/) && !line.match(/^auto_apply:/)) {
      inSection = false;
    }
  }
  return "";
}

export function evaluateGate(paths: HarnessPaths, targetLayer: string | null): GateResult {
  if (!targetLayer) {
    return { action: "no_proposal", reason: "reflection found no durable proposal" };
  }

  const configText = readText(paths.harnessYaml);
  if (!configText) {
    return { action: "blocked", target_layer: targetLayer, reason: "harness config missing" };
  }

  const category = normalizeLayer(targetLayer);
  const enabledRaw = readYamlFlag(configText, "enabled", "");
  const enabled = ["true", "yes", "1"].includes(enabledRaw);

  if (isLocked(category)) {
    return {
      action: "blocked_locked_layer",
      target_layer: targetLayer,
      category,
      auto_apply_enabled: enabled,
      reason: "locked category; requires human review via /harness-apply",
    };
  }

  if (!["docs", "memory", "backtests"].includes(category)) {
    return {
      action: "blocked",
      target_layer: targetLayer,
      category,
      auto_apply_enabled: enabled,
      reason: "target layer is not an auto-apply eligible category",
    };
  }

  const flagRaw = readYamlFlag(configText, "category", category);
  const flag = ["true", "yes", "1"].includes(flagRaw);

  if (enabled && flag) {
    return {
      action: "apply",
      target_layer: targetLayer,
      category,
      auto_apply_enabled: true,
      category_enabled: true,
    };
  }

  return {
    action: "log_only",
    target_layer: targetLayer,
    category,
    auto_apply_enabled: enabled,
    category_enabled: flag,
    reason: "auto_apply disabled or category not opted in",
  };
}

export function ensureRolloutLogHeader(paths: HarnessPaths): void {
  if (fs.existsSync(paths.rolloutLog)) return;
  writeText(
    paths.rolloutLog,
    "# Rollout Log\n\nAppend-only record of harness self-optimization rollouts.\n\n## Entries\n",
  );
}

export interface RolloutAgentSummary {
  changeSummary?: string;
  verificationEvidence?: string;
  notes?: string;
}

export function appendRolloutEntry(
  paths: HarnessPaths,
  args: {
    rolloutId: string;
    sessionId: string;
    outputTokens: number;
    reflection: ChainReflection;
    grade: ChainGrade | null;
    gate: GateResult;
    agentRunId?: string;
    obsidianSync?: string;
    rolloutAgent?: RolloutAgentSummary | null;
  },
): string {
  ensureRolloutLogHeader(paths);
  const ts = isoTimestamp();
  const gateLabel =
    args.gate.action === "apply"
      ? "applied"
      : args.gate.action === "log_only"
        ? "log_only"
        : args.gate.action === "blocked_locked_layer"
          ? "pending_human_review"
          : args.gate.action === "no_proposal"
            ? "no_proposal"
            : "blocked";

  const lines = [
    "",
    `### ${args.rolloutId}`,
    "",
    `- Timestamp: ${ts}`,
    `- Session ID: ${args.sessionId}`,
    `- Output tokens: ${args.outputTokens}`,
    `- Status: completed-sdk-chain`,
    `- Agent run ID: ${args.agentRunId ?? "n/a"}`,
    `- Task goal: ${args.reflection.taskGoal || "n/a"}`,
    `- Outcome: ${args.reflection.outcome || "n/a"}`,
    `- Proposal ID: ${args.grade?.proposalId ?? args.reflection.proposal?.proposalId ?? "none"}`,
    `- Target layer: ${args.reflection.proposal?.targetLayer ?? "none"}`,
    `- Grading decision: ${args.grade?.decision ?? "n/a"}`,
    `- Gate result: ${gateLabel}`,
    `- Gate action: ${args.gate.action}`,
    `- Change summary: ${args.rolloutAgent?.changeSummary || args.reflection.proposal?.summary || args.reflection.noProposalReason || "Post-task SDK chain completed"}`,
    `- Files touched: ${gateLabel === "applied" ? "see agent transcript" : gateLabel === "pending_human_review" ? "none (pending /harness-apply)" : "none (log_only or no_proposal)"}`,
    `- Rollback note: ${args.grade?.rollbackNote ?? args.reflection.proposal?.rollbackNote ?? "n/a"}`,
    `- Verification evidence: ${args.rolloutAgent?.verificationEvidence || args.reflection.verificationEvidence || "SDK post-task chain"}`,
    ...(args.rolloutAgent?.notes ? [`- Rollout notes: ${args.rolloutAgent.notes}`] : []),
    `- Obsidian sync: ${args.obsidianSync ?? "pending"}`,
  ];

  appendText(paths.rolloutLog, lines.join("\n"));
  return lines.join("\n");
}

export function writeReflectionReport(paths: HarnessPaths, reflection: ChainReflection, sessionId: string, outputTokens: number): void {
  const body = [
    "# Latest Reflection",
    "",
    `- Timestamp: ${isoTimestamp()}`,
    `- Session ID: ${sessionId}`,
    `- Output tokens: ${outputTokens}`,
    `- Status: completed-sdk-chain`,
    `- Source: post-task-chain.ts`,
    "",
    reflection.markdown || [
      `- Task goal: ${reflection.taskGoal}`,
      `- Outcome: ${reflection.outcome}`,
      `- Files changed: ${reflection.filesChanged.join(", ") || "none"}`,
      `- Verification evidence: ${reflection.verificationEvidence}`,
      `- Reasoning trace: ${reflection.reasoningTrace}`,
      reflection.proposal
        ? `- Proposal: ${reflection.proposal.summary} (layer: ${reflection.proposal.targetLayer})`
        : `- Reason for no proposal: ${reflection.noProposalReason}`,
    ].join("\n"),
    "",
  ].join("\n");
  writeText(paths.latestReflection, body);
}

export function writeGradeReport(paths: HarnessPaths, grade: ChainGrade | null, sessionId: string): void {
  if (!grade) {
    writeText(
      paths.latestGrade,
      `# Latest Grade\n\n- Timestamp: ${isoTimestamp()}\n- Session ID: ${sessionId}\n- Status: no_proposal\n`,
    );
    return;
  }

  const body = [
    "# Latest Grade",
    "",
    `- Timestamp: ${isoTimestamp()}`,
    `- Session ID: ${sessionId}`,
    `- Proposal ID: ${grade.proposalId}`,
    `- Hard gate result: ${grade.hardGateResult}`,
    `- Total score: ${grade.totalScore}`,
    `- Decision: ${grade.decision}`,
    `- Reason: ${grade.reason}`,
    `- Required rollback note: ${grade.rollbackNote}`,
    "",
  ].join("\n");
  writeText(paths.latestGrade, body);
}

export function appendMemoryOutcome(paths: HarnessPaths, grade: ChainGrade, proposal: ChainProposal): void {
  const date = new Date().toISOString().slice(0, 10);
  if (grade.decision === "reject") {
    appendText(
      paths.rejectedLessons,
      `\n### ${grade.proposalId}: Rejected proposal\n\n- Source task: post-task SDK chain\n- Reason: ${grade.reason}\n- Target layer: ${proposal.targetLayer}\n- Date: ${date}\n- Rollback note: ${grade.rollbackNote}\n`,
    );
    return;
  }

  if (grade.decision === "revise") {
    appendText(
      paths.pendingProposals,
      `\n### ${grade.proposalId}: Pending revision\n\n- Target layer: ${proposal.targetLayer}\n- Summary: ${proposal.summary}\n- Date: ${date}\n- Status: inactive pending revision\n`,
    );
    return;
  }

  appendText(
    paths.acceptedLessons,
    `\n### ${grade.proposalId}: Accepted proposal\n\n- Source task: post-task SDK chain\n- Reason: ${grade.reason}\n- Target layer: ${proposal.targetLayer}\n- Date: ${date}\n- Rollback note: ${grade.rollbackNote}\n- Applied change:\n\n${proposal.summary}\n`,
  );
}

function pickMarkdownField(markdown: string, labels: string[]): string {
  for (const label of labels) {
    const re = new RegExp(`[-*]\\s*${label}:\\s*(.+)$`, "im");
    const match = markdown.match(re);
    if (match?.[1]?.trim()) return match[1].trim();
  }
  return "";
}

function derivePatternTitle(problemType: string): string {
  const trimmed = problemType.trim();
  if (trimmed.length <= 72) return trimmed;
  return `${trimmed.slice(0, 69)}...`;
}

export function appendReasoningPattern(
  paths: HarnessPaths,
  sessionId: string,
  reflection: ChainReflection,
): boolean {
  const source = `${reflection.markdown}\n${reflection.reasoningTrace}`;
  const problemType =
    reflection.problemType?.trim()
    || pickMarkdownField(source, ["Problem type", "Repeated friction"])
    || reflection.taskGoal.trim();
  const approachWorked =
    reflection.approachWorked?.trim()
    || pickMarkdownField(source, ["What worked", "Successful pattern", "Why the chosen fix worked"]);
  const approachFailed =
    reflection.approachFailed?.trim()
    || pickMarkdownField(source, ["What failed", "Why it failed or changed direction", "Failed attempts"]);
  const whenToApply =
    reflection.whenToApply?.trim()
    || pickMarkdownField(source, ["When to apply", "Durable lesson supported"]);

  if (!problemType || !approachWorked || !whenToApply) return false;

  const patternId = `PATTERN-${timestampId()}`;
  const title = derivePatternTitle(problemType);
  const lines = [
    "",
    `### ${patternId}: ${title}`,
    "",
    `- Session ID: ${sessionId}`,
    `- Problem type: ${problemType}`,
    `- What worked: ${approachWorked}`,
    `- What failed: ${approachFailed || "n/a"}`,
    `- When to apply: ${whenToApply}`,
    `- Verification evidence: ${reflection.verificationEvidence || "post-task reflection"}`,
    "",
  ];
  appendText(paths.reasoningPatterns, lines.join("\n"));
  return true;
}

export function runRolloutGateScript(paths: HarnessPaths, targetLayer: string): GateResult {
  try {
    const out = execSync(`sh harness/scripts/rollout-gate.sh ${JSON.stringify(targetLayer)}`, {
      cwd: paths.root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    const parsed = JSON.parse(out) as { action: GateResult["action"]; target_layer?: string; category?: string; auto_apply_enabled?: boolean; category_enabled?: boolean; reason?: string };
    return parsed;
  } catch {
    return evaluateGate(paths, targetLayer);
  }
}

export function newRolloutId(): string {
  return `ROLLOUT-${timestampId()}-sdk`;
}
