import * as vscode from "vscode";
import {
  nativeToolName,
  PAIR_TOOL_CATALOG,
  type PairToolName,
} from "@adaptive-pair/harness";
import type { PairCoordinatorPort } from "@adaptive-pair/runtime";
import { PairLanguageModelTool } from "./pairTool.js";

const STABLE_TOOL_NAMES: readonly PairToolName[] = Object.freeze([
  "pair_get_state",
  "pair_read_scope",
  "pair_search_scope",
  "pair_run_verification",
  "pair_close_session",
]);

const STABLE_TOOL_NAME_SET = new Set(STABLE_TOOL_NAMES);

export const registerPairTools = (
  context: vscode.ExtensionContext,
  coordinator: PairCoordinatorPort,
): void => {
  for (const descriptor of PAIR_TOOL_CATALOG) {
    if (!STABLE_TOOL_NAME_SET.has(descriptor.name)) {
      continue;
    }

    const nativeName = nativeToolName(descriptor.name);
    context.subscriptions.push(
      vscode.lm.registerTool(
        nativeName,
        new PairLanguageModelTool(nativeName, descriptor, coordinator),
      ),
    );
  }
};
