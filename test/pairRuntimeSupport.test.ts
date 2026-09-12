import { describe, expect, it, vi } from "vitest";
import type { Evidence, PairRange } from "../src/core/types";

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

  it("shows disabled status instead of the active navigator status", async () => {
    const module = await import("../src/vscode/pairRuntimeSupport").catch(
      () => ({ buildPairStatusText: undefined }),
    );
    expect(module.buildPairStatusText).toBeTypeOf("function");
    expect(
      module.buildPairStatusText!(false, [
        "Invalid provider; using local-template.",
      ]),
    ).toBe(
      "$(circle-slash) Pair: Disabled · Invalid provider; using local-template.",
    );
  });

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
        evidence: readonly Evidence[],
      ): void;
      previousText(uri: string): string | undefined;
      lastAnalyzedText(uri: string): string | undefined;
      latestEvidence(uri: string): readonly Evidence[];
      close(uri: string): void;
    };
    const state = new PairDocumentState();

    state.seed("file:///pair.ts", "before");
    expect(state.updateText("file:///pair.ts", "after")).toBe("before");
    state.recordAnalysis("file:///pair.ts", "after", [evidence]);
    state.close("file:///pair.ts");

    expect(state.previousText("file:///pair.ts")).toBeUndefined();
    expect(state.lastAnalyzedText("file:///pair.ts")).toBeUndefined();
    expect(state.latestEvidence("file:///pair.ts")).toEqual([]);
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
