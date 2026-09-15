import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("VS Code manifest", () => {
  it("contributes every Pair Presence command", () => {
    const manifest = JSON.parse(readFileSync(
      resolve("apps/vscode-extension/package.json"),
      "utf8",
    )) as {
      contributes: {
        commands: { command: string }[];
        languageModelTools: { name: string }[];
      };
    };

    expect(manifest.contributes.commands.map(item => item.command)).toEqual([
      "adaptivePair.enablePresence",
      "adaptivePair.stayQuiet",
      "adaptivePair.pausePresence",
      "adaptivePair.disablePresence",
      "adaptivePair.startSession",
      "adaptivePair.joinInProgress",
    ]);
    expect(manifest.contributes.languageModelTools.map(tool => tool.name)).toEqual([
      "adaptive_pair_get_state",
      "adaptive_pair_read_scope",
      "adaptive_pair_search_scope",
      "adaptive_pair_run_verification",
      "adaptive_pair_close_session",
    ]);
  });

  it("packages a deny-by-default allowlist with no proposed API or chat session", () => {
    const manifest = JSON.parse(
      readFileSync(resolve("apps/vscode-extension/package.json"), "utf8"),
    ) as {
      main: string;
      files: string[];
      enabledApiProposals?: unknown;
      contributes: {
        commands: { command: string }[];
        languageModelTools: { name: string; toolReferenceName?: string }[];
        chatParticipants: { id: string }[];
      };
      activationEvents: string[];
    };

    // vsce refuses to combine a .vscodeignore with "files", so this allowlist is
    // the single packaging gate: only these paths can ever reach the VSIX.
    expect(manifest.files).toEqual([
      "dist/extension.cjs",
      "LICENSE",
      "README.md",
      "docs/growth-preview.md",
    ]);
    expect(manifest.main).toBe("./dist/extension.cjs");
    expect(manifest.enabledApiProposals).toBeUndefined();
    expect(Object.keys(manifest.contributes).sort()).toEqual(
      ["chatParticipants", "commands", "languageModelTools"].sort(),
    );
    expect(manifest.activationEvents).toEqual([
      "onCommand:adaptivePair.enablePresence",
      "onCommand:adaptivePair.startSession",
      "onCommand:adaptivePair.joinInProgress",
      "onChatParticipant:adaptivePair.chat",
    ]);
    expect(
      manifest.activationEvents.every(event =>
        /^(?:onCommand:adaptivePair\.|onChatParticipant:adaptivePair\.)/u.test(event),
      ),
    ).toBe(true);
    expect(
      manifest.contributes.commands.every(entry =>
        entry.command.startsWith("adaptivePair."),
      ),
    ).toBe(true);
    expect(
      manifest.contributes.languageModelTools.every(
        entry =>
          entry.name.startsWith("adaptive_pair_") &&
          (entry.toolReferenceName === undefined ||
            entry.toolReferenceName.startsWith("adaptivePair")),
      ),
    ).toBe(true);
    expect(
      manifest.contributes.chatParticipants.every(entry =>
        entry.id.startsWith("adaptivePair."),
      ),
    ).toBe(true);
  });
});
