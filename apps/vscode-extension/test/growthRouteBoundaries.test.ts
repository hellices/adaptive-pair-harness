import { describe, expect, it } from "vitest";
import { cancellation, deferred, recreate, routeBoundaryFixture, staleSnapshotOnce } from "./growthRouteBoundaryHarness.js";

describe("Growth reveal entry fence", () => {
  it.each([undefined, "reveal", "transfer"])("rejects an already-active Pair session for %s before modal or model work", async command => {
    const fixture = routeBoundaryFixture();
    await recreate(fixture, "pair");
    await fixture.run(command);
    expect(fixture.confirmSolutionReveal).not.toHaveBeenCalled();
    expect(fixture.requestWorkspaceConsent).not.toHaveBeenCalled();
    expect(fixture.grant).not.toHaveBeenCalled();
    expect(fixture.requestModel).not.toHaveBeenCalled();
  });

  it("preserves the deferred capture gate when a Pair session replaces the captured one", async () => {
    const fixture = routeBoundaryFixture();
    staleSnapshotOnce(fixture, () => recreate(fixture, "pair"));
    await fixture.run("transfer");
    expect(fixture.confirmSolutionReveal).not.toHaveBeenCalled();
    expect(fixture.requestWorkspaceConsent).not.toHaveBeenCalled();
    expect(fixture.grant).not.toHaveBeenCalled();
    expect(fixture.requestModel).not.toHaveBeenCalled();
  });

  it.each([undefined, "transfer"])("preserves the already-cancelled %s gate", async command => {
    const fixture = routeBoundaryFixture();
    const source = cancellation();
    source.cancel();
    const running = fixture.start(command, undefined, source);
    await running.done;
    expect(fixture.requestWorkspaceConsent).not.toHaveBeenCalled();
    expect(fixture.requestModel).not.toHaveBeenCalled();
    expect(running.publishedAfterAbort).toEqual([]);
  });

  it("rejects a Pair lifecycle before opening reveal after a stale capture", async () => {
    const fixture = routeBoundaryFixture();
    staleSnapshotOnce(fixture, () => recreate(fixture, "pair"));
    await fixture.run("reveal");
    expect(fixture.store.snapshotNow().session?.mode).toBe("pair");
    expect.soft(fixture.confirmSolutionReveal).not.toHaveBeenCalled();
    expect(fixture.requestWorkspaceConsent).not.toHaveBeenCalled();
    expect(fixture.grant).not.toHaveBeenCalled();
    expect(fixture.requestModel).not.toHaveBeenCalled();
  });

  it("does not open a reveal modal for an already-cancelled request", async () => {
    const fixture = routeBoundaryFixture();
    const source = cancellation();
    source.cancel();
    const running = fixture.start("reveal", undefined, source);
    await running.done;
    expect(fixture.confirmSolutionReveal).not.toHaveBeenCalled();
    expect(running.publishedAfterAbort).toEqual([]);
  });

  it("still opens reveal when only an observation moved the revision", async () => {
    const fixture = routeBoundaryFixture();
    staleSnapshotOnce(fixture, () => fixture.coordinator.observeWorkspace());
    await fixture.run("reveal");
    expect(fixture.confirmSolutionReveal).toHaveBeenCalledTimes(1);
    expect(fixture.requestWorkspaceConsent).toHaveBeenCalledTimes(1);
    expect(fixture.requestModel).toHaveBeenCalledTimes(1);
    expect(fixture.store.snapshotNow().session?.assistance?.solutionReveal).toBeDefined();
  });
});

describe("Growth declined modal cancellation", () => {
  it.each([undefined, "reveal"])("preserves a normal declined %s consent", async command => {
    const fixture = routeBoundaryFixture();
    fixture.requestWorkspaceConsent.mockResolvedValue(false);
    const running = fixture.start(command);
    await running.done;
    expect(running.collected.markdown).toHaveLength(1);
    expect(running.collected.markdown[0]).toContain("kept your workspace private");
    expect(fixture.grant).not.toHaveBeenCalled();
    expect(fixture.requestModel).not.toHaveBeenCalled();
    expect(fixture.store.snapshotNow()).toEqual(fixture.before);
  });

  it("preserves a normal declined reveal confirmation", async () => {
    const fixture = routeBoundaryFixture();
    fixture.confirmSolutionReveal.mockResolvedValue(false);
    const running = fixture.start("reveal");
    await running.done;
    expect(running.collected.markdown).toHaveLength(1);
    expect(running.collected.markdown[0]).toContain("Solution reveal cancelled");
    expect(fixture.requestWorkspaceConsent).not.toHaveBeenCalled();
    expect(fixture.grant).not.toHaveBeenCalled();
    expect(fixture.requestModel).not.toHaveBeenCalled();
  });

  it("does not publish a declined consent after Chat abort", async () => {
    const fixture = routeBoundaryFixture();
    const entered = deferred<void>();
    const decision = deferred<boolean>();
    fixture.requestWorkspaceConsent.mockImplementation(() => { entered.resolve(undefined); return decision.promise; });
    const running = fixture.start();
    await entered.promise;
    running.source.cancel();
    decision.resolve(false);
    await running.done;
    expect.soft(running.publishedAfterAbort).toEqual([]);
    expect(fixture.requestModel).not.toHaveBeenCalled();
    expect(fixture.grant).not.toHaveBeenCalled();
    expect(fixture.consent.has(running.model, fixture.store.snapshotNow())).toBe(false);
  });

  it("does not publish a declined reveal confirmation after Chat abort", async () => {
    const fixture = routeBoundaryFixture();
    const entered = deferred<void>();
    const decision = deferred<boolean>();
    fixture.confirmSolutionReveal.mockImplementation(() => { entered.resolve(undefined); return decision.promise; });
    const running = fixture.start("reveal");
    await entered.promise;
    running.source.cancel();
    decision.resolve(false);
    await running.done;
    expect(running.publishedAfterAbort).toEqual([]);
    expect(fixture.requestWorkspaceConsent).not.toHaveBeenCalled();
  });
});

describe("Growth cached session publication", () => {
  it.each(["recreated", "disabled", "workspace-rebind", "observed"] as const)("filters cached outcomes against the live %s state", async transition => {
    const fixture = routeBoundaryFixture();
    await fixture.run("transfer");
    await fixture.run("check");
    expect(fixture.participant.transferStatus()).toBeDefined();
    expect(await fixture.run("session")).toContain("last check `test` passed");
    staleSnapshotOnce(fixture, () => {
      if (transition === "recreated") return recreate(fixture);
      if (transition === "workspace-rebind") return fixture.coordinator.setPresence("observing", "workspace-2");
      return transition === "disabled" ? fixture.coordinator.setPresence("off") : fixture.coordinator.observeWorkspace();
    });
    const text = await fixture.run("session");
    if (transition === "recreated" || transition === "disabled" || transition === "workspace-rebind") {
      expect.soft(text).not.toContain("Transfer: started");
      expect.soft(text).not.toContain("last check `test` passed");
      expect(fixture.participant.transferStatus()).toBeUndefined();
    } else {
      expect(text).toContain("Transfer: started");
      expect(text).toContain("last check `test` passed");
      expect(fixture.participant.transferStatus()).toBeDefined();
    }
  });
});
