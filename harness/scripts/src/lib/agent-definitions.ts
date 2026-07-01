import fs from "node:fs";
import path from "node:path";
import type { AgentDefinition } from "./sdk-types.js";
import { modelIdToSelection } from "./model-selection.js";

const HARNESS_AGENT_FILES = [
  "harness-reflection-agent.md",
  "harness-grading-agent.md",
  "harness-rollout-agent.md",
  "harness-ralph-agent.md",
  "harness-workflow-agent.md",
] as const;

const SPECIALIST_AGENT_FILES = [
  "researcher-agent.md",
  "architect-agent.md",
  "coder-agent.md",
  "reviewer-agent.md",
  "tester-agent.md",
  "debugger-agent.md",
  "documenter-agent.md",
] as const;

const CHECKER_AGENT_FILES = [
  "checker-researcher.md",
  "checker-architect.md",
  "checker-coder.md",
  "checker-reviewer.md",
  "checker-tester.md",
] as const;

export type HarnessAgentName =
  | "harness-reflection-agent"
  | "harness-grading-agent"
  | "harness-rollout-agent"
  | "harness-ralph-agent"
  | "harness-workflow-agent";

export type SpecialistAgentName =
  | "researcher-agent"
  | "architect-agent"
  | "coder-agent"
  | "reviewer-agent"
  | "tester-agent"
  | "debugger-agent"
  | "documenter-agent";

export type CheckerAgentName =
  | "checker-researcher"
  | "checker-architect"
  | "checker-coder"
  | "checker-reviewer"
  | "checker-tester";

export type WorkflowAgentName = HarnessAgentName | SpecialistAgentName | CheckerAgentName;

/** Layer-3 checker paired with each specialist (undefined = no checker). */
export const SPECIALIST_CHECKER_MAP: Partial<Record<SpecialistAgentName, CheckerAgentName>> = {
  "researcher-agent": "checker-researcher",
  "architect-agent": "checker-architect",
  "coder-agent": "checker-coder",
  "reviewer-agent": "checker-reviewer",
  "tester-agent": "checker-tester",
};

export interface ParsedAgentFile {
  name: string;
  description: string;
  model?: string;
  prompt: string;
}

export function parseAgentMarkdown(content: string): ParsedAgentFile {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) {
    throw new Error("agent file missing YAML frontmatter");
  }
  const frontmatter = match[1];
  const body = match[2].trim();
  const name = /^name:\s*(.+)$/m.exec(frontmatter)?.[1]?.trim();
  const description = /^description:\s*(.+)$/m.exec(frontmatter)?.[1]?.trim();
  const model = /^model:\s*(.+)$/m.exec(frontmatter)?.[1]?.trim();
  if (!name || !description) {
    throw new Error("agent file requires name and description in frontmatter");
  }
  return { name, description, model, prompt: body };
}

export function toAgentDefinition(parsed: ParsedAgentFile): AgentDefinition {
  return {
    description: parsed.description,
    prompt: parsed.prompt,
    ...(parsed.model ? { model: { id: parsed.model } } : {}),
  };
}

function loadAgentsFromFiles(projectRoot: string, files: readonly string[]): Record<string, AgentDefinition> {
  const agentsDir = path.join(projectRoot, ".cursor", "agents");
  const agents: Record<string, AgentDefinition> = {};

  for (const file of files) {
    const full = path.join(agentsDir, file);
    if (!fs.existsSync(full)) continue;
    const parsed = parseAgentMarkdown(fs.readFileSync(full, "utf8"));
    agents[parsed.name] = toAgentDefinition(parsed);
  }

  return agents;
}

/** Harness post-task / Ralph agents only */
export function loadHarnessAgents(projectRoot: string): Record<string, AgentDefinition> {
  return loadAgentsFromFiles(projectRoot, HARNESS_AGENT_FILES);
}

/** Harness + specialists + Layer-3 checkers for workflow SDK */
export function loadWorkflowAgents(projectRoot: string): Record<string, AgentDefinition> {
  return {
    ...loadAgentsFromFiles(projectRoot, HARNESS_AGENT_FILES),
    ...loadAgentsFromFiles(projectRoot, SPECIALIST_AGENT_FILES),
    ...loadAgentsFromFiles(projectRoot, CHECKER_AGENT_FILES),
  };
}

/** Specialists plus any paired checkers needed for a pipeline sequence. */
export function agentsForPipelineSequence(sequence: readonly string[]): string[] {
  const names = new Set<string>(sequence);
  for (const specialist of sequence) {
    const checker = SPECIALIST_CHECKER_MAP[specialist as SpecialistAgentName];
    if (checker) names.add(checker);
  }
  return [...names];
}

export function requireAgent(
  agents: Record<string, AgentDefinition>,
  name: string,
): AgentDefinition {
  const def = agents[name];
  if (!def) {
    throw new Error(`missing agent definition: ${name} (.cursor/agents/${name}.md)`);
  }
  return def;
}

export function pickAgents(
  agents: Record<string, AgentDefinition>,
  names: string[],
): Record<string, AgentDefinition> {
  const picked: Record<string, AgentDefinition> = {};
  for (const name of names) {
    picked[name] = requireAgent(agents, name);
  }
  return picked;
}

/** Pick agents and override each definition's model (pipeline subagent tier). */
export function pickAgentsWithModel(
  agents: Record<string, AgentDefinition>,
  names: string[],
  modelId: string,
): Record<string, AgentDefinition> {
  const picked = pickAgents(agents, names);
  const selection = modelIdToSelection(modelId);
  for (const name of names) {
    picked[name] = { ...picked[name], model: { id: selection } };
  }
  return picked;
}

export const SPECIALIST_AGENT_NAMES = SPECIALIST_AGENT_FILES.map((f) => f.replace(/\.md$/, ""));
