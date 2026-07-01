import { join } from "node:path";
import { findProjectRoot } from "../project/root.js";

export function goalsMdPath(cwd: string): string {
  return join(findProjectRoot(cwd), "harness/memory/goals.md");
}
