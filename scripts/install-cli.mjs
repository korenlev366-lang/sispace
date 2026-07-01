#!/usr/bin/env node
/**
 * Symlink cli/bin/cursorsi.mjs → ~/.local/bin/cursorsi (executable).
 * Run from repo root: npm run install-cli
 */
import { chmodSync, existsSync, mkdirSync, symlinkSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "cli/bin/cursorsi.mjs");
const binDir = join(homedir(), ".local/bin");
const linkPath = join(binDir, "cursorsi");

if (!existsSync(source)) {
  console.error(`install-cli: missing ${source} — run npm run cursorsi:build first`);
  process.exit(1);
}

mkdirSync(binDir, { recursive: true });
chmodSync(source, 0o755);

if (existsSync(linkPath)) {
  try {
    unlinkSync(linkPath);
  } catch (err) {
    console.error(`install-cli: remove existing ${linkPath}: ${err}`);
    process.exit(1);
  }
}

symlinkSync(source, linkPath);
chmodSync(linkPath, 0o755);

console.log(`install-cli: ${linkPath} → ${source}`);
