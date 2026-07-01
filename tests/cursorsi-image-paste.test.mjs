/**
 * CursorSI image paste / @path resolution.
 * Run: node --test tests/cursorsi-image-paste.test.mjs
 * Requires: cd cli && npm run build
 */
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  ingestImageFromPath,
  ingestPasteBlob,
  resolveImagePlaceholders,
} from "../cli/dist/tui/paste.js";

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==",
  "base64",
);

describe("image paste resolution", () => {
  it("ingests @/path-only paste into [image #N]", () => {
    const dir = mkdtempSync(join(tmpdir(), "cursorsi-img-"));
    const path = join(dir, "clip.png");
    writeFileSync(path, TINY_PNG);
    const sessionId = "path-only";
    const r = ingestPasteBlob(sessionId, `@${path}`);
    assert.match(r.text, /^\[image #1\]$/);
    assert.equal(r.attachedImageNum, 1);
  });

  it("resolves @/path in composed message to SDK images", () => {
    const dir = mkdtempSync(join(tmpdir(), "cursorsi-img-"));
    const path = join(dir, "shot.png");
    writeFileSync(path, TINY_PNG);
    const sessionId = "at-path-send";
    const msg = `see this @${path} please`;
    const resolved = resolveImagePlaceholders(sessionId, msg);
    assert.equal(resolved.images.length, 1);
    assert.equal(resolved.images[0]?.mimeType, "image/png");
    assert.ok(resolved.images[0]?.data?.length > 0);
    assert.match(resolved.text, /see this.*please/);
    assert.doesNotMatch(resolved.text, /@\//);
  });

  it("ingestImageFromPath stores clipboard-style temp files", () => {
    const dir = mkdtempSync(join(tmpdir(), "cursorsi-img-"));
    const path = join(dir, "clipboard.png");
    writeFileSync(path, TINY_PNG);
    const sessionId = "clipboard-file";
    const r = ingestImageFromPath(sessionId, path);
    assert.ok(r);
    assert.equal(r.text, "[image #1]");
    const out = resolveImagePlaceholders(sessionId, r.text);
    assert.equal(out.images.length, 1);
  });
});
