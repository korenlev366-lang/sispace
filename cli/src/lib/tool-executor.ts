import { execSync, spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { readProcessVar } from "../compression/env-read.js";
import { compressToolOutput } from "../compression/tool-compressor.js";

const READ_FILE_LIMIT = 50_000;
const BASH_TIMEOUT_MS = 30_000;
const DEFAULT_OBSIDIAN_API = "http://127.0.0.1:27123";

/** Whether setpriv --pdeathsig is available on this system (cached once). */
const hasSetpriv: boolean = (() => {
  try {
    const result = spawnSync("which", ["setpriv"], { encoding: "utf8", timeout: 2000 });
    return result.status === 0 && result.stdout.trim().length > 0;
  } catch {
    return false;
  }
})();

/** Persistent map of background process sessions keyed by user-assigned ID. */
const activeBackgroundSessions = new Map<
  string,
  { process: ChildProcess; pid: number | undefined; buffer: string[] }
>();

// ═══════════════════════════════════════════════════════════════════════
// Layer 3: Exit-signal cleanup — kill all background sessions on shutdown
// ═══════════════════════════════════════════════════════════════════════

/** Kill a process group by session entry. Negative pid targets the group. */
function killSessionGroup(entry: { process: ChildProcess; pid: number | undefined }): void {
  try {
    if (entry.pid !== undefined) {
      process.kill(-entry.pid, "SIGTERM");
    }
  } catch {
    // Process/group already dead — nothing to do.
  }
}

/** Iterate all active sessions and process-group-kill each one. */
function cleanupAllBackgroundSessions(): void {
  for (const [, session] of activeBackgroundSessions) {
    killSessionGroup(session);
    try {
      session.process.kill();
    } catch {
      // Fallback: direct kill if pid was never recorded.
    }
  }
  activeBackgroundSessions.clear();
}

// Register cleanup hooks.  These coexist with pane/mode.ts handlers because
// process.on() adds listeners; it does not replace existing ones.  On 'exit'
// only synchronous operations are allowed — process.kill() is synchronous.
process.on("exit", cleanupAllBackgroundSessions);
process.on("SIGINT", () => {
  cleanupAllBackgroundSessions();
  process.exit(0);
});
process.on("SIGTERM", () => {
  cleanupAllBackgroundSessions();
  process.exit(0);
});
process.on("SIGHUP", () => {
  cleanupAllBackgroundSessions();
  process.exit(0);
});

export interface ToolContext {
  cwd: string;
  obsidianAvailable: boolean;
  obsidianApiKey?: string;
  obsidianApiUrl?: string;
  openRouterApiKey?: string;
  /** Keywords extracted from the last user message, for read_file compression. */
  keywords?: string[];
}

function resolveInCwd(cwd: string, relPath: string): string {
  const resolved = resolve(cwd, relPath || ".");
  const root = resolve(cwd);
  if (resolved === root) {
    return resolved;
  }
  if (!resolved.startsWith(root + sep)) {
    throw new Error(`Path escapes workspace: ${relPath}`);
  }
  return resolved;
}

function encodeVaultPath(vaultRelative: string): string {
  return vaultRelative
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

/** Memory-Path Guard: returns true if the note belongs to harness long-term learning tracks. */
function isMemoryNote(vaultPath: string): boolean {
  const lower = vaultPath.toLowerCase();
  return (
    lower.includes("harness") ||
    lower.includes("lessons") ||
    lower.includes("heuristics") ||
    lower.includes("reasoning-patterns")
  );
}

function obsidianBase(ctx: ToolContext): string {
  return (ctx.obsidianApiUrl || DEFAULT_OBSIDIAN_API).replace(/\/$/, "");
}

function obsidianAuth(token: string): string {
  const t = token.trim();
  return t.toLowerCase().startsWith("bearer ") ? t : `Bearer ${t}`;
}

function truncate(text: string, max = 2000): string {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max)}… [truncated ${text.length - max} chars]`;
}

export function summarizeToolArgs(name: string, argsJson: string): string {
  try {
    const args = JSON.parse(argsJson) as Record<string, string>;
    if (name === "read_file" || name === "list_directory" || name === "view_file_outline" || name === "obsidian_read") {
      return args.path ?? "";
    }
    if (name === "write_file" || name === "edit_file") {
      return args.path ?? "";
    }
    if (name === "execute_bash") {
      const cmd = args.command ?? "";
      return cmd.length > 60 ? `${cmd.slice(0, 60)}…` : cmd;
    }
    if (name === "search_files") {
      return `${args.pattern ?? "*"}${args.directory ? ` in ${args.directory}` : ""}`;
    }
    if (name.startsWith("obsidian_")) {
      return args.query ?? args.path ?? "";
    }
    if (name === "web_search") {
      return args.query ?? "";
    }
    if (name === "web_fetch") {
      return args.url ?? "";
    }
    if (name === "read_image") {
      return args.path_or_url ?? "";
    }
    if (name === "mcp_lookup") {
      return `${args.type ?? ""}: ${args.name ?? ""}`;
    }
    if (name === "bg_spawn_process") {
      return `${args.id ?? "default"}: ${args.command ?? ""}`;
    }
    if (name === "bg_read_buffer") {
      return args.id ?? "default";
    }
  } catch {
    return argsJson.slice(0, 80);
  }
  return "";
}

export function summarizeToolResult(result: string): string {
  const oneLine = result.replace(/\s+/g, " ").trim();
  if (oneLine.length <= 80) {
    return oneLine;
  }
  return `${oneLine.slice(0, 80)}…`;
}

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> {
  try {
    let raw: string;
    let readFilePath: string | undefined;
    switch (name) {
      case "read_file": {
        const path = String(args.path ?? "");
        readFilePath = path;
        const full = resolveInCwd(ctx.cwd, path);
        let text = readFileSync(full, "utf8");
        if (text.length > READ_FILE_LIMIT) {
          text = `${text.slice(0, READ_FILE_LIMIT)}\n… [truncated at ${READ_FILE_LIMIT} chars]`;
        }
        raw = text;
        break;
      }
      case "write_file": {
        const path = String(args.path ?? "");
        const content = String(args.content ?? "");
        const full = resolveInCwd(ctx.cwd, path);
        writeFileSync(full, content, "utf8");
        raw = `Wrote ${content.length} bytes to ${path}`;
        break;
      }
      case "execute_bash": {
        const command = String(args.command ?? "");
        try {
          const out = execSync(command, {
            cwd: ctx.cwd,
            encoding: "utf8",
            timeout: BASH_TIMEOUT_MS,
            maxBuffer: 1024 * 1024,
            stdio: ["ignore", "pipe", "pipe"],
          });
          raw = out.trim() || "(no output)";
        } catch (err) {
          const e = err as { stdout?: string; stderr?: string; message?: string };
          const stdout = e.stdout?.trim() ?? "";
          const stderr = e.stderr?.trim() ?? "";
          const parts = [stdout, stderr, e.message].filter(Boolean);
          raw = parts.join("\n") || "command failed";
        }
        break;
      }
      case "list_directory": {
        const path = String(args.path ?? ".");
        const full = resolveInCwd(ctx.cwd, path);
        const entries = readdirSync(full);
        const lines = entries.map((entry) => {
          const entryPath = join(full, entry);
          try {
            const st = statSync(entryPath);
            const kind = st.isDirectory() ? "dir" : "file";
            return `${entry}\t${kind}\t${st.size}`;
          } catch {
            return `${entry}\t?`;
          }
        });
        raw = lines.join("\n") || "(empty directory)";
        break;
      }
      case "search_files": {
        const pattern = String(args.pattern ?? "*");
        const directory = String(args.directory ?? ".");
        const full = resolveInCwd(ctx.cwd, directory);
        const result = spawnSync("find", [full, "-name", pattern], {
          encoding: "utf8",
          maxBuffer: 512 * 1024,
        });
        if (result.error) {
          throw result.error;
        }
        const stdout = (result.stdout ?? "").trim();
        const stderr = (result.stderr ?? "").trim();
        if (result.status !== 0) {
          raw = stderr || stdout || `find exited ${result.status}`;
        } else {
          raw = stdout || "(no matches)";
        }
        break;
      }
      case "edit_file": {
        const path = String(args.path ?? "");
        const oldStr = String(args.old_str ?? "");
        const newStr = String(args.new_str ?? "");
        const full = resolveInCwd(ctx.cwd, path);
        const current = readFileSync(full, "utf8");

        // ── Fast-Path: exact string match ──────────────────────────────
        if (current.includes(oldStr)) {
          const updated = current.replace(oldStr, newStr);
          writeFileSync(full, updated, "utf8");
          raw = `Updated ${path}`;
          break;
        }

        // ── Recovery-Path: fuzzy line-healing ─────────────────────────
        // Normalize: trim leading/trailing whitespace, collapse
        // consecutive interior spaces/tabs into a single space.
        const normalizeLine = (line: string): string =>
          line.trim().replace(/[ \t]+/g, " ");

        const oldLines = oldStr.split(/\r?\n/);
        const oldNormalized = oldLines.map(normalizeLine).filter((l) => l.length > 0);

        if (oldNormalized.length === 0) {
          raw = `Error: old_str was empty after normalization in ${path}`;
          break;
        }

        // Detect line-ending for faithful reconstruction
        const lineEnding = current.includes("\r\n") ? "\r\n" : "\n";
        const fileLines = current.split(/\r?\n/);
        const fileNormalized = fileLines.map(normalizeLine);

        // Sliding-window scan for a unique fuzzy match
        const matches: Array<{ start: number; end: number }> = [];
        const N = oldNormalized.length;
        for (let i = 0; i <= fileNormalized.length - N; i++) {
          let match = true;
          for (let j = 0; j < N; j++) {
            if (fileNormalized[i + j] !== oldNormalized[j]) {
              match = false;
              break;
            }
          }
          if (match) {
            matches.push({ start: i, end: i + N });
          }
        }

        if (matches.length !== 1) {
          raw =
            `Error: old_str block could not be uniquely resolved in ${path}. ` +
            `Ensure your anchor code block matches the structural shape of the file.`;
          break;
        }

        // Splice newStr into the exact line range, preserving
        // un-mutated top and bottom chunks byte-for-byte.
        const { start, end } = matches[0];
        const top = fileLines.slice(0, start);
        const bottom = fileLines.slice(end);
        const updated = [...top, newStr, ...bottom].join(lineEnding);
        writeFileSync(full, updated, "utf8");
        raw = `Updated ${path} via fuzzy line alignment auto-repair`;
        break;
      }
      case "obsidian_read":
        raw = await obsidianRead(ctx, String(args.path ?? ""));
        break;
      case "obsidian_search":
        raw = await obsidianSearch(ctx, String(args.query ?? ""));
        break;
      case "obsidian_write":
        raw = await obsidianWrite(ctx, String(args.path ?? ""), String(args.content ?? ""));
        break;
      case "obsidian_append":
        raw = await obsidianAppend(ctx, String(args.path ?? ""), String(args.content ?? ""));
        break;
      case "web_search":
        raw = await webSearch(String(args.query ?? ""));
        break;
      case "web_fetch":
        raw = await webFetch(String(args.url ?? ""));
        break;
      case "read_image":
        raw = await readImage(String(args.path_or_url ?? ""), ctx);
        break;
      case "mcp_lookup":
        raw = mcpLookup(String(args.type ?? ""), String(args.name ?? ""));
        break;
      case "view_file_outline": {
        const path = String(args.path ?? "");
        const full = resolveInCwd(ctx.cwd, path);
        const content = readFileSync(full, "utf8");
        const lines = content.split(/\r?\n/);
        const outline: string[] = [];
        lines.forEach((line, index) => {
          if (/^\s*(export\s+)?(class|interface|struct|enum|trait|mod|type\s+\w+\s*=|function|async\s+function|fn\s+|pub\s+(fn|struct|enum|trait|mod)|const\s+\w+\s*=\s*(\([^)]*\)|async\s*\([^)]*\))\s*=>)/.test(line)) {
            outline.push(`[Line ${index + 1}] ${line.trim()}`);
          }
        });
        raw = outline.length > 0
          ? `Structural outline for ${path}:\n\n${outline.join("\n")}`
          : `No major code symbols or declarations identified in ${path}.`;
        break;
      }
      case "bg_spawn_process": {
        const id = String(args.id ?? "default");
        const command = String(args.command ?? "");
        // Clean up any stale session holding the same ID before overwriting
        if (activeBackgroundSessions.has(id)) {
          const stale = activeBackgroundSessions.get(id)!;
          killSessionGroup(stale);
          try {
            stale.process.kill();
          } catch {}
          activeBackgroundSessions.delete(id);
        }
        try {
          let child: ChildProcess;
          let pid: number | undefined;
          if (hasSetpriv) {
            // Layer 1: detached process group + kernel parent-death via setpriv.
            // setpriv --pdeathsig SIGKILL ensures the kernel kills this
            // process tree if cursorsi crashes without running cleanup handlers.
            child = spawn(
              "setpriv",
              ["--pdeathsig", "SIGKILL", "--", "sh", "-c", command],
              { cwd: ctx.cwd, detached: true },
            );
            pid = child.pid;
          } else {
            // Fallback: plain shell spawn without crash-cleanup guarantees.
            process.stderr.write(
              "cursorsi: setpriv not found — background crash-cleanup is unavailable\n",
            );
            child = spawn(command, { shell: true, cwd: ctx.cwd });
            pid = child.pid;
          }
          const outputBuffer: string[] = [];
          child.stdout?.on("data", (chunk) => outputBuffer.push(chunk.toString()));
          child.stderr?.on("data", (chunk) => outputBuffer.push(chunk.toString()));
          child.on("close", (code) => {
            outputBuffer.push(
              `\n[Process associated with session '${id}' exited with code: ${code}]`,
            );
          });
          activeBackgroundSessions.set(id, {
            process: child,
            pid,
            buffer: outputBuffer,
          });
          raw = `Successfully spawned background process loop for command: \`${command}\` under session ID: \`${id}\`. Use \`bg_read_buffer\` to progressively inspect streaming output logs.`;
        } catch (err: any) {
          raw = `Failed to spawn background process: ${err.message}`;
        }
        break;
      }
      case "bg_read_buffer": {
        const id = String(args.id ?? "default");
        const session = activeBackgroundSessions.get(id);
        if (!session) {
          raw = `Error: No active background process context discovered matching session ID: \`${id}\`.`;
          break;
        }
        // Destructively pull and clear the accumulated stream lines
        const lines = session.buffer.splice(0, session.buffer.length);
        raw = lines.length > 0 ? lines.join("") : `[No new stream output available for background session: ${id}]`;
        break;
      }
      default:
        return `Unknown tool: ${name}`;
    }

    // ── Stage 2: compress tool output before it enters history ──────────
    return compressToolOutput(name, raw, { keywords: ctx.keywords, filePath: readFilePath });
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// Path-weighted search scoring helpers
// ═══════════════════════════════════════════════════════════════════════

