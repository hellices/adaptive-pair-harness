
const JSON_FENCE_PREFIX = "\n```json\n";

const JSON_FENCE_SUFFIX = "\n```";

const STRUCTURED_TRUNCATION_KEY = "__truncated";

type JsonPrimitive = boolean | number | string | null;

type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

type JsonObject = { [key: string]: JsonValue };

type JsonBounds = {
  readonly maxStringLength: number;
  readonly maxArrayItems: number;
};

type TruncationNote = {
  readonly kind: "string" | "array";
  readonly path: string;
  readonly originalLength: number;
  readonly keptLength: number;
};

export const trimText = (value: string, maximum: number): string =>
  value.length <= maximum ? value : `${value.slice(0, Math.max(0, maximum - 1))}…`;

const stringifyJsonFence = (heading: string, value: JsonObject): string =>
  `${heading}${JSON_FENCE_PREFIX}${JSON.stringify(value, null, 2)}${JSON_FENCE_SUFFIX}`;

const collectJsonShape = (
  value: JsonValue,
): { maxStringLength: number; maxArrayLength: number } => {
  if (typeof value === "string") {
    return {
      maxStringLength: value.length,
      maxArrayLength: 0,
    };
  }

  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number"
  ) {
    return {
      maxStringLength: 0,
      maxArrayLength: 0,
    };
  }

  if (Array.isArray(value)) {
    let maxStringLength = 0;
    let maxArrayLength = value.length;

    for (const entry of value) {
      const childShape = collectJsonShape(entry);

      maxStringLength = Math.max(maxStringLength, childShape.maxStringLength);
      maxArrayLength = Math.max(maxArrayLength, childShape.maxArrayLength);
    }

    return {
      maxStringLength,
      maxArrayLength,
    };
  }

  let maxStringLength = 0;
  let maxArrayLength = 0;

  for (const entry of Object.values(value)) {
      const childShape = collectJsonShape(entry);

      maxStringLength = Math.max(maxStringLength, childShape.maxStringLength);
      maxArrayLength = Math.max(maxArrayLength, childShape.maxArrayLength);
  }

  return {
    maxStringLength,
    maxArrayLength,
  };
};

const summarizeTruncation = (notes: readonly TruncationNote[]): JsonObject => {
  const examples = notes.slice(0, 4).map(note => ({
    kind: note.kind,
    path: note.path,
    originalLength: note.originalLength,
    keptLength: note.keptLength,
  }));

  return {
    truncated: true,
    truncatedStrings: notes.filter(note => note.kind === "string").length,
    truncatedArrays: notes.filter(note => note.kind === "array").length,
    ...(examples.length === 0 ? {} : { examples }),
    ...(notes.length <= examples.length
      ? {}
      : { additionalChanges: notes.length - examples.length }),
  };
};

const boundJsonValue = (
  value: unknown,
  bounds: JsonBounds,
  path: string,
  notes: TruncationNote[],
): JsonValue | undefined => {
  if (typeof value === "string") {
    if (value.length <= bounds.maxStringLength) {
      return value;
    }

    notes.push({
      kind: "string",
      path,
      originalLength: value.length,
      keptLength: bounds.maxStringLength,
    });

    return trimText(value, bounds.maxStringLength);
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : String(value);
  }

  if (typeof value === "boolean" || value === null) {
    return value;
  }

  if (Array.isArray(value)) {
    const retained = value.slice(0, bounds.maxArrayItems);

    if (value.length > retained.length) {
      notes.push({
        kind: "array",
        path,
        originalLength: value.length,
        keptLength: retained.length,
      });
    }

    return retained.flatMap((entry, index) => {
      const boundedEntry = boundJsonValue(
        entry,
        bounds,
        `${path}[${index}]`,
        notes,
      );

      return boundedEntry === undefined ? [] : [boundedEntry];
    });
  }

  if (typeof value === "object") {
    const result: JsonObject = {};

    for (const [key, nestedValue] of Object.entries(value)) {
      const boundedValue = boundJsonValue(
        nestedValue,
        bounds,
        path === "" ? key : `${path}.${key}`,
        notes,
      );

      if (boundedValue !== undefined) {
        result[key] = boundedValue;
      }
    }

    return result;
  }

  return undefined;
};

const minimalBoundedObject = (maximumJsonCharacters: number): JsonObject => {
  const minimalWithMarker = {
    [STRUCTURED_TRUNCATION_KEY]: {
      truncated: true,
      reason: "content omitted to satisfy layer limit",
    },
  } satisfies JsonObject;

  return JSON.stringify(minimalWithMarker, null, 2).length <= maximumJsonCharacters
    ? minimalWithMarker
    : {};
};

const withTruncationMarker = (
  value: JsonObject,
  notes: readonly TruncationNote[],
): JsonObject =>
  notes.length === 0
    ? value
    : {
        ...value,
        [STRUCTURED_TRUNCATION_KEY]: summarizeTruncation(notes),
      };

const boundStructuredValue = (
  value: Readonly<Record<string, unknown>>,
  maximumJsonCharacters: number,
): JsonObject => {
  const normalizedValue = boundJsonValue(
    value,
    {
      maxStringLength: Number.MAX_SAFE_INTEGER,
      maxArrayItems: Number.MAX_SAFE_INTEGER,
    },
    "",
    [],
  );

  if (
    normalizedValue === undefined ||
    Array.isArray(normalizedValue) ||
    normalizedValue === null ||
    typeof normalizedValue !== "object"
  ) {
    return minimalBoundedObject(maximumJsonCharacters);
  }

  if (JSON.stringify(normalizedValue, null, 2).length <= maximumJsonCharacters) {
    return normalizedValue;
  }

  const shape = collectJsonShape(normalizedValue);

  for (
    let maxArrayItems = shape.maxArrayLength;
    ;
    maxArrayItems = Math.floor(maxArrayItems / 2)
  ) {
    let minimumStringLength = 0;
    let maximumStringLength = shape.maxStringLength;
    let bestFit: JsonObject | undefined;

    while (minimumStringLength <= maximumStringLength) {
      const candidateStringLength = Math.floor(
        (minimumStringLength + maximumStringLength) / 2,
      );
      const notes: TruncationNote[] = [];
      const candidateValue = boundJsonValue(
        normalizedValue,
        {
          maxStringLength: candidateStringLength,
          maxArrayItems,
        },
        "",
        notes,
      );

      if (
        candidateValue === undefined ||
        Array.isArray(candidateValue) ||
        candidateValue === null ||
        typeof candidateValue !== "object"
      ) {
        maximumStringLength = candidateStringLength - 1;
        continue;
      }

      const candidate = withTruncationMarker(candidateValue, notes);

      if (JSON.stringify(candidate, null, 2).length <= maximumJsonCharacters) {
        bestFit = candidate;
        minimumStringLength = candidateStringLength + 1;
      } else {
        maximumStringLength = candidateStringLength - 1;
      }
    }

    if (bestFit !== undefined) {
      return bestFit;
    }
    if (maxArrayItems === 0) {
      break;
    }
  }

  return minimalBoundedObject(maximumJsonCharacters);
};

export const renderJsonLayer = (
  heading: string,
  value: Readonly<Record<string, unknown>>,
  maximum: number,
): string => {
  const maximumJsonCharacters =
    maximum - heading.length - JSON_FENCE_PREFIX.length - JSON_FENCE_SUFFIX.length;

  return stringifyJsonFence(
    heading,
    boundStructuredValue(value, Math.max(2, maximumJsonCharacters)),
  );
};
