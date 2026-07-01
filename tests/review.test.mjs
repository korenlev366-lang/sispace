/**
 * Unit + static integration tests for in_review grade badge and reflection preview.
 * Run: node --experimental-strip-types --test tests/review.test.mjs
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  extractAgentBlock,
  findLatestAgentMessage,
  parseReviewerResult,
  reconstructReflectTranscript,
} from "../src/lib/review.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

function read(relPath) {
  return readFileSync(path.join(repoRoot, relPath), "utf8");
}

function msg(id, role, content, created_at = "2026-06-03T10:00:00Z") {
  return { id, task_id: "t_test", run_id: "r1", role, content, created_at };
}

const REVIEWER_BLOCK = `### reviewer-agent

1. **Verdict** — approve with nits
2. **Issues**
   - (minor) Swallowed fetch errors in KanbanBoard cache
   - (minor) No Escape handler on preview dialog
3. **Suggested fixes** — add error surface and Escape listener
4. **Spec gaps** — none`;

const TESTER_BLOCK = `### tester-agent

## Test plan
- parseReviewerResult verdict extraction
- ReflectPreviewDialog wiring

## Results
All unit tests pass.`;

describe("parseReviewerResult", () => {
  it("returns null verdict when messages are empty", () => {
    const r = parseReviewerResult([]);
    assert.equal(r.verdict, null);
    assert.equal(r.rawBlock, null);
    assert.equal(r.issuesExcerpt, null);
  });

  it("returns null verdict when no reviewer-agent message exists", () => {
    const r = parseReviewerResult([
      msg(1, "user", "Run the pipeline"),
      msg(2, "assistant", "### coder-agent\n\nDone."),
    ]);
    assert.equal(r.verdict, null);
  });

  it("parses **Verdict** — approve with nits from latest reviewer block", () => {
    const r = parseReviewerResult([
      msg(1, "assistant", "### reviewer-agent\n\n**Verdict** — request changes\nOld run."),
      msg(2, "assistant", REVIEWER_BLOCK),
    ]);
    assert.equal(r.verdict, "approve with nits");
    assert.ok(r.rawBlock?.includes("Swallowed fetch errors"));
  });

  it("parses numbered 1. **Verdict** — approve", () => {
    const block = `### reviewer-agent

1. **Verdict** — approve
2. **Issues** — none`;
    const r = parseReviewerResult([msg(1, "assistant", block)]);
    assert.equal(r.verdict, "approve");
  });

  it("parses request changes verdict", () => {
    const block = `### reviewer-agent

1. **Verdict** — request changes
2. **Issues**
   - (blocker) Missing auth check`;
    const r = parseReviewerResult([msg(1, "assistant", block)]);
    assert.equal(r.verdict, "request changes");
    assert.ok(r.issuesExcerpt?.includes("Missing auth check"));
  });

  it("extracts issues excerpt capped at 500 chars", () => {
    const longIssue = "x".repeat(600);
    const block = `### reviewer-agent

1. **Verdict** — approve
2. **Issues**
   - ${longIssue}`;
    const r = parseReviewerResult([msg(1, "assistant", block)]);
    assert.ok(r.issuesExcerpt);
    assert.ok(r.issuesExcerpt.length <= 501);
    assert.ok(r.issuesExcerpt.endsWith("…"));
  });

  it("does not parse backtick-wrapped verdict (known limitation)", () => {
    const block = `### reviewer-agent

1. **Verdict** — \`approve\`
2. **Issues** — none`;
    const r = parseReviewerResult([msg(1, "assistant", block)]);
    assert.equal(r.verdict, null);
  });
});

describe("findLatestAgentMessage", () => {
  it("returns the most recent assistant message with agent header", () => {
    const messages = [
      msg(1, "assistant", "### tester-agent\n\nFirst tester run."),
      msg(2, "assistant", TESTER_BLOCK),
      msg(3, "user", "ignore me"),
    ];
    const latest = findLatestAgentMessage(messages, "tester-agent");
    assert.equal(latest?.id, 2);
  });

  it("skips non-assistant roles", () => {
    const messages = [
      msg(1, "system", "### reviewer-agent\n\nfake"),
      msg(2, "assistant", REVIEWER_BLOCK),
    ];
    assert.equal(findLatestAgentMessage(messages, "reviewer-agent")?.id, 2);
  });
});

describe("extractAgentBlock", () => {
  it("extracts body after ### header", () => {
    const body = extractAgentBlock(REVIEWER_BLOCK, "reviewer-agent");
    assert.ok(body);
    assert.match(body, /^1\. \*\*Verdict\*\*/);
    assert.doesNotMatch(body, /^### reviewer-agent/);
  });

  it("returns null when agent header is absent", () => {
    assert.equal(extractAgentBlock("no agent here", "reviewer-agent"), null);
  });
});

