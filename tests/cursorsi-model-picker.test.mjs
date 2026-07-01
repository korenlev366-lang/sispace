/**
 * Model picker selection helpers.
 * Run: node --test tests/cursorsi-model-picker.test.mjs
 * Requires: cd cli && npm run build
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  formatModelChoiceLabel,
  modelIdToSelection,
  selectionFromVariant,
  storedChoiceFromSession,
} from "../cli/dist/models/selection.js";
import {
  buildInitialPickerState,
  buildParamNavRows,
  confirmPickerChoice,
  focusableParamRows,
  isToggleParam,
  movePickerModelIndex,
  modelSupportsParams,
  movePickerParamFocus,
  stashModelParams,
  toggleShowParams,
} from "../cli/dist/tui/ModelPicker.js";
import {
  buildCursorParamRows,
  commitCursorParamValue,
  cursorModelHasParameters,
  moveCursorParamFocus,
  openCursorParams,
} from "../cli/dist/tui/CursorParamPicker.js";

const OPUS_LIKE = {
  id: "claude-opus-4",
  displayName: "Opus 4.7",
  parameters: [
    {
      id: "context_window",
      displayName: "Context",
      values: [
        { value: "300k", displayName: "300K" },
        { value: "1m", displayName: "1M" },
      ],
    },
    {
      id: "effort",
      displayName: "Effort",
      values: [
        { value: "low", displayName: "Low" },
        { value: "medium", displayName: "Medium" },
        { value: "high", displayName: "High" },
        { value: "extra_high", displayName: "Extra High" },
        { value: "max", displayName: "Max" },
      ],
    },
    {
      id: "thinking",
      displayName: "Thinking",
      values: [
        { value: "false", displayName: "Off" },
        { value: "true", displayName: "On" },
      ],
    },
    {
      id: "fast",
      displayName: "Fast",
      values: [
        { value: "false", displayName: "Off" },
        { value: "true", displayName: "On" },
      ],
    },
  ],
};

const COMPOSER = {
  id: "composer-2.5",
  displayName: "Composer 2.5",
  variants: [
    {
      displayName: "Default",
      isDefault: true,
      params: [],
    },
    {
      displayName: "Fast",
      params: [{ id: "fast", value: "true" }],
    },
  ],
};

describe("modelIdToSelection", () => {
  it("maps legacy fast id to standard without params", () => {
    assert.deepEqual(modelIdToSelection({ modelId: "composer-2.5-fast" }), {
      id: "composer-2.5",
    });
  });

  it("applies fast param when set", () => {
    assert.deepEqual(
      modelIdToSelection({
        modelId: "composer-2.5",
        params: [{ id: "fast", value: "true" }],
      }),
      { id: "composer-2.5", params: [{ id: "fast", value: "true" }] },
    );
  });

  it("passes thinking param through", () => {
    assert.deepEqual(
      modelIdToSelection({
        modelId: "composer-2.5",
        params: [{ id: "thinking", value: "true" }],
      }),
      { id: "composer-2.5", params: [{ id: "thinking", value: "true" }] },
    );
  });
});

describe("formatModelChoiceLabel", () => {
  it("shows fast suffix", () => {
    const label = formatModelChoiceLabel(
      storedChoiceFromSession("composer-2.5", [
        { id: "fast", value: "true" },
      ]),
    );
    assert.ok(label.includes("fast"));
  });
});

describe("selectionFromVariant", () => {
  it("copies variant params", () => {
    const choice = selectionFromVariant("composer-2.5", {
      displayName: "Fast",
      params: [{ id: "fast", value: "true" }],
    });
    assert.deepEqual(choice.params, [{ id: "fast", value: "true" }]);
  });
});

describe("ModelPicker param UI", () => {
  it("detects toggle params", () => {
    assert.equal(isToggleParam(OPUS_LIKE.parameters[2]), true);
    assert.equal(isToggleParam(OPUS_LIKE.parameters[0]), false);
  });

  it("builds grouped rows for multi-value and toggle params", () => {
    const rows = buildParamNavRows(OPUS_LIKE, {
      context_window: "300k",
      effort: "extra_high",
      thinking: "true",
      fast: "false",
    });
    const focusable = focusableParamRows(rows);
    assert.ok(rows.some((r) => r.kind === "header" && r.label === "Context"));
    assert.ok(rows.some((r) => r.kind === "toggle" && r.paramId === "thinking"));
    assert.equal(focusable.length, 7 + 2);
  });

  it("persists per-model params when switching models", () => {
    const catalog = [OPUS_LIKE, COMPOSER];
    let state = buildInitialPickerState(
      "orchestrator",
      catalog,
      storedChoiceFromSession("claude-opus-4", [
        { id: "effort", value: "max" },
      ]),
    );
    state = stashModelParams({
      ...state,
      paramsByModelId: {
        ...state.paramsByModelId,
        [OPUS_LIKE.id]: {
          ...state.paramsByModelId[OPUS_LIKE.id],
          effort: "max",
        },
      },
    });
    state = movePickerModelIndex(state, 1);
    state = movePickerModelIndex(state, -1);
    assert.equal(state.paramsByModelId[OPUS_LIKE.id].effort, "max");
  });

  it("Tab opens params only when model supports them", () => {
    const plain = { id: "gpt-4", displayName: "GPT-4" };
    const catalog = [OPUS_LIKE, plain];
    let state = buildInitialPickerState(
      "orchestrator",
      catalog,
      storedChoiceFromSession("claude-opus-4", []),
    );
    state = movePickerModelIndex(state, 1);
    assert.equal(state.modelIndex, 1);
    assert.equal(modelSupportsParams(plain), false);
    state = toggleShowParams(state);
    assert.equal(state.showParams, false);
    state = movePickerModelIndex(state, -1);
    state = toggleShowParams(state);
    assert.equal(state.showParams, true);
  });

  it("confirm uses stashed params for active model", () => {
    let state = buildInitialPickerState(
      "orchestrator",
      [OPUS_LIKE],
      storedChoiceFromSession("claude-opus-4", []),
    );
    state = {
      ...state,
      showParams: true,
      paramsByModelId: {
        [OPUS_LIKE.id]: {
          context_window: "1m",
          effort: "high",
          thinking: "false",
          fast: "false",
        },
      },
    };
    state = movePickerParamFocus(state, 1);
    const choice = confirmPickerChoice(stashModelParams(state));
    assert.equal(choice.modelId, "claude-opus-4");
    assert.ok(choice.params?.some((p) => p.id === "context_window"));
  });
});

describe("Cursor param picker", () => {
  it("builds uniform radio rows for every parameter", () => {
    const rows = buildCursorParamRows(OPUS_LIKE);
    assert.ok(rows.some((r) => r.kind === "header" && r.label === "Effort"));
    assert.ok(
      rows.filter((r) => r.kind === "option" && r.paramId === "fast").length === 2,
    );
    assert.ok(!rows.some((r) => r.kind === "toggle"));
  });

  it("Tab opens params only when model has SDK parameters", () => {
    const plain = { id: "gpt-4", displayName: "GPT-4" };
    let state = buildInitialPickerState(
      "orchestrator",
      [OPUS_LIKE, plain],
      storedChoiceFromSession("claude-opus-4", []),
    );
    state = movePickerModelIndex(state, 1);
    assert.equal(cursorModelHasParameters(plain), false);
    state = openCursorParams(state);
    assert.equal(state.showParams, false);
    state = movePickerModelIndex(state, -1);
    state = openCursorParams(state);
    assert.equal(state.showParams, true);
  });

  it("arrow keys highlight only; space commits selection", () => {
    let state = buildInitialPickerState(
      "orchestrator",
      [OPUS_LIKE],
      storedChoiceFromSession("claude-opus-4", [
        { id: "effort", value: "medium" },
      ]),
    );
    state = openCursorParams(state);
    assert.equal(state.paramsByModelId[OPUS_LIKE.id].effort, "medium");

    const focusable = buildCursorParamRows(OPUS_LIKE).filter(
      (r) => r.kind === "option",
    );
    const maxIdx = focusable.findIndex(
      (r) => r.paramId === "effort" && r.value === "max",
    );
    state = { ...state, paramFocus: maxIdx };
    assert.equal(state.paramsByModelId[OPUS_LIKE.id].effort, "medium");

    state = commitCursorParamValue(state);
    assert.equal(state.paramsByModelId[OPUS_LIKE.id].effort, "max");
    const choice = confirmPickerChoice(stashModelParams(state));
    assert.deepEqual(
      choice.params?.find((p) => p.id === "effort"),
      { id: "effort", value: "max" },
    );
  });

  it("seeds defaults from isDefault variant", () => {
    const composer = {
      id: "composer-2.5",
      displayName: "Composer 2.5",
      parameters: [
        {
          id: "fast",
          displayName: "Fast",
          values: [{ value: "false" }, { value: "true", displayName: "Fast" }],
        },
      ],
      variants: [
        {
          displayName: "Composer 2.5",
          isDefault: true,
          params: [{ id: "fast", value: "true" }],
        },
        {
          displayName: "Composer 2.5 slow",
          params: [{ id: "fast", value: "false" }],
        },
      ],
    };
    const state = buildInitialPickerState(
      "orchestrator",
      [composer],
      storedChoiceFromSession("composer-2.5", []),
    );
    assert.equal(state.paramsByModelId["composer-2.5"].fast, "true");
  });
});
