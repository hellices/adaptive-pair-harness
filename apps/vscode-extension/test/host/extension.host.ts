import * as vscode from "vscode";
import { createExtensionRuntime } from "../../src/extensionCore.js";
import type {
  ConfirmationPort,
  ConfirmationRequest,
} from "../../src/verificationAdapter.js";
import { createHostTestApi, type HostTestApi } from "./hostTestApi.js";

export const HOST_TEST_FLAG = "ADAPTIVE_PAIR_HOST_TEST";

/**
 * Auto-approves the verification confirmation inside the isolated host smoke,
 * where no developer is present to answer a modal. It lives only in this
 * host-test entry point; production always uses the real modal port.
 */
class HostTestAutoConfirmPort implements ConfirmationPort {
  public confirm(request: ConfirmationRequest, signal: AbortSignal): Promise<boolean> {
    void request;
    return Promise.resolve(!signal.aborted);
  }
}

export interface HostTestExports {
  getState(): ReturnType<HostTestApi["getState"]>;
  readonly __pairHostTest: HostTestApi;
}

/**
 * The host-test entry point. It is bundled only by
 * `scripts/test-extension-host.mjs` into the throwaway `.host-test`
 * development extension and is never part of `npm run build` or
 * `npm run package`.
 *
 * Two independent gates must both hold: the extension may not run in
 * `ExtensionMode.Production`, and the explicit host-test flag must be set.
 * Either gate failing is a hard failure, never a silent fallback.
 */
export const activate = (context: vscode.ExtensionContext): HostTestExports => {
  if (context.extensionMode === vscode.ExtensionMode.Production) {
    throw new Error(
      "The Adaptive Pair host-test entry point refuses to activate in ExtensionMode.Production.",
    );
  }
  if (process.env[HOST_TEST_FLAG] !== "1") {
    throw new Error(
      `The Adaptive Pair host-test entry point requires ${HOST_TEST_FLAG}=1.`,
    );
  }

  const runtime = createExtensionRuntime(context, {
    confirmation: new HostTestAutoConfirmPort(),
  });

  return Object.freeze({
    getState: () => runtime.presenceController.getState(),
    __pairHostTest: createHostTestApi({
      coordinator: runtime.coordinator,
      ledger: runtime.ledger,
      presenceController: runtime.presenceController,
      sessionController: runtime.sessionController,
      context,
    }),
  });
};

export const deactivate = (): void => {};
