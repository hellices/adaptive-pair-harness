import { afterEach, vi } from "vitest";
import type { Scheduler } from "@adaptive-pair/evidence";
import type { JournalFileSystem } from "../src/storageAdapter.js";
import { MemoryFs } from "./fakeHost.js";

// Modals dismiss by default; push the action label onto
// `harness.state.warningResponses` to accept one.
const harness = await vi.hoisted(async () => {
  const { createFakeVscodeHost } = await import("./fakeHost.js");
  return createFakeVscodeHost();
});

export { harness, MemoryFs };

vi.mock("vscode", () => harness.module);

const vscode = await import("vscode");
export const { PresenceController } = await import("../src/presenceController.js");
export const { SessionController } = await import("../src/sessionController.js");
const { StatusView } = await import("../src/statusView.js");
const { PairToolContext } = await import("../src/tools/pairToolContext.js");
export const { NodeJournalFileSystem } = await import("../src/storageAdapter.js");

export class FakeScheduler implements Scheduler {
  private nextHandleId = 1;
  private now = 0;
  private readonly tasks = new Map<
    number,
    { readonly runAt: number; readonly callback: () => void }
  >();

  public schedule(delayMs: number, callback: () => void): number {
    const handle = this.nextHandleId++;
    this.tasks.set(handle, { runAt: this.now + delayMs, callback });
    return handle;
  }

  public cancel(handle: unknown): void {
    if (typeof handle === "number") {
      this.tasks.delete(handle);
    }
  }

  public pendingCount(): number {
    return this.tasks.size;
  }

  public advanceBy(milliseconds: number): void {
    this.now += milliseconds;
    let due = [...this.tasks.entries()].find(([, task]) => task.runAt <= this.now);
    while (due !== undefined) {
      const [handle, task] = due;
      this.tasks.delete(handle);
      task.callback();
      due = [...this.tasks.entries()].find(([, task]) => task.runAt <= this.now);
    }
  }
}

export class DelayedReadMemoryFs extends MemoryFs {
  private nextRead:
    | {
        readonly started: () => void;
        readonly released: Promise<void>;
      }
    | undefined;

  public delayNextRead(): {
    readonly started: Promise<void>;
    readonly release: () => void;
  } {
    let markStarted: () => void = () => undefined;
    let release: () => void = () => undefined;
    const started = new Promise<void>(resolve => {
      markStarted = resolve;
    });
    const released = new Promise<void>(resolve => {
      release = resolve;
    });
    this.nextRead = { started: markStarted, released };
    return { started, release };
  }

  public override async readFile(path: string): Promise<string | undefined> {
    const delayed = this.nextRead;
    if (delayed !== undefined) {
      this.nextRead = undefined;
      delayed.started();
      await delayed.released;
    }
    return await super.readFile(path);
  }
}

interface FakeContext {
  readonly subscriptions: { dispose(): void }[];
  readonly globalStorageUri: { readonly fsPath: string };
}

const createContext = (): FakeContext => ({
  subscriptions: [],
  globalStorageUri: { fsPath: "/journal-storage" },
});

export const buildController = (
  scheduler: Scheduler = new FakeScheduler(),
  fs: JournalFileSystem = new MemoryFs(),
): {
  readonly controller: InstanceType<typeof PresenceController>;
  readonly context: FakeContext;
  readonly sessionController: InstanceType<typeof SessionController>;
} => {
  const sessionController = new SessionController();
  const controller = new PresenceController(
    sessionController,
    new StatusView(),
    new PairToolContext(),
    { scheduler, journalFileSystem: fs },
  );
  const context = createContext();
  controller.register(context as unknown as Parameters<typeof controller.register>[0]);
  return { controller, context, sessionController };
};

export const run = async (name: string): Promise<unknown> =>
  await vscode.commands.executeCommand(name);

export const flush = async (): Promise<void> => {
  await new Promise(resolve => setTimeout(resolve, 0));
  await new Promise(resolve => setTimeout(resolve, 0));
};

afterEach(() => {
  harness.reset();
});
