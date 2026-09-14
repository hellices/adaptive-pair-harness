import type { ExtensionContext } from "vscode";
import type { AdaptivePairExtensionApi } from "./presenceController.js";
import { createExtensionRuntime } from "./extensionCore.js";

/**
 * The production entry point of the Stable Adaptive Pair preview.
 *
 * It exposes only the read-only state API. No test hook, environment flag, or
 * auto-confirmation path exists here or anywhere else in this module graph, so
 * the shipped bundle cannot contain one (see scripts/build-extension.mjs and
 * scripts/test/productionBundle.test.ts, which fail the build and the suite if
 * a host-test token ever reappears).
 */
export const activate = (
  context: ExtensionContext,
): AdaptivePairExtensionApi => createExtensionRuntime(context).api;

export const deactivate = (): void => {};
