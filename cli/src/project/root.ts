import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

function isProjectRoot(dir: string): boolean {
  return (
    existsSync(join(dir, "harness/scripts/dist/post-task-chain.js")) ||
    existsSync(join(dir, "config/sispace.yaml")) ||
    existsSync(join(dir, ".cursorsi"))
  );
}

/** Walk up from cwd until a cursorsi/sispace project marker is found. */
export function findProjectRoot(startCwd: string): string {
  let dir = startCwd;
  for (;;) {
    if (isProjectRoot(dir)) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return startCwd;
    }
    dir = parent;
  }
}
