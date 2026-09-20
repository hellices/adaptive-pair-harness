import { requiredEnvironment } from "./contracts.js";

interface Evaluation {
  readonly exceptionDetails?: unknown;
  readonly result?: { readonly value?: { readonly ready: boolean; readonly confirmed?: boolean } };
}

interface ProtocolReply {
  readonly id: number;
  readonly error?: { readonly message: string };
  readonly result: Evaluation;
}

interface PendingRequest {
  readonly resolve: (result: Evaluation) => void;
  readonly reject: (error: Error) => void;
  readonly timeout: ReturnType<typeof setTimeout>;
}

const waitForWorkbench = async (expression: string): Promise<{ readonly ready: boolean; readonly confirmed?: boolean }> => {
  const port = requiredEnvironment("AP_NATIVE_DEBUG_PORT");
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json() as {
    readonly type: string; readonly url: string; readonly webSocketDebuggerUrl: string;
  }[];
  const target = targets.find(candidate => candidate.type === "page" && candidate.url.includes("workbench"));
  if (!target) throw new Error("The isolated workbench debug target was not found.");
  const address = new URL(target.webSocketDebuggerUrl);
  if (!["127.0.0.1", "localhost"].includes(address.hostname) || address.port !== port) {
    throw new Error("The debug target is outside the isolated loopback endpoint.");
  }
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener("error", () => reject(new Error("The isolated debugger connection failed.")), { once: true });
  });
  let sequence = 0;
  const pending = new Map<number, PendingRequest>();
  socket.addEventListener("message", (event: MessageEvent<string>) => {
    const message = JSON.parse(event.data) as ProtocolReply;
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timeout);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  });
  const evaluate = (source: string): Promise<Evaluation> => new Promise((resolve, reject) => {
    sequence += 1;
    const requestId = sequence;
    const timeout = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error("The isolated workbench inspection timed out."));
    }, 5000);
    pending.set(requestId, { resolve, reject, timeout });
    socket.send(JSON.stringify({ id: requestId, method: "Runtime.evaluate", params: {
      expression: source, returnByValue: true,
    } }));
  });
  try {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const result = await evaluate(expression);
      if (result.exceptionDetails) throw new Error("The isolated workbench evaluation failed.");
      if (result.result?.value?.ready) return result.result.value;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error("The expected isolated workbench state did not appear.");
  } finally {
    socket.close();
  }
};

export const confirmOwnedDeletion = (): ReturnType<typeof waitForWorkbench> => waitForWorkbench(`(() => {
  const dialog = document.querySelector('.monaco-dialog-box');
  if (!dialog) return { ready: false };
  const text = dialog.textContent;
  const button = [...dialog.querySelectorAll('a.monaco-button, button')]
    .find(candidate => /^Delete(?: Session)?$/i.test(candidate.textContent.trim()));
  if (!/session/i.test(text) || !button) return { ready: false };
  button.click();
  return { ready: true, confirmed: true };
})()`);

export const waitForNativeFork = (): ReturnType<typeof waitForWorkbench> => waitForWorkbench(`({
  ready: [...document.querySelectorAll('.chat-view-title-container')]
    .some(title => title.textContent.includes('Fork'))
})`);
