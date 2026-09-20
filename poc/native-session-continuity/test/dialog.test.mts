import { runInNewContext } from "node:vm";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { confirmOwnedDeletion } from "../dialog.js";

const windowToken = "synthetic-unique-owned-window";
let targetTitle: string;
let documentTitle: string;
let connections: number;
const click = vi.fn();

class FixtureSocket extends EventTarget {
  constructor() {
    super();
    connections += 1;
    queueMicrotask(() => this.dispatchEvent(new Event("open")));
  }

  send(text: string): void {
    const request = JSON.parse(text) as { readonly id: number; readonly params: { readonly expression: string } };
    const document = {
      title: documentTitle,
      querySelector: () => ({
        textContent: "Delete session?",
        querySelectorAll: () => [{ textContent: "Delete", click }],
      }),
    };
    let result: unknown;
    try {
      const value: unknown = runInNewContext(request.params.expression, { document });
      result = { result: { value } };
    } catch (error) {
      result = { exceptionDetails: { text: String(error) } };
    }
    queueMicrotask(() => this.dispatchEvent(new MessageEvent("message", {
      data: JSON.stringify({ id: request.id, result }),
    })));
  }

  close(): void {
    this.dispatchEvent(new Event("close"));
  }
}

beforeEach(() => {
  targetTitle = `Native probe ${windowToken}`;
  documentTitle = targetTitle;
  connections = 0;
  click.mockReset();
  vi.stubEnv("AP_NATIVE_DEBUG_PORT", "45001");
  vi.stubEnv("AP_NATIVE_WINDOW_TOKEN", windowToken);
  vi.stubGlobal("WebSocket", FixtureSocket);
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify([{
    type: "page", title: targetTitle, url: "vscode-file://vscode-app/workbench.html",
    webSocketDebuggerUrl: "ws://127.0.0.1:45001/devtools/page/fixture",
  }])))));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("confirms deletion only in the run's identified workbench", async () => {
  await expect(confirmOwnedDeletion()).resolves.toEqual({ ready: true, confirmed: true });
  expect(click).toHaveBeenCalledTimes(1);
});

it("rejects an unrelated workbench that acquired the allocated port", async () => {
  targetTitle = "Unrelated editor";
  await expect(confirmOwnedDeletion()).rejects.toThrow(/owned|isolated/u);
  expect(connections).toBe(0);
  expect(click).not.toHaveBeenCalled();
});

it("rechecks the actual document identity before performing a UI action", async () => {
  documentTitle = "Unrelated editor after endpoint discovery";
  await expect(confirmOwnedDeletion()).rejects.toThrow(/owned|isolated/u);
  expect(click).not.toHaveBeenCalled();
});
