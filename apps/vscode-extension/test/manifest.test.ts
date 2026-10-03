import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const readJson = <T>(path: string): T => JSON.parse(readFileSync(resolve(path), "utf8")) as T;

interface ExtensionManifest {
  version: string;
  extensionKind?: string[];
  main: string;
  browser?: unknown;
  engines: { vscode: string; node: string };
  files: string[];
  enabledApiProposals?: unknown;
  contributes: {
    commands: { command: string }[];
    languageModelTools: { name: string; toolReferenceName?: string }[];
    chatParticipants: { id: string }[];
  };
  activationEvents: string[];
}

const manifest = readJson<ExtensionManifest>("apps/vscode-extension/package.json");

describe("VS Code manifest", () => {
  it("aligns the native Growth trial release with the lockfile", () => {
    const version = "0.2.0-preview.2";
    expect(readJson<{ version: string }>("package.json").version).toBe(version);
    expect(manifest.version).toBe(version);
    const lockfile = readJson<{
      version: string;
      packages: Record<string, { version: string }>;
    }>("package-lock.json");
    expect(lockfile.version).toBe(version);
    expect(lockfile.packages[""]?.version).toBe(version);
    expect(lockfile.packages["apps/vscode-extension"]?.version).toBe(version);
  });

  it("keeps filesystem and process work in the workspace Node host at the current engine floor", () => {
    expect(manifest.extensionKind).toEqual(["workspace"]);
    expect(manifest.main).toBe("./dist/extension.cjs");
    expect(manifest.browser).toBeUndefined();
    expect(manifest.engines).toEqual({ vscode: "^1.136.0", node: ">=24" });
  });

  it("contributes every Pair Presence command", () => {
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
    // vsce refuses to combine a .vscodeignore with "files", so this allowlist is
    // the single packaging gate: only these paths can ever reach the VSIX.
    expect(manifest.files).toEqual([
      "dist/extension.cjs",
      "LICENSE",
      "README.md",
      "docs/growth-preview.md",
    ]);
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
      manifest.contributes.languageModelTools.every(
        entry =>
          entry.toolReferenceName === undefined ||
          entry.toolReferenceName.startsWith("adaptivePair"),
      ),
    ).toBe(true);
    expect(
      manifest.contributes.chatParticipants.every(entry =>
        entry.id.startsWith("adaptivePair."),
      ),
    ).toBe(true);
  });
});
