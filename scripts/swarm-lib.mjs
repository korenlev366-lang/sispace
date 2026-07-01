import path from "node:path";
import { resolveHarnessLib } from "./pipeline-lib.mjs";

export async function runSwarmCreate(body, emit) {
  const libDir = resolveHarnessLib();
  const workflow = await import(path.join(libDir, "workflow-sdk.js"));

  const token = body.token ?? "";
  const projectRootPath = body.projectRoot ?? process.cwd();
  const workers = body.workers ?? [];

  if (!token) {
    emit({
      type: "swarm_dispatch_done",
      rootId: body.rootId,
      status: "skipped",
      error: "cursor credential not set",
    });
    return;
  }

  const subtasks = workers.map((w) => ({
    id: w.taskId,
    prompt: w.prompt,
  }));

  emit({
    type: "swarm_dispatch_start",
    rootId: body.rootId,
    workerCount: subtasks.length,
  });

  const results = await workflow.runWorkflowSubtasksParallel(
    { apiKey: token, projectRoot: projectRootPath },
    subtasks,
  );

  for (const result of results) {
    emit({
      type: "worker_done",
      rootId: body.rootId,
      taskId: result.id,
      status: result.status,
      runId: result.runId,
      error: result.error ?? null,
    });
  }

  emit({
    type: "swarm_dispatch_done",
    rootId: body.rootId,
    status: "ok",
  });
}
