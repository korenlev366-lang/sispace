import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { resolvePaths, resolveSispaceMemoryRoot } from "./paths.js";

const SISPACE = path.join(os.homedir(), "sispace");

test("resolveSispaceMemoryRoot prefers SISPACE_HOME when harness/memory exists", () => {
  if (!fs.existsSync(path.join(SISPACE, "harness", "memory"))) {
    return;
  }
  const prev = process.env.SISPACE_HOME;
  process.env.SISPACE_HOME = SISPACE;
  try {
    assert.equal(resolveSispaceMemoryRoot("/tmp/other-project"), SISPACE);
  } finally {
    if (prev === undefined) delete process.env.SISPACE_HOME;
    else process.env.SISPACE_HOME = prev;
  }
});

test("resolvePaths writes memory ledgers under memoryRoot not arbitrary cwd", () => {
  if (!fs.existsSync(path.join(SISPACE, "harness", "memory"))) {
    return;
  }
  const prev = process.env.SISPACE_HOME;
  process.env.SISPACE_HOME = SISPACE;
  try {
    const paths = resolvePaths("/tmp/other-project");
    assert.equal(paths.memoryRoot, SISPACE);
    assert.equal(paths.acceptedLessons, path.join(SISPACE, "harness/memory/accepted-lessons.md"));
    assert.equal(paths.chainLog, path.join(SISPACE, "harness/reports/post-task-chain.log"));
    assert.equal(paths.root, "/tmp/other-project");
  } finally {
    if (prev === undefined) delete process.env.SISPACE_HOME;
    else process.env.SISPACE_HOME = prev;
  }
});
