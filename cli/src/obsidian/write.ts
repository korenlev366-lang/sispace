import { obsidianTokenFromEnv } from "../sdk/session-agent.js";

type GlobalObs = { __cursorsiObsidianApi?: string };

function encodeVaultPath(vaultRelative: string): string {
  return vaultRelative
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function authHdr(token: string): string {
  const t = token.trim();
  return t.toLowerCase().startsWith("bearer ") ? t : `Bearer ${t}`;
}

export async function vaultWrite(vaultPath: string, body: string): Promise<void> {
  const token = obsidianTokenFromEnv()?.trim();
  if (!token) {
    throw new Error("Obsidian credential not configured");
  }

  const g = globalThis as GlobalObs;
  const base = (g.__cursorsiObsidianApi || "http://127.0.0.1:27123").replace(
    /\/$/,
    "",
  );
  const url = `${base}/vault/${encodeVaultPath(vaultPath)}`;
  const response = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: authHdr(token),
      "Content-Type": "text/markdown",
    },
    body,
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `obsidian write failed (${response.status}): ${detail.slice(0, 240)}`,
    );
  }
}

/** Append or create a ## heading section (matches sispace-core append_section). */
export function appendSection(note: string, heading: string, content: string): string {
  const stamp = new Date().toISOString();
  const block = `\n\n### ${heading} entry (${stamp})\n\n${content}\n`;
  const marker = `## ${heading}`;
  const idx = note.indexOf(marker);
  if (idx >= 0) {
    const after = note.slice(idx).search(/\n## /);
    const end = after >= 0 ? idx + after : note.length;
    return note.slice(0, end) + block + note.slice(end);
  }
  return `${note}${block}`;
}
