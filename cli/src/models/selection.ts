import type {
  ModelListItem,
  ModelParameterValue,
  ModelSelection,
  ModelVariant,
} from "../sdk/types.js";

export interface StoredModelChoice {
  modelId: string;
  params?: ModelParameterValue[];
}

/** Legacy stored id — maps to OpenRouter default unless fast param is set. */
export const LEGACY_COMPOSER_25_FAST_ID = "composer-2.5-fast";

const LEGACY_TO_OPENROUTER: Record<string, string> = {
  "composer-2.5-fast": "deepseek/deepseek-v4-flash",
  "composer-2.5": "deepseek/deepseek-v4-flash",
  "composer-2": "deepseek/deepseek-v4-flash",
  default: "deepseek/deepseek-v4-flash",
};

export function modelIdToSelection(choice: StoredModelChoice): ModelSelection {
  const raw = choice.modelId?.trim();
  const params = choice.params?.filter((p) => p.id && p.value) ?? [];

  if (raw && LEGACY_TO_OPENROUTER[raw]) {
    return { id: LEGACY_TO_OPENROUTER[raw] };
  }

  if (raw === LEGACY_COMPOSER_25_FAST_ID) {
    return { id: LEGACY_TO_OPENROUTER[raw] ?? "deepseek/deepseek-v4-flash" };
  }

  if (!raw) {
    const hasFast = params.some((p) => p.id === "fast" && p.value === "true");
    if (hasFast) {
      return { id: "deepseek/deepseek-v4-flash", params: [{ id: "fast", value: "true" }] };
    }
    return { id: "deepseek/deepseek-v4-flash" };
  }

  if (params.length > 0) {
    return { id: raw, params };
  }
  return { id: raw };
}

export function selectionFromVariant(
  modelId: string,
  variant: ModelVariant,
): StoredModelChoice {
  return {
    modelId,
    params: variant.params?.length ? [...variant.params] : undefined,
  };
}

export function defaultParamValues(item: ModelListItem): Record<string, string> {
  const values: Record<string, string> = {};
  if (item.variants?.length) {
    const def =
      item.variants.find((v) => v.isDefault) ?? item.variants[0]!;
    for (const p of def.params ?? []) {
      values[p.id] = p.value;
    }
    return values;
  }
  for (const param of item.parameters ?? []) {
    values[param.id] = param.values[0]?.value ?? "";
  }
  return values;
}

export function paramValuesToArray(
  values: Record<string, string>,
): ModelParameterValue[] {
  return Object.entries(values)
    .filter(([, v]) => v !== "")
    .map(([id, value]) => ({ id, value }));
}

export function formatModelChoiceLabel(choice: StoredModelChoice): string {
  const parts = [choice.modelId];
  for (const p of choice.params ?? []) {
    if (p.id === "fast" && p.value === "true") {
      parts.push("fast");
    } else if (p.id === "thinking" && p.value === "true") {
      parts.push("thinking");
    } else if (p.id === "effort" || p.id === "reasoning_effort") {
      parts.push(`${p.id}=${p.value}`);
    } else if (p.id.includes("context") || p.id === "context_window") {
      parts.push(`${p.value}`);
    } else {
      parts.push(`${p.id}=${p.value}`);
    }
  }
  return parts.join(" · ");
}

export function storedChoiceFromSession(
  modelId: string,
  params?: ModelParameterValue[],
): StoredModelChoice {
  return {
    modelId,
    params: params?.length ? params : undefined,
  };
}

export function choicesEqual(a: StoredModelChoice, b: StoredModelChoice): boolean {
  if (a.modelId !== b.modelId) {
    return false;
  }
  const ap = JSON.stringify(a.params ?? []);
  const bp = JSON.stringify(b.params ?? []);
  return ap === bp;
}
