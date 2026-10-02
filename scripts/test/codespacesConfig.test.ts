import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const readConfiguration = (): Record<string, unknown> =>
  JSON.parse(readFileSync(resolve(".devcontainer/devcontainer.json"), "utf8")) as Record<string, unknown>;

const readPreparationJob = (): string => {
  const workflow = readFileSync(resolve(".github/workflows/ci.yml"), "utf8");
  const job = workflow.split(/(?=^ {2}[\w-]+:$)/mu)
    .find(section => section.startsWith("  codespaces-setup:\n"));
  expect(job, "missing bounded container preparation job").toBeDefined();
  return job ?? "";
};

const readPreparationShell = (): string => {
  const block = readPreparationJob().split("        run: |\n")[1];
  expect(block, "missing container preparation shell").toBeDefined();
  return `${(block ?? "").replace(/^ {10}/gmu, "").trimEnd()}\n`;
};

const expectOrdered = (text: string, steps: readonly string[]): void => {
  let previous = -1;
  for (const step of steps) {
    const index = text.indexOf(step, previous + 1);
    expect(index, `missing or out-of-order preparation step: ${step}`).toBeGreaterThan(previous);
    previous = index;
  }
};

describe("Codespaces container configuration", () => {
  it("only prepares with the approved image, non-root user, and blocking creation hook", () => {
    expect(readConfiguration()).toEqual({
      name: "Adaptive Pair Growth trial",
      image: "node:24-bookworm",
      remoteUser: "node",
      waitFor: "postCreateCommand",
      postCreateCommand: "bash .devcontainer/setup.sh",
    });
  });
});

describe("Codespaces container preparation CI", () => {
  it("uses the same image with a bounded, required Linux job", () => {
    const job = readPreparationJob();
    const configuration = readConfiguration();
    expect(configuration["image"]).toBe("node:24-bookworm");
    expect(job).toContain("container:\n      image: node:24-bookworm");
    expect(job).toContain("runs-on: ubuntu-latest");
    const timeout = Number(job.match(/timeout-minutes: (\d+)/u)?.[1]);
    expect(timeout).toBeGreaterThan(0);
    expect(timeout).toBeLessThanOrEqual(30);
    expect(job).not.toContain("continue-on-error:");
  });

  it("uses root only for the disposable area before running repository commands as node", () => {
    const shell = readPreparationShell();
    const boundary = "runuser -u node -- bash -se <<'PREPARE'\n";
    expect(shell.split(boundary)).toHaveLength(2);
    expect(shell.split(boundary)[0]).toBe([
      "set -euo pipefail",
      "install -d -o node -g node /workspaces",
      "",
    ].join("\n"));
    expectOrdered(shell, [
      boundary,
      "set -euo pipefail",
      'test "$(id -un)" = node',
      'test "$(id -u)" -ne 0',
      "unset CODESPACES",
      "repository=/workspaces/adaptive-pair-harness",
      'trial="${repository}-growth-trial"',
      'cd "$repository"',
      "bash .devcontainer/setup.sh",
    ]);
    expect(shell.endsWith("PREPARE\n")).toBe(true);
  });

  it("copies no Git credentials and never installs or opens an extension or cloud workspace", () => {
    const job = readPreparationJob();
    const shell = readPreparationShell();
    expect(job).toContain("uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1");
    expect(job).toContain("persist-credentials: false");
    expectOrdered(shell, [
      'mkdir "$repository"',
      'tar --exclude=.git -cf /workspaces/repository.tar -C "$GITHUB_WORKSPACE" .',
      'tar -xf /workspaces/repository.tar -C "$repository"',
      "rm /workspaces/repository.tar",
      'test ! -e "$repository/.git"',
    ]);
    expect(job).not.toContain("actions/upload-artifact@");
    expect(job).not.toMatch(/\b(?:code|code-insiders)\b|codespaces:install|\.devcontainer\/install\.sh|\bgh codespace\b/u);
  });

  it("verifies both builds and preserves the fixture and edited sibling across preparation reruns", () => {
    const shell = readPreparationShell();
    expectOrdered(shell, [
      "cp -R examples/growth-trial /workspaces/fixture-before",
      "mkdir /workspaces/expected-trial",
      "for entry in package.json src test; do",
      'cp -R "/workspaces/fixture-before/$entry" /workspaces/expected-trial/',
      "bash .devcontainer/setup.sh",
      "node scripts/verify-vsix.mjs",
      "diff -r /workspaces/fixture-before examples/growth-trial",
      'diff -r /workspaces/expected-trial "$trial"',
      'npm test -- --test-reporter=tap',
      'printf \'\\n\' >> "$trial/src/retry.mjs"',
      'printf \'%s\\n\' \'Keep this owner edit.\' > "$trial/owner-edit.txt"',
      'cp -R "$trial" /workspaces/trial-before-rerun',
      "bash .devcontainer/setup.sh",
      "node scripts/verify-vsix.mjs",
      'diff -r /workspaces/trial-before-rerun "$trial"',
      "diff -r /workspaces/fixture-before examples/growth-trial",
      'diff -r /workspaces/fixture-before "$GITHUB_WORKSPACE/examples/growth-trial"',
    ]);
  });

  it("requires the intentional 2-pass/4-fail fixture result without masking setup errors", () => {
    const shell = readPreparationShell();
    expectOrdered(shell, [
      "trial_status=0",
      '(cd "$trial" && npm test -- --test-reporter=tap) > /workspaces/growth-trial.tap 2>&1 || trial_status=$?',
      "cat /workspaces/growth-trial.tap",
      'test "$trial_status" -eq 1',
    ]);
    for (const summary of ["tests 6", "pass 2", "fail 4", "cancelled 0", "skipped 0", "todo 0"]) {
      expect(shell).toContain(`grep -Fxq '# ${summary}' /workspaces/growth-trial.tap`);
    }
    expect(shell.match(/\|\|/gu)).toHaveLength(1);
    expect(shell).not.toMatch(/set \+e|\|\s*tee\b/u);
  });

  it.skipIf(process.platform === "win32")("uses a syntactically valid fail-fast Bash wrapper", () => {
    expect(readPreparationJob()).toContain("shell: bash");
    const shell = readPreparationShell();
    expect(shell.match(/^set -euo pipefail$/gmu)).toHaveLength(2);
    const syntax = spawnSync("bash", ["-n"], {
      input: shell,
      encoding: "utf8",
      timeout: 5_000,
    });
    expect(syntax.error).toBeUndefined();
    expect(syntax.status, syntax.stderr).toBe(0);
  });
});
