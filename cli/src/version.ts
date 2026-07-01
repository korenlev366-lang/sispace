import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pkgPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "package.json",
);

let cachedVersion: string | undefined;

export function cliPackageVersion(): string {
  if (cachedVersion) {
    return cachedVersion;
  }
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: string };
    cachedVersion = pkg.version ?? "0.0.0";
  } catch {
    cachedVersion = "0.0.0";
  }
  return cachedVersion;
}
