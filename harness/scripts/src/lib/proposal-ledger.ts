import fs from "node:fs";
import type { HarnessPaths } from "./paths.js";
import { appendText, readText, writeText } from "./paths.js";
import type { ChainGrade, ChainProposal, ChainReflection } from "./ledger.js";
import { isLockedLayer } from "./ledger.js";

export interface ProposalEntry {
  id: string;
  title: string;
  body: string;
  heading: string;
  source: "pending" | "accepted";
}

const ENTRY_SPLIT = /\n(?=### (?:PROP|PENDING)-[^\n]+)/;

function parseBlocks(content: string, prefixes: readonly string[]): ProposalEntry[] {
  const entries: ProposalEntry[] = [];
  for (const part of content.split(ENTRY_SPLIT)) {
    const trimmed = part.trim();
    if (!trimmed.startsWith("### ")) continue;
    const heading = trimmed.split("\n")[0]?.trim() ?? "";
    const idPart = heading.slice(4).split(":")[0]?.trim() ?? "";
    if (!prefixes.some((p) => idPart.startsWith(p))) continue;
    const title = heading.includes(":") ? heading.split(":").slice(1).join(":").trim() : "";
    entries.push({
      id: idPart,
      title,
      body: trimmed,
      heading,
      source: "pending",
    });
  }
  return entries;
}

export function parsePendingProposals(content: string): ProposalEntry[] {
  return parseBlocks(content, ["PROP-", "PENDING-"]).map((e) => ({
    ...e,
    source: "pending" as const,
  }));
}

export function parseAcceptedProposals(content: string): ProposalEntry[] {
  return parseBlocks(content, ["PROP-", "PENDING-", "ACCEPTED-"]).map((e) => ({
    ...e,
    source: "accepted" as const,
  }));
}

function fieldValue(body: string, key: string): string | undefined {
  const needle = `- ${key}:`;
  for (const line of body.split("\n")) {
    const t = line.trim();
    if (t.startsWith(needle)) return t.slice(needle.length).trim();
  }
  return undefined;
}

export function proposalStatus(body: string): string {
  return (fieldValue(body, "Status") ?? "pending").toLowerCase();
}

export function isApplied(body: string): boolean {
  const st = proposalStatus(body);
  return st.includes("applied");
}

export function isRejected(body: string): boolean {
  const st = proposalStatus(body);
  return st.includes("reject");
}

export function isAccepted(body: string): boolean {
  if (isApplied(body) || isRejected(body)) return false;
  const st = proposalStatus(body);
  const decision = (fieldValue(body, "Grading decision") ?? "").toLowerCase();
  return st.includes("accepted") || decision.includes("accept");
}

export function upsertProposalFields(body: string, fields: Record<string, string>): string {
  let out = body;
  for (const [key, value] of Object.entries(fields)) {
    const re = new RegExp(`^- ${key}:.*$`, "m");
    const line = `- ${key}: ${value}`;
    if (re.test(out)) out = out.replace(re, line);
    else out = `${out.trimEnd()}\n${line}`;
  }
  return out;
}

function replaceProposalBlock(fileContent: string, entry: ProposalEntry): string {
  const parts = fileContent.split(ENTRY_SPLIT);
  const rebuilt: string[] = [];
  let replaced = false;
  for (const part of parts) {
    if (!part.trim().startsWith("### ")) {
      rebuilt.push(part);
      continue;
    }
    const id = part.trim().split("\n")[0]?.slice(4).split(":")[0]?.trim() ?? "";
    if (id === entry.id) {
      rebuilt.push(entry.body);
      replaced = true;
    } else {
      rebuilt.push(part);
    }
  }
  if (!replaced) {
    rebuilt.push(entry.body);
  }
  return rebuilt.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

function removeProposalBlock(fileContent: string, proposalId: string): string {
  const parts = fileContent.split(ENTRY_SPLIT);
  const kept: string[] = [];
  for (const part of parts) {
    if (!part.trim().startsWith("### ")) {
      kept.push(part);
      continue;
    }
    const id = part.trim().split("\n")[0]?.slice(4).split(":")[0]?.trim() ?? "";
    if (id !== proposalId) kept.push(part);
  }
  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

function acceptedLessonsHasId(content: string, proposalId: string): boolean {
  return new RegExp(`^### ${proposalId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:`, "m").test(
    content,
  );
}

export function findProposal(paths: HarnessPaths, proposalId: string): ProposalEntry | null {
  const pending = parsePendingProposals(readText(paths.pendingProposals));
  const hit = pending.find((p) => p.id === proposalId);
  if (hit) return hit;
  const accepted = parseAcceptedProposals(readText(paths.acceptedLessons));
  return accepted.find((p) => p.id === proposalId) ?? null;
}

export function acceptProposal(paths: HarnessPaths, proposalId: string): ProposalEntry {
  const pendingRaw = readText(paths.pendingProposals);
  let entry = parsePendingProposals(pendingRaw).find((p) => p.id === proposalId);
  if (!entry) {
    entry = parseAcceptedProposals(readText(paths.acceptedLessons)).find(
      (p) => p.id === proposalId,
    );
    if (!entry) throw new Error(`Proposal not found: ${proposalId}`);
    if (isAccepted(entry.body)) return entry;
  }

  const summary =
    fieldValue(entry.body, "Summary") ??
    fieldValue(entry.body, "Proposed change") ??
    entry.title;
  const targetLayer = fieldValue(entry.body, "Target layer") ?? "memory";
  const rollback =
    fieldValue(entry.body, "Rollback note") ?? "Revert the applied change per proposal text.";

  entry.body = upsertProposalFields(entry.body, {
    Status: "accepted",
    "Grading decision": "accept with human review",
  });

  if (entry.source === "pending") {
    writeText(paths.pendingProposals, replaceProposalBlock(pendingRaw, entry));
  }

  const acceptedRaw = readText(paths.acceptedLessons);
  if (!acceptedLessonsHasId(acceptedRaw, proposalId)) {
    appendText(
      paths.acceptedLessons,
      [
        "",
        `### ${proposalId}: Accepted proposal`,
        "",
        "- Source task: harness panel accept",
        `- Reason: Manually accepted via harness panel (${new Date().toISOString().slice(0, 10)})`,
        `- Target layer: ${targetLayer}`,
        `- Date: ${new Date().toISOString().slice(0, 10)}`,
        `- Rollback note: ${rollback}`,
        "- Applied change:",
        "",
        summary,
        "",
      ].join("\n"),
    );
  }

  entry.source = "accepted";
  return entry;
}

export function rejectProposal(paths: HarnessPaths, proposalId: string): void {
  const entry = findProposal(paths, proposalId);
  if (!entry) throw new Error(`Proposal not found: ${proposalId}`);

  const summary =
    fieldValue(entry.body, "Summary") ??
    fieldValue(entry.body, "Proposed change") ??
    entry.title;
  const targetLayer = fieldValue(entry.body, "Target layer") ?? "memory";

  appendText(
    paths.rejectedLessons,
    [
      "",
      `### ${proposalId}: Rejected proposal`,
      "",
      "- Source task: harness panel reject",
      "- Reason: Manually rejected via harness panel",
      `- Target layer: ${targetLayer}`,
      `- Date: ${new Date().toISOString().slice(0, 10)}`,
      "- Rollback note: n/a",
      `- Rejected proposal: ${summary}`,
      "- Reconsider only if: new evidence warrants re-grading",
      "",
    ].join("\n"),
  );

  if (entry.source === "pending") {
    const updated: ProposalEntry = {
      ...entry,
      body: upsertProposalFields(entry.body, {
        Status: "rejected",
        "Grading decision": "reject",
      }),
    };
    writeText(
      paths.pendingProposals,
      replaceProposalBlock(readText(paths.pendingProposals), updated),
    );
  }
}

/**
 * Panel marked applied but rollout only logged blocked_locked_layer (no file edits).
 * Allow bulk apply to retry implementation.
 */
export function needsPanelReapply(body: string): boolean {
  if (!isApplied(body)) return false;
  const st = proposalStatus(body);
  if (!st.includes("harness panel apply-all")) return false;
  const layer = fieldValue(body, "Target layer") ?? "";
  return isLockedLayer(layer);
}

/** Pending proposals eligible for bulk apply (not rejected/applied, or stale locked-layer apply). */
export function listPendingForBulkApply(paths: HarnessPaths): ProposalEntry[] {
  return parsePendingProposals(readText(paths.pendingProposals)).filter(
    (p) => !isRejected(p.body) && (!isApplied(p.body) || needsPanelReapply(p.body)),
  );
}

export function reflectionFromProposal(entry: ProposalEntry): ChainReflection {
  const summary =
    fieldValue(entry.body, "Summary") ??
    fieldValue(entry.body, "Proposed change") ??
    entry.title;
  const targetLayer = fieldValue(entry.body, "Target layer") ?? "memory";
  const rollback =
    fieldValue(entry.body, "Rollback note") ?? "Revert per proposal rollback note.";

  const proposal: ChainProposal = {
    proposalId: entry.id,
    targetLayer,
    summary,
    rollbackNote: rollback,
  };

  return {
    taskGoal: `Apply harness proposal ${entry.id}`,
    outcome: summary,
    filesChanged: [],
    verificationEvidence: fieldValue(entry.body, "Verification evidence") ?? "panel apply-all",
    reasoningTrace: entry.body.slice(0, 2000),
    proposal,
    noProposalReason: "",
    markdown: entry.body,
  };
}

export function markProposalApplied(body: string): string {
  const date = new Date().toISOString().slice(0, 10);
  return upsertProposalFields(
    body,
    { Status: `**applied** ${date} (harness panel apply-all)` },
  );
}

export function rewritePendingProposal(paths: HarnessPaths, entry: ProposalEntry): void {
  writeText(
    paths.pendingProposals,
    replaceProposalBlock(readText(paths.pendingProposals), entry),
  );
}

export function gradeFromProposal(entry: ProposalEntry): ChainGrade {
  const decision = "accept with human review";

  return {
    proposalId: entry.id,
    hardGateResult: "pass",
    totalScore: 0,
    decision: decision as ChainGrade["decision"],
    reason:
      fieldValue(entry.body, "Reason") ??
      "Bulk apply from harness panel (accept all proposals).",
    rollbackNote:
      fieldValue(entry.body, "Rollback note") ?? "Revert per proposal rollback note.",
  };
}
