import { execSync } from "node:child_process";
import { logSyncResult, syncObsidianEntries, vaultLinkPath, vaultWrite } from "./obsidian.js";
import type { SyncEntry, ObsidianSyncResult } from "./obsidian.js";
import type { ObsidianConfig } from "./paths.js";
import type { ChainReflection } from "./ledger.js";
import { timestampId } from "./paths.js";

export interface DeveloperCorrectionSignal {
  diff: string;
  filesChanged: string[];
  timestamp: string;
}

export interface CorrectionAnalysis {
  errorIdentified: string;
  permanentHeuristic: string;
  failureMode: string;
  targetLayer: string;
  severity: "critical" | "high" | "medium";
}

/**
 * Run `git diff HEAD` to capture unstaged manual corrections applied after
 * the agent turn. Returns null if the working tree is clean or git is unavailable.
 */
export function captureDeveloperCorrection(projectRoot: string): DeveloperCorrectionSignal | null {
  try {
    const diff = execSync("git diff HEAD", {
      cwd: projectRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 15_000,
    }).trim();

    if (!diff) return null;

    // Extract unique file paths from the diff
    const filePattern = /^diff --git a\/(.+?) b\/(.+?)$/gm;
    const filesChanged: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = filePattern.exec(diff)) !== null) {
      const file = match[2]; // b/ path is the new file
      if (file && !filesChanged.includes(file)) {
        filesChanged.push(file);
      }
    }

    return {
      diff,
      filesChanged,
      timestamp: new Date().toISOString(),
    };
  } catch {
    // Git unavailable, uninitialized, or clean — gracefully skip
    return null;
  }
}

/**
 * Build a prompt for the reflection subagent to analyze the developer's manual
 * correction diff against the agent's original proposed plan.
 */
export function buildCorrectionAnalysisPrompt(
  correction: DeveloperCorrectionSignal,
  reflection: ChainReflection,
  sessionId: string,
): string {
  const proposalSummary = reflection.proposal?.summary ?? reflection.outcome ?? "(no proposal)";
  const targetLayer = reflection.proposal?.targetLayer ?? "unknown";

  return [
    "You are the harness correction analysis agent.",
    "Analyze the developer's manual code corrections (git diff) against the agent's original proposal.",
    "Your task: distill a PERMANENT heuristic rule that prevents this class of error from recurring.",
    "",
    "Return ONLY valid JSON (no markdown fences):",
    "{",
    '  "errorIdentified": "string — exact structural error, layout mismatch, or configuration hallucination the agent made",',
    '  "permanentHeuristic": "string — a precise, reusable codebase rule that prevents this mistake",',
    '  "failureMode": "string — classification (e.g., code-correction-delta, config-hallucination, import-typo, structural-mismatch)",',
    '  "targetLayer": "string — which harness/project layer this rule guards (e.g., scripts, config, memory, vault)",',
    '  "severity": "critical" | "high" | "medium"',
    "}",
    "",
    "Rules:",
    "- errorIdentified must be specific: name the wrong file, wrong function, wrong import, or hallucinated API.",
    "- permanentHeuristic must be a single declarative sentence usable as a lint rule or skill guard.",
    "- failureMode should come from the list above or a close variant.",
    "- If the diff is a minor formatting fix, set severity to medium. If it corrects broken logic or imports, use high or critical.",
    "",
    `Session ID: ${sessionId}`,
    "",
    "Agent's original proposal:",
    `Target layer: ${targetLayer}`,
    `Summary: ${proposalSummary}`,
    `Outcome: ${reflection.outcome}`,
    `Files changed (agent): ${reflection.filesChanged.join(", ") || "none"}`,
    "",
    "Developer's manual correction (git diff HEAD):",
    "```diff",
    correction.diff.slice(0, 8000), // Truncate to avoid token blowout
    "```",
    "",
    `Files changed (manual): ${correction.filesChanged.join(", ")}`,
    "",
    "Now analyze the delta and produce the JSON output.",
  ].join("\n");
}

function extractJsonObject(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) return trimmed;
  const match = trimmed.match(/\{[\s\S]*\}/);
  return match?.[0] ?? "{}";
}

/**
 * Parse the reflection model's correction analysis JSON.
 */
export function parseCorrectionAnalysis(raw: string): CorrectionAnalysis {
  const parsed = JSON.parse(extractJsonObject(raw)) as Partial<CorrectionAnalysis>;
  return {
    errorIdentified: String(parsed.errorIdentified ?? "Unspecified agent error"),
    permanentHeuristic: String(
      parsed.permanentHeuristic ?? "Review agent output for correctness before accepting",
    ),
    failureMode: String(parsed.failureMode ?? "code-correction-delta"),
    targetLayer: String(parsed.targetLayer ?? "scripts"),
    severity:
      parsed.severity === "critical" ||
      parsed.severity === "high" ||
      parsed.severity === "medium"
        ? parsed.severity
        : "high",
  };
}

/**
 * Build a structured SyncEntry for the Obsidian vault rule card.
 */
