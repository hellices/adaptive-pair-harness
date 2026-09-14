const deepCloneUnknown = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(item => deepCloneUnknown(item));
  }

  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.keys(value).map(key => [key, deepCloneUnknown((value as Record<string, unknown>)[key])]),
    );
  }

  return value;
};

const deepFreeze = <Value>(value: Value): Value => {
  if (typeof value === "object" && value !== null) {
    for (const key of Object.keys(value)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }

    Object.freeze(value);
  }

  return value;
};

export const cloneFrozen = <Value>(value: Value): Value =>
  deepFreeze(deepCloneUnknown(value) as Value);
