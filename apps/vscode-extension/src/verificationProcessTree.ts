import { spawnSync } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";

type TerminationSignal = "SIGTERM" | "SIGKILL";

export interface ProcessTreePort {
  signal(
    child: ChildProcessWithoutNullStreams,
    signal: TerminationSignal,
  ): boolean;
  isAlive(child: ChildProcessWithoutNullStreams): boolean;
}

const errnoCode = (error: unknown): string | undefined => {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }
  const code = (error as { readonly code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
};

export class SystemProcessTreePort implements ProcessTreePort {
  private readonly terminatedWindowsTrees = new Set<number>();

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
        { stdio: "ignore", windowsHide: true },
      );
      if (result.status === 0) {
        this.terminatedWindowsTrees.add(pid);
        return true;
      }
      return false;
    }

    try {
      process.kill(-pid, signal);
      return true;
    } catch (error) {
      return errnoCode(error) === "ESRCH" ? false : false;
    }
  }

  public isAlive(child: ChildProcessWithoutNullStreams): boolean {
    const pid = child.pid;
    if (pid === undefined) {
      return true;
    }
    if (process.platform === "win32") {
      return !this.terminatedWindowsTrees.has(pid);
    }

    try {
      process.kill(-pid, 0);
      return true;
    } catch (error) {
      return errnoCode(error) !== "ESRCH";
    }
  }
}
