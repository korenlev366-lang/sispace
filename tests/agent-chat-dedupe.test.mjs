/**
 * AgentChat display dedupe (task t_26222991).
 * Mirrors dedupeDisplayMessages in src/components/agent/AgentChat.tsx — keep in sync.
 * Run: node --experimental-strip-types --test tests/agent-chat-dedupe.test.mjs
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

/** @param {Array<{ id: number; role: string; content: string; run_id: string | null }>} messages */
function dedupeDisplayMessages(messages) {
  const out = [];
  for (const msg of messages) {
    const prev = out[out.length - 1];
    if (
      prev &&
      prev.role === "assistant" &&
      msg.role === "assistant" &&
      prev.content === msg.content &&
      prev.run_id === msg.run_id
    ) {
      continue;
    }
    out.push(msg);
  }
  return out;
}

describe("dedupeDisplayMessages", () => {
  it("removes consecutive duplicate assistant rows with same run_id and content", () => {
    const body = "### coder-agent\n\nDone.";
    const input = [
      { id: 1, role: "system", content: "Step 1", run_id: null },
      { id: 2, role: "assistant", content: body, run_id: "run-a" },
      { id: 3, role: "assistant", content: body, run_id: "run-a" },
    ];
    const out = dedupeDisplayMessages(input);
    assert.equal(out.length, 2);
    assert.equal(out[1].id, 2);
  });

  it("keeps non-consecutive duplicates (system message between)", () => {
    const body = "### agent\n\nx";
    const input = [
      { id: 1, role: "assistant", content: body, run_id: "r" },
      { id: 2, role: "system", content: "done", run_id: null },
      { id: 3, role: "assistant", content: body, run_id: "r" },
    ];
    assert.equal(dedupeDisplayMessages(input).length, 3);
  });

  it("keeps assistant rows when run_id differs", () => {
    const body = "### agent\n\nsame text";
    const input = [
      { id: 1, role: "assistant", content: body, run_id: "a" },
      { id: 2, role: "assistant", content: body, run_id: "b" },
    ];
    assert.equal(dedupeDisplayMessages(input).length, 2);
  });
});
