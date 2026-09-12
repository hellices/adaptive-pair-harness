import { describe, expect, it } from "vitest";
import type { Evidence } from "../src/core/types";
import {
  CopilotModelUnavailableError,
  VsCodeLanguageModelProvider,
  buildCopilotPrompt,
} from "../src/vscode/vsCodeLanguageModelProvider";
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
  public models: readonly CopilotModelReference[] = [
    {
      id: "copilot-model",
      name: "Copilot model",
    },
  ];
  public access: boolean | undefined = true;

  public async selectChatModels(
    selector: { readonly vendor: "copilot" },
  ): Promise<readonly CopilotModelReference[]> {
    this.selectors.push(selector);
    return this.models;
  }

  public canSendRequest(model: CopilotModelReference): boolean | undefined {
    void model;
    return this.access;
  }

  public createCancellationTokenSource(): VsCodeRequestCancellation {
    return this.cancellation;
  }

  public async sendRequest(
    model: CopilotModelReference,
    prompt: string,
    cancellation: VsCodeRequestCancellation,
  ): Promise<AsyncIterable<string>> {
    void model;
    void cancellation;
    this.prompts.push(prompt);
    return (async function* (): AsyncIterable<string> {
      yield "Did you intend ";
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
    ).rejects.toBeInstanceOf(CopilotModelUnavailableError);
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
});
