import { durableJournalLimits, type PairEvent, type PairRuntimeSnapshot } from "@adaptive-pair/protocol";

export class DurableProjectionError extends Error {
  constructor(code: string) {
    super(`Invalid Pair durable projection: ${code}`);
  }
}

export const failProjection = (code: string): never => { throw new DurableProjectionError(code); };

export const requireFrozenSource = (value: unknown): void => {
  const remaining: unknown[] = [value];
  const seen = new Set<object>();
  while (remaining.length > 0) {
    const current = remaining.pop();
    if (typeof current === "function") return failProjection("INVALID_CANDIDATE");
    if (typeof current !== "object" || current === null || seen.has(current)) continue;
    const prototype: unknown = Object.getPrototypeOf(current);
    if (!Object.isFrozen(current) ||
        (prototype !== Object.prototype && prototype !== Array.prototype && prototype !== null)) {
      return failProjection("INVALID_CANDIDATE");
    }
    seen.add(current);
    for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(current))) {
      if (!Object.hasOwn(descriptor, "value")) return failProjection("INVALID_CANDIDATE");
      remaining.push(descriptor.value as unknown);
    }
  }
};

export const requireCandidateCommandGroups = (events: readonly PairEvent[]): void => {
  const eventIds = new Set<string>();
  const commandIds = new Set<string>();
  let currentCommand: string | undefined;
  for (const event of events) {
    if (typeof event.eventId !== "string" || event.eventId.length === 0 ||
        typeof event.commandId !== "string" || event.commandId.length === 0) return failProjection("INVALID_CANDIDATE");
    if (eventIds.has(event.eventId)) return failProjection("COMMAND_REUSE");
    eventIds.add(event.eventId);
    if (event.commandId === currentCommand) continue;
    if (commandIds.has(event.commandId)) return failProjection("COMMAND_REUSE");
    commandIds.add(event.commandId);
    currentCommand = event.commandId;
  }
};

export interface CandidateSignature {
  readonly expectedSequence: number;
  readonly previous: number;
  readonly events: readonly number[];
}

export class ProjectionIdentities {
  #objects = new WeakMap<object, number>();
  #nextObject = 0;
  #codeUnits = 0;

  checkStrings(values: readonly string[]): void {
    let total = this.#codeUnits;
    for (const value of values) {
      if (typeof value !== "string" || value.length === 0) return failProjection("INVALID_CANDIDATE");
      total += value.length;
      if (total > durableJournalLimits.textCodeUnits) return failProjection("LIMIT_EXCEEDED");
    }
  }

  retainStrings(values: readonly string[]): void {
    for (const value of values) {
      this.#codeUnits += value.length;
    }
  }

  #objectKey(value: object): number {
    let key = this.#objects.get(value);
    if (key === undefined) {
      key = this.#nextObject++;
      this.#objects.set(value, key);
    }
    return key;
  }

  remember(previous: PairRuntimeSnapshot, events: readonly PairEvent[], expectedSequence: number): CandidateSignature {
    return Object.freeze({
      expectedSequence, previous: this.#objectKey(previous),
      events: Object.freeze(events.map(event => this.#objectKey(event))),
    });
  }

  matches(signature: CandidateSignature, previous: PairRuntimeSnapshot, events: readonly PairEvent[], expectedSequence: number): boolean {
    return signature.expectedSequence === expectedSequence && signature.previous === this.#objects.get(previous) &&
      signature.events.length === events.length &&
      events.every((event, index) => signature.events[index] === this.#objects.get(event));
  }
}

export const candidateSourceIds = (previous: PairRuntimeSnapshot, events: readonly PairEvent[]): readonly string[] => [
  previous.presence.workspaceId,
  ...events.flatMap(event => {
    switch (event.type) {
      case "PresenceEnabled": return [event.commandId, event.workspaceId];
      case "WorkUnitProposed": return [event.commandId, event.workUnit.id];
      case "OperationAuthorized": return [event.commandId, event.operation.id, event.operation.workUnitId];
      default: return [event.commandId];
    }
  }),
];
