import { expect, it } from "vitest";
import { parsePairCommand, parsePairEvent } from "../src/index.js";
import { createEventFixtures, toWireEvent } from "./eventFixtures.js";

const withInheritedProperty = (
  name: string,
  descriptor: PropertyDescriptor,
  action: () => unknown,
) => {
  const original = Object.getOwnPropertyDescriptor(Object.prototype, name);
  let result: unknown;
  let error: unknown;
  Object.defineProperty(Object.prototype, name, { configurable: true, ...descriptor });
  try {
    result = action();
  } catch (caught) {
    error = caught;
  } finally {
    if (original === undefined) Reflect.deleteProperty(Object.prototype, name);
    else Object.defineProperty(Object.prototype, name, original);
  }
  return { result, error };
};

it.each(["eventId", "revision", "actor"])("requires an own event %s", field => {
  const event = toWireEvent(createEventFixtures().WorkspaceObserved);
  const inherited = event[field];
  delete event[field];
  const { error } = withInheritedProperty(field, { value: inherited }, () => parsePairEvent(event));
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toMatch(/^Invalid Pair event:/);
});

it("does not read inherited required-field getters", () => {
  const event = toWireEvent(createEventFixtures().WorkspaceObserved);
  delete event.revision;
  let getterCalls = 0;
  const { error } = withInheritedProperty("revision", {
    get: () => { getterCalls += 1; return 1; },
  }, () => parsePairEvent(event));
  expect(getterCalls).toBe(0);
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toMatch(/^Invalid Pair event:/);
});

it("does not turn inherited epoch metadata into an own grant", () => {
  const event = toWireEvent(createEventFixtures().UserActionGranted);
  let getterCalls = 0;
  const { result, error } = withInheritedProperty("authorityEpoch", {
    get: () => { getterCalls += 1; return 999; },
  }, () => parsePairEvent(event));
  expect(error).toBeUndefined();
  expect(getterCalls).toBe(0);
  expect(result).toStrictEqual(createEventFixtures().UserActionGranted);
});

it.each(["summary", "userActionGrantId"])("does not hydrate inherited operation %s", field => {
  const event = toWireEvent(createEventFixtures().OperationAuthorized);
  let getterCalls = 0;
  const { result, error } = withInheritedProperty(field, {
    get: () => { getterCalls += 1; return "injected"; },
  }, () => parsePairEvent(event));
  expect(error).toBeUndefined();
  expect(getterCalls).toBe(0);
  expect(result).toStrictEqual(createEventFixtures().OperationAuthorized);
});

it("ignores unrelated enumerable prototype data without copying it", () => {
  const event = createEventFixtures().WorkspaceObserved;
  const { result, error } = withInheritedProperty("unrelated", {
    enumerable: true, value: "not a JSON field",
  }, () => parsePairEvent(event));
  expect(error).toBeUndefined();
  expect(result).toStrictEqual(event);
});

it("does not mistake inherited descriptor metadata for an own data property", () => {
  let getterCalls = 0;
  const observation = {
    get result() { getterCalls += 1; return "not JSON data"; },
  };
  const event = { ...toWireEvent(createEventFixtures().OperationObserved), observation };
  const { error } = withInheritedProperty("value", { value: "inherited descriptor value" },
    () => parsePairEvent(event));
  expect(getterCalls).toBe(0);
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toMatch(/^Invalid Pair event:/);
});

it("also keeps inherited fields outside the shared command boundary", () => {
  const command = {
    protocolVersion: 1, type: "ObserveWorkspace", commandId: "command-1",
    actor: "host", observedAt: 100,
  };
  let getterCalls = 0;
  const { error } = withInheritedProperty("expectedRevision", {
    get: () => { getterCalls += 1; return 0; },
  }, () => parsePairCommand(command));
  expect(getterCalls).toBe(0);
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toMatch(/^Invalid Pair command:/);
});

it.each(["event", "command"])("captures %s descriptors without subsequent caller reads", kind => {
  let getterCalls = 0;
  const leaked = () => 1;
  const payload = new Proxy({
    get value() { getterCalls += 1; return leaked; },
  }, {
    getOwnPropertyDescriptor: () => ({ configurable: true, enumerable: true, writable: true, value: "safe" }),
  });
  const parsed = kind === "event" ? parsePairEvent({
    ...toWireEvent(createEventFixtures().OperationObserved), observation: { result: payload },
  }) : parsePairCommand({
    protocolVersion: 1, type: "ObserveOperationResult", commandId: "command-1", expectedRevision: 0,
    actor: "host", observedAt: 100, operationId: "operation-1", authorityEpoch: 0,
    status: "confirmed", summary: "Observed", observation: { result: payload },
  });
  expect(getterCalls).toBe(0);
  expect(parsed).toMatchObject({ observation: { result: { value: "safe" } } });
  expect(JSON.stringify(parsed)).toContain('"value":"safe"');
});
