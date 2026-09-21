import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CopilotClient, RuntimeConnection, type CopilotSession, type SessionConfig, type Tool,
} from "@github/copilot-sdk";
import { createModelFixture } from "./model.mjs";

export async function createRuntimeFixture() {
  assert.notEqual(process.platform, "win32", "The shell-denial probe requires POSIX");
  const root = await mkdtemp(join(tmpdir(), "adaptive-pair-runtime-"));
  for (const directory of ["home", "work", "data", "temp", "config", "cache", "state"]) {
    await mkdir(join(root, directory));
  }
  const model = await createModelFixture();
  const effects: string[] = [];
  const calls: { tool: string; sessionId: string; toolCallId: string }[] = [];
  const hooks: { tool: string; sessionId: string }[] = [];
  const permissions: { kind: string; tool: string | undefined; sessionId: string; denied: boolean }[] = [];
  const makeClient = (): CopilotClient => new CopilotClient({
    mode: "empty",
    connection: RuntimeConnection.forStdio({
      args: ["--no-auto-update", "--no-remote", "--no-remote-export"],
    }),
    baseDirectory: join(root, "data"), workingDirectory: join(root, "work"),
    useLoggedInUser: false, logLevel: "error",
    env: {
      PATH: "/usr/bin:/bin", HOME: join(root, "home"), TMPDIR: join(root, "temp"), CI: "true",
      XDG_CONFIG_HOME: join(root, "config"), XDG_CACHE_HOME: join(root, "cache"),
      XDG_DATA_HOME: join(root, "data"), XDG_STATE_HOME: join(root, "state"),
    },
  });
  let client = makeClient();
  const tools: Tool[] = ["pair_allowed", "pair_denied", "pair_excluded", "pair_hook_error", "pair_guarded"]
    .map((name) => ({
      name, description: `Synthetic ${name} fixture`,
      parameters: { type: "object", properties: {} },
      handler: (_arguments, invocation) => {
        calls.push({ tool: name, sessionId: invocation.sessionId, toolCallId: invocation.toolCallId });
        if (name === "pair_guarded") {
          return { textResultForLlm: "PAIR_GUARD_DENIED", resultType: "denied" };
        }
        effects.push(name);
        return `Synthetic ${name} result`;
      },
    }));
  const permissionHandler = (denyAll = false): NonNullable<SessionConfig["onPermissionRequest"]> =>
    (request, invocation) => {
      const tool = request.kind === "custom-tool" ? request.toolName : undefined;
      const approved = !denyAll && request.kind === "custom-tool"
        && ["pair_allowed", "pair_hook_error", "pair_guarded", "pair_wait"].includes(request.toolName);
      permissions.push({ kind: request.kind, tool, sessionId: invocation.sessionId, denied: !approved });
      return approved ? { kind: "approved" } : { kind: "denied-by-rules", rules: [] };
    };
  const configuration = (extra: Partial<SessionConfig> = {}): SessionConfig => ({
    model: "gpt-4o", provider: model.provider, tools,
    availableTools: ["custom:*"], excludedTools: ["custom:pair_excluded"],
    enableConfigDiscovery: false, skipCustomInstructions: true,
    enableSessionTelemetry: false, toolSearch: { enabled: false },
    onPermissionRequest: permissionHandler(),
    hooks: { onPreToolUse(input, invocation) {
      hooks.push({ tool: input.toolName, sessionId: invocation.sessionId });
      if (input.toolName === "pair_denied") {
        return { permissionDecision: "deny", permissionDecisionReason: "Synthetic deny" };
      }
      if (["pair_hook_error", "pair_guarded"].includes(input.toolName)) {
        throw new Error("Synthetic hook failure");
      }
      return {};
    } },
    ...extra,
  });
  return {
    root, model, effects, calls, hooks, permissions, configuration, permissionHandler,
    get client(): CopilotClient { return client; },
    async restart(): Promise<void> {
      assert.deepEqual(await client.stop(), []);
      client = makeClient();
      await client.start();
    },
    async invoke(session: CopilotSession, name: string, prompt: string,
      argumentsValue: Record<string, unknown> = {}): Promise<void> {
      const previous = model.requests.length;
      model.enqueue(name, argumentsValue);
      const response = await session.sendAndWait({ prompt }, 15_000);
      assert.equal(response?.data.content, "PAIR_SYNTHETIC_COMPLETE");
      assert.equal(model.requests[previous]?.emittedTool, name);
      assert(model.requests.length >= previous + 2, "Runtime did not complete a tool-result round trip");
      assert.deepEqual(model.errors, []);
    },
    async close(): Promise<void> {
      try { assert.deepEqual(await client.stop(), []); }
      finally { await model.close(); }
    },
  };
}
