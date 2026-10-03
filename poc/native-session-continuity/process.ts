import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { createWriteStream, type WriteStream } from "node:fs";
import { finished } from "node:stream/promises";
import type { Phase } from "./contracts.js";

const waitForExit = (child: ChildProcessWithoutNullStreams, log: WriteStream, phase: Phase): Promise<void> =>
  new Promise((resolveExit, rejectExit) => {
    let failure: Error | undefined;
    let closed = false;
    let terminationRequested = false;
    let cleanupTimeout: ReturnType<typeof setTimeout> | undefined;
    const stop = (error: Error): void => {
      failure ??= error;
      if (closed || terminationRequested || child.pid === undefined) return;
      terminationRequested = true;
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch (signalError) {
        if (typeof signalError === "object" && signalError !== null &&
          "code" in signalError && signalError.code === "ESRCH") return;
        clearTimeout(timeout);
        failure = new AggregateError([error, signalError], "The owned host could not be terminated.");
        cleanupTimeout = setTimeout(() => {
          child.stdout.destroy();
          child.stderr.destroy();
          child.unref();
          rejectExit(new AggregateError([failure], "The owned host did not close within 5000 ms; cleanup is unconfirmed."));
        }, 5000);
      }
    };
    const timeout = setTimeout(() => stop(new Error(`Native ${phase} phase exceeded 60000 ms.`)), 60000);
    log.on("error", (error: Error) => { stop(error); log.destroy(); });
    child.once("error", stop);
    child.once("close", code => {
      closed = true;
      clearTimeout(timeout);
      clearTimeout(cleanupTimeout);
      if (failure) rejectExit(failure);
      else if (code === 0) resolveExit();
      else rejectExit(new Error(`Native ${phase} host exited with ${String(code)}.`));
    });
    child.stdout.pipe(log, { end: false });
    child.stderr.pipe(log, { end: false });
  });

export const runOwnedHost = async (
  executable: string, args: readonly string[], environment: NodeJS.ProcessEnv, logPath: string, phase: Phase,
): Promise<void> => {
  const log = createWriteStream(logPath, { flags: "wx" });
  const logCompletion = finished(log).then(() => undefined, (error: unknown) => ({ error }));
  let child: ChildProcessWithoutNullStreams | undefined;
  let failure: { readonly error: unknown } | undefined;
  try {
    await once(log, "open");
    child = spawn(executable, args, { detached: true, env: environment });
    await waitForExit(child, log, phase);
  } catch (error) {
    failure = { error };
  } finally {
    child?.stdout.unpipe(log);
    child?.stderr.unpipe(log);
    if (child) log.end();
    else log.destroy();
  }
  const logFailure = await logCompletion;
  if (failure) throw failure.error;
  if (logFailure) throw logFailure.error;
};
