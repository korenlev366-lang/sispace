import { Box, Text } from "ink";
import type { ModelListItem, ModelParameterDefinition } from "../sdk/types.js";
import {
  defaultParamValues,
  formatModelChoiceLabel,
  paramValuesToArray,
  selectionFromVariant,
  type StoredModelChoice,
} from "../models/selection.js";
import { CursorParamPicker, cursorModelHasParameters } from "./CursorParamPicker.js";
import {
  activePickerModel,
  paramValuesForModel,
  stashModelParams,
  type ModelPickerState,
  type ModelPickerTarget,
} from "./model-picker-state.js";

export type { ModelPickerState, ModelPickerTarget } from "./model-picker-state.js";
export {
  activePickerModel,
  paramValuesForModel,
  stashModelParams,
} from "./model-picker-state.js";

interface ModelPickerProps {
  state: ModelPickerState;
  current: StoredModelChoice;
  backend?: "cursor" | "openrouter" | "compatible";
}

export type ParamNavRow =
  | { kind: "header"; label: string }
  | { kind: "option"; paramId: string; value: string; label: string }
  | { kind: "toggle"; paramId: string; label: string };

export function isToggleParam(def: ModelParameterDefinition): boolean {
  const vals = def.values.map((v) => v.value);
  if (vals.length === 2 && vals.includes("true") && vals.includes("false")) {
    return true;
  }
  const id = def.id.toLowerCase();
  return id === "thinking" || id === "fast";
}

export function modelSupportsParams(item: ModelListItem): boolean {
  return Boolean(
    (item.parameters?.length ?? 0) > 0 || (item.variants?.length ?? 0) > 0,
  );
}

export function buildParamNavRows(
  item: ModelListItem,
  values: Record<string, string>,
): ParamNavRow[] {
  const rows: ParamNavRow[] = [];

  for (const def of item.parameters ?? []) {
    if (isToggleParam(def)) {
      rows.push({
        kind: "toggle",
        paramId: def.id,
        label: def.displayName || def.id,
      });
      continue;
    }
    rows.push({ kind: "header", label: def.displayName || def.id });
    for (const v of def.values) {
      rows.push({
        kind: "option",
        paramId: def.id,
        value: v.value,
        label: v.displayName || v.value,
      });
    }
  }

  if (!item.parameters?.length && (item.variants?.length ?? 0) > 0) {
    rows.push({ kind: "header", label: "Variant" });
    for (const v of item.variants ?? []) {
      const label = v.displayName;
      rows.push({
        kind: "option",
        paramId: "__variant__",
        value: label,
        label,
      });
    }
  }

  return rows;
}

function variantMatchesValues(
  params: { id: string; value: string }[],
  values: Record<string, string>,
): boolean {
  if (params.length === 0) {
    return false;
  }
  return params.every((p) => values[p.id] === p.value);
}

export function focusableParamRows(rows: ParamNavRow[]): ParamNavRow[] {
  return rows.filter((r) => r.kind === "option" || r.kind === "toggle");
}

export function buildInitialPickerState(
  target: ModelPickerTarget,
  catalog: ModelListItem[],
  current: StoredModelChoice,
): ModelPickerState {
  let modelIndex = catalog.findIndex((m) => m.id === current.modelId);
  if (modelIndex < 0) {
    modelIndex = 0;
  }
  const item = catalog[modelIndex] ?? catalog[0];
  const initialValues = item
    ? {
        ...defaultParamValues(item),
        ...(current.params
          ? Object.fromEntries(current.params.map((p) => [p.id, p.value]))
          : {}),
      }
    : {};

  const paramsByModelId: Record<string, Record<string, string>> = {};
  if (item) {
    paramsByModelId[item.id] = { ...initialValues };
  }

  return {
    target,
    catalog,
    modelIndex: Math.max(0, modelIndex),
    showParams: false,
    paramFocus: 0,
    paramsByModelId,
  };
}

export function confirmPickerChoice(state: ModelPickerState): StoredModelChoice {
  const item = activePickerModel(state);
  const values = paramValuesForModel(state, item);

  if (!item.parameters?.length && item.variants?.length) {
    const match = item.variants.find((v) =>
      variantMatchesValues(v.params ?? [], values),
    );
    if (match) {
      return selectionFromVariant(item.id, match);
    }
  }

  return {
    modelId: item.id,
    params: paramValuesToArray(values),
  };
}

export function toggleShowParams(state: ModelPickerState): ModelPickerState {
  const item = activePickerModel(state);
  if (!modelSupportsParams(item)) {
    return state;
  }
  const next = !state.showParams;
  return {
    ...stashModelParams(state),
    showParams: next,
    paramFocus: 0,
  };
}

