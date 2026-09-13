export const PAIR_CHAT_RESPONSE_DISPLAY_LIMIT = 16_384;

const ELLIPSIS = "…";
const CONTROL_CHARACTERS = /[\p{Cc}\p{Cf}]/gu;

export const formatChatResponseForDisplay = (value: string): string => {
  const normalized = value
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
  const codePoints = [...normalized];
  if (codePoints.length <= PAIR_CHAT_RESPONSE_DISPLAY_LIMIT) {
    return normalized;
  }

  return `${codePoints
    .slice(0, PAIR_CHAT_RESPONSE_DISPLAY_LIMIT - 1)
    .join("")}${ELLIPSIS}`;
};
