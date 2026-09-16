import { describe, expect, it } from "vitest";
import { routeBoundaryFixture } from "./growthRouteBoundaryHarness.js";

describe("Growth route publication scheduling", () => {
  it.each([0, 1, 2, 3, 4, 5, 6])("does not publish old cache contents after Disable at microtask offset %i", async offset => {
    const fixture = routeBoundaryFixture();
    await fixture.run("transfer");
    await fixture.run("check");
    const disabling = fixture.coordinator.setPresence("off");
    for (let remaining = offset; remaining > 0; remaining--) await Promise.resolve();
    const running = fixture.start("session");
    const markdown = running.publish.getMockImplementation()!;
    const leaked: { text: string; revision: number; presence: string }[] = [];
    running.publish.mockImplementation(value => {
      const text = typeof value === "string" ? value : value.value;
      const live = fixture.store.snapshotNow();
      if (live.presence.status === "off" && (text.includes("Transfer: started") || text.includes("last check `test` passed"))) {
        leaked.push({ text, revision: live.revision, presence: live.presence.status });
      }
      return markdown(value);
    });
    await Promise.all([disabling, running.done]);
    expect(leaked).toEqual([]);
  });

  it.each(["off", "paused"].flatMap(status => [0, 1, 2, 3, 4, 5, 6].map(offset => ({ status, offset })) ))(
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
