/**
 * Tool output compression — reduces token burn from large tool results
 * before they get appended to the conversation history.
 *
 * Stage 2 of the compressor pipeline.
 */

export interface CompressOptions {
  /** Keywords from the last user message, for read_file relevance matching. */
  keywords?: string[];
  /** File path being read (if known), for extension-aware compression limits. */
  filePath?: string;
}

/**
 * Strip ANSI escape codes (CSI sequences like \x1b[...m).
 */
function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[\d*(?:;\d+)*[a-zA-Z]/g, "");
}

/**
 * Deduplicate consecutive identical lines, replacing with [repeated N times].
 */
function dedupLines(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const current = lines[i];
    let count = 1;
    while (i + count < lines.length && lines[i + count] === current) {
      count++;
    }
    if (count === 1) {
      out.push(current);
    } else if (count === 2) {
      out.push(current, current);
    } else {
      out.push(current, `[repeated ${count} times]`);
    }
    i += count;
  }
  return out.join("\n");
}

/**
 * Count total lines in a string.
 */
function lineCount(text: string): number {
  return text.split("\n").length;
}

// ── Per-tool compressors ──────────────────────────────────────────────────

/** Extensions that qualify for expanded source-code compression limits. */
const SOURCE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".rs", ".json", ".yaml", ".sh",
]);

/** Character limit for source code / script files. */
const SOURCE_FILE_LIMIT = 15_000;

/** Fallback line count for source files that exceed the 15k limit. */
const SOURCE_FALLBACK_LINES = 400;

/** Default character limit for plain-text / unknown files. */
const DEFAULT_FILE_LIMIT = 3000;

/** Default fallback line count for plain-text files. */
const DEFAULT_FALLBACK_LINES = 100;

/**
 * Determine whether a file path indicates a source-code / script file
 * that should receive the elevated compression ceiling.
 */
function isSourceFile(filePath: string | undefined): boolean {
  if (!filePath) return false;
  const lower = filePath.toLowerCase();
  for (const ext of SOURCE_EXTENSIONS) {
    if (lower.endsWith(ext)) return true;
  }
  return false;
}

function compressReadFile(raw: string, opts: CompressOptions): string {
  const isSource = isSourceFile(opts.filePath);
  const MAX_CHARS = isSource ? SOURCE_FILE_LIMIT : DEFAULT_FILE_LIMIT;
  const FALLBACK_LINES = isSource ? SOURCE_FALLBACK_LINES : DEFAULT_FALLBACK_LINES;
  if (raw.length <= MAX_CHARS) return raw;

  const lines = raw.split("\n");
  const originalLines = lines.length;

  // Try keyword matching first
  if (opts.keywords && opts.keywords.length > 0) {
    const kwLower = opts.keywords.map((k) => k.toLowerCase());
    const matchedLineIndices = new Set<number>();

    for (let i = 0; i < lines.length; i++) {
      const lower = lines[i].toLowerCase();
      for (const kw of kwLower) {
        if (lower.includes(kw)) {
          // Keep ±5 lines around each match
          for (let j = Math.max(0, i - 5); j <= Math.min(lines.length - 1, i + 5); j++) {
            matchedLineIndices.add(j);
          }
          break;
        }
      }
    }

    if (matchedLineIndices.size > 0) {
      const sorted = [...matchedLineIndices].sort((a, b) => a - b);
      const kept: string[] = [];
      for (const idx of sorted) {
        kept.push(lines[idx]);
      }
      let result = kept.join("\n");
      if (result.length > MAX_CHARS) {
        result = result.slice(0, MAX_CHARS);
      }
      const keptLines = kept.length;
      return `${result}\n[truncated — ${originalLines} lines total, showing ${keptLines} relevant lines]`;
    }
  }

  // Fallback: keep first N lines, cap at MAX_CHARS
  const firstN = lines.slice(0, FALLBACK_LINES);
  let result = firstN.join("\n");
  if (result.length > MAX_CHARS) {
    result = result.slice(0, MAX_CHARS);
  }
  const keptLines = Math.min(FALLBACK_LINES, result.split("\n").length);
  return `${result}\n[truncated — ${originalLines} lines total, showing first ${keptLines} lines]`;
}

