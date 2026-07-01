import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  PIPELINE_MESSAGE_MAX,
  truncateUtf8,
} from "../lib/pipeline-truncate.mjs";

describe("truncateUtf8", () => {
  it("leaves short text unchanged", () => {
    assert.equal(truncateUtf8("hello", 100), "hello");
  });

  it("caps long text and reports omitted chars", () => {
    const long = "x".repeat(PIPELINE_MESSAGE_MAX + 500);
    const out = truncateUtf8(long, PIPELINE_MESSAGE_MAX);
    assert.ok(out.length < long.length);
    assert.ok(out.includes("truncated"));
    assert.ok(out.includes("500 more chars"));
  });
});
