import { describe, expect, it } from "vitest";
import {
  asExtensionContext,
  createContext,
  fakeVscode,
  type AdaptivePairExtensionApi,
} from "./pairToolTestHarness.js";



describe("extension lifecycle", () => {
  it("stays inactive on activation until an Adaptive Pair command runs", async () => {
    const { activate } = await import("../src/extension.js");
    const api = activate(asExtensionContext(createContext())) as AdaptivePairExtensionApi;

    expect(api.getState().presenceStatus).toBe("off");
    expect(fakeVscode.state.documentListeners.size).toBe(0);
    expect(fakeVscode.state.workspaceReads).toBe(0);
    expect(fakeVscode.state.modelRequests).toBe(0);
    expect(fakeVscode.state.statusItems).toHaveLength(1);
    expect(fakeVscode.state.statusItems[0]?.text).toBe("$(circle-slash) Pair: off");
  });

  it("enables presence idempotently and does not write external settings", async () => {
    const { activate } = await import("../src/extension.js");
    const api = activate(asExtensionContext(createContext())) as AdaptivePairExtensionApi;

    await fakeVscode.module.commands.executeCommand("adaptivePair.enablePresence");
    const first = api.getState();
    await fakeVscode.module.commands.executeCommand("adaptivePair.enablePresence");
    const second = api.getState();

    expect(first.presenceStatus).toBe("observing");
    expect(second.presenceStatus).toBe("observing");
    expect(second.runtimeRevision).toBe(first.runtimeRevision);
    expect(fakeVscode.state.documentListeners.size).toBe(1);
    expect(fakeVscode.state.settingsWrites).toEqual([]);
  });

  it("keeps the local observation window when switching to quiet", async () => {
    const { activate } = await import("../src/extension.js");
    const api = activate(asExtensionContext(createContext())) as AdaptivePairExtensionApi;

    await fakeVscode.module.commands.executeCommand("adaptivePair.enablePresence");
    fakeVscode.emitDocumentChange("/workspace/src/pair.ts");
    expect(api.getState().observationCount).toBe(1);

    await fakeVscode.module.commands.executeCommand("adaptivePair.stayQuiet");

    expect(api.getState().presenceStatus).toBe("quiet");
    expect(api.getState().observationCount).toBe(1);
    expect(fakeVscode.state.documentListeners.size).toBe(1);
    expect(fakeVscode.state.statusItems[0]?.text).toBe("$(mute) Pair: quiet");
  });

  it("disposes document listeners when paused", async () => {
    const { activate } = await import("../src/extension.js");
    const api = activate(asExtensionContext(createContext())) as AdaptivePairExtensionApi;

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
    const { activate } = await import("../src/extension.js");
    const api = activate(asExtensionContext(createContext())) as AdaptivePairExtensionApi;

    await fakeVscode.module.commands.executeCommand("adaptivePair.enablePresence");
    fakeVscode.emitDocumentChange("/workspace/src/pair.ts");
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

  it("keeps presence off in an untrusted workspace and surfaces the reason", async () => {
    const { activate } = await import("../src/extension.js");
    fakeVscode.state.workspaceTrusted = false;
    const api = activate(asExtensionContext(createContext())) as AdaptivePairExtensionApi;

    await fakeVscode.module.commands.executeCommand("adaptivePair.enablePresence");

    expect(api.getState().presenceStatus).toBe("off");
    expect(fakeVscode.state.documentListeners.size).toBe(0);
    expect(fakeVscode.state.warnings[0]?.message).toContain("trusted workspace");
  });

  it("does not write native chat, copilot, model, permission, keybinding, or isolation settings", async () => {
    const { activate } = await import("../src/extension.js");
    activate(asExtensionContext(createContext()));

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