describe("reconstructReflectTranscript", () => {
  it("joins messages with role labels and timestamps", () => {
    const transcript = reconstructReflectTranscript([
      msg(1, "user", "Goal: add feature", "2026-06-03T09:00:00Z"),
      msg(2, "assistant", "Done.", "2026-06-03T09:05:00Z"),
    ]);
    assert.match(transcript, /\[2026-06-03T09:00:00Z\] USER: Goal: add feature/);
    assert.match(transcript, /\[2026-06-03T09:05:00Z\] ASSISTANT: Done\./);
    assert.ok(transcript.includes("\n\n"));
  });
});

describe("in_review UI wiring (static)", () => {
  it("TaskPanel shows InReviewBar and ReflectPreviewDialog only for in_review", () => {
    const src = read("src/components/agent/TaskPanel.tsx");
    assert.match(src, /displayTask\.status === "in_review"/);
    assert.match(src, /<InReviewBar/);
    assert.match(src, /<ReflectPreviewDialog/);
    assert.match(src, /setReflectPreviewOpen\(true\)/);
    assert.doesNotMatch(src, /harness_get_status/);
  });

  it("KanbanBoard caches messages for in_review cards and shows bar before approve/reject", () => {
    const src = read("src/components/kanban/KanbanBoard.tsx");
    assert.match(src, /inReviewCache/);
    assert.match(src, /agentListMessages/);
    assert.match(src, /task\.status === "in_review"/);
    const inReviewIdx = src.indexOf('task.status === "in_review"');
    const approveIdx = src.indexOf("approve-btn");
    assert.ok(inReviewIdx > 0 && approveIdx > inReviewIdx, "InReviewBar should precede approve/reject");
    assert.match(src, /setPreviewTask\(task\)/);
    assert.match(src, /<ReflectPreviewDialog/);
  });

  it("ReflectPreviewDialog includes chain, reviewer, tester, and transcript sections", () => {
    const src = read("src/components/review/ReflectPreviewDialog.tsx");
    assert.match(src, /Post-approve chain/);
    assert.match(src, /Pipeline review/);
    assert.match(src, /Tester output/);
    assert.match(src, /Reflect transcript/);
    assert.match(src, /reconstructReflectTranscript/);
    assert.match(src, /prediction of reflection, grade, or rollout output/i);
    assert.doesNotMatch(src, /harness_get_status/);
  });

  it("ReviewerVerdictBadge maps all verdict labels", () => {
    const src = read("src/components/review/ReviewerVerdictBadge.tsx");
    assert.match(src, /Approve \(nits\)/);
    assert.match(src, /Request changes/);
    assert.match(src, /No verdict/);
  });

  it("App.css defines in-review and verdict styles", () => {
    const css = read("src/App.css");
    assert.match(css, /\.in-review-bar/);
    assert.match(css, /\.reviewer-verdict-badge/);
    assert.match(css, /\.verdict-approve/);
    assert.match(css, /\.reflect-preview-disclaimer/);
    assert.match(css, /\.dialog-card-wide/);
  });
});
