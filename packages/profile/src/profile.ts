export type InterventionStyle = "quiet" | "balanced" | "active";
export type ExplanationDepth = "brief" | "standard" | "deep";
export type FamiliarityLevel = "new" | "practicing" | "familiar";

export interface AcceptedReflection {
  readonly summary: string;
  readonly acceptedAt: number;
}

export interface LocalProfile {
  readonly interventionStyle: InterventionStyle;
  readonly explanationDepth: ExplanationDepth;
  readonly declaredFamiliarity: Readonly<Record<string, FamiliarityLevel>>;
  readonly acceptedReflections: readonly AcceptedReflection[];
}

export type ProfileCorrection =
  | { readonly kind: "intervention-style"; readonly value: InterventionStyle }
  | { readonly kind: "explanation-depth"; readonly value: ExplanationDepth }
  | {
      readonly kind: "familiarity";
      readonly area: string;
      readonly level: FamiliarityLevel;
    }
  | {
      readonly kind: "reflection";
      readonly summary: string;
      readonly acceptedAt: number;
    };

export type ProfileDeletion =
  | { readonly kind: "familiarity"; readonly area: string }
  | { readonly kind: "reflection"; readonly acceptedAt: number };

export interface ProfilePersistence {
  read(): LocalProfile | undefined;
  write(profile: LocalProfile): void;
  clear(): void;
}

export interface LocalProfileStore {
  inspect(): LocalProfile;
  correct(correction: ProfileCorrection): LocalProfile;
  deleteEntry(deletion: ProfileDeletion): LocalProfile;
  reset(): LocalProfile;
}

export const MAX_FAMILIARITY_ENTRIES = 64;
export const MAX_REFLECTIONS = 128;
export const MAX_ENTRY_CHARACTERS = 500;

export class ProfileValidationError extends Error {
  public readonly reason: string;
  public readonly field: string;

  public constructor(reason: string, field: string, message: string) {
    super(message);
    this.name = "ProfileValidationError";
    this.reason = reason;
    this.field = field;
  }
}

const DEFAULT_PROFILE: LocalProfile = Object.freeze({
  interventionStyle: "balanced",
  explanationDepth: "standard",
  declaredFamiliarity: Object.freeze({}),
  acceptedReflections: Object.freeze([]),
});

const ABSOLUTE_PATH = /^\s*(?:[A-Za-z]:[\\/]|[\\/])/u;
const WINDOWS_SEPARATOR = /\\/u;
const DIAGNOSTIC = /[\w.$/-]+:\d+:\d+|\bTS\d{3,}\b|\berror\s+[A-Z]\w+\d+\b/u;
const SOURCE_TOKENS =
  /=>|;\s*$|[{}]|\bfunction\b|\bconst\b|\blet\b|\bimport\b|\bexport\b|\bclass\b|\bdef\b|\breturn\b/u;

/**
 * Reject any value that is too long, an absolute path, source code,
 * diagnostics, or multi-line prompt/transcript text. Fails explicitly instead
 * of silently truncating so invalid sensitive input never enters the profile.
 */
const assertClean = (value: string, field: string): void => {
  if (value.length > MAX_ENTRY_CHARACTERS) {
    throw new ProfileValidationError(
      "too-long",
      field,
      `${field} exceeds the ${String(MAX_ENTRY_CHARACTERS)}-character limit.`,
    );
  }
  if (ABSOLUTE_PATH.test(value) || WINDOWS_SEPARATOR.test(value)) {
    throw new ProfileValidationError(
      "absolute-path",
      field,
      `${field} must not contain an absolute path.`,
    );
  }
  if (/[\r\n]/u.test(value)) {
    throw new ProfileValidationError(
      "multi-line",
      field,
      `${field} must be a single line without source, prompt, or transcript text.`,
    );
  }
  if (DIAGNOSTIC.test(value)) {
    throw new ProfileValidationError(
      "diagnostics",
      field,
      `${field} must not contain diagnostics output.`,
    );
  }
  if (SOURCE_TOKENS.test(value)) {
    throw new ProfileValidationError(
      "source",
      field,
      `${field} must not contain source code.`,
    );
  }
};

const isFamiliarityLevel = (value: unknown): value is FamiliarityLevel =>
  value === "new" || value === "practicing" || value === "familiar";

const isInterventionStyle = (value: unknown): value is InterventionStyle =>
  value === "quiet" || value === "balanced" || value === "active";

const isExplanationDepth = (value: unknown): value is ExplanationDepth =>
  value === "brief" || value === "standard" || value === "deep";

/**
 * Validate an entire profile recursively, failing explicitly on any bound
 * breach or forbidden content. Used when reading persisted data and after every
 * correction so nothing invalid is ever silently accepted.
 */
