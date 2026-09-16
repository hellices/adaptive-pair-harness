import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { codedError, lexicalIdentity, vscode } from "./verificationPortFixtures.js";

const { createVerificationAdapter, NodePackageScriptPort } = await import(
  "../src/verificationAdapter.js"
);
import type { ConfirmationPort, ReadTextFile, TestingRunPort } from "../src/verificationAdapter.js";

describe("Verification port composition", () => {
  it("does not cancel first-root verification for a dirty duplicate path in the second root", async () => {
    vscode.state.textDocuments = [
      {
        uri: { fsPath: "/other-workspace/src/shared.ts" },
        isDirty: true,
      },
    ];
    const testing: TestingRunPort = {
      available: () => true,
      run: () =>
        Promise.resolve({
          exitCode: 0,
          signal: null,
          output: "passed",
          outputTruncated: false,
          terminationConfirmed: true,
        }),
    };
    const confirmation: ConfirmationPort = {
      confirm: () => Promise.resolve(true),
    };

    const result = await createVerificationAdapter(
      "/workspace",
      testing,
      confirmation,
      lexicalIdentity,
    ).run(
      {
        kind: "vscode-test",
        operationId: "op-multi-root",
        testIds: ["suite/case"],
        targetPaths: ["src/shared.ts"],
      },
      new AbortController().signal,
    );

    expect(result.status).toBe("confirmed");
  });

  it("cancels verification when an agreed target has no filesystem identity", async () => {
    const testing: TestingRunPort = {
      available: () => true,
      run: () =>
        Promise.resolve({
          exitCode: 0,
          signal: null,
          output: "passed",
          outputTruncated: false,
          terminationConfirmed: true,
        }),
    };
    const confirmation: ConfirmationPort = {
      confirm: () => Promise.resolve(true),
    };

    const result = await createVerificationAdapter(
      "/workspace",
      testing,
      confirmation,
      path =>
        resolve(path) === resolve("/workspace/src/retry.ts")
          ? undefined
          : resolve(path),
    ).run(
      {
        kind: "vscode-test",
        operationId: "op-unresolved-target",
        testIds: ["suite/case"],
        targetPaths: ["src/retry.ts"],
      },
      new AbortController().signal,
    );

    expect(result).toMatchObject({
      status: "cancelled",
      observation: {
        reason: "target-buffer-identity-unavailable",
        targetPaths: ["src/retry.ts"],
      },
    });
  });
});

describe("NodePackageScriptPort", () => {
  const port = (read: ReadTextFile): InstanceType<typeof NodePackageScriptPort> =>
    new NodePackageScriptPort("/repo", read);

  it("reads scripts from a valid manifest", () => {
    const manifest = port(() =>
      JSON.stringify({ scripts: { test: "vitest run", build: "esbuild" } }),
    ).scripts();
    expect(manifest).toEqual({
      status: "ok",
      scripts: { test: "vitest run", build: "esbuild" },
    });
  });

  it("reports a genuinely absent manifest distinctly", () => {
    const manifest = port(() => {
      throw codedError("ENOENT");
    }).scripts();
    expect(manifest.status).toBe("absent");
  });

  it("reports an unreadable manifest as a typed failure, not absent", () => {
    const manifest = port(() => {
      throw codedError("EACCES");
    }).scripts();
    expect(manifest.status).toBe("unreadable");
  });

  it("reports a malformed manifest as unreadable rather than throwing", () => {
    const manifest = port(() => "{ this is not json ").scripts();
    expect(manifest.status).toBe("unreadable");
  });

  it("reports a non-object manifest as unreadable", () => {
    const manifest = port(() => JSON.stringify("just a string")).scripts();
    expect(manifest.status).toBe("unreadable");
  });

  it("treats a manifest without a scripts field as an empty ok result", () => {
    const manifest = port(() => JSON.stringify({ name: "pkg" })).scripts();
    expect(manifest).toEqual({ status: "ok", scripts: {} });
  });

  it("reports a non-object scripts field as unreadable", () => {
    const manifest = port(() => JSON.stringify({ scripts: "nope" })).scripts();
    expect(manifest.status).toBe("unreadable");
  });
});
