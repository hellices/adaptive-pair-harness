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
