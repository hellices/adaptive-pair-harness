import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type { ProcessRunPort, RunCommand, RunOutcome } from "./verificationContracts.js";
import { defaultProcessRuntime, npmInvocation } from "./verificationProcessInvocation.js";
import type { ProcessRuntime } from "./verificationProcessInvocation.js";
import { VerificationProcessLifecycle } from "./verificationProcessLifecycle.js";
import { SystemProcessTreePort } from "./verificationProcessTree.js";
import type { ProcessTreePort } from "./verificationProcessTree.js";

export type SpawnProcess = (
  command: string,
  args: readonly string[],
  options: {
    readonly cwd: string;
    readonly shell: false;
    readonly detached: boolean;
  },
) => ChildProcessWithoutNullStreams;

const defaultSpawn: SpawnProcess = (command, args, options) =>
  spawn(command, [...args], options);

export class NodeProcessRunPort implements ProcessRunPort {
  public constructor(
    private readonly rootPath: string,
    private readonly spawnProcess: SpawnProcess = defaultSpawn,
    private readonly processTree: ProcessTreePort = new SystemProcessTreePort(),
    private readonly runtime: ProcessRuntime = defaultProcessRuntime,
  ) {}

  public run(command: RunCommand, signal: AbortSignal): Promise<RunOutcome> {
    return new Promise<RunOutcome>((resolveOutcome) => {
      const invocation = npmInvocation(this.runtime);
      if (invocation === undefined) {
        resolveOutcome({
          exitCode: null,
          signal: null,
          output: "",
          outputTruncated: false,
          terminationConfirmed: false,
        });
        return;
      }
      const child = this.spawnProcess(
        invocation.command,
        [...invocation.argsPrefix, "run", command.script],
        {
          cwd: this.rootPath,
          shell: false,
          detached: invocation.detached,
        },
      );

      new VerificationProcessLifecycle(
        child,
        signal,
        this.processTree,
        resolveOutcome,
      ).observe();
    });
  }
}
