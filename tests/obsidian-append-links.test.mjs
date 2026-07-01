/**
 * Unit tests for harness/scripts appendLinksSection (post-task ## Related sync).
 * Run: node --test tests/obsidian-append-links.test.mjs
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { appendLinksSection, vaultLinkPath } from "../harness/scripts/dist/lib/obsidian.js";

describe("appendLinksSection", () => {
  it("returns body unchanged when links are empty", () => {
    const body = "# Note\n\nBody text.\n";
    assert.equal(appendLinksSection(body, []), body);
    assert.equal(appendLinksSection(body, undefined), body);
  });

  it("appends ## Related with wikilink bullets", () => {
    const body = "---\ntags: harness\n---\n\nRollout summary.\n";
    const links = ["Harness/accepted-lessons/PROP-001"];
    const out = appendLinksSection(body, links);
    assert.match(out, /## Related\n\n- \[\[Harness\/accepted-lessons\/PROP-001\]\]/);
  });

  it("skips links already present in body", () => {
    const body = "See [[Harness/rollout-log/ROLLOUT-1]] for context.\n";
    const out = appendLinksSection(body, ["Harness/rollout-log/ROLLOUT-1", "Harness/accepted-lessons/PROP-2"]);
    assert.doesNotMatch(out, /\[\[Harness\/rollout-log\/ROLLOUT-1\]\].*\[\[Harness\/rollout-log\/ROLLOUT-1\]\]/);
    assert.match(out, /\[\[Harness\/accepted-lessons\/PROP-2\]\]/);
  });

  it("appends under existing ## Related heading", () => {
    const body = "# Hub\n\n## Related\n\n- [[Harness/README]]\n";
    const out = appendLinksSection(body, ["SISpace/README"]);
    assert.match(out, /## Related\n\n- \[\[Harness\/README\]\]\n- \[\[SISpace\/README\]\]/);
    assert.equal((out.match(/## Related/g) ?? []).length, 1);
  });
});

describe("vaultLinkPath", () => {
  it("builds folder/id path without .md suffix", () => {
    assert.equal(
      vaultLinkPath("Harness/rollout-log", "ROLLOUT-20260603-065454-sdk"),
      "Harness/rollout-log/ROLLOUT-20260603-065454-sdk",
    );
  });
});
