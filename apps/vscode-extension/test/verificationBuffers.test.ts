import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { codedError, lexicalIdentity, vscode } from "./verificationPortFixtures.js";

const { VscodeBufferInspectionPort } = await import("../src/verificationAdapter.js");

describe("VscodeBufferInspectionPort — workspace and target scopes", () => {

  it("returns only dirty documents in the bound root when targets are empty", () => {
    vscode.state.textDocuments = [
      {
        uri: { fsPath: "/workspace/src/shared.ts" },
        isDirty: true,
      },
      {
        uri: { fsPath: "/other-workspace/src/shared.ts" },
        isDirty: true,
      },
    ];

    expect(
      new VscodeBufferInspectionPort(
        "/workspace",
        lexicalIdentity,
      ).dirtyTargets([]),
    ).toEqual(["src/shared.ts"]);
  });

  it.each(["src", "./src"])(
    "returns a dirty descendant of directory-scoped target %s",
    target => {
    vscode.state.textDocuments = [
      {
        uri: { fsPath: "/workspace/src/retry.ts" },
        isDirty: true,
      },
      {
        uri: { fsPath: "/workspace/src-other/clean-boundary.ts" },
        isDirty: true,
      },
    ];

    expect(
      new VscodeBufferInspectionPort(
        "/workspace",
        lexicalIdentity,
      ).dirtyTargets([target]),
    ).toEqual(["src/retry.ts"]);
    },
  );

  it.each([".", ""])(
    "checks every dirty document in the bound root for invalid target %j",
    target => {
      vscode.state.textDocuments = [
        {
          uri: { fsPath: "/workspace/src/retry.ts" },
          isDirty: true,
        },
        {
          uri: { fsPath: "/other-workspace/src/other.ts" },
          isDirty: true,
        },
      ];

      expect(
        new VscodeBufferInspectionPort(
          "/workspace",
          lexicalIdentity,
        ).dirtyTargets([target]),
      ).toEqual(["src/retry.ts"]);
    },
  );

  it("ignores dirty untitled documents without a filesystem identity", () => {
    vscode.state.textDocuments = [
      {
        uri: { fsPath: "Untitled-1", scheme: "untitled" },
        isDirty: true,
      },
    ];

    expect(
      new VscodeBufferInspectionPort(
        "/workspace",
        path => {
          if (path.endsWith("Untitled-1")) {
            throw codedError("ENOENT");
          }
          return resolve(path);
        },
      ).dirtyTargets(["src/retry.ts"]),
    ).toEqual([]);
  });
});

describe("VscodeBufferInspectionPort — filesystem identity", () => {

  it.each([
    "/workspace-alias/src/retry.ts",
    "/WORKSPACE/SRC/RETRY.TS",
  ])(
    "finds a dirty target opened through the physical alias %s",
    documentPath => {
      vscode.state.textDocuments = [
        {
          uri: { fsPath: documentPath },
          isDirty: true,
        },
      ];
      const identities = new Map([
        [resolve("/workspace"), "/physical/workspace"],
        [
          resolve("/workspace/src/retry.ts"),
          "/physical/workspace/src/retry.ts",
        ],
        [resolve(documentPath), "/physical/workspace/src/retry.ts"],
      ]);

      expect(
        new VscodeBufferInspectionPort(
          "/workspace",
          path => identities.get(resolve(path)),
        ).dirtyTargets(["src/retry.ts"]),
      ).toEqual(["src/retry.ts"]);
    },
  );

  it.each([
    {
      name: "returns no identity",
      unresolved: () => undefined,
    },
    {
      name: "reports a coded filesystem error",
      unresolved: () => {
        throw codedError("ENAMETOOLONG");
      },
    },
  ])(
    "refuses inspection when resolving an agreed target $name",
    ({ unresolved }) => {
      expect(
        () =>
          new VscodeBufferInspectionPort(
            "/workspace",
            path =>
              resolve(path) === resolve("/workspace/src/retry.ts")
                ? unresolved()
                : resolve(path),
          ).dirtyTargets(["src/retry.ts"]),
      ).toThrow(/filesystem identity.*src\/retry\.ts/iu);
    },
  );

  it("refuses inspection when an external dirty document has no filesystem identity", () => {
    const documentPath = "/external-alias/src/retry.ts";
    vscode.state.textDocuments = [
      {
        uri: { fsPath: documentPath },
        isDirty: true,
      },
    ];

    expect(
      () =>
        new VscodeBufferInspectionPort(
          "/workspace",
          path => {
            if (resolve(path) === resolve(documentPath)) {
              throw codedError("EACCES");
            }
            return resolve(path);
          },
        ).dirtyTargets(["src/retry.ts"]),
    ).toThrow(/filesystem identity.*src\/retry\.ts/iu);
  });

  it("excludes an unresolvable dirty document owned by the second workspace root", () => {
    const documentPath = "/other-workspace/src/retry.ts";
    vscode.state.textDocuments = [
      {
        uri: { fsPath: documentPath },
        isDirty: true,
      },
    ];

    expect(
      new VscodeBufferInspectionPort(
        "/workspace",
        path => {
          if (resolve(path) === resolve(documentPath)) {
            throw codedError("EACCES");
          }
          return resolve(path);
        },
      ).dirtyTargets(["src/retry.ts"]),
    ).toEqual([]);
  });
});

describe("VscodeBufferInspectionPort — missing files", () => {

  it("allows a missing agreed target when no matching dirty file exists", () => {
    expect(
      new VscodeBufferInspectionPort(
        "/workspace",
        path => {
          if (resolve(path) === resolve("/workspace/src/new.ts")) {
            throw codedError("ENOENT");
          }
          return resolve(path);
        },
      ).dirtyTargets(["src/new.ts"]),
    ).toEqual([]);
  });

  it("finds a dirty new file lexically when its filesystem identity does not exist yet", () => {
    const documentPath = "/workspace/src/new.ts";
    vscode.state.textDocuments = [
      {
        uri: { fsPath: documentPath, scheme: "file" },
        isDirty: true,
      },
    ];

    expect(
      new VscodeBufferInspectionPort(
        "/workspace",
        path => {
          if (resolve(path) === resolve(documentPath)) {
            throw codedError("ENOENT");
          }
          return resolve(path);
        },
      ).dirtyTargets(["src/new.ts"]),
    ).toEqual(["src/new.ts"]);
  });
});
