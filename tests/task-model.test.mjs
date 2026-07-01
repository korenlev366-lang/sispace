/**
 * Model catalog normalization (Rust task model + CLI catalog).
 * Run: node --test tests/task-model.test.mjs
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  FALLBACK_MODEL_ID,
  resolveModelIdOffline,
} from "../cli/src/models/catalog.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

function read(relPath) {
  return readFileSync(path.join(repoRoot, relPath), "utf8");
}

describe("Rust task model defaults (static)", () => {
  const src = read("sispace-core/src/models/task.rs");

  it("defaults to composer-2.5 for orchestrator and subagent", () => {
    assert.ok(src.includes('pub const DEFAULT_MODEL_ID: &str = "composer-2.5";'));
    assert.ok(
      src.includes('pub const DEFAULT_SUBAGENT_MODEL_ID: &str = "composer-2.5";'),
    );
  });

  it("allows composer-2.5-fast to pass through in Rust storage", () => {
    assert.ok(src.includes('"composer-2.5-fast"'));
  });
});

describe("CLI catalog resolveModelIdOffline", () => {
  it("defaults to composer-2.5", () => {
    assert.equal(FALLBACK_MODEL_ID, "composer-2.5");
    assert.equal(resolveModelIdOffline(null), "composer-2.5");
  });

  it("maps legacy composer-2.5-fast to standard composer-2.5", () => {
    assert.equal(resolveModelIdOffline("composer-2.5-fast"), "composer-2.5");
  });
});
