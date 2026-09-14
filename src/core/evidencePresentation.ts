import type { Evidence } from "./types";

export const EVIDENCE_UI_LIMITS = {
  message: 1_000,
  title: 120,
  detail: 500,
  source: 120,
  reference: 240,
  references: 8,
} as const;

const ELLIPSIS = "…";
const CONTROL_CHARACTERS = /[\p{Cc}\p{Cf}]+/gu;
const WHITESPACE = /\s+/gu;

const truncateWithEllipsis = (value: string, maxLength: number): string => {
  if (value.length <= maxLength) {
    return value;
  }
  if (maxLength <= ELLIPSIS.length) {
    return ELLIPSIS.slice(0, maxLength);
  }

  let prefix = value.slice(0, maxLength - ELLIPSIS.length);
  const finalCodeUnit = prefix.charCodeAt(prefix.length - 1);
  if (finalCodeUnit >= 0xd800 && finalCodeUnit <= 0xdbff) {
    prefix = prefix.slice(0, -1);
  }
  return `${prefix.trimEnd()}${ELLIPSIS}`;
};

export const boundEvidenceText = (
  value: string,
  maxLength: number,
): string =>
  truncateWithEllipsis(
    value
      .replace(CONTROL_CHARACTERS, " ")
      .replace(WHITESPACE, " ")
      .trim(),
    maxLength,
  );

export const boundEvidenceMessage = (value: string): string =>
  boundEvidenceText(value, EVIDENCE_UI_LIMITS.message);

export const boundEvidenceTitle = (value: string): string =>
  boundEvidenceText(value, EVIDENCE_UI_LIMITS.title);

export const boundEvidenceDetail = (value: string): string =>
  boundEvidenceText(value, EVIDENCE_UI_LIMITS.detail);

export const boundEvidenceSource = (value: string): string =>
  boundEvidenceText(value, EVIDENCE_UI_LIMITS.source);

export const boundEvidenceReference = (value: string): string =>
  boundEvidenceText(value, EVIDENCE_UI_LIMITS.reference);

export const normalizeEvidenceForUi = (evidence: Evidence): Evidence => ({
  ...evidence,
  title: boundEvidenceTitle(evidence.title),
  detail: boundEvidenceDetail(evidence.detail),
  source: boundEvidenceSource(evidence.source),
  references: evidence.references
    .slice(0, EVIDENCE_UI_LIMITS.references)
    .map(boundEvidenceReference),
});
