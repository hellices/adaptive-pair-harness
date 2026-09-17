import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import { createSessionItemController } from "../../src/sessionTargetBindings";
import { SessionTargetProviderCore } from "../../src/sessionTargetProviderCore";
import { SessionTargetStore } from "../../src/sessionTargetStore";

const createController = vi.hoisted(() =>
  vi.fn<typeof vscode.chat.createChatSessionItemController>(),
);

vi.mock("vscode", () => ({
  chat: { createChatSessionItemController: createController },
  Uri: { parse: (resource: string) => ({ toString: () => resource }) },
  ChatSessionStatus: { Failed: 0, Completed: 1, InProgress: 2, NeedsInput: 3 },
}));

const fixture = (recordCount = 0, eagerRefreshCount = 1) => {
  let sequence = 0;
  const store = new SessionTargetStore(() => `session-${++sequence}`);
  const core = new SessionTargetProviderCore(store, () => 100);
  const statuses = ["in-progress", "completed", "failed", "needs-input"] as const;
  for (let index = 0; index < recordCount; index++) {
    const record = core.create(`Session ${index}`);
    store.setStatus(record.resource, statuses[index % statuses.length]!);
  }
  const token = {
    isCancellationRequested: false,
    onCancellationRequested: vi.fn(() => ({ dispose: vi.fn() })),
  };
  const controller = {
    items: {
      replace: vi.fn<(items: readonly vscode.ChatSessionItem[]) => void>(),
      add: vi.fn<(item: vscode.ChatSessionItem) => void>(),
    },
    createChatSessionItem: vi.fn((resource: vscode.Uri, label: string): vscode.ChatSessionItem => ({
      resource,
      label,
    })),
    refreshHandler: undefined as vscode.ChatSessionItemControllerRefreshHandler | undefined,
    newChatSessionItemHandler: undefined as vscode.ChatSessionItemControllerNewItemHandler | undefined,
  };
  const initialRefreshes: Promise<void>[] = [];
  createController.mockImplementation((_sessionType, refreshHandler) => {
    controller.refreshHandler = refreshHandler;
    for (let count = 0; count < eagerRefreshCount; count++) {
      initialRefreshes.push(Promise.resolve(refreshHandler(token)));
    }
    return controller as unknown as vscode.ChatSessionItemController;
  });
  return {
    store,
    core,
    token,
    controller,
    initialRefreshes,
    start: () => createSessionItemController(core, store, "adaptive-pair"),
  };
};

const expectStoredItems = (current: ReturnType<typeof fixture>): void => {
  const statuses = {
    "in-progress": vscode.ChatSessionStatus.InProgress,
    completed: vscode.ChatSessionStatus.Completed,
    failed: vscode.ChatSessionStatus.Failed,
    "needs-input": vscode.ChatSessionStatus.NeedsInput,
  };
  expect(current.controller.items.replace).toHaveBeenCalled();
  expect(current.controller.items.replace.mock.lastCall?.[0].map(item => ({
    resource: item.resource.toString(),
    label: item.label,
    status: item.status,
    created: item.timing?.created,
  }))).toEqual(current.store.list().map(record => ({
    resource: record.resource,
    label: record.title,
    status: statuses[record.status],
    created: record.createdAt,
  })));
};

beforeEach(() => {
  createController.mockReset();
});

describe("Session Target controller initialization", () => {
  it.each([0, 1, 4])("refreshes %s stored sessions when the host calls back during construction", async recordCount => {
    const current = fixture(recordCount);
    expect(current.start()).toBe(current.controller);
    expect(createController).toHaveBeenCalledWith("adaptive-pair", expect.any(Function));
    await expect(Promise.all(current.initialRefreshes)).resolves.toEqual([undefined]);
    expectStoredItems(current);
  });

  it.each([0, 1, 4])("retains a later refresh of %s stored sessions", async recordCount => {
    const current = fixture(recordCount, 0);
    current.start();
    await current.controller.refreshHandler!(current.token);
    expectStoredItems(current);
  });

  it("does not read or publish for an already-cancelled initial refresh", async () => {
    const current = fixture(1);
    current.token.isCancellationRequested = true;
    const read = vi.spyOn(current.store, "list");
    current.start();
    await expect(Promise.all(current.initialRefreshes)).resolves.toEqual([undefined]);
    expect(read).not.toHaveBeenCalled();
    expect(current.controller.items.replace).not.toHaveBeenCalled();
  });

  it("rechecks cancellation after controller construction", async () => {
    const current = fixture(1);
    const read = vi.spyOn(current.store, "list");
    current.start();
    current.token.isCancellationRequested = true;
    await expect(Promise.all(current.initialRefreshes)).resolves.toEqual([undefined]);
    expect(read).not.toHaveBeenCalled();
    expect(current.controller.items.replace).not.toHaveBeenCalled();
  });

  it("reports a refresh failure rather than an uninitialized controller", async () => {
    const current = fixture(1);
    vi.spyOn(current.store, "list").mockImplementation(() => { throw new Error("refresh failed"); });
    current.start();
    await expect(Promise.all(current.initialRefreshes)).rejects.toThrow("refresh failed");
    expect(current.controller.items.replace).not.toHaveBeenCalled();
  });

  it("supports multiple initial callbacks without publishing before construction completes", async () => {
    const current = fixture(4, 2);
    current.start();
    expect(current.controller.items.replace).not.toHaveBeenCalled();
    await expect(Promise.all(current.initialRefreshes)).resolves.toEqual([undefined, undefined]);
    expect(current.controller.items.replace).toHaveBeenCalledTimes(2);
    expectStoredItems(current);
  });

  it("reads the current records after construction completes", async () => {
    const current = fixture();
    current.start();
    current.core.create("Created during initialization");
    await expect(Promise.all(current.initialRefreshes)).resolves.toEqual([undefined]);
    expectStoredItems(current);
    expect(current.controller.items.replace.mock.lastCall?.[0]).toHaveLength(1);
  });

  it("preserves immediate new-session creation and its promise result", async () => {
    const current = fixture(0, 0);
    current.start();
    const context = { request: { prompt: "New session" } } as vscode.ChatSessionItemControllerNewItemHandlerContext;
    const pending = current.controller.newChatSessionItemHandler!(context, current.token);
    expect(current.controller.items.add).toHaveBeenCalledTimes(1);
    expect(current.store.list()).toHaveLength(1);
    await expect(pending).resolves.toMatchObject({
      label: "New session",
      status: vscode.ChatSessionStatus.InProgress,
      timing: { created: 100 },
    });
  });

  it("rejects cancelled new-session creation without changing the store", async () => {
    const current = fixture(0, 0);
    current.start();
    current.token.isCancellationRequested = true;
    const context = { request: { prompt: "New session" } } as vscode.ChatSessionItemControllerNewItemHandlerContext;
    await expect(current.controller.newChatSessionItemHandler!(context, current.token))
      .rejects.toThrow("session creation was cancelled");
    expect(current.store.list()).toEqual([]);
    expect(current.controller.items.add).not.toHaveBeenCalled();
  });
});
