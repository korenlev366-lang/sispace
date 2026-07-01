import type { ChainGrade, ChainProposal, ChainReflection } from "./ledger.js";

function extractJsonObject(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) return trimmed;
  return trimmed.match(/\{[\s\S]*\}/)?.[0] ?? "{}";
}

export function buildReflectionSubagentInput(args: {
  sessionId: string;
  outputTokens: number;
  goalsText: string;
  acceptedLessonsExcerpt: string;
  reasoningPatternsExcerpt: string;
  transcriptExcerpt: string;
}): string {
  return [
    "Reflect on this completed Cursor session.",
    "Populate reasoning pattern fields when the session teaches a reusable approach.",
    "",
    `Session ID: ${args.sessionId}`,
    `Output tokens: ${args.outputTokens}`,
    "",
    "Active goals excerpt:",
    args.goalsText || "(none)",
    "",
    "Accepted lessons excerpt:",
    args.acceptedLessonsExcerpt || "(none)",
    "",
    "Prior reasoning patterns excerpt:",
    args.reasoningPatternsExcerpt || "(none)",
    "",
    "Session transcript excerpt (last 200 lines):",
    args.transcriptExcerpt || "(not provided — infer conservatively from harness context)",
  ].join("\n");
}

export function buildGradingSubagentInput(reflection: ChainReflection): string {
  return [
    "Grade the proposal in this reflection JSON (or return grade null if no proposal).",
    "",
    JSON.stringify({ reflection }, null, 2),
  ].join("\n");
}

export interface PanelApplyResult {
  status: "complete" | "partial" | "failed";
  deliverableSummary: string;
  filesTouched: string[];
  verificationEvidence: string;
}

export function buildPanelApplySubagentInput(args: {
  reflection: ChainReflection;
  grade: ChainGrade;
  sessionId: string;
  projectRoot: string;
}): string {
  const summary =
    args.reflection.proposal?.summary ?? args.reflection.outcome ?? "n/a";
  return [
    "Harness panel apply-all: implement this accepted proposal.",
    "Human review is already granted by the Apply all button — edit files as needed.",
    "",
    "Rules:",
    "- Smallest scoped change that fulfills the proposal summary.",
    "- Touch only files required for the target layer.",
    "- Run verification commands from the proposal body or infer minimal grep/test checks.",
    "- Do NOT spawn subagents.",
    "",
    `Project root: ${args.projectRoot}`,
    `Session ID: ${args.sessionId}`,
    `Proposal ID: ${args.grade.proposalId}`,
    `Target layer: ${args.reflection.proposal?.targetLayer ?? "unknown"}`,
    "",
    "Proposal summary:",
    summary,
    "",
    "Rollback note:",
    args.grade.rollbackNote,
    "",
    "Proposal ledger excerpt:",
    args.reflection.markdown.slice(0, 4000),
    "",
    "Return ONLY valid JSON (no markdown fences):",
    '{"status":"complete"|"partial"|"failed","deliverableSummary":"","filesTouched":[],"verificationEvidence":""}',
  ].join("\n");
}

export function parsePanelApplyJson(raw: string): PanelApplyResult {
  try {
    const parsed = JSON.parse(extractJsonObject(raw)) as Partial<PanelApplyResult>;
    const status = parsed.status;
    const normalizedStatus =
      status === "complete" || status === "partial" || status === "failed"
        ? status
        : "failed";
    return {
      status: normalizedStatus,
      deliverableSummary: String(parsed.deliverableSummary ?? ""),
      filesTouched: Array.isArray(parsed.filesTouched)
        ? parsed.filesTouched.map(String)
        : [],
      verificationEvidence: String(parsed.verificationEvidence ?? ""),
    };
  } catch {
    return {
      status: "failed",
      deliverableSummary: "",
      filesTouched: [],
      verificationEvidence: "",
    };
  }
}

export function buildRolloutSubagentInput(args: {
  reflection: ChainReflection;
  grade: ChainGrade | null;
  gate: { action: string; reason?: string; target_layer?: string };
  sessionId: string;
}): string {
  return [
    "Summarize the rollout log entry fields for this post-task chain step.",
    "",
    `Session ID: ${args.sessionId}`,
    `Gate action: ${args.gate.action}`,
    args.gate.reason ? `Gate reason: ${args.gate.reason}` : "",
    "",
    "Reflection JSON:",
    JSON.stringify({ reflection: args.reflection }, null, 2),
    "",
    "Grade JSON:",
    JSON.stringify({ grade: args.grade }, null, 2),
  ]
    .filter(Boolean)
    .join("\n");
}