const assertValidProfile = (profile: LocalProfile): LocalProfile => {
  if (!isInterventionStyle(profile.interventionStyle)) {
    throw new ProfileValidationError(
      "invalid-enum",
      "interventionStyle",
      "interventionStyle is not a recognized value.",
    );
  }
  if (!isExplanationDepth(profile.explanationDepth)) {
    throw new ProfileValidationError(
      "invalid-enum",
      "explanationDepth",
      "explanationDepth is not a recognized value.",
    );
  }

  const familiarityEntries = Object.entries(profile.declaredFamiliarity);
  if (familiarityEntries.length > MAX_FAMILIARITY_ENTRIES) {
    throw new ProfileValidationError(
      "familiarity-limit",
      "declaredFamiliarity",
      `declaredFamiliarity exceeds ${String(MAX_FAMILIARITY_ENTRIES)} entries.`,
    );
  }
  for (const [area, level] of familiarityEntries) {
    assertClean(area, `declaredFamiliarity.area`);
    if (!isFamiliarityLevel(level)) {
      throw new ProfileValidationError(
        "invalid-enum",
        "declaredFamiliarity.level",
        `declaredFamiliarity[${area}] is not a recognized level.`,
      );
    }
  }

  if (profile.acceptedReflections.length > MAX_REFLECTIONS) {
    throw new ProfileValidationError(
      "reflection-limit",
      "acceptedReflections",
      `acceptedReflections exceeds ${String(MAX_REFLECTIONS)} entries.`,
    );
  }
  for (const reflection of profile.acceptedReflections) {
    assertClean(reflection.summary, "acceptedReflections.summary");
    if (!Number.isFinite(reflection.acceptedAt)) {
      throw new ProfileValidationError(
        "invalid-timestamp",
        "acceptedReflections.acceptedAt",
        "acceptedReflections.acceptedAt must be a finite number.",
      );
    }
  }

  return profile;
};

const freezeProfile = (profile: LocalProfile): LocalProfile =>
  Object.freeze({
    interventionStyle: profile.interventionStyle,
    explanationDepth: profile.explanationDepth,
    declaredFamiliarity: Object.freeze({ ...profile.declaredFamiliarity }),
    acceptedReflections: Object.freeze(
      profile.acceptedReflections.map((reflection) =>
        Object.freeze({ ...reflection }),
      ),
    ),
  });

const applyCorrection = (
  current: LocalProfile,
  correction: ProfileCorrection,
): LocalProfile => {
  switch (correction.kind) {
    case "intervention-style":
      return { ...current, interventionStyle: correction.value };
    case "explanation-depth":
      return { ...current, explanationDepth: correction.value };
    case "familiarity": {
      assertClean(correction.area, "familiarity.area");
      const exists = Object.prototype.hasOwnProperty.call(
        current.declaredFamiliarity,
        correction.area,
      );
      if (
        !exists &&
        Object.keys(current.declaredFamiliarity).length >=
          MAX_FAMILIARITY_ENTRIES
      ) {
        throw new ProfileValidationError(
          "familiarity-limit",
          "declaredFamiliarity",
          `Cannot add "${correction.area}": the ${String(
            MAX_FAMILIARITY_ENTRIES,
          )}-entry familiarity limit is reached.`,
        );
      }
      return {
        ...current,
        declaredFamiliarity: {
          ...current.declaredFamiliarity,
          [correction.area]: correction.level,
        },
      };
    }
    case "reflection": {
      assertClean(correction.summary, "reflection.summary");
      if (current.acceptedReflections.length >= MAX_REFLECTIONS) {
        throw new ProfileValidationError(
          "reflection-limit",
          "acceptedReflections",
          `Cannot add a reflection: the ${String(
            MAX_REFLECTIONS,
          )}-entry limit is reached.`,
        );
      }
      return {
        ...current,
        acceptedReflections: [
          ...current.acceptedReflections,
          { summary: correction.summary, acceptedAt: correction.acceptedAt },
        ],
      };
    }
  }
};

const applyDeletion = (
  current: LocalProfile,
  deletion: ProfileDeletion,
): LocalProfile => {
  if (deletion.kind === "familiarity") {
    const next: Record<string, FamiliarityLevel> = {
      ...current.declaredFamiliarity,
    };
    delete next[deletion.area];
    return { ...current, declaredFamiliarity: next };
  }
  return {
    ...current,
    acceptedReflections: current.acceptedReflections.filter(
      (reflection) => reflection.acceptedAt !== deletion.acceptedAt,
    ),
  };
};

/**
 * A local, privacy-first profile store. It persists only explicit preferences
 * and developer-approved reflections through the injected {@link
 * ProfilePersistence} port, enforcing bounds and forbidden-data rules on both
 * read and write.
 */
export const createLocalProfileStore = (
  persistence: ProfilePersistence,
): LocalProfileStore => {
  const load = (): LocalProfile => {
    const stored = persistence.read();
    if (stored === undefined) {
      return DEFAULT_PROFILE;
    }
    return freezeProfile(assertValidProfile(stored));
  };

  const persist = (profile: LocalProfile): LocalProfile => {
    const validated = freezeProfile(assertValidProfile(profile));
    persistence.write(validated);
    return validated;
  };

  return {
    inspect(): LocalProfile {
      return load();
    },
    correct(correction: ProfileCorrection): LocalProfile {
      return persist(applyCorrection(load(), correction));
    },
    deleteEntry(deletion: ProfileDeletion): LocalProfile {
      return persist(applyDeletion(load(), deletion));
    },
    reset(): LocalProfile {
      persistence.clear();
      return DEFAULT_PROFILE;
    },
  };
};
