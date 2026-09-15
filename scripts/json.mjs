// A typed, validating JSON reader shared by the build, host-test, and release
// scripts. Parsing returns `unknown`, and every caller must pass through an
// explicit shape check, so no script silently trusts malformed input.

/**
 * @param {string} raw
 * @param {string} source a human-readable name used in failure messages
 * @returns {Record<string, unknown>}
 */
export const parseJsonObject = (raw, source) => {
  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`${source} is not valid JSON.`, { cause: error });
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${source} is not a JSON object.`);
  }
  return /** @type {Record<string, unknown>} */ (parsed);
};

/**
 * @param {Record<string, unknown>} value
 * @param {string} key
 * @returns {string | undefined}
 */
export const stringField = (value, key) => {
  const field = value[key];
  return typeof field === "string" ? field : undefined;
};

/**
 * @param {Record<string, unknown>} value
 * @param {string} key
 * @returns {string[]}
 */
export const stringArrayField = (value, key) => {
  const field = value[key];
  if (!Array.isArray(field)) {
    return [];
  }
  return field.filter((item) => typeof item === "string");
};
