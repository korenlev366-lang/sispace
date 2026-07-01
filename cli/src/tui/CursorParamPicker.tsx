import { Box, Text } from "ink";
import type { ModelListItem, ModelParameterDefinition } from "../sdk/types.js";
import {
  activePickerModel,
  paramValuesForModel,
  stashModelParams,
  type ModelPickerState,
} from "./model-picker-state.js";

export type CursorParamRow =
  | { kind: "header"; paramId: string; label: string }
  | { kind: "option"; paramId: string; value: string; label: string }
  | { kind: "toggle"; paramId: string; label: string };

/** Exactly two values, both "false" and "true" — matches thinking/fast, not context/effort. */
export function isCursorBooleanParam(def: ModelParameterDefinition): boolean {
  const vals = def.values.map((v) => v.value);
  return vals.length === 2 && vals.includes("false") && vals.includes("true");
}

export function cursorModelHasParameters(item: ModelListItem): boolean {
  return (item.parameters?.length ?? 0) > 0;
}

export function buildCursorParamRows(item: ModelListItem): CursorParamRow[] {
  const rows: CursorParamRow[] = [];
  for (const def of item.parameters ?? []) {
    if (isCursorBooleanParam(def)) {
      rows.push({
        kind: "toggle",
        paramId: def.id,
        label: def.displayName || def.id,
      });
      continue;
    }
    rows.push({
      kind: "header",
      paramId: def.id,
      label: def.displayName || def.id,
    });
    for (const v of def.values) {
      rows.push({
        kind: "option",
        paramId: def.id,
        value: v.value,
        label: v.displayName || v.value,
      });
    }
  }
  return rows;
}

export type CursorParamOptionRow = Extract<CursorParamRow, { kind: "option" }>;
export type CursorParamToggleRow = Extract<CursorParamRow, { kind: "toggle" }>;
export type CursorParamFocusRow = CursorParamOptionRow | CursorParamToggleRow;

export function cursorFocusableRows(rows: CursorParamRow[]): CursorParamFocusRow[] {
  return rows.filter(
    (r): r is CursorParamFocusRow => r.kind === "option" || r.kind === "toggle",
  );
}

export function openCursorParams(state: ModelPickerState): ModelPickerState {
  const item = activePickerModel(state);
  if (!cursorModelHasParameters(item)) {
    return state;
  }
  return {
    ...stashModelParams(state),
    showParams: true,
    paramFocus: 0,
  };
}

export function closeCursorParams(state: ModelPickerState): ModelPickerState {
  return { ...state, showParams: false };
}

export function moveCursorParamFocus(
  state: ModelPickerState,
  delta: number,
): ModelPickerState {
  const item = activePickerModel(state);
  const focusable = cursorFocusableRows(buildCursorParamRows(item));
  if (focusable.length === 0) {
    return state;
  }
  const paramFocus =
    (state.paramFocus + delta + focusable.length) % focusable.length;
  return { ...state, paramFocus };
}

export function commitCursorParamValue(state: ModelPickerState): ModelPickerState {
  const item = activePickerModel(state);
  const values = { ...paramValuesForModel(state, item) };
  const focusable = cursorFocusableRows(buildCursorParamRows(item));
  const row = focusable[state.paramFocus];
  if (!row) {
    return state;
  }
  if (row.kind === "toggle") {
    values[row.paramId] = values[row.paramId] === "true" ? "false" : "true";
  } else {
    values[row.paramId] = row.value;
  }
  return stashModelParams({
    ...state,
    paramsByModelId: {
      ...state.paramsByModelId,
      [item.id]: values,
    },
  });
}

interface CursorParamPickerProps {
  state: ModelPickerState;
}

export function CursorParamPicker({ state }: CursorParamPickerProps) {
  const item = activePickerModel(state);
  const values = paramValuesForModel(state, item);
  const rows = buildCursorParamRows(item);
  const focusable = cursorFocusableRows(rows);
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
        {item.displayName || item.id} — Parameters
      </Text>
      <Text dimColor>
        ↑↓ highlight · Space select · Enter confirm · Esc back
      </Text>
      {rows.map((row, i) => {
        if (row.kind === "toggle") {
          const on = values[row.paramId] === "true";
          const marker = on ? "●" : "○";
          const isFocused =
            focused !== undefined &&
            focused.kind === "toggle" &&
            focused.paramId === row.paramId;
          return (
            <Text key={`t-${row.paramId}`}>
              <Text color={isFocused ? "#d8a657" : "#928d80"}>
                {marker} {row.label}
              </Text>
            </Text>
          );
        }

        if (row.kind === "header") {
          return (
            <Text key={`h-${row.paramId}-${i}`} bold>
              {row.label}
            </Text>
          );
        }

        if (row.kind !== "option") {
          return null;
        }

        const selected = values[row.paramId] === row.value;
        const isFocused =
          focused !== undefined &&
          focused.kind === "option" &&
          row.paramId === focused.paramId &&
          row.value === focused.value;
        const marker = selected ? "●" : "○";
        return (
          <Text key={`o-${row.paramId}-${row.value}`}>
            {"  "}
            <Text color={isFocused ? "#d8a657" : "#928d80"}>
              {marker} {row.label}
            </Text>
          </Text>
        );
      })}
    </Box>
  );
}
