import { modelIdToSelection } from "./model-selection.mjs";

export const DEFAULT_ORCHESTRATOR_MODEL = "composer-2.5";
export const DEFAULT_SUBAGENT_MODEL = "composer-2.5";

function normalizePipelineModelId(modelId) {
  return modelIdToSelection(modelId).id;
}

/** Resolve orchestrator vs subagent model ids from a pipeline run body. */
export function resolvePipelineModels(body = {}) {
  const orchestrator = normalizePipelineModelId(body.model ?? DEFAULT_ORCHESTRATOR_MODEL);
  const subagent = normalizePipelineModelId(
    body.subagentModel ?? body.model ?? DEFAULT_SUBAGENT_MODEL,
  );
  return { orchestrator, subagent };
}
