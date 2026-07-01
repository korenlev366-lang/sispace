import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { tokenFromEnv } from "../sdk/session-agent.js";
import { findProjectRoot } from "../project/root.js";
import type { CliSession } from "../session/types.js";

export interface GradeRunResult {
  ok: boolean;
  message: string;
}

async function importHarness<T>(projectRoot: string, rel: string): Promise<T> {
  const href = pathToFileURL(
    join(projectRoot, "harness/scripts/dist/lib", rel),
  ).href;
  return import(href) as Promise<T>;
}

function readReport(projectRoot: string, name: string): string {
  const p = join(projectRoot, "harness/reports", name);
  if (!existsSync(p)) {
    return "";
  }
  return readFileSync(p, "utf8");
}

/**
 * Grade the latest reflection in-process (grading subagent only).
 */
export async function runHarnessGrade(
  session: CliSession,
): Promise<GradeRunResult> {
  const projectRoot = findProjectRoot(session.cwd);
  const token = tokenFromEnv();
  if (!token) {
    return {
      ok: false,
      message: "No Cursor auth token in environment.",
    };
  }

  const reflectionMd = readReport(projectRoot, "latest-reflection.md");
  if (!reflectionMd.trim()) {
    return {
      ok: false,
      message:
        "No latest-reflection.md. Run /reflect first or complete a session with reflection.",
    };
  }

  try {
    const { loadHarnessAgents } = await importHarness<{
      loadHarnessAgents: (root: string) => Record<string, unknown>;
    }>(projectRoot, "agent-definitions.js");

    const { createHarnessOrchestrator, dispatchToSubagent, runResultPayload } =
      await importHarness<{
        createHarnessOrchestrator: (opts: {
          apiKey: string;
          projectRoot: string;
          orchestratorModel?: string;
          subagentModel?: string;
          agents: Record<string, unknown>;
          name?: string;
        }) => Promise<{ send: (m: string) => Promise<{ stream: () => AsyncIterable<unknown>; wait: () => Promise<{ status: string; result?: string; id: string }> }> }>;
        dispatchToSubagent: (
          orch: unknown,
          name: string,
          prompt: string,
        ) => Promise<{ status: string; result?: string; id: string }>;
        runResultPayload: (run: { result?: string }) => string;
      }>(projectRoot, "harness-orchestrator.js");

    const { buildGradingSubagentInput, parseGradeJson, fallbackReflection } =
      await importHarness<{
        buildGradingSubagentInput: (reflection: unknown) => string;
        parseGradeJson: (raw: string) => { grade: unknown };
        fallbackReflection: (
          sessionId: string,
          tokens: number,
          note: string,
        ) => unknown;
      }>(projectRoot, "prompts.js");

    const { resolvePaths, readText } = await importHarness<{
      resolvePaths: (root: string) => { latestGrade: string };
      readText: (p: string) => string;
    }>(projectRoot, "paths.js");

    const { writeGradeReport } = await importHarness<{
      writeGradeReport: (
        paths: { latestGrade: string },
        grade: unknown,
        sessionId: string,
      ) => void;
    }>(projectRoot, "ledger.js");

    const agents = loadHarnessAgents(projectRoot);
    if (!agents["harness-grading-agent"]) {
      return { ok: false, message: "harness-grading-agent definition missing" };
    }

    const paths = resolvePaths(projectRoot);
    const baseReflection = fallbackReflection(
      session.id,
      1000,
      "manual /grade from CLI",
    ) as Record<string, unknown>;
    const reflection = {
      ...baseReflection,
      outcome: reflectionMd.slice(0, 8000),
      markdown: reflectionMd,
      reasoningTrace: readText(
        join(projectRoot, "harness/memory/reasoning-patterns.md"),
      ).slice(0, 2000),
    };

    const orchestrator = await createHarnessOrchestrator({
      apiKey: token,
      projectRoot,
      orchestratorModel: session.modelId,
      subagentModel: session.subagentModelId ?? session.modelId,
      agents,
      name: "cursorsi-grade",
    });

    const gradingRun = await dispatchToSubagent(
      orchestrator,
      "harness-grading-agent",
      buildGradingSubagentInput(reflection),
    );

    if (gradingRun.status === "error") {
      return {
        ok: false,
        message: `Grading subagent error (run ${gradingRun.id})`,
      };
    }

    const gradeRaw = runResultPayload(gradingRun);
    let grade: unknown = null;
    try {
      ({ grade } = parseGradeJson(gradeRaw));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, message: `Grade parse failed: ${msg}` };
    }

    writeGradeReport(paths, grade, session.id);

    if (!grade) {
      return {
        ok: true,
        message: "Grading complete: no proposal to grade (grade null).",
      };
    }

    const decision =
      grade && typeof grade === "object" && "decision" in grade
        ? String((grade as { decision: string }).decision)
        : "unknown";

    return {
      ok: true,
      message: `Grade written to harness/reports/latest-grade.md — decision: ${decision}`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, message: `Grade failed: ${msg}` };
  }
}
