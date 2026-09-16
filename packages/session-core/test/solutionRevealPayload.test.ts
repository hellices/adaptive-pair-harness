import type { PairCommand, PairEvent } from "@adaptive-pair/protocol";
import { expect, it } from "vitest";
import { decide, reduce } from "../src/index.js";
import { createGrowthRuntime } from "./sessionCoreFixtures.js";

type RevealRoute = "decision" | "replay";

const revealPayload = (route: RevealRoute, previewOnly: unknown): PairCommand | PairEvent => {
  const common = {
    protocolVersion: 1,
    commandId: "reveal-payload",
    actor: "human",
    workUnitId: "growth-wu-1",
    previewOnly,
  };
  return route === "decision"
    ? { ...common, type: "AuthorizeSolutionReveal", expectedRevision: 6, observedAt: 10 } as PairCommand
    : { ...common, type: "SolutionRevealAuthorized", eventId: "reveal-payload:0", revision: 7, recordedAt: 10 } as PairEvent;
};

const authorizeReveal = (route: RevealRoute, payload: PairCommand | PairEvent) => {
  const runtime = createGrowthRuntime();
  return route === "decision"
    ? decide(runtime, payload as PairCommand).events.at(-1)
    : reduce(runtime, [payload as PairEvent]).session?.assistance?.solutionReveal;
};

it.each(["decision", "replay"] as const)(
  "retains the preview-only invariant and reads the validated %s value once",
  route => {
    const payload = revealPayload(route, true);
    let reads = 0;
    Object.defineProperty(payload, "previewOnly", {
      enumerable: true,
      get: () => {
        reads += 1;
        return reads === 1;
      },
    });

    expect(authorizeReveal(route, payload)).toMatchObject({ previewOnly: true });
    expect(reads).toBe(1);
  },
);

const invalidCases = (["decision", "replay"] as const).flatMap(route =>
  [false, undefined, null, "true"].map(previewOnly => ({ route, previewOnly })),
);

it.each(invalidCases)("rejects previewOnly=$previewOnly through $route", ({ route, previewOnly }) => {
  expect(() => authorizeReveal(route, revealPayload(route, previewOnly)))
    .toThrow("SOLUTION_REVEAL_PREVIEW_ONLY");
});
