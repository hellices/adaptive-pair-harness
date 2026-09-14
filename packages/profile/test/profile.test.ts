import { beforeEach, describe, expect, it } from "vitest";
import {
  createLocalProfileStore,
  ProfileValidationError,
  type LocalProfile,
  type ProfilePersistence,
} from "../src/index.js";

class MemoryPersistence implements ProfilePersistence {
  public value: LocalProfile | undefined;

  public read(): LocalProfile | undefined {
    return this.value;
  }

  public write(profile: LocalProfile): void {
    this.value = profile;
  }

  public clear(): void {
    this.value = undefined;
  }
}

let persistence: MemoryPersistence;

beforeEach(() => {
  persistence = new MemoryPersistence();
});

describe("LocalProfileStore — defaults and inspection", () => {
  it("returns a safe default profile before anything is stored", () => {
    const store = createLocalProfileStore(persistence);
    expect(store.inspect()).toEqual({
      interventionStyle: "balanced",
      explanationDepth: "standard",
      declaredFamiliarity: {},
      acceptedReflections: [],
    });
  });
});

describe("LocalProfileStore — corrections", () => {
  it("records explicit preference corrections", () => {
    const store = createLocalProfileStore(persistence);
    store.correct({ kind: "intervention-style", value: "quiet" });
    store.correct({ kind: "explanation-depth", value: "deep" });
    const profile = store.inspect();
    expect(profile.interventionStyle).toBe("quiet");
    expect(profile.explanationDepth).toBe("deep");
  });

  it("records declared familiarity and accepted reflections", () => {
    const store = createLocalProfileStore(persistence);
    store.correct({ kind: "familiarity", area: "typescript/generics", level: "practicing" });
    store.correct({ kind: "reflection", summary: "Practiced recursion by hand", acceptedAt: 1_700_000_000_000 });
    const profile = store.inspect();
    expect(profile.declaredFamiliarity).toEqual({ "typescript/generics": "practicing" });
    expect(profile.acceptedReflections).toEqual([
      { summary: "Practiced recursion by hand", acceptedAt: 1_700_000_000_000 },
    ]);
  });
});

describe("LocalProfileStore — bounds enforced explicitly", () => {
  it("rejects a new familiarity area beyond the 64-entry limit without truncating", () => {
    const store = createLocalProfileStore(persistence);
    for (let index = 0; index < 64; index += 1) {
      store.correct({ kind: "familiarity", area: `area-${index}`, level: "new" });
    }
    expect(() =>
      store.correct({ kind: "familiarity", area: "area-overflow", level: "new" }),
    ).toThrow(ProfileValidationError);
    expect(Object.keys(store.inspect().declaredFamiliarity)).toHaveLength(64);
  });

  it("allows updating an existing familiarity area at the limit", () => {
    const store = createLocalProfileStore(persistence);
    for (let index = 0; index < 64; index += 1) {
      store.correct({ kind: "familiarity", area: `area-${index}`, level: "new" });
    }
    store.correct({ kind: "familiarity", area: "area-0", level: "familiar" });
    expect(store.inspect().declaredFamiliarity["area-0"]).toBe("familiar");
  });

  it("rejects a reflection beyond the 128-entry limit without truncating", () => {
    const store = createLocalProfileStore(persistence);
    for (let index = 0; index < 128; index += 1) {
      store.correct({ kind: "reflection", summary: `reflection ${index}`, acceptedAt: index });
    }
    expect(() =>
      store.correct({ kind: "reflection", summary: "one too many", acceptedAt: 999 }),
    ).toThrow(ProfileValidationError);
    expect(store.inspect().acceptedReflections).toHaveLength(128);
  });
});

describe("LocalProfileStore — forbidden data rejected without silent truncation", () => {
  it("rejects entries longer than 500 characters", () => {
    const store = createLocalProfileStore(persistence);
    expect(() =>
      store.correct({ kind: "reflection", summary: "x".repeat(501), acceptedAt: 1 }),
    ).toThrow(ProfileValidationError);
    expect(store.inspect().acceptedReflections).toHaveLength(0);
  });

  it("rejects absolute paths in a familiarity area", () => {
    const store = createLocalProfileStore(persistence);
    expect(() =>
      store.correct({ kind: "familiarity", area: "/Users/dev/project/src", level: "new" }),
    ).toThrow(ProfileValidationError);
  });

  it("rejects source code in a reflection", () => {
    const store = createLocalProfileStore(persistence);
    expect(() =>
      store.correct({
        kind: "reflection",
        summary: "const add = (a, b) => a + b;",
        acceptedAt: 1,
      }),
    ).toThrow(ProfileValidationError);
  });

  it("rejects diagnostics text in a reflection", () => {
    const store = createLocalProfileStore(persistence);
    expect(() =>
      store.correct({
        kind: "reflection",
        summary: "src/index.ts:12:5 error TS2345 argument mismatch",
        acceptedAt: 1,
      }),
    ).toThrow(ProfileValidationError);
  });

  it("rejects multi-line prompt-like text in a reflection", () => {
    const store = createLocalProfileStore(persistence);
    expect(() =>
      store.correct({
        kind: "reflection",
        summary: "You are a helpful assistant.\nPlease refactor the module.",
        acceptedAt: 1,
      }),
    ).toThrow(ProfileValidationError);
  });

  it("fails explicitly when persisted data itself contains forbidden content (recursive)", () => {
    persistence.value = {
      interventionStyle: "balanced",
      explanationDepth: "standard",
      declaredFamiliarity: { "/etc/passwd": "new" },
      acceptedReflections: [],
    };
    const store = createLocalProfileStore(persistence);
    expect(() => store.inspect()).toThrow(ProfileValidationError);
  });
});

describe("LocalProfileStore — deletion and reset", () => {
  it("deletes a single familiarity entry", () => {
    const store = createLocalProfileStore(persistence);
    store.correct({ kind: "familiarity", area: "rust/ownership", level: "practicing" });
    store.correct({ kind: "familiarity", area: "go/channels", level: "new" });
    store.deleteEntry({ kind: "familiarity", area: "rust/ownership" });
    expect(store.inspect().declaredFamiliarity).toEqual({ "go/channels": "new" });
  });

  it("deletes a single reflection by accepted timestamp", () => {
    const store = createLocalProfileStore(persistence);
    store.correct({ kind: "reflection", summary: "first", acceptedAt: 10 });
    store.correct({ kind: "reflection", summary: "second", acceptedAt: 20 });
    store.deleteEntry({ kind: "reflection", acceptedAt: 10 });
    expect(store.inspect().acceptedReflections).toEqual([{ summary: "second", acceptedAt: 20 }]);
  });

  it("resets the entire profile to defaults and clears persistence", () => {
    const store = createLocalProfileStore(persistence);
    store.correct({ kind: "intervention-style", value: "active" });
    store.correct({ kind: "familiarity", area: "python", level: "familiar" });
    store.reset();
    expect(store.inspect()).toEqual({
      interventionStyle: "balanced",
      explanationDepth: "standard",
      declaredFamiliarity: {},
      acceptedReflections: [],
    });
    expect(persistence.read()).toBeUndefined();
  });
});
