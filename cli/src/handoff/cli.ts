import { existsSync } from "node:fs";
import { exportHandoff, handoffFileForId, loadHandoffBlob } from "./io.js";
import type { CliSession } from "../session/types.js";

export function setHandoffAttachId(id: string): void {
  type GlobalHandoff = { __cursorsiHandoffAttach?: string };
  (globalThis as GlobalHandoff).__cursorsiHandoffAttach = id;
}

export function getHandoffAttachId(): string | undefined {
  type GlobalHandoff = { __cursorsiHandoffAttach?: string };
  return (globalThis as GlobalHandoff).__cursorsiHandoffAttach?.trim();
}

export function exportHandoffFromSession(
  session: CliSession,
  cwd: string = process.cwd(),
): number {
  const result = exportHandoff(session, cwd);
  if (!result.ok) {
    console.error(`handoff export failed: ${result.error}`);
    return 1;
  }
  console.log(`Handoff written: ${result.path}`);
  return 0;
}

export async function runHandoffCli(argv: string[]): Promise<number> {
  const cwd = process.cwd();
  const sub = argv[0]?.toLowerCase();

  if (sub === "attach" && argv[1]) {
    const id = argv[1].trim();
    const loaded = loadHandoffBlob(id, cwd);
    if (!loaded.ok) {
      console.error(`cursorsi handoff attach: ${loaded.error}`);
      return 1;
    }
    setHandoffAttachId(id);
    return -1;
  }

  if (sub === "export" && argv[1]) {
    const id = argv[1].trim();
    const path = handoffFileForId(id, cwd);
    if (!existsSync(path)) {
      console.error(
        `cursorsi handoff export: no blob at ${path}. Export from TUI with /handoff export.`,
      );
      return 1;
    }
    console.log(`Handoff ready: ${path}`);
    return 0;
  }

  if (sub && sub !== "export" && sub !== "attach") {
    const id = sub;
    const path = handoffFileForId(id, cwd);
    if (!existsSync(path)) {
      console.error(
        `cursorsi handoff: no blob for ${id}. Use /handoff export in an active TUI session first.`,
      );
      return 1;
    }
    console.log(`Handoff ready: ${path}`);
    return 0;
  }

  console.error("Usage: cursorsi handoff export|attach <session-id>");
  console.error("       cursorsi handoff <session-id>  (verify exported blob)");
  return 1;
}