export function movePickerModelIndex(
  state: ModelPickerState,
  delta: number,
): ModelPickerState {
  const n = state.catalog.length;
  if (n === 0) {
    return state;
  }
  const stashed = stashModelParams(state);
  const modelIndex = (stashed.modelIndex + delta + n) % n;
  const item = stashed.catalog[modelIndex]!;
  const existing = stashed.paramsByModelId[item.id];
  const paramsByModelId = {
    ...stashed.paramsByModelId,
    [item.id]: existing ?? defaultParamValues(item),
  };
  return {
    ...stashed,
    modelIndex,
    paramFocus: 0,
    showParams: false,
    paramsByModelId,
  };
}

export function movePickerParamFocus(
  state: ModelPickerState,
  delta: number,
): ModelPickerState {
  const item = activePickerModel(state);
  const rows = focusableParamRows(
    buildParamNavRows(item, paramValuesForModel(state, item)),
  );
  if (rows.length === 0) {
    return state;
  }
  const paramFocus =
    (state.paramFocus + delta + rows.length) % rows.length;
  const next = { ...state, paramFocus };
  const row = rows[paramFocus];
  if (row?.kind === "option") {
    let values = { ...paramValuesForModel(next, item) };
    if (row.paramId === "__variant__") {
      const variant = item.variants?.find((v) => v.displayName === row.value);
      if (variant) {
        for (const p of variant.params ?? []) {
          values[p.id] = p.value;
        }
      }
    } else {
      values = { ...values, [row.paramId]: row.value };
    }
    return stashModelParams({
      ...next,
      paramsByModelId: { ...next.paramsByModelId, [item.id]: values },
    });
  }
  return next;
}

export function applyPickerParamRow(state: ModelPickerState): ModelPickerState {
  const item = activePickerModel(state);
  const values = { ...paramValuesForModel(state, item) };
  const rows = buildParamNavRows(item, values);
  const focusable = focusableParamRows(rows);
  const row = focusable[state.paramFocus];
  if (!row) {
    return state;
  }

  if (row.kind === "toggle") {
    const current = values[row.paramId] === "true";
    values[row.paramId] = current ? "false" : "true";
  } else if (row.kind === "option") {
    if (row.paramId === "__variant__") {
      const variant = item.variants?.find((v) => v.displayName === row.value);
      if (variant) {
        for (const p of variant.params ?? []) {
          values[p.id] = p.value;
        }
      }
    } else {
      values[row.paramId] = row.value;
    }
  }

  return stashModelParams({
    ...state,
    paramsByModelId: {
      ...state.paramsByModelId,
      [item.id]: values,
    },
  });
}

export function cycleFocusedParamValue(
  state: ModelPickerState,
  delta: number,
): ModelPickerState {
  const item = activePickerModel(state);
  const values = { ...paramValuesForModel(state, item) };
  const focusable = focusableParamRows(
    buildParamNavRows(item, values),
  );
  const row = focusable[state.paramFocus];
  if (!row) {
    return state;
  }
  if (row.kind === "toggle") {
    const current = values[row.paramId] === "true";
    values[row.paramId] = current ? "false" : "true";
    return stashModelParams({
      ...state,
      paramsByModelId: { ...state.paramsByModelId, [item.id]: values },
    });
  }
  if (row.kind !== "option" || row.paramId === "__variant__") {
    return state;
  }
  const def = item.parameters?.find((p) => p.id === row.paramId);
  if (!def) {
    return state;
  }
  const options = def.values.map((v) => v.value);
  if (options.length === 0) {
    return state;
  }
  const current = values[row.paramId] ?? options[0]!;
  const idx = options.indexOf(current);
  const next = options[(idx + delta + options.length) % options.length]!;
  values[row.paramId] = next;
  // Update paramFocus to match the new value so the → marker follows.
  const newFocusIdx = focusable.findIndex(
    (r) => r.kind === "option" && r.paramId === row.paramId && r.value === next,
  );
  if (newFocusIdx >= 0) {
    state = { ...state, paramFocus: newFocusIdx };
  }
  return stashModelParams({
    ...state,
    paramsByModelId: {
      ...state.paramsByModelId,
      [item.id]: values,
    },
  });
}

/**
 * Cycle the first tunable parameter (reasoning_effort) for the currently
 * highlighted model — lets the user press Tab to switch effort levels
 * without entering the nested params panel.
 */
export function cycleCurrentModelEffort(
  state: ModelPickerState,
): ModelPickerState {
  const item = activePickerModel(state);
  const defs = item.parameters ?? [];
  // Prefer reasoning_effort; fall back to the first multi-value parameter.
  const targetDef =
    defs.find((d) => d.id === "reasoning_effort") ?? defs[0];
  if (!targetDef || targetDef.values.length < 2) {
    return state;
  }

  const values = { ...paramValuesForModel(state, item) };
  const currentVal = values[targetDef.id] ?? targetDef.values[0]!.value;
  const idx = targetDef.values.findIndex((v) => v.value === currentVal);
  const nextVal =
    targetDef.values[(idx + 1) % targetDef.values.length]!.value;
  values[targetDef.id] = nextVal;

  return stashModelParams({
    ...state,
    paramsByModelId: {
      ...state.paramsByModelId,
      [item.id]: values,
    },
  });
}

