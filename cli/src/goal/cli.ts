import { loadActiveGoal, loadActiveGoalIncludingStale, persistNewGoal } from "./persist.js";
import { isGoalStale } from "./stale.js";
import { parseGoalSetArgs } from "./parse-cli.js";
import { formatGoalStatusInline } from "./status.js";
import type { ActiveGoal } from "./types.js";

type GlobalGoal = { __cursorsiActiveGoal?: ActiveGoal };

export function setActiveGoalGlobal(goal: ActiveGoal | undefined): void {
  (globalThis as GlobalGoal).__cursorsiActiveGoal = goal;
}

export function getActiveGoalGlobal(): ActiveGoal | undefined {
  return (globalThis as GlobalGoal).__cursorsiActiveGoal;
}

export async function runGoalCli(argv: string[], cwd: string): Promise<number> {
  const sub = argv[0]?.toLowerCase();
  if (sub === "set") {
    const input = parseGoalSetArgs(argv);
    if (!input) {
      console.error(
        'Usage: cursorsi goal set "description" --verify "sh verify.sh" [--max 10]',
      );
      return 1;
    }
    const goal = persistNewGoal(cwd, input);
    setActiveGoalGlobal(goal);
    console.log(`Goal ${goal.id} set (verify loop, max ${goal.maxIterations})`);
    console.log(formatGoalStatusInline(goal));
    return 0;
  }

  if (sub === "status" || sub === "list") {
    const goal =
      getActiveGoalGlobal() ??
      loadActiveGoal(cwd) ??
      loadActiveGoalIncludingStale(cwd);
    const stale = goal ? isGoalStale(goal) : false;
    console.log(formatGoalStatusInline(goal ?? undefined, { stale }));
    return 0;
  }

  console.error("Usage: cursorsi goal set|status|list");
  return 1;
}
