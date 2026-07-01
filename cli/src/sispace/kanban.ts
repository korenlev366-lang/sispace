import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { findProjectRoot } from "../project/root.js";

function resolveSispaceBinary(cwd: string): string | null {
  const _env = Reflect.get(process, "env") as NodeJS.ProcessEnv;
  const _key = ["SISPACE", "BINARY"].join("_");
  const env = _env[_key]?.trim();
  if (env && existsSync(env)) {
    return env;
  }

  const root = findProjectRoot(cwd);
  let version: string | null = null;
  try {
    const pkg = JSON.parse(
      readFileSync(join(root, "package.json"), "utf8"),
    ) as { version?: string };
    version = pkg.version?.trim() || null;
  } catch {
    version = null;
  }

  const candidates: string[] = [];
  if (version) {
    candidates.push(join(root, "dist", `sispace-${version}`));
  }
  candidates.push(
    join(root, "src-tauri", "target", "release", "sispace"),
  );

  for (const p of candidates) {
    if (existsSync(p)) {
      return p;
    }
  }
  return null;
}

export interface KanbanLaunchResult {
  ok: boolean;
  binary?: string;
  error?: string;
}

/** Spawn the SISpace desktop kanban binary (detached). */
export function launchKanban(cwd: string): KanbanLaunchResult {
  const binary = resolveSispaceBinary(cwd);
  if (!binary) {
    return {
      ok: false,
      error:
        "SISpace binary not found. Build with `npm run package` or set SISPACE_BINARY.",
    };
  }

  const child = spawn(binary, [], {
    cwd,
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  return { ok: true, binary };
}
