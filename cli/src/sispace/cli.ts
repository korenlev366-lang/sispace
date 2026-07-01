import { launchKanban } from "./kanban.js";
import { createSwarmGraph } from "./swarm.js";

export async function runKanbanCli(cwd: string): Promise<number> {
  const result = launchKanban(cwd);
  if (!result.ok) {
    console.error(`cursorsi kanban: ${result.error}`);
    return 1;
  }
  console.log(`Launched SISpace kanban (${result.binary})`);
  return 0;
}

export async function runSwarmCli(argv: string[], cwd: string): Promise<number> {
  const rootId = argv[0]?.trim();
  if (!rootId) {
    console.error("Usage: cursorsi swarm <root-task-id> [--workers N]");
    return 1;
  }

  let workers = 3;
  for (let i = 1; i < argv.length; i += 1) {
    if (argv[i] === "--workers" && argv[i + 1]) {
      const n = Number.parseInt(argv[i + 1], 10);
      if (Number.isFinite(n) && n >= 3) {
        workers = n;
      }
      i += 1;
    }
  }

  const result = createSwarmGraph(rootId, workers);
  if (!result.ok) {
    console.error(`cursorsi swarm: ${result.error}`);
    return 1;
  }

  console.log(`Swarm created for root ${result.rootId}`);
  console.log(`  workers: ${result.workers?.length ?? 0}`);
  if (result.verifier) {
    console.log(`  verifier: ${result.verifier.task_id} (${result.verifier.status})`);
  }
  if (result.synthesizer) {
    console.log(
      `  synthesizer: ${result.synthesizer.task_id} (${result.synthesizer.status})`,
    );
  }
  return 0;
}
