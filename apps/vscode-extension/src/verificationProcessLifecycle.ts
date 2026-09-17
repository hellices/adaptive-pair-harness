import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type { RunOutcome } from "./verificationContracts.js";
import { VerificationOutputBuffer } from "./verificationOutput.js";
import type { ProcessTreePort } from "./verificationProcessTree.js";

const KILL_GRACE_MS = 5_000;
const KILL_CONFIRM_MS = 250;

export class VerificationProcessLifecycle {
  private readonly output = new VerificationOutputBuffer();
  private settled = false;
  private graceHandle: ReturnType<typeof setTimeout> | undefined;
  private confirmHandle: ReturnType<typeof setTimeout> | undefined;
  private aborting = false;
  private childClosed = false;

  public constructor(
    private readonly child: ChildProcessWithoutNullStreams,
    private readonly signal: AbortSignal,
    private readonly processTree: ProcessTreePort,
    private readonly resolveOutcome: (outcome: RunOutcome) => void,
  ) {}

  public observe(): void {
    this.child.stdout?.on("data", this.output.collect);
    this.child.stderr?.on("data", this.output.collect);
    this.signal.addEventListener("abort", this.onAbort, { once: true });

    this.child.on("error", () => {
      this.settle(this.interruptedOutcome(null, false));
    });
    this.child.on("close", (code, terminationSignal) => {
      this.onClose(code, terminationSignal);
    });

    if (this.signal.aborted) {
      this.onAbort();
    }
  }

  private readonly onAbort = (): void => {
    this.aborting = true;
    this.processTree.signal(this.child, "SIGTERM");
    if (this.settled) {
      return;
    }
    // If the process ignores SIGTERM, escalate and then report an
    // unconfirmed termination rather than hanging forever.
    this.graceHandle = setTimeout(() => {
      this.escalate();
    }, KILL_GRACE_MS);
  };

  private escalate(): void {
    this.processTree.signal(this.child, "SIGKILL");
    if (this.settled || this.settleIfTreeStopped("SIGKILL")) {
      return;
    }
    this.confirmHandle = setTimeout(() => {
      this.settle(
        this.interruptedOutcome(
          "SIGKILL",
          this.treeLiveness() === false,
        ),
      );
    }, KILL_CONFIRM_MS);
  }

  private onClose(code: number | null, terminationSignal: string | null): void {
    this.childClosed = true;
    if (this.aborting) {
      const liveness = this.treeLiveness();
      if (liveness !== true) {
        this.settle(this.interruptedOutcome(terminationSignal, liveness === false));
      }
      return;
    }
    this.settle({
      exitCode: code,
      signal: terminationSignal,
      ...this.output.read(),
      terminationConfirmed: true,
    });
  }

  private interruptedOutcome(
    terminationSignal: string | null,
    terminationConfirmed: boolean,
  ): RunOutcome {
    return {
      exitCode: null,
      signal: terminationSignal,
      ...this.output.read(),
      terminationConfirmed,
    };
  }

  private treeLiveness(): boolean | undefined {
    return this.child.pid === undefined && this.childClosed
      ? false
      : this.processTree.isAlive(this.child);
  }

  private settleIfTreeStopped(terminationSignal: string | null): boolean {
    if (this.treeLiveness() === false) {
      this.settle(this.interruptedOutcome(terminationSignal, true));
      return true;
    }
    return false;
  }

  private settle(result: RunOutcome): void {
    if (this.settled) {
      return;
    }
    this.settled = true;
    if (this.graceHandle !== undefined) {
      clearTimeout(this.graceHandle);
    }
    if (this.confirmHandle !== undefined) {
      clearTimeout(this.confirmHandle);
    }
    this.signal.removeEventListener("abort", this.onAbort);
    this.resolveOutcome(result);
  }
}
