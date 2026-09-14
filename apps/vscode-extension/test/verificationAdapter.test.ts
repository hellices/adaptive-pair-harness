import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => ({
  workspace: { textDocuments: [] as unknown[] },
  window: {},
  tests: {},
}));

const {
  VerificationAdapter,
  MAX_OUTPUT_BYTES,
  DISPLAY_LIMIT,
  VERIFICATION_TIMEOUT_MS,
} = await import("../src/verificationAdapter.js");
import type {
  BufferInspectionPort,
  ConfirmationPort,
  PackageScriptPort,
  ProcessRunPort,
  RunOutcome,
  TestingRunPort,
  TimeoutScheduler,
  VerificationPlan,
  VerificationAdapterPorts,
} from "../src/verificationAdapter.js";

interface Recorder {
  processRuns: number;
  testingRuns: number;
  confirmations: number;
  scheduledMs: number[];
  cancelledDeadlines: number;
  lastProcessSignalAborted: () => boolean;
}

const okOutcome = (overrides: Partial<RunOutcome> = {}): RunOutcome => ({
  exitCode: 0,
  signal: null,
  output: "All tests passed.\n",
  timedOut: false,
  terminationConfirmed: true,
  ...overrides,
});

const makePorts = (
  outcome: RunOutcome | (() => Promise<RunOutcome>),
  options: {
    readonly dirty?: readonly string[];
    readonly confirm?: boolean;
    readonly scripts?: Readonly<Record<string, string>>;
  } = {},
): { readonly ports: VerificationAdapterPorts; readonly recorder: Recorder } => {
  let lastSignal: AbortSignal | undefined;
  const recorder: Recorder = {
    processRuns: 0,
    testingRuns: 0,
    confirmations: 0,
    scheduledMs: [],
    cancelledDeadlines: 0,
    lastProcessSignalAborted: () => lastSignal?.aborted ?? false,
  };

  const resolveOutcome = (signal: AbortSignal): Promise<RunOutcome> => {
    lastSignal = signal;
    return typeof outcome === "function"
      ? outcome()
      : Promise.resolve(outcome);
  };

  const buffers: BufferInspectionPort = {
    dirtyTargets: () => options.dirty ?? [],
  };
  const confirmation: ConfirmationPort = {
    confirm: () => {
      recorder.confirmations += 1;
      return Promise.resolve(options.confirm ?? true);
    },
  };
  const scripts: PackageScriptPort = {
    scripts: () => options.scripts ?? { test: "vitest run", "lint:unit": "eslint ." },
  };
  const process: ProcessRunPort = {
    run: (_command, signal) => {
      recorder.processRuns += 1;
      return resolveOutcome(signal);
    },
  };
  const testing: TestingRunPort = {
    run: (_request, signal) => {
      recorder.testingRuns += 1;
      return resolveOutcome(signal);
    },
  };
  const scheduler: TimeoutScheduler = {
    set: (ms) => {
      recorder.scheduledMs.push(ms);
      return () => {
        recorder.cancelledDeadlines += 1;
      };
    },
  };

  return {
    ports: { buffers, confirmation, scripts, process, testing, scheduler },
    recorder,
  };
};

const scriptPlan = (
  script: string,
  targetPaths: readonly string[] = [],
): VerificationPlan => ({
  kind: "package-script",
  operationId: "op-1",
  script,
  targetPaths,
});

const testPlan = (
  targetPaths: readonly string[] = [],
): VerificationPlan => ({
  kind: "vscode-test",
  operationId: "op-1",
  testIds: ["suite/case-1"],
  targetPaths,
});

let signal: AbortSignal;
beforeEach(() => {
  signal = new AbortController().signal;
});

