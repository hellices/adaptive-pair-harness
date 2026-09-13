import { describe, expect, it, vi } from "vitest";
import type { Evidence, PairRange } from "../src/core/types";

const deferred = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

const selection: PairRange = {
  start: { line: 4, character: 0 },
  end: { line: 8, character: 0 },
};

const evidence: Evidence = {
  id: "real-evidence",
  kind: "complexity-growth",
  severity: "warning",
  title: "Control-flow complexity increased",
  detail: "Added two branch points.",
  source: "typescript-semantic-analyzer",
  confidence: 0.89,
  range: {
    start: { line: 5, character: 0 },
    end: { line: 6, character: 1 },
  },
  references: ["handleRequest"],
};

describe("Pair runtime support", () => {
  it("does not create a replacement runtime after disposal during secret lookup", async () => {
    const { createRuntimeAfterSecretLookup } = await import(
      "../src/vscode/pairRuntimeSupport"
    );
    const secret = deferred<string | undefined>();
    let disposed = false;
    const createRuntime = vi.fn((apiKey: string | undefined) => ({ apiKey }));

    const pending = createRuntimeAfterSecretLookup(
      () => secret.promise,
      () => disposed,
      createRuntime,
    );
    disposed = true;
    secret.resolve("stored-secret");

    await expect(pending).resolves.toBeUndefined();
    expect(createRuntime).not.toHaveBeenCalled();
  });

  it("disposes a replacement completed after extension ownership is lost", async () => {
    const { rebuildRuntimeAfterDisposal } = await import(
      "../src/vscode/pairRuntimeSupport"
    );
    const rebuild = rebuildRuntimeAfterDisposal as <
      TRuntime extends { dispose(): void },
    >(
      previous: TRuntime | undefined,
      createReplacement: () => PromiseLike<TRuntime | undefined>,
      install: (runtime: TRuntime | undefined) => void,
      canInstallReplacement: () => boolean,
    ) => Promise<void>;
    const replacementCompletion = deferred<{ dispose(): void }>();
    const previousDispose = vi.fn();
    const replacementDispose = vi.fn();
    const previous: { dispose(): void } = { dispose: previousDispose };
    const replacement: { dispose(): void } = {
      dispose: replacementDispose,
    };
    let runtime: { dispose(): void } | undefined = previous;
    let extensionDisposed = false;

    const pending = rebuild(
      previous,
      () => replacementCompletion.promise,
      (next) => {
        runtime = next;
      },
      () => !extensionDisposed && runtime === undefined,
    );
    extensionDisposed = true;
    replacementCompletion.resolve(replacement);

    await expect(pending).resolves.toBeUndefined();
    expect(previousDispose).toHaveBeenCalledOnce();
    expect(replacementDispose).toHaveBeenCalledOnce();
    expect(runtime).toBeUndefined();
  });

  it("aggregates rejected replacement cleanup after extension disposal without restoring state", async () => {
    const { rebuildRuntimeAfterDisposal } = await import(
      "../src/vscode/pairRuntimeSupport"
    );
    const rebuild = rebuildRuntimeAfterDisposal as <
      TRuntime extends { dispose(): void },
    >(
      previous: TRuntime | undefined,
      createReplacement: () => PromiseLike<TRuntime | undefined>,
      install: (runtime: TRuntime | undefined) => void,
      canInstallReplacement: () => boolean,
    ) => Promise<void>;
    const replacementCompletion = deferred<{ dispose(): void }>();
    const previousFailure = new Error("previous runtime cleanup failed");
    const replacementFailure = new Error(
      "disposed replacement cleanup failed",
    );
    const previous = {
      dispose: () => {
        throw previousFailure;
      },
    };
    const replacement = {
      dispose: () => {
        throw replacementFailure;
      },
    };
    let runtime: { dispose(): void } | undefined = previous;
    let extensionDisposed = false;

    const pending = rebuild(
      previous,
      () => replacementCompletion.promise,
      (next) => {
        runtime = next;
      },
      () => !extensionDisposed && runtime === undefined,
    );
    extensionDisposed = true;
    replacementCompletion.resolve(replacement);

    let failure: unknown;
    try {
      await pending;
    } catch (error: unknown) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toEqual([
      previousFailure,
      replacementFailure,
    ]);
    expect(runtime).toBeUndefined();
  });

  it("installs a replacement after disposal fails and permits a later rebuild", async () => {
    const module = (await import(
      "../src/vscode/pairRuntimeSupport"
    )) as typeof import("../src/vscode/pairRuntimeSupport") & {
      rebuildRuntimeAfterDisposal<TRuntime extends { dispose(): void }>(
        previous: TRuntime | undefined,
        createReplacement: () => PromiseLike<TRuntime | undefined>,
        install: (runtime: TRuntime | undefined) => void,
      ): Promise<void>;
    };
    expect(module.rebuildRuntimeAfterDisposal).toBeTypeOf("function");
    const disposalFailure = new Error("old runtime cleanup failed");
    const oldDispose = vi.fn(() => {
      throw disposalFailure;
    });
    const replacementDispose = vi.fn();
    const oldRuntime: { dispose(): void } = { dispose: oldDispose };
    const replacement: { dispose(): void } = {
      dispose: replacementDispose,
    };
    const laterReplacement: { dispose(): void } = {
      dispose: vi.fn(),
    };
    let runtime: { dispose(): void } | undefined = oldRuntime;
    const install = vi.fn((next: { dispose(): void } | undefined) => {
      runtime = next;
    });
    const createReplacement = vi.fn(async () => replacement);

    await expect(
      module.rebuildRuntimeAfterDisposal(
        runtime,
        createReplacement,
        install,
      ),
    ).rejects.toBe(disposalFailure);

    expect(oldDispose).toHaveBeenCalledOnce();
    expect(createReplacement).toHaveBeenCalledOnce();
    expect(runtime).toBe(replacement);

    await expect(
      module.rebuildRuntimeAfterDisposal(
        runtime,
        async () => laterReplacement,
        install,
      ),
    ).resolves.toBeUndefined();

    expect(replacementDispose).toHaveBeenCalledOnce();
    expect(runtime).toBe(laterReplacement);
  });

  it("aggregates disposal and replacement failures without retaining the old runtime", async () => {
    const module = (await import(
      "../src/vscode/pairRuntimeSupport"
    )) as typeof import("../src/vscode/pairRuntimeSupport") & {
      rebuildRuntimeAfterDisposal<TRuntime extends { dispose(): void }>(
        previous: TRuntime | undefined,
        createReplacement: () => PromiseLike<TRuntime | undefined>,
        install: (runtime: TRuntime | undefined) => void,
      ): Promise<void>;
    };
    expect(module.rebuildRuntimeAfterDisposal).toBeTypeOf("function");
    const disposalFailure = new Error("old runtime cleanup failed");
    const replacementFailure = new Error("replacement creation failed");
    const oldRuntime: { dispose(): void } = {
      dispose: () => {
        throw disposalFailure;
      },
    };
    const recoveredRuntime: { dispose(): void } = {
      dispose: vi.fn(),
    };
    let runtime: { dispose(): void } | undefined = oldRuntime;
    const install = (next: { dispose(): void } | undefined): void => {
      runtime = next;
    };

    let failure: unknown;
    try {
      await module.rebuildRuntimeAfterDisposal(
        runtime,
        async () => {
          throw replacementFailure;
        },
        install,
      );
    } catch (error: unknown) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toEqual([
      disposalFailure,
      replacementFailure,
    ]);
    expect(runtime).toBeUndefined();

    await expect(
      module.rebuildRuntimeAfterDisposal(
        runtime,
        async () => recoveredRuntime,
        install,
      ),
    ).resolves.toBeUndefined();
    expect(runtime).toBe(recoveredRuntime);
  });

  it.each(["automatic", "manual", "chat"] as const)(
    "does not invoke providers for disabled %s work",
    async (source) => {
      const module = await import("../src/vscode/pairRuntimeSupport").catch(
        () => ({ PairInvocationGate: undefined }),
      );
      expect(module.PairInvocationGate).toBeTypeOf("function");
      const invokeProvider = vi.fn(async () => "called");
      const gate = new module.PairInvocationGate!(false);

      const result = await gate.run(source, invokeProvider);

      expect(result).toEqual({ kind: "disabled", source });
      expect(invokeProvider).not.toHaveBeenCalled();
    },
  );

  it("does not invoke providers while a permitted session is inactive", async () => {
    const module = await import("../src/vscode/pairRuntimeSupport");
    const invokeProvider = vi.fn(async () => "called");
    const gate = new module.PairInvocationGate(true, false);

    await expect(gate.run("chat", invokeProvider)).resolves.toEqual({
      kind: "inactive",
      source: "chat",
    });
    expect(invokeProvider).not.toHaveBeenCalled();

    gate.setActive(true);
    await expect(gate.run("chat", invokeProvider)).resolves.toMatchObject({
      kind: "completed",
      value: "called",
    });
  });

  it("shows off status instead of the active navigator status", async () => {
    const module = await import("../src/vscode/pairRuntimeSupport").catch(
      () => ({ buildPairStatusText: undefined }),
    );
    expect(module.buildPairStatusText).toBeTypeOf("function");
    expect(
      module.buildPairStatusText!(false, [
        "Invalid provider; using local-template.",
      ]),
    ).toBe(
      "$(circle-slash) Pair: off · Invalid provider; using local-template.",
    );
  });

  it.each(["AbortError", "Canceled", "CancellationError"])(
    "does not suppress a random %s-named error without cancellation",
    async (name) => {
      const module = await import("../src/vscode/pairRuntimeSupport");
      const error = new Error("must surface");
      error.name = name;

      expect(
        module.shouldSuppressCancellation(false, error, () => false),
      ).toBe(false);
      expect(
        module.shouldSuppressCancellation(true, error, () => false),
      ).toBe(true);
      expect(
        module.shouldSuppressCancellation(false, error, (candidate) =>
          candidate === error,
        ),
      ).toBe(true);
    },
  );

  it("reuses actual latest evidence for manual review", async () => {
    const module = await import("../src/vscode/pairRuntimeSupport").catch(
      () => ({ selectManualEvidence: undefined }),
    );
    expect(module.selectManualEvidence).toBeTypeOf("function");
    expect(
      module.selectManualEvidence!({
        selection,
        diagnostics: [],
        latest: [evidence],
        analyzed: [],
      }),
    ).toBe(evidence);
  });

  it("returns no manual evidence instead of fabricating confidence-1 evidence", async () => {
    const module = await import("../src/vscode/pairRuntimeSupport").catch(
      () => ({ selectManualEvidence: undefined }),
    );
    expect(module.selectManualEvidence).toBeTypeOf("function");
    expect(
      module.selectManualEvidence!({
        selection,
        diagnostics: [],
        latest: [],
        analyzed: [],
      }),
    ).toBeUndefined();
  });

  it("clears previous text, analyzed text, and latest evidence on close", async () => {
    const module = (await import("../src/vscode/pairRuntimeSupport")) as Record<
      string,
      unknown
    >;
    expect(module.PairDocumentState).toBeTypeOf("function");
    const PairDocumentState = module.PairDocumentState as new () => {
      seed(uri: string, text: string): void;
      updateText(uri: string, text: string): string | undefined;
      recordAnalysis(
        uri: string,
        text: string,
        analysis: {
          readonly stability: "stable";
          readonly evidence: readonly Evidence[];
        },
      ): void;
      previousText(uri: string): string | undefined;
      lastAnalyzedText(uri: string): string | undefined;
      latestEvidence(uri: string): readonly Evidence[];
      close(uri: string): void;
    };
    const state = new PairDocumentState();

    state.seed("file:///pair.ts", "before");
    expect(state.updateText("file:///pair.ts", "after")).toBe("before");
    state.recordAnalysis("file:///pair.ts", "after", {
      stability: "stable",
      evidence: [evidence],
    });
    state.close("file:///pair.ts");

    expect(state.previousText("file:///pair.ts")).toBeUndefined();
    expect(state.lastAnalyzedText("file:///pair.ts")).toBeUndefined();
    expect(state.latestEvidence("file:///pair.ts")).toEqual([]);
  });

  it("retains the last stable baseline across unstable analysis", async () => {
    const { PairDocumentState } = await import(
      "../src/vscode/pairRuntimeSupport"
    );
    const state = new PairDocumentState();
    const uri = "file:///pair.ts";

    state.seed(uri, "export const value: string = 'before';");
    state.recordAnalysis(uri, "export const value:", {
      stability: "unstable",
      evidence: [],
    });

    expect(state.lastStableText(uri)).toBe(
      "export const value: string = 'before';",
    );
    expect(state.latestEvidence(uri)).toEqual([]);

    state.recordAnalysis(uri, "export const value: number = 1;", {
      stability: "stable",
      evidence: [evidence],
    });
    expect(state.lastStableText(uri)).toBe(
      "export const value: number = 1;",
    );
    expect(state.latestEvidence(uri)).toEqual([evidence]);
  });

  it("extracts the public diagnostic code value without forwarding its target", async () => {
    const module = (await import("../src/vscode/pairRuntimeSupport")) as Record<
      string,
      unknown
    >;
    expect(module.diagnosticCodeReference).toBeTypeOf("function");
    const diagnosticCodeReference = module.diagnosticCodeReference as (
      code:
        | string
        | number
        | { readonly value: string | number; readonly target: unknown }
        | undefined,
    ) => readonly string[];

    expect(
      diagnosticCodeReference({
        value: "TS2322",
        target: "https://third-party.example/full-diagnostic",
      }),
    ).toEqual(["TS2322"]);
    expect(diagnosticCodeReference(undefined)).toEqual([]);
  });

  it("builds bounded single-line diagnostic evidence while hashing full inputs", async () => {
    const module = (await import("../src/vscode/pairRuntimeSupport")) as Record<
      string,
      unknown
    >;
    expect(module.buildDiagnosticEvidence).toBeTypeOf("function");
    const buildDiagnosticEvidence = module.buildDiagnosticEvidence as (input: {
      readonly uri: string;
      readonly range: PairRange;
      readonly message: string;
      readonly severity: Evidence["severity"];
      readonly confidence: number;
      readonly source?: string;
      readonly code?:
        | string
        | number
        | { readonly value: string | number; readonly target: unknown };
    }) => Evidence;
    const stableDiagnosticEvidenceId =
      module.stableDiagnosticEvidenceId as (
        uri: string,
        range: PairRange,
        source: string,
        codeReferences: readonly string[],
        message: string,
      ) => string;
    const range = {
      start: { line: 1, character: 2 },
      end: { line: 3, character: 4 },
    };
    const message = `Useful diagnostic prefix\n${"message".repeat(200)}`;
    const source = `typescript\n${"source".repeat(100)}`;
    const code = `TS2322\n${"code".repeat(100)}`;

    const bounded = buildDiagnosticEvidence({
      uri: "file:///workspace/private.ts",
      range,
      message,
      severity: "error",
      confidence: 0.97,
      source,
      code: {
        value: code,
        target: "https://third-party.example/full-diagnostic",
      },
    });

    expect(bounded.id).toBe(
      stableDiagnosticEvidenceId(
        "file:///workspace/private.ts",
        range,
        source,
        [code],
        message,
      ),
    );
    expect(bounded.detail).toMatch(/^Useful diagnostic prefix /u);
    expect(bounded.detail.length).toBeLessThanOrEqual(500);
    expect(bounded.source.length).toBeLessThanOrEqual(120);
    expect(bounded.references[0]?.length).toBeLessThanOrEqual(240);
    for (const field of [
      bounded.detail,
      bounded.source,
      ...bounded.references,
    ]) {
      expect(field).not.toMatch(/[\r\n]/u);
      expect(field.endsWith("…")).toBe(true);
    }
    expect(JSON.stringify(bounded)).not.toContain("third-party.example");

    const differentSuffix = buildDiagnosticEvidence({
      uri: "file:///workspace/private.ts",
      range,
      message: `${message}different-private-suffix`,
      severity: "error",
      confidence: 0.97,
      source,
      code,
    });
    expect(differentSuffix.detail).toBe(bounded.detail);
    expect(differentSuffix.id).not.toBe(bounded.id);
  });

  it("uses the workspace folder that owns each document as repository identity", async () => {
    const { repositoryIdentityForDocument } = await import(
      "../src/vscode/pairRuntimeSupport"
    );
    const first = { uri: { toString: () => "file:///workspace/first" } };
    const second = { uri: { toString: () => "file:///workspace/second" } };
    const getWorkspaceFolder = (uri: { toString(): string }) =>
      uri.toString().includes("/second/") ? second : first;

    expect(
      repositoryIdentityForDocument(
        { toString: () => "file:///workspace/second/src/pair.ts" },
        getWorkspaceFolder,
      ),
    ).toBe("file:///workspace/second");
    expect(
      repositoryIdentityForDocument(
        { toString: () => "untitled:pair.ts" },
        () => undefined,
      ),
    ).toBe("no-workspace");
  });

  it("cancels every pending model request for a closed URI only", async () => {
    const module = (await import("../src/vscode/pairRuntimeSupport")) as Record<
      string,
      unknown
    >;
    expect(module.PairRequestRegistry).toBeTypeOf("function");
    const PairRequestRegistry = module.PairRequestRegistry as new () => {
      add(uri: string, request: AbortController): void;
      remove(uri: string, request: AbortController): void;
      cancelUri(uri: string): void;
    };
    const registry = new PairRequestRegistry();
    const first = new AbortController();
    const second = new AbortController();
    const other = new AbortController();
    registry.add("file:///closed.ts", first);
    registry.add("file:///closed.ts", second);
    registry.add("file:///open.ts", other);

    registry.cancelUri("file:///closed.ts");

    expect(first.signal.aborted).toBe(true);
    expect(second.signal.aborted).toBe(true);
    expect(other.signal.aborted).toBe(false);
    registry.remove("file:///open.ts", other);
  });
});
