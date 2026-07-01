import type { ModelListItem } from "../sdk/types.js";
import { defaultParamValues } from "../models/selection.js";

export type ModelPickerTarget = "orchestrator" | "subagent";

export interface ModelPickerState {
  target: ModelPickerTarget;
  catalog: ModelListItem[];
  modelIndex: number;
  /** Parameter screen open for the highlighted model. */
  showParams: boolean;
  /** Focus index into focusable parameter value rows when showParams is true. */
  paramFocus: number;
  /** Per-model parameter values — persisted while browsing. */
  paramsByModelId: Record<string, Record<string, string>>;
}

export function activePickerModel(state: ModelPickerState): ModelListItem {
  return state.catalog[state.modelIndex] ?? state.catalog[0]!;
}

export function paramValuesForModel(
  state: ModelPickerState,
  item: ModelListItem,
): Record<string, string> {
  const saved = state.paramsByModelId[item.id];
  if (saved) {
    return { ...saved };
  }
  return defaultParamValues(item);
}

export function stashModelParams(state: ModelPickerState): ModelPickerState {
  const item = activePickerModel(state);
  const values = paramValuesForModel(state, item);
  return {
    ...state,
    paramsByModelId: {
      ...state.paramsByModelId,
      [item.id]: { ...values },
    },
  };
}
