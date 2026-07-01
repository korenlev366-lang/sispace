import { selectReasoningEffort } from "../sdk/reasoning-effort.js";

/**
 * Common imperative verbs used to detect multi-action requests.
 */
const IMPERATIVE_VERBS = [
  "create",
  "build",
  "implement",
  "write",
  "add",
  "update",
  "modify",
  "remove",
  "delete",
  "fix",
  "refactor",
  "rename",
  "move",
  "copy",
  "install",
  "configure",
  "deploy",
  "run",
  "test",
  "check",
  "verify",
  "validate",
  "fetch",
  "read",
  "open",
  "close",
  "start",
  "stop",
  "restart",
  "generate",
  "convert",
  "transform",
  "merge",
  "split",
  "extract",
  "replace",
  "search",
  "find",
  "show",
  "list",
  "connect",
  "disconnect",
  "export",
  "import",
  "compile",
  "lint",
  "format",
  "publish",
  "release",
  "tag",
  "commit",
  "push",
  "pull",
  "rebase",
  "clean",
  "reset",
  "undo",
  "revert",
  "upgrade",
  "downgrade",
  "enable",
  "disable",
  "mount",
  "unmount",
  "link",
  "unlink",
  "register",
  "unregister",
  "subscribe",
  "unsubscribe",
  "approve",
  "reject",
  "review",
  "document",
  "setup",
  "initialize",
  "parse",
  "render",
  "log",
  "patch",
  "debug",
  "trace",
  "scroll",
  "select",
  "choose",
  "sort",
  "filter",
  "extend",
  "wrap",
  "unroll",
  "load",
  "save",
  "restore",
  "backup",
  "sync",
  "migrate",
  "connect",
  "disconnect",
  "send",
  "receive",
  "confirm",
  "cancel",
  "retry",
  "skip",
  "swap",
  "replace",
  "insert",
  "append",
  "prepend",
  "encrypt",
  "decrypt",
  "encode",
  "decode",
  "compress",
  "decompress",
  "zip",
  "unzip",
  "patch",
  "diff",
  "normalize",
  "deduplicate",
  "transpile",
  "bundle",
  "minify",
  "obfuscate",
  "scaffold",
  "seed",
  "populate",
  "purge",
  "evaluate",
  "assess",
  "compare",
  "contrast",
  "analyze",
  "organize",
  "sort",
  "assign",
  "schedule",
  "trigger",
  "launch",
  "init",
  "bootstrap",
  "resolve",
  "register",
  "authenticate",
  "authorize",
  "grant",
  "revoke",
  "lock",
  "unlock",
  "freeze",
  "thaw",
  "suspend",
  "resume",
  "inspect",
  "dump",
  "reload",
  "harden",
  "audit",
  "instrument",
  "monitor",
  "alert",
  "log",
  "measure",
  "probe",
  "prefetch",
  "cache",
  "invalidate",
  "expire",
  "compile",
  "interpret",
  "lex",
  "parse",
  "serialize",
  "deserialize",
  "wrap",
  "unwrap",
  "box",
  "unbox",
  "promote",
  "demote",
  "scale",
  "shard",
  "replicate",
  "redistribute",
  "rebalance",
  "defrag",
  "compact",
  "tune",
  "optimize",
  "instrument",
  "profile",
  "benchmark",
  "escalate",
  "de-escalate",
  "fuzz",
  "fuzz",
  "verify",
];

/**
 * Regex matching a file reference: either a path containing "/" or a filename
 * ending in .ts or .rs (with optional leading ./).
 */
const FILE_REF_RE = /\b(?:\.\/)?[a-zA-Z0-9_./-]+(?:\.(?:ts|rs)|[a-zA-Z0-9_./-]*\/[a-zA-Z0-9_./-]+)\b/g;

/**
 * Regex matching the start of an imperative verb (word boundary + lowercase verb).
 * Allows sentence start, or after punctuation/newline.
 */
function countImperativeVerbs(msg: string): number {
  const lower = msg.toLowerCase();
  const words = lower.split(/[\s,;:!?]+/).filter(Boolean);
  let count = 0;
  for (const w of words) {
    // Strip trailing punctuation for matching
    const clean = w.replace(/[^a-z]/g, "");
    if (IMPERATIVE_VERBS.includes(clean)) {
      count++;
    }
  }
  return count;
}

/**
 * Check if the message contains a numbered list (e.g. "1.", "2.") or bulleted
 * list (e.g. "- ", "* ").
 */
function hasList(msg: string): boolean {
  // Match lines starting with numbers, dashes, or asterisks
  return /(?:^|\n)\s*(?:[\d]+[.)]\s|[-*+]\s)/m.test(msg);
}

/**
 * Check if the message contains multi-step connective phrases.
 */
function hasMultiStepPhrases(msg: string): boolean {
  const lower = msg.toLowerCase();
  return (
    lower.includes("and then") ||
    lower.includes("after that") ||
    lower.includes("also") // "also" on its own is quite broad, but requested
  );
}

/**
 * Count distinct file references (paths or .ts/.rs filenames).
 */
function countFileRefs(msg: string): number {
  const matches = msg.match(FILE_REF_RE);
  if (!matches) return 0;
  // Deduplicate
  const unique = new Set(matches.map((m) => m.replace(/^\.\//, "")));
  return unique.size;
}

/**
 * Determine whether a user message should be decomposed into sub-agents
 * for parallel or sequential execution.
 *
 * Returns `true` only if BOTH conditions are met:
 * 1. The reasoning effort (from `selectReasoningEffort`) is `"high"` or `"xhigh"`.
 * 2. The message contains multiple distinct actions, detected by any of:
 *    - 2+ imperative verbs
 *    - A numbered or bulleted list
 *    - The phrases "and then", "after that", or "also"
 *    - 2+ distinct file references (paths or .ts/.rs filenames)
 *
 * @returns `true` if the message should be decomposed.
 */
export function shouldDecompose(userMessage: string): boolean {
  // Condition 1: reasoning effort must be high or xhigh
  const { effort } = selectReasoningEffort(userMessage);
  if (effort !== "high" && effort !== "xhigh") {
    return false;
  }

  // Condition 2: detect multiple distinct actions
  const hasMultipleVerbs = countImperativeVerbs(userMessage) >= 2;
  const hasListContent = hasList(userMessage);
  const hasMultiStep = hasMultiStepPhrases(userMessage);
  const hasEnoughFileRefs = countFileRefs(userMessage) >= 2;

  if (hasMultipleVerbs || hasListContent || hasMultiStep || hasEnoughFileRefs) {
    return true;
  }

  return false;
}
