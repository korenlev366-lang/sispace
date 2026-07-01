import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { findProjectRoot } from "../project/root.js";
import type { CliSession } from "../session/types.js";
import {
  estimateOutputTokens,
  reconstructTranscript,
  sessionHasReflectableContent,
} from "./transcript.js";

export interface ReflectRunResult {
  ok: boolean;
  message: string;
  timedOut?: boolean;
}

const REFLECT_TIMEOUT_MS = 300_000;
const SCRIPT_PARTS = ["invoke", "-chain", ".sh"];

export interface SpawnChainResult {
  launched: boolean;
  skipped?: string;
  generationId?: string;
  exitCode?: number | "timeout";
}

function reflectPrep(session: CliSession) {
  const projectRoot = findProjectRoot(session.cwd);
  const scriptPath = join(projectRoot, "scripts", SCRIPT_PARTS.join(""));
  const tmpBase = join(tmpdir(), `cursorsi-reflect-${session.id}-${Date.now()}`);
  mkdirSync(tmpBase, { recursive: true });
  const transcriptPath = join(tmpBase, "transcript.txt");
  writeFileSync(transcriptPath, reconstructTranscript(session), "utf8");
  const sessionId = session.cursorAgentId ?? session.id;
  const generationId = `cursorsi-${session.id}-${Date.now()}`;
  const outputTokens = estimateOutputTokens(session);
  return {
    projectRoot,
    tmpBase,
    generationId,
    argv: [
      scriptPath,
      projectRoot,
      sessionId,
      generationId,
      String(outputTokens),
      transcriptPath,
    ],
  };
}

export function launchReflectChain(opts: {
  session: CliSession;
  background: boolean;
}): Promise<SpawnChainResult> | SpawnChainResult {
  if (!sessionHasReflectableContent(opts.session)) {
    return opts.background
      ? { launched: false, skipped: "no_reflectable_content" }
      : Promise.resolve({ launched: false, skipped: "no_reflectable_content" });
  }
  const prep = reflectPrep(opts.session);
  if (opts.background) {
    const child = spawn("sh", prep.argv, {
      cwd: prep.projectRoot,
      stdio: "ignore",
      detached: true,
    });
    child.unref();
    return { launched: true, generationId: prep.generationId };
  }
  return new Promise<SpawnChainResult>((resolve) => {
    const child = spawn("sh", prep.argv, {
      cwd: prep.projectRoot,
      stdio: "ignore",
    });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      try {
        rmSync(prep.tmpBase, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
      resolve({ launched: true, generationId: prep.generationId, exitCode: "timeout" });
    }, REFLECT_TIMEOUT_MS);
    child.on("error", () => {
      clearTimeout(timer);
      try {
        rmSync(prep.tmpBase, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
      resolve({ launched: true, generationId: prep.generationId, exitCode: 1 });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      try {
        rmSync(prep.tmpBase, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
      resolve({
        launched: true,
        generationId: prep.generationId,
        exitCode: code ?? 1,
      });
    });
  });
}

export const spawnPostTaskChain = launchReflectChain;

/**
 * Manual /reflect — waits for invoke-chain (foreground).
 */
export async function runHarnessReflect(
  session: CliSession,
): Promise<ReflectRunResult> {
  const result = await launchReflectChain({ session, background: false });

  if (!result.launched) {
    return {
      ok: false,
      message:
        result.skipped === "no_reflectable_content"
          ? "Nothing to reflect — session has no user/agent messages yet."
          : "Reflection skipped.",
    };
  }

  if (result.exitCode === "timeout") {
    return {
      ok: false,
      timedOut: true,
      message: `Reflection timed out after ${REFLECT_TIMEOUT_MS / 1000}s.`,
    };
  }

  if (result.exitCode !== 0) {
    return {
      ok: false,
      message: `invoke-chain.sh exited with code ${result.exitCode ?? "?"}.`,
    };
  }

  return {
    ok: true,
    message:
      "Reflection complete — see harness/reports/latest-reflection.md (and latest-grade.md if graded).",
  };
}