/** @deprecated Combined prompt; post-task chain uses per-subagent dispatch. */
export function buildReflectionPrompt(args: {
  sessionId: string;
  outputTokens: number;
  goalsText: string;
  acceptedLessonsExcerpt: string;
  transcriptExcerpt: string;
}): string {
  return [
    "You are the harness post-task reflection agent.",
    "Analyze the completed Cursor session and return ONLY valid JSON (no markdown fences).",
    "",
    "Schema:",
    "{",
    '  "reflection": {',
    '    "taskGoal": string,',
    '    "outcome": string,',
    '    "filesChanged": string[],',
    '    "verificationEvidence": string,',
    '    "reasoningTrace": string,',
    '    "markdown": string,',
    '    "proposal": null | {',
    '      "proposalId": string,',
    '      "targetLayer": string,',
    '      "summary": string,',
    '      "rollbackNote": string',
    "    },",
    '    "noProposalReason": string',
    "  },",
    '  "grade": null | {',
    '    "proposalId": string,',
    '    "hardGateResult": "pass" | "fail",',
    '    "totalScore": number,',
    '    "decision": "accept" | "accept with human review" | "revise" | "reject",',
    '    "reason": string,',
    '    "rollbackNote": string',
    "  }",
    "}",
    "",
    "Rules:",
    "- Propose at most one inactive improvement with exactly one target layer.",
    "- If no evidence for a proposal, set proposal to null and explain in noProposalReason.",
    "- Grade only when proposal is non-null. Use hard gates from harness-improvement-review rubric.",
    "- Do not propose secrets exposure, undocumented APIs, or weakening safety hooks.",
    "",
    `Session ID: ${args.sessionId}`,
    `Output tokens: ${args.outputTokens}`,
    "",
    "Active goals excerpt:",
    args.goalsText || "(none)",
    "",
    "Accepted lessons excerpt:",
    args.acceptedLessonsExcerpt || "(none)",
    "",
    "Session transcript excerpt:",
    args.transcriptExcerpt || "(not provided — infer conservatively from harness context)",
  ].join("\n");
}

function normalizeProposal(proposalRaw: Partial<ChainProposal> | null | undefined): ChainProposal | null {
  if (!proposalRaw?.proposalId || !proposalRaw?.targetLayer) return null;
  return {
    proposalId: String(proposalRaw.proposalId),
    targetLayer: String(proposalRaw.targetLayer),
    summary: String(proposalRaw.summary ?? ""),
    rollbackNote: String(proposalRaw.rollbackNote ?? ""),
  };
}

function normalizeReflection(reflectionRaw: Partial<ChainReflection> & { proposal?: Partial<ChainProposal> | null } | undefined): ChainReflection {
  return {
    taskGoal: String(reflectionRaw?.taskGoal ?? ""),
    outcome: String(reflectionRaw?.outcome ?? ""),
    filesChanged: Array.isArray(reflectionRaw?.filesChanged) ? reflectionRaw.filesChanged.map(String) : [],
    verificationEvidence: String(reflectionRaw?.verificationEvidence ?? ""),
    reasoningTrace: String(reflectionRaw?.reasoningTrace ?? ""),
    markdown: String(reflectionRaw?.markdown ?? ""),
    proposal: normalizeProposal(reflectionRaw?.proposal),
    noProposalReason: String(reflectionRaw?.noProposalReason ?? ""),
    problemType: String(reflectionRaw?.problemType ?? ""),
    approachWorked: String(reflectionRaw?.approachWorked ?? ""),
    approachFailed: String(reflectionRaw?.approachFailed ?? ""),
    whenToApply: String(reflectionRaw?.whenToApply ?? ""),
  };
}

function normalizeGrade(gradeRaw: Partial<ChainGrade> | null | undefined): ChainGrade | null {
  if (!gradeRaw?.proposalId) return null;
  return {
    proposalId: String(gradeRaw.proposalId),
    hardGateResult: gradeRaw.hardGateResult === "fail" ? "fail" : "pass",
    totalScore: Number(gradeRaw.totalScore ?? 0),
    decision: (gradeRaw.decision as ChainGrade["decision"]) ?? "reject",
    reason: String(gradeRaw.reason ?? ""),
    rollbackNote: String(gradeRaw.rollbackNote ?? ""),
  };
}

export function parseReflectionJson(raw: string): { reflection: ChainReflection } {
  const parsed = JSON.parse(extractJsonObject(raw)) as {
    reflection?: Partial<ChainReflection> & { proposal?: Partial<ChainProposal> | null };
  };
  return { reflection: normalizeReflection(parsed.reflection) };
}

export function parseGradeJson(raw: string): { grade: ChainGrade | null } {
  const parsed = JSON.parse(extractJsonObject(raw)) as { grade?: Partial<ChainGrade> | null };
  return { grade: normalizeGrade(parsed.grade) };
}

export interface RolloutAgentFields {
  changeSummary: string;
  verificationEvidence: string;
  notes: string;
}

export function parseRolloutJson(raw: string): { rollout: RolloutAgentFields | null } {
  const parsed = JSON.parse(extractJsonObject(raw)) as {
    rollout?: Partial<RolloutAgentFields> | null;
  };
  const r = parsed.rollout;
  if (!r) return { rollout: null };
  return {
    rollout: {
      changeSummary: String(r.changeSummary ?? ""),
      verificationEvidence: String(r.verificationEvidence ?? ""),
      notes: String(r.notes ?? ""),
    },
  };
}

export function parseChainJson(raw: string): { reflection: ChainReflection; grade: ChainGrade | null } {
  const parsed = JSON.parse(extractJsonObject(raw)) as {
    reflection?: Partial<ChainReflection> & { proposal?: Partial<ChainProposal> | null };
    grade?: Partial<ChainGrade> | null;
  };
  return {
    reflection: normalizeReflection(parsed.reflection),
    grade: normalizeGrade(parsed.grade),
  };
}

export function fallbackReflection(sessionId: string, outputTokens: number, reason: string): ChainReflection {
  return {
    taskGoal: "post-task chain",
    outcome: "SDK chain unavailable; logged minimal entry",
    filesChanged: [],
    verificationEvidence: reason,
    reasoningTrace: reason,
    markdown: `# Latest Reflection\n\n- Session ID: ${sessionId}\n- Output tokens: ${outputTokens}\n- Status: fallback\n- Reason: ${reason}\n`,
    proposal: null,
    noProposalReason: reason,
  };
}
