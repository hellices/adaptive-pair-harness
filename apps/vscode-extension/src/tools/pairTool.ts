import * as vscode from "vscode";
import type {
  NativePairToolName,
  PairToolDescriptor,
} from "@adaptive-pair/harness";
import type { PairCoordinatorPort } from "@adaptive-pair/runtime";

const sanitizeInput = (
  input: Readonly<Record<string, unknown>>,
): {
  readonly toolInput: Readonly<Record<string, unknown>>;
  readonly runtimeRevision?: number;
  readonly authorityEpoch?: number;
} => {
  const { runtimeRevision, authorityEpoch, ...toolInput } = input;
  return {
    toolInput,
    ...(typeof runtimeRevision === "number" ? { runtimeRevision } : {}),
    ...(typeof authorityEpoch === "number" ? { authorityEpoch } : {}),
  };
};

const denialPayload = (error: unknown): Record<string, unknown> => {
  const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";

  switch (message) {
    case "TOOL_HIDDEN":
      return {
        status: "denied",
        reason: "tool-hidden",
        summary: "Adaptive Pair denied the tool in the current phase.",
      };
    case "STALE_TOOL_VIEW":
      return {
        status: "denied",
        reason: "stale-tool-view",
        summary: "Adaptive Pair state changed. Refresh pair state and try again.",
      };
    case "WRONG_OWNER":
      return {
        status: "denied",
        reason: "wrong-owner",
        summary: "Adaptive Pair denied the tool for the current work-unit owner.",
      };
    case "USER_ACTION_REQUIRED":
      return {
        status: "denied",
        reason: "user-action-required",
        summary: "Adaptive Pair requires a fresh one-time developer action.",
      };
    case "UNSUPPORTED_TOOL_CATALOG_VERSION":
      return {
        status: "denied",
        reason: "unsupported-tool-catalog-version",
        summary: "Adaptive Pair tooling is out of date for this request.",
      };
    default:
      return {
        status: "failed",
        reason: "host-error",
        summary: "Adaptive Pair could not complete the tool request.",
      };
  }
};

export class PairLanguageModelTool implements vscode.LanguageModelTool<Record<string, unknown>> {
  public constructor(
    public readonly nativeName: NativePairToolName,
    private readonly descriptor: PairToolDescriptor,
    private readonly coordinator: PairCoordinatorPort,
  ) {}

  public async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<Record<string, unknown>>,
    token: vscode.CancellationToken,
  ): Promise<vscode.PreparedToolInvocation> {
    void options;
    void token;
    const snapshot = await this.coordinator.snapshot();
    return {
      invocationMessage: `Adaptive Pair: ${this.descriptor.name} (${this.descriptor.effectClass})`,
      ...(this.descriptor.requiresConsent
        ? {
            confirmationMessages: {
              title: `Allow ${this.descriptor.name}?`,
              message: new vscode.MarkdownString().appendText(
                `Mode: ${snapshot.session?.mode ?? "unselected"}; owner: ${snapshot.session?.workUnit?.owner ?? "none"}; scope: ${snapshot.session?.workUnit?.allowedPaths.join(", ") || "none"}; operation class: ${this.descriptor.effectClass}.`,
              ),
            },
          }
        : {}),
    };
  }

  public async invoke(
    options: vscode.LanguageModelToolInvocationOptions<Record<string, unknown>>,
    token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelToolResult> {
    const controller = new AbortController();
    const cancel = (): void => controller.abort();
    const cancellation = token.onCancellationRequested(cancel);
    if (token.isCancellationRequested) {
      cancel();
    }

    try {
      let userActionId: string | undefined;
      if (this.descriptor.requiresExplicitUserAction) {
        const choice = await vscode.window.showWarningMessage(
          `${this.descriptor.name} requires an explicit one-time action.`,
          { modal: true },
          "Continue once",
        );
        if (choice !== "Continue once") {
          return this.createResult({
            status: "declined",
            reason: "user-declined",
            summary: "The developer declined the one-time action.",
          });
        }
        userActionId = await this.coordinator.grantUserAction(
          this.descriptor.name,
          controller.signal,
        );
      }

      const { toolInput, runtimeRevision, authorityEpoch } = sanitizeInput(
        options.input,
      );
      const result = await this.coordinator.invokeTool(
        this.descriptor.name,
        toolInput,
        controller.signal,
        {
          ...(userActionId === undefined ? {} : { userActionId }),
          ...(runtimeRevision === undefined ? {} : { runtimeRevision }),
          ...(authorityEpoch === undefined ? {} : { authorityEpoch }),
        },
      );
      return this.createResult({
        ...result,
        observation: result.observation,
      });
    } catch (error) {
      return this.createResult(denialPayload(error));
    } finally {
      cancellation.dispose();
      controller.abort();
    }
  }

  private createResult(payload: unknown): vscode.LanguageModelToolResult {
    return new vscode.LanguageModelToolResult([
      new vscode.LanguageModelTextPart(JSON.stringify(payload)),
    ]);
  }
}
