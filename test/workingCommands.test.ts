import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createWorkingCommandHandlers } from "../src/vscode/workingCommands";

describe("working agreement commands", () => {
  it("routes each command to the current runtime and reports the result", async () => {
    const actions = {
      promptForWorkingGoal: vi.fn(async () => "goal"),
      refreshProjectContext: vi.fn(async () => "context"),
      toggleProjectContextSharing: vi.fn(async () => "sharing"),
      draftWorkingAgreement: vi.fn(async () => "draft"),
    };
    const notify = vi.fn();
    const handlers = createWorkingCommandHandlers(() => actions, notify);
    for (const handler of handlers) {
      await handler.run();
    }
    for (const action of Object.values(actions)) {
      expect(action).toHaveBeenCalledOnce();
    }
    expect(notify).toHaveBeenCalledTimes(4);
  });

  it("does not act on a missing or replaced runtime", async () => {
    const notify = vi.fn();
    const handlers = createWorkingCommandHandlers(() => undefined, notify);
    await handlers[0]?.run();
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("rebuilding"));
  });

  it("reports action errors instead of dropping an unhandled rejection", async () => {
    const notify = vi.fn();
    const handlers = createWorkingCommandHandlers(() => ({
      promptForWorkingGoal: async () => { throw new Error("Start a pairing session first."); },
      refreshProjectContext: async () => "", toggleProjectContextSharing: async () => "", draftWorkingAgreement: async () => "",
    }), notify);
    await handlers[0]?.run();
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("Start a pairing session first."));
  });

  it("contributes discoverable planning and working-context commands", () => {
    const manifest = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8")) as {
      activationEvents: string[];
      contributes: { commands: { command: string }[]; chatParticipants: { commands: { name: string }[] }[] };
    };
    const commands = manifest.contributes.commands.map((command) => command.command);
    for (const command of ["adaptivePair.setWorkingGoal", "adaptivePair.refreshProjectContext", "adaptivePair.toggleProjectContextSharing", "adaptivePair.draftWorkingAgreement"]) {
      expect(commands).toContain(command);
      expect(manifest.activationEvents).toContain(`onCommand:${command}`);
    }
    expect(manifest.contributes.chatParticipants[0]?.commands.map((command) => command.name)).toEqual(expect.arrayContaining(["goal", "decision", "plan", "context", "brief", "checkpoint"]));
  });
});
