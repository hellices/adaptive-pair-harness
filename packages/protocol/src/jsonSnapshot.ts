
const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" &&
  value !== null &&
  Object.getPrototypeOf(value) === Object.prototype;

const jsonError = (reason: string) =>
  new Error(`Invalid Pair command: ${reason}`);

export const assertJsonCompatible = (
  value: unknown,
  path = new WeakSet<object>(),
): void => {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw jsonError("non-finite numbers are not allowed");
    }
    return;
  }

  if (typeof value === "undefined") {
    throw jsonError("undefined is not allowed");
  }

  if (typeof value === "bigint" || typeof value === "symbol") {
    throw jsonError(`unsupported ${typeof value} value`);
  }

  if (typeof value === "function") {
    throw jsonError("functions are not allowed");
  }

  if (Array.isArray(value)) {
    if (path.has(value)) {
      throw jsonError("circular references are not allowed");
    }
    path.add(value);

    try {
      for (const symbol of Object.getOwnPropertySymbols(value)) {
        throw jsonError(`symbol key ${String(symbol)} is not allowed`);
      }

      for (const name of Object.getOwnPropertyNames(value)) {
        if (name === "length") {
          continue;
        }

        const numericName = Number(name);
        if (
          !/^(0|[1-9]\d*)$/.test(name) ||
          !Number.isInteger(numericName) ||
          numericName >= 2 ** 32 - 1
        ) {
          throw jsonError(`non-index array property ${name} is not allowed`);
        }

        const descriptor = Object.getOwnPropertyDescriptor(value, name);
        if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
          throw jsonError(`array index ${name} must be a plain enumerable data property`);
        }

        assertJsonCompatible(descriptor.value, path);
      }

      for (let index = 0; index < value.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(value, index)) {
          throw jsonError(`sparse array holes are not allowed at index ${index}`);
        }
      }
    } finally {
      path.delete(value);
    }

    return;
  }

  if (typeof value === "object") {
    if (!isPlainObject(value)) {
      throw jsonError("only plain objects and arrays are allowed");
    }

    if (path.has(value)) {
      throw jsonError("circular references are not allowed");
    }
    path.add(value);

    try {
      for (const symbol of Object.getOwnPropertySymbols(value)) {
        throw jsonError(`symbol key ${String(symbol)} is not allowed`);
      }

      for (const name of Object.getOwnPropertyNames(value)) {
        const descriptor = Object.getOwnPropertyDescriptor(value, name);
        if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
          throw jsonError(`property ${name} must be a plain enumerable data property`);
        }

        assertJsonCompatible(descriptor.value, path);
      }
    } finally {
      path.delete(value);
    }

    return;
  }

  throw jsonError("unsupported value");
};

function deepClone<Value>(value: Value): Value;

function deepClone(value: unknown): unknown {
  if (Array.isArray(value)) {
    const arrayValue: readonly unknown[] = value;
    const clone: unknown[] = [];
    clone.length = arrayValue.length;
    for (let index = 0; index < arrayValue.length; index += 1) {
      clone[index] = deepClone(arrayValue[index]);
    }
    return clone;
  }

  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.keys(value).map((key) => [
        key,
        deepClone((value as Record<string, unknown>)[key]),
      ]),
    );
  }

  return value;
}

const deepFreeze = <Value>(value: Value): Value => {
  if (typeof value === "object" && value !== null) {
    for (const key of Object.keys(value)) {
      deepFreeze(value[key as keyof typeof value]);
    }
    Object.freeze(value);
  }

  return value;
};

export const immutableJsonSnapshot = <Value>(value: Value): Value => deepFreeze(deepClone(value));
