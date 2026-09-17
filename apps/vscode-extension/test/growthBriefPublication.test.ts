import { describe, expect, it } from "vitest";
import { routeBoundaryFixture } from "./growthRouteBoundaryHarness.js";

describe("Growth local routes — authoritative publication", () => {
  it("does not publish a cleared brief after an ordinary queued Disable", async () => {
    const stalePublications: { offset: number; revision: number; text: string }[] = [];
    for (const offset of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]) {
      const fixture = routeBoundaryFixture();
      const disabling = fixture.coordinator.setPresence("off");
      for (let remaining = offset; remaining > 0; remaining--) await Promise.resolve();
      const running = fixture.start("brief");
      const markdown = running.publish.getMockImplementation()!;
      running.publish.mockImplementation(value => {
        const text = typeof value === "string" ? value : value.value;
        const live = fixture.store.snapshotNow();
        if (live.presence.status === "off" && text.includes("current agreed state")) {
          stalePublications.push({ offset, revision: live.revision, text });
        }
        return markdown(value);
      });
      await Promise.all([disabling, running.done]);
    }
    expect(stalePublications).toEqual([]);
  });

  it("keeps the already-fenced session route current under identical scheduling", async () => {
    const stalePublications: number[] = [];
    for (const offset of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]) {
      const fixture = routeBoundaryFixture();
      const disabling = fixture.coordinator.setPresence("off");
      for (let remaining = offset; remaining > 0; remaining--) await Promise.resolve();
      const running = fixture.start("session");
      const markdown = running.publish.getMockImplementation()!;
      running.publish.mockImplementation(value => {
        const text = typeof value === "string" ? value : value.value;
        if (fixture.store.snapshotNow().presence.status === "off" && text.includes("Adaptive Pair session state")) {
          stalePublications.push(offset);
        }
        return markdown(value);
      });
      await Promise.all([disabling, running.done]);
    }
    expect(stalePublications).toEqual([]);
  });

  it("returns the neutral brief when Disable has already completed", async () => {
    const fixture = routeBoundaryFixture();
    await fixture.coordinator.setPresence("off");
    const published = await fixture.run("brief");
    expect(published).not.toContain("Practice retry behavior");
    expect(published).not.toContain("current agreed state");
  });
});
