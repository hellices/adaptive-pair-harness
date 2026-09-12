import { describe, expect, it } from "vitest";
import type { Evidence } from "../src/core/types";
import {
  CopilotModelUnavailableError,
  VsCodeLanguageModelProvider,
  buildCopilotPrompt,
  releaseUnusedCopilotReservation,
} from "../src/vscode/vsCodeLanguageModelProvider";
import { TokenBudget } from "../src/core/tokenBudget";
import type {
  CopilotModelReference,
  VsCodeLanguageModelApi,
  VsCodeRequestCancellation,
} from "../src/vscode/vsCodeLanguageModelProvider";

const evidence: Evidence = {
  id: "dependency:repository",
  kind: "new-dependency",
  severity: "warning",
  title: "New dependency introduced",
  detail: "Imported a new module dependency: ./repository.",
  source: "typescript-semantic-analyzer",
  confidence: 0.94,
  range: {
    start: { line: 2, character: 18 },
    end: { line: 2, character: 32 },
  },
  references: ["./repository"],
};

const request = {
  goal: "Ask a concise, evidence-backed question.",
  evidence,
  interactionStyle: "ask-first" as const,
};

class TestCancellation implements VsCodeRequestCancellation {
  public cancelled = false;
  public disposed = false;

  public cancel(): void {
    this.cancelled = true;
  }

  public dispose(): void {
    this.disposed = true;
  }
}

class RecordingLanguageModelApi implements VsCodeLanguageModelApi {
  public readonly selectors: Array<{ readonly vendor: "copilot" }> = [];
  public readonly prompts: string[] = [];
  public readonly cancellation = new TestCancellation();
  public sendCalls = 0;
  public models: readonly CopilotModelReference[] = [
    {
      id: "copilot-model",
      name: "Copilot model",
    },
  ];
  public access: boolean | undefined = true;
  public selectError: Error | undefined;
  public sendError: Error | undefined;
  public streamError: Error | undefined;
  public onSelect: (() => void) | undefined;
  public errorKinds = new Map<
    Error,
    "no-permissions" | "not-found" | "blocked" | "cancelled" | "unknown"
  >();

  public async selectChatModels(
    selector: { readonly vendor: "copilot" },
  ): Promise<readonly CopilotModelReference[]> {
    this.selectors.push(selector);
    this.onSelect?.();
    if (this.selectError !== undefined) {
      throw this.selectError;
    }
    return this.models;
  }

  public canSendRequest(model: CopilotModelReference): boolean | undefined {
    void model;
    return this.access;
  }

  public createCancellationTokenSource(): VsCodeRequestCancellation {
    return this.cancellation;
  }

  public classifyError(
    error: unknown,
  ): "no-permissions" | "not-found" | "blocked" | "cancelled" | "unknown" {
    return error instanceof Error
      ? (this.errorKinds.get(error) ?? "unknown")
      : "unknown";
  }

  public async sendRequest(
    model: CopilotModelReference,
    prompt: string,
    cancellation: VsCodeRequestCancellation,
  ): Promise<AsyncIterable<string>> {
    void model;
    void cancellation;
    this.sendCalls += 1;
    this.prompts.push(prompt);
    if (this.sendError !== undefined) {
      throw this.sendError;
    }
    const streamError = this.streamError;
    return (async function* (): AsyncIterable<string> {
      yield "Did you intend ";
      if (streamError !== undefined) {
        throw streamError;
      }
      yield "this dependency?";
    })();
  }
}

