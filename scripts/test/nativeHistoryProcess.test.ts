import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runOwnedNativeHost } from "../native-history-smoke.mjs";

const withProcessLog = async (run: (logPath: string) => Promise<void>) => {
  const directory = await mkdtemp(join(tmpdir(), "pair-native-process-"));
  try { await run(join(directory, "host.log")); }
  finally { await rm(directory, { recursive: true, force: true }); }
};

describe("owned native host process diagnostics", () => {
  it("flushes successful process output before returning", async () => {
    await withProcessLog(async logPath => {
      await runOwnedNativeHost(process.execPath, ["-e", 'process.stdout.write("host passed");'], {}, logPath);
      expect(await readFile(logPath, "utf8")).toBe("host passed");
    });
  });

  it("reports the termination signal and flushed host diagnostic", async () => {
    await withProcessLog(async logPath => {
      const script = 'process.stderr.write("native launch sentinel\\n", () => process.kill(process.pid, "SIGTERM"));';
      await expect(runOwnedNativeHost(process.execPath, ["-e", script], {}, logPath))
        .rejects.toThrow(/signal SIGTERM[\s\S]*native launch sentinel/u);
    });
  });

  it("bounds failed-process diagnostics while retaining the original exit status", async () => {
    await withProcessLog(async logPath => {
      const script = 'process.stderr.write("discarded-prefix\\n" + "x".repeat(17000) + "\\nkept-tail\\n"); process.exitCode = 17;';
      const failure = await runOwnedNativeHost(process.execPath, ["-e", script], {}, logPath)
        .then(() => { throw new Error("Expected a process failure"); }, (error: unknown) => error);
      expect(failure).toBeInstanceOf(Error);
      const message = failure instanceof Error ? failure.message : "";
      expect(message).toContain("code 17");
      expect(message).toContain("kept-tail");
      expect(message).not.toContain("discarded-prefix");
      expect(message.length).toBeLessThan(9000);
    });
  });
});
