interface JsonLimits {
  readonly maximumDepth: number;
  readonly maximumNodes: number;
}

interface CaptureContext extends JsonLimits {
  readonly path: WeakSet<object>;
  readonly error: (reason: string) => Error;
  remainingNodes: number;
}

const enumerableValue = (value: object, name: string, label: string, context: CaptureContext): unknown => {
  const descriptor = Object.getOwnPropertyDescriptor(value, name);
  if (descriptor === undefined || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) {
    throw context.error(`${label} ${name} must be a plain enumerable data property`);
  }
  return descriptor.value as unknown;
};

const captureArray = (
  value: readonly unknown[], names: readonly string[], depth: number, context: CaptureContext,
): readonly unknown[] => {
  const length: unknown = Object.getOwnPropertyDescriptor(value, "length")?.value;
  if (typeof length !== "number" || !Number.isInteger(length) || length < 0 || length >= 2 ** 32) {
    throw context.error("invalid array length");
  }
  const clone: unknown[] = [];
  clone.length = length;
  for (const name of names) {
    if (name === "length") continue;
    const index = Number(name);
    if (!/^(0|[1-9]\d*)$/.test(name) || !Number.isInteger(index) || index >= length) {
      throw context.error(`non-index array property ${name} is not allowed`);
    }
    clone[index] = captureValue(enumerableValue(value, name, "array index", context), depth + 1, context);
  }
  for (let index = 0; index < length; index += 1) {
    if (!Object.hasOwn(clone, index)) throw context.error(`sparse array holes are not allowed at index ${index}`);
  }
  return clone;
};

const captureObject = (
  value: object, names: readonly string[], depth: number, context: CaptureContext,
): Record<string, unknown> => {
  const clone = Object.create(null) as Record<string, unknown>;
  for (const name of names) {
    clone[name] = captureValue(enumerableValue(value, name, "property", context), depth + 1, context);
  }
  return clone;
};

const captureValue = (value: unknown, depth: number, context: CaptureContext): unknown => {
  if (depth > context.maximumDepth) {
    throw context.error(`maximum JSON depth of ${context.maximumDepth} exceeded`);
  }
  context.remainingNodes -= 1;
  if (context.remainingNodes < 0) {
    throw context.error(`maximum expanded JSON node count of ${context.maximumNodes} exceeded`);
  }
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw context.error("non-finite numbers are not allowed");
    return value;
  }
  if (value === undefined) throw context.error("undefined is not allowed");
  if (typeof value === "function") throw context.error("functions are not allowed");
  if (typeof value !== "object") throw context.error(`unsupported ${typeof value} value`);
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype) {
    throw context.error("only plain objects and arrays are allowed");
  }
  if (context.path.has(value)) throw context.error("circular references are not allowed");
  context.path.add(value);
  try {
    const names = Reflect.ownKeys(value).map(key => {
      if (typeof key === "symbol") throw context.error(`symbol key ${String(key)} is not allowed`);
      return key;
    });
    return Array.isArray(value)
      ? captureArray(value, names, depth, context)
      : captureObject(value, names, depth, context);
  } finally {
    context.path.delete(value);
  }
};

export const jsonValidationSnapshot = (
  value: unknown, kind: "command" | "event", limits?: JsonLimits,
): unknown => captureValue(value, 0, {
  maximumDepth: limits?.maximumDepth ?? Number.POSITIVE_INFINITY,
  maximumNodes: limits?.maximumNodes ?? Number.POSITIVE_INFINITY,
  remainingNodes: limits?.maximumNodes ?? Number.POSITIVE_INFINITY,
  path: new WeakSet<object>(),
  error: reason => new Error(`Invalid Pair ${kind}: ${reason}`),
});
