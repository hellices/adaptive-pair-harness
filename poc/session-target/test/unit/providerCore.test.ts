import { describe, expect, it } from "vitest";
import { SessionTargetProviderCore } from "../../src/sessionTargetProviderCore";
import { SessionTargetStore } from "../../src/sessionTargetStore";

describe("SessionTargetProviderCore", () => {
  it("retains immediate streaming with a Promise-returning completion contract", async () => {
    const store = new SessionTargetStore(() => "session-1");
    const core = new SessionTargetProviderCore(store, () => 100);
    const session = core.create("Start pairing");
    const chunks: string[] = [];

    const pending = core.respond(session.resource, "Inspect", new AbortController().signal, chunk => chunks.push(chunk));

    expect(chunks).toHaveLength(2);
    expect(store.get(session.resource)?.status).toBe("completed");
    await expect(pending).resolves.toBeUndefined();
  });

  it("rejects an unknown response resource through its Promise contract", async () => {
    const core = new SessionTargetProviderCore(new SessionTargetStore(() => "session-1"), () => 100);

    await expect(core.respond("missing", "Inspect", new AbortController().signal, () => undefined))
      .rejects.toThrow("Unknown Adaptive Pair session");
  });

  it("streams a request through the stored session and completes it", async () => {
    const store = new SessionTargetStore(() => "session-1");
    const core = new SessionTargetProviderCore(store, () => 100);
    const session = core.create("Start pairing");
    const chunks: string[] = [];

    await core.respond(
      session.resource,
      "Help me inspect this work",
      new AbortController().signal,
      chunk => chunks.push(chunk),
    );

    expect(chunks.join("")).toBe(
      "Adaptive Pair Session Target is active.\nRequest: Help me inspect this work",
    );
    expect(store.get(session.resource)?.status).toBe("completed");
  });

  it("marks an interrupted request as needing input without streaming", async () => {
    const store = new SessionTargetStore(() => "session-1");
    const core = new SessionTargetProviderCore(store, () => 100);
    const session = core.create("Start pairing");
    const controller = new AbortController();
    const chunks: string[] = [];
    controller.abort(new Error("stopped"));

    await expect(core.respond(
      session.resource,
      "Do not continue",
      controller.signal,
      chunk => chunks.push(chunk),
    )).rejects.toThrow("stopped");

    expect(chunks).toEqual([]);
    expect(store.get(session.resource)?.status).toBe("needs-input");
  });

  it("does not replace an unknown live session with a different resource", () => {
    const store = new SessionTargetStore(() => "replacement");
    const core = new SessionTargetProviderCore(store, () => 100);

    expect(() => core.resolveForRequest(
      "adaptive-pair:/sessions/missing",
      "Continue",
    )).toThrow("Unknown Adaptive Pair session");
    expect(store.list()).toEqual([]);
  });
});