describe("VerificationAdapter — allowlisted execution", () => {
  it("runs an existing root package script and reports the actual exit code", async () => {
    const { ports, recorder } = makePorts(okOutcome());
    const result = await new VerificationAdapter(ports).run(scriptPlan("test"), signal);
    expect(result.status).toBe("confirmed");
    expect(result.observation?.passed).toBe(true);
    expect(result.observation?.exitCode).toBe(0);
    expect(result.observation?.signal).toBeNull();
    expect(result.sensitiveData).toBe(false);
    expect(recorder.processRuns).toBe(1);
    expect(recorder.scheduledMs).toContain(VERIFICATION_TIMEOUT_MS);
  });

  it("accepts an allowlisted script with a colon suffix", async () => {
    const { ports, recorder } = makePorts(okOutcome());
    const result = await new VerificationAdapter(ports).run(
      scriptPlan("lint:unit"),
      signal,
    );
    expect(result.status).toBe("confirmed");
    expect(recorder.processRuns).toBe(1);
  });

  it("runs VS Code Testing tests selected by the plan", async () => {
    const { ports, recorder } = makePorts(okOutcome());
    const result = await new VerificationAdapter(ports).run(testPlan(), signal);
    expect(result.status).toBe("confirmed");
    expect(recorder.testingRuns).toBe(1);
    expect(recorder.processRuns).toBe(0);
  });

  it("reports a failed check without inferring product success from a passing status", async () => {
    const { ports } = makePorts(
      okOutcome({ exitCode: 1, output: "1 test failed.\n" }),
    );
    const result = await new VerificationAdapter(ports).run(scriptPlan("test"), signal);
    expect(result.status).toBe("confirmed");
    expect(result.observation?.passed).toBe(false);
    expect(result.observation?.exitCode).toBe(1);
  });
});

describe("VerificationAdapter — rejected commands", () => {
  it("declines a script whose name is not on the allowlist", async () => {
    const { ports, recorder } = makePorts(okOutcome(), {
      scripts: { deploy: "do-deploy" },
    });
    const result = await new VerificationAdapter(ports).run(
      scriptPlan("deploy"),
      signal,
    );
    expect(result.status).toBe("declined");
    expect(result.observation?.reason).toBe("script-not-allowlisted");
    expect(recorder.confirmations).toBe(0);
    expect(recorder.processRuns).toBe(0);
  });

  it("declines an allowlisted name that is not defined in the root scripts", async () => {
    const { ports, recorder } = makePorts(okOutcome(), {
      scripts: { lint: "eslint ." },
    });
    const result = await new VerificationAdapter(ports).run(
      scriptPlan("typecheck"),
      signal,
    );
    expect(result.status).toBe("declined");
    expect(result.observation?.reason).toBe("script-not-defined");
    expect(recorder.processRuns).toBe(0);
  });

  it("rejects a raw shell command masquerading as a script name", async () => {
    const { ports } = makePorts(okOutcome(), {
      scripts: { "test; rm -rf /": "danger" },
    });
    const result = await new VerificationAdapter(ports).run(
      scriptPlan("test; rm -rf /"),
      signal,
    );
    expect(result.status).toBe("declined");
    expect(result.observation?.reason).toBe("script-not-allowlisted");
  });
});

describe("VerificationAdapter — preconditions", () => {
  it("cancels when target buffers are dirty and does not run the check", async () => {
    const { ports, recorder } = makePorts(okOutcome(), {
      dirty: ["src/index.ts"],
    });
    const result = await new VerificationAdapter(ports).run(
      scriptPlan("test", ["src/index.ts"]),
      signal,
    );
    expect(result.status).toBe("cancelled");
    expect(result.observation?.reason).toBe("dirty-target-buffers");
    expect(result.observation?.dirtyPaths).toEqual(["src/index.ts"]);
    expect(recorder.confirmations).toBe(0);
    expect(recorder.processRuns).toBe(0);
  });

  it("declines when the separate human confirmation is refused", async () => {
    const { ports, recorder } = makePorts(okOutcome(), { confirm: false });
    const result = await new VerificationAdapter(ports).run(scriptPlan("test"), signal);
    expect(result.status).toBe("declined");
    expect(result.observation?.reason).toBe("confirmation-declined");
    expect(recorder.confirmations).toBe(1);
    expect(recorder.processRuns).toBe(0);
  });

  it("cancels immediately when the caller signal is already aborted", async () => {
    const { ports, recorder } = makePorts(okOutcome());
    const aborted = AbortSignal.abort();
    const result = await new VerificationAdapter(ports).run(scriptPlan("test"), aborted);
    expect(result.status).toBe("cancelled");
    expect(recorder.confirmations).toBe(0);
    expect(recorder.processRuns).toBe(0);
  });
});