describe("VsCodeLanguageModelProvider", () => {
  it("selects an official Copilot model and streams a structured prompt", async () => {
    const api = new RecordingLanguageModelApi();
    const provider = new VsCodeLanguageModelProvider(api);

    await expect(
      provider.generate(request, new AbortController().signal),
    ).resolves.toMatchObject({
      text: "Did you intend this dependency?",
      inputTokens: expect.any(Number),
      outputTokens: expect.any(Number),
    });
    expect(api.selectors).toEqual([{ vendor: "copilot" }]);
    expect(api.prompts).toEqual([buildCopilotPrompt(request)]);
    expect(api.prompts[0]).not.toContain("previousText");
    expect(api.prompts[0]).not.toContain("currentText");
    expect(api.cancellation.disposed).toBe(true);
  });

  it("throws a typed error when no Copilot model is available", async () => {
    const api = new RecordingLanguageModelApi();
    api.models = [];
    const provider = new VsCodeLanguageModelProvider(api);

    await expect(
      provider.generate(request, new AbortController().signal),
    ).rejects.toMatchObject({
      name: "CopilotModelUnavailableError",
      requestMayHaveBeenSent: false,
    });
  });

  it("cancels the VS Code token source when the request becomes stale", async () => {
    const api = new RecordingLanguageModelApi();
    const provider = new VsCodeLanguageModelProvider(api);
    const abortController = new AbortController();
    abortController.abort();

    await expect(provider.generate(request, abortController.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(api.cancellation.cancelled).toBe(true);
    expect(api.cancellation.disposed).toBe(true);
  });

  it("does not start a model request when cancellation arrives during selection", async () => {
    const api = new RecordingLanguageModelApi();
    const provider = new VsCodeLanguageModelProvider(api);
    const abortController = new AbortController();
    api.onSelect = () => {
      abortController.abort();
    };

    await expect(
      provider.generate(request, abortController.signal),
    ).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(api.sendCalls).toBe(0);
    expect(api.cancellation.cancelled).toBe(true);
  });

  it("requires prior consent for proactive requests but allows user-initiated consent", async () => {
    const api = new RecordingLanguageModelApi();
    api.access = undefined;
    const provider = new VsCodeLanguageModelProvider(api);

    await expect(
      provider.generate(request, new AbortController().signal),
    ).rejects.toMatchObject({
      reason: "consent-required",
    });
    await expect(
      provider.generateFromUserAction(request, new AbortController().signal),
    ).resolves.toMatchObject({
      text: "Did you intend this dependency?",
    });
  });

  it.each([
    ["no-permissions", "access-denied"],
    ["not-found", "no-model"],
  ] as const)(
    "maps official %s failures to typed unavailability",
    async (kind, reason) => {
      const api = new RecordingLanguageModelApi();
      const failure = new Error(kind);
      api.sendError = failure;
      api.errorKinds.set(failure, kind);
      const provider = new VsCodeLanguageModelProvider(api);

      await expect(
        provider.generateFromUserAction(
          request,
          new AbortController().signal,
        ),
      ).rejects.toMatchObject({
        name: "CopilotModelUnavailableError",
        reason,
        requestMayHaveBeenSent: true,
      });
    },
  );

  it("maps unavailable errors raised while consuming the response stream", async () => {
    const api = new RecordingLanguageModelApi();
    const failure = new Error("model disappeared");
    api.streamError = failure;
    api.errorKinds.set(failure, "not-found");
    const provider = new VsCodeLanguageModelProvider(api);

    await expect(
      provider.generateFromUserAction(request, new AbortController().signal),
    ).rejects.toMatchObject({
      name: "CopilotModelUnavailableError",
      reason: "no-model",
      requestMayHaveBeenSent: true,
    });
  });

  it("maps unavailable model-selection errors", async () => {
    const api = new RecordingLanguageModelApi();
    const failure = new Error("selection denied");
    api.selectError = failure;
    api.errorKinds.set(failure, "no-permissions");
    const provider = new VsCodeLanguageModelProvider(api);

    await expect(
      provider.generateFromUserAction(request, new AbortController().signal),
    ).rejects.toMatchObject({
      name: "CopilotModelUnavailableError",
      reason: "access-denied",
      requestMayHaveBeenSent: false,
    });
  });

  it("returns repeated preflight-unavailable reservations without refunding sent requests", async () => {
    const budget = new TokenBudget({
      windowMs: 60_000,
      maxCalls: 1,
      maxInputTokens: 1_000,
    });
    const api = new RecordingLanguageModelApi();
    api.access = undefined;
    const provider = new VsCodeLanguageModelProvider(api);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const reservation = budget.tryReserve(100, attempt);
      if (!reservation.allowed) {
        throw new Error("Preflight failure unexpectedly exhausted the budget.");
      }
      try {
        await provider.generate(request, new AbortController().signal);
      } catch (error: unknown) {
        expect(
          releaseUnusedCopilotReservation(
            budget,
            reservation.reservationId,
            error,
          ),
        ).toBe(true);
      }
    }

    const explicitReservation = budget.tryReserve(100, 2);
    expect(explicitReservation.allowed).toBe(true);
    await expect(
      provider.generateFromUserAction(request, new AbortController().signal),
    ).resolves.toMatchObject({ text: "Did you intend this dependency?" });
    expect(api.sendCalls).toBe(1);

    if (!explicitReservation.allowed) {
      throw new Error("Expected explicit action to reserve budget.");
    }
    const sentFailure = new CopilotModelUnavailableError(
      "access-denied",
      true,
    );
    expect(
      releaseUnusedCopilotReservation(
        budget,
        explicitReservation.reservationId,
        sentFailure,
      ),
    ).toBe(false);
    expect(budget.snapshot(3).remainingCalls).toBe(0);
  });

  it.each(["blocked", "unknown", "cancelled"] as const)(
    "propagates official %s failures without unavailable fallback",
    async (kind) => {
      const api = new RecordingLanguageModelApi();
      const failure = new Error(kind);
      api.sendError = failure;
      api.errorKinds.set(failure, kind);
      const provider = new VsCodeLanguageModelProvider(api);

      await expect(
        provider.generateFromUserAction(
          request,
          new AbortController().signal,
        ),
      ).rejects.toBe(failure);
    },
  );
});
