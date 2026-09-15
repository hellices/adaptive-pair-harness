import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

interface ExtensionManifest {
  readonly enabledApiProposals?: readonly string[];
  readonly activationEvents?: readonly string[];
  readonly main?: string;
  readonly contributes?: {
    readonly chatParticipants?: readonly {
      readonly id: string;
      readonly name: string;
    }[];
    readonly languageModelChatProviders?: readonly {
      readonly vendor: string;
      readonly displayName: string;
    }[];
    readonly chatSessions?: readonly {
      readonly type: string;
      readonly name: string;
      readonly displayName: string;
      readonly order?: number;
      readonly canDelegate?: boolean;
      readonly requiresCustomModels?: boolean;
      readonly supportsAutoModel?: boolean;
      readonly requiresCopilotSignIn?: boolean;
      readonly capabilities?: {
        readonly supportsFileAttachments?: boolean;
        readonly supportsToolAttachments?: boolean;
        readonly supportsImageAttachments?: boolean;
      };
    }[];
  };
}

const manifest = JSON.parse(
  readFileSync(resolve(__dirname, "../../package.json"), "utf8"),
) as ExtensionManifest;

describe("Adaptive Pair Session Target manifest", () => {
  it("contributes one proposed Adaptive Pair session target", () => {
    expect(manifest.enabledApiProposals).toContain("chatSessionsProvider");
    expect(manifest.enabledApiProposals).toContain("chatProvider");
    expect(manifest.main).toBe("./dist/src/extension.js");
    expect(manifest.activationEvents).toContain(
      "onChatSession:adaptive-pair",
    );
    expect(manifest.contributes?.chatParticipants ?? []).toEqual([]);
    expect(manifest.contributes?.languageModelChatProviders).toEqual([
      {
        vendor: "adaptive-pair-poc",
        displayName: "Adaptive Pair POC",
      },
    ]);
    expect(manifest.contributes?.chatSessions).toEqual([
      expect.objectContaining({
        type: "adaptive-pair",
        name: "pair",
        displayName: "Adaptive Pair",
        order: 100,
        canDelegate: true,
        requiresCustomModels: true,
        supportsAutoModel: false,
        requiresCopilotSignIn: false,
        capabilities: {
          supportsFileAttachments: false,
          supportsToolAttachments: false,
          supportsImageAttachments: false,
        },
      }),
    ]);
  });
});