describe("VerificationAdapter — timeout and termination", () => {
  it("marks a timed-out run cancelled when termination is confirmed", async () => {
    const { ports } = makePorts(
      okOutcome({
        exitCode: null,
        signal: "SIGTERM",
        output: "still running...",
        timedOut: true,
        terminationConfirmed: true,
      }),
    );
    const result = await new VerificationAdapter(ports).run(scriptPlan("test"), signal);
    expect(result.status).toBe("cancelled");
    expect(result.observation?.timedOut).toBe(true);
    expect(result.observation?.signal).toBe("SIGTERM");
    expect(result.partial).toBe(true);
  });

  it("returns unknown when a cancelled run cannot confirm process termination", async () => {
    const { ports } = makePorts(
      okOutcome({
        exitCode: null,
        signal: null,
        output: "may still be running",
        timedOut: true,
        terminationConfirmed: false,
      }),
    );
    const result = await new VerificationAdapter(ports).run(scriptPlan("test"), signal);
    expect(result.status).toBe("unknown");
    expect(result.partial).toBe(true);
  });

  it("aborts the running check when the injected deadline fires", async () => {
    let fireDeadline: (() => void) | undefined;
    const scheduler: TimeoutScheduler = {
      set: (_ms, callback) => {
        fireDeadline = callback;
        return () => undefined;
      },
    };
    let observedSignal: AbortSignal | undefined;
    const process: ProcessRunPort = {
      run: (_command, sig) =>
        new Promise<RunOutcome>((resolve) => {
          observedSignal = sig;
          sig.addEventListener("abort", () => {
            resolve(
              okOutcome({
                exitCode: null,
                signal: "SIGKILL",
                output: "killed after deadline",
                timedOut: true,
                terminationConfirmed: true,
              }),
            );
          });
        }),
    };
    const ports: VerificationAdapterPorts = {
      buffers: { dirtyTargets: () => [] },
      confirmation: { confirm: () => Promise.resolve(true) },
      scripts: { scripts: () => ({ test: "vitest run" }) },
      process,
      testing: { run: () => Promise.reject(new Error("unused")) },
      scheduler,
    };
    const pending = new VerificationAdapter(ports).run(scriptPlan("test"), signal);
    await Promise.resolve();
    expect(observedSignal?.aborted).toBe(false);
    fireDeadline?.();
    const result = await pending;
    expect(result.status).toBe("cancelled");
    expect(result.observation?.timedOut).toBe(true);
  });
});

describe("VerificationAdapter — output bounds and sensitivity", () => {
  it("scans the full bounded output for secrets before applying the display bound", async () => {
    const filler = "log line ".repeat(3000); // ~27k chars, beyond the display bound
    const secret = "\nAWS_SECRET_ACCESS_KEY=AKIAIOSFODNN7EXAMPLE\n";
    const output = filler + secret;
    expect(output.length).toBeGreaterThan(DISPLAY_LIMIT);
    const { ports } = makePorts(okOutcome({ output }));
    const result = await new VerificationAdapter(ports).run(scriptPlan("test"), signal);
    expect(result.sensitiveData).toBe(true);
    expect(String(result.observation?.output)).not.toContain("AKIAIOSFODNN7EXAMPLE");
  });

  it("bounds combined output to 128 KiB and marks the result partial", async () => {
    const huge = "x".repeat(MAX_OUTPUT_BYTES + 5_000);
    const { ports } = makePorts(okOutcome({ output: huge }));
    const result = await new VerificationAdapter(ports).run(scriptPlan("test"), signal);
    expect(result.partial).toBe(true);
    expect(String(result.observation?.output).length).toBeLessThanOrEqual(DISPLAY_LIMIT);
  });

  it("truncates clean output to the display bound without flagging sensitivity", async () => {
    const output = "y".repeat(DISPLAY_LIMIT + 2_000);
    const { ports } = makePorts(okOutcome({ output }));
    const result = await new VerificationAdapter(ports).run(scriptPlan("test"), signal);
    expect(result.sensitiveData).toBe(false);
    expect(String(result.observation?.output).length).toBe(DISPLAY_LIMIT);
  });
});
