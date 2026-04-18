/**
 * Model Extractor - Extract model information from AI Group data
 *
 * Parses and extracts model information from semantic steps and subagent processes.
 */

import { type ModelInfo, parseModelString } from '@shared/utils/modelParser';

import type { Process, SemanticStep } from '@renderer/types/data';

/**
 * Extract the main model used in an AI Group.
 *
 * Strategy:
 * 1. Look through semantic steps to find tool_call steps with sourceModel
 * 2. Count occurrences of each model
 * 3. Return the most common model (in case of mixed usage)
 *
 * @param steps - Semantic steps from the AI Group
 * @returns The most common model info, or null if no models found
 */
export function extractMainModel(steps: SemanticStep[]): ModelInfo | null {
  const modelCounts = new Map<string, { count: number; info: ModelInfo }>();

  for (const step of steps) {
    // Tool call steps have sourceModel set from the assistant message
    if (step.type === 'tool_call' && step.content.sourceModel) {
      const model = step.content.sourceModel;
      if (model && model !== '<synthetic>') {
        const info = parseModelString(model);
        if (info) {
          const existing = modelCounts.get(info.name);
          if (existing) {
            existing.count++;
          } else {
            modelCounts.set(info.name, { count: 1, info });
          }
        }
      }
    }
  }

  // Find most common model
  let maxCount = 0;
  let mainModel: ModelInfo | null = null;

  for (const { count, info } of modelCounts.values()) {
    if (count > maxCount) {
      maxCount = count;
      mainModel = info;
    }
  }

  return mainModel;
}

/**
 * Extract unique models used by subagents that differ from the main model.
 *
 * Strategy:
 * 1. Iterate through all processes (subagents)
 * 2. Read the model from `displayMeta.modelName` (precomputed in main process).
 *    This works even when `process.messages` has been stripped by the worker
 *    output for memory-bound caching.
 * 3. Fall back to scanning messages only if displayMeta is absent.
 * 4. Parse and collect unique models that differ from mainModel.
 *
 * @param processes - Subagent processes from the AI Group
 * @param mainModel - The main agent's model (to filter out)
 * @returns Array of unique model infos used by subagents
 */
export function extractSubagentModels(
  processes: Process[],
  mainModel: ModelInfo | null
): ModelInfo[] {
  const uniqueModels = new Map<string, ModelInfo>();

  for (const process of processes) {
    let modelString: string | undefined = process.displayMeta?.modelName ?? undefined;

    // Legacy fallback for code paths that haven't populated displayMeta.
    if (!modelString) {
      const assistantMsg = process.messages?.find(
        (m) => m.type === 'assistant' && m.model && m.model !== '<synthetic>'
      );
      modelString = assistantMsg?.model;
    }

    if (modelString) {
      const modelInfo = parseModelString(modelString);
      if (modelInfo && modelInfo.name !== mainModel?.name) {
        uniqueModels.set(modelInfo.name, modelInfo);
      }
    }
  }

  return Array.from(uniqueModels.values());
}
