import { spawnSync } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";

type TerminationSignal = "SIGTERM" | "SIGKILL";

const TASKKILL_TIMEOUT_MS = 1_000;

export interface ProcessTreePort {
  signal(
    child: ChildProcessWithoutNullStreams,
    signal: TerminationSignal,
  ): boolean;
  isAlive(child: ChildProcessWithoutNullStreams): boolean | undefined;
}

const errnoCode = (error: unknown): string | undefined => {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }
  const code = (error as { readonly code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
};

export class SystemProcessTreePort implements ProcessTreePort {
  public signal(
    child: ChildProcessWithoutNullStreams,
    signal: TerminationSignal,
  ): boolean {
    const pid = child.pid;
    if (pid === undefined) {
      return child.kill(signal);
    }

    if (process.platform === "win32") {
      const result = spawnSync(
        "taskkill",
        [
          "/PID",
          String(pid),
          "/T",
          ...(signal === "SIGKILL" ? ["/F"] : []),
        ],
        {
          stdio: "ignore",
          windowsHide: true,
          timeout: TASKKILL_TIMEOUT_MS,
          killSignal: "SIGKILL",
        },
      );
      return result.status === 0;
    }

    try {
      process.kill(-pid, signal);
      return true;
    } catch {
      return false;
    }
  }

  public isAlive(child: ChildProcessWithoutNullStreams): boolean | undefined {
    const pid = child.pid;
    if (pid === undefined) {
      return undefined;
    }
    if (process.platform === "win32") {
      return undefined;
    }

    try {
      process.kill(-pid, 0);
      return true;
    } catch (error) {
      return errnoCode(error) === "ESRCH" ? false : undefined;
    }
  }
}
