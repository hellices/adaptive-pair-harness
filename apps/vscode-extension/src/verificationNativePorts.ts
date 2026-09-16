import * as vscode from "vscode";
import type {
  ConfirmationPort,
  ConfirmationRequest,
  RunOutcome,
  TestingRunPort,
} from "./verificationContracts.js";

export class VscodeConfirmationPort implements ConfirmationPort {
  public async confirm(
    request: ConfirmationRequest,
    signal: AbortSignal,
  ): Promise<boolean> {
    // Honor cancellation before showing the modal. VS Code exposes no API to
    // programmatically dismiss an open message, so we cannot close it once
    // shown; instead we re-check the signal after it resolves so that an abort
    // that arrives while the modal is open can never lead to execution.
    if (signal.aborted) {
      return false;
    }
    const choice = await vscode.window.showWarningMessage(
      request.summary,
      { modal: true, detail: request.detail },
      "Run Verification",
    );
    if (signal.aborted) {
      return false;
    }
    return choice === "Run Verification";
  }
}

/**
 * The default VS Code stable Testing port. VS Code 1.136 stable's public
 * `vscode.tests` namespace exposes provider-side `createTestController` but no
 * consumer-side API to execute another provider's selected test IDs and observe
 * their completion or results. This port therefore reports itself unavailable
 * and never runs anything: the adapter declines a Testing plan with a typed
 * `testing-api-unavailable` reason. The `TestingRunPort` seam is retained so a
 * future capability-gated host can inject a port that provides observed results;
 * until then, package-script verification remains the complete observed path.
 */
export class StableTestingRunPort implements TestingRunPort {
  public available(): boolean {
    return false;
  }

  public run(): Promise<RunOutcome> {
    return Promise.reject(
      new Error(
        "VS Code stable exposes no consumer API to run selected tests and observe results.",
      ),
    );
  }
}
