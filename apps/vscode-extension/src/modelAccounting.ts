import type * as vscode from "vscode";
import type { ActivityLedger } from "./activityLedger.js";
import type { GrowthModel } from "./modelAdapter.js";

/**
 * Wrap a Growth model factory so every dispatched language-model request is
 * counted once on the shared {@link ActivityLedger}.
 *
 * This is the single accounting path: the production entry point and the
 * isolated Extension Host entry point both build their Growth participant with
 * this factory, so the host smoke observes exactly the instrumentation that
 * ships rather than a host-only duplicate wrapper.
 *
 * The request is counted before it is dispatched, because the boundary is
 * crossed whether or not the model answers.
 *
 * @param ledger the activation's shared activity ledger
 * @param createModel builds the real model adapter for a chat model
 */
export const accountedModelFactory =
  (
    ledger: ActivityLedger,
    createModel: (model: vscode.LanguageModelChat) => GrowthModel,
  ): ((model: vscode.LanguageModelChat) => GrowthModel) =>
  (model: vscode.LanguageModelChat): GrowthModel => {
    const growthModel = createModel(model);
    return {
      request: (instructions, tools, signal) => {
        ledger.recordModelRequest();
        return growthModel.request(instructions, tools, signal);
      },
    };
  };
