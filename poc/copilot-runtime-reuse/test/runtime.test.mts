import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import type { CopilotSession } from "@github/copilot-sdk";
import { createRuntimeFixture } from "./fixture.mjs";

type Fixture = Awaited<ReturnType<typeof createRuntimeFixture>>;

async function observeCancellation(fixture: Fixture): Promise<void> {
  const started = Promise.withResolvers<void>();
  const released = Promise.withResolvers<void>();
  let observed = false;
  const session = await fixture.client.createSession(fixture.configuration({
    availableTools: ["custom:pair_wait"],
    tools: [{
      name: "pair_wait", description: "Synthetic cooperative cancellation fixture",
      parameters: { type: "object", properties: {} },
      async handler(_arguments, invocation) {
        assert(invocation.signal instanceof AbortSignal);
        const onAbort = (): void => { observed = true; released.resolve(); };
        invocation.signal.addEventListener("abort", onAbort, { once: true });
        started.resolve();
        try { await released.promise; }
        finally { invocation.signal.removeEventListener("abort", onAbort); }
        return "Synthetic cancellation without an effect";
      },
    }],
  }));
  fixture.model.enqueue("pair_wait");
  const pending = session.sendAndWait({ prompt: "PAIR_SYNTHETIC_CANCEL" }, 15_000);
  const outcome = pending.then(() => undefined, (error: unknown) => error);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([started.promise, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("Tool start was not observed")), 5_000);
    })]);
    clearTimeout(timer);
    await session.abort();
    assert.equal(await outcome, undefined);
    assert.equal(observed, true);
  } finally {
    clearTimeout(timer);
    released.resolve();
    await outcome;
    await session.disconnect();
    await fixture.client.deleteSession(session.sessionId);
  }
}

await test("isolated Copilot SDK runtime reuse", { timeout: 120_000 }, async (context) => {
  const fixture = await createRuntimeFixture();
  context.after(async () => fixture.close());
  await fixture.client.start();
  let session: CopilotSession;
  let originalId = "";

  await context.test("runs a real unauthenticated runtime with only the supplied tool catalog", async () => {
    const status = await fixture.client.getStatus();
    context.diagnostic(`Runtime ${status.version}; protocol ${status.protocolVersion}`);
    assert.equal((await fixture.client.getAuthStatus()).isAuthenticated, false);
    session = await fixture.client.createSession(fixture.configuration());
    originalId = session.sessionId;
    await fixture.invoke(session, "pair_allowed", "PAIR_SYNTHETIC_SEED");
    assert.deepEqual(fixture.effects, ["pair_allowed"]);
    assert.deepEqual(fixture.model.requests[0]?.tools.toSorted(),
      ["pair_allowed", "pair_denied", "pair_guarded", "pair_hook_error"]);
    assert.equal(fixture.calls[0]?.sessionId, originalId);
    assert(fixture.calls[0]?.toolCallId);
    assert.equal(fixture.hooks[0]?.sessionId, originalId);
  });

  await context.test("honors an explicit pre-tool denial before requesting permission", async () => {
    await fixture.invoke(session, "pair_denied", "PAIR_SYNTHETIC_DENY");
    assert(!fixture.calls.some((call) => call.tool === "pair_denied"));
    assert(!fixture.permissions.some((request) => request.tool === "pair_denied"));
  });

  await context.test("hides an excluded tool and rejects even a forged model tool call", async () => {
    await fixture.invoke(session, "pair_excluded", "PAIR_SYNTHETIC_EXCLUDE");
    assert(fixture.model.requests.every((request) => !request.tools.includes("pair_excluded")));
    assert(!fixture.calls.some((call) => call.tool === "pair_excluded"));
    assert(!fixture.permissions.some((request) => request.tool === "pair_excluded"));
  });

  await context.test("does not treat a thrown hook as a denial", async () => {
    await fixture.invoke(session, "pair_hook_error", "PAIR_SYNTHETIC_HOOK_ERROR");
    assert(fixture.effects.includes("pair_hook_error"));
    assert(fixture.permissions.some((request) => request.tool === "pair_hook_error" && !request.denied));
  });

  await context.test("retains an effect-side guard despite hook failure and native permission", async () => {
    await fixture.invoke(session, "pair_guarded", "PAIR_SYNTHETIC_GUARD");
    assert(fixture.calls.some((call) => call.tool === "pair_guarded"));
    assert(fixture.permissions.some((request) => request.tool === "pair_guarded" && !request.denied));
    assert(!fixture.effects.includes("pair_guarded"));
    assert(fixture.model.requests.at(-1)?.hasGuardRefusal);
  });

  await context.test("recovers history in a new runtime but obeys a fresh denying permission handler", async () => {
    await session.disconnect();
    await fixture.restart();
    assert.equal((await fixture.client.getAuthStatus()).isAuthenticated, false);
    session = await fixture.client.resumeSession(originalId, {
      ...fixture.configuration({ onPermissionRequest: fixture.permissionHandler(true) }),
      continuePendingWork: false,
    });
    assert((await session.getEvents()).some((event) =>
      event.type === "user.message" && event.data.content === "PAIR_SYNTHETIC_SEED"));
    const before = fixture.effects.length;
    await fixture.invoke(session, "pair_allowed", "PAIR_SYNTHETIC_RESUMED_DENY");
    assert.equal(fixture.effects.length, before);
    assert(fixture.permissions.some((request) =>
      request.tool === "pair_allowed" && request.sessionId === originalId && request.denied));
    assert(fixture.model.requests.at(-1)?.hasSeed);
  });

  await context.test("denies a built-in shell effect through its permission callback", async () => {
    const shell = await fixture.client.createSession(fixture.configuration({
      tools: [], availableTools: ["builtin:bash"], excludedTools: [],
    }));
    const marker = join(fixture.root, "work", "permission-marker");
    const quoted = `'${marker.replaceAll("'", "'\"'\"'")}'`;
    await fixture.invoke(shell, "bash", "PAIR_SYNTHETIC_PERMISSION", {
      command: `printf denied > ${quoted}`, description: "Synthetic write that must be denied",
    });
    assert(fixture.permissions.some((request) =>
      request.kind === "shell" && request.sessionId === shell.sessionId && request.denied));
    await assert.rejects(readFile(marker), { code: "ENOENT" });
    assert.deepEqual(fixture.model.requests.at(-1)?.tools, ["bash"]);
    assert.equal(fixture.model.requests.at(-1)?.hasSeed, false);
    await shell.disconnect();
    await fixture.client.deleteSession(shell.sessionId);
  });

  await context.test("propagates cancellation to a cooperative custom tool", async () => {
    await observeCancellation(fixture);
  });

  await context.test("deletes only the owned sessions and observes their absence from the API", async () => {
    await session.disconnect();
    assert((await fixture.client.listSessions()).some((item) => item.sessionId === originalId));
    await fixture.client.deleteSession(originalId);
    assert.deepEqual(await fixture.client.listSessions(), []);
    assert.deepEqual(fixture.model.errors, []);
    context.diagnostic(`${fixture.model.requests.length} loopback model requests; no authenticated inference`);
  });
});