interface ObsidianSearchHit {
  filename?: string;
  score?: number;
  tags?: string[];
  matches?: Array<{ context?: string }>;
}

/**
 * Extract workspace context from cwd for path-weighted search ranking.
 * Collects file extensions (with leading dot, e.g. ".ts") and directory
 * path segments from the active working tree.
 */
function extractWorkspaceContext(cwd: string): {
  extensions: Set<string>;
  pathSegments: Set<string>;
} {
  const extensions = new Set<string>();
  const pathSegments = new Set<string>();

  // ── Extract path segments from cwd ────────────────────────────────
  const normalized = cwd.replace(/\/+$/, "");
  const segments = normalized.split("/").filter((s) => s.length > 0 && s !== ".");
  for (const seg of segments) {
    pathSegments.add(seg.toLowerCase());
  }

  // ── Shallow scan of cwd for file extensions ────────────────────────
  try {
    const topEntries = readdirSync(cwd);
    for (const entry of topEntries) {
      const dotIdx = entry.lastIndexOf(".");
      if (dotIdx > 0 && dotIdx < entry.length - 1) {
        extensions.add(entry.slice(dotIdx).toLowerCase());
      }
      // Recurse one level into non-hidden, non-node_modules dirs
      if (!entry.startsWith(".") && entry !== "node_modules") {
        const fullPath = join(cwd, entry);
        try {
          if (statSync(fullPath).isDirectory()) {
            const subEntries = readdirSync(fullPath);
            for (const sub of subEntries) {
              const subDot = sub.lastIndexOf(".");
              if (subDot > 0 && subDot < sub.length - 1) {
                extensions.add(sub.slice(subDot).toLowerCase());
              }
            }
          }
        } catch {
          // Permission or stat errors are non-critical
        }
      }
    }
  } catch {
    // cwd scan failure is non-critical — still have path segments
  }

  return { extensions, pathSegments };
}

