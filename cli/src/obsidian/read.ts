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

export async function vaultRead(vaultPath: string): Promise<string> {
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
    method: "GET",
    headers: { Authorization: authHdr(token) },
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(`obsidian read failed: ${response.status}`);
  }
  return response.text();
}
