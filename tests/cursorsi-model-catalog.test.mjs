/**
 * CursorSI model catalog resolution (offline + against mock catalog).
 * Run: node --test tests/cursorsi-model-catalog.test.mjs
 * Requires: cd cli && npm run build
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  FALLBACK_MODEL_ID,
  resolveModelIdAgainstCatalog,
  resolveModelIdOffline,
  resetModelCatalogCache,
} from "../cli/dist/models/catalog.js";

const API_CATALOG = new Set([
  "default",
  "composer-2.5",
  "composer-2",
  "claude-sonnet-4-6",
]);

describe("resolveModelIdOffline", () => {
  it("maps legacy composer-2.5-fast to composer-2.5", () => {
    assert.equal(resolveModelIdOffline("composer-2.5-fast"), "composer-2.5");
  });

  it("defaults empty to fallback", () => {
    assert.equal(resolveModelIdOffline(null), FALLBACK_MODEL_ID);
    assert.equal(resolveModelIdOffline(""), FALLBACK_MODEL_ID);
  });
});

describe("resolveModelIdAgainstCatalog", () => {
  it("maps composer-2.5-fast to composer-2.5 when fast absent from API", () => {
    assert.equal(
      resolveModelIdAgainstCatalog("composer-2.5-fast", API_CATALOG),
      "composer-2.5",
    );
  });

  it("passes through valid catalog ids", () => {
    assert.equal(
      resolveModelIdAgainstCatalog("composer-2.5", API_CATALOG),
      "composer-2.5",
    );
    assert.equal(
      resolveModelIdAgainstCatalog("composer-2", API_CATALOG),
      "composer-2",
    );
  });

  it("falls back to composer-2.5 for unknown ids", () => {
    assert.equal(
      resolveModelIdAgainstCatalog("gpt-99-unknown", API_CATALOG),
      "composer-2.5",
    );
  });
});

describe("resetModelCatalogCache", () => {
  it("clears cache without throw", () => {
    resetModelCatalogCache();
  });
});