/**
 * Compute a path-weighted relevance score for a single Obsidian search hit.
 *
 * Base score is 1.0 (or the API-provided score if available and > 0).
 * Bonuses are additive, applied at most once per category:
 *   +20%  — filename or tags contain a workspace file extension
 *   +30%  — filename or match context contains a cwd path segment (min 3 chars)
 */
function scoreSearchHit(
  hit: ObsidianSearchHit,
  extensions: Set<string>,
  pathSegments: Set<string>,
): number {
  // Start from the API's own relevance score when available, otherwise 1.0
  const apiScore = typeof hit.score === "number" && hit.score > 0 ? hit.score : 1.0;
  let score = apiScore;

  const filename = (hit.filename ?? "").toLowerCase();
  const tags = (hit.tags ?? []).map((t) => t.toLowerCase());
  const matchText =
    hit.matches?.map((m) => m.context ?? "").join(" ").toLowerCase() ?? "";

  // ── +20% extension bonus ───────────────────────────────────────────
  const tagAndTitle = [...tags, filename].join(" ");
  for (const ext of extensions) {
    if (tagAndTitle.includes(ext)) {
      score += 0.2;
      break; // apply once
    }
  }

  // ── +30% path-segment overlap bonus ────────────────────────────────
  const searchableText = `${filename} ${matchText}`;
  for (const seg of pathSegments) {
    if (seg.length >= 3 && searchableText.includes(seg)) {
      score += 0.3;
      break; // apply once
    }
  }

  return score;
}