/** Legacy CSI arrow sequences when modifyOtherKeys prevents ink key flags. */
export function pickerArrowDelta(
  char: string,
  key: { upArrow?: boolean; downArrow?: boolean; leftArrow?: boolean; rightArrow?: boolean },
): { axis: "vertical" | "horizontal"; delta: number } | null {
  if (key.upArrow || char === "\u001b[A" || char === "\u001bOA") {
    return { axis: "vertical", delta: -1 };
  }
  if (key.downArrow || char === "\u001b[B" || char === "\u001bOB") {
    return { axis: "vertical", delta: 1 };
  }
  if (key.leftArrow || char === "\u001b[D" || char === "\u001bOD") {
    return { axis: "horizontal", delta: -1 };
  }
  if (key.rightArrow || char === "\u001b[C" || char === "\u001bOC") {
    return { axis: "horizontal", delta: 1 };
  }
  return null;
}

/**
 * Model list UI placed under the transcript / above the prompt
 * (same layout slot as PlanPicker and QuestionPicker).
 */
export function ModelPicker({ state, current, backend = "openrouter" }: ModelPickerProps) {
  const title =
    state.target === "orchestrator"
      ? "Model (orchestrator / this session)"
      : "Subagent model (pipeline specialists — not the orchestrator)";

  const currentLabel = formatModelChoiceLabel(current);
  const item = activePickerModel(state);
  const values = paramValuesForModel(state, item);

  if (backend === "cursor" && state.showParams && cursorModelHasParameters(item)) {
    return <CursorParamPicker state={state} />;
  }

  if (state.showParams && modelSupportsParams(item)) {
    const rows = buildParamNavRows(item, values);
    const focusable = focusableParamRows(rows);
    const focused = focusable[state.paramFocus];

    return (
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor="#3a3832"
        paddingX={1}
        marginBottom={1}
      >
        <Text bold color="#d8a657">
          {item.displayName || item.id} — Edit Parameters
        </Text>
        <Text dimColor>
          ↑↓ navigate · ←→ change · Space toggle · Enter select · Esc back
        </Text>
        {rows.map((row, i) => {
          if (row.kind === "header") {
            return (
              <Text key={`h-${row.label}-${i}`} bold>
                {row.label}
              </Text>
            );
          }

          const rowKey =
            row.kind === "toggle"
              ? `t-${row.paramId}`
              : `o-${row.paramId}-${row.value}`;
          const isFocused =
            focused &&
            ((row.kind === "toggle" &&
              focused.kind === "toggle" &&
              focused.paramId === row.paramId) ||
              (row.kind === "option" &&
                focused.kind === "option" &&
                focused.paramId === row.paramId &&
                focused.value === row.value));

          if (row.kind === "toggle") {
            const on = values[row.paramId] === "true";
            const marker = isFocused ? "→ " : "  ";
            return (
              <Text key={rowKey}>
                {marker}
                <Text color={isFocused ? "#d8a657" : "#928d80"}>
                  [{on ? "x" : " "}] {row.label}
                </Text>
              </Text>
            );
          }

          const selected =
            row.paramId === "__variant__"
              ? (() => {
                  const variant = item.variants?.find(
                    (v) => v.displayName === row.value,
                  );
                  return variant
                    ? variantMatchesValues(variant.params ?? [], values)
                    : false;
                })()
              : values[row.paramId] === row.value;
          const marker = isFocused ? "→ " : "  ";
          return (
            <Text key={rowKey}>
              {marker}
              <Text color={isFocused ? "#d8a657" : "#928d80"}>
                {row.label}
              </Text>
              {selected ? <Text color="#89b482"> ✓</Text> : null}
            </Text>
          );
        })}
      </Box>
    );
  }

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="#3a3832"
      paddingX={1}
      marginBottom={1}
    >
      <Text bold color="#d8a657">
        {title}
      </Text>
      <Text dimColor>Current: {currentLabel}</Text>
      <Text dimColor>
        ↑↓ model · Enter select
        {backend === "cursor"
          ? cursorModelHasParameters(item)
            ? " · Tab parameters"
            : ""
          : modelSupportsParams(item)
            ? " · Tab cycle effort · → edit params"
            : ""}{" "}
        · Esc cancel
      </Text>
      {state.catalog.map((m, i) => {
        const highlighted = i === state.modelIndex;
        const marker = highlighted ? "→ " : "  ";
        const desc = m.description ? ` — ${m.description}` : "";
        const paramsHint = modelSupportsParams(m)
          ? ` · ${formatModelChoiceLabel({
              modelId: m.id,
              params: paramValuesToArray(
                paramValuesForModel(state, m),
              ),
            })}`
          : "";
        return (
          <Text key={m.id}>
            {marker}
            <Text color={highlighted ? "#d8a657" : "#928d80"} bold={highlighted}>
              {m.displayName || m.id}
            </Text>
            <Text dimColor>{paramsHint}{desc}</Text>
          </Text>
        );
      })}
    </Box>
  );
}
