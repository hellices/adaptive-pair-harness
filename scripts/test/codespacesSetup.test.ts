import {
  chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync,
  rmSync, symlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const extensionManifest = JSON.parse(readFileSync(
  join(repositoryRoot, "apps/vscode-extension/package.json"), "utf8",
)) as { version: string };
const artifactName = `adaptive-pair-${extensionManifest.version}-stable.vsix`;

describe.skipIf(process.platform === "win32")("Codespaces lifecycle commands", () => {
  let temporaryRoot: string;
  let checkout: string;
  let trial: string;
  let commands: string;
  let installArguments: string;
  let binaries: string;

  beforeEach(() => {
    temporaryRoot = realpathSync(mkdtempSync(join(tmpdir(), "pair-codespaces-")));
    checkout = join(temporaryRoot, "repository with 'quotes'");
    trial = `${checkout}-growth-trial`;
    commands = join(temporaryRoot, "npm-commands");
    installArguments = join(temporaryRoot, "code-arguments");
    binaries = join(temporaryRoot, "bin");
    mkdirSync(join(checkout, ".devcontainer"), { recursive: true });
    mkdirSync(join(checkout, "apps/vscode-extension"), { recursive: true });
    mkdirSync(binaries);
    cpSync(join(repositoryRoot, "examples/growth-trial"),
      join(checkout, "examples/growth-trial"), { recursive: true });
    writeFileSync(join(checkout, "apps/vscode-extension/package.json"),
      JSON.stringify(extensionManifest));
    for (const filename of ["setup.sh", "install.sh"]) {
      const source = join(repositoryRoot, ".devcontainer", filename);
      if (existsSync(source)) { cpSync(source, join(checkout, ".devcontainer", filename)); }
    }
    writeFileSync(join(binaries, "npm"), [
      "#!/bin/bash", "set -eu",
      'printf "%s\\n" "$*" >> "$FAKE_NPM_LOG"',
      'if [[ "$*" == "${FAKE_FAIL_STEP:-}" ]]; then exit 23; fi',
      'if [[ "$*" == "run package" ]]; then',
      '  touch "$FAKE_VSIX"',
      '  if [[ -n "${FAKE_LATE_LINK:-}" ]]; then ln -s "$FAKE_LATE_LINK" "$FAKE_TRIAL"; fi',
      "fi", "",
    ].join("\n"));
    writeFileSync(join(binaries, "code"), [
      "#!/bin/bash", "set -eu",
      'printf "%s\\n" "$@" > "$FAKE_CODE_ARGS"',
      'exit "${FAKE_CODE_EXIT:-0}"', "",
    ].join("\n"));
    chmodSync(join(binaries, "npm"), 0o700);
    chmodSync(join(binaries, "code"), 0o700);
  });

  afterEach(() => { rmSync(temporaryRoot, { recursive: true, force: true }); });

  const run = (script: "setup" | "install", environment: NodeJS.ProcessEnv = {}) => spawnSync(
    "/bin/bash", [join(checkout, ".devcontainer", `${script}.sh`)], {
      cwd: temporaryRoot, encoding: "utf8", timeout: 15_000,
      env: {
        ...process.env, PATH: `${binaries}:${process.env["PATH"] ?? ""}`,
        CODESPACES: "", FAKE_NPM_LOG: commands, FAKE_CODE_ARGS: installArguments,
        FAKE_VSIX: join(checkout, artifactName), FAKE_TRIAL: trial, ...environment,
      },
    },
  );

  const recordedCommands = () => existsSync(commands)
    ? readFileSync(commands, "utf8").trim().split("\n") : [];

  it("exposes explicit preparation and installation commands", () => {
    const manifest = JSON.parse(readFileSync(join(repositoryRoot, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(manifest.scripts["codespaces:setup"]).toBe("bash .devcontainer/setup.sh");
    expect(manifest.scripts["codespaces:install"]).toBe("bash .devcontainer/install.sh");
  });

  it("builds in order and prepares only the independent exercise without installing or opening", () => {
    const result = run("setup");
    expect(result.status, result.stderr).toBe(0);
    expect(recordedCommands()).toEqual(["ci", "run typecheck", "run package"]);
    expect(existsSync(installArguments)).toBe(false);
    expect(readdirSync(trial).sort()).toEqual(["package.json", "src", "test"]);
    for (const filename of ["package.json", "src/retry.mjs", "test/retry.test.mjs"]) {
      expect(readFileSync(join(trial, filename), "utf8")).toBe(readFileSync(
        join(checkout, "examples/growth-trial", filename), "utf8",
      ));
    }
    expect(result.stdout).toContain("codespaces:install");
    expect(result.stdout).toContain(basename(trial));
    const exercise = spawnSync(process.execPath, ["--test"], { cwd: trial, encoding: "utf8" });
    expect(exercise.status, exercise.stderr).toBe(1);
    expect(exercise.stdout).toMatch(/(?:#|ℹ) pass 2/u);
    expect(exercise.stdout).toMatch(/(?:#|ℹ) fail 4/u);
  });

  it.each(["ci", "run typecheck", "run package"])("stops when %s fails", failedStep => {
    const result = run("setup", { FAKE_FAIL_STEP: failedStep });
    expect(result.status).toBe(23);
    const expected = ["ci", "run typecheck", "run package"];
    expect(recordedCommands()).toEqual(expected.slice(0, expected.indexOf(failedStep) + 1));
    expect(existsSync(trial)).toBe(false);
    expect(existsSync(installArguments)).toBe(false);
  });

  it("preserves completed human edits and extra files when preparation is rerun", () => {
    expect(run("setup").status).toBe(0);
    const original = readFileSync(join(checkout, "examples/growth-trial/src/retry.mjs"), "utf8");
    writeFileSync(join(trial, "src/retry.mjs"), "human-owned edited source\n");
    writeFileSync(join(trial, "notes.txt"), "keep my notes\n");
    const repeated = run("setup");
    expect(repeated.status, repeated.stderr).toBe(0);
    expect(readFileSync(join(trial, "src/retry.mjs"), "utf8")).toBe("human-owned edited source\n");
    expect(readFileSync(join(trial, "notes.txt"), "utf8")).toBe("keep my notes\n");
    expect(readFileSync(join(checkout, "examples/growth-trial/src/retry.mjs"), "utf8")).toBe(original);
    expect(repeated.stdout).toMatch(/preserv/iu);
  });

  it.each(["file", "symlink", "incomplete"])("rejects an existing %s target without overwriting", kind => {
    if (kind === "file") { writeFileSync(trial, "keep this file"); }
    if (kind === "symlink") { symlinkSync(join(checkout, "examples/growth-trial"), trial); }
    if (kind === "incomplete") { mkdirSync(trial); writeFileSync(join(trial, "notes.txt"), "keep"); }
    const before = readFileSync(join(checkout, "examples/growth-trial/src/retry.mjs"), "utf8");
    const result = run("setup");
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/exercise|trial/iu);
    expect(readFileSync(join(checkout, "examples/growth-trial/src/retry.mjs"), "utf8")).toBe(before);
    if (kind === "file") { expect(readFileSync(trial, "utf8")).toBe("keep this file"); }
    if (kind === "incomplete") { expect(readFileSync(join(trial, "notes.txt"), "utf8")).toBe("keep"); }
    expect(existsSync(installArguments)).toBe(false);
  });

  it("rejects a target symlink introduced while packaging", () => {
    const protectedRoot = join(temporaryRoot, "protected");
    mkdirSync(protectedRoot);
    const result = run("setup", { FAKE_LATE_LINK: protectedRoot });
    expect(result.status).not.toBe(0);
    expect(readdirSync(protectedRoot)).toEqual([]);
  });

  it("refuses symlinked fixture files instead of creating a linked exercise", () => {
    const original = join(checkout, "examples/growth-trial/src/retry.mjs");
    rmSync(original);
    const privateFile = join(temporaryRoot, "unrelated.txt");
    writeFileSync(privateFile, "must not become exercise material");
    symlinkSync(privateFile, original);
    const result = run("setup");
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/symlink|symbolic/iu);
    expect(readFileSync(privateFile, "utf8")).toBe("must not become exercise material");
  });

  it("requires Node 24 or later before installing dependencies", () => {
    writeFileSync(join(binaries, "node"), "#!/bin/bash\nprintf '22\\n'\n");
    chmodSync(join(binaries, "node"), 0o700);
    const result = run("setup");
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("24");
    expect(recordedCommands()).toEqual([]);
  });

  it("refuses an installation command outside Codespaces", () => {
    writeFileSync(join(checkout, artifactName), "fixture VSIX");
    const result = run("install");
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/Codespace/iu);
    expect(existsSync(installArguments)).toBe(false);
  });

  it("installs only the generated VSIX on explicit invocation, with intact quoted paths", () => {
    writeFileSync(join(checkout, artifactName), "fixture VSIX");
    const result = run("install", { CODESPACES: "true" });
    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(installArguments, "utf8").trim().split("\n")).toEqual([
      "--install-extension", join(checkout, artifactName),
    ]);
    expect(recordedCommands()).toEqual([]);
    expect(existsSync(trial)).toBe(false);
  });

  it("explains how to rebuild a missing VSIX without invoking code", () => {
    const result = run("install", { CODESPACES: "true" });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("codespaces:setup");
    expect(existsSync(installArguments)).toBe(false);
  });

  it("propagates the native extension installer's failure", () => {
    writeFileSync(join(checkout, artifactName), "fixture VSIX");
    expect(run("install", { CODESPACES: "true", FAKE_CODE_EXIT: "17" }).status).toBe(17);
  });
});
