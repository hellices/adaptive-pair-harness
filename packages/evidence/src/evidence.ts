export type EvidenceProvenance =
  | "local-edit"
  | "workspace-validation"
  | "diagnostic";

export type EvidenceFreshness = "fresh" | "stale";

export type EvidencePrivacyClass = "path" | "summary" | "aggregate";

export interface LocalEvidence {
  readonly id: string;
  readonly provenance: EvidenceProvenance;
  readonly freshness: EvidenceFreshness;
  readonly privacyClass: EvidencePrivacyClass;
  readonly detail: string;
  readonly observedAt: number;
}

export interface LocalEvidenceInput {
  readonly id: string;
  readonly provenance: EvidenceProvenance;
  readonly privacyClass: EvidencePrivacyClass;
  readonly detail: string;
  readonly observedAt: number;
  readonly now: number;
  readonly freshnessWindowMs?: number;
}

export const MAX_EVIDENCE_DETAIL = 500;
const DEFAULT_FRESHNESS_WINDOW_MS = 5 * 60 * 1000;
const ELLIPSIS = "…";

const POSIX_ABSOLUTE_PATH =
  /(?:^|[^\p{L}\p{N}._~/])\/(?:$|(?!\/)\S+)/u;
const POSIX_NETWORK_PATH =
  /(?:^|[\s"'(<=[{,;])\/{2,}[^\s/]+/u;
const LOCAL_FILE_URI =
  /(?:^|[^\p{L}\p{N}+.-])file:(?=\S)/iu;
const WINDOWS_DRIVE_PATH =
  /(?:^|[^\p{L}\p{N}._~])[A-Za-z]:[\\/]/u;
const WINDOWS_NETWORK_PATH =
  /(?:^|[^\p{L}\p{N}._~\\])\\\\[^\\\s]+\\/u;

const containsAbsolutePath = (value: string): boolean =>
  POSIX_ABSOLUTE_PATH.test(value) ||
  POSIX_NETWORK_PATH.test(value) ||
  LOCAL_FILE_URI.test(value) ||
  WINDOWS_DRIVE_PATH.test(value) ||
  WINDOWS_NETWORK_PATH.test(value);

const truncate = (value: string, maxLength: number): string => {
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

const sanitizeDetail = (detail: string): string => {
  if (/[\n\r]/u.test(detail)) {
    throw new Error("Local evidence detail must be a single line.");
  }

  if (containsAbsolutePath(detail)) {
    throw new Error("Local evidence detail must not contain an absolute path.");
  }

  return truncate(detail.trim(), MAX_EVIDENCE_DETAIL);
};

export const createLocalEvidence = (input: LocalEvidenceInput): LocalEvidence => {
  const windowMs = input.freshnessWindowMs ?? DEFAULT_FRESHNESS_WINDOW_MS;
  const freshness: EvidenceFreshness =
    input.now - input.observedAt <= windowMs ? "fresh" : "stale";

  return Object.freeze({
    id: input.id,
    provenance: input.provenance,
    freshness,
    privacyClass: input.privacyClass,
    detail: sanitizeDetail(input.detail),
    observedAt: input.observedAt,
  });
};
