const MARKDOWN_PUNCTUATION = /[!-/:-@[-`{-~]/gu;
const ACTION_URI_SCHEME =
  /\b(command|vscode(?:-[a-z0-9+.-]+)?)(?:(?:\\)*:|&(?:#0*58|#x0*3a|colon);|%3a)/giu;
const BARE_AUTOLINK =
  /\bhttps?:\/\/[^\s<>]+|\bwww\.[^\s<>]+|\b[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?)+/giu;
const NEUTRALIZED_HTTP_URL_BEFORE_MATCH =
  /\bhttps?\\:\/\/[^\s<>]*$/iu;
const REMOTE_MARKDOWN_DELIMITERS = new Set(["[", "]", "<", ">"]);
const INERT_URI_SEPARATOR = "：";

const neutralizeActionUris = (value: string): string =>
  value.replace(
    ACTION_URI_SCHEME,
    (_match, scheme: string) => `${scheme}${INERT_URI_SEPARATOR}`,
  );

const neutralizeBareAutolinks = (value: string): string =>
  value.replace(
    BARE_AUTOLINK,
    (candidate: string, offset: number, source: string) => {
      if (
        NEUTRALIZED_HTTP_URL_BEFORE_MATCH.test(source.slice(0, offset))
      ) {
        return candidate;
      }
      if (/^https?:\/\//iu.test(candidate)) {
        return candidate.replace(":", String.raw`\:`);
      }
      if (/^www\./iu.test(candidate)) {
        return candidate.replace(".", String.raw`\.`);
      }
      return candidate.replace("@", String.raw`\@`);
    },
  );

const isBackslashEscaped = (value: string, index: number): boolean => {
  let backslashes = 0;
  for (
    let cursor = index - 1;
    cursor >= 0 && value[cursor] === "\\";
    cursor -= 1
  ) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
};

export const escapeMarkdownText = (value: string): string =>
  neutralizeActionUris(value).replace(
    MARKDOWN_PUNCTUATION,
    (punctuation) => `\\${punctuation}`,
  );

export const sanitizeModelMarkdown = (value: string): string => {
  const neutralized = neutralizeBareAutolinks(neutralizeActionUris(value));
  let sanitized = "";
  for (let index = 0; index < neutralized.length; index += 1) {
    const character = neutralized[index]!;
    if (
      REMOTE_MARKDOWN_DELIMITERS.has(character) &&
      !isBackslashEscaped(neutralized, index)
    ) {
      sanitized += "\\";
    }
    sanitized += character;
  }
  return sanitized;
};
