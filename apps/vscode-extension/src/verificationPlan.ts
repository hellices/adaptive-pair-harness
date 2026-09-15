/**
 * The single allowlist shared by the Growth participant's `/check` route and
 * the verification adapter. Only an existing root package script named
 * test/check/lint/typecheck/build (with an optional colon suffix) may ever be
 * run; no raw shell command is accepted anywhere.
 */
export const ALLOWED_VERIFICATION_SCRIPT =
  /^(?:test|check|lint|typecheck|build)(?::[A-Za-z0-9._-]+)?$/u;

const PACKAGE_RUNNER = /\b(?:npm|pnpm|yarn)\s+(?:run\s+)?([A-Za-z0-9._:-]+)/u;

/**
 * Derive the package script named by an agreed verification plan.
 *
 * The plan is developer-authored free text (`npm test`, `npm run check`, or a
 * bare script name). Anything that does not resolve to an allowlisted script is
 * reported as `undefined` so the caller can decline honestly rather than
 * guessing a command.
 */
export const parseVerificationScript = (
  plan: string | undefined,
): string | undefined => {
  const trimmed = (plan ?? "").trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  if (ALLOWED_VERIFICATION_SCRIPT.test(trimmed)) {
    return trimmed;
  }

  const match = PACKAGE_RUNNER.exec(trimmed);
  const candidate = match?.[1];
  if (candidate !== undefined && ALLOWED_VERIFICATION_SCRIPT.test(candidate)) {
    return candidate;
  }

  return undefined;
};
