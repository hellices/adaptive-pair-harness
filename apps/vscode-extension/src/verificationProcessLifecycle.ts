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
    // If the process ignores SIGTERM, escalate and then report an
    // unconfirmed termination rather than hanging forever.
    this.graceHandle = setTimeout(() => {
      this.escalate();
    }, KILL_GRACE_MS);
  };

  private escalate(): void {
    this.processTree.signal(this.child, "SIGKILL");
    if (this.settleIfTreeStopped("SIGKILL")) {
      return;
    }
    this.confirmHandle = setTimeout(() => {
      this.settle(
        this.interruptedOutcome(
          "SIGKILL",
          this.child.pid !== undefined && !this.processTree.isAlive(this.child),
        ),
      );
    }, KILL_CONFIRM_MS);
  }

  private onClose(code: number | null, terminationSignal: string | null): void {
    this.childClosed = true;
    if (this.aborting) {
      this.settleIfTreeStopped(terminationSignal);
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

  private settleIfTreeStopped(terminationSignal: string | null): boolean {
    if (
      (this.child.pid === undefined && this.childClosed) ||
      (this.child.pid !== undefined && !this.processTree.isAlive(this.child))
    ) {
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
