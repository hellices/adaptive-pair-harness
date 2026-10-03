import { describe, expect, it } from "vitest";
import {
  asExtensionContext,
  createContext,
  fakeVscode,
  type AdaptivePairExtensionApi,
} from "./pairToolTestHarness.js";

const activateExtension = async (): Promise<AdaptivePairExtensionApi> => {
  const { activate } = await import("../src/extension.js");
  return activate(asExtensionContext(createContext()));
};

describe("extension lifecycle", () => {
  it("stays inactive on activation until an Adaptive Pair command runs", async () => {
    const api = await activateExtension();

    expect(api.getState().presenceStatus).toBe("off");
    expect(fakeVscode.state.documentListeners.size).toBe(0);
    expect(fakeVscode.state.workspaceReads).toBe(0);
    expect(fakeVscode.state.modelRequests).toBe(0);
    expect(fakeVscode.state.statusItems).toHaveLength(1);
    expect(fakeVscode.state.statusItems[0]?.text).toBe("$(circle-slash) Pair: off");
  });

  it("enables presence idempotently", async () => {
    const api = await activateExtension();

    await fakeVscode.module.commands.executeCommand("adaptivePair.enablePresence");
    const first = api.getState();
    await fakeVscode.module.commands.executeCommand("adaptivePair.enablePresence");
    const second = api.getState();

    expect(first.presenceStatus).toBe("observing");
    expect(second.presenceStatus).toBe("observing");
    expect(second.runtimeRevision).toBe(first.runtimeRevision);
    expect(fakeVscode.state.documentListeners.size).toBe(1);
  });

  it("keeps the local observation window when switching to quiet", async () => {
    const api = await activateExtension();

    await fakeVscode.module.commands.executeCommand("adaptivePair.enablePresence");
    fakeVscode.emitChange("/workspace/src/pair.ts");
    expect(api.getState().observationCount).toBe(1);

    await fakeVscode.module.commands.executeCommand("adaptivePair.stayQuiet");

    expect(api.getState().presenceStatus).toBe("quiet");
    expect(api.getState().observationCount).toBe(1);
    expect(fakeVscode.state.documentListeners.size).toBe(1);
    expect(fakeVscode.state.statusItems[0]?.text).toBe("$(mute) Pair: quiet");
  });

  it("disposes document listeners when paused", async () => {
    const api = await activateExtension();

    await fakeVscode.module.commands.executeCommand("adaptivePair.enablePresence");
    expect(fakeVscode.state.documentListeners.size).toBe(1);

    await fakeVscode.module.commands.executeCommand("adaptivePair.pausePresence");

    expect(api.getState().presenceStatus).toBe("paused");
    expect(fakeVscode.state.documentListeners.size).toBe(0);
    expect(api.getState().contextKeys).toMatchObject({
      "adaptivePair.presenceEnabled": false,
      "adaptivePair.sessionActive": false,
      "adaptivePair.mode": "",
      "adaptivePair.aiCanEdit": false,
    });
  });

  it("clears local continuity after confirmation when disabled", async () => {
    const api = await activateExtension();

    await fakeVscode.module.commands.executeCommand("adaptivePair.enablePresence");
    fakeVscode.emitChange("/workspace/src/pair.ts");
    expect(api.getState().observationCount).toBe(1);

    fakeVscode.state.warningResponses.push("Disable and clear");
    await fakeVscode.module.commands.executeCommand("adaptivePair.disablePresence");

    expect(api.getState()).toMatchObject({
      presenceStatus: "off",
      sessionStatus: "inactive",
      observationCount: 0,
      documentListenerActive: false,
    });
    expect(fakeVscode.state.statusItems[0]?.text).toBe("$(circle-slash) Pair: off");
  });

  it("does not write native chat, copilot, model, permission, keybinding, or isolation settings", async () => {
    await activateExtension();

    fakeVscode.state.textDocuments = [{
      isDirty: true,
      uri: fakeVscode.createUri("/workspace/src/pair.ts"),
    }];
    fakeVscode.state.visibleTextEditors = [{
      document: {
        uri: fakeVscode.createUri("/workspace/src/pair.ts"),
      },
    }];
    fakeVscode.state.warningResponses.push("Disable and clear");

    await fakeVscode.module.commands.executeCommand("adaptivePair.enablePresence");
    await fakeVscode.module.commands.executeCommand("adaptivePair.startSession");
    await fakeVscode.module.commands.executeCommand("adaptivePair.joinInProgress");
    await fakeVscode.module.commands.executeCommand("adaptivePair.stayQuiet");
    await fakeVscode.module.commands.executeCommand("adaptivePair.pausePresence");
    await fakeVscode.module.commands.executeCommand("adaptivePair.disablePresence");

    expect(fakeVscode.state.settingsWrites).toEqual([]);
  });
});
