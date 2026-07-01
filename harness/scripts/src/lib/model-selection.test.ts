import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_MODEL_ID,
  LEGACY_COMPOSER_25_FAST_ID,
  modelIdToSelection,
} from "./model-selection.js";

describe("modelIdToSelection", () => {
  it("defaults to OpenRouter default model", () => {
    assert.equal(modelIdToSelection(null), DEFAULT_MODEL_ID);
    assert.equal(modelIdToSelection(undefined), DEFAULT_MODEL_ID);
  });

  it("maps legacy composer ids to default OpenRouter model", () => {
    assert.equal(modelIdToSelection(LEGACY_COMPOSER_25_FAST_ID), DEFAULT_MODEL_ID);
    assert.equal(modelIdToSelection("composer-2.5"), DEFAULT_MODEL_ID);
  });

  it("passes through explicit OpenRouter ids", () => {
    assert.equal(modelIdToSelection("anthropic/claude-sonnet-4-6"), "anthropic/claude-sonnet-4-6");
  });
});
