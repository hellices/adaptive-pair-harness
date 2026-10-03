import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { ProviderConfig } from "@github/copilot-sdk";

export interface ModelWitness {
  readonly tools: readonly string[];
  readonly hasSeed: boolean;
  readonly hasGuardRefusal: boolean;
  readonly emittedTool: string | undefined;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

async function readPayload(request: IncomingMessage): Promise<Record<string, unknown>> {
  let body = "";
  for await (const chunk of request) {
    assert(Buffer.isBuffer(chunk));
    body += chunk.toString("utf8");
    assert(Buffer.byteLength(body) <= 1_048_576, "Fixture request exceeds byte bound");
  }
  const payload: unknown = JSON.parse(body);
  assert(isRecord(payload));
  assert(Array.isArray(payload.messages));
  return payload;
}

function toolNames(payload: Record<string, unknown>): string[] {
  if (payload.tools === undefined) return [];
  assert(Array.isArray(payload.tools));
  return payload.tools.map((tool: unknown) => {
    assert(isRecord(tool) && isRecord(tool.function));
    assert.equal(typeof tool.function.name, "string");
    return tool.function.name as string;
  });
}

export async function createModelFixture() {
  const token = randomUUID();
  const requests: ModelWitness[] = [];
  const errors: string[] = [];
  let pending: { name: string; arguments: Record<string, unknown> } | undefined;

  const respond = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    assert.equal(request.headers.authorization, `Bearer ${token}`);
    assert.equal(request.method, "POST");
    assert.equal(request.url, "/v1/chat/completions");
    const payload = await readPayload(request);
    const planned = pending;
    pending = undefined;
    const history = JSON.stringify(payload.messages);
    requests.push({
      tools: toolNames(payload), hasSeed: history.includes("PAIR_SYNTHETIC_SEED"),
      hasGuardRefusal: history.includes("PAIR_GUARD_DENIED"), emittedTool: planned?.name,
    });
    const message = planned === undefined
      ? { role: "assistant", content: "PAIR_SYNTHETIC_COMPLETE" }
      : { role: "assistant", tool_calls: [{ index: 0, id: randomUUID(), type: "function",
        function: { name: planned.name, arguments: JSON.stringify(planned.arguments) } }] };
    const completion = {
      id: randomUUID(), object: "chat.completion.chunk", model: "fixture",
      created: Math.floor(Date.now() / 1000),
    };
    const reason = planned === undefined ? "stop" : "tool_calls";
    if (payload.stream === true) {
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      response.write(`data: ${JSON.stringify({ ...completion,
        choices: [{ index: 0, delta: message, finish_reason: null }] })}\n\n`);
      response.write(`data: ${JSON.stringify({ ...completion,
        choices: [{ index: 0, delta: {}, finish_reason: reason }] })}\n\n`);
      response.end("data: [DONE]\n\n");
    } else {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ ...completion, object: "chat.completion",
        choices: [{ index: 0, message, finish_reason: reason }] }));
    }
  };
  const server = createServer((request, response) => {
    void respond(request, response).catch((error: unknown) => {
      errors.push(String(error));
      response.writeHead(500);
      response.end("Synthetic fixture rejected request");
    });
  });
  server.requestTimeout = 5_000;
  server.headersTimeout = 5_000;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert(address !== null && typeof address === "object");
  const provider: ProviderConfig = {
    type: "openai", baseUrl: `http://127.0.0.1:${address.port}/v1`, apiKey: token,
  };
  return {
    provider, requests, errors,
    enqueue(name: string, argumentsValue: Record<string, unknown> = {}): void {
      assert.equal(pending, undefined, "Previous fixture call was not consumed");
      pending = { name, arguments: argumentsValue };
    },
    async close(): Promise<void> {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error === undefined ? resolve() : reject(error));
      });
    },
  };
}
