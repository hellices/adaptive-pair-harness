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
  public readonly countedTexts: string[] = [];
  public readonly requestedOutputCaps: Array<number | undefined> = [];
  public readonly cancellation = new TestCancellation();
  public sendCalls = 0;
  public fragments: readonly string[] = [
    "Did you intend ",
    "this dependency?",
  ];
  public countTokensImplementation = (text: string): number =>
    Math.max(1, Math.ceil(text.length / 4));
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

  public async countTokens(
    model: CopilotModelReference,
    text: string,
    cancellation: VsCodeRequestCancellation,
  ): Promise<number> {
    void model;
    void cancellation;
    this.countedTexts.push(text);
    return this.countTokensImplementation(text);
  }

  public async sendRequest(
    model: CopilotModelReference,
    prompt: string,
    cancellation: VsCodeRequestCancellation,
    maxOutputTokens?: number,
  ): Promise<AsyncIterable<string>> {
    void model;
    void cancellation;
    this.sendCalls += 1;
    this.prompts.push(prompt);
    this.requestedOutputCaps.push(maxOutputTokens);
    if (this.sendError !== undefined) {
      throw this.sendError;
    }
    const streamError = this.streamError;
    const fragments = this.fragments;
    return (async function* (): AsyncIterable<string> {
      for (const [index, fragment] of fragments.entries()) {
        yield fragment;
        if (index === 0 && streamError !== undefined) {
          throw streamError;
        }
      }
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

  it("caps streamed Copilot output at the request allowance", async () => {
    const api = new RecordingLanguageModelApi();
    const provider = new VsCodeLanguageModelProvider(api);

    const response = await provider.generate(
      {
        ...request,
        maxOutputTokens: 3,
      },
      new AbortController().signal,
    );

    expect(api.countTokensImplementation(response.text)).toBeLessThanOrEqual(3);
    expect(response.outputTokens).toBeGreaterThanOrEqual(
      api.countTokensImplementation(response.text),
    );
    expect(api.requestedOutputCaps).toEqual([3]);
    expect(api.cancellation.cancelled).toBe(true);
  });

  it.each([
    ["CJK", "你好世界", 3],
    ["code-dense", "()=>{x();}", 5],
  ])(
    "uses official token counts to cap %s output and account for the observed fragment",
    async (_label, streamedText, maxOutputTokens) => {
      const api = new RecordingLanguageModelApi();
      api.fragments = [streamedText];
      const prompt = buildCopilotPrompt(request);
      api.countTokensImplementation = (text) =>
        text === prompt ? 37 : Array.from(text).length;
      const provider = new VsCodeLanguageModelProvider(api);

      const response = await provider.generate(
        {
          ...request,
          maxOutputTokens,
        },
        new AbortController().signal,
      );

      expect(Array.from(response.text)).toHaveLength(maxOutputTokens);
      expect(response.outputTokens).toBe(Array.from(streamedText).length);
      expect(api.countedTexts).toContain(streamedText);
      expect(api.requestedOutputCaps).toEqual([maxOutputTokens]);
      expect(api.cancellation.cancelled).toBe(true);
    },
  );

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
      maxOutputTokens: 180,
      maxOutputTokensPerCall: 180,
    });
    const api = new RecordingLanguageModelApi();
    api.access = undefined;
    const provider = new VsCodeLanguageModelProvider(api);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const reservation = budget.tryReserve(100, 180, attempt);
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

    const explicitReservation = budget.tryReserve(100, 180, 2);
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
