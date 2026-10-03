import { describe, expect, it } from "vitest";
import { routeBoundaryFixture } from "./growthRouteBoundaryHarness.js";

describe("Growth route publication scheduling", () => {
  // Offsets 0-4 start the reveal route while the presence change is still
  // queued. The session-route Disable sweep lives in growthBriefPublication.
  it.each(["off", "paused"].flatMap(status => [0, 1, 2, 3, 4].map(offset => ({ status, offset })) ))(
    "does not open reveal after $status at microtask offset $offset", async ({ status, offset }) => {
      const fixture = routeBoundaryFixture();
      const invalidModals: { revision: number; presence: string; session: string | undefined }[] = [];
      fixture.confirmSolutionReveal.mockImplementation(() => {
        const live = fixture.store.snapshotNow();
        if (live.presence.status === "off" || live.session?.status === "paused") {
          invalidModals.push({ revision: live.revision, presence: live.presence.status, session: live.session?.status });
        }
        return Promise.resolve(false);
      });
      const changing = fixture.coordinator.setPresence(status as "off" | "paused");
      for (let remaining = offset; remaining > 0; remaining--) await Promise.resolve();
      const running = fixture.start("reveal");
      await Promise.all([changing, running.done]);
      expect(invalidModals).toEqual([]);
    },
  );
});