async function obsidianSearch(ctx: ToolContext, query: string): Promise<string> {
  if (!ctx.obsidianAvailable || !ctx.obsidianApiKey) {
    return "Obsidian is not available (missing API key or server unreachable)";
  }

  // ── Stage 1: Extract active workspace context ──────────────────────
  const { extensions, pathSegments } = extractWorkspaceContext(ctx.cwd);

  // ── Stage 2: Execute baseline Obsidian REST API search ──────────────
  const params = new URLSearchParams({ query, contextLength: "100" });
  const url = `${obsidianBase(ctx)}/search/simple/?${params.toString()}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: obsidianAuth(ctx.obsidianApiKey),
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    return `obsidian search failed: ${response.status}`;
  }
  const data = (await response.json()) as ObsidianSearchHit[];
  if (!Array.isArray(data) || data.length === 0) {
    return "(no results)";
  }

  // ── Stage 3: Augmented path-weighted re-ranking ────────────────────
  const scored = data.map((hit) => ({
    hit,
    score: scoreSearchHit(hit, extensions, pathSegments),
  }));

  // Sort descending by computed score
  scored.sort((a, b) => b.score - a.score);

  // ── Stage 4: Format top-N results preserving original API contract ─
  return scored
    .slice(0, 5)
    .map(({ hit }) => {
      const excerpt = hit.matches?.[0]?.context?.trim() ?? "";
      return `- ${hit.filename ?? "unknown"}: ${excerpt}`;
    })
    .join("\n");
}

async function obsidianRead(ctx: ToolContext, vaultPath: string): Promise<string> {
  if (!ctx.obsidianAvailable || !ctx.obsidianApiKey) {
    return "Obsidian is not available (missing API key or server unreachable)";
  }
  const url = `${obsidianBase(ctx)}/vault/${encodeVaultPath(vaultPath)}`;
  const response = await fetch(url, {
    method: "GET",
    headers: { Authorization: obsidianAuth(ctx.obsidianApiKey) },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    return `obsidian read failed: ${response.status}`;
  }
  return truncate(await response.text(), READ_FILE_LIMIT);
}

async function obsidianWrite(ctx: ToolContext, vaultPath: string, content: string): Promise<string> {
  if (!ctx.obsidianAvailable || !ctx.obsidianApiKey) {
    return "Obsidian is not available (missing API key or server unreachable)";
  }

  // ── Schema Gate: Memory notes require valid YAML frontmatter ──────────
  if (isMemoryNote(vaultPath)) {
    const trimmed = content.trimStart();
    if (trimmed.startsWith("---")) {
      const afterFirstDelim = trimmed.slice(3);
      const closingIdx = afterFirstDelim.indexOf("\n---");
      if (closingIdx === -1) {
        return (
          "Error: Obsidian write rejected. Memory files require a valid YAML frontmatter block containing 'status' and 'failure_mode' fields. " +
          "Unclosed frontmatter delimiter. Correct your formatting and retry."
        );
      }
      const frontmatterBlock = afterFirstDelim.slice(0, closingIdx);
      const hasStatus = /^\s*status\s*:/m.test(frontmatterBlock);
      const hasFailureMode = /^\s*failure_mode\s*:/m.test(frontmatterBlock);
      if (!hasStatus || !hasFailureMode) {
        return (
          "Error: Obsidian write rejected. Memory files require a valid YAML frontmatter block containing 'status' and 'failure_mode' fields. " +
          "Correct your formatting and retry."
        );
      }
    } else {
      return (
        "Error: Obsidian write rejected. Memory files require a valid YAML frontmatter block containing 'status' and 'failure_mode' fields. " +
        "Content must start with '---'. Correct your formatting and retry."
      );
    }
  }

  const url = `${obsidianBase(ctx)}/vault/${encodeVaultPath(vaultPath)}`;
  const response = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: obsidianAuth(ctx.obsidianApiKey),
      "Content-Type": "text/markdown",
    },
    body: content,
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    return `obsidian write failed: ${response.status}`;
  }
  return `Wrote note ${vaultPath}`;
}

async function obsidianAppend(ctx: ToolContext, vaultPath: string, content: string): Promise<string> {
  if (!ctx.obsidianAvailable || !ctx.obsidianApiKey) {
    return "Obsidian is not available (missing API key or server unreachable)";
  }

  // ── Semantic Deduplication Gate: prevent bloat in memory notes ───────
  if (isMemoryNote(vaultPath)) {
    const normalized = content.trim();
    // Only guard non-empty content
    if (normalized.length > 0) {
      try {
        const readUrl = `${obsidianBase(ctx)}/vault/${encodeVaultPath(vaultPath)}`;
        const readResp = await fetch(readUrl, {
          method: "GET",
          headers: { Authorization: obsidianAuth(ctx.obsidianApiKey) },
          signal: AbortSignal.timeout(10_000),
        });
        if (readResp.ok) {
          const existing = await readResp.text();
          // Check if the normalized content already appears verbatim
          if (existing.includes(normalized)) {
            return `No-op: Content segment already exists in memory note ${vaultPath}. Bloat avoided.`;
          }
        }
        // File doesn't exist (non-200) → proceed with append to create/append
      } catch {
        // Network fallback: if GET fails, proceed with append conservatively
      }
    }
  }

  const url = `${obsidianBase(ctx)}/vault/${encodeVaultPath(vaultPath)}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: obsidianAuth(ctx.obsidianApiKey),
      "Content-Type": "text/markdown",
    },
    body: content,
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    return `obsidian append failed: ${response.status}`;
  }
  return `Appended to ${vaultPath}`;
}

