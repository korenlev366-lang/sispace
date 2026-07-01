import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

/** Walk up from cwd until harness post-task-chain dist is found. */
export function findProjectRoot(startCwd: string): string {
  let dir = startCwd;
  for (;;) {
    const chain = join(dir, "harness/scripts/dist/post-task-chain.js");
    if (existsSync(chain)) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return startCwd;
    }
    dir = parent;
  }
}
