import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { PairRuntimeSnapshot } from "@adaptive-pair/protocol";
import { createRuntime, createSession, decide, reduce } from "../src/index.js";

describe("session properties", () => {
  it("never decreases revision or authority epoch", () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom("pause", "close")), actions => {
        let state: PairRuntimeSnapshot = {
          ...createRuntime("w"),
          presence: {
            workspaceId: "w",
            observationRevision: 0,
            status: "engaged",
            activeSessionId: "s",
          },
          session: { ...createSession("s"), status: "active" },
        };

        for (const [index, action] of actions.entries()) {
          const before = state;
          const beforeAuthority = before.session?.authorityEpoch ?? 0;

          try {
            const command =
              action === "pause"
                ? {
                    protocolVersion: 1 as const,
                    commandId: `c-${index}`,
                    expectedRevision: state.revision,
                    actor: "human" as const,
                    type: "PauseSession" as const,
                    reason: "property",
                    observedAt: index,
                  }
                : {
                    protocolVersion: 1 as const,
                    commandId: `c-${index}`,
                    expectedRevision: state.revision,
                    actor: "human" as const,
                    type: "CloseSession" as const,
                    observedAt: index,
                  };

            state = reduce(state, decide(state, command).events);
          } catch {
            state = before;
          }

          expect(state.revision).toBeGreaterThanOrEqual(before.revision);
          expect(state.session?.authorityEpoch ?? beforeAuthority).toBeGreaterThanOrEqual(
            beforeAuthority,
          );
          expect(Object.isFrozen(state)).toBe(true);
        }
      }),
    );
  });
});
