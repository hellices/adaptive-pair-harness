export interface LanguageModelAccessKindValues {
  readonly Allowed: unknown;
  readonly Disallowed: unknown;
  readonly NeedsConsent: unknown;
}

export const mapLanguageModelAccessKind = (
  access: unknown,
  kinds: LanguageModelAccessKindValues,
): boolean | undefined => {
  if (access === kinds.Allowed) {
    return true;
  }
  if (access === kinds.Disallowed) {
    return false;
  }
  if (access === kinds.NeedsConsent) {
    return undefined;
  }
  return false;
};
