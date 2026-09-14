import { describe, expect, it } from "vitest";
import { SessionTargetStore } from "../../src/sessionTargetStore";

describe("SessionTargetStore", () => {
  it("creates an addressable session without replacing existing sessions", () => {
    const ids = ["first", "second"][Symbol.iterator]();
    const store = new SessionTargetStore(() => ids.next().value ?? "exhausted");

    const first = store.create("Investigate retry behavior", 100);
    const second = store.create("Continue current work", 200);

    expect(first).toEqual({
      id: "first",
      resource: "adaptive-pair:/sessions/first",
      title: "Investigate retry behavior",
      createdAt: 100,
      status: "in-progress",
    });
    expect(second.resource).toBe("adaptive-pair:/sessions/second");
    expect(store.get(first.resource)).toEqual(first);
    expect(store.list()).toEqual([first, second]);
  });
});
