import { strict as assert } from "node:assert";
import * as vscode from "vscode";

interface SessionTargetPocApi {
  readonly registered: boolean;
  getState(): {
    readonly sessionCount: number;
    readonly contentProviderCalls: number;
    readonly completedSessions: number;
  };
}

const waitFor = async (
  condition: () => boolean,
  description: string,
  details: () => string,
): Promise<void> => {
  const deadline = Date.now() + 5_000;
  while (!condition()) {
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for ${description}: ${details()}`);
    }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
};

suite("Adaptive Pair Session Target POC", () => {
  test("registers the proposed provider and native target action", async () => {
    const settings = [
      "chat.agentHost.codexAgent.enabled",
      "chat.editor.codex.preferAgentHost",
      "chat.permissions.default",
    ];
    const before = settings.map(key =>
      structuredClone(vscode.workspace.getConfiguration().inspect(key))
    );

    assert.equal(
      typeof vscode.chat.createChatSessionItemController,
      "function",
    );
    assert.equal(
      typeof vscode.chat.registerChatSessionContentProvider,
      "function",
    );

    const extension = vscode.extensions.getExtension<SessionTargetPocApi>(
      "adaptive-pair.adaptive-pair",
    );
    assert.ok(extension, "Adaptive Pair POC extension was not discovered.");
    const api = await extension.activate();
    assert.equal(api.registered, true);
    const models = await vscode.lm.selectChatModels({
      vendor: "adaptive-pair-poc",
    });
    assert.equal(
      models.length,
      1,
      "Adaptive Pair target-scoped POC model was not registered.",
    );

    const command =
      "workbench.action.chat.openNewChatSessionInPlace.adaptive-pair";
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes(command), "Adaptive Pair target action missing.");
    assert.ok(
      commands.includes("workbench.action.chat.open"),
      "Native Chat command was unexpectedly unavailable.",
    );
    assert.ok(
      commands.includes("workbench.action.chat.openNewChatSessionInPlace.local"),
      "The existing Local Session Target action was unexpectedly unavailable.",
    );

    await vscode.commands.executeCommand(command, "sidebar");
    await waitFor(
      () => api.getState().contentProviderCalls > 0,
      "the Adaptive Pair content provider",
      () => JSON.stringify(api.getState()),
    );

    await vscode.commands.executeCommand("workbench.action.chat.submit", {
      inputValue: "Verify the Adaptive Pair request handler",
    });
    await waitFor(
      () => api.getState().completedSessions === 1,
      "the Adaptive Pair request to complete",
      () => JSON.stringify(api.getState()),
    );
    assert.equal(api.getState().sessionCount, 1);
    assert.deepEqual(
      settings.map(key =>
        structuredClone(vscode.workspace.getConfiguration().inspect(key))
      ),
      before,
      "Adaptive Pair changed an existing Chat or Codex setting.",
    );
  });
});
