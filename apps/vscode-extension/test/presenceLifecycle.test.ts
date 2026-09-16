import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildController,
  FakeScheduler,
  flush,
  harness,
  MemoryFs,
  run,
} from "./presenceTestHarness.js";
import { VscodeWorkspaceContextAccess } from "../src/workspaceContextAccess.js";

const deferred = () => {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>(release => { resolve = release; });
  return { promise, resolve };
};

afterEach(() => vi.restoreAllMocks());

describe("Presence lifecycle intent", () => {
  it.each(["enablePresence", "stayQuiet", "startSession", "joinInProgress"])(
    "cancels %s waiting on trust when Disable is requested",
    async action => {
      const { controller } = buildController(new FakeScheduler(), new MemoryFs());

      const pending = run(`adaptivePair.${action}`);
      await Promise.all([pending, controller.performDisable()]);

      expect(controller.getState()).toMatchObject({
        presenceStatus: "off",
        sessionStatus: "inactive",
        documentListenerActive: false,
      });
      expect(controller.getState().contextKeys["adaptivePair.presenceEnabled"]).toBe(false);
    },
  );

  it("cancels a pending Start when Pause is requested", async () => {
    const { controller } = buildController(new FakeScheduler(), new MemoryFs());
    await run("adaptivePair.enablePresence");
    const start = run("adaptivePair.startSession");

    await Promise.all([start, run("adaptivePair.pausePresence")]);

    expect(controller.getState().presenceStatus).toBe("paused");
    expect(controller.getState().documentListenerActive).toBe(false);
    expect(controller.getState().sessionStatus).toBe("inactive");
  });

  it("does not reattach a listener from an earlier Enable completion", async () => {
    const scheduler = new FakeScheduler();
    const { controller, sessionController } = buildController(scheduler, new MemoryFs());
    const enable = sessionController.enablePresence.bind(sessionController);
    const completed = deferred();
    const release = deferred();
    vi.spyOn(sessionController, "enablePresence").mockImplementation(async () => {
      const snapshot = await enable();
      completed.resolve();
      await release.promise;
      return snapshot;
    });

    const pending = run("adaptivePair.enablePresence");
    await completed.promise;
    await controller.performDisable();
    release.resolve();
    await pending;
    harness.emitChange("/workspace/src/pair.ts");

    expect(controller.getState()).toMatchObject({
      presenceStatus: "off",
      documentListenerActive: false,
      observationCount: 0,
    });
    expect(scheduler.pendingCount()).toBe(0);
  });

  it("does not project an old Disable over a later explicit Enable", async () => {
    const fs = new MemoryFs();
    const { controller } = buildController(new FakeScheduler(), fs);
    await run("adaptivePair.enablePresence");
    const removal = deferred();
    const release = deferred();
    const remove = fs.remove.bind(fs);
    vi.spyOn(fs, "remove").mockImplementation(async filePath => {
      removal.resolve();
      await release.promise;
      await remove(filePath);
    });

    const disabling = controller.performDisable();
    await removal.promise;
    await run("adaptivePair.enablePresence");
    release.resolve();
    await disabling;

    expect(controller.getState()).toMatchObject({
      presenceStatus: "observing",
      documentListenerActive: true,
    });
    expect(controller.getState().contextKeys["adaptivePair.presenceEnabled"]).toBe(true);
    expect(harness.state.statusText).toContain("Pair: observing");
  });

  it("ignores stale listener callbacks before any workspace read", async () => {
    const scheduler = new FakeScheduler();
    const { controller } = buildController(scheduler, new MemoryFs());
    await run("adaptivePair.enablePresence");
    const listener = [...harness.state.documentListeners][0];
    await controller.performDisable();
    harness.state.documentListeners.add(listener!);

    harness.emitChange("/workspace/src/pair.ts");
    await flush();

    expect(controller.getState().observationCount).toBe(0);
    expect(scheduler.pendingCount()).toBe(0);
  });

  it("does not enable or capture after disposal", async () => {
    const { controller } = buildController(new FakeScheduler(), new MemoryFs());
    const read = vi.spyOn(VscodeWorkspaceContextAccess.prototype, "readGitMetadata");
    const pending = run("adaptivePair.joinInProgress");
    controller.dispose();
    await pending;

    expect(controller.getState().presenceStatus).toBe("off");
    expect(controller.getState().documentListenerActive).toBe(false);
    expect(read).not.toHaveBeenCalled();
  });
});

describe("Session capture cancellation", () => {
  it.each(["disablePresence", "pausePresence", "dispose"] as const)(
    "stops native reads after %s interrupts metadata capture",
    async action => {
      const { sessionController } = buildController(new FakeScheduler(), new MemoryFs());
      const metadata = deferred();
      const release = deferred();
      vi.spyOn(VscodeWorkspaceContextAccess.prototype, "readGitMetadata")
        .mockImplementation(async () => {
          metadata.resolve();
          await release.promise;
          return { branch: undefined, dirtyPaths: ["src/pair.ts"], stagedPaths: [], untrackedPaths: [] };
        });
      const open = vi.spyOn(VscodeWorkspaceContextAccess.prototype, "openDocuments");
      const inspect = vi.spyOn(VscodeWorkspaceContextAccess.prototype, "inspectPath");
      const diagnostics = vi.spyOn(VscodeWorkspaceContextAccess.prototype, "diagnostics");
      const capture = sessionController.joinInProgress();
      const settled = Promise.allSettled([capture]);
      await metadata.promise;

      await sessionController[action]();
      release.resolve();
      await settled;

      expect(open).not.toHaveBeenCalled();
      expect(inspect).not.toHaveBeenCalled();
      expect(diagnostics).not.toHaveBeenCalled();
    },
  );
});
