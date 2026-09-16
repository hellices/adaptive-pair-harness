/** Every entry the Stable release VSIX must contain, and nothing else. */
export const REQUIRED_VSIX_ENTRIES = Object.freeze([
  "extension.vsixmanifest",
  "[Content_Types].xml",
  "extension/package.json",
  "extension/dist/extension.cjs",
  "extension/LICENSE.txt",
  "extension/readme.md",
  "extension/docs/growth-preview.md",
]);

/** Entry-name patterns that must never appear in a release archive. */
const FORBIDDEN_ENTRY_PATTERNS = Object.freeze([
  { pattern: /\.map$/u, reason: "source map" },
  { pattern: /\.tsbuildinfo$/u, reason: "TypeScript build info" },
  { pattern: /(^|\/)src\//u, reason: "source directory" },
  { pattern: /\.tsx?$/u, reason: "TypeScript source" },
  { pattern: /(^|\/)test(s)?\//u, reason: "test directory" },
  { pattern: /(^|\/)\.host-test\//u, reason: "host-test staging directory" },
  { pattern: /(^|\/)node_modules\//u, reason: "bundled dependencies" },
  { pattern: /(^|\/)\.git(\/|$)/u, reason: "repository metadata" },
  { pattern: /(^|\/)coverage\//u, reason: "coverage output" },
]);

/** Content patterns that must never appear in any shipped text entry. */
const FORBIDDEN_CONTENT_PATTERNS = Object.freeze([
  { pattern: /ADAPTIVE_PAIR_HOST_TEST/u, label: "ADAPTIVE_PAIR_HOST_TEST" },
  { pattern: /__pairHostTest/u, label: "__pairHostTest" },
  { pattern: /HostTestAutoConfirmPort/u, label: "HostTestAutoConfirmPort" },
  { pattern: /createHostTestApi/u, label: "createHostTestApi" },
  { pattern: /sourceMappingURL/u, label: "sourceMappingURL" },
  { pattern: /\/Users\//u, label: "/Users/ local path" },
  { pattern: /\/home\/[A-Za-z0-9._-]+\//u, label: "/home/ local path" },
  { pattern: /[A-Za-z]:\\Users\\/u, label: "C:\\Users local path" },
]);

export const TEXT_ENTRY = /\.(?:cjs|js|json|md|xml|txt|vsixmanifest)$/u;

const MAX_REPORTED_LENGTH = 120;

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
const isRecord = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Archive-derived text is untrusted: an entry name can carry control characters
 * or be arbitrarily long. Reports escape it and clamp its length so a hostile
 * archive cannot forge or flood verification output.
 *
 * @param {string} value
 * @returns {string}
 */
export const sanitizeForMessage = (value) => {
  let escaped = "";
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    escaped +=
      code < 0x20 || (code >= 0x7f && code <= 0x9f)
        ? `\\x${code.toString(16).padStart(2, "0")}`
        : character;
  }
  return escaped.length > MAX_REPORTED_LENGTH
    ? `${escaped.slice(0, MAX_REPORTED_LENGTH)}…`
    : escaped;
};

/**
 * @param {readonly string[]} names
 * @returns {string[]} one violation per missing, duplicated, forbidden, or
 *   unexpected entry; a releasable archive holds exactly the required set
 */
export const inspectEntryNames = (names) => {
  const violations = [];
  const required = new Set(REQUIRED_VSIX_ENTRIES);
  /** @type {Set<string>} */
  const seen = new Set();
  /** @type {Set<string>} */
  const duplicates = new Set();

  for (const name of names) {
    if (seen.has(name)) {
      duplicates.add(name);
    }
    seen.add(name);
  }

  for (const entry of REQUIRED_VSIX_ENTRIES) {
    if (!seen.has(entry)) {
      violations.push(`Missing required VSIX entry: ${entry}`);
    }
  }

  for (const name of duplicates) {
    violations.push(`Duplicate VSIX entry: ${sanitizeForMessage(name)}`);
  }

  for (const name of seen) {
    const rule = FORBIDDEN_ENTRY_PATTERNS.find((candidate) => candidate.pattern.test(name));
    if (rule !== undefined) {
      violations.push(`Forbidden VSIX entry (${rule.reason}): ${sanitizeForMessage(name)}`);
      continue;
    }
    if (!required.has(name)) {
      violations.push(`Unexpected VSIX entry: ${sanitizeForMessage(name)}`);
    }
  }

  return violations;
};

/**
 * @param {unknown} manifest the parsed `extension/package.json`
 * @returns {string[]}
 */
export const inspectManifest = (manifest) => {
  const violations = [];
  if (typeof manifest !== "object" || manifest === null) {
    return ["The packaged manifest is not an object."];
  }

  const record = /** @type {Record<string, unknown>} */ (manifest);
  if (record["enabledApiProposals"] !== undefined) {
    violations.push("The packaged manifest declares enabledApiProposals.");
  }
  if (record["main"] !== "./dist/extension.cjs") {
    violations.push(
      `The packaged manifest main is ${JSON.stringify(record["main"])}, expected "./dist/extension.cjs".`,
    );
  }

  const activationEvents = record["activationEvents"];
  if (activationEvents !== undefined) {
    if (!Array.isArray(activationEvents)) {
      violations.push("The packaged manifest activationEvents field is not an array.");
    } else {
      for (const event of activationEvents) {
        if (
          typeof event !== "string" ||
          !/^(?:onCommand:adaptivePair\.|onChatParticipant:adaptivePair\.)[A-Za-z0-9._-]+$/u.test(
            event,
          )
        ) {
          violations.push(
            `Non-additive activation event: ${sanitizeForMessage(String(event))}`,
          );
        }
      }
    }
  }

  violations.push(...inspectContributions(record["contributes"]));

  return violations;
};

/**
 * @param {string} name
 * @param {string} text
 * @returns {string[]}
 */
export const inspectEntryContent = (name, text) => {
  const violations = [];
  for (const rule of FORBIDDEN_CONTENT_PATTERNS) {
    if (rule.pattern.test(text)) {
      violations.push(
        `Forbidden content in ${sanitizeForMessage(name)}: ${rule.label}`,
      );
    }
  }
  return violations;
};


/** @param {unknown} commands */
const inspectCommands = (commands) => {
  const violations = [];
  if (commands !== undefined) {
    if (!Array.isArray(commands)) {
      violations.push("The packaged manifest commands contribution is not an array.");
    } else {
      for (const entry of commands) {
        const identifier = isRecord(entry) ? entry["command"] : undefined;
        if (typeof identifier !== "string" || !identifier.startsWith("adaptivePair.")) {
          violations.push(
            `Non-additive command identifier: ${
              typeof identifier === "string"
                ? sanitizeForMessage(identifier)
                : "<non-string>"
            }`,
          );
        }
      }
    }
  }
  return violations;
};

/** @param {unknown} tools */
const inspectTools = (tools) => {
  const violations = [];
  if (tools !== undefined) {
    if (!Array.isArray(tools)) {
      violations.push(
        "The packaged manifest languageModelTools contribution is not an array.",
      );
    } else {
      for (const entry of tools) {
        const tool = isRecord(entry) ? entry : undefined;
        const identifier = tool?.["name"];
        if (
          typeof identifier !== "string" ||
          !identifier.startsWith("adaptive_pair_")
        ) {
          violations.push(
            `Non-additive language-model tool identifier: ${
              typeof identifier === "string"
                ? sanitizeForMessage(identifier)
                : "<non-string>"
            }`,
          );
        }
        const reference = tool?.["toolReferenceName"];
        if (
          reference !== undefined &&
          (typeof reference !== "string" ||
            !reference.startsWith("adaptivePair"))
        ) {
          violations.push(
            `Non-additive tool reference identifier: ${
              typeof reference === "string"
                ? sanitizeForMessage(reference)
                : "<non-string>"
            }`,
          );
        }
      }
    }
  }
  return violations;
};

/** @param {unknown} participants */
const inspectParticipants = (participants) => {
  const violations = [];
  if (participants !== undefined) {
    if (!Array.isArray(participants)) {
      violations.push(
        "The packaged manifest chatParticipants contribution is not an array.",
      );
    } else {
      for (const entry of participants) {
        const identifier = isRecord(entry) ? entry["id"] : undefined;
        if (typeof identifier !== "string" || !identifier.startsWith("adaptivePair.")) {
          violations.push(
            `Non-additive chat participant identifier: ${
              typeof identifier === "string"
                ? sanitizeForMessage(identifier)
                : "<non-string>"
            }`,
          );
        }
      }
    }
  }
  return violations;
};

/** @param {unknown} contributes */
const inspectContributions = (contributes) => {
  const violations = [];
  if (typeof contributes === "object" && contributes !== null) {
    const contributions = /** @type {Record<string, unknown>} */ (contributes);
    const allowedContributionPoints = new Set([
      "commands",
      "languageModelTools",
      "chatParticipants",
    ]);
    for (const key of Object.keys(contributions)) {
      if (!allowedContributionPoints.has(key)) {
        violations.push(
          `Unsupported Stable contribution point: ${sanitizeForMessage(key)}`,
        );
      }
    }

    if (contributions["chatSessions"] !== undefined) {
      violations.push("The packaged manifest contributes chatSessions.");
    }

    violations.push(...inspectCommands(contributions["commands"]));
    violations.push(...inspectTools(contributions["languageModelTools"]));
    violations.push(...inspectParticipants(contributions["chatParticipants"]));
  }

  return violations;
};