// ---- Web search ----

async function webSearch(query: string): Promise<string> {
  const encoded = encodeURIComponent(query);

  // 1. Try DuckDuckGo Instant Answers API
  let instantAnswer = "";
  try {
    const iaUrl = `https://api.duckduckgo.com/?q=${encoded}&format=json&no_redirect=1`;
    const resp = await fetch(iaUrl, {
      signal: AbortSignal.timeout(5000),
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    if (resp.ok) {
      const data = (await resp.json()) as {
        AbstractText?: string;
        Answer?: string;
        Heading?: string;
        AbstractSource?: string;
        AbstractURL?: string;
      };
      if (data.AbstractText) {
        instantAnswer = `Instant Answer: ${data.AbstractText}`;
        if (data.Heading) {
          instantAnswer = `[${data.Heading}] ${instantAnswer}`;
        }
        if (data.AbstractURL) {
          instantAnswer += `\nSource: ${data.AbstractURL}`;
        }
      } else if (data.Answer) {
        instantAnswer = `Answer: ${data.Answer}`;
      }
    }
  } catch {
    // fall through to HTML search
  }

  // 2. Scrape HTML search results for top 5
  let htmlResults: string[] = [];
  try {
    const htmlUrl = `https://html.duckduckgo.com/html/?q=${encoded}`;
    const resp = await fetch(htmlUrl, {
      signal: AbortSignal.timeout(8000),
      headers: { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36" },
    });
    if (resp.ok) {
      const html = await resp.text();
      // Extract result blocks: <a class="result__a" href="...">title</a>
      // and sibling <a class="result__snippet">snippet</a>
      const linkRe = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
      const snippetRe = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;

      const links: Array<{ title: string; url: string }> = [];
      let m: RegExpExecArray | null;
      while ((m = linkRe.exec(html)) !== null) {
        let url = m[1];
        // DDG redirect URLs
        if (url.startsWith("//")) url = `https:${url}`;
        links.push({ title: stripHtml(m[2]).trim(), url });
      }

      const snippets: string[] = [];
      while ((m = snippetRe.exec(html)) !== null) {
        snippets.push(stripHtml(m[1]).trim());
      }

      const count = Math.min(5, links.length);
      for (let i = 0; i < count; i++) {
        const snippet = snippets[i] ?? "";
        htmlResults.push(
          `[${i + 1}] ${links[i].title}\n${links[i].url}\n${snippet}`,
        );
      }
    }
  } catch {
    // fall through
  }

  const parts: string[] = [];
  if (instantAnswer) {
    parts.push(instantAnswer, "");
  }
  if (htmlResults.length > 0) {
    parts.push(...htmlResults);
  } else {
    parts.push("(no search results found)");
  }

  return parts.join("\n");
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ---- Web fetch ----

/** Strip HTML tags and decode entities, preserving newline structure. */
function stripHtmlKeepNewlines(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/[ \t]+/g, " ")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .join("\n")
    .trim();
}

/** Sidebar / nav / footer boilerplate tokens to strip. */
const BOILERPLATE_RE =
  /\b(Sign\s*In|Login|Log\s*in|Cookie\s*Policy|All\s*Rights\s*Reserved|Privacy\s*Policy|Terms\s*of\s*Service|Terms\s*&\s*Conditions|Subscribe|Newsletter|Follow\s*us|Share\s*this|Tweet|Copyright\s*\d{4}|Powered\s*by|Back\s*to\s*top|Skip\s*to\s*content|Accept\s*All\s*Cookies|Manage\s*Preferences|Reject\s*All)\b/i;

/** Deduplicate consecutive identical non-empty lines, collapsing 3+ repeats. */
function dedupConsecutiveLines(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const current = lines[i];
    if (current.trim().length === 0) {
      out.push(current);
      i++;
      continue;
    }
    let count = 1;
    while (i + count < lines.length && lines[i + count] === current) {
      count++;
    }
    if (count === 1) {
      out.push(current);
    } else if (count === 2) {
      out.push(current, current);
    } else {
      out.push(current);
    }
    i += count;
  }
  return out.join("\n");
}

/** Detect and wrap code-like lines in markdown fenced blocks. */
function wrapCodeBlocks(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let inBlock = false;
  let blockLang = "";
  let blockLines: string[] = [];

  // Patterns that signal a code/terminal line
  const codeSignatures = [
    /^\s*(export\s+)?(async\s+)?function\s+\w+\s*\(/,  // function foo(
    /^\s*(public|private|protected|static|final|abstract|virtual)\s+/,  // access modifiers
    /^\s*(const|let|var)\s+\w+\s*[:=]/,  // const x: / const x =
    /^\s*import\s+[{\w]/,  // import { or import foo
    /^\s*from\s+\S+\s+import\s+/,  // from x import y
    /^\s*require\s*\(/,  // require(
    /^\s*(class|interface|type|enum|struct|impl|trait)\s+/,  // class Foo, interface Bar
    /^\s*#include\s*[<"]/,  // C includes
    /^\s*#define\s+/,  // C macros
    /^\s*def\s+\w+\s*\(/,  // def foo(
    /^\s*fn\s+\w+/,  // fn foo
    /^\s*@\w+/,  // decorators/annotations
    /^\s*<(\w+)[^>]*>\s*$/,  // JSX/HTML component tags
    /^\s*(curl|wget|npm|yarn|pnpm|pip|cargo|go|rustc|javac|git|docker|kubectl)\s/,  // CLI commands
    /^\s*[$#>]\s/,  // shell prompts
    /^\s*\w+\s*=\s*\w+\s*\/\//,  // variable assignment with comment
    /^\s*\/\/|^\s*#|^\s*;|^\s*--/,  // comment-only lines
    /^\s*\*\s+@param|^\s*\*\s+@return|^\s*\*\s+@throws/,  // JSDoc tags
    /^\s*{/,  // opening brace on own line
    /^\s*}/  // closing brace
  ];

  const isCodeLine = (line: string): boolean => {
    const trimmed = line.trim();
    if (trimmed.length === 0) return false;
    for (const re of codeSignatures) {
      if (re.test(line)) return true;
    }
    return false;
  };

  const guessLang = (lines: string[]): string => {
    const joined = lines.join("\n");
    if (/\bfn\s+|let\s+mut|impl\s+|struct\s+|enum\s+|use\s+\w+::/i.test(joined)) return "rust";
    if (/def\s+\w+\s*\(|import\s+\w+|from\s+\w+\s+import|class\s+\w+.*:/i.test(joined)) return "python";
    if (/function\s+\w+|const\s+\w+\s*[:=]|interface\s+\w+|type\s+\w+\s*=|import\s+[{*]/i.test(joined)) return "ts";
    if (/public\s+class|System\.out|private\s+static|@Override/i.test(joined)) return "java";
    if (/(curl|wget|npm|yarn|pip|cargo|git|docker|kubectl|apt|brew|chmod|sudo|ssh|scp)\s/i.test(joined)) return "bash";
    return "";
  };

  const flushBlock = () => {
    if (blockLines.length === 0) return;
    const lang = blockLang || guessLang(blockLines);
    const fence = lang ? "```" + lang : "```";
    out.push(fence);
    out.push(...blockLines);
    out.push("```");
    blockLines = [];
    blockLang = "";
    inBlock = false;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const code = isCodeLine(line);

    // Detect markdown fenced blocks already in source
    if (/^```/.test(line.trim())) {
      flushBlock();
      // Capture existing fence language hint
      const m = line.trim().match(/^```(\w*)/);
      if (m && m[1]) blockLang = m[1];
      inBlock = true;
      out.push(line);
      continue;
    }

    if (inBlock) {
      out.push(line);
      if (/^```/.test(line.trim())) {
        inBlock = false;
        blockLang = "";
      }
      continue;
    }

    if (code) {
      blockLines.push(line);
      // Look ahead: if next line is also code (or blank + code), keep collecting
      let j = i + 1;
      while (j < lines.length && (isCodeLine(lines[j]) || lines[j].trim().length === 0)) {
        if (lines[j].trim().length === 0) {
          blockLines.push(lines[j]);
          j++;
          continue;
        }
        blockLines.push(lines[j]);
        j++;
      }
      i = j - 1;
      flushBlock();
    } else {
      out.push(line);
    }
  }
  flushBlock();

  return out.join("\n");
}

/**
 * Smart token-budget truncation: prioritise headers, code blocks, and the
 * first 150 lines. Falls back to a clean 8k char slice if still over budget.
 */
function smartTruncate(text: string, maxChars = 8000): string {
  const TRUNCATION_FOOTER =
    "\n\n... [Web fetch output compressed for token defense. Structural documentation extracted.]";
  const footerLen = TRUNCATION_FOOTER.length;
  const budget = maxChars - footerLen;

  if (text.length <= maxChars) return text;

  const lines = text.split("\n");

  // ── Priority 1: headers (lines that look like titles) ────────────────
  const headerRe = /^#{1,6}\s|^[A-Z][A-Za-z0-9 ,-]{10,60}$|^[A-Z][a-z]+( [A-Z][a-z]+){1,8}$/;
  const headerIndices = new Set<number>();
  for (let i = 0; i < lines.length; i++) {
    if (headerRe.test(lines[i].trim())) {
      headerIndices.add(i);
    }
  }

  // ── Priority 2: lines inside code fences ─────────────────────────────
  const codeIndices = new Set<number>();
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^```/.test(lines[i].trim())) {
      inFence = !inFence;
      codeIndices.add(i); // keep fence markers
      continue;
    }
    if (inFence) codeIndices.add(i);
  }

  // ── Priority 3: first 150 lines ──────────────────────────────────────
  const FIRST_N = 150;

  // Build result: gather priority lines in order, then fill budget
  const kept = new Set<number>();

  // Always keep first 150 (or fewer) lines
  for (let i = 0; i < Math.min(FIRST_N, lines.length); i++) {
    kept.add(i);
  }

  // Add headers from beyond first 150
  for (const idx of headerIndices) {
    if (idx >= FIRST_N) kept.add(idx);
  }

  // Add code blocks from beyond first 150
  for (const idx of codeIndices) {
    if (idx >= FIRST_N) kept.add(idx);
  }

  const sorted = [...kept].sort((a, b) => a - b);
  const keptLines: string[] = [];
  let lastIdx = -2;
  for (const idx of sorted) {
    if (idx > lastIdx + 1 && keptLines.length > 0) {
      keptLines.push("...");
    }
    keptLines.push(lines[idx]);
    lastIdx = idx;
  }

  let result = keptLines.join("\n");

  // If still over budget, hard-cap at budget chars
  if (result.length > budget) {
    result = result.slice(0, budget);
  }

  return result + TRUNCATION_FOOTER;
}

async function webFetch(url: string): Promise<string> {
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    return "Error: URL must start with http:// or https://";
  }
  try {
    const result = execSync(
      `curl -s -L --max-time 10 -A "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36" ${JSON.stringify(url)}`,
      {
        encoding: "utf8",
        maxBuffer: 2 * 1024 * 1024,
        timeout: 15_000,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    // ── Stage 1: Strip HTML tags, preserving newline structure ─────────
    let text = stripHtmlKeepNewlines(result);

    // ── Stage 2: Deduplicate consecutive identical lines ───────────────
    text = dedupConsecutiveLines(text);

    // ── Stage 3: Strip sidebar / nav / footer boilerplate ──────────────
    const lines = text.split("\n");
    const cleaned = lines.filter((line) => {
      const trimmed = line.trim();
      if (trimmed.length === 0) return true; // keep blank lines for structure
      if (BOILERPLATE_RE.test(trimmed)) return false;
      return true;
    });
    text = cleaned.join("\n");

    // ── Stage 4: Collapse whitespace stacks ────────────────────────────
    text = text.replace(/\n{4,}/g, "\n\n\n");
    text = text.replace(/[ \t]{2,}/g, " ");

    // ── Stage 5: Extract & wrap code blocks in markdown fences ─────────
    text = wrapCodeBlocks(text);

    // ── Stage 6: Smart token budget ────────────────────────────────────
    if (text.length <= 8000) {
      return text;
    }
    return smartTruncate(text, 8000);
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return `web_fetch failed: ${e.stderr?.trim() || e.message || "unknown error"}`;
  }
}

// ---- Read image (vision) ----

async function readImage(pathOrUrl: string, ctx: ToolContext): Promise<string> {
  const apiKey =
    ctx.openRouterApiKey?.trim() ||
    process.env.OPENROUTER_API_KEY?.trim() ||
    "";
  if (!apiKey) {
    return "Error: OPENROUTER_API_KEY is not set. Set it in environment or shared context to use read_image.";
  }

  // ── Hyprland Screenshot Interception Guard ─────────────────────────
  // Intercept virtual "screenshot://" URIs to capture the active window
  // before the local-path branch reads the temporary PNG file.
  let isInternalTrustedPath = false;
  if (pathOrUrl === "screenshot://active") {
    const tmpPath = "/tmp/sispace-active-snap.png";
    try {
      const hyprJson = execSync("hyprctl activewindow -j", {
        encoding: "utf8",
        timeout: 3000,
        stdio: ["ignore", "pipe", "ignore"],
      });
      const parsed = JSON.parse(hyprJson);
      const x = parsed.at[0];
      const y = parsed.at[1];
      const w = parsed.size[0];
      const h = parsed.size[1];
      execSync(`grim -g "${x},${y} ${w}x${h}" ${tmpPath}`, {
        stdio: "ignore",
        timeout: 5000,
      });
      // Reassign so the existing local-file branch loads the snap
      pathOrUrl = tmpPath;
      isInternalTrustedPath = true;
    } catch {
      // Silent fallback: hyprctl or grim unavailable — try reading
      // pathOrUrl as a standard local path (will likely fail, but
      // the error message downstream will be informative).
      console.warn("read_image: screenshot interception failed, falling back to local path");
    }
  }

  // 1. Get base64 data
  let base64Data: string;
  let mimeType: string;
  if (
    pathOrUrl.startsWith("http://") ||
    pathOrUrl.startsWith("https://")
  ) {
    // URL — fetch via curl as base64
    try {
      const result = execSync(
        `curl -s -L --max-time 15 -A "Mozilla/5.0" ${JSON.stringify(pathOrUrl)} | base64 -w0`,
        {
          encoding: "utf8",
          maxBuffer: 10 * 1024 * 1024,
          timeout: 20_000,
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      base64Data = result.trim();
      // Guess mime from extension or default
      const ext = pathOrUrl.split(".").pop()?.toLowerCase() ?? "";
      mimeType = extToMime(ext);
      if (!base64Data) {
        return `Error: empty response when fetching ${pathOrUrl}`;
      }
    } catch (err) {
      const e = err as { stderr?: string; message?: string };
      return `read_image fetch failed: ${e.stderr?.trim() || e.message || "unknown error"}`;
    }
  } else {
    // Local path
    try {
      const full = isInternalTrustedPath ? pathOrUrl : resolveInCwd(ctx.cwd, pathOrUrl);
      const buf = readFileSync(full);
      base64Data = buf.toString("base64");
      const ext = pathOrUrl.split(".").pop()?.toLowerCase() ?? "";
      mimeType = extToMime(ext);
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  }

  // 2. Call OpenRouter vision model
  const visionModels = [
    "google/gemini-2.5-flash-image",
    "anthropic/claude-sonnet-4.6",
  ];

  for (const model of visionModels) {
    try {
      const resp = await fetch(
        "https://openrouter.ai/api/v1/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "https://github.com/lev/sispace",
            "X-Title": "SISpace",
          },
          body: JSON.stringify({
            model,
            messages: [
              {
                role: "user",
                content: [
                  {
                    type: "text",
                    text: "Describe this image in detail, focusing on any code, diagrams, or technical content",
                  },
                  {
                    type: "image_url",
                    image_url: {
                      url: `data:${mimeType};base64,${base64Data}`,
                    },
                  },
                ],
              },
            ],
            max_tokens: 2048,
          }),
          signal: AbortSignal.timeout(30_000),
        },
      );

      if (!resp.ok) {
        const errText = await resp.text().catch(() => "");
        if (resp.status === 429 || resp.status >= 500) {
          continue; // try next model
        }
        return `read_image API error (${resp.status}): ${errText.slice(0, 200)}`;
      }

      const data = (await resp.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = data.choices?.[0]?.message?.content?.trim();
      if (content) {
        return content;
      }
      return "(vision model returned empty response)";
    } catch {
      continue; // try next model
    }
  }

  return "Error: all vision models failed (rate limited or unavailable)";
}

function extToMime(ext: string): string {
  switch (ext) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "bmp":
      return "image/bmp";
    case "svg":
      return "image/svg+xml";
    default:
      return "image/png";
  }
}

// ---- MCP lookup ----

const MCP_REPO = readProcessVar("FORGE_CSV_ROOT");

const MCP_CSV_FILES: Record<string, string> = {
  field: `${MCP_REPO}/fields.csv`,
  method: `${MCP_REPO}/methods.csv`,
  param: `${MCP_REPO}/params.csv`,
};

function searchCsv(filePath: string, needle: string, columns: string[]): string[] {
  try {
    const text = readFileSync(filePath, "utf8");
    const lines = text.split(/\r?\n/);
    const rows: Record<string, string>[] = [];
    const lowerNeedle = needle.toLowerCase();
    for (const line of lines) {
      if (line.trim() === "") continue;
      if (line.toLowerCase().includes(lowerNeedle)) {
        const parts = line.split(",");
        const row: Record<string, string> = {};
        columns.forEach((col, i) => {
          row[col] = (parts[i] ?? "").replace(/^"|"$/g, "").trim();
        });
        rows.push(row);
      }
    }
    return rows.map((r) => {
      const parts: string[] = [];
      if (r.searge) parts.push(`SRG: ${r.searge}`);
      if (r.param) parts.push(`Param: ${r.param}`);
      if (r.name) parts.push(`MCP: ${r.name}`);
      if (r.side) parts.push(`Side: ${r.side}`);
      if (r.desc) parts.push(`Desc: ${r.desc}`);
      return parts.join(" | ");
    });
  } catch {
    return [];
  }
}

function mcpLookup(type: string, name: string): string {
  if (!MCP_REPO) {
    return "MCP lookup unavailable: set FORGE_CSV_ROOT to a Forge 1.8.9 MCP CSV directory.";
  }

  const lowerType = type.toLowerCase();
  let results: string[] = [];
  let source = "";

  if (lowerType === "class") {
    // Grep across all CSV files for class-like names
    const allLines: string[] = [];
    for (const key of ["field", "method", "param"] as const) {
      try {
        const text = readFileSync(MCP_CSV_FILES[key], "utf8");
        const lines = text.split(/\r?\n/);
        for (const line of lines) {
          if (line.toLowerCase().includes(name.toLowerCase())) {
            allLines.push(`[${key}s.csv] ${line.trim()}`);
          }
        }
      } catch { /* skip */ }
    }
    if (allLines.length === 0) {
      return `No matches for "${name}" in any MCP CSV file.`;
    }
    results = allLines.slice(0, 30);
    source = "cross-file";
  } else {
    // Direct CSV lookup
    const csvFile = MCP_CSV_FILES[lowerType];
    if (!csvFile) {
      return `Unknown type: ${type}. Valid: field, method, param, class.`;
    }

    let columns: string[];
    if (lowerType === "param") {
      columns = ["param", "name", "side"];
    } else {
      columns = ["searge", "name", "side", "desc"];
    }

    results = searchCsv(csvFile, name, columns);
    source = `${lowerType}s.csv`;

    // If no results, fall back to cross-file search
    if (results.length === 0) {
      const cross: string[] = [];
      for (const key of ["field", "method", "param"] as const) {
        const rows = searchCsv(
          MCP_CSV_FILES[key],
          name,
          key === "param" ? ["param", "name", "side"] : ["searge", "name", "side", "desc"],
        );
        for (const row of rows) {
          cross.push(`[${key}s.csv] ${row}`);
        }
      }
      if (cross.length > 0) {
        results = cross;
        source = "cross-file (fallback)";
      }
    }
  }

  if (results.length === 0) {
    return `No matches for "${name}" in any MCP CSV file.`;
  }

  const header = `MCP lookup: type=${type} name="${name}" (source: ${source})`;
  const body = results.slice(0, 30).join("\n");
  const footer = results.length > 30 ? `\n... and ${results.length - 30} more results` : "";
  return `${header}\n${body}${footer}`;
}

export async function probeObsidian(apiKey?: string, apiUrl?: string): Promise<boolean> {
  const key = apiKey?.trim();
  if (!key) {
    return false;
  }
  const base = (apiUrl || DEFAULT_OBSIDIAN_API).replace(/\/$/, "");
  try {
    const response = await fetch(`${base}/search/simple/`, {
      method: "POST",
      headers: {
        Authorization: obsidianAuth(key),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: "healthcheck", contextLength: 0 }),
      signal: AbortSignal.timeout(2500),
    });
    return response.ok || response.status === 400 || response.status === 404;
  } catch {
    return false;
  }
}
