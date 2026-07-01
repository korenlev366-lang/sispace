import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { huntGhostTokens } from "./ghost-token-hunter.js";
import { compressWithHeadroomLite } from "./headroom-lite.js";
import { optimizeContextBlock } from "./context-optimizer.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CONFIG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../config");

describe("ghost-token-hunter", () => {
  it("removes duplicate boilerplate blocks but keeps error signal", () => {
    const input = [
      "Session ID: abc",
      "Output tokens: 1000",
      "",
      "Session ID: abc",
      "Output tokens: 1000",
      "",
      "Verification failed: PROP-20260607-001 in harness/scripts/src/post-task-chain.ts",
    ].join("\n");

    const result = huntGhostTokens(input, { sensitivity: 0.65, minSignalToKeep: 0.3 });
    assert.ok(result.ghostsRemoved >= 1);
    assert.match(result.text, /PROP-20260607-001/);
    assert.ok(result.charsAfter < result.charsBefore);
  });
});

describe("headroom-lite", () => {
  it("crushes large JSON arrays while preserving anomalies", () => {
    const items = Array.from({ length: 120 }, (_, i) => ({
      id: i,
      status: i === 77 ? "error" : "ok",
      data: "x".repeat(40),
    }));
    const input = JSON.stringify(items, null, 2);
    const result = compressWithHeadroomLite(input, { minCharsToCompress: 100 });
    assert.equal(result.compressed, true);
    assert.match(result.text, /"status": "error"/);
    assert.ok(result.charsAfter < result.charsBefore);
  });

  it("compresses repetitive logs keeping errors", () => {
    const lines = [
      ...Array.from({ length: 200 }, (_, i) => `INFO routine heartbeat ${i}`),
      "ERROR connection reset by peer",
      "WARN retrying request 3/3",
    ];
    const input = lines.join("\n");
    const result = compressWithHeadroomLite(input, { minCharsToCompress: 100 });
    assert.equal(result.compressed, true);
    assert.match(result.text, /ERROR connection reset/);
    assert.match(result.text, /WARN retrying/);
  });
});

describe("context-optimizer", () => {
  it("runs ghost hunt + headroom-lite pipeline on reflection transcript", async () => {
    const transcript = [
      "User asked to wire token optimizer into harness.",
      "User asked to wire token optimizer into harness.",
      ...Array.from({ length: 80 }, (_, i) => `assistant: debug line ${i} ${"z".repeat(30)}`),
      "ERROR verify-harness-commands.sh failed at line 42",
    ].join("\n");

    const result = await optimizeContextBlock(
      transcript,
      "reflection_transcript",
      CONFIG_DIR,
    );
    assert.ok(result.ghostsRemoved >= 1 || result.tokensAfter < result.tokensBefore);
    assert.match(result.text, /ERROR verify-harness-commands/);
  });
});
