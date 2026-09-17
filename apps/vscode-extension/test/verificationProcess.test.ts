import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeChild, spawningInto } from "./verificationPortFixtures.js";

const { NodeProcessRunPort, MAX_OUTPUT_BYTES } = await import("../src/verificationAdapter.js");
import type { RunOutcome } from "../src/verificationAdapter.js";

describe("NodeProcessRunPort — output and completion", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves with the exit code and combined stdout/stderr on close", async () => {
    const child = new FakeChild();
    const { spawn, state } = spawningInto(child);
    const port = new NodeProcessRunPort("/repo", spawn);
    const pending = port.run({ script: "test" }, new AbortController().signal);
    child.stdout.emit("data", Buffer.from("out-line\n"));
    child.stderr.emit("data", Buffer.from("err-line\n"));
    child.emit("close", 0, null);
    const result = await pending;
    expect(state.calls).toBe(1);
    expect(result.exitCode).toBe(0);
    expect(result.signal).toBeNull();
    expect(result.terminationConfirmed).toBe(true);
    expect(result.output).toContain("out-line");
    expect(result.output).toContain("err-line");
  });

  it("resolves a failure without confirming termination on spawn error", async () => {
    const child = new FakeChild();
    const { spawn } = spawningInto(child);
    const port = new NodeProcessRunPort("/repo", spawn);
    const pending = port.run({ script: "test" }, new AbortController().signal);
    child.emit("error", new Error("spawn ENOENT"));
    const result = await pending;
    expect(result.exitCode).toBeNull();
    expect(result.terminationConfirmed).toBe(false);
  });

  it("settles exactly once and detaches the abort listener on close", async () => {
    const child = new FakeChild();
    const { spawn } = spawningInto(child);
    const controller = new AbortController();
    const port = new NodeProcessRunPort("/repo", spawn);
    const pending = port.run({ script: "test" }, controller.signal);
    child.emit("close", 0, null);
    // A later error must not change the already-settled outcome.
    child.emit("error", new Error("late"));
    const result = await pending;
    expect(result.exitCode).toBe(0);
    // The abort listener was removed on settle, so a subsequent abort is inert.
    controller.abort();
    expect(child.signals).toEqual([]);
  });

  it("bounds combined stdout/stderr output to the byte cap", async () => {
    const child = new FakeChild();
    const { spawn } = spawningInto(child);
    const port = new NodeProcessRunPort("/repo", spawn);
    const pending = port.run({ script: "test" }, new AbortController().signal);
    child.stdout.emit("data", Buffer.alloc(100 * 1024, 0x61));
    child.stdout.emit("data", Buffer.alloc(100 * 1024, 0x62));
    child.stderr.emit("data", Buffer.alloc(100 * 1024, 0x63));
    child.emit("close", 0, null);
    const result: RunOutcome = await pending;
    expect(Buffer.byteLength(result.output, "utf8")).toBeLessThanOrEqual(
      MAX_OUTPUT_BYTES,
    );
    expect(result.outputTruncated).toBe(true);
  });

  it("preserves multibyte characters split across output chunks", async () => {
    const child = new FakeChild();
    const { spawn } = spawningInto(child);
    const port = new NodeProcessRunPort("/repo", spawn);
    const pending = port.run({ script: "test" }, new AbortController().signal);
    const encoded = Buffer.from("😀");

    child.stdout.emit("data", encoded.subarray(0, 2));
    child.stderr.emit("data", encoded.subarray(2));
    child.emit("close", 0, null);

    const result = await pending;
    expect(result.output).toBe("😀");
    expect(result.outputTruncated).toBe(false);
  });

  it("drops only an incomplete UTF-8 suffix at the byte cap", async () => {
    const child = new FakeChild();
    const { spawn } = spawningInto(child);
    const port = new NodeProcessRunPort("/repo", spawn);
    const pending = port.run({ script: "test" }, new AbortController().signal);
    const prefix = "a".repeat(MAX_OUTPUT_BYTES - 1);

    child.stdout.emit("data", Buffer.from(prefix));
    child.stderr.emit("data", Buffer.from("😀"));
    child.emit("close", 0, null);

    const result = await pending;
    expect(result.output).toBe(prefix);
    expect(result.output).not.toContain("\uFFFD");
    expect(result.outputTruncated).toBe(true);
  });

  it("does not mark output truncated at exactly the byte cap", async () => {
    const child = new FakeChild();
    const { spawn } = spawningInto(child);
    const port = new NodeProcessRunPort("/repo", spawn);
    const pending = port.run({ script: "test" }, new AbortController().signal);
    const output = "a".repeat(MAX_OUTPUT_BYTES);

    child.stdout.emit("data", Buffer.from(output));
    child.emit("close", 0, null);

    const result = await pending;
    expect(result.output).toBe(output);
    expect(result.outputTruncated).toBe(false);
  });

  it("rejects synchronous spawn failures through the returned promise", async () => {
    const failure = new Error("spawn failed synchronously");
    const port = new NodeProcessRunPort("/repo", () => {
      throw failure;
    });

    const pending = port.run({ script: "test" }, new AbortController().signal);

    await expect(pending).rejects.toBe(failure);
  });
});
