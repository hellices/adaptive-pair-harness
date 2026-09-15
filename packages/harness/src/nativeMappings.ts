import { PAIR_TOOL_CATALOG } from "./toolCatalog.js";
import type { NativePairToolName, PairToolName } from "./types.js";

export type { NativePairToolName } from "./types.js";

export const nativeToolName = (name: PairToolName): NativePairToolName =>
  `adaptive_${name}`;

export const PAIR_NATIVE_TOOL_NAMES: readonly NativePairToolName[] = Object.freeze(
  PAIR_TOOL_CATALOG.map(descriptor => nativeToolName(descriptor.name)),
);

const PAIR_NATIVE_TOOL_NAME_MAP = Object.freeze(
  new Map(
    PAIR_TOOL_CATALOG.map(descriptor => [
      nativeToolName(descriptor.name),
      descriptor.name,
    ]),
  ),
);

export const pairToolNameFromNative = (
  name: string,
): PairToolName | undefined => PAIR_NATIVE_TOOL_NAME_MAP.get(name as NativePairToolName);
