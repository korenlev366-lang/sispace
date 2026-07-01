import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { reconstructTranscript, estimateOutputTokens, resolveHarnessLib } from "./pipeline-lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const defaultRoot = path.resolve(here, "..");

export async function runReflectChain(body, emit) {
  const taskId = body.taskId ?? "";
  const root = body.projectRoot ?? defaultRoot;
  const sessionId = body.sessionId ?? taskId;
  const generationId = body.generationId ?? `${taskId}-${Date.now()}`;

  emit({ type: "reflect_start", taskId, sessionId, generationId });

  const pathsMod = await import(pathToFileURL(path.join(resolveHarnessLib(), "paths.js")).href);
  const paths = pathsMod.resolvePaths(root);

  if (pathsMod.generationAlreadyLogged(paths.chainLog, generationId)) {
    emit({ type: "reflect_duplicate", taskId, generationId, status: "duplicate" });
    emit({ type: "reflect_done", taskId, status: "duplicate", promoteToLearned: false });
    return;
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sispace-transcript-"));
  const transcriptPath = path.join(tmpDir, `${taskId}.txt`);
  fs.writeFileSync(transcriptPath, reconstructTranscript(body.messages ?? []), "utf8");

  emit({
    type: "reflect_done",
    taskId,
    status: "stub",
    promoteToLearned: false,
    reflectionExcerpt: reconstructTranscript(body.messages ?? []).slice(0, 500),
    gradeExcerpt: "",
    rolloutEntry: "",
  });
}
