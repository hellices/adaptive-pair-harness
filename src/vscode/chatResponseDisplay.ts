export const PAIR_CHAT_RESPONSE_DISPLAY_LIMIT = 16_384;

const ELLIPSIS = "…";
const CONTROL_CHARACTERS = /[\p{Cc}\p{Cf}]/gu;

export type ChatResponseDisplayPart =
  | { readonly kind: "markdown"; readonly value: string }
  | { readonly kind: "text"; readonly value: string };

const normalizeChatResponseForDisplay = (value: string): string =>
  value
    .replace(/\r\n?|\u2028|\u2029/gu, "\n")
    .replace(CONTROL_CHARACTERS, (character) => {
      if (
        character === "\n" ||
        character === "\t" ||
        character === "\u200c" ||
        character === "\u200d"
      ) {
        return character;
      }
      return " ";
    });

export const formatChatResponseForDisplay = (value: string): string => {
  const normalized = normalizeChatResponseForDisplay(value);
  const codePoints = [...normalized];
  if (codePoints.length <= PAIR_CHAT_RESPONSE_DISPLAY_LIMIT) {
    return normalized;
  }

  return `${codePoints
    .slice(0, PAIR_CHAT_RESPONSE_DISPLAY_LIMIT - 1)
    .join("")}${ELLIPSIS}`;
};

export const formatChatResponsePartsForDisplay = (
  parts: readonly ChatResponseDisplayPart[],
): readonly ChatResponseDisplayPart[] => {
  const normalized = parts.map((part) => ({
    ...part,
    value: normalizeChatResponseForDisplay(part.value),
  }));
  const totalCodePoints = normalized.reduce(
    (total, part) => total + [...part.value].length,
    0,
  );
  if (totalCodePoints <= PAIR_CHAT_RESPONSE_DISPLAY_LIMIT) {
    return normalized;
  }

  let remaining = PAIR_CHAT_RESPONSE_DISPLAY_LIMIT - 1;
  const bounded: ChatResponseDisplayPart[] = [];
  for (const part of normalized) {
    if (remaining === 0) {
      break;
    }
    const codePoints = [...part.value];
    const displayed = codePoints.slice(0, remaining).join("");
    if (displayed.length > 0) {
      bounded.push({ ...part, value: displayed });
    }
    remaining -= Math.min(codePoints.length, remaining);
    if (displayed.length < part.value.length) {
      break;
    }
  }
  bounded.push({ kind: "text", value: ELLIPSIS });
  return bounded;
};
