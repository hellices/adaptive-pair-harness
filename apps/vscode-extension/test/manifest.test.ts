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

    expect(manifest.contributes.commands.map(item => item.command)).toEqual(
      expect.arrayContaining([
        "adaptivePair.enablePresence",
        "adaptivePair.stayQuiet",
        "adaptivePair.pausePresence",
        "adaptivePair.disablePresence",
        "adaptivePair.startSession",
        "adaptivePair.joinInProgress",
      ]),
    );
    expect(manifest.contributes.languageModelTools.map(tool => tool.name)).toEqual(
      expect.arrayContaining([
        "adaptive_pair_get_state",
        "adaptive_pair_capture_entry",
        "adaptive_pair_read_scope",
        "adaptive_pair_search_scope",
        "adaptive_pair_record_attempt",
        "adaptive_pair_record_hypothesis",
        "adaptive_pair_request_hint",
        "adaptive_pair_reveal_solution",
        "adaptive_pair_propose_work_unit",
        "adaptive_pair_accept_handoff",
        "adaptive_pair_apply_edit",
        "adaptive_pair_run_verification",
        "adaptive_pair_run_command",
        "adaptive_pair_record_transfer",
        "adaptive_pair_close_session",
      ]),
    );
  });

  it("packages a deny-by-default allowlist with no proposed API or chat session", () => {
    const manifest = JSON.parse(
      readFileSync(resolve("apps/vscode-extension/package.json"), "utf8"),
    ) as {
      main: string;
      files: string[];
      enabledApiProposals?: unknown;
      contributes: Record<string, unknown>;
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
    expect(manifest.contributes["chatSessions"]).toBeUndefined();
    expect(manifest.contributes["keybindings"]).toBeUndefined();
  });
});