export function synthesizeHeuristicRuleCard(
  analysis: CorrectionAnalysis,
  correction: DeveloperCorrectionSignal,
  sessionId: string,
  proposalId?: string,
): SyncEntry {
  const ruleId = `HEURISTIC-${timestampId()}`;

  const body = [
    `# Heuristic Rule: ${analysis.permanentHeuristic.slice(0, 80)}`,
    "",
    `- **Rule ID:** ${ruleId}`,
    `- **Status:** active`,
    `- **Failure mode:** ${analysis.failureMode}`,
    `- **Severity:** ${analysis.severity}`,
    `- **Target layer:** ${analysis.targetLayer}`,
    `- **Source session:** ${sessionId}`,
    proposalId ? `- **Related proposal:** ${proposalId}` : "",
    `- **Date:** ${new Date().toISOString().slice(0, 10)}`,
    "",
    "## Error Identified",
    "",
    analysis.errorIdentified,
    "",
    "## Permanent Heuristic",
    "",
    analysis.permanentHeuristic,
    "",
    "## Files Corrected",
    "",
    ...correction.filesChanged.map((f) => `- \`${f}\``),
    "",
    "## Correction Diff (abbreviated)",
    "",
    "```diff",
    correction.diff.slice(0, 2000),
    "```",
  ]
    
    .join("\n");

  return {
    kind: "heuristic",
    id: ruleId,
    body,
    links: proposalId
      ? [vaultLinkPath("Harness/accepted-lessons", proposalId)]
      : undefined,
  };
}

/**
 * Full pipeline: capture diff → no diff? skip. Otherwise, dispatch analysis
 * to the reflection model and return a SyncEntry ready for Obsidian insertion.
 *
 * Caller must provide a dispatch function that sends the prompt to the
 * reflection model (OpenRouter or cursor-agent).
 */
export async function runRejectionRecoveryPipeline(args: {
  projectRoot: string;
  sessionId: string;
  reflection: ChainReflection;
  dispatchPrompt: (prompt: string) => Promise<string>;
  logLine: (msg: string) => void;
}): Promise<SyncEntry | null> {
  const { projectRoot, sessionId, reflection, dispatchPrompt, logLine } = args;

  // Step 1: Capture git diff
  const correction = captureDeveloperCorrection(projectRoot);
  if (!correction) {
    logLine("git-rejection-recovery: no diff — skipping");
    return null;
  }

  logLine(
    `git-rejection-recovery: diff detected (${correction.filesChanged.length} files: ${correction.filesChanged.join(", ")})`,
  );

  // Step 2: Build and dispatch correction analysis prompt
  const prompt = buildCorrectionAnalysisPrompt(correction, reflection, sessionId);

  let analysis: CorrectionAnalysis;
  try {
    const raw = await dispatchPrompt(prompt);
    analysis = parseCorrectionAnalysis(raw);
    logLine(
      `git-rejection-recovery: analysis parsed (failureMode=${analysis.failureMode} severity=${analysis.severity})`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logLine(`git-rejection-recovery: analysis failed — ${message}`);
    // Fallback: synthesize a basic rule from the raw diff
    analysis = {
      errorIdentified: `Agent output required manual correction in: ${correction.filesChanged.join(", ")}`,
      permanentHeuristic: `Verify agent-generated changes to ${correction.filesChanged.join(", ")} before accepting`,
      failureMode: "code-correction-delta",
      targetLayer: reflection.proposal?.targetLayer ?? "scripts",
      severity: "high",
    };
  }

  // Step 3: Synthesize rule card
  const entry = synthesizeHeuristicRuleCard(
    analysis,
    correction,
    sessionId,
    reflection.proposal?.proposalId,
  );

  logLine(`git-rejection-recovery: rule card synthesized (id=${entry.id})`);

  return entry;
}

/**
 * Commit a heuristic rule card directly to the Obsidian vault via the HTTP PUT
 * mapping layer. Uses the existing vaultWrite infrastructure.
 */
export async function commitHeuristicRuleToVault(
  entry: SyncEntry,
  config: ObsidianConfig,
  opts: { token: string; apiUrl: string },
): Promise<ObsidianSyncResult> {
  // Map the heuristic kind to a target folder — use a dedicated heuristics folder
  // if available, else fall back to accepted-lessons.
  const heuristicsFolder =
    (config as unknown as Record<string, unknown>).heuristicsFolder as string | undefined;

  const targetFolder = heuristicsFolder ?? config.folders.acceptedLessons;

  // Build a config override that routes "heuristic" kind to the target folder
  const overrideConfig: ObsidianConfig = {
    ...config,
    folders: {
      ...config.folders,
      // We don't have a heuristics folder in the type, but syncObsidianEntries
      // uses a switch on entry.kind. We need to handle "heuristic" there.
    },
  };

  // Instead, directly call vaultWrite to bypass the kind-switch limitation
  const apiUrl = opts.apiUrl?.trim() || "http://127.0.0.1:27123";
  const token = opts.token?.trim();

  const result: ObsidianSyncResult = { synced: [], skipped: [], errors: [] };

  if (!token) {
    result.skipped.push("heuristic rule (Obsidian token not provided)");
    return result;
  }

  if (!config.vaultRoot) {
    result.skipped.push("heuristic rule (vault_root missing)");
    return result;
  }

  const safeId = entry.id.replace(/[^\w.-]+/g, "-");
  const vaultPath = `${targetFolder}/${safeId}.md`;

  // Build frontmatter
  const frontmatter = [
    "---",
    `source: "cursor-harness"`,
    `tags: "harness heuristics"`,
    `rule_id: "${entry.id}"`,
    `status: "active"`,
    `failure_mode: "code-correction-delta"`,
    `date: "${new Date().toISOString().slice(0, 10)}"`,
    "---",
    "",
    entry.body,
  ].join("\n");

  try {
    await vaultWrite(apiUrl, token, vaultPath, frontmatter);
    result.synced.push(vaultPath);
  } catch (err) {
    result.errors.push(
      `${vaultPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return result;
}