function compressBash(raw: string): string {
  // 1. Strip ANSI
  let text = stripAnsi(raw);

  // 2. Deduplicate consecutive identical lines
  text = dedupLines(text);

  // 3. Always keep lines with important keywords
  const IMPORTANT_RE = /\b(error|warning|failed|panic|at line|exception)\b/i;
  const lines = text.split("\n");
  const importantLines = new Set<number>();
  for (let i = 0; i < lines.length; i++) {
    if (IMPORTANT_RE.test(lines[i])) {
      importantLines.add(i);
    }
  }

  const MAX_CHARS = 1500;
  if (text.length <= MAX_CHARS) {
    // Even if under limit, still ensure important lines are present (they already are)
    return text;
  }

  const head = text.slice(0, 750);
  const tail = text.slice(-750);

  // Find omitted line count
  const headLines = head.split("\n").length;
  const tailLines = tail.split("\n").length;
  const totalLines = lines.length;
  const omitted = totalLines - headLines - tailLines;

  let middle = "";
  if (omitted > 0) {
    middle = `\n[... ${omitted} lines omitted ...]\n`;
  }

  // Ensure important lines from the middle are included
  const extraImportant: string[] = [];
  for (const idx of importantLines) {
    if (idx >= headLines && idx < totalLines - tailLines) {
      extraImportant.push(lines[idx]);
    }
  }

  let result = head;
  if (extraImportant.length > 0) {
    result += "\n[important lines from omitted section:]\n";
    result += extraImportant.join("\n");
  }
  result += middle;
  result += tail;

  return result;
}

function compressListDir(raw: string): string {
  const lines = raw.split("\n").filter((l) => l.trim() !== "");

  // Strip file sizes, dates, permissions — keep filenames only
  // Format is: "filename\tkind\tsize" or "filename\t?"
  const names = lines.map((line) => {
    const parts = line.split("\t");
    return parts[0] ?? line;
  });

  if (names.length <= 50) {
    return names.join("\n") || "(empty directory)";
  }

  const first25 = names.slice(0, 25);
  const last25 = names.slice(-25);
  const omitted = names.length - 50;

  return [
    ...first25,
    `[... ${omitted} more entries ...]`,
    ...last25,
  ].join("\n");
}

function compressWebFetch(raw: string): string {
  // webFetch already applies smart token-budget truncation with code extraction
  // and structural prioritisation — pass through to avoid double-truncation.
  return raw;
}

function compressSearchFiles(raw: string): string {
  const lines = raw.split("\n").filter((l) => l.trim() !== "");
  if (lines.length <= 30) return raw;

  const first30 = lines.slice(0, 30);
  const omitted = lines.length - 30;
  return [...first30, `[... ${omitted} more matches]`].join("\n");
}

function compressObsidianRead(raw: string): string {
  const MAX_CHARS = 2000;
  if (raw.length <= MAX_CHARS) return raw;
  return `${raw.slice(0, MAX_CHARS)}\n[truncated]`;
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Compress a tool's raw output before it enters conversation history.
 *
 * @param toolName   The tool that produced the output
 * @param rawOutput  The raw string result from the tool
 * @param opts       Compression options (keywords, etc.)
 * @returns          Compressed (or original) output string
 */
export function compressToolOutput(
  toolName: string,
  rawOutput: string,
  opts: CompressOptions = {},
): string {
  switch (toolName) {
    case "read_file":
      return compressReadFile(rawOutput, opts);
    case "execute_bash":
      return compressBash(rawOutput);
    case "list_directory":
      return compressListDir(rawOutput);
    case "web_fetch":
      return compressWebFetch(rawOutput);
    case "search_files":
      return compressSearchFiles(rawOutput);
    case "obsidian_read":
      return compressObsidianRead(rawOutput);
    default:
      // All other tools: pass through unchanged
      return rawOutput;
  }
}

/**
 * Create a 1-line summary of a tool result for history compaction.
 * Format: [{tool_name}: {first 80 chars of result}...]
 */
export function summarizeToolResult(toolName: string, result: string): string {
  const oneLine = result.replace(/\s+/g, " ").trim();
  const preview = oneLine.length <= 80 ? oneLine : `${oneLine.slice(0, 80)}…`;
  return `[${toolName}: ${preview}]`;
}
