import fs from "node:fs";
import path from "node:path";
import type { ObsidianConfig } from "./paths.js";

export interface ObsidianSyncResult {
  synced: string[];
  skipped: string[];
  errors: string[];
}

export interface SyncEntry {
  kind: string;
  id: string;
  body: string;
  date?: string;
  links?: string[];
}

function normalizeToken(token: string): string {
  const trimmed = token.trim();
  return trimmed.toLowerCase().startsWith("bearer ")
    ? trimmed.slice(7).trim()
    : trimmed;
}

function encodeVaultPath(vaultRelativePath: string): string {
  return vaultRelativePath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

export async function vaultWrite(
  apiUrl: string,
  token: string,
  vaultRelativePath: string,
  body: string,
): Promise<void> {
  const base = apiUrl.replace(/\/$/, "");
  const url = `${base}/vault/${encodeVaultPath(vaultRelativePath)}`;
  const auth = normalizeToken(token);

  const response = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${auth}`,
      "Content-Type": "text/markdown",
    },
    body,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Obsidian PUT ${vaultRelativePath} failed (${response.status}): ${detail.slice(0, 240)}`,
    );
  }
}

function withFrontmatter(body: string, fields: Record<string, string>): string {
  const lines = Object.entries(fields)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`);
  if (lines.length === 0) return body;
  return `---\n${lines.join("\n")}\n---\n\n${body}`;
}

function safeVaultId(id: string): string {
  return id.replace(/[^\w.-]+/g, "-");
}

export function vaultLinkPath(folder: string, id: string): string {
  return `${folder}/${safeVaultId(id)}`;
}

export function appendLinksSection(body: string, links: string[] | undefined): string {
  if (!links?.length) return body;
  const missing = links.filter((target) => target && !body.includes(`[[${target}]]`));
  if (!missing.length) return body;
  const items = missing.map((target) => `- [[${target}]]`).join("\n");
  if (body.includes("## Related")) {
    return `${body.trimEnd()}\n${items}\n`;
  }
  return `${body.trimEnd()}\n\n## Related\n\n${items}\n`;
}

export async function syncObsidianEntries(
  config: ObsidianConfig,
  entries: SyncEntry[],
  opts?: { token?: string; apiUrl?: string },
): Promise<ObsidianSyncResult> {
  const token = opts?.token?.trim() ?? "";
  const apiUrl = opts?.apiUrl?.trim() || "http://127.0.0.1:27123";
  const result: ObsidianSyncResult = { synced: [], skipped: [], errors: [] };

  if (!token) {
    result.skipped.push("all (Obsidian token not provided)");
    return result;
  }

  if (!config.vaultRoot) {
    result.skipped.push("all (vault_root missing in obsidian.yaml)");
    return result;
  }

  for (const entry of entries) {
    let folder = config.folders.rolloutLog;
    switch (entry.kind) {
      case "accepted":
        folder = config.folders.acceptedLessons;
        break;
      case "rejected":
        folder = config.folders.rejectedLessons;
        break;
      case "user-model":
        folder = config.folders.userModel;
        break;
      case "reasoning":
        folder = config.folders.reasoningPatterns;
        break;
      case "rollout":
        folder = config.folders.rolloutLog;
        break;
      default:
        result.skipped.push(`${entry.id} (unknown kind ${entry.kind})`);
        continue;
    }

    const safeId = safeVaultId(entry.id);
    const vaultPath = `${folder}/${safeId}.md`;
    const note = appendLinksSection(
      withFrontmatter(entry.body, {
        source: "cursor-harness",
        tags: "harness",
        proposal_id: entry.id,
        date: entry.date ?? new Date().toISOString().slice(0, 10),
      }),
      entry.links,
    );

    try {
      await vaultWrite(apiUrl, token, vaultPath, note);
      result.synced.push(vaultPath);
    } catch (err) {
      result.errors.push(`${vaultPath}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return result;
}

export function logSyncResult(logPath: string, result: ObsidianSyncResult): void {
  const lines = [
    `[${new Date().toISOString()}] obsidian sync synced=${result.synced.length} skipped=${result.skipped.length} errors=${result.errors.length}`,
    ...result.synced.map((p) => `  synced: ${p}`),
    ...result.skipped.map((p) => `  skipped: ${p}`),
    ...result.errors.map((p) => `  error: ${p}`),
    "",
  ];
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.appendFileSync(logPath, lines.join("\n"), "utf8");
}
