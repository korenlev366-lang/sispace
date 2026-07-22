import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");

type GlobalDb = { __cursorsiDbPath?: string };

let cachedRead: InstanceType<typeof DatabaseSync> | null = null;
let cachedWrite: InstanceType<typeof DatabaseSync> | null = null;

/** Default shared kanban DB — matches cli/run.sh. */
export function defaultTasksDbPath(): string {
  const fromEnv =
    process.env.SISPACE_DB_PATH?.trim() ||
    process.env.CURSORSI_DB_PATH?.trim();
  if (fromEnv) return fromEnv;
  return join(homedir(), ".local", "share", "sispace", "tasks.db");
}

export function resolveDbPath(): string | null {
  const explicit = (globalThis as GlobalDb).__cursorsiDbPath?.trim();
  if (explicit) return explicit;
  return defaultTasksDbPath();
}

export function openSharedDbRead(): InstanceType<typeof DatabaseSync> | null {
  const path = resolveDbPath();
  if (!path) {
    return null;
  }
  const { existsSync } = require("node:fs") as typeof import("node:fs");
  if (!existsSync(path)) {
    return null;
  }
  if (!cachedRead) {
    cachedRead = new DatabaseSync(path, { readOnly: true });
    cachedRead.exec("PRAGMA journal_mode = WAL");
  }
  return cachedRead;
}

export function openSharedDbWrite(): InstanceType<typeof DatabaseSync> | null {
  const path = resolveDbPath();
  if (!path) {
    return null;
  }
  const { existsSync, mkdirSync } = require("node:fs") as typeof import("node:fs");
  const { dirname } = require("node:path") as typeof import("node:path");
  if (!existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true });
  }
  if (!cachedWrite) {
    cachedWrite = new DatabaseSync(path);
    cachedWrite.exec("PRAGMA journal_mode = WAL");
  }
  return cachedWrite;
}

export function closeSharedDbs(): void {
  cachedRead?.close();
  cachedWrite?.close();
  cachedRead = null;
  cachedWrite = null;
}
